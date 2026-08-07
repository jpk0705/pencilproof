import app, { type Env } from "./index.ts";

export { AnalyticsStore, OrderStore } from "./index.ts";
export type { Env } from "./index.ts";

const analyticsCorsHeaders = (env: Env) => ({
  "Access-Control-Allow-Origin": env.PUBLIC_SITE_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
});

const handleAnalyticsRoute = async (request: Request, env: Env) => {
  const url = new URL(request.url);
  const internalPath = url.pathname === "/api/analytics/event"
    ? "/event"
    : url.pathname === "/api/analytics/summary"
      ? "/summary"
      : null;
  if (!internalPath) return null;

  const headers = analyticsCorsHeaders(env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (
    (internalPath === "/event" && request.method !== "POST")
    || (internalPath === "/summary" && request.method !== "GET")
  ) {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        ...headers,
        Allow: internalPath === "/event" ? "POST, OPTIONS" : "GET, OPTIONS",
      },
    });
  }

  const stub = env.ANALYTICS.get(
    env.ANALYTICS.idFromName("pencilproof-analytics"),
  );
  const response = await stub.fetch(
    new Request(`https://analytics.internal${internalPath}`, {
      method: request.method,
      headers: request.headers,
      body: request.method === "POST" ? await request.text() : undefined,
    }),
  );
  const responseHeaders = new Headers(response.headers);
  Object.entries(headers).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
};

export const handleRequest = async (request: Request, env: Env) =>
  await handleAnalyticsRoute(request, env) ?? app.fetch(request, env);

export default {
  fetch: handleRequest,
};
