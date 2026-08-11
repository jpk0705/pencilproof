import assert from "node:assert/strict";
import test from "node:test";
import {
  createAccessToken,
  handleRequest,
  OrderStore,
  type Env,
  verifyAccessToken,
  verifyStripeSignature,
} from "./index.ts";

const originalFetch = globalThis.fetch;
const TEST_DEVICE_ID = "A".repeat(43);
const TEST_WEBHOOK_SECRET = "whsec_TestWebhookSecret123";

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
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v1beta/models")) {
      return Response.json({ models: [] });
    }
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
    "https://audit.pencilproof.com/analyze/",
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
  assert.match(body, /action="\/recover\/access"/);
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
    "https://audit.pencilproof.com/analyze/",
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
