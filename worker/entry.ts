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

const analyticsCorsHeaders = (env: Env) => ({
  "Access-Control-Allow-Origin": env.PUBLIC_SITE_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
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
  await handleAnalyticsRoute(request, env) ?? app.fetch(request, env);

export default {
  fetch: handleRequest,
};
