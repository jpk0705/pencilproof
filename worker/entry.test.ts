import assert from "node:assert/strict";
import test from "node:test";
import worker, { type Env } from "./entry.ts";

const makeEnv = (paths: string[]): Env => ({
  PUBLIC_SITE_ORIGIN: "https://pencilproof.com",
  ANALYTICS: {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (request: Request) => {
        paths.push(new URL(request.url).pathname);
        return new URL(request.url).pathname === "/summary"
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
              sessions: 0,
              updatedAt: new Date(0).toISOString(),
            })
          : Response.json({ recorded: true });
      },
    }),
  },
  ASSETS: { fetch: async () => new Response("asset") },
  ORDERS: {} as Env["ORDERS"],
  SESSION_SECRET: "test-secret",
  SITE_ORIGIN: "https://audit.pencilproof.com",
  STRIPE_PRICE_ID: "price_test",
  STRIPE_SECRET_KEY: "rk_test",
} as Env);

test("analytics public routes translate to Durable Object routes", async () => {
  const paths: string[] = [];
  const env = makeEnv(paths);

  const summary = await worker.fetch(
    new Request("https://audit.pencilproof.com/api/analytics/summary"),
    env,
  );
  assert.equal(summary.status, 200);
  assert.equal(
    summary.headers.get("Access-Control-Allow-Origin"),
    "https://pencilproof.com",
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
  assert.deepEqual(paths, ["/summary", "/event"]);
});

test("analytics routes reject the wrong method before reaching storage", async () => {
  const paths: string[] = [];
  const response = await worker.fetch(
    new Request("https://audit.pencilproof.com/api/analytics/summary", {
      method: "POST",
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
