const NUMERIC_KEYS = new Set([
  "views",
  "reach",
  "impressions",
  "engagement",
  "comments",
  "replies",
  "shares",
  "reposts",
  "quotes",
  "likes",
  "saves",
  "linkClicks",
]);

const METRIC_ALIASES = {
  views: "views",
  video_views: "views",
  post_video_views: "views",
  post_media_view: "views",
  post_media_views: "views",
  post_media_view_unique: "reach",
  post_total_media_view_unique: "reach",
  post_media_views_unique: "reach",
  reach: "reach",
  post_impressions_unique: "reach",
  impressions: "impressions",
  post_impressions: "impressions",
  engagement: "engagement",
  total_interactions: "engagement",
  post_engaged_users: "engagement",
  post_reactions_by_type_total: "engagement",
  comments: "comments",
  replies: "replies",
  shares: "shares",
  reposts: "reposts",
  quotes: "quotes",
  likes: "likes",
  saved: "saves",
  saves: "saves",
  post_clicks: "linkClicks",
  link_clicks: "linkClicks",
};

export function emptyMetrics() {
  return Object.fromEntries([...NUMERIC_KEYS].map((key) => [key, null]));
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function valueFromMetric(entry) {
  const values = Array.isArray(entry?.values) ? entry.values : [];
  const newest = values.at(-1);
  const raw = newest?.value ?? entry?.value ?? entry?.total_value?.value ?? entry?.total_value;
  const numeric = numericValue(raw);
  if (numeric !== null) return numeric;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const totals = Object.values(raw).map(numericValue).filter((value) => value !== null);
    return totals.length ? totals.reduce((sum, value) => sum + value, 0) : null;
  }
  return null;
}

function metricEntries(payload) {
  return Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.metrics)
      ? payload.metrics
      : [];
}

/**
 * Parse a provider payload while retaining the provider's actual metric names.
 * The normalized `metrics` object is for stable UI/API consumers; `rawMetrics`
 * and `observations` make the source and measured-vs-derived distinction clear.
 */
export function parseMetricPayloadDetails(payload, source = "provider response") {
  const metrics = emptyMetrics();
  const rawMetrics = {};
  const observations = {};
  for (const entry of metricEntries(payload)) {
    const rawName = String(entry?.name ?? entry?.metric ?? "").trim().toLowerCase();
    if (!rawName) continue;
    const value = valueFromMetric(entry);
    rawMetrics[rawName] = value;
    const name = METRIC_ALIASES[rawName];
    if (!name || value === null) continue;
    metrics[name] = value;
    observations[name] = {
      value,
      providerMetric: rawName,
      source,
      kind: "measured",
    };
  }
  return { metrics, rawMetrics, observations };
}

export function parseMetricPayload(payload) {
  return parseMetricPayloadDetails(payload).metrics;
}

export function hasAnyMetric(metrics) {
  return Object.values(metrics ?? {}).some((value) => typeof value === "number" && Number.isFinite(value));
}

function normalizedRawMetrics(rawMetrics) {
  return Object.fromEntries(
    Object.entries(rawMetrics && typeof rawMetrics === "object" ? rawMetrics : {})
      .filter(([key]) => key.trim())
      .map(([key, value]) => [key, numericValue(value)]),
  );
}

export function postMetricsRecord({
  platform,
  post,
  metrics,
  fetchedAt = new Date().toISOString(),
  error = null,
  source = "provider response",
  rawMetrics = {},
  observations = {},
}) {
  const normalizedMetrics = { ...emptyMetrics(), ...(metrics && typeof metrics === "object" ? metrics : {}) };
  const observedFields = {};
  for (const [name, value] of Object.entries(normalizedMetrics)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const observation = observations?.[name] && typeof observations[name] === "object" ? observations[name] : {};
    observedFields[name] = {
      value,
      source: String(observation.source ?? source),
      kind: observation.kind === "derived" ? "derived" : "measured",
      ...(observation.providerMetric ? { providerMetric: String(observation.providerMetric) } : {}),
      ...(observation.formula ? { formula: String(observation.formula) } : {}),
    };
  }
  const available = hasAnyMetric(normalizedMetrics);
  const status = error ? "error" : available ? "partial" : "unsupported";
  return {
    platform: String(platform ?? ""),
    id: String(post?.id ?? ""),
    created: String(post?.created ?? ""),
    url: String(post?.postUrl ?? post?.url ?? ""),
    fetchedAt,
    available,
    status,
    metrics: normalizedMetrics,
    provenance: {
      source: String(source),
      collectedAt: fetchedAt,
      status,
      rawMetrics: normalizedRawMetrics(rawMetrics),
      observations: observedFields,
    },
    ...(error ? { error: String(error).slice(0, 300) } : {}),
  };
}

export function mergeNewestPostMetrics(...lists) {
  const byKey = new Map();
  let sequence = 0;
  for (const list of lists) {
    for (const record of Array.isArray(list) ? list : []) {
      if (!record?.platform || !record?.id) continue;
      const key = `${record.platform}:${record.id}`;
      const fetchedAt = Date.parse(String(record.fetchedAt ?? ""));
      const timestamp = Number.isFinite(fetchedAt) ? fetchedAt : Number.NEGATIVE_INFINITY;
      const group = byKey.get(key) ?? { latest: null, latestTimestamp: Number.NEGATIVE_INFINITY, latestSequence: -1, fields: new Map() };
      const currentSequence = sequence;
      sequence += 1;
      if (!group.latest || timestamp > group.latestTimestamp || (timestamp === group.latestTimestamp && currentSequence >= group.latestSequence)) {
        group.latest = record;
        group.latestTimestamp = timestamp;
        group.latestSequence = currentSequence;
      }
      for (const [field, value] of Object.entries(record.metrics && typeof record.metrics === "object" ? record.metrics : {})) {
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        const prior = group.fields.get(field);
        if (!prior || timestamp > prior.timestamp || (timestamp === prior.timestamp && currentSequence >= prior.sequence)) {
          const observation = record.provenance?.observations?.[field] ?? null;
          group.fields.set(field, {
            value,
            timestamp,
            sequence: currentSequence,
            observation,
            rawMetric: observation?.providerMetric ? String(observation.providerMetric) : null,
          });
        }
      }
      byKey.set(key, group);
    }
  }
  return [...byKey.values()]
    .map(({ latest, fields }) => {
      const metrics = { ...emptyMetrics() };
      const observations = { ...(latest?.provenance?.observations ?? {}) };
      const rawMetrics = { ...(latest?.provenance?.rawMetrics ?? {}) };
      for (const [field, item] of fields.entries()) {
        metrics[field] = item.value;
        if (item.observation) observations[field] = item.observation;
        if (item.rawMetric) rawMetrics[item.rawMetric] = item.value;
      }
      return {
        ...latest,
        available: hasAnyMetric(metrics),
        status: latest?.error ? "error" : hasAnyMetric(metrics) ? "partial" : "unsupported",
        metrics,
        provenance: latest?.provenance
          ? { ...latest.provenance, rawMetrics, observations }
          : { source: "stored metric record", collectedAt: latest?.fetchedAt ?? null, status: hasAnyMetric(metrics) ? "partial" : "unsupported", rawMetrics, observations },
      };
    })
    .sort((left, right) => Date.parse(String(left.fetchedAt ?? "")) - Date.parse(String(right.fetchedAt ?? "")));
}

export function mergePostMetrics(existing, incoming, max = 120) {
  return mergeNewestPostMetrics(existing, incoming).slice(-max);
}

export function formatMetricValue(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)
    : "—";
}
