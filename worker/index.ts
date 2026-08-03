const ACCESS_COOKIE = "pp_access";
const DEVICE_COOKIE = "pp_device";
const PRODUCT_CODE = "full_quote_audit_v1";
const DEFAULT_ACCESS_SECONDS = 60 * 60 * 24 * 30;
const DEVICE_COOKIE_SECONDS = 60 * 60 * 24 * 400;
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const WEBHOOK_CONFIG_VERSION = 3;
const ORDER_RETENTION_MILLISECONDS = 1000 * 60 * 60 * 24 * 400;
const QUOTE_HANDOFF_KEY = "pencilproof:pending-import";
const QUOTE_HANDOFF_TYPE = "pencilproof:quote-handoff:v1";
const ANALYTICS_RETENTION_MILLISECONDS = 1000 * 60 * 60 * 24 * 400;
const ANALYTICS_MAX_FEEDBACK = 500;
const ANALYTICS_EVENT_NAMES = [
  "page_view",
  "scan_started",
  "import_success",
  "import_failed",
  "manual_fallback_opened",
  "audit_completed",
  "checkout_started",
  "payment_completed",
  "feedback_submitted",
] as const;
const STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "refund.created",
  "charge.refunded",
  "charge.dispute.created",
] as const;

type DurableObjectIdLike = unknown;

type DurableObjectStubLike = {
  fetch(request: Request): Promise<Response>;
};

type DurableObjectNamespaceLike = {
  get(id: DurableObjectIdLike): DurableObjectStubLike;
  idFromName(name: string): DurableObjectIdLike;
};

type DurableObjectStorageLike = {
  deleteAll(): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm?(scheduledTime: number): Promise<void>;
};

type DurableObjectStateLike = {
  storage: DurableObjectStorageLike;
};

export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  ACCESS_MAX_AGE_SECONDS?: string;
  ORDERS: DurableObjectNamespaceLike;
  ANALYTICS: DurableObjectNamespaceLike;
  PUBLIC_SITE_ORIGIN: string;
  SESSION_SECRET: string;
  SITE_ORIGIN: string;
  STRIPE_PRICE_ID: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET?: string;
  GEMINI_API_KEY?: string;
}

const AI_IMPORT_PROMPT = `You are PencilProof's document extraction engine for US automobile dealer buyer's orders, finance worksheets, F&I menus, lease worksheets, and payment quotes.

Return ONLY one JSON object with exactly these keys: vehicle, sellingPrice, tax, govFees, docFee, serviceContract, gap, prepaidMaintenance, tireWheel, accessories, tradeValue, tradePayoff, cashDown, rebate, apr, term, quotedPayment, offerMatrix, warnings.
Use null when a value is not explicitly printed or cannot be tied to a label with high confidence. Never guess, calculate, or copy a nearby total into a component field. Numbers must be numeric, not strings.

This is a FINANCE-FIRST parser:
- sellingPrice means the base selling/sales price of the vehicle. Do not use MSRP, asking price, total purchase, amount financed, or a price that already includes add-ons when a base sales price is present.
- tax is the printed sales-tax dollar amount, not the tax rate. govFees is the printed DMV/license/title/registration total or the clearly labeled government-fee component. docFee is documentation/electronic filing/doc processing only.
- rebate is only a printed rebate/discount/incentive credit. Never treat a dealer discount as a second rebate when the document uses the discount to arrive at selling price. Preserve the document's signed convention and do not double-count it.
- serviceContract includes VSC, vehicle service contract, extended service agreement, warranty, or protection plan. gap is GAP/negative-equity protection. prepaidMaintenance includes maintenance/service plans, including labels such as "Mitsubishi Maintenance", "ToyotaCare Maintenance", "Prepaid Maintenance", or a standalone "Maintenance" product. Do not put a separately priced maintenance product in accessories. tireWheel includes tire, wheel, road-hazard, dent, windshield, or appearance protection when separately priced. accessories includes connected-car, LoJack, Zurich Shield, paint protection, tint, nitrogen, alarm, theft, aftermarket accessories, and other dealer products not matching the prior categories. If multiple products exist in one category, sum only the itemized product prices and mention each item in warnings.
- tradeValue is the allowance for the customer's trade. tradePayoff is the amount owed on that trade. cashDown is customer cash/down payment, not trade equity, rebate, or total due at signing. quotedPayment is the labeled monthly payment, never total payments or amount financed.
- apr is the finance APR percentage. term is the loan term in months. Do not interpret a model number, page number, date, residual percentage, or money factor as APR or term.
- Prefer a directly labeled value over a nearby subtotal. When a line contains several amounts, choose the amount in the value column immediately associated with that label. Ignore grand totals when an itemized component is available.
- A lease or purchase section can appear beside another scenario. Identify whether the document is finance or lease. For PencilProof, extract the primary finance/buyer-order scenario when clearly identified. Never mix trade, rebates, or payment values from a separate scenario.
- If the document contains multiple payment choices, return every clearly printed choice in offerMatrix.options. Each option must contain type (finance or lease), cashDown, term, and payment, plus apr, rebate, or purchaseOption only when explicitly printed. Do not collapse a payment-options table into one choice. Use offerMatrix: null when no multiple-choice table is present.
- If a value is not printed, return null rather than deriving it from payment math. Put short field-specific uncertainty notes in warnings.

The document may be a photo, scan, screenshot, or PDF. Read the entire document and preserve cents exactly when visible.`;

const AI_IMPORT_MODELS = [
  "gemini-3.5-flash",
  "gemini-3-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
] as const;

const discoverGeminiModels = async (apiKey: string) => {
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!response.ok) return [];
    const payload = await response.json() as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    return (payload.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
      .map((model) => model.name?.replace(/^models\//, ""))
      .filter((model): model is string => Boolean(model));
  } catch {
    return [];
  }
};

const decodeGeminiJson = (value: unknown) => {
  const text = typeof value === "string" ? value : "";
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI_IMPORT_INVALID_JSON");
  return JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
};

const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const aiImportCorsHeaders = (env: Env) => ({
  ...noStoreHeaders,
  "Access-Control-Allow-Origin": env.PUBLIC_SITE_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
});

const handleAiImport = async (request: Request, env: Env) => {
  const headers = aiImportCorsHeaders(env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { ...headers, Allow: "POST, OPTIONS" } });
  if (!env.GEMINI_API_KEY) return Response.json({ error: "AI_IMPORT_NOT_CONFIGURED" }, { status: 503, headers });
  let body: { base64?: string; mimeType?: string };
  try { body = await request.json() as { base64?: string; mimeType?: string }; } catch { return Response.json({ error: "AI_IMPORT_BAD_REQUEST" }, { status: 400, headers }); }
  const mimeType = body.mimeType?.toLowerCase() ?? "";
  if (!body.base64 || (mimeType !== "application/pdf" && !mimeType.startsWith("image/"))) {
    return Response.json({ error: "AI_IMPORT_BAD_REQUEST" }, { status: 400, headers });
  }
  if (body.base64.length > 22_000_000) return Response.json({ error: "AI_IMPORT_TOO_LARGE" }, { status: 413, headers });

  // Keep the credential out of the request URL. Google documents the
  // x-goog-api-key header for Gemini API authentication. Try the regular
  // Use the lower-cost Flash-Lite model only. Local extraction runs first in
  // the browser, so this path is reserved for ambiguous documents rather
  // than spending provider quota on every upload.
  let response: Response | undefined;
  let lastProviderBody = "";
  let parsedProviderResponse: Record<string, unknown> | undefined;
  const availableModels = await discoverGeminiModels(env.GEMINI_API_KEY);
  const discoveredFlashModels = availableModels.filter((model) => /flash/i.test(model));
  const models = [
    ...AI_IMPORT_MODELS.filter((model) => availableModels.includes(model)),
    ...discoveredFlashModels.filter((model) => !AI_IMPORT_MODELS.includes(model as typeof AI_IMPORT_MODELS[number])),
    ...AI_IMPORT_MODELS.filter((model) => !availableModels.length || !discoveredFlashModels.length),
  ];
  for (const model of models) {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: AI_IMPORT_PROMPT }, { inline_data: { mime_type: mimeType, data: body.base64 } }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: "application/json" },
      }),
    });
    if (response.ok) {
      // A provider HTTP 200 is not sufficient. Some Gemini model variants can
      // return an empty candidate or non-JSON text for an image request. Do
      // not stop model fallback at that point, because the next compatible
      // vision model may return the structured extraction we need.
      try {
        const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
        parsedProviderResponse = decodeGeminiJson(raw);
        break;
      } catch {
        parsedProviderResponse = undefined;
        lastProviderBody = "MODEL_RETURNED_INVALID_JSON";
        continue;
      }
    }
    lastProviderBody = await response.text();
    // A 400 can mean that a discovered model does not accept this multimodal\n    // request/configuration. Continue to the next compatible model rather\n    // than turning one model-specific rejection into a total import failure.\n    if (![400, 404, 429, 500, 502, 503].includes(response.status)) break;
  }
  if (!response || !response.ok || !parsedProviderResponse) {
    // Return only a stable, non-secret diagnostic. The full provider body is
    // logged for server-side debugging, but never sent to the browser.
    const providerBody = lastProviderBody;
    console.error("Gemini import provider failure", {
      status: response?.status,
      statusText: response?.statusText,
      body: providerBody.slice(0, 1000),
    });
    let providerCode = "UNKNOWN";
    try {
      const parsed = JSON.parse(providerBody) as { error?: { status?: string; code?: number; message?: string } };
      const providerStatus = parsed.error?.status;
      const providerMessage = parsed.error?.message ?? "";
      if (providerStatus === "UNAUTHENTICATED" || /api key|authentication|credential/i.test(providerMessage)) providerCode = "AUTHENTICATION";
      else if (providerStatus === "PERMISSION_DENIED" || /permission|disabled|not enabled/i.test(providerMessage)) providerCode = "PERMISSION";
      else if (providerStatus === "RESOURCE_EXHAUSTED" || response.status === 429) providerCode = "QUOTA";
      else if (response?.status === 400) providerCode = "BAD_REQUEST";
      else if ((response?.status ?? 0) >= 500) providerCode = "PROVIDER_UNAVAILABLE";
    } catch {
      // Keep UNKNOWN when Google did not return JSON.
    }
    return Response.json({
      error: "AI_IMPORT_PROVIDER_ERROR",
      providerCode,
      providerHttpStatus: response?.status ?? null,
    }, { status: 502, headers });
  }
  try {
    const parsed = parsedProviderResponse;
    const fields = Object.fromEntries([
      "vehicle", "sellingPrice", "tax", "govFees", "docFee", "serviceContract", "gap", "prepaidMaintenance", "tireWheel", "accessories", "tradeValue", "tradePayoff", "cashDown", "rebate", "apr", "term", "quotedPayment",
    ].flatMap((key) => {
      if (key === "vehicle") return typeof parsed[key] === "string" && parsed[key].trim() ? [[key, parsed[key].trim()]] : [];
      const value = numberOrNull(parsed[key]);
      return value === null ? [] : [[key, value]];
    }));
    const rawOptions = parsed.offerMatrix && typeof parsed.offerMatrix === "object" && !Array.isArray(parsed.offerMatrix)
      ? (parsed.offerMatrix as { options?: unknown }).options
      : null;
    const options = Array.isArray(rawOptions)
      ? rawOptions.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const option = raw as Record<string, unknown>;
        const type = option.type === "lease" ? "lease" : option.type === "finance" ? "finance" : null;
        const cashDown = numberOrNull(option.cashDown);
        const term = numberOrNull(option.term);
        const payment = numberOrNull(option.payment);
        if (!type || cashDown === null || term === null || payment === null || cashDown < 0 || term < 12 || term > 120 || payment < 25 || payment > 10000) return [];
        return [{
          id: `${type}-${cashDown}-${term}-${payment}`,
          type,
          cashDown,
          term,
          payment,
          ...(numberOrNull(option.rebate) !== null ? { rebate: numberOrNull(option.rebate) } : {}),
          ...(numberOrNull(option.apr) !== null ? { apr: numberOrNull(option.apr) } : {}),
          ...(numberOrNull(option.purchaseOption) !== null ? { purchaseOption: numberOrNull(option.purchaseOption) } : {}),
        }];
      })
      : [];
    const offerMatrix = options.length > 1
      ? {
        options: Array.from(new Map(options.map((option) => [option.id, option])).values()),
        warnings: Array.isArray((parsed.offerMatrix as { warnings?: unknown } | null)?.warnings)
          ? ((parsed.offerMatrix as { warnings?: unknown }).warnings ?? []).filter((item): item is string => typeof item === "string").slice(0, 12)
          : ["Multiple payment choices were detected. Select the exact row you are considering."],
      }
      : null;
    return Response.json({ fields, offerMatrix, warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === "string").slice(0, 12) : [], fieldConfidence: Object.fromEntries(Object.keys(fields).map((key) => [key, "review"])), sourceType: "ai-vision" }, { headers });
  } catch {
    return Response.json({ error: "AI_IMPORT_INVALID_RESPONSE" }, { status: 502, headers });
  }
};

type AccessPayload = {
  did: string;
  exp: number;
  sid: string;
};

type StripeCheckoutSession = {
  amount_subtotal?: number | null;
  amount_total?: number | null;
  created?: number | null;
  currency?: string | null;
  id: string;
  managed_payments?: { enabled?: boolean } | null;
  metadata?: Record<string, string> | null;
  mode?: string | null;
  payment_intent?: string | null;
  payment_status?: string | null;
  status?: string | null;
  total_details?: {
    amount_discount?: number | null;
    amount_shipping?: number | null;
    amount_tax?: number | null;
  } | null;
  url?: string | null;
};

type StripeEventObject = {
  amount?: number | null;
  amount_refunded?: number | null;
  charge?: string | null;
  id?: string;
  payment_intent?: string | null;
  refunded?: boolean | null;
  status?: string | null;
};

type StripeEvent = {
  created?: number;
  data?: { object?: StripeEventObject };
  id?: string;
  type?: string;
};

type StripeEvents = {
  data?: StripeEvent[];
  has_more?: boolean;
};

type StripeCheckoutSessions = {
  data?: StripeCheckoutSession[];
  has_more?: boolean;
};

type StripeCheckoutLineItems = {
  data?: Array<{
    price?: { id?: string | null } | null;
    quantity?: number | null;
  }>;
  has_more?: boolean;
};

type OrderRecord = {
  accessExpiresAt: number;
  amountTotal: number;
  createdAt: number;
  currency: string;
  deviceHash: string;
  firstRedeemedAt?: number;
  lastRedeemedAt?: number;
  priceId: string;
  redemptionCount: number;
  sessionId: string;
  stripeEventId: string;
};

type OrderRedeemResult = {
  allowed: boolean;
  expiresAt?: number;
  reason?: "device_mismatch" | "expired" | "not_found" | "revoked";
};

type OrderRevocation = {
  reason: "disputed" | "refunded";
  revokedAt: number;
  sessionId: string;
  stripeEventId: string;
};

type AnalyticsEventName = typeof ANALYTICS_EVENT_NAMES[number];

type AnalyticsEvent = {
  category?: string;
  device?: "mobile" | "desktop" | "tablet";
  event: AnalyticsEventName;
  path?: string;
  sessionId: string;
  source?: string;
  value?: number;
};

type FeedbackRecord = {
  category: string;
  comment: string;
  createdAt: string;
  rating: number;
  sessionId: string;
};

type AnalyticsSummary = {
  byDay: Record<string, Record<string, number>>;
  byEvent: Record<string, number>;
  feedback: {
    byCategory: Record<string, number>;
    byRating: Record<string, number>;
    recent: FeedbackRecord[];
    total: number;
  };
  sessions: number;
  updatedAt: string;
};

type WebhookConfig = {
  createdAt: number;
  endpointId: string;
  reconciledAt?: number;
  secret: string;
  url: string;
  version?: number;
};

type CheckoutErrorCode =
  | "stripe_price_id_invalid"
  | "stripe_secret_key_invalid"
  | "webhook_unavailable"
  | "stripe_product_ineligible"
  | "managed_payments_unavailable"
  | "stripe_api_rejected"
  | "checkout_internal_error";

class CheckoutError extends Error {
  readonly code: CheckoutErrorCode;

  constructor(code: CheckoutErrorCode, message: string) {
    super(message);
    this.name = "CheckoutError";
    this.code = code;
  }
}

const encoder = new TextEncoder();

const base64UrlEncode = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const base64UrlDecode = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const importSigningKey = (secret: string) =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );

export const createAccessToken = async (
  sessionId: string,
  deviceHash: string,
  secret: string,
  maxAgeSeconds = DEFAULT_ACCESS_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
) => {
  const payload = base64UrlEncode(
    encoder.encode(JSON.stringify({
      did: deviceHash,
      exp: nowSeconds + maxAgeSeconds,
      sid: sessionId,
    } satisfies AccessPayload)),
  );
  const key = await importSigningKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
  );
  return `${payload}.${base64UrlEncode(signature)}`;
};

export const verifyAccessToken = async (
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) => {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;

  try {
    const key = await importSigningKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(signature),
      encoder.encode(payload),
    );
    if (!valid) return null;

    const parsed = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payload)),
    ) as AccessPayload;
    if (
      typeof parsed.sid !== "string"
      || !parsed.sid.startsWith("cs_")
      || typeof parsed.did !== "string"
      || !/^[a-f0-9]{64}$/.test(parsed.did)
      || typeof parsed.exp !== "number"
      || parsed.exp <= nowSeconds
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const readCookie = (request: Request, name: string) => {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
};

const accessSeconds = (env: Env) => {
  const configured = Number(env.ACCESS_MAX_AGE_SECONDS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_ACCESS_SECONDS;
};

const randomDeviceId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(bytes);
};

const validDeviceId = (value: string | null): value is string =>
  Boolean(value && /^[A-Za-z0-9_-]{43}$/.test(value));

const sha256Hex = async (value: string) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const deviceCookie = (deviceId: string) => [
  `${DEVICE_COOKIE}=${deviceId}`,
  `Max-Age=${DEVICE_COOKIE_SECONDS}`,
  "Path=/",
  "HttpOnly",
  "Secure",
  "SameSite=Lax",
].join("; ");

const accessCookie = (token: string, maxAge: number) => [
  `${ACCESS_COOKIE}=${token}`,
  `Max-Age=${maxAge}`,
  "Path=/",
  "HttpOnly",
  "Secure",
  "SameSite=Lax",
].join("; ");

const orderStub = (sessionId: string, env: Env) =>
  env.ORDERS.get(env.ORDERS.idFromName(sessionId));

const analyticsStub = (env: Env) =>
  env.ANALYTICS.get(env.ANALYTICS.idFromName("pencilproof-analytics"));

const recordAnalyticsEvent = async (
  event: Record<string, unknown>,
  env: Env,
) => {
  try {
    const response = await analyticsStub(env).fetch(
      new Request("https://analytics.internal/event", {
        body: JSON.stringify(event),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    return response.ok;
  } catch {
    return false;
  }
};

const emptyAnalyticsSummary = (): AnalyticsSummary => ({
  byDay: {},
  byEvent: {},
  feedback: { byCategory: {}, byRating: {}, recent: [], total: 0 },
  sessions: 0,
  updatedAt: new Date(0).toISOString(),
});

const webhookConfigStub = (env: Env) =>
  orderStub("__pencilproof_webhook_config__", env);

const isValidWebhookConfig = (
  config: WebhookConfig | undefined,
  url?: string,
) => Boolean(
  config
  && (!url || config.url === url)
  && /^we_[A-Za-z0-9]+$/.test(config.endpointId)
  && /^whsec_[A-Za-z0-9]+$/.test(config.secret)
  && config.version === WEBHOOK_CONFIG_VERSION
);

const webhookIsReady = async (env: Env) => {
  if (
    typeof env.STRIPE_WEBHOOK_SECRET === "string"
    && /^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET)
  ) {
    return true;
  }
  const response = await webhookConfigStub(env).fetch(
    new Request("https://order-store.internal/webhook/status", {
      method: "POST",
    }),
  );
  if (!response.ok) return false;
  const body = await response.json() as { ready?: boolean };
  return body.ready === true;
};

const configuredWebhookSecret = async (env: Env) => {
  if (
    typeof env.STRIPE_WEBHOOK_SECRET === "string"
    && /^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET)
  ) {
    return env.STRIPE_WEBHOOK_SECRET;
  }
  const response = await webhookConfigStub(env).fetch(
    new Request("https://order-store.internal/webhook/secret", {
      method: "POST",
    }),
  );
  if (!response.ok) return null;
  const body = await response.json() as {
    ready?: boolean;
    secret?: string;
  };
  return body.ready === true
      && typeof body.secret === "string"
      && /^whsec_[A-Za-z0-9]+$/.test(body.secret)
    ? body.secret
    : null;
};

const ensureWebhookEndpoint = async (env: Env) => {
  if (
    typeof env.STRIPE_WEBHOOK_SECRET === "string"
    && /^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET)
  ) {
    return true;
  }
  const response = await webhookConfigStub(env).fetch(
    new Request("https://order-store.internal/webhook/ensure", {
      body: JSON.stringify({
        url: `${env.SITE_ORIGIN}/api/stripe/webhook`,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
  if (!response.ok) return false;
  const body = await response.json() as { ready?: boolean };
  return body.ready === true;
};

const storePaidOrder = async (order: OrderRecord, env: Env) => {
  const response = await orderStub(order.sessionId, env).fetch(
    new Request("https://order-store.internal/paid", {
      body: JSON.stringify(order),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
  return response.ok;
};

const redeemOrder = async (
  sessionId: string,
  deviceHash: string,
  env: Env,
): Promise<OrderRedeemResult> => {
  const response = await orderStub(sessionId, env).fetch(
    new Request("https://order-store.internal/redeem", {
      body: JSON.stringify({
        deviceHash,
        now: Math.floor(Date.now() / 1000),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
  if (!response.ok) return { allowed: false, reason: "not_found" };
  return response.json() as Promise<OrderRedeemResult>;
};

const authorizeOrder = async (
  sessionId: string,
  deviceHash: string,
  env: Env,
): Promise<OrderRedeemResult> => {
  const response = await orderStub(sessionId, env).fetch(
    new Request("https://order-store.internal/authorize", {
      body: JSON.stringify({
        deviceHash,
        now: Math.floor(Date.now() / 1000),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
  if (!response.ok) return { allowed: false, reason: "not_found" };
  return response.json() as Promise<OrderRedeemResult>;
};

const revokeOrder = async (
  revocation: OrderRevocation,
  env: Env,
) => {
  const response = await orderStub(revocation.sessionId, env).fetch(
    new Request("https://order-store.internal/revoke", {
      body: JSON.stringify(revocation),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
  return response.ok;
};

export class OrderStore {
  private readonly state: DurableObjectStateLike;
  private readonly env?: Env;

  constructor(state: DurableObjectStateLike, env?: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const path = new URL(request.url).pathname;
    if (path === "/webhook/ensure") {
      const body = await request.json() as { url?: string };
      const url = body.url ?? "";
      if (!/^https:\/\/[A-Za-z0-9.-]+\/api\/stripe\/webhook$/.test(url)) {
        return new Response("Invalid webhook URL", { status: 400 });
      }

      const existing = await this.state.storage.get<WebhookConfig>(
        "webhookConfig",
      );
      const existingIsValid = Boolean(
        existing
        && existing.url === url
        && /^we_[A-Za-z0-9]+$/.test(existing.endpointId)
        && /^whsec_[A-Za-z0-9]+$/.test(existing.secret)
      );
      if (existingIsValid && isValidWebhookConfig(existing)) {
        return Response.json({ ready: true });
      }
      if (!this.env) {
        return Response.json({ ready: false }, { status: 503 });
      }

      const configured = existingIsValid
        ? existing?.version === WEBHOOK_CONFIG_VERSION
          ? existing
          : await updateStripeWebhookEndpoint(existing!, this.env)
        : await createStripeWebhookEndpoint(url, this.env);
      if (!configured) {
        return Response.json({ ready: false }, { status: 503 });
      }
      const storedConfig = {
        ...configured,
        reconciledAt: configured.reconciledAt ?? 0,
      };
      await this.state.storage.put("webhookConfig", storedConfig);

      // Historical revocation reconciliation is best effort. It must not block
      // a new customer from creating a checkout session.
      if (await reconcileRecentRevocations(this.env)) {
        await this.state.storage.put("webhookConfig", {
          ...storedConfig,
          reconciledAt: Math.floor(Date.now() / 1000),
        });
      }
      return Response.json({ ready: true });
    }

    if (path === "/webhook/status") {
      const config = await this.state.storage.get<WebhookConfig>(
        "webhookConfig",
      );
      const ready = isValidWebhookConfig(config);
      return Response.json({ ready });
    }

    if (path === "/webhook/secret") {
      const config = await this.state.storage.get<WebhookConfig>(
        "webhookConfig",
      );
      if (!config || !/^whsec_[A-Za-z0-9]+$/.test(config.secret)) {
        return Response.json({ ready: false }, { status: 404 });
      }
      return Response.json({ ready: true, secret: config.secret });
    }

    if (path === "/paid") {
      const incoming = await request.json() as OrderRecord;
      if (
        !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(incoming.sessionId)
        || !/^price_[A-Za-z0-9]+$/.test(incoming.priceId)
        || !/^[a-f0-9]{64}$/.test(incoming.deviceHash)
        || !Number.isInteger(incoming.createdAt)
        || !Number.isInteger(incoming.accessExpiresAt)
        || incoming.accessExpiresAt <= incoming.createdAt
      ) {
        return new Response("Invalid order", { status: 400 });
      }

      const existing = await this.state.storage.get<OrderRecord>("order");
      if (existing) {
        const sameOrder = existing.sessionId === incoming.sessionId
          && existing.priceId === incoming.priceId
          && existing.deviceHash === incoming.deviceHash;
        return Response.json(
          { stored: sameOrder },
          { status: sameOrder ? 200 : 409 },
        );
      }

      await this.state.storage.put("order", incoming);
      await this.state.storage.setAlarm?.(
        Date.now() + ORDER_RETENTION_MILLISECONDS,
      );
      return Response.json({ stored: true });
    }

    if (path === "/revoke") {
      const incoming = await request.json() as OrderRevocation;
      if (
        !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(incoming.sessionId)
        || !/^evt_[A-Za-z0-9]+$/.test(incoming.stripeEventId)
        || !Number.isInteger(incoming.revokedAt)
        || incoming.revokedAt <= 0
        || (
          incoming.reason !== "refunded"
          && incoming.reason !== "disputed"
        )
      ) {
        return new Response("Invalid revocation", { status: 400 });
      }

      const existing = await this.state.storage.get<OrderRevocation>(
        "revocation",
      );
      if (!existing) {
        await this.state.storage.put("revocation", incoming);
        await this.state.storage.setAlarm?.(
          Date.now() + ORDER_RETENTION_MILLISECONDS,
        );
      }
      return Response.json({ revoked: true });
    }

    if (path === "/redeem" || path === "/authorize") {
      const body = await request.json() as {
        deviceHash?: string;
        now?: number;
      };
      const revocation = await this.state.storage.get<OrderRevocation>(
        "revocation",
      );
      if (revocation) {
        return Response.json({
          allowed: false,
          reason: "revoked",
        } satisfies OrderRedeemResult);
      }
      const order = await this.state.storage.get<OrderRecord>("order");
      if (!order) {
        return Response.json({
          allowed: false,
          reason: "not_found",
        } satisfies OrderRedeemResult);
      }
      if (
        typeof body.now !== "number"
        || !Number.isInteger(body.now)
        || body.now >= order.accessExpiresAt
      ) {
        return Response.json({
          allowed: false,
          reason: "expired",
        } satisfies OrderRedeemResult);
      }
      if (body.deviceHash !== order.deviceHash) {
        return Response.json({
          allowed: false,
          reason: "device_mismatch",
        } satisfies OrderRedeemResult);
      }

      if (path === "/authorize") {
        return Response.json({
          allowed: true,
          expiresAt: order.accessExpiresAt,
        } satisfies OrderRedeemResult);
      }

      order.firstRedeemedAt ??= body.now;
      order.lastRedeemedAt = body.now;
      order.redemptionCount += 1;
      await this.state.storage.put("order", order);
      return Response.json({
        allowed: true,
        expiresAt: order.accessExpiresAt,
      } satisfies OrderRedeemResult);
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}

export class AnalyticsStore {
  private readonly state: DurableObjectStateLike;

  constructor(state: DurableObjectStateLike) {
    this.state = state;
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/event") {
      const event = await request.json() as Partial<AnalyticsEvent>;
      if (
        typeof event.sessionId !== "string"
        || !/^[A-Za-z0-9_-]{20,80}$/.test(event.sessionId)
        || typeof event.event !== "string"
        || !(ANALYTICS_EVENT_NAMES as readonly string[]).includes(event.event)
      ) {
        return new Response("Invalid analytics event", { status: 400 });
      }

      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const summary = await this.state.storage.get<AnalyticsSummary>("summary")
        ?? emptyAnalyticsSummary();
      summary.byEvent[event.event] = (summary.byEvent[event.event] ?? 0) + 1;
      summary.byDay[day] ??= {};
      summary.byDay[day][event.event] =
        (summary.byDay[day][event.event] ?? 0) + 1;
      summary.updatedAt = now.toISOString();

      const sessionKey = `session:${event.sessionId}`;
      const knownSession = await this.state.storage.get<boolean>(sessionKey);
      if (!knownSession) {
        await this.state.storage.put(sessionKey, true);
        summary.sessions += 1;
      }

      if (event.event === "feedback_submitted") {
        const category = typeof event.category === "string"
          ? event.category.slice(0, 40)
          : "other";
        const rating = Number.isInteger(event.value)
          ? Math.max(1, Math.min(5, Number(event.value)))
          : 0;
        summary.feedback.total += 1;
        summary.feedback.byCategory[category] =
          (summary.feedback.byCategory[category] ?? 0) + 1;
        if (rating > 0) {
          const ratingKey = String(rating);
          summary.feedback.byRating[ratingKey] =
            (summary.feedback.byRating[ratingKey] ?? 0) + 1;
        }
        const comment = typeof (event as { comment?: unknown }).comment === "string"
          ? (event as { comment: string }).comment.trim().slice(0, 1000)
          : "";
        if (comment) {
          summary.feedback.recent.unshift({
            category,
            comment,
            createdAt: now.toISOString(),
            rating,
            sessionId: event.sessionId,
          });
          summary.feedback.recent = summary.feedback.recent.slice(0, ANALYTICS_MAX_FEEDBACK);
        }
      }

      await this.state.storage.put("summary", summary);
      await this.state.storage.setAlarm?.(
        Date.now() + ANALYTICS_RETENTION_MILLISECONDS,
      );
      return Response.json({ recorded: true });
    }

    if (request.method === "GET" && url.pathname === "/summary") {
      const summary = await this.state.storage.get<AnalyticsSummary>("summary")
        ?? emptyAnalyticsSummary();
      return Response.json({
        ...summary,
        feedback: {
          ...summary.feedback,
          recent: summary.feedback.recent.map(({ sessionId: _sessionId, ...feedback }) => feedback),
        },
      }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy": [
    "default-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      ...noStoreHeaders,
      "Content-Type": "text/html; charset=utf-8",
    },
  });

const redirect = (location: string, headers: HeadersInit = {}) =>
  new Response(null, {
    status: 303,
    headers: {
      ...noStoreHeaders,
      ...headers,
      Location: location,
    },
  });

const handoffPage = () =>
  html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Opening secure checkout | PencilProof</title>
    <style>
      :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f4ee;color:#11233b;font:16px/1.5 Arial,sans-serif}.card{width:min(520px,calc(100% - 32px));padding:40px;border:1px solid #d9d7cf;background:#fff;box-shadow:0 18px 50px rgba(17,35,59,.08)}.brand{display:flex;align-items:center;gap:10px;font-weight:800}.mark{display:grid;place-items:center;width:34px;height:34px;background:#11233b;color:#58d68d;border-radius:4px}h1{margin:28px 0 10px;font:700 34px/1.1 Georgia,serif}p{color:#596675}.status{margin-top:24px;padding:14px 16px;background:#edf8f1;color:#17633a;font-weight:700}a{color:#17633a}
    </style>
  </head>
  <body>
    <main class="card">
      <div class="brand"><span class="mark">P</span><span>PencilProof</span></div>
      <h1>Opening secure checkout</h1>
      <p>Your quote stays in this browser. PencilProof is preparing Stripe checkout for the one-time Full Quote Audit.</p>
      <div class="status" id="status" role="status">Connecting securely…</div>
      <p><a href="/recover">Already purchased? Restore access.</a></p>
      <noscript><p>JavaScript is required to continue. Return to <a href="https://pencilproof.com/">PencilProof</a> after enabling it.</p></noscript>
    </main>
    <script>
      (() => {
        const status = document.getElementById("status");
        try {
          const handoff = window.name;
          if (handoff) {
            const envelope = JSON.parse(handoff);
            if (envelope?.type === ${JSON.stringify(QUOTE_HANDOFF_TYPE)}) {
              window.name = "";
              if (
                !envelope.payload
                || typeof envelope.payload !== "object"
                || !envelope.payload.fields
                || typeof envelope.payload.fields !== "object"
              ) {
                throw new Error("invalid quote handoff");
              }
              sessionStorage.setItem(
                ${JSON.stringify(QUOTE_HANDOFF_KEY)},
                JSON.stringify(envelope.payload),
              );
            }
          }
        } catch {
          status.textContent = "Your quote could not be carried forward. You can still enter the figures manually after checkout.";
        }

          fetch("/api/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              analyticsSessionId: localStorage.getItem("pencilproof:analytics-session")
            })
          })
          .then(async (response) => {
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(
                typeof payload.code === "string" ? payload.code : "checkout",
              );
            }
            return payload;
          })
          .then(({ url }) => {
            if (!url || !url.startsWith("https://checkout.stripe.com/")) throw new Error("url");
            window.location.replace(url);
          })
          .catch((error) => {
            const safeCode = /^[a-z_]+$/.test(error?.message ?? "")
              ? " Reference: " + error.message + "."
              : "";
            status.innerHTML = 'Checkout could not start.' + safeCode + ' Please <a href="/handoff">try again</a> or email support@pencilproof.com.';
          });
      })();
    </script>
  </body>
</html>`);

const stripeRequest = async (
  path: string,
  env: Env,
  init: RequestInit = {},
) => {
  const headers = new Headers(init.headers);
  const stripeSecretKey = typeof env.STRIPE_SECRET_KEY === "string"
    ? env.STRIPE_SECRET_KEY.trim()
    : "";
  headers.set("Authorization", `Bearer ${stripeSecretKey}`);
  headers.set("Stripe-Version", "2026-04-22.dahlia");
  return fetch(`https://api.stripe.com/v1${path}`, { ...init, headers });
};

async function createStripeWebhookEndpoint(
  url: string,
  env: Env,
): Promise<WebhookConfig | null> {
  const parameters = new URLSearchParams({
    description: "PencilProof paid audit fulfillment",
    url,
  });
  for (const event of STRIPE_WEBHOOK_EVENTS) {
    parameters.append("enabled_events[]", event);
  }
  const response = await stripeRequest("/webhook_endpoints", env, {
    body: parameters,
    method: "POST",
  });
  const endpoint = await response.json() as {
    error?: { message?: string };
    id?: string;
    secret?: string;
    url?: string;
  };
  if (
    !response.ok
    || !endpoint.id
    || !/^we_[A-Za-z0-9]+$/.test(endpoint.id)
    || !endpoint.secret
    || !/^whsec_[A-Za-z0-9]+$/.test(endpoint.secret)
    || endpoint.url !== url
  ) {
    console.error("Stripe webhook setup failed", {
      message: endpoint.error?.message ?? "Invalid webhook response",
      status: response.status,
    });
    return null;
  }
  return {
    createdAt: Math.floor(Date.now() / 1000),
    endpointId: endpoint.id,
    secret: endpoint.secret,
    url,
    version: WEBHOOK_CONFIG_VERSION,
  };
}

async function updateStripeWebhookEndpoint(
  existing: WebhookConfig,
  env: Env,
): Promise<WebhookConfig | null> {
  const parameters = new URLSearchParams({
    description: "PencilProof paid audit fulfillment",
    url: existing.url,
  });
  for (const event of STRIPE_WEBHOOK_EVENTS) {
    parameters.append("enabled_events[]", event);
  }
  const response = await stripeRequest(
    `/webhook_endpoints/${encodeURIComponent(existing.endpointId)}`,
    env,
    { body: parameters, method: "POST" },
  );
  const endpoint = await response.json() as {
    error?: { message?: string };
    id?: string;
    url?: string;
  };
  if (
    !response.ok
    || endpoint.id !== existing.endpointId
    || endpoint.url !== existing.url
  ) {
    console.error("Stripe webhook update failed", {
      message: endpoint.error?.message ?? "Invalid webhook response",
      status: response.status,
    });
    return null;
  }
  return {
    ...existing,
    version: WEBHOOK_CONFIG_VERSION,
  };
}

const createCheckoutSession = async (
  env: Env,
  deviceHash: string,
  analyticsSessionId = "",
) => {
  const stripePriceId = typeof env.STRIPE_PRICE_ID === "string"
    ? env.STRIPE_PRICE_ID.trim()
    : "";
  if (!/^price_[A-Za-z0-9]+$/.test(stripePriceId)) {
    throw new CheckoutError(
      "stripe_price_id_invalid",
      "Stripe price is not configured",
    );
  }

  const stripeSecretKey = typeof env.STRIPE_SECRET_KEY === "string"
    ? env.STRIPE_SECRET_KEY.trim()
    : "";
  if (!stripeSecretKey) {
    throw new CheckoutError(
      "stripe_secret_key_invalid",
      "Stripe secret key is not configured",
    );
  }

  const parameters = new URLSearchParams({
    allow_promotion_codes: "true",
    "cancel_url": `${env.PUBLIC_SITE_ORIGIN}/#pricing`,
    "line_items[0][quantity]": "1",
    "managed_payments[enabled]": "true",
    ...( /^[A-Za-z0-9_-]{20,80}$/.test(analyticsSessionId)
      ? { "metadata[pencilproof_analytics_session]": analyticsSessionId }
      : {}),
    "metadata[pencilproof_device_hash]": deviceHash,
    "metadata[pencilproof_product]": PRODUCT_CODE,
    mode: "payment",
    "success_url": `${env.SITE_ORIGIN}/success?session_id={CHECKOUT_SESSION_ID}`,
  });
  parameters.set("line_items[0][price]", stripePriceId);

  const response = await stripeRequest("/checkout/sessions", env, {
    body: parameters,
    method: "POST",
  });
  const session = await response.json() as StripeCheckoutSession & {
    error?: { code?: string; message?: string; param?: string };
  };
  if (
    !response.ok
    || !session.url
    || !session.url.startsWith("https://checkout.stripe.com/")
  ) {
    const stripeError = session.error;
    const errorDetails = [
      stripeError?.code,
      stripeError?.param,
      stripeError?.message,
    ].filter(Boolean).join(" ").toLowerCase();
    const code: CheckoutErrorCode =
      errorDetails.includes("tax code")
        || errorDetails.includes("tax_code")
        || errorDetails.includes("eligible product")
        ? "stripe_product_ineligible"
        : errorDetails.includes("managed payments")
          || errorDetails.includes("managed_payments")
          ? "managed_payments_unavailable"
          : "stripe_api_rejected";
    throw new CheckoutError(
      code,
      stripeError?.message ?? "Stripe checkout session failed",
    );
  }
  return session;
};

const retrieveCheckoutSession = async (sessionId: string, env: Env) => {
  if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) return null;
  const response = await stripeRequest(
    `/checkout/sessions/${encodeURIComponent(sessionId)}`,
    env,
  );
  if (!response.ok) return null;
  return response.json() as Promise<StripeCheckoutSession>;
};

const retrieveCheckoutLineItems = async (sessionId: string, env: Env) => {
  const response = await stripeRequest(
    `/checkout/sessions/${encodeURIComponent(sessionId)}/line_items?limit=2`,
    env,
  );
  if (!response.ok) return null;
  return response.json() as Promise<StripeCheckoutLineItems>;
};

const retrieveCheckoutSessionsForPaymentIntent = async (
  paymentIntentId: string,
  env: Env,
) => {
  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) return null;
  const parameters = new URLSearchParams({
    limit: "2",
    payment_intent: paymentIntentId,
  });
  const response = await stripeRequest(
    `/checkout/sessions?${parameters.toString()}`,
    env,
  );
  if (!response.ok) return null;
  return response.json() as Promise<StripeCheckoutSessions>;
};

const retrieveRecentRevocationEvents = async (env: Env) => {
  const parameters = new URLSearchParams({ limit: "100" });
  for (const event of STRIPE_WEBHOOK_EVENTS.slice(2)) {
    parameters.append("types[]", event);
  }
  const response = await stripeRequest(
    `/events?${parameters.toString()}`,
    env,
  );
  if (!response.ok) return null;
  return response.json() as Promise<StripeEvents>;
};

const isPaidPencilProofSession = (session: StripeCheckoutSession | null) => {
  const tax = session?.total_details?.amount_tax;
  return Boolean(
    session
    && session.status === "complete"
    && session.payment_status === "paid"
    && session.mode === "payment"
    && session.managed_payments?.enabled === true
    && typeof session.amount_subtotal === "number"
    && Number.isInteger(session.amount_subtotal)
    && session.amount_subtotal > 0
    && typeof tax === "number"
    && Number.isInteger(tax)
    && tax >= 0
    && session.total_details?.amount_discount === 0
    && session.total_details?.amount_shipping === 0
    && session.amount_total === session.amount_subtotal + tax
    && typeof session.currency === "string"
    && /^[a-z]{3}$/i.test(session.currency)
    && session.metadata?.pencilproof_product === PRODUCT_CODE
  );
};

const hasExactPencilProofLineItem = (
  lineItems: StripeCheckoutLineItems | null,
  expectedPriceId: string,
) => Boolean(
  lineItems
  && lineItems.has_more === false
  && lineItems.data?.length === 1
  && lineItems.data[0]?.quantity === 1
  && lineItems.data[0]?.price?.id === expectedPriceId
);

const hexToBytes = (value: string) => {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

export const verifyStripeSignature = async (
  payload: string,
  signatureHeader: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) => {
  if (!/^whsec_[A-Za-z0-9]+$/.test(secret)) return false;

  const parts = signatureHeader.split(",");
  const timestampValue = parts
    .find((part) => part.startsWith("t="))
    ?.slice(2);
  const timestamp = Number(timestampValue);
  if (
    !Number.isInteger(timestamp)
    || Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const key = await importSigningKey(secret);
  const signedPayload = encoder.encode(`${timestamp}.${payload}`);
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => hexToBytes(part.slice(3)))
    .filter(
      (value): value is Uint8Array<ArrayBuffer> => value !== null,
    );

  for (const signature of signatures) {
    if (
      await crypto.subtle.verify("HMAC", key, signature, signedPayload)
    ) {
      return true;
    }
  }
  return false;
};

const verifyAndStorePaidOrder = async (
  sessionId: string,
  stripeEventId: string,
  paidAt: number,
  env: Env,
) => {
  const session = await retrieveCheckoutSession(sessionId, env);
  if (!isPaidPencilProofSession(session)) return false;

  const expectedPriceId = env.STRIPE_PRICE_ID.trim();
  const lineItems = await retrieveCheckoutLineItems(sessionId, env);
  if (!hasExactPencilProofLineItem(lineItems, expectedPriceId)) return false;

  const deviceHash = session?.metadata?.pencilproof_device_hash ?? "";
  if (!/^[a-f0-9]{64}$/.test(deviceHash)) return false;

  const createdAt = Number.isInteger(paidAt) && paidAt > 0
    ? paidAt
    : Math.floor(Date.now() / 1000);
  const stored = await storePaidOrder({
    accessExpiresAt: createdAt + accessSeconds(env),
    amountTotal: session?.amount_total ?? 0,
    createdAt,
    currency: session?.currency?.toLowerCase() ?? "",
    deviceHash,
    priceId: expectedPriceId,
    redemptionCount: 0,
    sessionId,
    stripeEventId,
  }, env);
  if (stored) {
    const analyticsSessionId = session?.metadata?.pencilproof_analytics_session;
    if (/^[A-Za-z0-9_-]{20,80}$/.test(analyticsSessionId ?? "")) {
      await recordAnalyticsEvent({
        event: "payment_completed",
        sessionId: analyticsSessionId,
      }, env);
    }
  }
  return stored;
};

const resolvePaymentIntent = async (
  object: StripeEventObject,
) => {
  return (
    typeof object.payment_intent === "string"
    && /^pi_[A-Za-z0-9]+$/.test(object.payment_intent)
  ) ? object.payment_intent : null;
};

const revokeAccessForPaymentIntent = async (
  paymentIntentId: string,
  stripeEventId: string,
  revokedAt: number,
  reason: OrderRevocation["reason"],
  env: Env,
) => {
  const sessions = await retrieveCheckoutSessionsForPaymentIntent(
    paymentIntentId,
    env,
  );
  if (!sessions) return false;

  const session = sessions.data?.find((candidate) =>
    /^cs_(test_|live_)?[A-Za-z0-9]+$/.test(candidate.id)
    && candidate.metadata?.pencilproof_product === PRODUCT_CODE
  );
  if (!session) return true;

  return revokeOrder({
    reason,
    revokedAt,
    sessionId: session.id,
    stripeEventId,
  }, env);
};

const processRevocationEvent = async (
  event: StripeEvent,
  env: Env,
) => {
  const eventId = event.id ?? "";
  const eventCreated = event.created ?? Math.floor(Date.now() / 1000);
  const object = event.data?.object ?? {};
  if (event.type === "refund.created") {
    return /^evt_[A-Za-z0-9]+$/.test(eventId);
  }

  let reason: OrderRevocation["reason"] | null = null;
  let paymentIntentId: string | null = null;

  if (event.type === "charge.refunded") {
    if (object.refunded !== true) return true;
    paymentIntentId = await resolvePaymentIntent(object);
    reason = "refunded";
  } else if (event.type === "charge.dispute.created") {
    paymentIntentId = await resolvePaymentIntent(object);
    reason = "disputed";
  } else {
    return true;
  }

  if (!paymentIntentId || !reason || !/^evt_[A-Za-z0-9]+$/.test(eventId)) {
    return false;
  }
  return revokeAccessForPaymentIntent(
    paymentIntentId,
    eventId,
    eventCreated,
    reason,
    env,
  );
};

async function reconcileRecentRevocations(env: Env) {
  const events = await retrieveRecentRevocationEvents(env);
  if (!events || events.has_more === true || !Array.isArray(events.data)) {
    return false;
  }
  for (const event of events.data) {
    if (!await processRevocationEvent(event, env)) return false;
  }
  return true;
}

const handleStripeWebhook = async (request: Request, env: Env) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const payload = await request.text();
  const webhookSecret = await configuredWebhookSecret(env);
  if (!webhookSecret) {
    return new Response("Webhook is not configured", { status: 503 });
  }
  const validSignature = await verifyStripeSignature(
    payload,
    request.headers.get("Stripe-Signature") ?? "",
    webhookSecret,
  );
  if (!validSignature) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  const eventId = event.id ?? "";
  const eventCreated = event.created ?? Math.floor(Date.now() / 1000);
  const object = event.data?.object ?? {};

  if (
    event.type === "checkout.session.completed"
    || event.type === "checkout.session.async_payment_succeeded"
  ) {
    const sessionId = object.id ?? "";
    const stored = await verifyAndStorePaidOrder(
      sessionId,
      eventId,
      eventCreated,
      env,
    );
    if (!stored) {
      console.error("Paid order could not be verified", {
        eventId,
        sessionId,
      });
      return new Response("Order verification failed", { status: 503 });
    }
    return Response.json({ received: true });
  }

  const revoked = await processRevocationEvent(event, env);
  if (!revoked) {
    console.error("Paid access could not be revoked", {
      eventId,
      type: event.type,
    });
    return new Response("Access revocation failed", { status: 503 });
  }
  return Response.json({ received: true });
};

const handleCheckout = async (request: Request, env: Env) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const origin = request.headers.get("Origin");
  if (origin && origin !== env.SITE_ORIGIN) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({})) as {
      analyticsSessionId?: string;
    };
    // Webhook provisioning is best effort. It must not prevent a customer
    // from creating a Stripe Checkout Session. The success route can verify
    // the completed session directly if webhook setup is temporarily down.
    await ensureWebhookEndpoint(env).catch((error) => {
      console.error("Stripe webhook setup deferred", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    });
    const existingDeviceId = readCookie(request, DEVICE_COOKIE);
    const deviceId = validDeviceId(existingDeviceId)
      ? existingDeviceId
      : randomDeviceId();
    const deviceHash = await sha256Hex(deviceId);
    const session = await createCheckoutSession(
      env,
      deviceHash,
      body.analyticsSessionId ?? "",
    );
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (deviceId !== existingDeviceId) {
      headers.append("Set-Cookie", deviceCookie(deviceId));
    }
    return Response.json(
      { url: session.url },
      { headers },
    );
  } catch (error) {
    const code = error instanceof CheckoutError
      ? error.code
      : "checkout_internal_error";
    console.error("Checkout creation failed", {
      code,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json(
      { code, error: "Checkout is temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
};

const handleWebhookStatus = async (request: Request, env: Env) => {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET" },
    });
  }
  return Response.json(
    { ready: await webhookIsReady(env) },
    { headers: { "Cache-Control": "no-store" } },
  );
};

const analyticsCorsHeaders = (env: Env) => ({
  "Access-Control-Allow-Origin": env.PUBLIC_SITE_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
});

const handleAnalytics = async (request: Request, env: Env) => {
  const headers = analyticsCorsHeaders(env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST" && request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...headers, Allow: "GET, POST, OPTIONS" },
    });
  }
  const response = await analyticsStub(env).fetch(
    new Request(`https://analytics.internal${new URL(request.url).pathname}`, {
      method: request.method,
      headers: request.headers,
      body: request.method === "POST" ? await request.text() : undefined,
    }),
  );
  const responseHeaders = new Headers(response.headers);
  Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
};

const handleSuccess = async (request: Request, env: Env) => {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id") ?? "";
  const deviceId = readCookie(request, DEVICE_COOKIE);
  if (!validDeviceId(deviceId)) {
    return redirect(`${env.SITE_ORIGIN}/recover?reason=device_missing`);
  }
  const deviceHash = await sha256Hex(deviceId);

  let redemption = await redeemOrder(sessionId, deviceHash, env);
  if (!redemption.allowed && redemption.reason === "not_found") {
    const stored = await verifyAndStorePaidOrder(
      sessionId,
      "redirect_fallback",
      Math.floor(Date.now() / 1000),
      env,
    );
    if (stored) redemption = await redeemOrder(sessionId, deviceHash, env);
  }

  if (!redemption.allowed || typeof redemption.expiresAt !== "number") {
    const reason = redemption.reason === "device_mismatch"
      ? "device_mismatch"
      : redemption.reason === "expired"
        ? "expired"
        : redemption.reason === "revoked"
          ? "revoked"
        : "unverified";
    if (reason !== "unverified") {
      return redirect(`${env.SITE_ORIGIN}/recover?reason=${reason}`);
    }
    return redirect(`${env.PUBLIC_SITE_ORIGIN}/?payment=unverified#pricing`);
  }

  const maxAge = Math.max(
    1,
    redemption.expiresAt - Math.floor(Date.now() / 1000),
  );
  const token = await createAccessToken(
    sessionId,
    deviceHash,
    env.SESSION_SECRET,
    maxAge,
  );
  return redirect(`${env.SITE_ORIGIN}/analyze/`, {
    "Set-Cookie": accessCookie(token, maxAge),
  });
};

const hasAccess = async (
  request: Request,
  env: Env,
): Promise<OrderRedeemResult> => {
  const token = readCookie(request, ACCESS_COOKIE);
  const deviceId = readCookie(request, DEVICE_COOKIE);
  if (!token || !validDeviceId(deviceId)) {
    return { allowed: false, reason: "not_found" };
  }
  const payload = await verifyAccessToken(token, env.SESSION_SECRET);
  if (!payload) return { allowed: false, reason: "expired" };
  if (payload.did !== await sha256Hex(deviceId)) {
    return { allowed: false, reason: "device_mismatch" };
  }
  return authorizeOrder(payload.sid, payload.did, env);
};

const recoverPage = (reason = "") => {
  const message = reason === "device_missing" || reason === "device_mismatch"
    ? "This purchase is linked to the browser that opened checkout. Open this page in that original browser, or email support@pencilproof.com with your Stripe receipt for help."
    : reason === "expired"
      ? "This purchase's 30-day access period has ended."
      : reason === "revoked"
        ? "Access to this audit ended because the payment was refunded or disputed. Email support@pencilproof.com if you believe this is an error."
      : "Enter the Checkout Session ID from your original PencilProof return link. Access can be restored only in the browser that completed checkout.";
  const headers = {
    ...noStoreHeaders,
    "Content-Security-Policy":
      noStoreHeaders["Content-Security-Policy"].replace(
        "form-action 'none'",
        "form-action 'self'",
      ),
    "Content-Type": "text/html; charset=utf-8",
  };
  return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Restore access | PencilProof</title>
    <style>
      :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f4ee;color:#11233b;font:16px/1.5 Arial,sans-serif}.card{width:min(560px,calc(100% - 32px));padding:40px;border:1px solid #d9d7cf;background:#fff;box-shadow:0 18px 50px rgba(17,35,59,.08)}.brand{font-weight:800}h1{margin:24px 0 10px;font:700 34px/1.1 Georgia,serif}p{color:#596675}label{display:block;margin:24px 0 8px;font-weight:700}input{width:100%;padding:13px;border:1px solid #a9b0b8;font:inherit}button{margin-top:14px;padding:13px 18px;border:0;background:#11233b;color:#fff;font:700 16px Arial,sans-serif;cursor:pointer}a{color:#17633a}
    </style>
  </head>
  <body>
    <main class="card">
      <div class="brand">PencilProof</div>
      <h1>Restore your audit</h1>
      <p>${message}</p>
      <form action="/recover/access" method="get">
        <label for="session_id">Checkout Session ID</label>
        <input id="session_id" name="session_id" pattern="cs_[A-Za-z0-9_]+" required autocomplete="off">
        <button type="submit">Restore access</button>
      </form>
      <p><a href="mailto:support@pencilproof.com">Contact PencilProof support</a></p>
    </main>
  </body>
</html>`, { headers });
};

export const handleRequest = async (request: Request, env: Env) => {
  const url = new URL(request.url);

  if (url.pathname === "/") {
    return redirect(env.PUBLIC_SITE_ORIGIN);
  }
  if (url.pathname === "/handoff" || url.pathname === "/handoff/") {
    return handoffPage();
  }
  if (url.pathname === "/api/checkout") {
    return handleCheckout(request, env);
  }
  if (url.pathname === "/api/ai-import") {
    return handleAiImport(request, env);
  }
  if (url.pathname === "/api/stripe/webhook") {
    return handleStripeWebhook(request, env);
  }
  if (url.pathname === "/api/stripe/webhook/status") {
    return handleWebhookStatus(request, env);
  }
  if (
    url.pathname === "/api/analytics/event"
    || url.pathname === "/api/analytics/summary"
  ) {
    return handleAnalytics(request, env);
  }
  if (url.pathname === "/success" || url.pathname === "/success/") {
    return handleSuccess(request, env);
  }
  if (url.pathname === "/recover" || url.pathname === "/recover/") {
    return recoverPage(url.searchParams.get("reason") ?? "");
  }
  if (
    url.pathname === "/recover/access"
    || url.pathname === "/recover/access/"
  ) {
    return handleSuccess(request, env);
  }
  if (url.pathname === "/logout" || url.pathname === "/logout/") {
    return redirect(env.PUBLIC_SITE_ORIGIN, {
      "Set-Cookie":
        `${ACCESS_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
    });
  }

  if (url.pathname.startsWith("/api/")) {
    return new Response("Not found", {
      status: 404,
      headers: noStoreHeaders,
    });
  }

  const protectedPath = url.pathname === "/analyze"
    || url.pathname.startsWith("/analyze/")
    || url.pathname.startsWith("/_next/static/chunks/app/analyze/");
  if (protectedPath) {
    const access = await hasAccess(request, env);
    if (access.allowed) return env.ASSETS.fetch(request);
    const location = access.reason === "revoked"
      ? `${env.SITE_ORIGIN}/recover?reason=revoked`
      : `${env.SITE_ORIGIN}/handoff?reason=access_required`;
    return redirect(location, {
      "Set-Cookie":
        `${ACCESS_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
    });
  }

  return env.ASSETS.fetch(request);
};

export default {
  fetch: handleRequest,
};
