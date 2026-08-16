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
export type AccountIdentity = {
  userId: string;
  email: string;
  role: "consumer" | "salesperson" | "both";
  lastRole: AccountRole;
  firstSeenAt: number;
  lastSeenAt: number;
};

type SalespersonProfile = {
  userId: string;
  email: string;
  displayName: string;
  referralCode: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string;
  earnedCredits: number;
  availableCredits: number;
  createdAt: number;
  updatedAt: number;
};

type ReferralReward = {
  id: string;
  referralCode: string;
  salespersonUserId: string;
  customerUserId: string | null;
  customerEmail: string | null;
  stripeSessionId: string;
  status: "pending" | "credited";
  createdAt: number;
  creditedAt: number | null;
};

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

export type AccountRole = "consumer" | "salesperson";

export const createAccountRoleSession = async (role: AccountRole, secret: string, maxAge = 60 * 60 * 24 * 30) => {
  const payload = b64(encoder.encode(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + maxAge })));
  const signature = b64(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload))));
  return `${payload}.${signature}`;
};

export const verifyAccountRoleSession = async (token: string | null, secret: string): Promise<AccountRole | null> => {
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  if (!await crypto.subtle.verify("HMAC", await key(secret), unb64(signature), encoder.encode(payload))) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(unb64(payload))) as { role?: unknown; exp?: unknown };
    return (parsed.role === "consumer" || parsed.role === "salesperson")
      && typeof parsed.exp === "number"
      && parsed.exp > Math.floor(Date.now() / 1000)
      ? parsed.role
      : null;
  } catch {
    return null;
  }
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
  const configuredIssuer = env.CLERK_ISSUER?.replace(/\/+$/, "");
  const tokenIssuer = typeof claims.iss === "string" ? claims.iss.replace(/\/+$/, "") : "";
  if (!configuredIssuer || tokenIssuer !== configuredIssuer) return null;
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
    this.sql.exec(`CREATE TABLE IF NOT EXISTS email_contacts (user_id TEXT PRIMARY KEY, email TEXT NOT NULL, added_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS marketing_suppressions (email TEXT PRIMARY KEY, suppressed_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS marketing_activity (user_id TEXT PRIMARY KEY, last_scan_at INTEGER, last_checkout_at INTEGER, last_purchase_at INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS marketing_deliveries (user_id TEXT NOT NULL, campaign_key TEXT NOT NULL, claimed_at INTEGER NOT NULL, sent_at INTEGER, PRIMARY KEY (user_id, campaign_key))`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS marketing_deliveries_user ON marketing_deliveries(user_id, sent_at)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS account_identity_contexts (user_id TEXT PRIMARY KEY, email TEXT NOT NULL, consumer_seen_at INTEGER, salesperson_seen_at INTEGER, last_role TEXT NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS account_identity_contexts_last_seen ON account_identity_contexts(last_seen_at)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS salesperson_profiles (user_id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL, referral_code TEXT UNIQUE NOT NULL, stripe_customer_id TEXT, stripe_subscription_id TEXT, subscription_status TEXT NOT NULL, earned_credits INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS salesperson_profiles_referral ON salesperson_profiles(referral_code)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS referral_rewards (id TEXT PRIMARY KEY, referral_code TEXT NOT NULL, salesperson_user_id TEXT NOT NULL, customer_user_id TEXT, customer_email TEXT, stripe_session_id TEXT UNIQUE NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, credited_at INTEGER)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS referral_rewards_salesperson ON referral_rewards(salesperson_user_id, status)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS salesperson_credits (id TEXT PRIMARY KEY, source_reward_id TEXT UNIQUE NOT NULL, owner_user_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, redeemed_at INTEGER)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS salesperson_credits_owner ON salesperson_credits(owner_user_id, status)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS salesperson_gifts (code TEXT PRIMARY KEY, credit_id TEXT UNIQUE NOT NULL, from_user_id TEXT NOT NULL, claimed_by_user_id TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, claimed_at INTEGER)`);
    this.sql.exec(`INSERT OR IGNORE INTO email_contacts (user_id, email, added_at, updated_at) SELECT user_id, email, opted_in_at, updated_at FROM marketing_preferences`);
    this.sql.exec(`INSERT OR IGNORE INTO account_identity_contexts (user_id, email, consumer_seen_at, salesperson_seen_at, last_role, first_seen_at, last_seen_at) SELECT contacts.user_id, contacts.email, CASE WHEN profiles.user_id IS NULL THEN contacts.added_at ELSE NULL END, CASE WHEN profiles.user_id IS NOT NULL THEN profiles.created_at ELSE NULL END, CASE WHEN profiles.user_id IS NOT NULL THEN 'salesperson' ELSE 'consumer' END, contacts.added_at, MAX(contacts.updated_at, COALESCE(profiles.updated_at, contacts.updated_at)) FROM email_contacts AS contacts LEFT JOIN salesperson_profiles AS profiles ON profiles.user_id = contacts.user_id`);
    this.sql.exec(`INSERT OR IGNORE INTO account_identity_contexts (user_id, email, consumer_seen_at, salesperson_seen_at, last_role, first_seen_at, last_seen_at) SELECT profiles.user_id, profiles.email, NULL, profiles.created_at, 'salesperson', profiles.created_at, profiles.updated_at FROM salesperson_profiles AS profiles`);
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
  saveEmailContact(userId: string, email: string) {
    const now = isoNow();
    this.sql.exec(`INSERT OR IGNORE INTO email_contacts (user_id, email, added_at, updated_at) VALUES (?, ?, ?, ?)`, userId, email, now, now);
    this.sql.exec(`UPDATE email_contacts SET email = ?, updated_at = ? WHERE user_id = ?`, email, now, userId);
  }
  saveAccountIdentity(userId: string, email: string | null, role: AccountRole) {
    const now = isoNow();
    const existing = this.sql.exec<{ user_id: string; email: string; consumer_seen_at: number | null; salesperson_seen_at: number | null }>(`SELECT user_id, email, consumer_seen_at, salesperson_seen_at FROM account_identity_contexts WHERE user_id = ?`, userId).toArray()[0];
    const nextEmail = email || existing?.email || "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(nextEmail) || nextEmail.length > 254) return false;
    const consumerSeenAt = role === "consumer" ? now : (existing?.consumer_seen_at ?? null);
    const salespersonSeenAt = role === "salesperson" ? now : (existing?.salesperson_seen_at ?? null);
    if (existing) {
      this.sql.exec(`UPDATE account_identity_contexts SET email = ?, consumer_seen_at = ?, salesperson_seen_at = ?, last_role = ?, last_seen_at = ? WHERE user_id = ?`, nextEmail, consumerSeenAt, salespersonSeenAt, role, now, userId);
    } else {
      this.sql.exec(`INSERT INTO account_identity_contexts (user_id, email, consumer_seen_at, salesperson_seen_at, last_role, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, userId, nextEmail, consumerSeenAt, salespersonSeenAt, role, now, now);
    }
    return true;
  }
  accountIdentities() {
    return this.sql.exec<{
      user_id: string;
      email: string;
      consumer_seen_at: number | null;
      salesperson_seen_at: number | null;
      last_role: AccountRole;
      first_seen_at: number;
      last_seen_at: number;
    }>(`SELECT user_id, email, consumer_seen_at, salesperson_seen_at, last_role, first_seen_at, last_seen_at FROM account_identity_contexts ORDER BY last_seen_at DESC LIMIT 1000`).toArray().map((row) => ({
      userId: row.user_id,
      email: row.email,
      role: row.consumer_seen_at && row.salesperson_seen_at
        ? "both"
        : row.salesperson_seen_at
          ? "salesperson"
          : "consumer",
      lastRole: row.last_role,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
    } satisfies AccountIdentity));
  }
  marketingEnabled(userId: string) {
    return this.sql.exec<{ user_id: string }>(`
      SELECT contacts.user_id
      FROM email_contacts AS contacts
      LEFT JOIN marketing_suppressions AS suppressions ON lower(suppressions.email) = lower(contacts.email)
      WHERE contacts.user_id = ? AND suppressions.email IS NULL
    `, userId).toArray().length > 0;
  }
  setMarketingOptIn(userId: string, email: string) {
    this.saveEmailContact(userId, email);
    this.sql.exec(`DELETE FROM marketing_suppressions WHERE lower(email) = lower(?)`, email);
    const now = isoNow();
    this.sql.exec(`INSERT OR IGNORE INTO marketing_preferences (user_id, email, opted_in_at, updated_at) VALUES (?, ?, ?, ?)`, userId, email, now, now);
    this.sql.exec(`UPDATE marketing_preferences SET email = ?, updated_at = ? WHERE user_id = ?`, email, now, userId);
  }
  marketingOptedIn(userId: string) {
    return this.marketingEnabled(userId);
  }
  suppressMarketingEmail(email: string) {
    this.sql.exec(`INSERT OR REPLACE INTO marketing_suppressions (email, suppressed_at) VALUES (?, ?)`, email, isoNow());
    this.sql.exec(`DELETE FROM marketing_preferences WHERE lower(email) = lower(?)`, email);
  }
  clearMarketingOptIn(userId: string, email: string) {
    this.saveEmailContact(userId, email);
    this.suppressMarketingEmail(email);
    this.sql.exec(`DELETE FROM marketing_preferences WHERE user_id = ?`, userId);
  }
  marketingActivity(userId: string, event: "scan_ready" | "checkout_started" | "purchase_completed") {
    const now = isoNow();
    this.sql.exec(`INSERT OR IGNORE INTO marketing_activity (user_id) VALUES (?)`, userId);
    const column = event === "scan_ready"
      ? "last_scan_at"
      : event === "checkout_started"
        ? "last_checkout_at"
        : "last_purchase_at";
    this.sql.exec(`UPDATE marketing_activity SET ${column} = ? WHERE user_id = ?`, now, userId);
  }
  marketingCandidates(now: number) {
    this.sql.exec(`DELETE FROM marketing_deliveries WHERE sent_at IS NOT NULL AND sent_at <= ?`, now - 60 * 60 * 24 * 400);
    return this.sql.exec<{
      user_id: string;
      email: string;
      last_scan_at: number | null;
      last_checkout_at: number | null;
      last_purchase_at: number | null;
      last_sent_at: number | null;
      pass_expires_at: number | null;
    }>(`
      SELECT
        preferences.user_id,
        preferences.email,
        activity.last_scan_at,
        activity.last_checkout_at,
        activity.last_purchase_at,
        MAX(deliveries.sent_at) AS last_sent_at,
        MAX(entitlements.expires_at) AS pass_expires_at
      FROM email_contacts AS preferences
      LEFT JOIN marketing_activity AS activity ON activity.user_id = preferences.user_id
      LEFT JOIN marketing_deliveries AS deliveries ON deliveries.user_id = preferences.user_id AND deliveries.sent_at IS NOT NULL
      LEFT JOIN entitlements ON entitlements.user_id = preferences.user_id AND entitlements.status = 'active'
      LEFT JOIN marketing_suppressions AS suppressions ON lower(suppressions.email) = lower(preferences.email)
      WHERE suppressions.email IS NULL
      GROUP BY preferences.user_id, preferences.email, activity.last_scan_at, activity.last_checkout_at, activity.last_purchase_at
      HAVING MAX(deliveries.sent_at) IS NULL OR MAX(deliveries.sent_at) <= ?
      ORDER BY COALESCE(MAX(deliveries.sent_at), 0) ASC
      LIMIT 500
    `, now - 60 * 60 * 24 * 3).toArray().map((row) => ({
      email: row.email,
      lastCheckoutAt: row.last_checkout_at,
      lastPurchaseAt: row.last_purchase_at,
      lastScanAt: row.last_scan_at,
      lastSentAt: row.last_sent_at,
      passExpiresAt: row.pass_expires_at,
      userId: row.user_id,
    }));
  }
  claimMarketingDelivery(userId: string, campaignKey: string) {
    this.sql.exec(`INSERT OR IGNORE INTO marketing_deliveries (user_id, campaign_key, claimed_at, sent_at) VALUES (?, ?, ?, NULL)`, userId, campaignKey, isoNow());
    return this.sql.exec<{ count: number }>(`SELECT changes() AS count`).toArray()[0]?.count === 1;
  }
  completeMarketingDelivery(userId: string, campaignKey: string) {
    const now = isoNow();
    this.sql.exec(`UPDATE marketing_deliveries SET sent_at = ? WHERE user_id = ? AND campaign_key = ? AND sent_at IS NULL`, now, userId, campaignKey);
  }
  releaseMarketingDelivery(userId: string, campaignKey: string) {
    this.sql.exec(`DELETE FROM marketing_deliveries WHERE user_id = ? AND campaign_key = ? AND sent_at IS NULL`, userId, campaignKey);
  }
  private newReferralCode() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
      if (!this.sql.exec(`SELECT referral_code FROM salesperson_profiles WHERE referral_code = ?`, candidate).toArray().length) return candidate;
    }
    throw new Error("referral_code_unavailable");
  }
  private salespersonRow(userId: string) {
    return this.sql.exec<{
      user_id: string;
      email: string;
      display_name: string;
      referral_code: string;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      subscription_status: string;
      earned_credits: number;
      created_at: number;
      updated_at: number;
    }>(`SELECT * FROM salesperson_profiles WHERE user_id = ?`, userId).toArray()[0];
  }
  private salespersonView(row: NonNullable<ReturnType<AccountStore["salespersonRow"]>>): SalespersonProfile {
    return {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      referralCode: row.referral_code,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      subscriptionStatus: row.subscription_status,
      earnedCredits: row.earned_credits,
      availableCredits: this.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM salesperson_credits WHERE owner_user_id = ? AND status = 'available'`, row.user_id).toArray()[0]?.count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  salesperson(input: { action: "ensure" | "get"; userId: string; email?: string; displayName?: string }) {
    const existing = this.salespersonRow(input.userId);
    if (existing) {
      if (input.action === "ensure" && input.email && input.displayName) {
        const email = input.email.trim().toLowerCase();
        const displayName = input.displayName.trim().slice(0, 80);
        if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email) && displayName.length >= 2) {
          this.sql.exec(`UPDATE salesperson_profiles SET email = ?, display_name = ?, updated_at = ? WHERE user_id = ?`, email, displayName, isoNow(), input.userId);
        }
      }
      return this.salespersonView(this.salespersonRow(input.userId)!);
    }
    if (input.action === "get") return null;
    const email = input.email?.trim().toLowerCase() ?? "";
    const displayName = input.displayName?.trim().slice(0, 80) ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email) || displayName.length < 2) return null;
    const now = isoNow();
    this.sql.exec(`INSERT INTO salesperson_profiles (user_id, email, display_name, referral_code, stripe_customer_id, stripe_subscription_id, subscription_status, earned_credits, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, 'not_started', 0, ?, ?)`, input.userId, email, displayName, this.newReferralCode(), now, now);
    return this.salespersonView(this.salespersonRow(input.userId)!);
  }
  salespersonSubscription(input: { action: "activate" | "status"; userId?: string; stripeCustomerId?: string; stripeSubscriptionId?: string; status?: string }) {
    const userId = input.userId ?? "";
    const customerId = input.stripeCustomerId ?? "";
    const subscriptionId = input.stripeSubscriptionId ?? "";
    const row = userId
      ? this.salespersonRow(userId)
      : this.sql.exec<{ user_id: string }>(`SELECT user_id FROM salesperson_profiles WHERE stripe_customer_id = ? OR stripe_subscription_id = ?`, customerId, subscriptionId).toArray()[0]
        ? this.salespersonRow(this.sql.exec<{ user_id: string }>(`SELECT user_id FROM salesperson_profiles WHERE stripe_customer_id = ? OR stripe_subscription_id = ?`, customerId, subscriptionId).toArray()[0].user_id)
        : undefined;
    if (!row) return null;
    const status = input.status?.trim() || (input.action === "activate" ? "active" : row.subscription_status);
    this.sql.exec(`UPDATE salesperson_profiles SET stripe_customer_id = COALESCE(NULLIF(?, ''), stripe_customer_id), stripe_subscription_id = COALESCE(NULLIF(?, ''), stripe_subscription_id), subscription_status = ?, updated_at = ? WHERE user_id = ?`, customerId, subscriptionId, status, isoNow(), row.user_id);
    return this.salespersonView(this.salespersonRow(row.user_id)!);
  }
  referralReward(input: { referralCode: string; stripeSessionId: string; customerUserId?: string | null; customerEmail?: string | null }) {
    const code = input.referralCode.trim().toUpperCase();
    const sessionId = input.stripeSessionId.trim();
    const existing = this.sql.exec<ReferralReward & { created_at: number; credited_at: number | null; referral_code: string; salesperson_user_id: string; customer_user_id: string | null; customer_email: string | null; stripe_session_id: string; }>(`SELECT * FROM referral_rewards WHERE stripe_session_id = ?`, sessionId).toArray()[0];
    if (existing) {
      const profile = this.salespersonRow(existing.salesperson_user_id);
      return profile ? { status: existing.status, rewardId: existing.id, salespersonUserId: profile.user_id } : { status: "ignored" };
    }
    const profile = this.sql.exec<{ user_id: string }>(`SELECT user_id FROM salesperson_profiles WHERE referral_code = ?`, code).toArray()[0];
    if (!profile) return { status: "unknown_referral" };
    const salesperson = this.salespersonRow(profile.user_id);
    if (!salesperson || salesperson.subscription_status === "canceled") return { status: "inactive_salesperson" };
    const customerUserId = input.customerUserId?.trim() || null;
    const customerEmail = input.customerEmail?.trim().toLowerCase() || null;
    if (customerUserId && customerUserId === salesperson.user_id) return { status: "self_referral" };
    if (customerEmail && customerEmail === salesperson.email.toLowerCase()) return { status: "self_referral" };
    const rewardId = crypto.randomUUID();
    this.sql.exec(`INSERT INTO referral_rewards (id, referral_code, salesperson_user_id, customer_user_id, customer_email, stripe_session_id, status, created_at, credited_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`, rewardId, code, salesperson.user_id, customerUserId, customerEmail, sessionId, isoNow());
    return { status: "pending", rewardId, salespersonUserId: salesperson.user_id };
  }
  confirmReferralReward(rewardId: string) {
    const reward = this.sql.exec<{ id: string; salesperson_user_id: string; status: string }>(`SELECT id, salesperson_user_id, status FROM referral_rewards WHERE id = ?`, rewardId).toArray()[0];
    if (!reward) return { confirmed: false };
    if (reward.status === "credited") return { confirmed: true };
    if (reward.status !== "pending") return { confirmed: false };
    this.sql.exec(`UPDATE referral_rewards SET status = 'credited', credited_at = ? WHERE id = ? AND status = 'pending'`, isoNow(), rewardId);
    this.sql.exec(`INSERT OR IGNORE INTO salesperson_credits (id, source_reward_id, owner_user_id, amount_cents, status, created_at, redeemed_at) VALUES (?, ?, ?, 2000, 'available', ?, NULL)`, crypto.randomUUID(), rewardId, reward.salesperson_user_id, isoNow());
    this.sql.exec(`UPDATE salesperson_profiles SET earned_credits = earned_credits + 1, updated_at = ? WHERE user_id = ?`, isoNow(), reward.salesperson_user_id);
    return { confirmed: true };
  }
  private newGiftCode() {
    return `PPG-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
  }
  redeemSalespersonCredit(userId: string) {
    const profile = this.salespersonRow(userId);
    if (!profile?.stripe_customer_id || !profile.stripe_subscription_id) return { status: "billing_not_ready" };
    const credit = this.sql.exec<{ id: string }>(`SELECT id FROM salesperson_credits WHERE owner_user_id = ? AND status = 'available' ORDER BY created_at ASC LIMIT 1`, userId).toArray()[0];
    if (!credit) return { status: "no_credit" };
    this.sql.exec(`UPDATE salesperson_credits SET status = 'pending_redeem' WHERE id = ? AND status = 'available'`, credit.id);
    return { status: "pending", creditId: credit.id, stripeCustomerId: profile.stripe_customer_id, stripeSubscriptionId: profile.stripe_subscription_id };
  }
  confirmSalespersonCredit(creditId: string, success: boolean) {
    const status = success ? "redeemed" : "available";
    this.sql.exec(`UPDATE salesperson_credits SET status = ?, redeemed_at = ? WHERE id = ? AND status = 'pending_redeem'`, status, success ? isoNow() : null, creditId);
    return { confirmed: true };
  }
  giftSalespersonCredit(userId: string) {
    const credit = this.sql.exec<{ id: string }>(`SELECT id FROM salesperson_credits WHERE owner_user_id = ? AND status = 'available' ORDER BY created_at ASC LIMIT 1`, userId).toArray()[0];
    if (!credit) return { status: "no_credit" };
    const code = this.newGiftCode();
    this.sql.exec(`UPDATE salesperson_credits SET status = 'gifted' WHERE id = ? AND status = 'available'`, credit.id);
    this.sql.exec(`INSERT INTO salesperson_gifts (code, credit_id, from_user_id, claimed_by_user_id, status, created_at, claimed_at) VALUES (?, ?, ?, NULL, 'available', ?, NULL)`, code, credit.id, userId, isoNow());
    return { status: "created", code };
  }
  claimSalespersonGift(userId: string, code: string) {
    const gift = this.sql.exec<{ code: string; credit_id: string; from_user_id: string; status: string }>(`SELECT code, credit_id, from_user_id, status FROM salesperson_gifts WHERE code = ?`, code.toUpperCase()).toArray()[0];
    if (!gift) return { status: "gift_not_found" };
    if (gift.from_user_id === userId) return { status: "self_gift" };
    if (gift.status !== "available") return { status: "gift_unavailable" };
    const profile = this.salespersonRow(userId);
    if (!profile) return { status: "salesperson_profile_required" };
    this.sql.exec(`UPDATE salesperson_gifts SET claimed_by_user_id = ?, status = 'claimed', claimed_at = ? WHERE code = ? AND status = 'available'`, userId, isoNow(), gift.code);
    this.sql.exec(`UPDATE salesperson_credits SET owner_user_id = ?, status = 'available' WHERE id = ? AND status = 'gifted'`, userId, gift.credit_id);
    return { status: "claimed" };
  }
  deleteUser(userId: string) { this.sql.exec(`DELETE FROM audits WHERE owner_id = ?`, `user:${userId}`); this.sql.exec(`DELETE FROM entitlements WHERE user_id = ?`, userId); this.sql.exec(`DELETE FROM marketing_preferences WHERE user_id = ?`, userId); this.sql.exec(`DELETE FROM email_contacts WHERE user_id = ?`, userId); this.sql.exec(`DELETE FROM marketing_activity WHERE user_id = ?`, userId); this.sql.exec(`DELETE FROM marketing_deliveries WHERE user_id = ?`, userId); this.sql.exec(`DELETE FROM account_identity_contexts WHERE user_id = ?`, userId); this.sql.exec(`UPDATE referral_rewards SET customer_user_id = NULL, customer_email = NULL WHERE customer_user_id = ?`, userId); this.sql.exec(`DELETE FROM referral_rewards WHERE salesperson_user_id = ?`, userId); this.sql.exec(`DELETE FROM salesperson_profiles WHERE user_id = ?`, userId); this.sql.exec(`DELETE FROM users WHERE id = ?`, userId); }
  async fetch(request: Request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const path = new URL(request.url).pathname;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (path === "/user") {
      if (typeof body.providerSubject !== "string") return json({ error: "invalid_subject" }, 400);
      return json({ user: this.user(body.providerSubject) });
    }
    if (path === "/email-contact") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!/^[A-Za-z0-9_:-]{8,200}$/.test(userId) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email) || email.length > 254) return json({ error: "invalid_email_contact" }, 400);
      this.saveEmailContact(userId, email);
      return json({ stored: true });
    }
    if (path === "/account-identity") {
      if (body.action === "list") return json({ accounts: this.accountIdentities() });
      const userId = typeof body.userId === "string" ? body.userId : "";
      if (!/^[A-Za-z0-9_:-]{8,200}$/.test(userId)) return json({ error: "invalid_account_identity" }, 400);
      const role = body.role === "salesperson" ? "salesperson" : body.role === "consumer" ? "consumer" : null;
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
      if (!role || (email !== null && (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email) || email.length > 254))) return json({ error: "invalid_account_identity" }, 400);
      return json({ stored: this.saveAccountIdentity(userId, email, role) });
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
      if (!/^[A-Za-z0-9_:-]{8,200}$/.test(userId)) return json({ error: "invalid_marketing_preference" }, 400);
      if (body.action === "status") return json({ optedIn: this.marketingOptedIn(userId) });
      if (body.optIn === false) {
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email) || email.length > 254) return json({ error: "invalid_marketing_preference" }, 400);
        this.clearMarketingOptIn(userId, email);
        return json({ optedIn: false });
      }
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (body.optIn !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email) || email.length > 254) return json({ error: "invalid_marketing_preference" }, 400);
      this.setMarketingOptIn(userId, email); return json({ optedIn: true });
    }
    if (path === "/marketing-unsubscribe") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email) || email.length > 254) return json({ error: "invalid_unsubscribe" }, 400);
      this.suppressMarketingEmail(email);
      return json({ unsubscribed: true });
    }
    if (path === "/marketing-activity") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      const event = body.event;
      if (!/^[A-Za-z0-9_:-]{8,200}$/.test(userId) || (event !== "scan_ready" && event !== "checkout_started" && event !== "purchase_completed")) return json({ error: "invalid_marketing_activity" }, 400);
      this.marketingActivity(userId, event); return json({ recorded: true });
    }
    if (path === "/marketing-candidates") {
      const now = typeof body.now === "number" && Number.isFinite(body.now) ? Math.floor(body.now) : isoNow();
      return json({ candidates: this.marketingCandidates(now) });
    }
    if (path === "/marketing-delivery") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      const campaignKey = typeof body.campaignKey === "string" ? body.campaignKey : "";
      const action = body.action;
      if (!/^[A-Za-z0-9_:-]{8,200}$/.test(userId) || !/^[A-Za-z0-9_:-]{1,100}$/.test(campaignKey)) return json({ error: "invalid_marketing_delivery" }, 400);
      if (action === "claim") return json({ claimed: this.claimMarketingDelivery(userId, campaignKey) });
      if (action === "complete") { this.completeMarketingDelivery(userId, campaignKey); return json({ completed: true }); }
      if (action === "release") { this.releaseMarketingDelivery(userId, campaignKey); return json({ released: true }); }
      return json({ error: "invalid_marketing_delivery_action" }, 400);
    }
    if (path === "/salesperson") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      if (!/^[A-Za-z0-9_:-]{8,200}$/.test(userId) || (body.action !== "get" && body.action !== "ensure")) return json({ error: "invalid_salesperson_profile" }, 400);
      const profile = this.salesperson({ action: body.action, userId, email: typeof body.email === "string" ? body.email : undefined, displayName: typeof body.displayName === "string" ? body.displayName : undefined });
      return profile ? json({ profile }) : json({ error: "salesperson_profile_unavailable" }, 503);
    }
    if (path === "/salesperson-subscription") {
      const profile = this.salespersonSubscription({
        action: body.action === "activate" ? "activate" : "status",
        userId: typeof body.userId === "string" ? body.userId : undefined,
        stripeCustomerId: typeof body.stripeCustomerId === "string" ? body.stripeCustomerId : undefined,
        stripeSubscriptionId: typeof body.stripeSubscriptionId === "string" ? body.stripeSubscriptionId : undefined,
        status: typeof body.status === "string" ? body.status : undefined,
      });
      return profile ? json({ profile }) : json({ error: "salesperson_profile_not_found" }, 404);
    }
    if (path === "/salesperson-credit") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      if (!/^[A-Za-z0-9_:-]{8,200}$/.test(userId)) return json({ error: "invalid_salesperson_credit" }, 400);
      if (body.action === "redeem") return json(this.redeemSalespersonCredit(userId));
      if (body.action === "gift") return json(this.giftSalespersonCredit(userId));
      if (body.action === "confirm") return json(this.confirmSalespersonCredit(typeof body.creditId === "string" ? body.creditId : "", body.success === true));
      return json({ error: "invalid_salesperson_credit_action" }, 400);
    }
    if (path === "/salesperson-gift-claim") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      const code = typeof body.code === "string" ? body.code : "";
      if (!/^[A-Za-z0-9_:-]{8,200}$/.test(userId) || !/^PPG-[A-Z0-9]{16}$/.test(code.toUpperCase())) return json({ error: "invalid_salesperson_gift" }, 400);
      return json(this.claimSalespersonGift(userId, code));
    }
    if (path === "/referral-reward") {
      const referralCode = typeof body.referralCode === "string" ? body.referralCode : "";
      const stripeSessionId = typeof body.stripeSessionId === "string" ? body.stripeSessionId : "";
      if (!/^[A-Z0-9]{8,32}$/i.test(referralCode) || !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(stripeSessionId)) return json({ error: "invalid_referral_reward" }, 400);
      return json(this.referralReward({ referralCode, stripeSessionId, customerUserId: typeof body.customerUserId === "string" ? body.customerUserId : null, customerEmail: typeof body.customerEmail === "string" ? body.customerEmail : null }));
    }
    if (path === "/referral-reward-confirm") {
      const rewardId = typeof body.rewardId === "string" ? body.rewardId : "";
      if (!/^[0-9a-f-]{36}$/i.test(rewardId)) return json({ error: "invalid_referral_reward" }, 400);
      return json(this.confirmReferralReward(rewardId));
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
export const accountRoleCookie = async (role: AccountRole, secret: string) => `pp_role=${await createAccountRoleSession(role, secret)}; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`;
export const clearAccountCookie = "pp_user=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax";
export const clearAccountRoleCookie = "pp_role=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax";
export const accountOwner = owner;
