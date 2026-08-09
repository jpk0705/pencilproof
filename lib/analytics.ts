"use client";

export const ANALYTICS_URL = "https://audit.pencilproof.com/api/analytics";

const PENDING_KEY = "pencilproof:analytics-pending";
const ATTRIBUTION_KEY = "pencilproof:analytics-attribution";
const MAX_PENDING_EVENTS = 500;
const SESSION_IDLE_MILLISECONDS = 30 * 60 * 1000;

type AnalyticsEvent = {
  category?: string;
  comment?: string;
  event: string;
  path?: string;
  value?: number;
};

type QueuedAnalyticsEvent = AnalyticsEvent & {
  device?: "mobile" | "desktop" | "tablet";
  eventId: string;
  occurredAt: string;
  sessionId: string;
  source: string;
};

let flushing = false;

const sessionId = () => {
  if (typeof window === "undefined") return "";
  const key = "pencilproof:analytics-session";
  const lastSeenKey = `${key}:last-seen`;
  const now = Date.now();
  const existing = window.localStorage.getItem(key);
  const lastSeen = Number(window.localStorage.getItem(lastSeenKey));
  if (existing && Number.isFinite(lastSeen) && now - lastSeen <= SESSION_IDLE_MILLISECONDS) {
    window.localStorage.setItem(lastSeenKey, String(now));
    return existing;
  }
  const generated = crypto.randomUUID();
  window.localStorage.setItem(key, generated);
  window.localStorage.setItem(lastSeenKey, String(now));
  return generated;
};

const eventId = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`;
};

const device = () => {
  if (typeof window === "undefined") return undefined;
  const width = window.innerWidth;
  return width < 700 ? "mobile" : width < 1100 ? "tablet" : "desktop";
};

const readPending = (): QueuedAnalyticsEvent[] => {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is QueuedAnalyticsEvent =>
          Boolean(
            item
            && typeof item === "object"
            && typeof item.eventId === "string"
            && typeof item.event === "string"
            && typeof item.sessionId === "string",
          ))
      : [];
  } catch {
    return [];
  }
};

const writePending = (events: QueuedAnalyticsEvent[]) => {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      PENDING_KEY,
      JSON.stringify(events.slice(-MAX_PENDING_EVENTS)),
    );
    return true;
  } catch {
    return false;
  }
};

const enqueue = (event: QueuedAnalyticsEvent) => {
  const pending = readPending();
  if (pending.some((item) => item.eventId === event.eventId)) return true;
  pending.push(event);
  return writePending(pending);
};

const send = async (event: QueuedAnalyticsEvent) => {
  const response = await fetch(`${ANALYTICS_URL}/event`, {
    body: JSON.stringify(event),
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
  });
  if (!response.ok) throw new Error("analytics_event_not_recorded");
};

export const flushAnalyticsQueue = async () => {
  if (typeof window === "undefined" || flushing) return;
  flushing = true;
  try {
    while (true) {
      const pending = readPending();
      const next = pending[0];
      if (!next) break;
      try {
        await send(next);
      } catch {
        break;
      }
      const latest = readPending();
      writePending(latest.filter((item) => item.eventId !== next.eventId));
    }
  } finally {
    flushing = false;
  }
};

export const track = (event: AnalyticsEvent) => {
  if (typeof window === "undefined") return;
  const query = new URLSearchParams(window.location.search);
  const utmSource = query.get("utm_source");
  const utmMedium = query.get("utm_medium");
  const utmCampaign = query.get("utm_campaign");
  const existingAttribution = window.sessionStorage.getItem(ATTRIBUTION_KEY);
  const attribution = utmSource
    ? [utmSource, utmMedium, utmCampaign].filter(Boolean).join("/")
    : existingAttribution;
  if (attribution) window.sessionStorage.setItem(ATTRIBUTION_KEY, attribution);
  let referrer = "direct";
  try {
    referrer = document.referrer ? new URL(document.referrer).hostname : "direct";
  } catch {
    referrer = "direct";
  }

  const payload: QueuedAnalyticsEvent = {
    ...event,
    device: device(),
    eventId: eventId(),
    occurredAt: new Date().toISOString(),
    path: event.path ?? window.location.pathname,
    sessionId: sessionId(),
    source: attribution ?? (referrer === "audit.pencilproof.com" ? "internal-audit" : referrer),
  };

  if (!enqueue(payload)) {
    void send(payload).catch(() => undefined);
    return;
  }
  void flushAnalyticsQueue();
};

export const getAnalyticsSessionId = sessionId;
