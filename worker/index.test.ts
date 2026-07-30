import assert from "node:assert/strict";
import test from "node:test";
import {
  createAccessToken,
  handleRequest,
  type Env,
  verifyAccessToken,
} from "./index.ts";

const originalFetch = globalThis.fetch;

const makeEnv = (): Env => ({
  ACCESS_MAX_AGE_SECONDS: "2592000",
  ASSETS: {
    fetch: async () => new Response("asset", { status: 200 }),
  },
  PUBLIC_SITE_ORIGIN: "https://pencilproof.com",
  SESSION_SECRET: "test-session-secret-with-enough-entropy",
  SITE_ORIGIN: "https://audit.pencilproof.com",
  STRIPE_PRICE_ID: "price_123TestValid",
  STRIPE_SECRET_KEY: "rk_test_123TestValid",
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("access tokens are signed and expire", async () => {
  const token = await createAccessToken(
    "cs_test_paid",
    "secret",
    60,
    1_000,
  );
  assert.deepEqual(
    await verifyAccessToken(token, "secret", 1_030),
    { exp: 1_060, sid: "cs_test_paid" },
  );
  assert.equal(await verifyAccessToken(token, "wrong", 1_030), null);
  assert.equal(await verifyAccessToken(token, "secret", 1_061), null);
});

test("the paid audit redirects an unauthenticated visitor to checkout", async () => {
  const response = await handleRequest(
    new Request("https://audit.pencilproof.com/analyze/"),
    makeEnv(),
  );
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("Location"),
    "https://audit.pencilproof.com/handoff?reason=access_required",
  );
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
  assert.equal(
    parameters.get("metadata[pencilproof_product]"),
    "full_quote_audit_v1",
  );
  assert.equal(
    parameters.get("success_url"),
    "https://audit.pencilproof.com/success?session_id={CHECKOUT_SESSION_ID}",
  );
  assert.equal(result.url, "https://checkout.stripe.com/c/pay/cs_test_created");
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
  env.STRIPE_SECRET_KEY = "price_not_a_secret_key";

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

test("a verified paid session receives protected access", async () => {
  globalThis.fetch = async () =>
    Response.json({
      amount_subtotal: 3900,
      amount_total: 4235,
      currency: "usd",
      id: "cs_test_paid",
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

  const env = makeEnv();
  const response = await handleRequest(
    new Request(
      "https://audit.pencilproof.com/success?session_id=cs_test_paid",
    ),
    env,
  );
  const cookie = response.headers.get("Set-Cookie") ?? "";

  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("Location"),
    "https://audit.pencilproof.com/analyze/",
  );
  assert.match(cookie, /^pp_access=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);

  const token = cookie.match(/^pp_access=([^;]+)/)?.[1] ?? "";
  const auditResponse = await handleRequest(
    new Request("https://audit.pencilproof.com/analyze/", {
      headers: { Cookie: `pp_access=${token}` },
    }),
    env,
  );
  assert.equal(auditResponse.status, 200);
  assert.equal(await auditResponse.text(), "asset");
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
