import { accountCookie, accountOwner, accountRoleCookie, accountStub, clearAccountCookie, clearAccountRoleCookie, verifyAccountRoleSession, verifyProviderToken, verifyUserSession, type AccountRole, type AccountRoleRequest } from "./accounts.ts";
import { fullSalesCoachPlaybook } from "./salesCoachPlaybook.ts";

const ACCESS_COOKIE = "pp_access";
const USER_COOKIE = "pp_user";
const ROLE_COOKIE = "pp_role";
const DEVICE_COOKIE = "pp_device";
const PRODUCT_CODE = "full_quote_audit_v1";
const SALESPERSON_PRODUCT_CODE = "salesperson_plan_v1";
const SALESPERSON_CREDIT_AMOUNT_CENTS = 2000;
const DEFAULT_ACCESS_SECONDS = 60 * 60 * 24 * 30;
const DEVICE_COOKIE_SECONDS = 60 * 60 * 24 * 400;
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const WEBHOOK_CONFIG_VERSION = 4;
const ORDER_RETENTION_MILLISECONDS = 1000 * 60 * 60 * 24 * 400;
const QUOTE_HANDOFF_KEY = "pencilproof:pending-import";
const QUOTE_HANDOFF_TYPE = "pencilproof:quote-handoff:v1";
const ANALYTICS_RETENTION_MILLISECONDS = 1000 * 60 * 60 * 24 * 400;
const ANALYTICS_MAX_FEEDBACK = 500;
const PHONE_SESSION_MAX_AGE_MILLISECONDS = 15 * 60 * 1000;
const PHONE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{24,80}$/;
const PHONE_SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,120}$/;
const PHONE_SESSION_CHUNK_LIMIT = 1024 * 1024;
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
const GEMINI_MAX_ATTEMPTS = 3;
const GEMINI_RETRY_BASE_DELAY_MS = 350;
const GEMINI_RETRY_MAX_DELAY_MS = 2500;
const STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.deleted",
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
  acceptWebSocket?(socket: WebSocket): void;
  getWebSockets?(): WebSocket[];
};

export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  ACCESS_MAX_AGE_SECONDS?: string;
  ANALYTICS_DASHBOARD_PASSWORD?: string;
  ANALYTICS_DASHBOARD_USERNAME?: string;
  ORDERS: DurableObjectNamespaceLike;
  ANALYTICS: DurableObjectNamespaceLike;
  ACCOUNTS: DurableObjectNamespaceLike;
  PHONE_SESSIONS: DurableObjectNamespaceLike;
  PUBLIC_SITE_ORIGIN: string;
  SESSION_SECRET: string;
  SITE_ORIGIN: string;
  STRIPE_PRICE_ID: string;
  STRIPE_SALESPERSON_PRICE_ID?: string;
  STRIPE_SALESPERSON_PROMOTION_CODE_ID?: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET?: string;
  GEMINI_API_KEY?: string;
  CLERK_ISSUER?: string;
  CLERK_JWKS_URL?: string;
  CLERK_AUDIENCE?: string;
  RESEND_API_KEY?: string;
  MARKETING_FROM_EMAIL?: string;
  MARKETING_REPLY_TO?: string;
  MARKETING_BUSINESS_ADDRESS?: string;
  MARKETING_ALERT_EMAIL?: string;
}

const AI_IMPORT_PROMPT = `You are PencilProof's document extraction engine for US automobile dealer buyer's orders, finance worksheets, F&I menus, lease worksheets, and payment quotes.

Return ONLY one JSON object with exactly these keys: vehicle, vin, sellingPrice, tax, govFees, docFee, serviceContract, gap, prepaidMaintenance, tireWheel, accessories, tradeValue, tradePayoff, cashDown, rebate, apr, term, quotedPayment, productItems, offerMatrix, warnings.
Use null when a value is not explicitly printed or cannot be tied to a label with high confidence. Never guess, calculate, or copy a nearby total into a component field. Numbers must be numeric, not strings.

Vehicle identity is required whenever the document prints it:
- Read the vehicle year, make, model, trim, and any clearly printed series or drivetrain from the vehicle-description line, buyer's-order header, or VIN-decoding section.
- Return vehicle as one plain string in the document's order, preserving the trim/series words exactly enough for a customer to recognize the vehicle. For example: "2017 Toyota Tundra CrewMax TRD Pro" or "2024 Cadillac CT5-V Blackwing".
- If the model returns vehicle as an object internally, convert it to that one string before returning JSON. Do not leave vehicle null when a year plus make/model is visible anywhere in the document. If only a partial identity is readable, return the readable portion and add a warning rather than inventing the missing trim.
- vin is the 17-character VIN when it is clearly printed and readable. Preserve it exactly after removing spaces or hyphens. Return null when it is absent or uncertain; never reconstruct a VIN from nearby characters.

This is a FINANCE-FIRST parser:
- sellingPrice means the base selling/sales price of the vehicle. Do not use MSRP, asking price, total purchase, amount financed, or a price that already includes add-ons when a base sales price is present.
- tax is the printed sales-tax dollar amount, not the tax rate. govFees is the sum of every clearly itemized DMV, license, title, registration, transfer, smog/emissions, tire, electronic-filing, and other government/official fee when those rows are present. docFee is documentation/doc processing only; keep a separately labeled electronic filing fee in govFees unless the document clearly combines it with the documentation fee. Do not omit a fee row just because TOTAL SALES AMOUNT is also printed.
- rebate is only a printed rebate/discount/incentive credit. Never treat a dealer discount as a second rebate when the document uses the discount to arrive at selling price. Preserve the document's signed convention and do not double-count it.
- serviceContract includes VSC, vehicle service contract, extended service agreement, warranty, or protection plan. gap is GAP/negative-equity protection. prepaidMaintenance includes maintenance/service plans, including labels such as "Mitsubishi Maintenance", "ToyotaCare Maintenance", "Prepaid Maintenance", or a standalone "Maintenance" product. Do not put a separately priced maintenance product in accessories. tireWheel includes tire, wheel, road-hazard, dent, windshield, or appearance protection when separately priced. accessories includes connected-car, LoJack, Zurich Shield, paint protection, tint, nitrogen, alarm, theft, aftermarket accessories, and other dealer products not matching the prior categories.
- productItems must list every clearly itemized optional product exactly once, preserving its printed name and exact printed dollar amount. Each item must be an object with name, amount, and category, where category is exactly one of serviceContract, gap, prepaidMaintenance, tireWheel, or accessories. Use the surrounding printed label to choose the category; do not classify a product from its brand name alone. If the product list is incomplete or an amount is ambiguous, return productItems as an empty array and put a short uncertainty note in warnings. When productItems is non-empty, the sum of its amounts for each category must equal that category field. Never put a different amount for the same product in warnings.
- tradeValue is the allowance for the customer's trade. tradePayoff is the amount owed on that trade. cashDown is customer cash/down payment, not trade equity, rebate, or total due at signing. quotedPayment is the labeled monthly payment, never total payments or amount financed.
- apr is the finance APR percentage. term is the loan term in months. Do not interpret a model number, page number, date, residual percentage, or money factor as APR or term. A cash purchase may be printed as "1 Months @ 0%" or a one-payment cash transaction; return apr: 0 and term: 1. For that cash case only, quotedPayment is the clearly labeled CASH DUE / FINANCE AMOUNT or one-payment amount so PencilProof can reconcile the total. For a financed quote, never put total cash due, amount financed, or total payments into quotedPayment.
- Prefer a directly labeled value over a nearby subtotal. When a line contains several amounts, choose the amount in the value column immediately associated with that label. Ignore grand totals when an itemized component is available.
- A lease or purchase section can appear beside another scenario. Identify whether the document is finance or lease. For PencilProof, extract the primary finance/buyer-order scenario when clearly identified. Never mix trade, rebates, or payment values from a separate scenario.
- If the document contains multiple payment choices, return every clearly printed choice in offerMatrix.options. Each option must contain type (finance or lease), cashDown, term, and payment, plus apr, rebate, or purchaseOption only when explicitly printed. Payment matrices may run either direction: cash-down choices can be columns with terms as rows, or cash-down choices can be rows with terms as columns. Transpose the table when needed and never treat the whole header row as one selected cash-down value. Do not collapse a payment-options table into one choice. Use offerMatrix: null when no multiple-choice table is present.
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

const normalizeImportedVin = (value: unknown) => {
  if (typeof value !== "string") return null;
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Gemini may preserve an OCR look-alike even when the printed VIN is clear.
  // I/O/Q are impossible in a VIN, so normalize only those characters before
  // applying the strict 17-character check.
  const normalized = compact.replace(/I/g, "1").replace(/[OQ]/g, "0");
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(normalized) ? normalized : null;
};

/**
 * Gemini occasionally follows the vehicle instruction by returning a small
 * identity object instead of the requested string. Keep that useful evidence
 * rather than silently dropping it at the API boundary. This only joins
 * explicitly labelled identity pieces; it never derives a trim from a VIN or
 * guesses a missing model.
 */
const removeRepeatedVehiclePhrase = (value: string) => {
  const tokens = value.split(" ").filter(Boolean);
  const searchLimit = Math.min(tokens.length - 1, 8);
  for (let start = 1; start < searchLimit; start += 1) {
    const maxSize = Math.min(6, Math.floor((tokens.length - start) / 2));
    for (let size = maxSize; size >= 2; size -= 1) {
      const first = tokens.slice(start, start + size).join(" ").toLowerCase();
      const second = tokens.slice(start + size, start + size * 2).join(" ").toLowerCase();
      if (first && first === second) {
        return [...tokens.slice(0, start + size), ...tokens.slice(start + size * 2)].join(" ");
      }
    }
  }
  return value;
};

export const normalizeImportedVehicle = (value: unknown) => {
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized ? removeRepeatedVehiclePhrase(normalized).slice(0, 120) : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const description = [record.description, record.name, record.label, record.vehicle]
    .find((candidate) => typeof candidate === "string" && candidate.trim());
  if (typeof description === "string") return normalizeImportedVehicle(description);
  const parts = ["year", "make", "model", "series", "trim", "bodyStyle", "drivetrain"]
    .map((key) => record[key])
    .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
    .map((part) => String(part).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return parts.length ? removeRepeatedVehiclePhrase(parts.join(" ")).slice(0, 120) : null;
};

const aiImportCorsHeaders = (env: Env) => ({
  ...noStoreHeaders,
  "Access-Control-Allow-Origin": env.PUBLIC_SITE_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});

const geminiRetryDelay = (response: Response, attempt: number) => {
  const retryAfter = Number(response.headers.get("Retry-After") ?? "");
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(GEMINI_RETRY_MAX_DELAY_MS, Math.max(0, retryAfter * 1000));
  }
  return Math.min(GEMINI_RETRY_MAX_DELAY_MS, GEMINI_RETRY_BASE_DELAY_MS * (attempt + 1));
};

const waitForGeminiRetry = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const fetchGeminiWithRetry = async (url: string, init: RequestInit) => {
  let response: Response | undefined;
  for (let attempt = 0; attempt < GEMINI_MAX_ATTEMPTS; attempt += 1) {
    response = await fetch(url, init);
    const retryable = [429, 500, 502, 503].includes(response.status);
    if (!retryable || attempt === GEMINI_MAX_ATTEMPTS - 1) return response;
    await waitForGeminiRetry(geminiRetryDelay(response, attempt));
  }
  return response as Response;
};

const randomUrlToken = (byteLength: number) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const phoneSessionHeaders = (request: Request, env: Env) => ({
  ...noStoreHeaders,
  "Access-Control-Allow-Origin": allowedPhoneSessionOrigin(request, env),
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
});

const allowedPhoneSessionOrigin = (request: Request, env: Env) => {
  const origin = request.headers.get("Origin");
  return origin === env.PUBLIC_SITE_ORIGIN || origin === env.SITE_ORIGIN
    ? origin
    : env.PUBLIC_SITE_ORIGIN;
};

const handlePhoneSession = async (request: Request, env: Env) => {
  const url = new URL(request.url);
  const headers = phoneSessionHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin && requestOrigin !== env.PUBLIC_SITE_ORIGIN && requestOrigin !== env.SITE_ORIGIN) {
    return new Response("Forbidden", { status: 403, headers });
  }

  if (request.method === "POST" && url.pathname === "/api/phone-session") {
    const sessionId = randomUrlToken(24);
    const token = randomUrlToken(32);
    const expiresAt = Date.now() + PHONE_SESSION_MAX_AGE_MILLISECONDS;
    const stub = env.PHONE_SESSIONS.get(env.PHONE_SESSIONS.idFromName(sessionId));
    const created = await stub.fetch(new Request("https://phone-session.internal/create", {
      method: "POST",
      body: JSON.stringify({ sessionId, token, expiresAt }),
      headers: { "Content-Type": "application/json" },
    }));
    if (!created.ok) return Response.json({ error: "PHONE_SESSION_UNAVAILABLE" }, { status: 503, headers });
    return Response.json({
      expiresAt,
      phoneUrl: `${env.SITE_ORIGIN}/phone?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`,
      sessionId,
      token,
    }, { headers });
  }

  if (request.method === "GET" && url.pathname === "/api/phone-session") {
    const sessionId = url.searchParams.get("session") ?? "";
    const token = url.searchParams.get("token") ?? "";
    const role = url.searchParams.get("role") ?? "";
    if (!PHONE_SESSION_ID_PATTERN.test(sessionId) || !PHONE_SESSION_TOKEN_PATTERN.test(token) || (role !== "desktop" && role !== "phone")) {
      return new Response("Invalid phone session", { status: 400, headers });
    }
    const stub = env.PHONE_SESSIONS.get(env.PHONE_SESSIONS.idFromName(sessionId));
    return stub.fetch(new Request(`https://phone-session.internal/connect?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}&role=${role}`, {
      method: "GET",
      headers: request.headers,
    }));
  }

  return new Response("Not found", { status: 404, headers });
};

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
    response = await fetchGeminiWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
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
    // A quota response is account-wide, not model-specific. Do not fan out to
    // every remaining model and make the limit worse after the bounded retry.
    if (response.status === 429) break;
    // A 400 can mean that a discovered model does not accept this multimodal
    // request/configuration. Continue to the next compatible model rather
    // than turning one model-specific rejection into a total import failure.
    if (![400, 404, 500, 502, 503].includes(response.status)) break;
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
    let providerCode = lastProviderBody === "MODEL_RETURNED_INVALID_JSON"
      ? "INVALID_RESPONSE"
      : !response
        ? "NO_MODEL_RESPONSE"
        : "UNKNOWN";
    try {
      const parsed = JSON.parse(providerBody) as { error?: { status?: string; code?: number; message?: string } };
      const providerStatus = parsed.error?.status;
      const providerMessage = parsed.error?.message ?? "";
      if (providerStatus === "UNAUTHENTICATED" || response?.status === 401 || /api key|authentication|credential/i.test(providerMessage)) providerCode = "AUTHENTICATION";
      else if (providerStatus === "PERMISSION_DENIED" || response?.status === 403 || /permission|disabled|not enabled/i.test(providerMessage)) providerCode = "PERMISSION";
      else if (providerStatus === "RESOURCE_EXHAUSTED" || response.status === 429) providerCode = "QUOTA";
      else if (response?.status === 400) providerCode = "BAD_REQUEST";
      else if (response?.status === 413) providerCode = "REQUEST_TOO_LARGE";
      else if (response?.status === 404) providerCode = "MODEL_UNAVAILABLE";
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
      "vehicle", "vin", "sellingPrice", "tax", "govFees", "docFee", "serviceContract", "gap", "prepaidMaintenance", "tireWheel", "accessories", "tradeValue", "tradePayoff", "cashDown", "rebate", "apr", "term", "quotedPayment",
    ].flatMap((key) => {
      if (key === "vehicle") {
        const vehicle = normalizeImportedVehicle(parsed[key]);
        return vehicle ? [[key, vehicle]] : [];
      }
      if (key === "vin") {
        const vin = normalizeImportedVin(parsed[key]);
        return vin ? [[key, vin]] : [];
      }
      const value = numberOrNull(parsed[key]);
      return value === null ? [] : [[key, value]];
    }));
    const productCategories = new Set(["serviceContract", "gap", "prepaidMaintenance", "tireWheel", "accessories"]);
    const rawProductItems = Array.isArray(parsed.productItems) ? parsed.productItems : [];
    const productItems = Array.from(new Map(rawProductItems.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Record<string, unknown>;
      const name = typeof item.name === "string" ? item.name.trim().replace(/\s+/g, " ") : "";
      const amount = numberOrNull(item.amount);
      const category = typeof item.category === "string" ? item.category : "";
      if (!name || name.length > 120 || amount === null || amount <= 0 || amount > 30000 || !productCategories.has(category)) return [];
      return [{ name, amount: Number(amount.toFixed(2)), category }];
    }).map((item) => [`${item.category}:${item.name.toLowerCase()}:${item.amount}`, item])).values());
    const productTotals = productItems.reduce<Record<string, number>>((totals, item) => {
      totals[item.category] = Number(((totals[item.category] ?? 0) + item.amount).toFixed(2));
      return totals;
    }, {});
    const fieldsWithProductTotals = { ...fields } as Record<string, unknown>;
    productCategories.forEach((category) => {
      if (productTotals[category] !== undefined) fieldsWithProductTotals[category] = productTotals[category];
    });
    const rawWarnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item): item is string => typeof item === "string").slice(0, 12)
      : [];
    const productWarningPattern = /(?:product|accessor|add[- ]?on|protection|maintenance|service contract|warranty|connected|theft|appearance|ally|gap|tire|wheel).*\$\s*[\d,]+/i;
    const productSummary = productItems.length
      ? `Product details from the quote: ${productItems.map((item) => `${item.name} ($${item.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`).join(", ")}. Verify each item against the original document.`
      : null;
    const warnings = [
      ...(productItems.length ? rawWarnings.filter((warning) => !productWarningPattern.test(warning)) : rawWarnings),
      ...(productSummary ? [productSummary] : []),
    ];
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
    const selectionFields = new Set(["cashDown", "rebate", "apr", "term", "quotedPayment"]);
    const normalizedFields = offerMatrix
      ? Object.fromEntries(Object.entries(fieldsWithProductTotals).filter(([key]) => !selectionFields.has(key)))
      : fieldsWithProductTotals;
    return Response.json({ fields: normalizedFields, productItems, offerMatrix, warnings, fieldConfidence: Object.fromEntries(Object.keys(normalizedFields).map((key) => [key, "review"])), sourceType: "ai-vision" }, { headers });
  } catch {
    return Response.json({ error: "AI_IMPORT_INVALID_RESPONSE" }, { status: 502, headers });
  }
};

type AccessPayload = {
  did: string;
  exp: number;
  sid: string;
};

type EmailUnsubscribePayload = {
  email: string;
  purpose: "marketing-unsubscribe";
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
  customer?: string | null;
  subscription?: string | null;
  customer_details?: { email?: string | null } | null;
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
  customer?: string | null;
  subscription?: string | null;
  metadata?: Record<string, string> | null;
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

const accountReadCacheablePaths = new Set([
  "/user",
  "/access",
  "/access-summary",
  "/account-summary",
  "/account-identity",
  "/marketing",
  "/salesperson",
]);
type AccountReadState = {
  cache: Map<string, { cachedAt: number; value: Record<string, unknown> | null }>;
  inFlight: Map<string, Promise<Record<string, unknown> | null>>;
};
const accountReadStates = new WeakMap<object, AccountReadState>();
const accountReadState = (env: Env): AccountReadState => {
  const binding = env.ACCOUNTS as object;
  const existing = accountReadStates.get(binding);
  if (existing) return existing;
  const created: AccountReadState = { cache: new Map(), inFlight: new Map() };
  accountReadStates.set(binding, created);
  return created;
};

// A browser can refresh its Clerk token without changing the PencilProof
// account. Keep a short-lived per-binding copy of the last successful session
// response so an older client cannot turn that background refresh into a
// Durable Object request every minute. Explicit force calls still reconcile
// account changes immediately.
const ACCOUNT_SESSION_BOOTSTRAP_CACHE_TTL_MS = 5 * 60 * 1000;
type AccountSessionBootstrapState = {
  cache: Map<string, { cachedAt: number; value: Record<string, unknown> }>;
  failedUntil: Map<string, number>;
  inFlight: Map<string, Promise<Record<string, unknown> | null>>;
};
const accountSessionBootstrapStates = new WeakMap<object, AccountSessionBootstrapState>();
const accountSessionBootstrapState = (env: Env): AccountSessionBootstrapState => {
  const binding = env.ACCOUNTS as object;
  const existing = accountSessionBootstrapStates.get(binding);
  if (existing) return existing;
  const created: AccountSessionBootstrapState = { cache: new Map(), failedUntil: new Map(), inFlight: new Map() };
  accountSessionBootstrapStates.set(binding, created);
  return created;
};

const accountSessionGuardRequest = async (env: Env, key: string) => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(key)));
  return new Request(`${new URL(env.SITE_ORIGIN).origin}/__pencilproof-session-guard/${base64UrlEncode(digest)}`);
};

const accountSessionGuardActive = async (env: Env, key: string) => {
  try {
    const cacheStorage = (globalThis as typeof globalThis & { caches?: CacheStorage }).caches;
    if (!cacheStorage) return false;
    return Boolean(await cacheStorage.default.match(await accountSessionGuardRequest(env, key)));
  } catch {
    return false;
  }
};

const markAccountSessionGuard = async (env: Env, key: string) => {
  try {
    const cacheStorage = (globalThis as typeof globalThis & { caches?: CacheStorage }).caches;
    if (!cacheStorage) return;
    await cacheStorage.default.put(
      await accountSessionGuardRequest(env, key),
      new Response("retry later", { headers: { "Cache-Control": "max-age=300" } }),
    );
  } catch {
    // The in-memory guard below remains active when the edge cache is absent.
  }
};

const accountSessionBootstrapCall = async (
  env: Env,
  key: string,
  body: Record<string, unknown>,
  force: boolean,
) => {
  const state = accountSessionBootstrapState(env);
  const now = Date.now();
  if (!force) {
    const cached = state.cache.get(key);
    if (cached && now - cached.cachedAt < ACCOUNT_SESSION_BOOTSTRAP_CACHE_TTL_MS) return cached.value;
    const failedUntil = state.failedUntil.get(key) ?? 0;
    if (failedUntil > now) return null;
    if (await accountSessionGuardActive(env, key)) {
      state.failedUntil.set(key, now + ACCOUNT_SESSION_BOOTSTRAP_CACHE_TTL_MS);
      return null;
    }
  }
  const pending = state.inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const value = await accountCall(env, "/session-bootstrap", body);
    if (value?.user && typeof value.user === "object") {
      state.cache.set(key, { cachedAt: Date.now(), value });
      state.failedUntil.delete(key);
      while (state.cache.size > 256) {
        const oldestKey = state.cache.keys().next().value;
        if (typeof oldestKey !== "string") break;
        state.cache.delete(oldestKey);
      }
    } else if (!force) {
      // If the namespace is temporarily unavailable, do not let an older
      // browser retry the same failed Durable Object request every minute.
      state.failedUntil.set(key, Date.now() + ACCOUNT_SESSION_BOOTSTRAP_CACHE_TTL_MS);
      await markAccountSessionGuard(env, key);
    }
    return value;
  })();
  state.inFlight.set(key, request);
  try {
    return await request;
  } finally {
    if (state.inFlight.get(key) === request) state.inFlight.delete(key);
  }
};

const accountCall = async (env: Env, path: string, body: Record<string, unknown>) => {
  if (!env.ACCOUNTS) return null;
  const state = accountReadState(env);
  const cacheable = accountReadCacheablePaths.has(path);
  const cacheKey = cacheable ? `${path}:${JSON.stringify(body)}` : "";
  const now = Date.now();
  if (cacheable) {
    const cached = state.cache.get(cacheKey);
    if (cached && now - cached.cachedAt < 10_000) return cached.value;
    const pending = state.inFlight.get(cacheKey);
    if (pending) return pending;
  }
  const request = (async () => {
    const response = await accountStub(env).fetch(new Request(`https://accounts.internal${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    const value = response.ok ? await response.json() as Record<string, unknown> : null;
    if (cacheable) {
      state.cache.set(cacheKey, { cachedAt: Date.now(), value });
      if (state.cache.size > 256) {
        const oldestKey = state.cache.keys().next().value;
        if (typeof oldestKey === "string") state.cache.delete(oldestKey);
      }
    }
    return value;
  })();
  if (!cacheable) return request;
  state.inFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (state.inFlight.get(cacheKey) === request) state.inFlight.delete(cacheKey);
  }
};

const recordMarketingActivity = async (
  env: Env,
  userId: string | null,
  event: "scan_ready" | "checkout_started" | "purchase_completed",
) => {
  if (!userId) return;
  await accountCall(env, "/marketing-activity", { event, userId });
};

type MarketingCandidate = {
  email: string;
  lastCheckoutAt: number | null;
  lastPurchaseAt: number | null;
  lastScanAt: number | null;
  lastSentAt: number | null;
  passExpiresAt: number | null;
  userId: string;
};

const marketingCandidates = (value: unknown): MarketingCandidate[] =>
  Array.isArray(value)
    ? value.filter((candidate): candidate is Record<string, unknown> => Boolean(candidate && typeof candidate === "object"))
      .map((candidate) => ({
        email: typeof candidate.email === "string" ? candidate.email : "",
        lastCheckoutAt: typeof candidate.lastCheckoutAt === "number" ? candidate.lastCheckoutAt : null,
        lastPurchaseAt: typeof candidate.lastPurchaseAt === "number" ? candidate.lastPurchaseAt : null,
        lastScanAt: typeof candidate.lastScanAt === "number" ? candidate.lastScanAt : null,
        lastSentAt: typeof candidate.lastSentAt === "number" ? candidate.lastSentAt : null,
        passExpiresAt: typeof candidate.passExpiresAt === "number" ? candidate.passExpiresAt : null,
        userId: typeof candidate.userId === "string" ? candidate.userId : "",
      }))
    : [];

type SalespersonMarketingCandidate = {
  email: string;
  lastSentAt: number | null;
  userId: string;
};

const salespersonMarketingCandidates = (value: unknown): SalespersonMarketingCandidate[] =>
  Array.isArray(value)
    ? value.filter((candidate): candidate is Record<string, unknown> => Boolean(candidate && typeof candidate === "object"))
      .map((candidate) => ({
        email: typeof candidate.email === "string" ? candidate.email : "",
        lastSentAt: typeof candidate.lastSentAt === "number" ? candidate.lastSentAt : null,
        userId: typeof candidate.userId === "string" ? candidate.userId : "",
      }))
    : [];

const htmlEscape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character] ?? character));

const legacyMarketingEmailContent = (
  candidate: MarketingCandidate,
  now: number,
) => {
  const lastActivityAt = Math.max(candidate.lastScanAt ?? 0, candidate.lastCheckoutAt ?? 0);
  const hasRecentUnpaidActivity = lastActivityAt > (candidate.lastPurchaseAt ?? 0)
    && lastActivityAt >= now - 60 * 60 * 24 * 14;
  const hasActivePass = (candidate.passExpiresAt ?? 0) > now;
  const day = new Date(now * 1000).getUTCDay();

  if (hasRecentUnpaidActivity) {
    return {
      subject: "Your PencilProof audit is waiting",
      text: [
        "You started checking a dealer quote with PencilProof but did not finish checkout.",
        "Return to PencilProof to continue reviewing the deal. No subscription is required.",
      ],
      html: "<p>You started checking a dealer quote with PencilProof but did not finish checkout.</p><p>Return to PencilProof to continue reviewing the deal. No subscription is required.</p>",
    };
  }

  if (candidate.lastPurchaseAt && !hasActivePass) {
    return {
      subject: "Ready for another PencilProof 30-Day Pass?",
      text: [
        "Your previous PencilProof Pass has ended.",
        "Get another one-time 30-Day Pass whenever you are ready to review a new dealer quote.",
      ],
      html: "<p>Your previous PencilProof Pass has ended.</p><p>Get another one-time 30-Day Pass whenever you are ready to review a new dealer quote.</p>",
    };
  }

  const tip = day === 2
    ? {
      subject: "PencilProof tip: review the amount financed",
      text: "A low monthly payment can hide a longer term or expensive add-ons. Compare the amount financed, APR, term, and total of payments—not only the payment.",
      html: "<p>A low monthly payment can hide a longer term or expensive add-ons.</p><p>Compare the amount financed, APR, term, and total of payments—not only the payment.</p>",
    }
    : {
      subject: "PencilProof tip: ask for every fee in writing",
      text: "Ask the dealership to itemize the selling price, taxes, government fees, documentation fee, and every optional product before you sign.",
      html: "<p>Ask the dealership to itemize the selling price, taxes, government fees, documentation fee, and every optional product before you sign.</p>",
    };

  return tip;
};

type MarketingEmailContent = { subject: string; text: string | string[]; html: string; preheader?: string };

const marketingRotationIndex = (now: number, length: number) =>
  Math.floor(now / (60 * 60 * 24 * 3)) % length;

const consumerLessons = [
  {
    hook: "The monthly payment is the result of the deal, not the whole deal.",
    title: "Put the four financing numbers side by side",
    paragraphs: [
      "A payment can move because the amount financed, APR, loan term, or cash down changed. Looking at only the payment makes it hard to tell which lever the dealership used.",
      "Write down those four numbers from the worksheet before discussing a revised payment. Then compare the total of payments so a lower monthly number does not hide a longer or more expensive loan.",
    ],
    checklist: ["Amount financed", "APR", "Loan term", "Total of payments"],
    question: "Which exact number changed to produce this payment?",
  },
  {
    hook: "A fee is much easier to evaluate once it has a clear name and price.",
    title: "Turn the bottom of the worksheet into an itemized list",
    paragraphs: [
      "Ask for the selling price, government fees, documentation fee, taxes, and every dealer or protection product on separate lines. A bundled total can make optional charges look required.",
      "For each unfamiliar line, ask who charges it, what it provides, and whether it is required for this purchase. Keep the written answer with the quote you are comparing.",
    ],
    checklist: ["Selling price", "Government and documentation fees", "Taxes", "Optional products"],
    question: "Can you show me which of these charges are optional and remove them from the worksheet for comparison?",
  },
  {
    hook: "Optional products should earn their place one at a time.",
    title: "Separate the vehicle from the add-ons",
    paragraphs: [
      "Service contracts, GAP, maintenance, tire-and-wheel coverage, and accessories solve different problems. Review the price and terms of each product separately instead of accepting one package total.",
      "Compare the payment and amount financed with every optional product removed. Then add back only the products whose coverage, exclusions, cancellation terms, and price make sense to you.",
    ],
    checklist: ["Individual product price", "Coverage and exclusions", "Cancellation terms", "Financed cost"],
    question: "What does the payment and amount financed look like with every optional product removed?",
  },
  {
    hook: "Your trade and your next vehicle are two separate pieces of the same worksheet.",
    title: "Make trade equity visible",
    paragraphs: [
      "A trade allowance is not the same as trade equity. Subtract the loan payoff from the allowance to see whether the trade contributes value or adds negative equity to the new amount financed.",
      "Keep the new vehicle selling price visible while reviewing the trade. That makes it harder for movement in one number to hide movement in the other.",
    ],
    checklist: ["Trade allowance", "Current payoff", "Positive or negative equity", "New vehicle selling price"],
    question: "Can you show the trade allowance and payoff as separate lines before they are applied to the new deal?",
  },
  {
    hook: "A longer term can lower today's payment while raising the total cost.",
    title: "Compare time as well as payment",
    paragraphs: [
      "When two offers have different terms, compare the APR, amount financed, finance charge, and total of payments—not just the monthly difference.",
      "Ask for the same deal at two loan terms. Seeing both worksheets makes the tradeoff between monthly comfort and long-term cost much easier to understand.",
    ],
    checklist: ["Monthly payment", "Number of payments", "Finance charge", "Total of payments"],
    question: "Can you show this exact deal at both terms without changing the products or cash down?",
  },
  {
    hook: "A written worksheet gives you something real to compare.",
    title: "Get the complete quote before deciding",
    paragraphs: [
      "A useful quote includes the vehicle, selling price, fees, taxes, trade figures, cash down, APR, term, payment, and optional products. Missing numbers make comparisons unreliable.",
      "Take a clear photo or request a PDF before leaving. PencilProof can organize the written figures so you can review what changed between versions.",
    ],
    checklist: ["Complete vehicle description", "Itemized price and fees", "Trade and cash down", "APR, term, and payment"],
    question: "May I have the complete itemized worksheet or buyer's order to review before I decide?",
  },
] as const;

const enrichConsumerEmail = (content: MarketingEmailContent, now: number): MarketingEmailContent => {
  const lesson = consumerLessons[marketingRotationIndex(now, consumerLessons.length)];
  const baseText = Array.isArray(content.text) ? content.text : [content.text];
  return {
    ...content,
    preheader: lesson.hook,
    text: [
      lesson.hook,
      ...baseText,
      lesson.title,
      ...lesson.paragraphs,
      "Quick quote checklist:",
      ...lesson.checklist.map((item) => `- ${item}`),
      `Ask this before you sign: ${lesson.question}`,
      "Beta offer: enter BETA1 in secure checkout to unlock the complete $39 Full Quote Audit for $1 while the promotion remains active. It is a one-time purchase, not a subscription.",
    ],
    html: `<p style="font-size:20px;line-height:1.45;font-weight:700;color:#0b1b34">${htmlEscape(lesson.hook)}</p>${content.html}<h2 style="font-size:22px;line-height:1.3;color:#0b1b34">${htmlEscape(lesson.title)}</h2>${lesson.paragraphs.map((paragraph) => `<p>${htmlEscape(paragraph)}</p>`).join("")}<h3 style="font-size:17px;color:#0b1b34">Quick quote checklist</h3><ul>${lesson.checklist.map((item) => `<li>${htmlEscape(item)}</li>`).join("")}</ul><div style="margin:22px 0;padding:18px;border-left:4px solid #f7c548;background:#f5f7fb"><strong>Ask this before you sign</strong><p style="margin:8px 0 0">${htmlEscape(lesson.question)}</p></div><div style="margin:22px 0;padding:18px;border-radius:10px;background:#0b1b34;color:#ffffff"><strong style="color:#f7c548">$1 beta offer</strong><p style="margin:8px 0 0">Enter <strong>BETA1</strong> in secure checkout to unlock the complete $39 Full Quote Audit for $1 while the promotion remains active. One-time purchase; no subscription.</p></div>`,
  };
};

export const marketingEmailContent = (
  candidate: MarketingCandidate,
  now: number,
): MarketingEmailContent => {
  const lastActivityAt = Math.max(candidate.lastScanAt ?? 0, candidate.lastCheckoutAt ?? 0);
  const hasRecentUnpaidActivity = lastActivityAt > (candidate.lastPurchaseAt ?? 0)
    && lastActivityAt >= now - 60 * 60 * 24 * 14;
  const hasActivePass = (candidate.passExpiresAt ?? 0) > now;

  const unfinishedAuditMessages: MarketingEmailContent[] = [
    {
      subject: "Your PencilProof audit is waiting",
      text: [
        "You started checking a dealer quote with PencilProof but did not finish checkout.",
        "Return to PencilProof to continue reviewing the deal. No subscription is required.",
      ],
      html: "<p>You started checking a dealer quote with PencilProof but did not finish checkout.</p><p>Return to PencilProof to continue reviewing the deal. No subscription is required.</p>",
    },
    {
      subject: "Before you sign, finish checking the quote",
      text: [
        "Your saved quote review is still waiting in PencilProof.",
        "Use it to compare the amount financed, APR, term, trade equity, and optional products before you make a decision.",
      ],
      html: "<p>Your saved quote review is still waiting in PencilProof.</p><p>Use it to compare the amount financed, APR, term, trade equity, and optional products before you make a decision.</p>",
    },
    {
      subject: "A second look can change the deal",
      text: [
        "PencilProof helps turn a dealer quote into a clearer list of numbers and questions.",
        "Open your unfinished review when you have a minute, then decide whether the full audit is useful for this purchase.",
      ],
      html: "<p>PencilProof helps turn a dealer quote into a clearer list of numbers and questions.</p><p>Open your unfinished review when you have a minute, then decide whether the full audit is useful for this purchase.</p>",
    },
    {
      subject: "Still shopping for the right numbers?",
      text: [
        "Your PencilProof quote review has not been purchased yet.",
        "Start with the free review and unlock the one-time 30-Day Pass only if you want the complete audit and saved access.",
      ],
      html: "<p>Your PencilProof quote review has not been purchased yet.</p><p>Start with the free review and unlock the one-time 30-Day Pass only if you want the complete audit and saved access.</p>",
    },
  ];

  const expiredPassMessages: MarketingEmailContent[] = [
    {
      subject: "Ready for another PencilProof 30-Day Pass?",
      text: [
        "Your previous PencilProof Pass has ended.",
        "Get another one-time 30-Day Pass whenever you are ready to review a new dealer quote.",
      ],
      html: "<p>Your previous PencilProof Pass has ended.</p><p>Get another one-time 30-Day Pass whenever you are ready to review a new dealer quote.</p>",
    },
    {
      subject: "Keep your next dealer quote easier to compare",
      text: [
        "PencilProof is available whenever a new quote lands in your inbox or on the dealership desk.",
        "A one-time 30-Day Pass gives you time to revisit the audit while you shop.",
      ],
      html: "<p>PencilProof is available whenever a new quote lands in your inbox or on the dealership desk.</p><p>A one-time 30-Day Pass gives you time to revisit the audit while you shop.</p>",
    },
  ];

  const generalMessages: MarketingEmailContent[] = [
    {
      subject: "What PencilProof helps you see before signing",
      text: [
        "PencilProof organizes the selling price, fees, APR, term, trade equity, payment, and optional products into a clearer review.",
        "The goal is simple: help you know what to ask before you sign.",
      ],
      html: "<p>PencilProof organizes the selling price, fees, APR, term, trade equity, payment, and optional products into a clearer review.</p><p>The goal is simple: help you know what to ask before you sign.</p>",
    },
    {
      subject: "PencilProof benefit: see beyond the monthly payment",
      text: [
        "A lower monthly payment may come from a longer term or added products.",
        "Compare the amount financed, APR, term, and total of payments—not only the payment.",
      ],
      html: "<p>A lower monthly payment may come from a longer term or added products.</p><p>Compare the amount financed, APR, term, and total of payments—not only the payment.</p>",
    },
    {
      subject: "PencilProof tip: ask for every fee in writing",
      text: "Ask the dealership to itemize the selling price, taxes, government fees, documentation fee, and every optional product before you sign.",
      html: "<p>Ask the dealership to itemize the selling price, taxes, government fees, documentation fee, and every optional product before you sign.</p>",
    },
    {
      subject: "PencilProof tip: separate the car from the add-ons",
      text: [
        "Review the vehicle price and financing first, then evaluate service contracts, GAP, maintenance, protection products, and accessories one by one.",
        "You should be able to say yes or no to each item independently.",
      ],
      html: "<p>Review the vehicle price and financing first, then evaluate service contracts, GAP, maintenance, protection products, and accessories one by one.</p><p>You should be able to say yes or no to each item independently.</p>",
    },
    {
      subject: "A free way to start reviewing your next quote",
      text: [
        "Upload the dealer's quote to PencilProof for a free first review.",
        "If you want the complete audit, the 30-Day Pass is a one-time purchase with no subscription.",
      ],
      html: "<p>Upload the dealer's quote to PencilProof for a free first review.</p><p>If you want the complete audit, the 30-Day Pass is a one-time purchase with no subscription.</p>",
    },
    {
      subject: "A simple car-buying question to ask today",
      text: [
        "Ask: 'Which numbers change if I remove every optional product?'",
        "That question can make the base vehicle deal, financing cost, and add-on prices easier to compare.",
      ],
      html: "<p>Ask: 'Which numbers change if I remove every optional product?'</p><p>That question can make the base vehicle deal, financing cost, and add-on prices easier to compare.</p>",
    },
  ];

  if (hasRecentUnpaidActivity) return enrichConsumerEmail(unfinishedAuditMessages[marketingRotationIndex(now, unfinishedAuditMessages.length)], now);
  if (candidate.lastPurchaseAt && !hasActivePass) return enrichConsumerEmail(expiredPassMessages[marketingRotationIndex(now, expiredPassMessages.length)], now);
  return enrichConsumerEmail(generalMessages[marketingRotationIndex(now, generalMessages.length)], now);
};

type MarketingCampaignKind = "educational" | "promotional";

type SalespersonTopic = {
  subject: string;
  paragraphs: [string, string, string];
  checklist: string[];
};

const salespersonTopics: SalespersonTopic[] = [
  {
    subject: "Earn trust before you present the vehicle",
    paragraphs: [
      "The strongest sales conversations start with the buyer's situation, not a list of features. Ask what they drive now, what they want to improve, and what would make the next vehicle feel like a good decision.",
      "Listen for priorities such as reliability, fuel cost, room, technology, payment comfort, or time pressure. Repeat the important point back in plain language so the buyer knows you heard it accurately.",
      "Only then connect a vehicle feature to that stated need. The explanation feels more useful when the buyer can see why it matters to their life instead of hearing specifications without context.",
    ],
    checklist: ["Ask open questions", "Reflect the buyer's priorities", "Connect features to needs", "Confirm the next step"],
  },
  {
    subject: "Find the real issue behind an objection",
    paragraphs: [
      "An objection is often a signal that something remains uncertain. Instead of answering immediately, ask what part of the offer feels least comfortable so you can separate price, payment, trust, vehicle fit, timing, and decision-maker concerns.",
      "Once the concern is clear, acknowledge it without arguing. Respond with one relevant fact, one comparison, or one option; a long speech can make a simple concern feel larger than it is.",
      "Finish by checking whether the answer solved the concern. If it did not, keep diagnosing instead of forcing a close before the buyer understands the choice.",
    ],
    checklist: ["Clarify the concern", "Acknowledge without arguing", "Answer the actual issue", "Check for resolution"],
  },
  {
    subject: "Separate a price objection from a payment objection",
    paragraphs: [
      "When a buyer says the price is too high, find out whether the discomfort is about the vehicle price, the monthly payment, the down payment, or the total cost. Each concern needs a different conversation.",
      "If the payment is the issue, review the term, APR, amount financed, trade equity, and optional products separately. Extending the term may lower the payment while increasing total interest, so it should never be presented as a free solution.",
      "If the vehicle price is the issue, return to the buyer's priorities and relevant alternatives. Do not hide the difference inside a longer loan term just to make one payment number look smaller.",
    ],
    checklist: ["Identify the exact discomfort", "Show amount financed", "Explain term and total cost", "Offer a relevant alternative"],
  },
  {
    subject: "Explain finance basics without burying the buyer in jargon",
    paragraphs: [
      "The amount financed is the balance being borrowed after the vehicle price, fees, trade equity, and down payment are combined. APR reflects the cost of credit, while the term controls how long the buyer makes payments.",
      "A lower payment can result from a longer term, a larger down payment, a lower amount financed, or a different rate. Show which variable changed instead of describing the payment as the whole deal.",
      "The buyer should be able to see the payment, APR, term, finance charge, and total of payments together. Clear explanations build trust even when the buyer decides not to proceed.",
    ],
    checklist: ["Amount financed", "APR", "Term", "Finance charge and total of payments"],
  },
  {
    subject: "Make the next step small enough to say yes to",
    paragraphs: [
      "A close does not always need to be a demand for a signature. When a buyer is interested but hesitant, ask for the smallest reasonable next step: compare two worksheets, appraise the trade, confirm the payment range, or schedule a return visit.",
      "Use a summary that reflects the buyer's own priorities and ask whether anything important remains uncovered. This invites a real answer and gives you a chance to solve the missing item.",
      "If the buyer is ready, confirm the decision clearly. If not, agree on what would need to change and when it would be helpful to follow up.",
    ],
    checklist: ["Summarize the buyer's priorities", "Ask what is missing", "Offer one concrete next step", "Confirm readiness"],
  },
  {
    subject: "Follow up with information, not pressure",
    paragraphs: [
      "Good follow-up adds something useful. Send the exact vehicle details, the numbers the buyer asked about, and one clear next step instead of a generic message that only asks whether they are still shopping.",
      "Use the buyer's language and priorities from the conversation. If they were comparing payment and fuel cost, address those points rather than restarting with unrelated features.",
      "Give the buyer an easy way to respond, such as choosing between two appointment times or asking one remaining question. Helpful follow-up keeps momentum while respecting the buyer's control.",
    ],
    checklist: ["Reference the buyer's priorities", "Add one useful fact", "Offer one clear next step", "Make replying easy"],
  },
];

export const salespersonEmailContent = (now: number, kind: MarketingCampaignKind): MarketingEmailContent => {
  if (kind === "promotional") {
    return {
      subject: "Salesperson Plan: use ALPHA1 for your first month at $1",
      preheader: "A clearer buyer conversation can become a repeatable referral process.",
      text: [
        "A clearer buyer conversation can become a repeatable referral process.",
        "If you are building a referral business around car buyers, the PencilProof Salesperson Plan gives you practical sales guidance and referral tracking in one place.",
        "Use code ALPHA1 at checkout to reduce the first month to $1. The discount applies once; later months renew at the regular plan price unless you cancel through the billing portal.",
        "A useful workflow is simple: learn the buyer's priorities, explain the worksheet clearly, separate price from payment, and follow up with one useful next step.",
        "Your feedback would be greatly appreciated. Tell us which salesperson tools, objection guides, or referral features would help you serve buyers better.",
        "Promotion code: ALPHA1 — first month $1",
      ],
      html: "<h2>Build a clearer process for every buyer conversation</h2><p>The Salesperson Plan helps you organize the questions, explanations, and follow-up that make a confusing worksheet easier for a customer to understand.</p><h3>Use ALPHA1</h3><p>Enter <strong>ALPHA1</strong> at checkout to reduce the first month to $1. The discount applies once; later months renew at the regular plan price unless you cancel through the billing portal.</p><h3>Put the offer to work</h3><p>Start with the buyer's priorities, explain the selling price and financing as separate pieces, answer the actual objection, and confirm one clear next step. Your feedback would be greatly appreciated; tell us which tools or guides would help you serve buyers better.</p><ul><li>Ask open questions before presenting</li><li>Separate price, payment, and financing</li><li>Answer the actual objection</li><li>Confirm one clear next step</li></ul>",
    };
  }

  const topicIndex = marketingRotationIndex(now, salespersonTopics.length);
  const topic = salespersonTopics[topicIndex];
  const conversationMoves = [
    "Before I show you a vehicle, what would make the next one feel like a meaningful improvement over what you drive now?",
    "Which part feels least comfortable right now: the vehicle, the numbers, the timing, or something else?",
    "When you say the price feels high, is the concern the selling price, the monthly payment, or the total cost?",
    "Let me show you which number changed so the payment is easier to evaluate.",
    "What is the smallest useful next step: compare two worksheets, appraise the trade, or answer one remaining question?",
    "I pulled together the exact information you asked about. What question would be most useful to answer next?",
  ];
  const hook = [
    "Trust grows when the buyer feels understood before the presentation begins.",
    "The first objection is often only the headline; the useful conversation starts underneath it.",
    "Price, payment, and total cost sound similar in conversation but require different answers.",
    "A buyer does not need more finance jargon; they need to see which number moved and why.",
    "Momentum is easier to keep when the next step feels useful instead of pressured.",
    "The strongest follow-up gives the buyer a reason to reopen the conversation.",
  ][topicIndex];
  const text = [
    hook,
    ...topic.paragraphs,
    "Use this checklist in your next conversation:",
    ...topic.checklist.map((item) => `- ${item}`),
    `Try this line: ${conversationMoves[topicIndex]}`,
  ];
  const html = `<p style="font-size:20px;line-height:1.45;font-weight:700;color:#0b1b34">${htmlEscape(hook)}</p><h2>${htmlEscape(topic.subject)}</h2>${topic.paragraphs.map((paragraph, index) => `<h3>${["Set the context", "Make the explanation useful", "Earn the next step"][index]}</h3><p>${htmlEscape(paragraph)}</p>`).join("")}<h3>Use this in your next conversation</h3><ul>${topic.checklist.map((item) => `<li>${htmlEscape(item)}</li>`).join("")}</ul><div style="margin:22px 0;padding:18px;border-left:4px solid #f7c548;background:#f5f7fb"><strong>Try this line</strong><p style="margin:8px 0 0">${htmlEscape(conversationMoves[topicIndex])}</p></div>`;
  return { subject: `PencilProof salesperson guide: ${topic.subject}`, preheader: hook, text, html };
};

const sendMarketingEmail = async (
  candidate: MarketingCandidate,
  content: { subject: string; text: string | string[]; html: string },
  env: Env,
  destination: "pilot" | "sales" = "pilot",
  idempotencyKey = "",
) => {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.MARKETING_FROM_EMAIL?.trim();
  const businessAddress = env.MARKETING_BUSINESS_ADDRESS?.trim();
  if (!apiKey || !from || !businessAddress) return false;
  const text = Array.isArray(content.text) ? content.text.join("\n\n") : content.text;
  const unsubscribeToken = await createEmailUnsubscribeToken(candidate.email, env.SESSION_SECRET);
  const unsubscribeUrl = `${env.SITE_ORIGIN}/api/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  const preferencesUrl = `${env.SITE_ORIGIN}/api/email/preferences?token=${encodeURIComponent(unsubscribeToken)}`;
  const campaignUrl = destination === "sales"
    ? `${env.PUBLIC_SITE_ORIGIN}/sales?utm_source=email&utm_medium=owned&utm_campaign=salesperson_plan`
    : `${env.PUBLIC_SITE_ORIGIN}/pilot?utm_source=email&utm_medium=owned&utm_campaign=free_scan`;
  const imageUrl = `${env.PUBLIC_SITE_ORIGIN}/${destination === "sales" ? "pencilproof-profile-mark.png" : "pencilproof-cover.png"}`;
  const imageAlt = destination === "sales" ? "PencilProof salesperson tools" : "Know the deal before you sign with PencilProof";
  const preheader = htmlEscape(content.preheader ?? (Array.isArray(content.text) ? content.text[0] : content.text));
  const html = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}</div><div style="margin:0 auto;max-width:640px;font-family:Arial,sans-serif;color:#26364d;line-height:1.65"><img src="${htmlEscape(imageUrl)}" width="640" alt="${htmlEscape(imageAlt)}" style="display:block;width:100%;max-width:640px;height:auto;border:0;border-radius:12px"><div style="padding:26px 22px">${content.html}<p style="margin:26px 0"><a href="${campaignUrl}" style="display:inline-block;padding:13px 18px;border-radius:8px;background:#0b1b34;color:#ffffff;text-decoration:none;font-weight:700">${destination === "sales" ? "Open the PencilProof salesperson plan" : "Review your quote free"}</a></p><hr style="border:0;border-top:1px solid #d9e0e8"><p style="color:#667085;font-size:12px">You are receiving this because you created a PencilProof account or provided your email to PencilProof. <a href="${unsubscribeUrl}">Unsubscribe</a> or <a href="${preferencesUrl}">manage email preferences</a>.</p><p style="color:#667085;font-size:12px">${htmlEscape(businessAddress)}</p></div></div>`;
  const requestBody = JSON.stringify({
    from,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    reply_to: env.MARKETING_REPLY_TO?.trim() || undefined,
    subject: content.subject,
    text: `${text}\n\n${destination === "sales" ? "Open the PencilProof salesperson plan" : "Review your quote free"}: ${campaignUrl}\n\nYou are receiving this because you created a PencilProof account or provided your email to PencilProof.\nUnsubscribe: ${unsubscribeUrl}\nManage email preferences: ${preferencesUrl}\n\n${businessAddress}`,
    to: [candidate.email],
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey.slice(0, 256) } : {}),
      },
      body: requestBody,
    });
    if (response.ok) return true;
    const retryable = response.status === 429 || response.status >= 500;
    console.error("Marketing email send failed", {
      attempt: attempt + 1,
      retryable,
      status: response.status,
      userId: candidate.userId,
    });
    if (!retryable || attempt === 1) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
};

const sendMarketingAlert = async (env: Env, subject: string, message: string) => {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.MARKETING_FROM_EMAIL?.trim();
  const alertEmail = env.MARKETING_ALERT_EMAIL?.trim();
  if (!apiKey || !from || !alertEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(alertEmail)) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        subject: `PencilProof campaign alert: ${subject}`,
        text: `${message}\n\nThis alert is for PencilProof campaign operations only.`,
        to: [alertEmail],
      }),
    });
    if (response.ok) return true;
    console.error("Marketing alert send failed", { status: response.status, subject });
  } catch (error) {
    console.error("Marketing alert request failed", { error: String(error), subject });
  }
  return false;
};

export const marketingCampaignSlot = (scheduledTime: number): { kind: MarketingCampaignKind; campaignKey: string } | null => {
  const date = new Date(scheduledTime);
  const weekday = date.getUTCDay();
  if (![1, 3, 5].includes(weekday)) return null;
  const kind: MarketingCampaignKind = weekday === 5 ? "promotional" : "educational";
  return { kind, campaignKey: `${date.toISOString().slice(0, 10)}:${kind}` };
};

const runMarketingCampaign = async (env: Env, scheduledTime: number) => {
  const slot = marketingCampaignSlot(scheduledTime);
  if (!slot) return;
  const startedAt = Math.floor(Date.now() / 1000);
  const runDetails = {
    campaignKey: slot.campaignKey,
    kind: slot.kind,
    candidates: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    automaticRepair: "One retry for Resend rate limits and server errors; failed claims are released safely.",
  };
  const recordRun = async (status: "healthy" | "degraded" | "failed" | "skipped", error: string | null = null) => {
    await accountCall(env, "/automation-run", {
      automationKey: "marketing-email",
      startedAt,
      finishedAt: Math.floor(Date.now() / 1000),
      status,
      details: { ...runDetails, ...(error ? { error: error.slice(0, 500) } : {}) },
    });
  };
  if (!env.RESEND_API_KEY || !env.MARKETING_FROM_EMAIL || !env.MARKETING_BUSINESS_ADDRESS) {
    console.warn("Marketing campaign skipped: email configuration is incomplete");
    await sendMarketingAlert(
      env,
      "Configuration incomplete",
      "A scheduled campaign was skipped because RESEND_API_KEY, MARKETING_FROM_EMAIL, or MARKETING_BUSINESS_ADDRESS is missing.",
    );
    await recordRun("failed", "Email configuration is incomplete.");
    return;
  }
  const now = Math.floor(scheduledTime / 1000);
  let failedDeliveries = 0;
  const marketingDeliveryBatchSize = 100;

  const deliver = async <T extends { email: string; userId: string }>(
    candidates: T[],
    campaignKey: string,
    contentFor: (candidate: T) => MarketingEmailContent,
    destination: "pilot" | "sales",
  ) => {
    const eligible = candidates.filter((candidate) => candidate.userId && /^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(candidate.email));
    runDetails.candidates += eligible.length;
    for (let offset = 0; offset < eligible.length; offset += marketingDeliveryBatchSize) {
      const batch = eligible.slice(offset, offset + marketingDeliveryBatchSize);
      const claim = await accountCall(env, "/marketing-delivery-batch", {
        action: "claim",
        campaignKey,
        userIds: batch.map((candidate) => candidate.userId),
      });
      const claimedIds = new Set(
        Array.isArray(claim?.claimed)
          ? claim.claimed.filter((userId): userId is string => typeof userId === "string")
          : [],
      );
      runDetails.claimed += claimedIds.size;
      if (!claimedIds.size) continue;
      const completedIds: string[] = [];
      const releasedIds: string[] = [];
      for (const candidate of batch) {
        if (!claimedIds.has(candidate.userId)) continue;
        let sent = false;
        try {
          sent = await sendMarketingEmail(candidate, contentFor(candidate), env, destination, `pencilproof/${campaignKey}/${candidate.userId}`);
        } catch (error) {
          console.error("Marketing email send exception", { message: error instanceof Error ? error.message : "Unknown error" });
        }
        if (sent) {
          completedIds.push(candidate.userId);
          runDetails.sent += 1;
        }
        else {
          releasedIds.push(candidate.userId);
          failedDeliveries += 1;
          runDetails.failed += 1;
        }
      }
      if (completedIds.length) await accountCall(env, "/marketing-delivery-batch", { action: "complete", campaignKey, userIds: completedIds });
      if (releasedIds.length) await accountCall(env, "/marketing-delivery-batch", { action: "release", campaignKey, userIds: releasedIds });
    }
  };

  const customerResult = await accountCall(env, "/marketing-candidates", { now });
  const customerCandidates = marketingCandidates(customerResult?.candidates)
    .filter((candidate) => !(slot.kind === "promotional" && candidate.lastPurchaseAt));
  await deliver(customerCandidates, `customer:${slot.campaignKey}`, (candidate) => marketingEmailContent(candidate, now), "pilot");

  const salespersonResult = await accountCall(env, "/salesperson-marketing-candidates", { now });
  const salespersonCandidates = salespersonMarketingCandidates(salespersonResult?.candidates);
  await deliver(salespersonCandidates, `salesperson:${slot.campaignKey}`, () => salespersonEmailContent(now, slot.kind), "sales");

  if (failedDeliveries > 0) {
    await sendMarketingAlert(
      env,
      "Delivery failures",
      `${failedDeliveries} campaign email${failedDeliveries === 1 ? "" : "s"} failed during the ${slot.campaignKey} run. Failed deliveries were released for a later retry.`,
    );
  }
  await recordRun(failedDeliveries > 0 ? "degraded" : "healthy");
};

const createEmailUnsubscribeToken = async (email: string, secret: string) => {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({
    email,
    purpose: "marketing-unsubscribe",
  } satisfies EmailUnsubscribePayload)));
  const key = await importSigningKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return `${payload}.${base64UrlEncode(signature)}`;
};

const verifyEmailUnsubscribeToken = async (token: string, secret: string) => {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  try {
    const key = await importSigningKey(secret);
    const valid = await crypto.subtle.verify("HMAC", key, base64UrlDecode(signature), encoder.encode(payload));
    if (!valid) return null;
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as Partial<EmailUnsubscribePayload>;
    return parsed.purpose === "marketing-unsubscribe"
      && typeof parsed.email === "string"
      && /^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(parsed.email)
      ? parsed.email.trim().toLowerCase()
      : null;
  } catch {
    return null;
  }
};

const currentUser = async (request: Request, env: Env) => {
  // Native clients cannot rely on browser cookies. Accept a Clerk bearer
  // token and resolve it to PencilProof's internal account id so the same
  // account-scoped routes work on iOS and Android without weakening the
  // existing signed-cookie path used by the website.
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (token) {
    const provider = await verifyProviderToken(token, env);
    if (!provider) return null;
    const result = await accountCall(env, "/user", { providerSubject: provider.id });
    const user = result?.user as { id?: unknown } | undefined;
    return typeof user?.id === "string" ? user.id : null;
  }

  return verifyUserSession(
    readCookie(request, USER_COOKIE),
    env.SESSION_SECRET,
  );
};

const hasBearerAuthorization = (request: Request) => /^Bearer\s+\S+$/i.test(request.headers.get("Authorization") ?? "");

const requestGuestId = async (request: Request) => {
  const device = readCookie(request, DEVICE_COOKIE);
  return validDeviceId(device) ? sha256Hex(device) : null;
};

const canonicalAccountRole = async (
  env: Env,
  userId: string | null,
  fallback: AccountRole,
): Promise<AccountRole> => {
  if (!userId) return fallback;
  const result = await accountCall(env, "/salesperson", { action: "get", userId });
  return result?.profile ? "salesperson" : fallback;
};

/**
 * The page where an account session was established is the source of truth
 * for the active experience. A salesperson profile is only a fallback for
 * older sessions that do not yet have a signed role cookie; it must not turn a
 * deliberate consumer session into a salesperson session.
 */
export const resolveAccountSessionRole = ({
  requestedRole,
  hasSalespersonProfile,
  knownConsumer,
  hasPriorIdentity,
}: {
  requestedRole: AccountRoleRequest;
  hasSalespersonProfile: boolean;
  knownConsumer: boolean;
  hasPriorIdentity: boolean;
}): AccountRole => {
  if (requestedRole === "consumer") return "consumer";
  if (hasSalespersonProfile) return "salesperson";
  if (knownConsumer || hasPriorIdentity) return "consumer";
  return "salesperson";
};

const markSalespersonProfile = async (env: Env, userId: string, email: string) => {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(normalizedEmail) || normalizedEmail.length > 254) return;
  try {
    await accountCall(env, "/account-identity", {
      action: "upsert",
      email: normalizedEmail,
      role: "salesperson",
      salespersonProfile: true,
      userId,
    });
  } catch {
    // Identity segmentation must not block a successfully saved salesperson profile.
  }
};

const currentAccountRole = async (request: Request, env: Env): Promise<AccountRole> => {
  // Native clients use Clerk bearer tokens and do not have a reliable browser
  // role cookie. Resolve their role from the durable salesperson profile so a
  // stale consumer cookie cannot mask an existing salesperson account.
  const signedRole = hasBearerAuthorization(request)
    ? null
    : await verifyAccountRoleSession(readCookie(request, ROLE_COOKIE), env.SESSION_SECRET);
  if (signedRole) return signedRole;
  return canonicalAccountRole(env, await currentUser(request, env), "consumer");
};

const accountAccess = async (request: Request, env: Env) => {
  if (!env.ACCOUNTS) return null;
  const userId = await currentUser(request, env);
  const guestId = userId ? null : await requestGuestId(request);
  // Anonymous requests have no account entitlement to check. Skipping the
  // Durable Object lookup here prevents public scans and bots from consuming
  // the account namespace quota before a signed-in customer needs it.
  if (!userId && !guestId) return null;
  try {
    const result = await accountCall(env, "/access-summary", { userId, guestId });
    const expiresAt = result?.expiresAt;
    const now = Math.floor(Date.now() / 1000);
    if (typeof expiresAt === "number" && expiresAt > now) return expiresAt;
  } catch (error) {
    // A Durable Object quota or transient namespace failure must become a
    // normal access miss, never a Cloudflare 1101 page. A valid legacy access
    // token is still checked by hasAccess below.
    console.error("Account access lookup unavailable", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
  return null;
};

const restorePaidAccountAccess = async (request: Request, env: Env) => {
  const userId = await currentUser(request, env);
  if (!userId) return redirect(`${env.PUBLIC_SITE_ORIGIN}/account?restore=sign_in`);

  const url = new URL(request.url);
  let sessionId = url.searchParams.get("session_id")?.trim() ?? "";
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const submittedSessionId = form?.get("session_id");
    if (typeof submittedSessionId === "string") sessionId = submittedSessionId.trim();
  }
  if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) {
    return redirect(`${env.SITE_ORIGIN}/recover?reason=unverified`);
  }

  const session = await retrieveCheckoutSession(sessionId, env);
  if (!isPaidPencilProofSession(session)) {
    return redirect(`${env.SITE_ORIGIN}/recover?reason=unverified`);
  }
  const expectedPriceId = env.STRIPE_PRICE_ID.trim();
  const lineItems = await retrieveCheckoutLineItems(sessionId, env);
  if (!hasExactPencilProofLineItem(lineItems, expectedPriceId)) {
    return redirect(`${env.SITE_ORIGIN}/recover?reason=unverified`);
  }

  const activatedAt = Number.isInteger(session.created) && (session.created ?? 0) > 0
    ? session.created as number
    : Math.floor(Date.now() / 1000);
  const expiresAt = activatedAt + accessSeconds(env);
  if (expiresAt <= Math.floor(Date.now() / 1000)) {
    return redirect(`${env.SITE_ORIGIN}/recover?reason=expired`);
  }

  await accountCall(env, "/entitlement", {
    userId,
    stripeSessionId: sessionId,
    activatedAt,
    exactExpiresAt: expiresAt,
  });
  return redirect(`${env.PUBLIC_SITE_ORIGIN}/account?restore=success`);
};

const handleAccount = async (request: Request, env: Env) => {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: accountCorsHeaders(request, env) });
  }
  if (url.pathname === "/api/account/session" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { email?: string; token?: string; role?: AccountRoleRequest; force?: boolean };
    const role: AccountRoleRequest = body.role === "salesperson"
      ? "salesperson"
      : body.role === "auto"
        ? "auto"
        : "consumer";
    const provider = typeof body.token === "string" ? await verifyProviderToken(body.token, env) : null;
    if (!provider) return withAccountCors(Response.json({ error: "invalid_account_session" }, { status: 401, headers: noStoreHeaders }), request, env);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const guestId = await requestGuestId(request);
    const legacy = guestId ? await legacyAccountOrder(request, env) : null;
    let sessionResult: Record<string, unknown> | null = null;
    try {
      sessionResult = await accountSessionBootstrapCall(env, `${provider.id}:${role}:${email}`, {
        providerSubject: provider.id,
        email,
        requestedRole: role,
        guestId,
        legacyEntitlement: legacy
          ? {
              sessionId: legacy.sessionId,
              createdAt: legacy.createdAt,
              accessExpiresAt: legacy.accessExpiresAt,
            }
          : null,
      }, body.force === true);
    } catch (error) {
      console.error("Account session bootstrap unavailable", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return withAccountCors(Response.json({ error: "account_unavailable" }, { status: 503, headers: noStoreHeaders }), request, env);
    }
    const user = sessionResult?.user as { id?: string } | undefined;
    if (!user?.id) return withAccountCors(Response.json({ error: "account_unavailable" }, { status: 503, headers: noStoreHeaders }), request, env);
    const resolvedRole: AccountRole = sessionResult?.role === "salesperson" ? "salesperson" : "consumer";
    const expiresAt = typeof sessionResult?.expiresAt === "number" ? sessionResult.expiresAt : null;
    const identity = sessionResult?.identity as { email?: unknown } | null | undefined;
    const headers = new Headers(noStoreHeaders);
    headers.append("Set-Cookie", await accountCookie(user.id, env.SESSION_SECRET));
    headers.append("Set-Cookie", await accountRoleCookie(resolvedRole, env.SESSION_SECRET));
    return withAccountCors(Response.json({
      ok: true,
      role: resolvedRole,
      expiresAt,
      email: typeof identity?.email === "string" ? identity.email : email,
      audits: Array.isArray(sessionResult?.audits) ? sessionResult.audits : [],
      marketingOptedIn: sessionResult?.marketingOptedIn === true,
      salespersonProfile: sessionResult?.salespersonProfile ?? null,
    }, { headers }), request, env);
  }
  if (url.pathname === "/api/account/logout" && request.method === "POST") {
   const headers = new Headers(noStoreHeaders);
   headers.append("Set-Cookie", clearAccountCookie);
   headers.append("Set-Cookie", clearAccountRoleCookie);
    appendExpiredAccessCookies(headers, env);
   return withAccountCors(new Response(null, { status: 204, headers }), request, env);
  }
  const userId = await currentUser(request, env);
  if (!userId) return withAccountCors(Response.json({ error: "account_required" }, { status: 401, headers: noStoreHeaders }), request, env);
  const salespersonPath = url.pathname === "/api/salesperson/me"
    || url.pathname === "/api/salesperson/playbook"
    || url.pathname === "/api/salesperson/credit"
    || url.pathname === "/api/salesperson/portal"
    || url.pathname === "/api/salesperson/gift/claim";
  if (salespersonPath && await currentAccountRole(request, env) !== "salesperson") {
    return withAccountCors(Response.json({ error: "salesperson_role_required" }, { status: 403, headers: noStoreHeaders }), request, env);
  }
  if (url.pathname === "/api/salesperson/me" && (request.method === "GET" || request.method === "POST")) {
    const body = await request.json().catch(() => ({})) as { email?: string; displayName?: string };
    if (request.method === "POST") {
      const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
      if (displayName.length < 2 || displayName.length > 80) {
        return withAccountCors(Response.json({ error: "display_name_required" }, { status: 400, headers: noStoreHeaders }), request, env);
      }
    }
    const result = await accountCall(env, "/salesperson", {
      action: request.method === "POST" ? "ensure" : "get",
      userId,
      ...(typeof body.email === "string" ? { email: body.email } : {}),
      ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
    });
    const profile = result?.profile as { email?: unknown } | undefined;
    const responseHeaders = new Headers(noStoreHeaders);
    if (request.method === "POST" && profile) {
      const profileEmail = typeof profile.email === "string"
        ? profile.email
        : typeof body.email === "string" ? body.email : "";
      await markSalespersonProfile(env, userId, profileEmail);
      responseHeaders.append("Set-Cookie", await accountRoleCookie("salesperson", env.SESSION_SECRET));
    }
    return withAccountCors(Response.json({ profile: profile ?? null }, { headers: responseHeaders }), request, env);
  }
  if (url.pathname === "/api/salesperson/playbook" && request.method === "GET") {
    const result = await accountCall(env, "/salesperson", { action: "get", userId });
    const profile = result?.profile as { subscriptionStatus?: string } | undefined;
    if (!profile) return withAccountCors(Response.json({ error: "salesperson_profile_required" }, { status: 404, headers: noStoreHeaders }), request, env);
    if (profile.subscriptionStatus !== "active") {
      return withAccountCors(Response.json({ error: "salesperson_subscription_required" }, { status: 403, headers: noStoreHeaders }), request, env);
    }
    return withAccountCors(Response.json({ playbook: fullSalesCoachPlaybook }, { headers: noStoreHeaders }), request, env);
  }
  if (url.pathname === "/api/salesperson/credit" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { action?: string };
    if (body.action === "gift") {
      const result = await accountCall(env, "/salesperson-credit", { action: "gift", userId });
      return withAccountCors(Response.json(result ?? { status: "unavailable" }, { headers: noStoreHeaders }), request, env);
    }
    if (body.action === "redeem") {
      const result = await accountCall(env, "/salesperson-credit", { action: "redeem", userId });
      const creditId = typeof result?.creditId === "string" ? result.creditId : "";
      const stripeCustomerId = typeof result?.stripeCustomerId === "string" ? result.stripeCustomerId : "";
      const stripeSubscriptionId = typeof result?.stripeSubscriptionId === "string" ? result.stripeSubscriptionId : "";
      if (result?.status === "pending" && creditId && stripeCustomerId && stripeSubscriptionId) {
        const applied = await addSalespersonSubscriptionCredit(env, stripeCustomerId, stripeSubscriptionId, creditId);
        await accountCall(env, "/salesperson-credit", { action: "confirm", creditId, success: applied });
        return withAccountCors(Response.json({ status: applied ? "redeemed" : "retry" }, { headers: noStoreHeaders }), request, env);
      }
      return withAccountCors(Response.json(result ?? { status: "unavailable" }, { headers: noStoreHeaders }), request, env);
    }
    return withAccountCors(Response.json({ error: "invalid_credit_action" }, { status: 400, headers: noStoreHeaders }), request, env);
  }
  if (url.pathname === "/api/salesperson/portal" && request.method === "POST") {
    const result = await accountCall(env, "/salesperson", { action: "get", userId });
    const profile = result?.profile as { stripeCustomerId?: string } | undefined;
    try {
      const url = await createSalespersonPortalSession(env, profile?.stripeCustomerId ?? "");
      return withAccountCors(Response.json({ url }, { headers: noStoreHeaders }), request, env);
    } catch {
      return withAccountCors(Response.json({ error: "billing_portal_unavailable" }, { status: 503, headers: noStoreHeaders }), request, env);
    }
  }
  if (url.pathname === "/api/salesperson/gift/claim" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { code?: string };
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!/^PPG-[A-Z0-9]{16}$/.test(code)) return withAccountCors(Response.json({ error: "invalid_gift_code" }, { status: 400, headers: noStoreHeaders }), request, env);
    const result = await accountCall(env, "/salesperson-gift-claim", { userId, code });
    return withAccountCors(Response.json(result ?? { status: "unavailable" }, { headers: noStoreHeaders }), request, env);
  }
  if (url.pathname === "/api/account/marketing" && request.method === "GET") {
    const result = await accountCall(env, "/marketing", { action: "status", userId });
    return withAccountCors(Response.json({ optedIn: result?.optedIn === true }, { headers: noStoreHeaders }), request, env);
  }
  if (url.pathname === "/api/account/marketing" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { email?: string; optIn?: boolean };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (body.optIn === false) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email) || email.length > 254) {
        return withAccountCors(Response.json({ error: "invalid_marketing_preference" }, { status: 400, headers: noStoreHeaders }), request, env);
      }
      await accountCall(env, "/marketing", { email, optIn: false, userId });
      return withAccountCors(Response.json({ optedIn: false }, { headers: noStoreHeaders }), request, env);
    }
    if (body.optIn !== true || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email)) {
      return withAccountCors(Response.json({ error: "invalid_marketing_preference" }, { status: 400, headers: noStoreHeaders }), request, env);
    }
    const result = await accountCall(env, "/marketing", { email, optIn: true, userId });
    if (!result?.optedIn) {
      return withAccountCors(Response.json({ error: "marketing_unavailable" }, { status: 503, headers: noStoreHeaders }), request, env);
    }
    return withAccountCors(Response.json({ optedIn: true }, { headers: noStoreHeaders }), request, env);
  }
  if (url.pathname === "/api/account/marketing/activity" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { event?: string };
    if (body.event !== "scan_ready" && body.event !== "checkout_started" && body.event !== "purchase_completed") {
      return withAccountCors(Response.json({ error: "invalid_marketing_activity" }, { status: 400, headers: noStoreHeaders }), request, env);
    }
    await recordMarketingActivity(env, userId, body.event);
    return withAccountCors(Response.json({ recorded: true }, { headers: noStoreHeaders }), request, env);
  }
  const ownerId = accountOwner(userId, null);
  if (url.pathname === "/api/account/me" && request.method === "GET") {
    let result: Record<string, unknown> | null = null;
    try {
      result = await accountCall(env, "/account-summary", { userId, ownerId });
    } catch (error) {
      console.error("Account summary unavailable", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return withAccountCors(Response.json({ error: "account_unavailable" }, { status: 503, headers: noStoreHeaders }), request, env);
    }
    const identity = result?.identity as { email?: unknown } | null | undefined;
    const profile = result?.salespersonProfile as { subscriptionStatus?: unknown } | null | undefined;
    const signedRole = hasBearerAuthorization(request)
      ? null
      : await verifyAccountRoleSession(readCookie(request, ROLE_COOKIE), env.SESSION_SECRET);
    const role: AccountRole = signedRole ?? (profile ? "salesperson" : "consumer");
    const email = typeof identity?.email === "string" ? identity.email : null;
    return withAccountCors(Response.json({
      userId,
      email,
      role,
      expiresAt: typeof result?.expiresAt === "number" ? result.expiresAt : null,
      audits: Array.isArray(result?.audits) ? result.audits : [],
      marketingOptedIn: result?.marketingOptedIn === true,
    }, { headers: noStoreHeaders }), request, env);
  }
  if (url.pathname === "/api/account/audits" && request.method === "DELETE") {
    const body = await request.json().catch(() => ({})) as { id?: string };
    if (!body.id || !/^[0-9a-f-]{36}$/.test(body.id)) return withAccountCors(Response.json({ error: "invalid_audit" }, { status: 400, headers: noStoreHeaders }), request, env);
    await accountCall(env, "/audits", { ownerId, action: "delete", id: body.id });
    return withAccountCors(Response.json({ deleted: true }, { headers: noStoreHeaders }), request, env);
  }
  if (url.pathname === "/api/account/delete" && request.method === "POST") {
    await accountCall(env, "/delete-user", { userId });
    const headers = new Headers(noStoreHeaders);
    headers.append("Set-Cookie", clearAccountCookie);
    headers.append("Set-Cookie", clearAccountRoleCookie);
    return withAccountCors(new Response(null, { status: 204, headers }), request, env);
  }
  return new Response("Not found", { status: 404, headers: noStoreHeaders });
};

const handleSalespersonCheckout = async (request: Request, env: Env) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: accountCorsHeaders(request, env) });
  }
  const respond = (response: Response) => withAccountCors(response, request, env);
  if (request.method !== "POST") return respond(new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } }));
  const origin = request.headers.get("Origin");
  if (origin && origin !== env.SITE_ORIGIN && origin !== env.PUBLIC_SITE_ORIGIN) return new Response("Forbidden", { status: 403 });
  const userId = await currentUser(request, env);
  if (!userId) return respond(Response.json({ error: "account_required" }, { status: 401, headers: noStoreHeaders }));
  if (await currentAccountRole(request, env) !== "salesperson") {
    return respond(Response.json({ error: "salesperson_role_required" }, { status: 403, headers: noStoreHeaders }));
  }
  try {
    const body = await request.json().catch(() => ({})) as { email?: string; displayName?: string };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const profileResult = await accountCall(env, "/salesperson", { action: "ensure", userId, email, displayName });
    const profile = profileResult?.profile as { subscriptionStatus?: string; email?: string; displayName?: string } | undefined;
    if (!profile) return respond(Response.json({ error: "salesperson_profile_required" }, { status: 400, headers: noStoreHeaders }));
    if (profile.subscriptionStatus === "active") return respond(Response.json({ error: "salesperson_already_active" }, { status: 409, headers: noStoreHeaders }));
    const billingEmail = email || profile.email || "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(billingEmail)) return respond(Response.json({ error: "salesperson_email_required" }, { status: 400, headers: noStoreHeaders }));
    await markSalespersonProfile(env, userId, billingEmail);
    const session = await createSalespersonCheckoutSession(env, userId, billingEmail);
    return respond(Response.json({ url: session.url }, { headers: noStoreHeaders }));
  } catch (error) {
    const code = error instanceof CheckoutError ? error.code : "checkout_internal_error";
    console.error("Salesperson checkout creation failed", { code, message: error instanceof Error ? error.message : "Unknown error" });
    return respond(Response.json({ error: "Salesperson subscription checkout is temporarily unavailable.", code }, { status: 502, headers: noStoreHeaders }));
  }
};

const marketingUnsubscribePage = (message: string, ok: boolean) => new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences | PencilProof</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#061126;color:#f5f7fb;font:16px/1.5 Arial,sans-serif}.card{width:min(560px,calc(100% - 32px));padding:40px;border:1px solid rgba(246,195,67,.42);border-radius:16px;background:#0b1b38;box-shadow:0 24px 80px rgba(0,0,0,.35)}.brand{color:#f6c343;font-weight:800;letter-spacing:.02em}h1{margin:24px 0 10px;font:500 34px/1.1 Georgia,serif}p{color:#d9e1ee}a{color:#f6c343}</style></head><body><main class="card"><div class="brand">PencilProof</div><h1>${ok ? "You are unsubscribed" : "We could not update your preferences"}</h1><p>${htmlEscape(message)}</p><p><a href="https://pencilproof.com/">Return to PencilProof</a></p></main></body></html>`, { headers: { ...noStoreHeaders, "Content-Type": "text/html; charset=utf-8" } });

const marketingPreferencesPage = (message: string, state: "ready" | "updated" | "error", token: string) => {
  const ready = state === "ready";
  const updated = state === "updated";
  const action = ready
    ? `<form action="/api/email/preferences" method="post"><input type="hidden" name="token" value="${htmlEscape(token)}"><button type="submit">Stop promotional emails</button></form>`
    : "";
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences | PencilProof</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#061126;color:#f5f7fb;font:16px/1.5 Arial,sans-serif}.card{width:min(560px,calc(100% - 32px));padding:40px;border:1px solid rgba(246,195,67,.42);border-radius:16px;background:#0b1b38;box-shadow:0 24px 80px rgba(0,0,0,.35)}.brand{color:#f6c343;font-weight:800;letter-spacing:.02em}h1{margin:24px 0 10px;font:500 34px/1.1 Georgia,serif}p{color:#d9e1ee}a{color:#f6c343}button{margin-top:10px;padding:13px 18px;border:0;border-radius:8px;background:#f6c343;color:#07152d;font:700 15px Arial,sans-serif;cursor:pointer}button:hover{background:#ffd56b}.note{font-size:13px;color:#aebbd0}</style></head><body><main class="card"><div class="brand">PencilProof</div><h1>${ready ? "Manage email preferences" : updated ? "Promotional emails are turned off" : "We could not update your preferences"}</h1><p>${htmlEscape(message)}</p>${action}<p class="note">Account, security, billing, and service messages may still be sent when needed.</p><p><a href="https://pencilproof.com/">Return to PencilProof</a></p></main></body></html>`, { headers: { ...noStoreHeaders, "Content-Type": "text/html; charset=utf-8" } });
};

const handleMarketingUnsubscribe = async (request: Request, env: Env) => {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const email = await verifyEmailUnsubscribeToken(token, env.SESSION_SECRET);
  if (request.method === "POST") {
    if (!email) return new Response(null, { status: 400, headers: noStoreHeaders });
    const result = await accountCall(env, "/marketing-unsubscribe", { email });
    return new Response(null, { status: result?.unsubscribed === true ? 204 : 503, headers: noStoreHeaders });
  }
  if (!email) return marketingUnsubscribePage("This unsubscribe link is invalid or expired. Use the email preferences in My Audits or contact support.", false);
  const result = await accountCall(env, "/marketing-unsubscribe", { email });
  return result?.unsubscribed === true
    ? marketingUnsubscribePage("You will no longer receive PencilProof promotional emails at this address.", true)
    : marketingUnsubscribePage("We could not update your preferences. Please contact support.", false);
};

const handleMarketingPreferences = async (request: Request, env: Env) => {
  let token = new URL(request.url).searchParams.get("token") ?? "";
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const submittedToken = form?.get("token");
    if (typeof submittedToken === "string") token = submittedToken;
  }
  const email = await verifyEmailUnsubscribeToken(token, env.SESSION_SECRET);
  if (!email) return marketingPreferencesPage("This preferences link is invalid or expired. Request a new email or contact support.", "error", "");
  if (request.method === "GET") return marketingPreferencesPage("Choose whether you want to continue receiving PencilProof promotional emails. You do not need to sign in.", "ready", token);
  const result = await accountCall(env, "/marketing-unsubscribe", { email });
  return result?.unsubscribed === true
    ? marketingPreferencesPage("You will no longer receive PencilProof promotional emails at this address.", "updated", "")
    : marketingPreferencesPage("We could not update your preferences. Please try again or contact support.", "error", token);
};

const handleAuditStorage = async (request: Request, env: Env) => {
  const userId = await currentUser(request, env);
  const guestId = userId ? null : await requestGuestId(request);
  const ownerId = accountOwner(userId, guestId);
  if (!ownerId) return Response.json({ error: "account_or_guest_required" }, { status: 401, headers: noStoreHeaders });
  const access = await accountAccess(request, env);
  let permitted = Boolean(access);
  if (!permitted && guestId) {
    const legacy = await hasLegacyDeviceAccess(request, env);
    permitted = legacy.allowed;
  }
  if (!permitted) return Response.json({ error: "active_pass_required" }, { status: 403, headers: noStoreHeaders });
  const body = await request.json().catch(() => ({})) as { action?: string; id?: string; data?: Record<string, unknown> };
  if (request.method === "GET") {
    const result = await accountCall(env, "/audits", { ownerId, action: "list" });
    return Response.json({ audits: result?.audits ?? [] }, { headers: noStoreHeaders });
  }
  if (request.method === "POST" && body.data && JSON.stringify(body.data).length <= 100_000) {
    const result = await accountCall(env, "/audits", { ownerId, action: "save", data: body.data });
    if (typeof result?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(result.id)) {
      return Response.json({ error: "audit_save_unavailable" }, { status: 503, headers: noStoreHeaders });
    }
    return Response.json({ id: result.id }, { headers: noStoreHeaders });
  }
  if (request.method === "DELETE" && typeof body.id === "string" && /^[0-9a-f-]{36}$/.test(body.id)) {
    await accountCall(env, "/audits", { ownerId, action: "delete", id: body.id });
    return Response.json({ deleted: true }, { headers: noStoreHeaders });
  }
  return Response.json({ error: "invalid_audit_request" }, { status: 400, headers: noStoreHeaders });
};

const legacyAccountOrder = async (request: Request, env: Env) => {
  const token = readCookie(request, ACCESS_COOKIE);
  const deviceId = readCookie(request, DEVICE_COOKIE);
  if (!token || !validDeviceId(deviceId)) return null;
  const payload = await verifyAccessToken(token, env.SESSION_SECRET);
  if (!payload || payload.did !== await sha256Hex(deviceId)) return null;
  const response = await orderStub(payload.sid, env).fetch(new Request("https://order-store.internal/details", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceHash: payload.did }),
  }));
  return response.ok ? await response.json() as { sessionId: string; createdAt: number; accessExpiresAt: number } : null;
};

const hasLegacyDeviceAccess = async (request: Request, env: Env): Promise<OrderRedeemResult> => {
  const token = readCookie(request, ACCESS_COOKIE);
  const deviceId = readCookie(request, DEVICE_COOKIE);
  if (!token || !validDeviceId(deviceId)) return { allowed: false, reason: "not_found" };
  const payload = await verifyAccessToken(token, env.SESSION_SECRET);
  if (!payload || payload.did !== await sha256Hex(deviceId)) return { allowed: false, reason: "device_mismatch" };
  return authorizeOrder(payload.sid, payload.did, env);
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

const expiredAccessCookie = (domain?: string) =>
  ACCESS_COOKIE + "=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/"
  + (domain ? "; Domain=" + domain : "")
  + "; HttpOnly; Secure; SameSite=Lax";

const appendExpiredAccessCookies = (headers: Headers, env: Env) => {
  headers.append("Set-Cookie", expiredAccessCookie());
  const auditHost = new URL(env.SITE_ORIGIN).hostname;
  const publicHost = new URL(env.PUBLIC_SITE_ORIGIN).hostname;
  headers.append("Set-Cookie", expiredAccessCookie(auditHost));
  if (publicHost !== auditHost) headers.append("Set-Cookie", expiredAccessCookie("." + publicHost));
};

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
  if (!response.ok) return false;
  await accountCall(env, "/revoke", { stripeSessionId: revocation.sessionId });
  return true;
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

    if (path === "/details") {
      const body = await request.json() as { deviceHash?: string };
      const order = await this.state.storage.get<OrderRecord>("order");
      if (!order || body.deviceHash !== order.deviceHash) return new Response("Not found", { status: 404 });
      return Response.json({ sessionId: order.sessionId, createdAt: order.createdAt, accessExpiresAt: order.accessExpiresAt });
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

type PhoneSessionAttachment = {
  role: "desktop" | "phone";
};

type PhoneSessionSocket = WebSocket & {
  deserializeAttachment?: () => PhoneSessionAttachment | null;
  serializeAttachment?: (attachment: PhoneSessionAttachment) => void;
};

/**
 * Holds one anonymous desktop/phone pairing for a few minutes. The quote image
 * is streamed through the Durable Object and is never written to storage.
 */
export class PhoneSessionStore {
  private readonly state: DurableObjectStateLike;

  constructor(state: DurableObjectStateLike) {
    this.state = state;
  }

  private sockets() {
    return (this.state.getWebSockets?.() ?? []) as PhoneSessionSocket[];
  }

  private role(socket: PhoneSessionSocket) {
    return socket.deserializeAttachment?.()?.role ?? null;
  }

  private send(socket: PhoneSessionSocket, payload: Record<string, unknown>) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  private peer(socket: PhoneSessionSocket) {
    const role = this.role(socket);
    return this.sockets().find((candidate) => candidate !== socket && this.role(candidate) !== role) ?? null;
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/create") {
      let body: { sessionId?: string; token?: string; expiresAt?: number };
      try {
        body = await request.json() as typeof body;
      } catch {
        return new Response("Invalid phone session", { status: 400 });
      }
      if (
        !body.sessionId
        || !PHONE_SESSION_ID_PATTERN.test(body.sessionId)
        || !body.token
        || !PHONE_SESSION_TOKEN_PATTERN.test(body.token)
        || !Number.isInteger(body.expiresAt)
        || body.expiresAt <= Date.now()
      ) {
        return new Response("Invalid phone session", { status: 400 });
      }
      await this.state.storage.put("sessionId", body.sessionId);
      await this.state.storage.put("token", body.token);
      await this.state.storage.put("expiresAt", body.expiresAt);
      await this.state.storage.setAlarm?.(body.expiresAt);
      return Response.json({ created: true });
    }

    if (request.method !== "GET" || url.pathname !== "/connect") {
      return new Response("Not found", { status: 404 });
    }

    const token = url.searchParams.get("token") ?? "";
    const role = url.searchParams.get("role");
    const expectedToken = await this.state.storage.get<string>("token");
    const expiresAt = await this.state.storage.get<number>("expiresAt");
    if (
      !expectedToken
      || token !== expectedToken
      || !Number.isInteger(expiresAt)
      || expiresAt <= Date.now()
      || (role !== "desktop" && role !== "phone")
    ) {
      return new Response("Phone session expired", { status: 410 });
    }

    const existingRole = this.sockets().find((socket) => this.role(socket) === role);
    if (existingRole) existingRole.close(1000, "replaced");
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1] as PhoneSessionSocket;
    if (!this.state.acceptWebSocket || !server.serializeAttachment) {
      return new Response("Phone session unavailable", { status: 503 });
    }
    server.serializeAttachment({ role });
    this.state.acceptWebSocket(server);
    this.send(server, { type: "connected", role });
    const peer = this.sockets().find((socket) => socket !== server && this.role(socket) !== role);
    if (peer) {
      this.send(peer, { type: role === "phone" ? "phone_connected" : "desktop_connected" });
      this.send(server, { type: role === "phone" ? "desktop_connected" : "phone_connected" });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: PhoneSessionSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") {
      const peer = this.peer(socket);
      if (!peer || peer.readyState !== WebSocket.OPEN) return;
      if (message.byteLength > PHONE_SESSION_CHUNK_LIMIT) {
        socket.close(1009, "chunk too large");
        return;
      }
      peer.send(message);
      return;
    }
    if (message.length > 16_000) {
      socket.close(1009, "message too large");
      return;
    }
    try {
      const payload = JSON.parse(message) as { type?: string };
      if (payload.type === "keepalive") {
        this.send(socket, { type: "keepalive_ack" });
        return;
      }
      if (
        typeof payload.type !== "string"
        || !["hello", "photo-start", "photo-end"].includes(payload.type)
      ) return;
      const peer = this.peer(socket);
      if (!peer || peer.readyState !== WebSocket.OPEN) return;
      peer.send(message);
    } catch {
      socket.close(1003, "invalid message");
    }
  }

  webSocketClose(socket: PhoneSessionSocket) {
    const peer = this.peer(socket);
    if (peer) this.send(peer, { type: "peer_disconnected" });
  }

  webSocketError(socket: PhoneSessionSocket) {
    try { socket.close(1011, "session error"); } catch { /* already closed */ }
  }

  async alarm() {
    for (const socket of this.sockets()) {
      try { socket.close(1000, "expired"); } catch { /* already closed */ }
    }
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
    "img-src 'self' data: https://upload.wikimedia.org https://commons.wikimedia.org",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

const publicPagePaths = new Set([
  "/account",
  "/account/",
  "/how-it-works",
  "/how-it-works/",
  "/pricing",
  "/pricing/",
  "/sales",
  "/sales/",
  "/privacy",
  "/privacy/",
  "/questions",
  "/questions/",
  "/terms",
  "/terms/",
  "/what-it-checks",
  "/what-it-checks/",
  "/who-it-helps",
  "/who-it-helps/",
]);

const publicPageRedirect = (url: URL, env: Env) => {
  const destination = new URL(env.PUBLIC_SITE_ORIGIN);
  destination.pathname = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;
  destination.search = url.search;
  return redirect(destination.toString());
};

const accountCorsHeaders = (request: Request, env: Env) => {
  const origin = request.headers.get("Origin");
  if (!origin || ![env.PUBLIC_SITE_ORIGIN, env.SITE_ORIGIN].includes(origin)) return {};
  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
};

const withAccountCors = (response: Response, request: Request, env: Env) => {
  const headers = new Headers(response.headers);
  Object.entries(accountCorsHeaders(request, env)).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { headers, status: response.status, statusText: response.statusText });
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
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <title>Opening secure checkout | PencilProof</title>
    <style>
      :root{color-scheme:dark;--navy:#061126;--navy-2:#0b1b38;--navy-3:#10264a;--text:#f5f7fb;--muted:#d9e1ee;--gold:#f6c343;--line:rgba(217,225,238,.18)}*{box-sizing:border-box}body{position:relative;isolation:isolate;overflow:hidden;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 82% 12%,rgba(246,195,67,.1),transparent 27%),var(--navy);color:var(--text);font:500 15px/1.6 Manrope,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body:before{content:"";position:fixed;z-index:-1;inset:0;opacity:.28;background-image:linear-gradient(rgba(217,225,238,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(217,225,238,.05) 1px,transparent 1px);background-size:52px 52px;mask-image:linear-gradient(135deg,#000,transparent 68%)}.card{position:relative;width:min(600px,100%);overflow:hidden;padding:clamp(30px,6vw,54px);border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,rgba(11,27,56,.98),rgba(6,17,38,.97));box-shadow:0 28px 80px rgba(0,0,0,.38)}.card:before{content:"";position:absolute;top:-150px;right:-130px;width:330px;height:330px;border:1px solid rgba(246,195,67,.24);border-radius:50%;box-shadow:0 0 0 28px rgba(246,195,67,.035),0 0 0 56px rgba(246,195,67,.025);pointer-events:none}.card:after{content:"";position:absolute;right:34px;bottom:34px;width:76px;height:96px;border:1px solid rgba(217,225,238,.12);border-radius:4px;transform:rotate(8deg);box-shadow:-11px 11px 0 -1px var(--navy-2),-11px 11px 0 0 rgba(217,225,238,.12);pointer-events:none}.brand,.card h1,.card p,.status,.security-row,.helper{position:relative;z-index:1}.brand{display:flex;align-items:center;gap:12px;color:var(--text);font-size:16px;font-weight:800;letter-spacing:-.03em}.brand-logo{display:block;width:42px;height:42px;object-fit:cover;border:1px solid rgba(246,195,67,.5);border-radius:12px;background:var(--navy)}.eyebrow{margin:34px 0 12px;color:var(--gold);font-size:10px;font-weight:800;letter-spacing:.14em}.card h1{max-width:480px;margin:0;color:var(--text);font-size:clamp(34px,6vw,50px);font-weight:800;line-height:1.02;letter-spacing:-.055em}.card p{max-width:490px;margin:16px 0 0;color:var(--muted);font-size:15px;line-height:1.7}.status{display:flex;align-items:flex-start;gap:10px;margin-top:27px;padding:15px 16px;border:1px solid rgba(246,195,67,.38);border-radius:10px;background:rgba(246,195,67,.1);color:#ffe39a;font-weight:700}.status:before{content:"";flex:0 0 8px;width:8px;height:8px;margin-top:8px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 5px rgba(246,195,67,.12)}.status a{color:var(--text);text-decoration:underline;text-decoration-color:var(--gold);text-underline-offset:3px}.security-row{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:22px;color:#aebbd0;font-size:9px;font-weight:800;letter-spacing:.11em}.security-row span:before{content:"✓";margin-right:6px;color:var(--gold)}.helper{margin-top:28px!important;padding-top:20px;border-top:1px solid var(--line);font-size:12px!important}.helper a{color:var(--gold);text-decoration:underline;text-decoration-color:rgba(246,195,67,.65);text-underline-offset:3px}a{color:var(--gold)}@media (max-width:520px){body{padding:15px}.card{padding:28px 22px;border-radius:14px}.card:after{right:20px;bottom:24px;opacity:.55}.eyebrow{margin-top:27px}.card h1{font-size:38px}.card p{font-size:14px}.security-row{gap:7px 14px;font-size:8px}}
    </style>
  </head>
  <body>
    <main class="card">
      <div class="brand"><img class="brand-logo" src="/pencilproof-profile-mark.png" alt="" width="42" height="42"><span>PencilProof</span></div>
      <p class="eyebrow">PRIVACY-FIRST FULL QUOTE AUDIT</p>
      <h1>Opening secure checkout.</h1>
      <p>Your quote stays in this browser. PencilProof is preparing Stripe checkout for the one-time Full Quote Audit.</p>
      <div class="status" role="status"><span id="status">Connecting securely…</span></div>
      <div class="security-row" aria-label="Checkout details"><span>ONE-TIME AUDIT</span><span>SECURE STRIPE CHECKOUT</span><span>NO SUBSCRIPTION</span></div>
      <p class="helper"><a href="/recover">Already purchased? Restore access.</a></p>
      <noscript><p>JavaScript is required to continue. Return to <a href="https://pencilproof.com/">PencilProof</a> after enabling it.</p></noscript>
    </main>
    <script>
      (() => {
        const status = document.getElementById("status");
        let referralCode = "";
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
              if (typeof envelope.payload.referralCode === "string" && /^[A-Za-z0-9]{8,32}$/.test(envelope.payload.referralCode)) {
                referralCode = envelope.payload.referralCode.toUpperCase();
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
              analyticsSessionId: localStorage.getItem("pencilproof:analytics-session"),
              analyticsSource: sessionStorage.getItem("pencilproof:analytics-attribution"),
              referralCode
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
  headers.set("Stripe-Version", "2026-06-24.dahlia");
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
  analyticsSource = "",
  userId: string | null = null,
  referralCode = "",
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
    ...( /^[A-Za-z0-9._/-]{1,160}$/.test(analyticsSource)
      ? { "metadata[pencilproof_analytics_source]": analyticsSource }
      : {}),
    ...(userId ? { "metadata[pencilproof_user_id]": userId } : {}),
    ...(referralCode ? { "metadata[pencilproof_referral_code]": referralCode } : {}),
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

const createSalespersonCheckoutSession = async (
  env: Env,
  userId: string,
  email: string,
) => {
  const stripePriceId = typeof env.STRIPE_SALESPERSON_PRICE_ID === "string"
    ? env.STRIPE_SALESPERSON_PRICE_ID.trim()
    : "";
  if (!/^price_[A-Za-z0-9]+$/.test(stripePriceId)) {
    throw new CheckoutError("stripe_price_id_invalid", "Salesperson subscription is not configured yet");
  }
  const stripeSecretKey = typeof env.STRIPE_SECRET_KEY === "string" ? env.STRIPE_SECRET_KEY.trim() : "";
  if (!stripeSecretKey) throw new CheckoutError("stripe_secret_key_invalid", "Stripe secret key is not configured");
  const parameters = new URLSearchParams({
    cancel_url: `${env.SITE_ORIGIN}/sales?billing=cancelled`,
    "customer_email": email,
    "line_items[0][quantity]": "1",
    "line_items[0][price]": stripePriceId,
    "metadata[pencilproof_product]": SALESPERSON_PRODUCT_CODE,
    "metadata[pencilproof_user_id]": userId,
    mode: "subscription",
    success_url: `${env.SITE_ORIGIN}/sales?billing=success`,
    "subscription_data[metadata][pencilproof_product]": SALESPERSON_PRODUCT_CODE,
    "subscription_data[metadata][pencilproof_user_id]": userId,
  });
  const promotionCodeId = typeof env.STRIPE_SALESPERSON_PROMOTION_CODE_ID === "string"
    ? env.STRIPE_SALESPERSON_PROMOTION_CODE_ID.trim()
    : "";
  if (/^promo_[A-Za-z0-9]+$/.test(promotionCodeId)) {
    const promotionResponse = await stripeRequest(`/promotion_codes/${encodeURIComponent(promotionCodeId)}`, env);
    const promotion = await promotionResponse.json() as {
      active?: boolean;
      max_redemptions?: number | null;
      times_redeemed?: number;
    };
    const withinLimit = promotion.max_redemptions === null
      || promotion.max_redemptions === undefined
      || (promotion.times_redeemed ?? 0) < promotion.max_redemptions;
    if (promotionResponse.ok && promotion.active === true && withinLimit) {
      parameters.set("discounts[0][promotion_code]", promotionCodeId);
    }
  }
  const response = await stripeRequest("/checkout/sessions", env, { body: parameters, method: "POST" });
  const session = await response.json() as StripeCheckoutSession & { error?: { message?: string; code?: string; param?: string } };
  if (!response.ok || !session.url || !session.url.startsWith("https://checkout.stripe.com/")) {
    throw new CheckoutError("stripe_api_rejected", session.error?.message ?? "Salesperson subscription checkout failed");
  }
  return session;
};

const createSalespersonPortalSession = async (env: Env, stripeCustomerId: string) => {
  if (!/^cus_[A-Za-z0-9]+$/.test(stripeCustomerId)) throw new CheckoutError("stripe_api_rejected", "Salesperson billing profile is not ready");
  const response = await stripeRequest("/billing_portal/sessions", env, {
    body: new URLSearchParams({ customer: stripeCustomerId, return_url: `${env.SITE_ORIGIN}/sales` }),
    method: "POST",
  });
  const session = await response.json() as { url?: string; error?: { message?: string } };
  if (!response.ok || !session.url || !session.url.startsWith("https://billing.stripe.com/")) throw new CheckoutError("stripe_api_rejected", session.error?.message ?? "Billing portal unavailable");
  return session.url;
};

const addSalespersonSubscriptionCredit = async (
  env: Env,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  rewardId: string,
) => {
  if (!/^cus_[A-Za-z0-9]+$/.test(stripeCustomerId) || !/^sub_[A-Za-z0-9]+$/.test(stripeSubscriptionId) || !/^[0-9a-f-]{36}$/i.test(rewardId)) return false;
  const parameters = new URLSearchParams({
    amount: String(-SALESPERSON_CREDIT_AMOUNT_CENTS),
    currency: "usd",
    customer: stripeCustomerId,
    description: "PencilProof salesperson referral credit for next subscription invoice",
    discountable: "false",
    subscription: stripeSubscriptionId,
  });
  const response = await stripeRequest("/invoiceitems", env, {
    body: parameters,
    headers: { "Idempotency-Key": `pencilproof-referral-${rewardId}` },
    method: "POST",
  });
  if (response.ok) return true;
  console.error("Salesperson referral credit failed", { rewardId, status: response.status });
  return false;
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
  for (const event of STRIPE_WEBHOOK_EVENTS.slice(5)) {
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
  const subtotal = session?.amount_subtotal;
  const total = session?.amount_total;
  const discount = session?.total_details?.amount_discount;
  const shipping = session?.total_details?.amount_shipping;
  const tax = session?.total_details?.amount_tax;
  return Boolean(
    session
    && session.status === "complete"
    && session.payment_status === "paid"
    && session.mode === "payment"
    && session.managed_payments?.enabled === true
    && typeof subtotal === "number"
    && Number.isInteger(subtotal)
    && subtotal > 0
    && typeof total === "number"
    && Number.isInteger(total)
    && total > 0
    && typeof discount === "number"
    && Number.isInteger(discount)
    && discount >= 0
    && discount <= subtotal
    && typeof shipping === "number"
    && Number.isInteger(shipping)
    && shipping === 0
    && typeof tax === "number"
    && Number.isInteger(tax)
    && tax >= 0
    && total === subtotal - discount + shipping + tax
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
    const accountUserId = session?.metadata?.pencilproof_user_id;
    const validAccountUserId = typeof accountUserId === "string" && /^[A-Za-z0-9_:-]{8,200}$/.test(accountUserId) ? accountUserId : null;
    await accountCall(env, "/entitlement", {
      userId: validAccountUserId,
      guestId: /^[a-f0-9]{64}$/.test(deviceHash) ? deviceHash : null,
      stripeSessionId: sessionId,
      activatedAt: createdAt,
    });
    await recordMarketingActivity(env, validAccountUserId, "purchase_completed");
    const referralCode = session?.metadata?.pencilproof_referral_code ?? "";
    if (/^[A-Za-z0-9]{8,32}$/.test(referralCode)) {
      const reward = await accountCall(env, "/referral-reward", {
        referralCode: referralCode.toUpperCase(),
        stripeSessionId: sessionId,
        customerUserId: validAccountUserId,
        customerEmail: session?.customer_details?.email ?? null,
      });
      const rewardId = typeof reward?.rewardId === "string" ? reward.rewardId : "";
      if (reward?.status === "pending" && rewardId) await accountCall(env, "/referral-reward-confirm", { rewardId });
    }
    const analyticsSessionId = session?.metadata?.pencilproof_analytics_session;
    if (/^[A-Za-z0-9_-]{20,80}$/.test(analyticsSessionId ?? "")) {
      await recordAnalyticsEvent({
        event: "payment_completed",
        sessionId: analyticsSessionId,
        source: /^[A-Za-z0-9._/-]{1,160}$/.test(session?.metadata?.pencilproof_analytics_source ?? "")
          ? session?.metadata?.pencilproof_analytics_source
          : undefined,
        value: Math.max(0, Number(session?.amount_total ?? 0)),
        currency: String(session?.currency ?? "").toLowerCase(),
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

const processSalespersonCheckout = async (sessionId: string, env: Env) => {
  const session = await retrieveCheckoutSession(sessionId, env);
  const userId = session?.metadata?.pencilproof_user_id ?? "";
  const priceId = typeof env.STRIPE_SALESPERSON_PRICE_ID === "string" ? env.STRIPE_SALESPERSON_PRICE_ID.trim() : "";
  if (
    !session
    || session.status !== "complete"
    || session.mode !== "subscription"
    || session.payment_status !== "paid"
    || session.metadata?.pencilproof_product !== SALESPERSON_PRODUCT_CODE
    || !/^[A-Za-z0-9_:-]{8,200}$/.test(userId)
    || !/^price_[A-Za-z0-9]+$/.test(priceId)
    || !/^cus_[A-Za-z0-9]+$/.test(session.customer ?? "")
    || !/^sub_[A-Za-z0-9]+$/.test(session.subscription ?? "")
  ) return false;
  const lineItems = await retrieveCheckoutLineItems(sessionId, env);
  if (!hasExactPencilProofLineItem(lineItems, priceId)) return false;
  const result = await accountCall(env, "/salesperson-subscription", {
    action: "activate",
    userId,
    stripeCustomerId: session.customer,
    stripeSubscriptionId: session.subscription,
    status: "active",
  });
  return Boolean(result?.profile);
};

const processSalespersonSubscriptionEvent = async (event: StripeEvent, env: Env) => {
  const object = event.data?.object ?? {};
  const customer = typeof object.customer === "string" ? object.customer : "";
  const subscription = typeof object.subscription === "string" ? object.subscription : "";
  if (!customer && !subscription) return true;
  const status = event.type === "invoice.paid"
    ? "active"
    : event.type === "invoice.payment_failed"
      ? "past_due"
      : event.type === "customer.subscription.deleted"
        ? "canceled"
        : "";
  if (!status) return true;
  const result = await accountCall(env, "/salesperson-subscription", {
    action: "status",
    stripeCustomerId: customer,
    stripeSubscriptionId: subscription,
    status,
  });
  // The webhook endpoint may receive unrelated Billing events from the same
  // Stripe account. Ignore those safely; checkout.session.completed performs
  // strict validation for PencilProof's own salesperson plan.
  return true;
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
    if (object.metadata?.pencilproof_product === SALESPERSON_PRODUCT_CODE) {
      const activated = await processSalespersonCheckout(sessionId, env);
      if (!activated) return new Response("Salesperson subscription verification failed", { status: 503 });
      return Response.json({ received: true });
    }
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

  if (
    event.type === "invoice.paid"
    || event.type === "invoice.payment_failed"
    || event.type === "customer.subscription.deleted"
  ) {
    const processed = await processSalespersonSubscriptionEvent(event, env);
    if (!processed) return new Response("Salesperson subscription update failed", { status: 503 });
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
      analyticsSource?: string;
      referralCode?: string;
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
    const userId = await currentUser(request, env);
    await recordMarketingActivity(env, userId, "checkout_started");
    const session = await createCheckoutSession(
      env,
      deviceHash,
      body.analyticsSessionId ?? "",
      body.analyticsSource ?? "",
      userId,
      /^[A-Za-z0-9]{8,32}$/.test(body.referralCode ?? "") ? body.referralCode!.toUpperCase() : "",
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

const analyticsCorsHeaders = (request: Request, env: Env) => ({
  "Access-Control-Allow-Origin": (() => {
    const origin = request.headers.get("Origin");
    return origin === env.PUBLIC_SITE_ORIGIN || origin === env.SITE_ORIGIN
      ? origin
      : env.PUBLIC_SITE_ORIGIN;
  })(),
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
});

const handleAnalytics = async (request: Request, env: Env) => {
  const headers = analyticsCorsHeaders(request, env);
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

  // The account may have been linked after Stripe created the session, or the
  // webhook may have fulfilled the order before the browser returned here.
  // Reconcile the signed-in consumer now so a successful payment is usable
  // from My Audits as well as from this checkout browser.
  const userId = await currentUser(request, env);
  if (userId) {
    try {
      await accountCall(env, "/migrate", { guestId: deviceHash, userId });
      await accountCall(env, "/entitlement", {
        userId,
        stripeSessionId: sessionId,
        activatedAt: redemption.expiresAt - accessSeconds(env),
        exactExpiresAt: redemption.expiresAt,
      });
    } catch (error) {
      console.error("Paid account entitlement reconciliation failed", {
        message: error instanceof Error ? error.message : "Unknown error",
        sessionId,
        userId,
      });
    }
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
  return redirect(`${env.SITE_ORIGIN}/analyze/secure/`, {
    "Set-Cookie": accessCookie(token, maxAge),
  });
};

const hasAccess = async (
  request: Request,
  env: Env,
): Promise<OrderRedeemResult> => {
  const accountExpiresAt = await accountAccess(request, env);
  if (accountExpiresAt) return { allowed: true, expiresAt: accountExpiresAt };
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
      <form action="/recover/account" method="post">
        <label for="session_id">Checkout Session ID</label>
        <input id="session_id" name="session_id" pattern="cs_[A-Za-z0-9_]+" required autocomplete="off">
        <button type="submit">Restore to my signed-in account</button>
      </form>
      <p>Sign in to the PencilProof account that should receive the paid access before submitting this form.</p>
      <p><a href="mailto:support@pencilproof.com">Contact PencilProof support</a></p>
    </main>
  </body>
</html>`, { headers });
};

export const handleRequest = async (request: Request, env: Env) => {
  const url = new URL(request.url);

  const auditHost = new URL(env.SITE_ORIGIN).hostname;
  if (url.hostname === auditHost && url.pathname === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", {
      headers: {
        ...noStoreHeaders,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
  if (url.hostname === auditHost && url.pathname === "/sitemap.xml") {
    return redirect(env.PUBLIC_SITE_ORIGIN + "/sitemap.xml");
  }
  if (url.hostname === auditHost && (url.pathname === "/guides" || url.pathname.startsWith("/guides/"))) {
    return publicPageRedirect(url, env);
  }
  if (url.pathname === "/") {
    return redirect(env.PUBLIC_SITE_ORIGIN);
  }
  if (publicPagePaths.has(url.pathname)) {
    return publicPageRedirect(url, env);
  }
  if (url.pathname === "/handoff" || url.pathname === "/handoff/") {
    return handoffPage();
  }
  if (url.pathname === "/api/email/unsubscribe" && (request.method === "GET" || request.method === "POST")) {
    return handleMarketingUnsubscribe(request, env);
  }
  if (url.pathname === "/api/email/preferences" && (request.method === "GET" || request.method === "POST")) {
    return handleMarketingPreferences(request, env);
  }
  if (url.pathname === "/api/checkout") {
    return handleCheckout(request, env);
  }
  if (url.pathname === "/api/salesperson/checkout") {
    return handleSalespersonCheckout(request, env);
  }
  if (url.pathname === "/api/ai-import") {
    return handleAiImport(request, env);
  }
  if (url.pathname === "/api/phone-session") {
    return handlePhoneSession(request, env);
  }
  if (
    url.pathname === "/api/account/session"
    || url.pathname === "/api/account/logout"
    || url.pathname === "/api/account/me"
    || url.pathname === "/api/account/audits"
    || url.pathname === "/api/account/marketing"
    || url.pathname === "/api/account/marketing/activity"
    || url.pathname === "/api/account/delete"
    || url.pathname === "/api/salesperson/me"
    || url.pathname === "/api/salesperson/playbook"
    || url.pathname === "/api/salesperson/credit"
    || url.pathname === "/api/salesperson/portal"
    || url.pathname === "/api/salesperson/gift/claim"
  ) {
    return handleAccount(request, env);
  }
  if (url.pathname === "/api/audits") {
    return handleAuditStorage(request, env);
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
    url.pathname === "/recover/account"
    || url.pathname === "/recover/account/"
  ) {
    return restorePaidAccountAccess(request, env);
  }
  if (
    url.pathname === "/recover/access"
    || url.pathname === "/recover/access/"
  ) {
    return handleSuccess(request, env);
  }
  if (url.pathname === "/logout" || url.pathname === "/logout/") {
   const headers = new Headers(noStoreHeaders);
   headers.append("Set-Cookie", clearAccountCookie);
   headers.append("Set-Cookie", clearAccountRoleCookie);
    appendExpiredAccessCookies(headers, env);
   headers.set("Location", env.PUBLIC_SITE_ORIGIN);
    return new Response(null, { status: 303, headers });
  }

  if (url.pathname.startsWith("/api/")) {
    return new Response("Not found", {
      status: 404,
      headers: noStoreHeaders,
    });
  }

  // Only the audit HTML route needs an entitlement check. The analyze bundle
  // contains no customer data and is shared by the public scan, so serving
  // its static chunks directly avoids a Durable Object lookup for every JS
  // asset loaded after a successful secure-page check.
  const protectedPath = url.pathname === "/analyze"
    || url.pathname.startsWith("/analyze/");
  if (protectedPath) {
    const access = await hasAccess(request, env);
    if (access.allowed) {
      const assetUrl = new URL(request.url);
      if (assetUrl.pathname === "/analyze/secure" || assetUrl.pathname.startsWith("/analyze/secure/")) {
        assetUrl.pathname = assetUrl.pathname.replace(/^\/analyze\/secure(?=\/|$)/, "/analyze");
      }
      const response = await env.ASSETS.fetch(new Request(assetUrl, request));
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "private, no-store, max-age=0");
      headers.set("Vary", "Cookie");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    const location = access.reason === "not_found"
        ? `${env.PUBLIC_SITE_ORIGIN}/analyze${url.search}`
        : access.reason === "revoked"
      ? `${env.SITE_ORIGIN}/recover?reason=revoked`
      : `${env.SITE_ORIGIN}/handoff?reason=access_required`;
    return redirect(location, {
      "Set-Cookie":
        `${ACCESS_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
    });
  }

  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export default {
  fetch: handleRequest,
  scheduled: (controller: { scheduledTime: number }, env: Env, context: { waitUntil(promise: Promise<unknown>): void }) => {
    context.waitUntil(runMarketingCampaign(env, controller.scheduledTime));
  },
};
