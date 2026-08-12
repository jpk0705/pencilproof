const encoder = new TextEncoder();

type SqlValue = string | number | null;
type SqlRow = Record<string, SqlValue>;
type SqlCursor<T extends SqlRow> = Iterable<T> & { toArray(): T[] };
type Sql = { exec<T extends SqlRow = SqlRow>(query: string, ...values: SqlValue[]): SqlCursor<T> };
type AccountState = { storage: { sql: Sql; deleteAll(): Promise<void> } };

export type AccountEnv = {
  ACCOUNTS: { get(id: unknown): { fetch(request: Request): Promise<Response> }; idFromName(name: string): unknown };
  CLERK_ISSUER?: string;
  CLERK_JWKS_URL?: string;
  CLERK_AUDIENCE?: string;
  SESSION_SECRET: string;
};

type User = { id: string; providerSubject: string; createdAt: number };
export type Entitlement = { id: string; userId: string | null; guestId: string | null; stripeSessionId: string; activatedAt: number; expiresAt: number; status: string };
export type StoredAudit = { id: string; ownerId: string; createdAt: number; expiresAt: number; data: Record<string, unknown> };

const b64 = (bytes: Uint8Array) => {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const unb64 = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};
const key = (secret: string) => crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export const createUserSession = async (userId: string, secret: string, maxAge = 60 * 60 * 24 * 30) => {
  const payload = b64(encoder.encode(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + maxAge })));
  const signature = b64(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload))));
  return `${payload}.${signature}`;
};

export const verifyUserSession = async (token: string | null, secret: string) => {
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  if (!await crypto.subtle.verify("HMAC", await key(secret), unb64(signature), encoder.encode(payload))) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(unb64(payload))) as { sub?: string; exp?: number };
    return typeof parsed.sub === "string" && /^[A-Za-z0-9_:-]{8,200}$/.test(parsed.sub) && typeof parsed.exp === "number" && parsed.exp > Math.floor(Date.now() / 1000) ? parsed.sub : null;
  } catch { return null; }
};

const jwtPart = (token: string, index: number) => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(new TextDecoder().decode(unb64(parts[index]))) as Record<string, unknown>; } catch { return null; }
};

export const verifyProviderToken = async (token: string, env: AccountEnv) => {
  const header = jwtPart(token, 0);
  const claims = jwtPart(token, 1);
  if (!header || !claims || typeof header.kid !== "string" || typeof claims.sub !== "string") return null;
  if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) return null;
  if (!env.CLERK_ISSUER || claims.iss !== env.CLERK_ISSUER) return null;
  if (env.CLERK_AUDIENCE && claims.aud !== env.CLERK_AUDIENCE) return null;
  if (header.alg !== "RS256" || !env.CLERK_JWKS_URL) return null;
  const response = await fetch(env.CLERK_JWKS_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const body = await response.json() as { keys?: Array<JsonWebKey & { kid?: string; alg?: string }> };
  const jwk = body.keys?.find((candidate) => candidate.kid === header.kid);
  if (!jwk) return null;
  const cryptoKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const parts = token.split(".");
  const signature = unb64(parts[2]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, encoder.encode(`${parts[0]}.${parts[1]}`));
  return valid ? { id: claims.sub } : null;
};

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const isoNow = () => Math.floor(Date.now() / 1000);
const owner = (userId: string | null, guestId: string | null) => userId ? `user:${userId}` : guestId ? `guest:${guestId}` : "";

export class AccountStore {
  private readonly sql: Sql;
  constructor(state: AccountState) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, provider_subject TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS entitlements (id TEXT PRIMARY KEY, user_id TEXT, guest_id TEXT, stripe_session_id TEXT UNIQUE NOT NULL, activated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS entitlements_owner ON entitlements(user_id, guest_id, status)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS audits (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, data TEXT NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS audits_owner ON audits(owner_id, expires_at)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS marketing_preferences (user_id TEXT PRIMARY KEY, email TEXT NOT NULL, opted_in_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  }
  private purge() { this.sql.exec(`DELETE FROM audits WHERE expires_at <= ?`, isoNow()); }
  user(providerSubject: string) {
    const existing = this.sql.exec<{ id: string; provider_subject: string; created_at: number }>(`SELECT * FROM users WHERE provider_subject = ?`, providerSubject).toArray()[0];
    if (existing) return { id: existing.id, providerSubject: existing.provider_subject, createdAt: existing.created_at } satisfies User;
    const id = crypto.randomUUID();
    const createdAt = isoNow();
    this.sql.exec(`INSERT INTO users VALUES (?, ?, ?)`, id, providerSubject, createdAt);
    return { id, providerSubject, createdAt } satisfies User;
  }
  migrateGuest(guestId: string, userId: string) {
    const existing = this.sql.exec<{ id: string }>(`SELECT id FROM entitlements WHERE guest_id = ? AND user_id IS NULL`, guestId).toArray();
    for (const row of existing) this.sql.exec(`UPDATE entitlements SET user_id = ?, guest_id = NULL WHERE id = ?`, userId, row.id);
    this.sql.exec(`UPDATE audits SET owner_id = ? WHERE owner_id = ?`, `user:${userId}`, `guest:${guestId}`);
  }
  entitlement(input: { userId?: string | null; guestId?: string | null; stripeSessionId: string; activatedAt: number; exactExpiresAt?: number; now?: number }) {
    const now = input.now ?? isoNow();
    const target = input.userId ? `user:${input.userId}` : `guest:${input.guestId ?? ""}`;
    const prior = this.sql.exec<{ expires_at: number }>(`SELECT MAX(expires_at) AS expires_at FROM entitlements WHERE (user_id = ? OR guest_id = ?) AND status = 'active'`, input.userId ?? null, input.guestId ?? null).toArray()[0]?.expires_at ?? 0;
    const expiresAt = typeof input.exactExpiresAt === "number"
      ? Math.max(input.exactExpiresAt, prior)
      : Math.max(now, prior) + 60 * 60 * 24 * 30;
    const existing = this.sql.exec<{ id: string }>(`SELECT id FROM entitlements WHERE stripe_session_id = ?`, input.stripeSessionId).toArray()[0];
    if (existing) return;
    this.sql.exec(`INSERT INTO entitlements VALUES (?, ?, ?, ?, ?, ?, 'active')`, crypto.randomUUID(), input.userId ?? null, input.guestId ?? null, input.stripeSessionId, input.activatedAt, expiresAt);
  }
  hasAccess(userId: string | null, guestId: string | null) {
    this.purge();
    const row = this.sql.exec<{ expires_at: number }>(`SELECT MAX(expires_at) AS expires_at FROM entitlements WHERE (user_id = ? OR guest_id = ?) AND status = 'active'`, userId, guestId).toArray()[0];
    return row?.expires_at && row.expires_at > isoNow() ? row.expires_at : null;
  }
  revoke(stripeSessionId: string) { this.sql.exec(`UPDATE entitlements SET status = 'revoked' WHERE stripe_session_id = ?`, stripeSessionId); }
  audits(ownerId: string) { this.purge(); return this.sql.exec<{ id: string; created_at: number; expires_at: number; data: string }>(`SELECT id, created_at, expires_at, data FROM audits WHERE owner_id = ? ORDER BY created_at DESC`, ownerId).toArray().map((row) => ({ id: row.id, ownerId, createdAt: row.created_at, expiresAt: row.expires_at, data: JSON.parse(row.data) })); }
  saveAudit(ownerId: string, data: Record<string, unknown>) { this.purge(); const now = isoNow(); const id = crypto.randomUUID(); this.sql.exec(`INSERT INTO audits VALUES (?, ?, ?, ?, ?)`, id, ownerId, now, now + 60 * 60 * 24 * 30, JSON.stringify(data)); return id; }
  deleteAudit(ownerId: string, id: string) { this.sql.exec(`DELETE FROM audits WHERE id = ? AND owner_id = ?`, id, ownerId); }
  setMarketingOptIn(userId: string, email: string) {
    const now = isoNow();
    this.sql.exec(`DELETE FROM marketing_preferences WHERE user_id = ?`, userId);
    this.sql.exec(`INSERT INTO marketing_preferences VALUES (?, ?, ?, ?)`, userId, email, now, now);
  }
  deleteUser(userId: string) { this.sql.exec(`DELETE FROM audits WHERE owner_id = ?`, `user:${userId}`); this.sql.exec(`DELETE FROM entitlements WHERE user_id = ?`, userId); this.sql.exec(`DELETE FROM marketing_preferences WHERE user_id = ?`, userId); this.sql.exec(`DELETE FROM users WHERE id = ?`, userId); }
  async fetch(request: Request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const path = new URL(request.url).pathname;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (path === "/user") {
      if (typeof body.providerSubject !== "string") return json({ error: "invalid_subject" }, 400);
      return json({ user: this.user(body.providerSubject) });
    }
    if (path === "/migrate") {
      if (typeof body.guestId !== "string" || typeof body.userId !== "string") return json({ error: "invalid_migration" }, 400);
      this.migrateGuest(body.guestId, body.userId); return json({ migrated: true });
    }
    if (path === "/entitlement") {
      if (typeof body.stripeSessionId !== "string" || typeof body.activatedAt !== "number") return json({ error: "invalid_entitlement" }, 400);
      this.entitlement({ userId: typeof body.userId === "string" ? body.userId : null, guestId: typeof body.guestId === "string" ? body.guestId : null, stripeSessionId: body.stripeSessionId, activatedAt: body.activatedAt, exactExpiresAt: typeof body.exactExpiresAt === "number" ? body.exactExpiresAt : undefined });
      return json({ stored: true });
    }
    if (path === "/access") return json({ expiresAt: this.hasAccess(typeof body.userId === "string" ? body.userId : null, typeof body.guestId === "string" ? body.guestId : null) });
    if (path === "/marketing") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!/^[A-Za-z0-9_:-]{8,200}$/.test(userId) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email) || email.length > 254) return json({ error: "invalid_marketing_preference" }, 400);
      this.setMarketingOptIn(userId, email); return json({ optedIn: true });
    }
    if (path === "/audits") {
      const ownerId = typeof body.ownerId === "string" ? body.ownerId : "";
      if (!ownerId) return json({ error: "invalid_owner" }, 400);
      if (body.action === "list") return json({ audits: this.audits(ownerId) });
      if (body.action === "save" && body.data && typeof body.data === "object") return json({ id: this.saveAudit(ownerId, body.data as Record<string, unknown>) });
      if (body.action === "delete" && typeof body.id === "string") { this.deleteAudit(ownerId, body.id); return json({ deleted: true }); }
      return json({ error: "invalid_audit_action" }, 400);
    }
    if (path === "/delete-user" && typeof body.userId === "string") { this.deleteUser(body.userId); return json({ deleted: true }); }
    if (path === "/revoke" && typeof body.stripeSessionId === "string") { this.revoke(body.stripeSessionId); return json({ revoked: true }); }
    return new Response("Not found", { status: 404 });
  }
}

export const accountStub = (env: AccountEnv) => env.ACCOUNTS.get(env.ACCOUNTS.idFromName("pencilproof-accounts"));
export const accountCookie = async (userId: string, secret: string) => `pp_user=${await createUserSession(userId, secret)}; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`;
export const clearAccountCookie = "pp_user=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax";
export const accountOwner = owner;
