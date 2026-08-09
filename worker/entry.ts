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
      const byEvent: Record<string, number> = {};
      for (const row of this.sql.exec<EventCountRow>(`
        SELECT event_name, COUNT(*) AS count
        FROM analytics_events
        GROUP BY event_name
      `)) {
        byEvent[row.event_name] = Number(row.count) || 0;
      }

      const byDay: Record<string, Record<string, number>> = {};
      for (const row of this.sql.exec<DayEventCountRow>(`
        SELECT day, event_name, COUNT(*) AS count
        FROM analytics_events
        GROUP BY day, event_name
        ORDER BY day ASC
      `)) {
        byDay[row.day] ??= {};
        byDay[row.day][row.event_name] = Number(row.count) || 0;
      }

      const sessions = Number(this.sql.exec<CountRow>(`
        SELECT COUNT(DISTINCT session_id) AS count
        FROM analytics_events
      `).one().count) || 0;

      const byCategory: Record<string, number> = {};
      for (const row of this.sql.exec<CategoryCountRow>(`
        SELECT COALESCE(category, 'other') AS category, COUNT(*) AS count
        FROM analytics_events
        WHERE event_name = 'feedback_submitted'
        GROUP BY COALESCE(category, 'other')
      `)) {
        byCategory[row.category] = Number(row.count) || 0;
      }

      const byRating: Record<string, number> = {};
      for (const row of this.sql.exec<RatingCountRow>(`
        SELECT rating, COUNT(*) AS count
        FROM analytics_events
        WHERE event_name = 'feedback_submitted' AND rating IS NOT NULL
        GROUP BY rating
      `)) {
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
      `).one();
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

const analyticsDashboard = async (request: Request, env: Env) => {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  const stub = env.ANALYTICS.get(env.ANALYTICS.idFromName("pencilproof-analytics"));
  const response = await stub.fetch(new Request("https://analytics.internal/summary"));
  if (!response.ok) return new Response("Analytics unavailable", { status: 502 });
  const summary = await response.json() as {
    sessions?: number;
    byEvent?: Record<string, number>;
    byDay?: Record<string, Record<string, number>>;
    updatedAt?: string;
  };
  const esc = (value: unknown) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
  const events = Object.entries(summary.byEvent ?? {}).sort((a, b) => b[1] - a[1]);
  const maxEvent = Math.max(1, ...events.map(([, count]) => count));
  const cards = events.map(([name, count]) => `<div class="metric"><div class="metric-top"><span>${esc(name.replaceAll("_", " "))}</span><b>${count}</b></div><div class="bar"><i style="width:${Math.round((count / maxEvent) * 100)}%"></i></div></div>`).join("");
  const days = Object.entries(summary.byDay ?? {}).slice(-14);
  const maxDay = Math.max(1, ...days.map(([, values]) => Object.values(values).reduce((sum, count) => sum + count, 0)));
  const dayBars = days.map(([day, values]) => { const count = Object.values(values).reduce((sum, value) => sum + value, 0); return `<div class="day"><div class="day-bar" style="height:${Math.max(8, Math.round((count / maxDay) * 100))}%"><b>${count}</b></div><span>${esc(day.slice(5))}</span></div>`; }).join("");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PencilProof analytics</title><style>:root{font-family:Inter,Arial,sans-serif;color:#10284b;background:#f4f1e9}*{box-sizing:border-box}body{margin:0}.shell{max-width:1080px;margin:auto;padding:32px 20px 56px}header{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:28px}h1{margin:0;font:700 clamp(30px,5vw,50px)/1 Georgia,serif}p{color:#627086}.updated{font-size:12px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px}.card,.panel{background:#fff;border:1px solid #d9d6ca;border-radius:16px;padding:20px;box-shadow:0 8px 24px #10284b0d}.label{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#718096}.big{font:700 38px Georgia,serif;margin-top:8px;color:#b27a22}.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}.panel h2{font:700 24px Georgia,serif;margin:0 0 18px}.metric{margin:14px 0}.metric-top{display:flex;justify-content:space-between;text-transform:capitalize;font-size:14px}.bar{height:9px;background:#edf0f3;border-radius:20px;margin-top:7px;overflow:hidden}.bar i{display:block;height:100%;background:#c5943f;border-radius:20px}.chart{height:230px;display:flex;align-items:end;gap:8px;padding-top:16px}.day{height:100%;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:end;gap:7px;font-size:11px;color:#6a7789}.day-bar{width:100%;max-width:34px;background:#15365e;border-radius:7px 7px 2px 2px;min-height:8px;display:flex;justify-content:center;color:#fff;font-size:11px;padding-top:5px}.day-bar b{font-weight:700}.empty{color:#718096;font-size:14px}@media(max-width:700px){header{display:block}.cards,.grid{grid-template-columns:1fr}.updated{margin-top:10px}.shell{padding:22px 14px 40px}}</style></head><body><main class="shell"><header><div><div class="label">PENCILPROOF / MEASUREMENT</div><h1>Traffic at a glance</h1><p>See whether people are arriving, starting a scan, and moving toward an audit.</p></div><div class="updated">Updated ${esc(summary.updatedAt ?? "not yet")}</div></header><section class="cards"><div class="card"><div class="label">Sessions</div><div class="big">${summary.sessions ?? 0}</div></div><div class="card"><div class="label">Page views</div><div class="big">${summary.byEvent?.page_view ?? 0}</div></div><div class="card"><div class="label">Scan starts</div><div class="big">${summary.byEvent?.scan_started ?? 0}</div></div></section><section class="grid"><div class="panel"><h2>Last 14 days</h2>${dayBars ? `<div class="chart">${dayBars}</div>` : `<div class="empty">No tracked activity yet.</div>`}</div><div class="panel"><h2>Funnel events</h2>${cards || `<div class="empty">No tracked events yet.</div>`}</div></section></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
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
  (new URL(request.url).pathname === "/analytics" || new URL(request.url).pathname === "/analytics/")
    ? analyticsDashboard(request, env)
    : await handleAnalyticsRoute(request, env) ?? app.fetch(request, env);

export default {
  fetch: handleRequest,
};
