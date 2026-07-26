const ACCESS_COOKIE = "pp_access";
const PRODUCT_CODE = "full_quote_audit_v1";
const PRODUCT_PRICE_CENTS = 3900;
const DEFAULT_ACCESS_SECONDS = 60 * 60 * 24 * 30;
const QUOTE_HANDOFF_KEY = "pencilproof:pending-import";
const QUOTE_HANDOFF_TYPE = "pencilproof:quote-handoff:v1";

export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  ACCESS_MAX_AGE_SECONDS?: string;
  PUBLIC_SITE_ORIGIN: string;
  SESSION_SECRET: string;
  SITE_ORIGIN: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_SECRET_KEY: string;
}

type AccessPayload = {
  exp: number;
  sid: string;
};

type StripeCheckoutSession = {
  amount_total?: number | null;
  currency?: string | null;
  id: string;
  metadata?: Record<string, string> | null;
  mode?: string | null;
  payment_status?: string | null;
  status?: string | null;
  url?: string | null;
};

type CheckoutErrorCode =
  | "stripe_price_id_invalid"
  | "stripe_secret_key_invalid"
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
  secret: string,
  maxAgeSeconds = DEFAULT_ACCESS_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
) => {
  const payload = base64UrlEncode(
    encoder.encode(JSON.stringify({
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
          credentials: "same-origin"
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
  headers.set("Authorization", `Bearer ${env.STRIPE_SECRET_KEY}`);
  headers.set("Stripe-Version", "2026-04-22.dahlia");
  return fetch(`https://api.stripe.com/v1${path}`, { ...init, headers });
};

const createCheckoutSession = async (env: Env) => {
  if (
    typeof env.STRIPE_SECRET_KEY !== "string"
    || !/^rk_(test|live)_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY)
  ) {
    throw new CheckoutError(
      "stripe_secret_key_invalid",
      "Stripe restricted key is not configured",
    );
  }

  const stripePriceId = typeof env.STRIPE_PRICE_ID === "string"
    ? env.STRIPE_PRICE_ID.trim()
    : "";
  const parameters = new URLSearchParams({
    "allow_promotion_codes": "false",
    "billing_address_collection": "auto",
    "cancel_url": `${env.PUBLIC_SITE_ORIGIN}/#pricing`,
    "customer_creation": "always",
    "line_items[0][quantity]": "1",
    "metadata[pencilproof_product]": PRODUCT_CODE,
    mode: "payment",
    "payment_intent_data[description]": "PencilProof Full Quote Audit",
    "payment_intent_data[metadata][pencilproof_product]": PRODUCT_CODE,
    "success_url": `${env.SITE_ORIGIN}/success?session_id={CHECKOUT_SESSION_ID}`,
  });
  if (/^price_[A-Za-z0-9]+$/.test(stripePriceId)) {
    parameters.set("line_items[0][price]", stripePriceId);
  } else {
    parameters.set("line_items[0][price_data][currency]", "usd");
    parameters.set(
      "line_items[0][price_data][product_data][name]",
      "PencilProof Full Quote Audit",
    );
    parameters.set(
      "line_items[0][price_data][unit_amount]",
      String(PRODUCT_PRICE_CENTS),
    );
  }

  const response = await stripeRequest("/checkout/sessions", env, {
    body: parameters,
    method: "POST",
  });
  const session = await response.json() as StripeCheckoutSession & {
    error?: { message?: string };
  };
  if (
    !response.ok
    || !session.url
    || !session.url.startsWith("https://checkout.stripe.com/")
  ) {
    throw new CheckoutError(
      "stripe_api_rejected",
      session.error?.message ?? "Stripe checkout session failed",
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

const isPaidPencilProofSession = (session: StripeCheckoutSession | null) =>
  Boolean(
    session
    && session.status === "complete"
    && session.payment_status === "paid"
    && session.mode === "payment"
    && session.amount_total === PRODUCT_PRICE_CENTS
    && session.currency?.toLowerCase() === "usd"
    && session.metadata?.pencilproof_product === PRODUCT_CODE,
  );

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
    const session = await createCheckoutSession(env);
    return Response.json(
      { url: session.url },
      { headers: { "Cache-Control": "no-store" } },
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

const handleSuccess = async (url: URL, env: Env) => {
  const sessionId = url.searchParams.get("session_id") ?? "";
  const session = await retrieveCheckoutSession(sessionId, env);
  if (!isPaidPencilProofSession(session)) {
    return redirect(`${env.PUBLIC_SITE_ORIGIN}/?payment=unverified#pricing`);
  }

  const maxAge = accessSeconds(env);
  const token = await createAccessToken(
    sessionId,
    env.SESSION_SECRET,
    maxAge,
  );
  return redirect(`${env.SITE_ORIGIN}/analyze/`, {
    "Set-Cookie": [
      `${ACCESS_COOKIE}=${token}`,
      `Max-Age=${maxAge}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
    ].join("; "),
  });
};

const hasAccess = async (request: Request, env: Env) => {
  const token = readCookie(request, ACCESS_COOKIE);
  if (!token) return false;
  return Boolean(await verifyAccessToken(token, env.SESSION_SECRET));
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
  if (url.pathname === "/success" || url.pathname === "/success/") {
    return handleSuccess(url, env);
  }
  if (url.pathname === "/logout" || url.pathname === "/logout/") {
    return redirect(env.PUBLIC_SITE_ORIGIN, {
      "Set-Cookie":
        `${ACCESS_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
    });
  }

  const protectedPath = url.pathname === "/analyze"
    || url.pathname.startsWith("/analyze/")
    || url.pathname.startsWith("/_next/static/chunks/app/analyze/");
  if (protectedPath && !(await hasAccess(request, env))) {
    return redirect(`${env.SITE_ORIGIN}/handoff?reason=access_required`);
  }

  return env.ASSETS.fetch(request);
};

export default {
  fetch: handleRequest,
};
