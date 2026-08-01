"use client";

export const ANALYTICS_URL = "https://audit.pencilproof.com/api/analytics";

type AnalyticsEvent = {
  category?: string;
  comment?: string;
  event: string;
  path?: string;
  value?: number;
};

const sessionId = () => {
  if (typeof window === "undefined") return "";
  const key = "pencilproof:analytics-session";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const generated = `${crypto.randomUUID()}-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(key, generated);
  return generated;
};

const device = () => {
  if (typeof window === "undefined") return undefined;
  const width = window.innerWidth;
  return width < 700 ? "mobile" : width < 1100 ? "tablet" : "desktop";
};

export const track = (event: AnalyticsEvent) => {
  if (typeof window === "undefined") return;
  const utmSource = new URLSearchParams(window.location.search).get("utm_source");
  let referrer = "direct";
  try {
    referrer = document.referrer ? new URL(document.referrer).hostname : "direct";
  } catch {
    referrer = "direct";
  }
  const payload = JSON.stringify({
    ...event,
    device: device(),
    path: event.path ?? window.location.pathname,
    sessionId: sessionId(),
    source: utmSource ?? referrer,
  });
  void fetch(`${ANALYTICS_URL}/event`, {
    body: payload,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => undefined);
};

export const getAnalyticsSessionId = sessionId;
