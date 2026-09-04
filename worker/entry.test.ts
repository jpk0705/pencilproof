import assert from "node:assert/strict";
import test from "node:test";
import worker, { type Env } from "./entry.ts";

const makeEnv = (paths: string[]): Env => ({
  PUBLIC_SITE_ORIGIN: "https://pencilproof.com",
  ANALYTICS: {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (request: Request) => {
        const url = new URL(request.url);
        paths.push(url.pathname + url.search);
        return url.pathname === "/summary"
          ? Response.json({
              byDay: {},
              byEvent: {},
              feedback: { byCategory: {}, byRating: {}, recent: [], total: 0 },
              ledger: {
                duplicateEventsRejected: 0,
                eventCount: 0,
                firstEventAt: null,
                lastEventAt: null,
                reliableFrom: new Date(0).toISOString(),
                schemaVersion: 2,
                verified: true,
              },
              sourceFunnel: [
                {
                  checkoutUsers: 1,
                  name: "threads/organic/free_scan",
                  previewUsers: 2,
                  purchasers: 1,
                  scanUsers: 3,
                  visitors: 4,
                },
              ],
              sessions: 0,
              updatedAt: new Date(0).toISOString(),
            })
          : Response.json({ recorded: true });
      },
    }),
  },
  ASSETS: { fetch: async () => new Response("asset") },
  ANALYTICS_DASHBOARD_PASSWORD: "test-dashboard-password",
  ANALYTICS_DASHBOARD_USERNAME: "test-admin",
  ORDERS: {} as Env["ORDERS"],
  SESSION_SECRET: "test-secret",
  SITE_ORIGIN: "https://audit.pencilproof.com",
  STRIPE_PRICE_ID: "price_test",
  STRIPE_SECRET_KEY: "rk_test",
} as Env);

const basicAuth = (username: string, password: string) =>
  `Basic ${btoa(`${username}:${password}`)}`;

test("analytics authentication keeps timingSafeEqual bound to crypto.subtle", async () => {
  const originalSubtle = crypto.subtle;
  const timingSafeEqual = function (this: typeof originalSubtle, left: ArrayBufferView, right: ArrayBufferView) {
    assert.equal(this, originalSubtle);
    const a = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
    const b = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
    if (a.byteLength !== b.byteLength) throw new Error("length mismatch");
    let difference = 0;
    for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
    return difference === 0;
  };
  Object.defineProperty(originalSubtle, "timingSafeEqual", { value: timingSafeEqual, configurable: true });
  try {
    const response = await worker.fetch(
      new Request("https://audit.pencilproof.com/api/analytics/summary", {
        headers: { Authorization: basicAuth("test-admin", "test-dashboard-password") },
      }),
      makeEnv([]),
    );
    assert.equal(response.status, 200);
  } finally {
    delete (originalSubtle as SubtleCrypto & { timingSafeEqual?: unknown }).timingSafeEqual;
  }
});

test("analytics summary requires credentials while event ingestion remains public", async () => {
  const paths: string[] = [];
  const response = await worker.fetch(
    new Request("https://audit.pencilproof.com/api/analytics/summary?range=7d"),
    makeEnv(paths),
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("WWW-Authenticate"), 'Basic realm="PencilProof analytics", charset="UTF-8"');
  assert.deepEqual(paths, []);
});

test("internal operations status reports seven-day Resend activity without exposing message PII", async () => {
  const originalFetch = globalThis.fetch;
  const env = makeEnv([]);
  env.RESEND_API_KEY = "re_test";
  env.MARKETING_FROM_EMAIL = "support@example.com";
  env.MARKETING_BUSINESS_ADDRESS = "123 Example Street";
  env.ACCOUNTS = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (request: Request) => {
        assert.equal(new URL(request.url).pathname, "/operations-status");
        return Response.json({
          emailDeliveries: {
            sent: 2,
            byDay: { "2026-08-30": 2 },
            byCampaign: { consumer_followup: 2 },
            pendingClaims: 0,
          },
          marketingAutomation: {
            automationKey: "marketing-email",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            status: "healthy",
            details: { sent: 2, failed: 0 },
          },
        });
      },
    }),
  } as Env["ACCOUNTS"];
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  globalThis.fetch = async (input) => {
    const url = String(input);
    assert.match(url, /^https:\/\/api\.resend\.com\/emails\?limit=100$/);
    return Response.json({
      data: [
        { id: "email-1", created_at: createdAt, last_event: "delivered", to: ["private@example.com"] },
        { id: "email-2", created_at: createdAt, last_event: "opened", to: ["other@example.com"] },
      ],
      has_more: false,
    });
  };
  try {
    const response = await worker.fetch(
      new Request("https://pencilproof-audit.internal/api/internal/operations-status"),
      env,
    );
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.email.provider.status, "verified");
    assert.equal(body.email.provider.messages, 2);
    assert.equal(body.email.provider.recipients, 2);
    assert.deepEqual(body.email.provider.byLastEvent, { delivered: 1, opened: 1 });
    assert.equal(body.email.provider.byDay[createdAt.slice(0, 10)], 2);
    assert.equal(body.traffic.status, "verified");
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /private@example\.com|other@example\.com|email-1|email-2/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("internal automation status reads the local run ledger without calling Resend", async () => {
  const originalFetch = globalThis.fetch;
  const env = makeEnv([]);
  env.RESEND_API_KEY = "re_test";
  env.MARKETING_FROM_EMAIL = "support@example.com";
  env.MARKETING_BUSINESS_ADDRESS = "123 Example Street";
  env.ACCOUNTS = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (request: Request) => {
        assert.equal(new URL(request.url).pathname, "/operations-status");
        return Response.json({
          emailDeliveries: { sent: 0, byDay: {}, byCampaign: {}, pendingClaims: 0 },
          marketingAutomation: {
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            status: "healthy",
            details: { candidates: 0, claimed: 0, sent: 0, failed: 0 },
          },
        });
      },
    }),
  } as Env["ACCOUNTS"];
  globalThis.fetch = async () => { throw new Error("Resend must not be called by the lightweight endpoint"); };
  try {
    const response = await worker.fetch(
      new Request("https://pencilproof-audit.internal/api/internal/automation-status"),
      env,
    );
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.email.automation.lastRun.status, "healthy");
    assert.equal(body.email.automation.lastRun.details.sent, 0);
    assert.equal(body.email.localDeliveries.sent, 0);
    assert.equal(body.email.provider, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analytics fails closed when dashboard credentials are not configured", async () => {
  const env = makeEnv([]);
  delete env.ANALYTICS_DASHBOARD_USERNAME;
  delete env.ANALYTICS_DASHBOARD_PASSWORD;
  const response = await worker.fetch(
    new Request("https://audit.pencilproof.com/analytics"),
    env,
  );
  assert.equal(response.status, 503);
});

test("analytics protected routes translate to Durable Object routes", async () => {
  const paths: string[] = [];
  const env = makeEnv(paths);

  const summary = await worker.fetch(
    new Request("https://audit.pencilproof.com/api/analytics/summary?range=14d", {
      headers: {
        Authorization: basicAuth("test-admin", "test-dashboard-password"),
        Origin: "https://audit.pencilproof.com",
      },
    }),
    env,
  );
  assert.equal(summary.status, 200);
  assert.equal(
    summary.headers.get("Access-Control-Allow-Origin"),
    "https://audit.pencilproof.com",
  );

  const event = await worker.fetch(
    new Request("https://audit.pencilproof.com/api/analytics/event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://pencilproof.com",
      },
      body: JSON.stringify({
        event: "page_view",
        eventId: "12345678-1234-1234-1234-123456789012",
        sessionId: "abcdefghijklmnopqrst",
      }),
    }),
    env,
  );
  assert.equal(event.status, 200);
  assert.deepEqual(paths, ["/summary?range=14d", "/event"]);
});

test("analytics dashboard renders the selected range and business funnel", async () => {
  const env = makeEnv([]);
  env.ACCOUNTS = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async () => Response.json({
        accounts: [
          {
            email: "consumer@example.com",
            firstSeenAt: 1_700_000_000,
            lastRole: "consumer",
            lastSeenAt: 1_700_000_100,
            paid: false,
            paidSource: null,
            role: "consumer",
            userId: "user-consumer",
          },
          {
            email: "sales@example.com",
            firstSeenAt: 1_700_000_000,
            lastRole: "salesperson",
            lastSeenAt: 1_700_000_100,
            paid: true,
            paidSource: "salesperson subscription",
            role: "salesperson",
            userId: "user-sales",
          },
          {
            email: "both@example.com",
            firstSeenAt: 1_700_000_000,
            lastRole: "consumer",
            lastSeenAt: 1_700_000_100,
            paid: true,
            paidSource: "audit pass + salesperson subscription",
            role: "both",
            userId: "user-both",
          },
        ],
      }),
    }),
  };
  const response = await worker.fetch(
    new Request("https://audit.pencilproof.com/analytics?range=1y", {
      headers: { Authorization: basicAuth("test-admin", "test-dashboard-password") },
    }),
    env,
  );
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /1 year/);
  assert.match(body, /Visitors/);
  assert.match(body, /Started a scan/);
  assert.match(body, /Preview ready/);
  assert.match(body, /Acquisition signals/);
  assert.match(body, /Funnel by source/);
  assert.match(body, /threads\/organic\/free_scan/);
  assert.match(body, /Started scan/);
  assert.match(body, /Reached checkout/);
  assert.match(body, /Purchased/);
  assert.match(body, /Customer feedback/);
  assert.match(body, /Account deletion reasons/);
  assert.match(body, /Average scan quality/);
  assert.match(body, /\$39\.99/);
  assert.match(body, /Written comments/);
  assert.match(body, /Download CSV/);
  assert.match(body, /What “session” means/);
  assert.match(body, /Account sign-ins/);
  assert.match(body, /consumer@example\.com/);
  assert.match(body, /Salesperson/);
  assert.match(body, /Both/);
  assert.match(body, /Filter by payment status/);
  assert.match(body, /Payment status/);
  assert.match(body, /Paid accounts/);
});

test("analytics feedback export uses dashboard authentication", async () => {
  const response = await worker.fetch(
    new Request("https://audit.pencilproof.com/analytics/feedback.csv?range=1m", {
      headers: { Authorization: basicAuth("test-admin", "test-dashboard-password") },
    }),
    makeEnv([]),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.match(await response.text(), /"created_at","category","ui_rating","service_rating","scan_quality_rating","worth_range","worth_value","written_comment"/);
});

test("analytics account filter keeps the selected role and hides other accounts", async () => {
  const env = makeEnv([]);
  env.ACCOUNTS = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async () => Response.json({
        accounts: [
          { email: "consumer@example.com", firstSeenAt: 1_700_000_000, lastRole: "consumer", lastSeenAt: 1_700_000_100, paid: false, paidSource: null, role: "consumer", userId: "user-consumer" },
          { email: "sales@example.com", firstSeenAt: 1_700_000_000, lastRole: "salesperson", lastSeenAt: 1_700_000_100, paid: true, paidSource: "salesperson subscription", role: "salesperson", userId: "user-sales" },
        ],
      }),
    }),
  };
  const response = await worker.fetch(
    new Request("https://audit.pencilproof.com/analytics?range=1m&account_role=salesperson", {
      headers: { Authorization: basicAuth("test-admin", "test-dashboard-password") },
    }),
    env,
  );
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /name="account_role"/);
  assert.match(body, /value="salesperson" selected/);
  assert.match(body, /sales@example\.com/);
  assert.doesNotMatch(body, /consumer@example\.com/);
  assert.match(body, /pencilproof-analytics-scroll-y/);
});

test("analytics account paid filter keeps paid accounts and preserves the role filter", async () => {
  const env = makeEnv([]);
  env.ACCOUNTS = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async () => Response.json({
        accounts: [
          { email: "paid-sales@example.com", firstSeenAt: 1_700_000_000, lastRole: "salesperson", lastSeenAt: 1_700_000_100, paid: true, paidSource: "salesperson subscription", role: "salesperson", userId: "user-paid-sales" },
          { email: "unpaid-sales@example.com", firstSeenAt: 1_700_000_000, lastRole: "salesperson", lastSeenAt: 1_700_000_100, paid: false, paidSource: null, role: "salesperson", userId: "user-unpaid-sales" },
          { email: "paid-consumer@example.com", firstSeenAt: 1_700_000_000, lastRole: "consumer", lastSeenAt: 1_700_000_100, paid: true, paidSource: "audit pass", role: "consumer", userId: "user-paid-consumer" },
        ],
      }),
    }),
  };
  const response = await worker.fetch(
    new Request("https://audit.pencilproof.com/analytics?range=1m&account_role=salesperson&account_paid=paid", {
      headers: { Authorization: basicAuth("test-admin", "test-dashboard-password") },
    }),
    env,
  );
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /name="account_role"/);
  assert.match(body, /value="salesperson" selected/);
  assert.match(body, /name="account_paid"/);
  assert.match(body, /value="paid" selected/);
  assert.match(body, /paid-sales@example\.com/);
  assert.doesNotMatch(body, /unpaid-sales@example\.com/);
  assert.doesNotMatch(body, /paid-consumer@example\.com/);
});

test("analytics routes reject the wrong method before reaching storage", async () => {
  const paths: string[] = [];
  const response = await worker.fetch(
    new Request("https://audit.pencilproof.com/api/analytics/summary", {
      method: "POST",
      headers: {
        Authorization: basicAuth("test-admin", "test-dashboard-password"),
      },
    }),
    makeEnv(paths),
  );
  assert.equal(response.status, 405);
  assert.deepEqual(paths, []);
});

test("analytics event rejects an unrelated browser origin", async () => {
  const paths: string[] = [];
  const response = await worker.fetch(
    new Request("https://audit.pencilproof.com/api/analytics/event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.com",
      },
      body: JSON.stringify({
        event: "page_view",
        eventId: "12345678-1234-1234-1234-123456789012",
        sessionId: "abcdefghijklmnopqrst",
      }),
    }),
    makeEnv(paths),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(paths, []);
});
