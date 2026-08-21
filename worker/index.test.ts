import assert from "node:assert/strict";
import test from "node:test";
import {
  createAccessToken,
  handleRequest,
  marketingCampaignSlot,
  normalizeImportedVehicle,
  OrderStore,
  resolveAccountSessionRole,
  salespersonEmailContent,
  type Env,
  verifyAccessToken,
  verifyStripeSignature,
} from "./index.ts";
import { createAccountRoleSession, createUserSession, verifyAccountRoleSession } from "./accounts.ts";

const originalFetch = globalThis.fetch;
const TEST_DEVICE_ID = "A".repeat(43);
const TEST_WEBHOOK_SECRET = "whsec_TestWebhookSecret123";

test("marketing campaigns use separate salesperson slots and promotion copy", () => {
  const monday = marketingCampaignSlot(Date.UTC(2026, 7, 17, 17, 0, 0));
  const friday = marketingCampaignSlot(Date.UTC(2026, 7, 21, 17, 0, 0));
  const thursday = marketingCampaignSlot(Date.UTC(2026, 7, 20, 17, 0, 0));
  assert.deepEqual(monday, { kind: "educational", campaignKey: "2026-08-17:educational" });
  assert.deepEqual(friday, { kind: "promotional", campaignKey: "2026-08-21:promotional" });
  assert.equal(thursday, null);

  const content = salespersonEmailContent(Math.floor(Date.UTC(2026, 7, 21, 17, 0, 0) / 1000), "promotional");
  assert.match(content.subject, /ALPHA1/);
  assert.match(Array.isArray(content.text) ? content.text.join("\n") : content.text, /first month to \$1/);
  assert.match(content.html, /ALPHA1/);
});

class MemoryStorage {
  private readonly values = new Map<string, unknown>();

  async deleteAll() {
    this.values.clear();
  }

  async get<T>(key: string) {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T) {
    this.values.set(key, value);
  }

  async setAlarm(_scheduledTime: number) {}
}

const makeOrderNamespace = (getEnv: () => Env): Env["ORDERS"] => {
  const stores = new Map<string, OrderStore>();
  return {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: async (request: Request) => {
        const name = String(id);
        let store = stores.get(name);
        if (!store) {
          store = new OrderStore(
            { storage: new MemoryStorage() },
            getEnv(),
          );
          stores.set(name, store);
        }
        return store.fetch(request);
      },
    }),
  };
};

const makePhoneSessionNamespace = (): Env["PHONE_SESSIONS"] => ({
  idFromName: (name: string) => name,
  get: () => ({
    fetch: async () => Response.json({ created: true }),
  }),
});

const makeAccountNamespace = (subscriptionStatus: string | null): Env["ACCOUNTS"] => ({
  idFromName: (name: string) => name,
  get: () => ({
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path === "/session-bootstrap") return Response.json({
        user: { id: "account-session-user" },
        role: subscriptionStatus ? "salesperson" : "consumer",
        expiresAt: subscriptionStatus === "active" ? Math.floor(Date.now() / 1000) + 86400 : null,
      });
      if (path === "/access-summary") return Response.json({
        expiresAt: subscriptionStatus === "active" ? Math.floor(Date.now() / 1000) + 86400 : null,
      });
      if (path === "/account-summary") return Response.json({
        expiresAt: subscriptionStatus === "active" ? Math.floor(Date.now() / 1000) + 86400 : null,
        audits: [],
        marketingOptedIn: false,
        identity: { email: "user@example.com" },
        salespersonProfile: subscriptionStatus ? { subscriptionStatus } : null,
      });
      if (path === "/access") return Response.json({ expiresAt: null });
      if (path === "/salesperson") {
        return Response.json(subscriptionStatus
          ? { profile: { subscriptionStatus } }
          : { profile: null });
      }
      if (path === "/audits") return Response.json({ id: "11111111-1111-4111-8111-111111111111" });
      return Response.json({});
    },
  }),
});

const makeEnv = (): Env => {
  const env = {
    ACCESS_MAX_AGE_SECONDS: "2592000",
    ASSETS: {
      fetch: async () => new Response("asset", { status: 200 }),
    },
    ORDERS: undefined,
    PHONE_SESSIONS: makePhoneSessionNamespace(),
    PUBLIC_SITE_ORIGIN: "https://pencilproof.com",
    SESSION_SECRET: "test-session-secret-with-enough-entropy",
    SITE_ORIGIN: "https://audit.pencilproof.com",
    STRIPE_PRICE_ID: "price_123TestValid",
    STRIPE_SECRET_KEY: "rk_test_123TestValid",
    STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
  } as unknown as Env;
  env.ORDERS = makeOrderNamespace(() => env);
  return env;
};

const sha256Hex = async (value: string) => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const signWebhook = async (
  payload: string,
  timestamp = Math.floor(Date.now() / 1000),
) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TEST_WEBHOOK_SECRET),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${payload}`),
    ),
  );
  const hex = Array.from(
    signature,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return `t=${timestamp},v1=${hex}`;
};

test("account role sessions preserve the sign-in entry context", async () => {
  const secret = "role-session-test-secret";
  const salesperson = await createAccountRoleSession("salesperson", secret);
  const consumer = await createAccountRoleSession("consumer", secret);
  assert.equal(await verifyAccountRoleSession(salesperson, secret), "salesperson");
  assert.equal(await verifyAccountRoleSession(consumer, secret), "consumer");
  assert.equal(await verifyAccountRoleSession(`${salesperson}tampered`, secret), null);
});

test("account session role resolution keeps consumer entry sessions separate", () => {
  assert.equal(resolveAccountSessionRole({ requestedRole: "consumer", hasSalespersonProfile: true, knownConsumer: true, hasPriorIdentity: true }), "consumer");
  assert.equal(resolveAccountSessionRole({ requestedRole: "salesperson", hasSalespersonProfile: true, knownConsumer: true, hasPriorIdentity: true }), "salesperson");
  assert.equal(resolveAccountSessionRole({ requestedRole: "salesperson", hasSalespersonProfile: false, knownConsumer: true, hasPriorIdentity: true }), "consumer");
  assert.equal(resolveAccountSessionRole({ requestedRole: "salesperson", hasSalespersonProfile: false, knownConsumer: false, hasPriorIdentity: false }), "salesperson");
});

test("account CORS preflight allows the authorization header used by account loading", async () => {
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/account/me", {
      method: "OPTIONS",
      headers: {
        Origin: "https://pencilproof.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    }),
    makeEnv(),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://pencilproof.com");
  assert.match(response.headers.get("Access-Control-Allow-Headers") ?? "", /Authorization/i);
});

test("active salesperson subscriptions unlock unlimited protected audits", async () => {
  const env = makeEnv();
  env.ACCOUNTS = makeAccountNamespace("active");
  const session = await createUserSession("salesperson-user", env.SESSION_SECRET);
  const headers = { Cookie: `pp_user=${session}` };

  const audit = await handleRequest(
    new Request("https://audit.pencilproof.com/api/audits", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ data: { vehicle: "2025 Honda Accord" } }),
    }),
    env,
  );
  assert.equal(audit.status, 200);

  const securePage = await handleRequest(
    new Request("https://audit.pencilproof.com/analyze/secure/", { headers }),
    env,
  );
  assert.equal(securePage.status, 200);

  for (const status of ["past_due", "canceled"]) {
    env.ACCOUNTS = makeAccountNamespace(status);
    const blocked = await handleRequest(
    new Request("https://audit.pencilproof.com/analyze/secure/", { headers }),
    env,
    );
    assert.equal(blocked.status, 303);
    assert.equal(blocked.headers.get("Location"), "https://pencilproof.com/analyze");
  }
});

test("account sign-out clears the PencilProof identity and paid-access cookies", async () => {
  const env = makeEnv();
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/account/logout", {
      method: "POST",
      headers: { Origin: env.PUBLIC_SITE_ORIGIN },
    }),
    env,
  );
  assert.equal(response.status, 204);
  const setCookie = response.headers.get("Set-Cookie") ?? "";
  assert.match(setCookie, /pp_user=; Max-Age=0/);
  assert.match(setCookie, /pp_role=; Max-Age=0/);
  assert.match(setCookie, /pp_access=; Max-Age=0/);
  assert.match(setCookie, /Domain=audit\.pencilproof\.com/);
  assert.match(setCookie, /Domain=\.pencilproof\.com/);
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
});

test("salesperson audit history allows the public dashboard origin to read it", async () => {
  const env = makeEnv();
  env.ACCOUNTS = makeAccountNamespace("active");
  const session = await createUserSession("salesperson-user", env.SESSION_SECRET);
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/account/me", {
      headers: {
        Cookie: `pp_user=${session}`,
        Origin: env.PUBLIC_SITE_ORIGIN,
      },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), env.PUBLIC_SITE_ORIGIN);
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
});

test("account summary consolidates account page reads into one Durable Object request", async () => {
  const env = makeEnv();
  const paths: string[] = [];
  env.ACCOUNTS = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (request: Request) => {
        paths.push(new URL(request.url).pathname);
        return Response.json({
          expiresAt: null,
          audits: [],
          marketingOptedIn: false,
          identity: { email: "user@example.com" },
          salespersonProfile: null,
        });
      },
    }),
  };
  const session = await createUserSession("account-summary-user", env.SESSION_SECRET);
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/account/me", {
      headers: { Cookie: `pp_user=${session}` },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(paths, ["/account-summary"]);
});

test("saved audit deletion returns the public dashboard CORS headers", async () => {
  const env = makeEnv();
  const session = await createUserSession("salesperson-user", env.SESSION_SECRET);
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/account/audits", {
      method: "DELETE",
      headers: {
        Cookie: `pp_user=${session}`,
        Origin: env.PUBLIC_SITE_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }),
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), env.PUBLIC_SITE_ORIGIN);
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
});

test("salesperson checkout allows the public dashboard CORS preflight", async () => {
  const env = makeEnv();
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/salesperson/checkout", {
      method: "OPTIONS",
      headers: { Origin: env.PUBLIC_SITE_ORIGIN },
    }),
    env,
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), env.PUBLIC_SITE_ORIGIN);
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
  assert.match(response.headers.get("Access-Control-Allow-Methods") ?? "", /POST/);
});

test("salesperson checkout keeps public-origin errors readable by the dashboard", async () => {
  const env = makeEnv();
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/salesperson/checkout", {
      method: "POST",
      headers: {
        Origin: env.PUBLIC_SITE_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "sales@example.com", displayName: "Hannah" }),
    }),
    env,
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), env.PUBLIC_SITE_ORIGIN);
  assert.deepEqual(await response.json(), { error: "account_required" });
});

test("salesperson checkout applies only the configured salesperson promotion", async () => {
  const env = makeEnv();
  env.ACCOUNTS = makeAccountNamespace("not_started");
  env.STRIPE_SALESPERSON_PRICE_ID = "price_salespersonTest";
  env.STRIPE_SALESPERSON_PROMOTION_CODE_ID = "promo_salespersonTest";
  const session = await createUserSession("salesperson-checkout-user", env.SESSION_SECRET);
  const requests: string[] = [];
  let checkoutBody = "";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname === "/v1/promotion_codes/promo_salespersonTest") {
      return Response.json({ active: true, max_redemptions: 100, times_redeemed: 1 });
    }
    if (url.pathname === "/v1/checkout/sessions") {
      checkoutBody = String(init?.body ?? "");
      return Response.json({ id: "cs_salesperson", url: "https://checkout.stripe.com/c/pay/cs_salesperson" });
    }
    return Response.json({});
  };
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/salesperson/checkout", {
      method: "POST",
      headers: { Cookie: `pp_user=${session}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "sales@example.com", displayName: "Hannah" }),
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(requests, ["/v1/promotion_codes/promo_salespersonTest", "/v1/checkout/sessions"]);
  const parameters = new URLSearchParams(checkoutBody);
  assert.equal(parameters.get("discounts[0][promotion_code]"), "promo_salespersonTest");
  assert.equal(parameters.get("allow_promotion_codes"), null);
});

test("salesperson checkout falls back to full price after the configured promotion limit", async () => {
  const env = makeEnv();
  env.ACCOUNTS = makeAccountNamespace("not_started");
  env.STRIPE_SALESPERSON_PRICE_ID = "price_salespersonTest";
  env.STRIPE_SALESPERSON_PROMOTION_CODE_ID = "promo_salespersonTest";
  const session = await createUserSession("salesperson-limit-user", env.SESSION_SECRET);
  let checkoutBody = "";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/promotion_codes/promo_salespersonTest") {
      return Response.json({ active: true, max_redemptions: 100, times_redeemed: 100 });
    }
    if (url.pathname === "/v1/checkout/sessions") {
      checkoutBody = String(init?.body ?? "");
      return Response.json({ id: "cs_salesperson", url: "https://checkout.stripe.com/c/pay/cs_salesperson" });
    }
    return Response.json({});
  };
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/salesperson/checkout", {
      method: "POST",
      headers: { Cookie: `pp_user=${session}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "sales@example.com", displayName: "Hannah" }),
    }),
    env,
  );
  assert.equal(response.status, 200);
  const parameters = new URLSearchParams(checkoutBody);
  assert.equal(parameters.get("discounts[0][promotion_code]"), null);
  assert.equal(parameters.get("allow_promotion_codes"), null);
  assert.equal(parameters.get("line_items[0][price]"), "price_salespersonTest");
});

test("a signed consumer role keeps salesperson tools separate", async () => {
  const env = makeEnv();
  env.ACCOUNTS = makeAccountNamespace("active");
  const userSession = await createUserSession("salesperson-user", env.SESSION_SECRET);
  const consumerRole = await createAccountRoleSession("consumer", env.SESSION_SECRET);
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/account/me", {
      headers: { Cookie: `pp_user=${userSession}; pp_role=${consumerRole}` },
    }),
    env,
  );
  assert.equal(response.status, 200);
  const data = await response.json() as { role?: string };
  assert.equal(data.role, "consumer");

  const salespersonApi = await handleRequest(
    new Request("https://audit.pencilproof.com/api/salesperson/me", {
      headers: { Cookie: `pp_user=${userSession}; pp_role=${consumerRole}` },
    }),
    env,
  );
  assert.equal(salespersonApi.status, 403);
  assert.deepEqual(await salespersonApi.json(), { error: "salesperson_role_required" });
});

const paidSession = (
  deviceHash: string,
  sessionId = "cs_test_paid",
) => ({
  amount_subtotal: 3900,
  amount_total: 4235,
  currency: "usd",
  id: sessionId,
  managed_payments: { enabled: true },
  metadata: {
    pencilproof_device_hash: deviceHash,
    pencilproof_product: "full_quote_audit_v1",
  },
  mode: "payment",
  payment_status: "paid",
  status: "complete",
  total_details: {
    amount_discount: 0,
    amount_shipping: 0,
    amount_tax: 335,
  },
});

test("phone camera sessions are short-lived and origin restricted", async () => {
  const env = makeEnv();
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/phone-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: env.PUBLIC_SITE_ORIGIN,
      },
      body: "{}",
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), env.PUBLIC_SITE_ORIGIN);
  const payload = await response.json() as { phoneUrl?: string; sessionId?: string; token?: string; expiresAt?: number };
  assert.match(payload.sessionId ?? "", /^[A-Za-z0-9_-]{32}$/);
  assert.match(payload.token ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.match(payload.phoneUrl ?? "", /^https:\/\/audit\.pencilproof\.com\/phone\?/);
  assert.ok((payload.expiresAt ?? 0) > Date.now());

  const forbidden = await handleRequest(
    new Request("https://audit.pencilproof.com/api/phone-session", {
      method: "POST",
      headers: { Origin: "https://example.com" },
    }),
    env,
  );
  assert.equal(forbidden.status, 403);
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("AI import reports a stable Gemini quota diagnostic", async () => {
  const env = makeEnv();
  env.GEMINI_API_KEY = "test-gemini-key";
  let generateCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v1beta/models")) {
      return Response.json({ models: [] });
    }
    generateCalls += 1;
    return Response.json(
      { error: { status: "RESOURCE_EXHAUSTED", message: "quota exceeded" } },
      { status: 429 },
    );
  };

  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/ai-import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://pencilproof.com",
      },
      body: JSON.stringify({ base64: "aGVsbG8=", mimeType: "image/jpeg" }),
    }),
    env,
  );
  const result = await response.json() as {
    error: string;
    providerCode: string;
    providerHttpStatus: number;
  };

  assert.equal(response.status, 502);
  assert.equal(result.error, "AI_IMPORT_PROVIDER_ERROR");
  assert.equal(result.providerCode, "QUOTA");
  assert.equal(result.providerHttpStatus, 429);
  assert.equal(generateCalls, 3);
});

test("AI import preserves vehicle identity when Gemini returns a structured identity", () => {
  assert.equal(
    normalizeImportedVehicle({ year: 2024, make: "Cadillac", model: "CT5-V", trim: "Blackwing" }),
    "2024 Cadillac CT5-V Blackwing",
  );
  assert.equal(
    normalizeImportedVehicle({ description: "2017 Toyota Tundra CrewMax TRD Pro" }),
    "2017 Toyota Tundra CrewMax TRD Pro",
  );
  assert.equal(normalizeImportedVehicle({ year: 2024, make: "Cadillac" }), "2024 Cadillac");
});

test("access tokens are signed and expire", async () => {
  const token = await createAccessToken(
    "cs_test_paid",
    "a".repeat(64),
    "secret",
    60,
    1_000,
  );
  assert.deepEqual(
    await verifyAccessToken(token, "secret", 1_030),
    { did: "a".repeat(64), exp: 1_060, sid: "cs_test_paid" },
  );
  assert.equal(await verifyAccessToken(token, "wrong", 1_030), null);
  assert.equal(await verifyAccessToken(token, "secret", 1_061), null);
});

test("the audit host sends an unauthenticated analyze visitor to the free scan", async () => {
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/analyze/?source=direct"),
    makeEnv(),
  );
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("Location"),
    "https://pencilproof.com/analyze?source=direct",
  );
});

test("secure access degrades to a normal redirect when account storage is unavailable", async () => {
  const env = makeEnv();
  env.ACCOUNTS = {
    idFromName: () => "account-store",
    get: () => ({
      fetch: async () => { throw new Error("Exceeded allowed volume of requests in Durable Objects free tier."); },
    }),
  } as unknown as Env["ACCOUNTS"];
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/analyze/secure/"),
    env,
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "https://pencilproof.com/analyze");
});

test("account summary reports a retryable service error when storage is unavailable", async () => {
  const env = makeEnv();
  env.ACCOUNTS = {
    idFromName: () => "account-store",
    get: () => ({
      fetch: async () => { throw new Error("Exceeded allowed volume of requests in Durable Objects free tier."); },
    }),
  } as unknown as Env["ACCOUNTS"];
  const session = await createUserSession("account-summary-user", env.SESSION_SECRET);
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/account/me", {
      headers: { Cookie: `pp_user=${session}` },
    }),
    env,
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "account_unavailable" });
});

test("analyze static chunks do not consume account access lookups", async () => {
  const env = makeEnv();
  env.ACCOUNTS = {
    idFromName: () => "account-store",
    get: () => ({
      fetch: async () => { throw new Error("The account namespace should not be called for static chunks."); },
    }),
  } as unknown as Env["ACCOUNTS"];
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/_next/static/chunks/app/analyze/page.js"),
    env,
  );
  assert.equal(response.status, 200);
});

test("the audit host redirects public information pages and marks service pages noindex", async () => {
  const pricingResponse = await handleRequest(
    new Request("https://audit.pencilproof.com/pricing?source=direct"),
    makeEnv(),
  );
  assert.equal(pricingResponse.status, 303);
  assert.equal(
    pricingResponse.headers.get("Location"),
    "https://pencilproof.com/pricing?source=direct",
  );
  assert.equal(
    pricingResponse.headers.get("X-Robots-Tag"),
    "noindex, nofollow, noarchive",
  );

  const accountResponse = await handleRequest(
    new Request("https://audit.pencilproof.com/account/"),
    makeEnv(),
  );
  assert.equal(accountResponse.status, 303);
  assert.equal(accountResponse.headers.get("Location"), "https://pencilproof.com/account");
  assert.equal(
    accountResponse.headers.get("X-Robots-Tag"),
    "noindex, nofollow, noarchive",
  );

  const robotsResponse = await handleRequest(
    new Request("https://audit.pencilproof.com/robots.txt"),
    makeEnv(),
  );
  assert.equal(robotsResponse.status, 200);
  assert.match(await robotsResponse.text(), /Disallow: \//);
  assert.equal(robotsResponse.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");

  const sitemapResponse = await handleRequest(
    new Request("https://audit.pencilproof.com/sitemap.xml"),
    makeEnv(),
  );
  assert.equal(sitemapResponse.status, 303);
  assert.equal(sitemapResponse.headers.get("Location"), "https://pencilproof.com/sitemap.xml");
});

test("the handoff page keeps quote data in browser storage", async () => {
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/handoff"),
    makeEnv(),
  );
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /sessionStorage\.setItem/);
  assert.match(body, /pencilproof:pending-import/);
  assert.match(body, /pencilproof:quote-handoff:v1/);
  assert.match(body, /const handoff = window\.name/);
  assert.match(body, /window\.name = ""/);
  assert.doesNotMatch(body, /window\.location\.hash/);
  assert.match(body, /Reference:/);
  assert.match(body, /payload\.code/);
  assert.match(body, /\/api\/checkout/);
  assert.match(body, /#061126/);
  assert.match(body, /#f6c343/i);
  assert.match(body, /pencilproof-profile-mark\.png/);
  assert.match(body, /favicon\.svg/);
  assert.doesNotMatch(body, /#f5f4ee/);
  assert.doesNotMatch(body, /#58d68d/);
  assert.doesNotMatch(body, /sk_test_not_a_real_key/);
});

test("the temporary Stripe price recovery endpoint is removed", async () => {
  let stripeCalled = false;
  globalThis.fetch = async () => {
    stripeCalled = true;
    return Response.json({});
  };

  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/recover-price", {
      method: "POST",
      headers: { Origin: "https://audit.pencilproof.com" },
    }),
    makeEnv(),
  );

  assert.equal(response.status, 404);
  assert.equal(stripeCalled, false);
});

test("checkout uses the configured Stripe price", async () => {
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body ?? "");
    return Response.json({
      id: "cs_test_created",
      url: "https://checkout.stripe.com/c/pay/cs_test_created",
    });
  };

  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/checkout", {
      method: "POST",
      headers: { Origin: "https://audit.pencilproof.com" },
    }),
    makeEnv(),
  );
  const result = await response.json() as { url: string };
  const parameters = new URLSearchParams(requestBody);

  assert.equal(response.status, 200);
  assert.equal(
    parameters.get("line_items[0][price]"),
    "price_123TestValid",
  );
  assert.equal(parameters.get("line_items[0][price_data][unit_amount]"), null);
  assert.equal(parameters.get("managed_payments[enabled]"), "true");
  assert.equal(parameters.get("adaptive_pricing[enabled]"), null);
  assert.equal(parameters.get("allow_promotion_codes"), "true");
  assert.equal(parameters.get("billing_address_collection"), null);
  assert.equal(parameters.get("customer_creation"), null);
  assert.equal(parameters.get("payment_intent_data[description]"), null);
  assert.equal(
    parameters.get("payment_intent_data[metadata][pencilproof_product]"),
    null,
  );
  assert.equal(
    parameters.get("metadata[pencilproof_product]"),
    "full_quote_audit_v1",
  );
  assert.match(
    parameters.get("metadata[pencilproof_device_hash]") ?? "",
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    parameters.get("success_url"),
    "https://audit.pencilproof.com/success?session_id={CHECKOUT_SESSION_ID}",
  );
  assert.equal(result.url, "https://checkout.stripe.com/c/pay/cs_test_created");
  assert.match(response.headers.get("Set-Cookie") ?? "", /^pp_device=/);
  assert.match(response.headers.get("Set-Cookie") ?? "", /HttpOnly/);
});

test("checkout configures one Stripe webhook without exposing its secret", async () => {
  const env = makeEnv();
  delete env.STRIPE_WEBHOOK_SECRET;
  const stripePaths: string[] = [];
  let webhookRequestBody = "";

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    stripePaths.push(url.pathname);
    if (url.pathname === "/v1/webhook_endpoints") {
      webhookRequestBody = String(init?.body ?? "");
      return Response.json({
        id: "we_TestEndpoint123",
        secret: "whsec_AutomaticallyStored123",
        url: "https://audit.pencilproof.com/api/stripe/webhook",
      });
    }
    if (url.pathname === "/v1/events") {
      return Response.json({ data: [], has_more: false });
    }
    return Response.json({
      id: "cs_test_created",
      url: "https://checkout.stripe.com/c/pay/cs_test_created",
    });
  };

  const checkoutResponse = await handleRequest(
    new Request("https://audit.pencilproof.com/api/checkout", {
      method: "POST",
      headers: { Origin: "https://audit.pencilproof.com" },
    }),
    env,
  );
  assert.equal(checkoutResponse.status, 200);
  assert.deepEqual(stripePaths, [
    "/v1/webhook_endpoints",
    "/v1/events",
    "/v1/checkout/sessions",
  ]);

  const webhookParameters = new URLSearchParams(webhookRequestBody);
  assert.equal(
    webhookParameters.get("url"),
    "https://audit.pencilproof.com/api/stripe/webhook",
  );
  assert.equal(webhookParameters.get("allow_promotion_codes"), null);
  assert.deepEqual(
    webhookParameters.getAll("enabled_events[]"),
    [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "invoice.paid",
      "invoice.payment_failed",
      "customer.subscription.deleted",
      "refund.created",
      "charge.refunded",
      "charge.dispute.created",
    ],
  );

  const statusResponse = await handleRequest(
    new Request(
      "https://audit.pencilproof.com/api/stripe/webhook/status",
    ),
    env,
  );
  const statusBody = await statusResponse.json() as Record<string, unknown>;
  assert.deepEqual(statusBody, { ready: true });
  assert.equal("secret" in statusBody, false);

  stripePaths.length = 0;
  await handleRequest(
    new Request("https://audit.pencilproof.com/api/checkout", {
      method: "POST",
      headers: { Origin: "https://audit.pencilproof.com" },
    }),
    env,
  );
  assert.deepEqual(stripePaths, ["/v1/checkout/sessions"]);
});

test("an existing webhook endpoint is upgraded with revocation events", async () => {
  const storage = new MemoryStorage();
  await storage.put("webhookConfig", {
    createdAt: 1_000,
    endpointId: "we_ExistingEndpoint123",
    secret: "whsec_ExistingSecret123",
    url: "https://audit.pencilproof.com/api/stripe/webhook",
  });
  const env = makeEnv();
  let updateBody = "";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/events") {
      return Response.json({ data: [], has_more: false });
    }
    assert.equal(url.pathname, "/v1/webhook_endpoints/we_ExistingEndpoint123");
    updateBody = String(init?.body ?? "");
    return Response.json({
      id: "we_ExistingEndpoint123",
      url: "https://audit.pencilproof.com/api/stripe/webhook",
    });
  };

  const store = new OrderStore({ storage }, env);
  const response = await store.fetch(
    new Request("https://order-store.internal/webhook/ensure", {
      body: JSON.stringify({
        url: "https://audit.pencilproof.com/api/stripe/webhook",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    new URLSearchParams(updateBody).getAll("enabled_events[]"),
    [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "invoice.paid",
      "invoice.payment_failed",
      "customer.subscription.deleted",
      "refund.created",
      "charge.refunded",
      "charge.dispute.created",
    ],
  );
});

test("checkout continues when webhook reconciliation is unavailable", async () => {
  const env = makeEnv();
  delete env.STRIPE_WEBHOOK_SECRET;
  const stripePaths: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    stripePaths.push(url.pathname);
    if (url.pathname === "/v1/webhook_endpoints") {
      return Response.json({
        id: "we_TestEndpoint123",
        secret: "whsec_AutomaticallyStored123",
        url: "https://audit.pencilproof.com/api/stripe/webhook",
      });
    }
    if (url.pathname === "/v1/events") {
      return Response.json(
        { error: { message: "Permission denied" } },
        { status: 403 },
      );
    }
    return Response.json({
      id: "cs_test_created",
      url: "https://checkout.stripe.com/c/pay/cs_test_created",
    });
  };

  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/checkout", {
      method: "POST",
      headers: { Origin: "https://audit.pencilproof.com" },
    }),
    env,
  );
  const result = await response.json() as {
    code: string;
    error: string;
  };

  assert.equal(response.status, 200);
  assert.equal(result.code, undefined);
  assert.equal(result.error, undefined);
  assert.deepEqual(stripePaths, [
    "/v1/webhook_endpoints",
    "/v1/events",
    "/v1/checkout/sessions",
  ]);

  const statusResponse = await handleRequest(
    new Request("https://audit.pencilproof.com/api/stripe/webhook/status"),
    env,
  );
  assert.deepEqual(await statusResponse.json(), { ready: true });
});

test("checkout fails safely when the Stripe price binding is absent", async () => {
  let stripeCalled = false;
  globalThis.fetch = async () => {
    stripeCalled = true;
    return Response.json({});
  };

  const env = makeEnv();
  delete (env as Partial<Env>).STRIPE_PRICE_ID;
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/checkout", {
      method: "POST",
      headers: { Origin: "https://audit.pencilproof.com" },
    }),
    env,
  );
  const result = await response.json() as {
    code: string;
    error: string;
  };

  assert.equal(response.status, 502);
  assert.equal(result.code, "stripe_price_id_invalid");
  assert.equal(result.error, "Checkout is temporarily unavailable.");
  assert.equal(stripeCalled, false);
});

test("checkout safely identifies an invalid Stripe secret binding", async () => {
  const env = makeEnv();
  env.STRIPE_SECRET_KEY = "";

  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/checkout", {
      method: "POST",
      headers: { Origin: "https://audit.pencilproof.com" },
    }),
    env,
  );
  const result = await response.json() as {
    code: string;
    error: string;
  };

  assert.equal(response.status, 502);
  assert.equal(result.code, "stripe_secret_key_invalid");
  assert.equal(result.error, "Checkout is temporarily unavailable.");
});

test("checkout accepts a standard Stripe secret key binding", async () => {
  const env = makeEnv();
  env.STRIPE_SECRET_KEY = "sk_test_123TestValid";
  globalThis.fetch = async () => Response.json({
    id: "cs_test_created",
    url: "https://checkout.stripe.com/c/pay/cs_test_created",
  });

  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/checkout", {
      method: "POST",
      headers: { Origin: "https://audit.pencilproof.com" },
    }),
    env,
  );
  assert.equal(response.status, 200);
});

test("Stripe webhook signatures are authenticated and time bounded", async () => {
  const payload = JSON.stringify({ id: "evt_test" });
  const now = 1_000;
  const signature = await signWebhook(payload, now);
  assert.equal(
    await verifyStripeSignature(
      payload,
      signature,
      TEST_WEBHOOK_SECRET,
      now,
    ),
    true,
  );
  assert.equal(
    await verifyStripeSignature(
      `${payload}tampered`,
      signature,
      TEST_WEBHOOK_SECRET,
      now,
    ),
    false,
  );
  assert.equal(
    await verifyStripeSignature(
      payload,
      signature,
      TEST_WEBHOOK_SECRET,
      now + 301,
    ),
    false,
  );
});

test("a verified webhook records one order and binds recovery to its browser", async () => {
  const deviceHash = await sha256Hex(TEST_DEVICE_ID);
  const event = {
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: "cs_test_webhookpaid" } },
    id: "evt_test_webhook_paid",
    type: "checkout.session.completed",
  };
  const payload = JSON.stringify(event);
  const signature = await signWebhook(payload);
  const env = makeEnv();
  let stripeCalls = 0;

  globalThis.fetch = async (input) => {
    stripeCalls += 1;
    const requestUrl = String(input);
    if (requestUrl.endsWith("/line_items?limit=2")) {
      return Response.json({
        data: [{
          price: { id: "price_123TestValid" },
          quantity: 1,
        }],
        has_more: false,
      });
    }
    return Response.json(paidSession(deviceHash, "cs_test_webhookpaid"));
  };

  const webhookResponse = await handleRequest(
    new Request("https://audit.pencilproof.com/api/stripe/webhook", {
      body: payload,
      headers: { "Stripe-Signature": signature },
      method: "POST",
    }),
    env,
  );
  assert.equal(webhookResponse.status, 200);
  assert.equal(stripeCalls, 2);

  globalThis.fetch = async () => {
    throw new Error("Stripe should not be called for a recorded order");
  };
  const successResponse = await handleRequest(
    new Request(
      "https://audit.pencilproof.com/success?session_id=cs_test_webhookpaid",
      { headers: { Cookie: `pp_device=${TEST_DEVICE_ID}` } },
    ),
    env,
  );
  assert.equal(successResponse.status, 303);
  assert.equal(
    successResponse.headers.get("Location"),
    "https://audit.pencilproof.com/analyze/secure/",
  );
  assert.match(successResponse.headers.get("Set-Cookie") ?? "", /^pp_access=/);

  const otherDevice = "B".repeat(43);
  const sharedLinkResponse = await handleRequest(
    new Request(
      "https://audit.pencilproof.com/success?session_id=cs_test_webhookpaid",
      { headers: { Cookie: `pp_device=${otherDevice}` } },
    ),
    env,
  );
  assert.equal(sharedLinkResponse.headers.get("Set-Cookie"), null);
  assert.equal(
    sharedLinkResponse.headers.get("Location"),
    "https://audit.pencilproof.com/recover?reason=device_mismatch",
  );
});

test("a full refund revokes an existing cookie and duplicate events are safe", async () => {
  const env = makeEnv();
  const deviceHash = await sha256Hex(TEST_DEVICE_ID);
  const sessionId = "cs_test_refunded";
  const paidEvent = {
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: sessionId } },
    id: "evt_test_refund_paid",
    type: "checkout.session.completed",
  };
  const paidPayload = JSON.stringify(paidEvent);

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/line_items")) {
      return Response.json({
        data: [{
          price: { id: "price_123TestValid" },
          quantity: 1,
        }],
        has_more: false,
      });
    }
    return Response.json(paidSession(deviceHash, sessionId));
  };
  assert.equal(
    (await handleRequest(
      new Request("https://audit.pencilproof.com/api/stripe/webhook", {
        body: paidPayload,
        headers: { "Stripe-Signature": await signWebhook(paidPayload) },
        method: "POST",
      }),
      env,
    )).status,
    200,
  );

  const success = await handleRequest(
    new Request(
      `https://audit.pencilproof.com/success?session_id=${sessionId}`,
      { headers: { Cookie: `pp_device=${TEST_DEVICE_ID}` } },
    ),
    env,
  );
  const token = (success.headers.get("Set-Cookie") ?? "")
    .match(/^pp_access=([^;]+)/)?.[1] ?? "";
  const authorizedRequest = () =>
    new Request("https://audit.pencilproof.com/analyze/", {
      headers: {
        Cookie: `pp_access=${token}; pp_device=${TEST_DEVICE_ID}`,
      },
    });
  assert.equal((await handleRequest(authorizedRequest(), env)).status, 200);

  const partialRefund = {
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: "ch_testRefunded",
        payment_intent: "pi_testRefunded",
        refunded: false,
      },
    },
    id: "evt_test_partial_refund",
    type: "charge.refunded",
  };
  const partialPayload = JSON.stringify(partialRefund);
  globalThis.fetch = async () => {
    throw new Error("A partial refund should not call Stripe");
  };
  assert.equal(
    (await handleRequest(
      new Request("https://audit.pencilproof.com/api/stripe/webhook", {
        body: partialPayload,
        headers: { "Stripe-Signature": await signWebhook(partialPayload) },
        method: "POST",
      }),
      env,
    )).status,
    200,
  );
  assert.equal((await handleRequest(authorizedRequest(), env)).status, 200);

  const fullRefund = {
    ...partialRefund,
    data: {
      object: {
        id: "ch_testRefunded",
        payment_intent: "pi_testRefunded",
        refunded: true,
      },
    },
    id: "evt_testFullRefund",
  };
  const fullPayload = JSON.stringify(fullRefund);
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/checkout/sessions") {
      return Response.json({
        data: [paidSession(deviceHash, sessionId)],
        has_more: false,
      });
    }
    throw new Error(`Unexpected Stripe path: ${url.pathname}`);
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal(
      (await handleRequest(
        new Request("https://audit.pencilproof.com/api/stripe/webhook", {
          body: fullPayload,
          headers: { "Stripe-Signature": await signWebhook(fullPayload) },
          method: "POST",
        }),
        env,
      )).status,
      200,
    );
  }

  const revokedAudit = await handleRequest(authorizedRequest(), env);
  assert.equal(revokedAudit.status, 303);
  assert.equal(
    revokedAudit.headers.get("Location"),
    "https://audit.pencilproof.com/recover?reason=revoked",
  );
  assert.match(
    revokedAudit.headers.get("Set-Cookie") ?? "",
    /^pp_access=; Max-Age=0/,
  );

  const revokedRecovery = await handleRequest(
    new Request(
      `https://audit.pencilproof.com/success?session_id=${sessionId}`,
      { headers: { Cookie: `pp_device=${TEST_DEVICE_ID}` } },
    ),
    env,
  );
  assert.equal(
    revokedRecovery.headers.get("Location"),
    "https://audit.pencilproof.com/recover?reason=revoked",
  );
  assert.equal(revokedRecovery.headers.get("Set-Cookie"), null);
});

test("refund.created is informational and never requires Charges access", async () => {
  const refundEvent = {
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        charge: "ch_testRefunded",
        id: "re_test_refund",
        payment_intent: "pi_testRefunded",
      },
    },
    id: "evt_testRefundCreated",
    type: "refund.created",
  };
  const payload = JSON.stringify(refundEvent);
  globalThis.fetch = async () => {
    throw new Error("refund.created should not call Stripe");
  };

  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/stripe/webhook", {
      body: payload,
      headers: { "Stripe-Signature": await signWebhook(payload) },
      method: "POST",
    }),
    makeEnv(),
  );
  assert.equal(response.status, 200);
});

test("a dispute arriving before fulfillment prevents later redemption", async () => {
  const env = makeEnv();
  const deviceHash = await sha256Hex(TEST_DEVICE_ID);
  const sessionId = "cs_test_disputed";
  const dispute = {
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        charge: "ch_testDisputed",
        id: "du_test_disputed",
        payment_intent: "pi_testDisputed",
      },
    },
    id: "evt_testDisputed",
    type: "charge.dispute.created",
  };
  const disputePayload = JSON.stringify(dispute);
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/v1/checkout/sessions");
    return Response.json({
      data: [paidSession(deviceHash, sessionId)],
      has_more: false,
    });
  };
  assert.equal(
    (await handleRequest(
      new Request("https://audit.pencilproof.com/api/stripe/webhook", {
        body: disputePayload,
        headers: { "Stripe-Signature": await signWebhook(disputePayload) },
        method: "POST",
      }),
      env,
    )).status,
    200,
  );

  const paidEvent = {
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: sessionId } },
    id: "evt_test_disputed_paid",
    type: "checkout.session.completed",
  };
  const paidPayload = JSON.stringify(paidEvent);
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/line_items")) {
      return Response.json({
        data: [{
          price: { id: "price_123TestValid" },
          quantity: 1,
        }],
        has_more: false,
      });
    }
    return Response.json(paidSession(deviceHash, sessionId));
  };
  assert.equal(
    (await handleRequest(
      new Request("https://audit.pencilproof.com/api/stripe/webhook", {
        body: paidPayload,
        headers: { "Stripe-Signature": await signWebhook(paidPayload) },
        method: "POST",
      }),
      env,
    )).status,
    200,
  );

  const response = await handleRequest(
    new Request(
      `https://audit.pencilproof.com/success?session_id=${sessionId}`,
      { headers: { Cookie: `pp_device=${TEST_DEVICE_ID}` } },
    ),
    env,
  );
  assert.equal(
    response.headers.get("Location"),
    "https://audit.pencilproof.com/recover?reason=revoked",
  );
  assert.equal(response.headers.get("Set-Cookie"), null);
});

test("an invalid webhook signature is rejected before Stripe is called", async () => {
  let stripeCalled = false;
  globalThis.fetch = async () => {
    stripeCalled = true;
    return Response.json({});
  };

  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/api/stripe/webhook", {
      body: JSON.stringify({
        data: { object: { id: "cs_test_paid" } },
        type: "checkout.session.completed",
      }),
      headers: { "Stripe-Signature": "t=1,v1=deadbeef" },
      method: "POST",
    }),
    makeEnv(),
  );
  assert.equal(response.status, 400);
  assert.equal(stripeCalled, false);
});

test("the recovery page preserves a manual support path", async () => {
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/recover"),
    makeEnv(),
  );
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /Restore your audit/);
  assert.match(body, /support@pencilproof\.com/);
  assert.match(body, /action="\/recover\/account"/);
  assert.match(body, /Restore to my signed-in account/);
  assert.match(
    response.headers.get("Content-Security-Policy") ?? "",
    /form-action 'self'/,
  );
});

test("a localized paid session with the exact price receives access", async () => {
  const deviceHash = await sha256Hex(TEST_DEVICE_ID);
  globalThis.fetch = async (input) => {
    const requestUrl = String(input);
    if (requestUrl.endsWith("/line_items?limit=2")) {
      return Response.json({
        data: [{
          price: { id: "price_123TestValid" },
          quantity: 1,
        }],
        has_more: false,
      });
    }
    return Response.json({
      amount_subtotal: 27402,
      amount_total: 29868,
      currency: "cny",
      id: "cs_test_paid",
      managed_payments: { enabled: true },
      metadata: {
        pencilproof_device_hash: deviceHash,
        pencilproof_product: "full_quote_audit_v1",
      },
      mode: "payment",
      payment_status: "paid",
      status: "complete",
      total_details: {
        amount_discount: 0,
        amount_shipping: 0,
        amount_tax: 2466,
      },
    });
  };

  const env = makeEnv();
  const response = await handleRequest(
    new Request(
      "https://audit.pencilproof.com/success?session_id=cs_test_paid",
      { headers: { Cookie: `pp_device=${TEST_DEVICE_ID}` } },
    ),
    env,
  );
  const cookie = response.headers.get("Set-Cookie") ?? "";

  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("Location"),
    "https://audit.pencilproof.com/analyze/secure/",
  );
  assert.match(cookie, /^pp_access=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);

  const token = cookie.match(/^pp_access=([^;]+)/)?.[1] ?? "";
  const auditResponse = await handleRequest(
    new Request("https://audit.pencilproof.com/analyze/", {
      headers: {
        Cookie: `pp_access=${token}; pp_device=${TEST_DEVICE_ID}`,
      },
    }),
    env,
  );
  assert.equal(auditResponse.status, 200);
  assert.equal(await auditResponse.text(), "asset");
});

test("a valid discounted paid session receives access", async () => {
  const deviceHash = await sha256Hex(TEST_DEVICE_ID);
  globalThis.fetch = async (input) => {
    const requestUrl = String(input);
    if (requestUrl.endsWith("/line_items?limit=2")) {
      return Response.json({
        data: [{
          price: { id: "price_123TestValid" },
          quantity: 1,
        }],
        has_more: false,
      });
    }
    return Response.json({
      ...paidSession(deviceHash, "cs_test_discounted"),
      amount_total: 3235,
      total_details: {
        amount_discount: 1000,
        amount_shipping: 0,
        amount_tax: 335,
      },
    });
  };

  const response = await handleRequest(
    new Request(
      "https://audit.pencilproof.com/success?session_id=cs_test_discounted",
      { headers: { Cookie: `pp_device=${TEST_DEVICE_ID}` } },
    ),
    makeEnv(),
  );

  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("Location"),
    "https://audit.pencilproof.com/analyze/secure/",
  );
  assert.match(response.headers.get("Set-Cookie") ?? "", /^pp_access=/);
});

test("a paid session with a different price does not unlock the audit", async () => {
  globalThis.fetch = async (input) => {
    const requestUrl = String(input);
    if (requestUrl.endsWith("/line_items?limit=2")) {
      return Response.json({
        data: [{
          price: { id: "price_different" },
          quantity: 1,
        }],
        has_more: false,
      });
    }
    return Response.json({
      amount_subtotal: 3900,
      amount_total: 4235,
      currency: "usd",
      id: "cs_test_wrong_price",
      managed_payments: { enabled: true },
      metadata: { pencilproof_product: "full_quote_audit_v1" },
      mode: "payment",
      payment_status: "paid",
      status: "complete",
      total_details: {
        amount_discount: 0,
        amount_shipping: 0,
        amount_tax: 335,
      },
    });
  };

  const response = await handleRequest(
    new Request(
      "https://audit.pencilproof.com/success?session_id=cs_test_wrong_price",
      { headers: { Cookie: `pp_device=${TEST_DEVICE_ID}` } },
    ),
    makeEnv(),
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(
    response.headers.get("Location"),
    "https://pencilproof.com/?payment=unverified#pricing",
  );
});

test("a non-Managed Payments session does not unlock the audit", async () => {
  globalThis.fetch = async () =>
    Response.json({
      amount_subtotal: 3900,
      amount_total: 4235,
      currency: "usd",
      id: "cs_test_not_managed",
      managed_payments: { enabled: false },
      metadata: { pencilproof_product: "full_quote_audit_v1" },
      mode: "payment",
      payment_status: "paid",
      status: "complete",
      total_details: {
        amount_discount: 0,
        amount_shipping: 0,
        amount_tax: 335,
      },
    });

  const response = await handleRequest(
    new Request(
      "https://audit.pencilproof.com/success?session_id=cs_test_not_managed",
      { headers: { Cookie: `pp_device=${TEST_DEVICE_ID}` } },
    ),
    makeEnv(),
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(
    response.headers.get("Location"),
    "https://pencilproof.com/?payment=unverified#pricing",
  );
});

test("the wrong Stripe product does not unlock the audit", async () => {
  globalThis.fetch = async () =>
    Response.json({
      amount_subtotal: 100,
      amount_total: 100,
      currency: "usd",
      id: "cs_test_wrong",
      managed_payments: { enabled: true },
      metadata: { pencilproof_product: "different_product" },
      mode: "payment",
      payment_status: "paid",
      status: "complete",
      total_details: {
        amount_discount: 0,
        amount_shipping: 0,
        amount_tax: 0,
      },
    });

  const response = await handleRequest(
    new Request(
      "https://audit.pencilproof.com/success?session_id=cs_test_wrong",
      { headers: { Cookie: `pp_device=${TEST_DEVICE_ID}` } },
    ),
    makeEnv(),
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(
    response.headers.get("Location"),
    "https://pencilproof.com/?payment=unverified#pricing",
  );
});
