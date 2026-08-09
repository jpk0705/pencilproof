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

const makeEnv = (): Env => {
  const env = {
    ACCESS_MAX_AGE_SECONDS: "2592000",
    ASSETS: {
      fetch: async () => new Response("asset", { status: 200 }),
    },
    ORDERS: undefined,
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
