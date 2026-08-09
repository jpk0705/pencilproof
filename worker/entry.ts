import app, { type Env } from "./index.ts";

export { OrderStore } from "./index.ts";
export type { Env } from "./index.ts";

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
const ANALYTICS_MAX_FEEDBACK = 500;

type AnalyticsEventName = typeof ANALYTICS_EVENT_NAMES[number];
type SqlValue = string | number | null;
type SqlRow = Record<string, SqlValue>;
type SqlCursorLike<T extends SqlRow> = Iterable<T> & {
  one(): T;
  rowsWritten: number;
  toArray(): T[];
};
type SqlStorageLike = {
  exec<T extends SqlRow = SqlRow>(
    query: string,
    ...bindings: SqlValue[]
  ): SqlCursorLike<T>;
};
type AnalyticsStateLike = {
  storage: {
    sql: SqlStorageLike;
  };
};

type AnalyticsEvent = {
  category?: string;
  comment?: string;
  device?: "mobile" | "desktop" | "tablet";
  event: AnalyticsEventName;
  eventId?: string;
  occurredAt?: string;
  path?: string;
  sessionId: string;
  source?: string;
  value?: number;
};

type CountRow = {
  count: number;
};
type EventCountRow = CountRow & {
  event_name: string;
};
type DayEventCountRow = EventCountRow & {
  day: string;
};
type CategoryCountRow = CountRow & {
  category: string;
};
type RatingCountRow = CountRow & {
  rating: number;
};
type MetaRow = {
  key: string;
  value: string;
};
type BoundsRow = {
  first_event_at: string | null;
  last_event_at: string | null;
};

type AnalyticsRangeKey = "7d" | "14d" | "1m" | "3m" | "6m" | "1y";

const ANALYTICS_RANGES: Array<{
  key: AnalyticsRangeKey;
  label: string;
  milliseconds: number;
}> = [
  { key: "7d", label: "7 days", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { key: "14d", label: "14 days", milliseconds: 14 * 24 * 60 * 60 * 1000 },
  { key: "1m", label: "1 month", milliseconds: 30 * 24 * 60 * 60 * 1000 },
  { key: "3m", label: "3 months", milliseconds: 90 * 24 * 60 * 60 * 1000 },
  { key: "6m", label: "6 months", milliseconds: 180 * 24 * 60 * 60 * 1000 },
  { key: "1y", label: "1 year", milliseconds: 365 * 24 * 60 * 60 * 1000 },
];

const analyticsRange = (value: string | null): (typeof ANALYTICS_RANGES)[number] =>
  ANALYTICS_RANGES.find((range) => range.key === value) ?? ANALYTICS_RANGES[0];

const limitedText = (value: unknown, maxLength: number) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;

const eventIdFor = (event: AnalyticsEvent) => {
  if (
    typeof event.eventId === "string"
    && /^[A-Za-z0-9:_-]{20,160}$/.test(event.eventId)
  ) {
    return event.eventId;
  }
  if (event.event === "payment_completed") {
    return `payment_completed:${event.sessionId}`;
  }
  return `generated:${crypto.randomUUID()}`;
};

export class AnalyticsStore {
  private readonly sql: SqlStorageLike;

  constructor(state: AnalyticsStateLike) {
    this.sql = state.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        event_id TEXT PRIMARY KEY,
        event_name TEXT NOT NULL,
        session_id TEXT NOT NULL,
        received_at TEXT NOT NULL,
        occurred_at TEXT,
        day TEXT NOT NULL,
        category TEXT,
        rating INTEGER,
        comment TEXT,
        device TEXT,
        path TEXT,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_analytics_events_day_name
        ON analytics_events(day, event_name);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_name
        ON analytics_events(event_name);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_session
        ON analytics_events(session_id);
      CREATE TABLE IF NOT EXISTS analytics_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const startedAt = new Date().toISOString();
    this.sql.exec(
      "INSERT OR IGNORE INTO analytics_meta(key, value) VALUES ('ledger_started_at', ?)",
      startedAt,
    );
    this.sql.exec(
      "INSERT OR IGNORE INTO analytics_meta(key, value) VALUES ('schema_version', '2')",
    );
    this.sql.exec(
      "INSERT OR IGNORE INTO analytics_meta(key, value) VALUES ('duplicate_events_rejected', '0')",
    );
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/event") {
      let event: Partial<AnalyticsEvent>;
      try {
        event = await request.json() as Partial<AnalyticsEvent>;
      } catch {
        return new Response("Invalid analytics event", { status: 400 });
      }

      if (
        typeof event.sessionId !== "string"
        || !/^[A-Za-z0-9_-]{20,80}$/.test(event.sessionId)
        || typeof event.event !== "string"
        || !(ANALYTICS_EVENT_NAMES as readonly string[]).includes(event.event)
      ) {
        return new Response("Invalid analytics event", { status: 400 });
      }

      const normalized = event as AnalyticsEvent;
      const receivedAt = new Date().toISOString();
      const day = receivedAt.slice(0, 10);
      const eventId = eventIdFor(normalized);
      const category = limitedText(normalized.category, 40);
      const comment = normalized.event === "feedback_submitted"
        ? limitedText(normalized.comment, 1000)
        : null;
      const rating = normalized.event === "feedback_submitted"
        && Number.isInteger(normalized.value)
        ? Math.max(1, Math.min(5, Number(normalized.value)))
        : null;
      const occurredAt = typeof normalized.occurredAt === "string"
        && /^\d{4}-\d{2}-\d{2}T/.test(normalized.occurredAt)
        ? normalized.occurredAt.slice(0, 40)
        : null;
      const device = normalized.device === "mobile"
        || normalized.device === "tablet"
        || normalized.device === "desktop"
        ? normalized.device
        : null;

      this.sql.exec(
        `INSERT OR IGNORE INTO analytics_events (
          event_id, event_name, session_id, received_at, occurred_at, day,
          category, rating, comment, device, path, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        eventId,
        normalized.event,
        normalized.sessionId,
        receivedAt,
        occurredAt,
        day,
        category,
        rating,
        comment,
        device,
        limitedText(normalized.path, 240),
        limitedText(normalized.source, 160),
      );
      const inserted = this.sql.exec<CountRow>(
        "SELECT changes() AS count",
      ).one().count > 0;

      if (!inserted) {
        this.sql.exec(`
          UPDATE analytics_meta
          SET value = CAST(value AS INTEGER) + 1
          WHERE key = 'duplicate_events_rejected'
        `);
      }

      return Response.json({
        duplicate: !inserted,
        eventId,
        recorded: inserted,
      });
    }

    if (request.method === "GET" && url.pathname === "/summary") {
      const selectedRange = analyticsRange(url.searchParams.get("range"));
      const endAt = new Date();
      const startAt = new Date(endAt.getTime() - selectedRange.milliseconds);
      const startIso = startAt.toISOString();
      const endIso = endAt.toISOString();
      const eventWindow = "WHERE received_at >= ? AND received_at < ?";
      const byEvent: Record<string, number> = {};
      for (const row of this.sql.exec<EventCountRow>(`
        SELECT event_name, COUNT(*) AS count
        FROM analytics_events
        ${eventWindow}
        GROUP BY event_name
      `, startIso, endIso)) {
        byEvent[row.event_name] = Number(row.count) || 0;
      }

      const byDay: Record<string, Record<string, number>> = {};
      for (const row of this.sql.exec<DayEventCountRow>(`
        SELECT day, event_name, COUNT(*) AS count
        FROM analytics_events
        ${eventWindow}
        GROUP BY day, event_name
        ORDER BY day ASC
      `, startIso, endIso)) {
        byDay[row.day] ??= {};
        byDay[row.day][row.event_name] = Number(row.count) || 0;
      }

      const sessions = Number(this.sql.exec<CountRow>(`
        SELECT COUNT(DISTINCT session_id) AS count
        FROM analytics_events
        ${eventWindow}
      `, startIso, endIso).one().count) || 0;

      const distinctEventUsers = async (eventName: string) => Number(this.sql.exec<CountRow>(`
        SELECT COUNT(DISTINCT session_id) AS count
        FROM analytics_events
        ${eventWindow} AND event_name = ?
      `, startIso, endIso, eventName).one().count) || 0;
      const eventTotal = (eventName: string) => byEvent[eventName] ?? 0;
      const funnel = {
        visitors: await distinctEventUsers("page_view"),
        pageViews: eventTotal("page_view"),
        scanUsers: await distinctEventUsers("scan_started"),
        scanStarts: eventTotal("scan_started"),
        auditUsers: await distinctEventUsers("audit_completed"),
        auditsCompleted: eventTotal("audit_completed"),
        checkoutUsers: await distinctEventUsers("checkout_started"),
        checkoutStarts: eventTotal("checkout_started"),
        purchasers: await distinctEventUsers("payment_completed"),
        purchases: eventTotal("payment_completed"),
      };

      const byCategory: Record<string, number> = {};
      for (const row of this.sql.exec<CategoryCountRow>(`
        SELECT COALESCE(category, 'other') AS category, COUNT(*) AS count
        FROM analytics_events
        ${eventWindow} AND event_name = 'feedback_submitted'
        GROUP BY COALESCE(category, 'other')
      `, startIso, endIso)) {
        byCategory[row.category] = Number(row.count) || 0;
      }

      const byRating: Record<string, number> = {};
      for (const row of this.sql.exec<RatingCountRow>(`
        SELECT rating, COUNT(*) AS count
        FROM analytics_events
        ${eventWindow} AND event_name = 'feedback_submitted' AND rating IS NOT NULL
        GROUP BY rating
      `, startIso, endIso)) {
        byRating[String(row.rating)] = Number(row.count) || 0;
      }

      const meta = Object.fromEntries(
        this.sql.exec<MetaRow>(
          "SELECT key, value FROM analytics_meta",
        ).toArray().map((row) => [row.key, row.value]),
      );
      const bounds = this.sql.exec<BoundsRow>(`
        SELECT
          MIN(received_at) AS first_event_at,
          MAX(received_at) AS last_event_at
        FROM analytics_events
        ${eventWindow}
      `, startIso, endIso).one();
      const eventCount = Number(this.sql.exec<CountRow>(
        "SELECT COUNT(*) AS count FROM analytics_events",
      ).one().count) || 0;
      const reliableFrom = meta.ledger_started_at ?? new Date(0).toISOString();
      const lastEventAt = bounds.last_event_at;

      return Response.json({
        byDay,
        byEvent,
        feedback: {
          byCategory,
          byRating,
          recent: [],
          total: byEvent.feedback_submitted ?? 0,
        },
        ledger: {
          duplicateEventsRejected:
            Number(meta.duplicate_events_rejected ?? 0) || 0,
          eventCount,
          firstEventAt: bounds.first_event_at,
          lastEventAt,
          reliableFrom,
          schemaVersion: Number(meta.schema_version ?? 2) || 2,
          verified: true,
        },
        range: {
          end: endIso,
          key: selectedRange.key,
          label: selectedRange.label,
          start: startIso,
        },
        funnel,
        sessions,
        updatedAt: lastEventAt ?? reliableFrom,
      }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  // Old versions scheduled a 400-day alarm that erased the analytics store.
  // Keep the handler as a no-op so any already-scheduled legacy alarm can fire
  // safely without deleting the permanent event ledger.
  async alarm() {}
}

const analyticsCorsHeaders = (request: Request, env: Env) => ({
  "Access-Control-Allow-Origin": allowedAnalyticsOrigin(request, env),
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  Vary: "Origin",
});

const allowedAnalyticsOrigin = (request: Request, env: Env) => {
  const origin = request.headers.get("Origin");
  return origin === env.PUBLIC_SITE_ORIGIN || origin === env.SITE_ORIGIN
    ? origin
    : env.PUBLIC_SITE_ORIGIN;
};

const analyticsUnauthorized = () => new Response("Authentication required", {
  status: 401,
  headers: {
    "Cache-Control": "no-store",
    "WWW-Authenticate": 'Basic realm="PencilProof analytics", charset="UTF-8"',
  },
});

const constantTimeEqual = (left: Uint8Array, right: Uint8Array) => {
  const nativeTimingSafeEqual = (crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
  }).timingSafeEqual;
  if (nativeTimingSafeEqual) {
    return left.byteLength === right.byteLength
      ? nativeTimingSafeEqual(left, right)
      : !nativeTimingSafeEqual(left, left);
  }

  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
};

const base64Utf8 = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const requireAnalyticsAuth = (request: Request, env: Env) => {
  const username = env.ANALYTICS_DASHBOARD_USERNAME?.trim();
  const password = env.ANALYTICS_DASHBOARD_PASSWORD;
  if (!username || !password) {
    return new Response("Analytics credentials are not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const supplied = new TextEncoder().encode(request.headers.get("Authorization") ?? "");
  const expected = new TextEncoder().encode(`Basic ${base64Utf8(`${username}:${password}`)}`);
  const valid = constantTimeEqual(supplied, expected);
  return valid ? null : analyticsUnauthorized();
};

const analyticsDashboard = async (request: Request, env: Env) => {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  const authFailure = requireAnalyticsAuth(request, env);
  if (authFailure) return authFailure;
  const selectedRange = analyticsRange(new URL(request.url).searchParams.get("range"));
  const stub = env.ANALYTICS.get(env.ANALYTICS.idFromName("pencilproof-analytics"));
  const response = await stub.fetch(new Request(`https://analytics.internal/summary?range=${selectedRange.key}`));
  if (!response.ok) return new Response("Analytics unavailable", { status: 502 });
  const summary = await response.json() as {
    range?: { end?: string; key?: AnalyticsRangeKey; label?: string; start?: string };
    funnel?: {
      visitors?: number;
      pageViews?: number;
      scanUsers?: number;
      scanStarts?: number;
      auditUsers?: number;
      auditsCompleted?: number;
      checkoutUsers?: number;
      checkoutStarts?: number;
      purchasers?: number;
      purchases?: number;
    };
    sessions?: number;
    byEvent?: Record<string, number>;
    byDay?: Record<string, Record<string, number>>;
    updatedAt?: string;
  };
  const esc = (value: unknown) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
  const fallback = summary.byEvent ?? {};
  const funnel = {
    visitors: summary.funnel?.visitors ?? summary.sessions ?? 0,
    pageViews: summary.funnel?.pageViews ?? fallback.page_view ?? 0,
    scanUsers: summary.funnel?.scanUsers ?? 0,
    scanStarts: summary.funnel?.scanStarts ?? fallback.scan_started ?? 0,
    auditUsers: summary.funnel?.auditUsers ?? 0,
    auditsCompleted: summary.funnel?.auditsCompleted ?? fallback.audit_completed ?? 0,
    checkoutUsers: summary.funnel?.checkoutUsers ?? 0,
    checkoutStarts: summary.funnel?.checkoutStarts ?? fallback.checkout_started ?? 0,
    purchasers: summary.funnel?.purchasers ?? 0,
    purchases: summary.funnel?.purchases ?? fallback.payment_completed ?? 0,
  };
  const rangeKey = summary.range?.key ?? selectedRange.key;
  const rangeLabel = summary.range?.label ?? selectedRange.label;
  const percent = (part: number, whole: number) => whole ? `${Math.round((part / whole) * 100)}%` : "—";
  const funnelStep = (label: string, detail: string, count: number, denominator: number) => `<div class="funnel-step"><div><strong>${esc(label)}</strong><span>${esc(detail)}</span></div><b>${count.toLocaleString("en-US")}</b><div class="bar"><i style="width:${Math.min(100, Math.round((count / Math.max(1, denominator)) * 100))}%"></i></div></div>`;
  const funnelCards = [
    ["Visitors", "unique browsers that loaded PencilProof", funnel.visitors],
    ["Used the scan", "unique browsers that started an upload", funnel.scanUsers],
    ["Reached checkout", "unique browsers that opened checkout", funnel.checkoutUsers],
    ["Purchased", "unique browsers with a verified Stripe payment", funnel.purchasers],
  ].map(([label, detail, count]) => `<div class="card"><div class="label">${esc(label)}</div><div class="big">${Number(count).toLocaleString("en-US")}</div><p>${esc(detail)}</p></div>`).join("");
  const trendSource = Object.entries(summary.byDay ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const monthlyTrend = ["3m", "6m", "1y"].includes(rangeKey);
  const trendMap = new Map<string, number>();
  trendSource.forEach(([day, values]) => {
    const bucket = monthlyTrend ? day.slice(0, 7) : day;
    trendMap.set(bucket, (trendMap.get(bucket) ?? 0) + Object.values(values).reduce((sum, value) => sum + value, 0));
  });
  const trend = Array.from(trendMap.entries()).slice(monthlyTrend ? -12 : -30);
  const maxTrend = Math.max(1, ...trend.map(([, count]) => count));
  const trendBars = trend.map(([bucket, count]) => `<div class="day"><div class="day-bar" style="height:${Math.max(8, Math.round((count / maxTrend) * 100))}%"><b>${count}</b></div><span>${esc(monthlyTrend ? bucket : bucket.slice(5))}</span></div>`).join("");
  const rangeLinks = ANALYTICS_RANGES.map((range) => `<a class="range ${range.key === rangeKey ? "selected" : ""}" href="/analytics?range=${range.key}">${esc(range.label)}</a>`).join("");
  const updated = summary.updatedAt && summary.updatedAt !== new Date(0).toISOString()
    ? new Date(summary.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"
    : "No events yet";
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PencilProof analytics</title>
<style>:root{font-family:Arial,sans-serif;color:#10284b;background:#f4f1e9}*{box-sizing:border-box}body{margin:0}.shell{max-width:1180px;margin:auto;padding:30px 20px 60px}header{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:22px}h1{margin:0;font:700 clamp(30px,5vw,50px)/1 Georgia,serif}p{color:#627086;line-height:1.5}.updated{font-size:12px;color:#627086;text-align:right}.range-row{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 22px}.range{border:1px solid #c9c6bb;border-radius:999px;padding:9px 13px;color:#17365f;background:#fff;text-decoration:none;font-size:13px;font-weight:700}.range.selected{background:#15365e;color:#fff;border-color:#15365e}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}.card,.panel{background:#fff;border:1px solid #d9d6ca;border-radius:16px;padding:20px;box-shadow:0 8px 24px #10284b0d}.label{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#718096}.big{font:700 38px Georgia,serif;margin-top:8px;color:#b27a22}.card p{margin:10px 0 0;font-size:13px}.grid{display:grid;grid-template-columns:1.1fr .9fr;gap:18px}.panel h2{font:700 24px Georgia,serif;margin:0 0 8px}.subtle{font-size:13px;margin:0 0 18px}.funnel-step{display:grid;grid-template-columns:1fr auto;gap:6px 14px;margin:18px 0}.funnel-step strong,.funnel-step span{display:block}.funnel-step span{color:#718096;font-size:13px;margin-top:4px}.funnel-step>b{font:700 24px Georgia,serif;color:#b27a22}.funnel-step .bar{grid-column:1/-1}.bar{height:9px;background:#edf0f3;border-radius:20px;overflow:hidden}.bar i{display:block;height:100%;background:#c5943f;border-radius:20px}.chart{height:230px;display:flex;align-items:end;gap:8px;padding:16px 4px 0;overflow-x:auto}.day{height:100%;min-width:25px;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:end;gap:7px;font-size:10px;color:#6a7789}.day-bar{width:100%;max-width:34px;background:#15365e;border-radius:7px 7px 2px 2px;min-height:8px;display:flex;justify-content:center;color:#fff;font-size:11px;padding-top:5px}.day-bar b{font-weight:700}.definitions{margin-top:18px;background:#f8f7f2;border-left:4px solid #c5943f;padding:14px 16px}.definitions p{margin:6px 0;font-size:13px}.empty{color:#718096;font-size:14px;padding:20px 0}@media(max-width:850px){.cards{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}@media(max-width:560px){header{display:block}.updated{text-align:left;margin-top:10px}.cards{grid-template-columns:1fr}.shell{padding:22px 14px 40px}}</style></head>
<body><main class="shell"><header><div><div class="label">PENCILPROOF / MEASUREMENT</div><h1>Traffic and conversion</h1><p>Selected period: <strong>${esc(rangeLabel)}</strong>. This dashboard is private.</p></div><div class="updated">Updated ${esc(updated)}</div></header>
<nav class="range-row" aria-label="Analytics date range">${rangeLinks}</nav>
<section class="cards">${funnelCards}</section>
<section class="grid"><div class="panel"><h2>Visitor funnel</h2><p class="subtle">Unique people are counted once per selected period. Percentages compare each step with visitors.</p>${funnelStep("Visitors", `${funnel.pageViews.toLocaleString("en-US")} total page views`, funnel.visitors, funnel.visitors)}${funnelStep("Used the scan", `${funnel.scanStarts.toLocaleString("en-US")} scan starts`, funnel.scanUsers, funnel.visitors)}${funnelStep("Reached checkout", `${funnel.checkoutStarts.toLocaleString("en-US")} checkout starts`, funnel.checkoutUsers, funnel.visitors)}${funnelStep("Purchased", `${funnel.purchases.toLocaleString("en-US")} verified payment events`, funnel.purchasers, funnel.visitors)}</div>
<div class="panel"><h2>Activity trend</h2><p class="subtle">${monthlyTrend ? "Monthly activity" : "Daily activity"} within the selected period.</p>${trendBars ? `<div class="chart">${trendBars}</div>` : `<div class="empty">No tracked activity in this period.</div>`}<div class="definitions"><strong>What “session” means</strong><p>A session is an anonymous browser visit ID. It is not a login or a person’s name. PencilProof starts a new session after 30 minutes of inactivity, so <strong>Visitors</strong> is the clearest estimate of unique browsers that visited during this period.</p><p>Page views are total page loads. “Used the scan,” “Reached checkout,” and “Purchased” are unique browsers at each step; the smaller text shows total attempts.</p></div></div></section>
<p class="subtle" style="margin-top:22px">Completed free audits: <strong>${funnel.auditsCompleted.toLocaleString("en-US")}</strong> from <strong>${funnel.auditUsers.toLocaleString("en-US")}</strong> unique browsers. Purchases are recorded from verified Stripe payment events.</p>
</main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
};

const handleAnalyticsRoute = async (request: Request, env: Env) => {
  const url = new URL(request.url);
  const internalPath = url.pathname === "/api/analytics/event"
    ? "/event"
    : url.pathname === "/api/analytics/summary"
      ? "/summary"
      : null;
  if (!internalPath) return null;

  const headers = analyticsCorsHeaders(request, env);
  if (internalPath === "/summary") {
    const authFailure = requireAnalyticsAuth(request, env);
    if (authFailure) return authFailure;
  }
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

  if (internalPath === "/event") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== env.PUBLIC_SITE_ORIGIN && origin !== env.SITE_ORIGIN) {
      return new Response("Forbidden", { status: 403, headers });
    }
  }

  const stub = env.ANALYTICS.get(
    env.ANALYTICS.idFromName("pencilproof-analytics"),
  );
  const response = await stub.fetch(
    new Request(`https://analytics.internal${internalPath}${internalPath === "/summary" ? new URL(request.url).search : ""}`, {
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
  (new URL(request.url).pathname === "/analytics" || new URL(request.url).pathname === "/analytics/")
    ? analyticsDashboard(request, env)
    : await handleAnalyticsRoute(request, env) ?? app.fetch(request, env);

export default {
  fetch: handleRequest,
};
