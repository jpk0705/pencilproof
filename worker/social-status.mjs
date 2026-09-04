import {
  mergeNewestPostMetrics,
  parseMetricPayloadDetails,
  postMetricsRecord,
} from "./social-metrics.mjs";

export const READ_ONLY_REQUEST_BUDGET = 2;
export const READ_ONLY_PLATFORM_ORDER = ["facebook", "instagram", "threads"];
export const READ_ONLY_SAMPLER_INTERVAL_MS = 30 * 60 * 1000;
export const READ_ONLY_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const READ_ONLY_VERIFICATION_LEASE_MS = 2 * 60 * 1000;

const DEFAULT_META_API_VERSION = "v25.0";
const ERROR_CATEGORIES = new Set([
  "authentication",
  "permission",
  "account_mismatch",
  "rate_limited",
  "provider",
  "malformed_response",
]);

function safeErrorMessage(error) {
  return error instanceof Error ? error.message.slice(0, 500) : String(error ?? "Unknown error").slice(0, 500);
}

function providerError(message, details = {}) {
  const error = new Error(String(message ?? "Provider request failed").slice(0, 500));
  error.providerDetails = {
    category: ERROR_CATEGORIES.has(details.category) ? details.category : "provider",
    httpStatus: Number.isFinite(Number(details.httpStatus)) ? Number(details.httpStatus) : null,
    providerCode: details.providerCode === undefined || details.providerCode === null ? null : String(details.providerCode).slice(0, 80),
  };
  return error;
}

function errorDetails(error) {
  const details = error?.providerDetails && typeof error.providerDetails === "object" ? error.providerDetails : {};
  return {
    category: ERROR_CATEGORIES.has(details.category) ? details.category : "provider",
    httpStatus: Number.isFinite(Number(details.httpStatus)) ? Number(details.httpStatus) : null,
    providerCode: details.providerCode === undefined || details.providerCode === null ? null : String(details.providerCode).slice(0, 80),
    message: safeErrorMessage(error),
  };
}

function errorText(error) {
  return typeof error === "string" ? error : String(error?.message ?? "Unknown provider error");
}

function numericMetric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function metaApiVersion(env) {
  const raw = String(env.SOCIAL_STATUS_META_API_VERSION ?? DEFAULT_META_API_VERSION).trim() || DEFAULT_META_API_VERSION;
  return raw.startsWith("v") ? raw : `v${raw}`;
}

function bearerHeaders(token) {
  return { Accept: "application/json", Authorization: `Bearer ${String(token ?? "").trim()}` };
}

async function providerJson(url, init = {}, label = "Provider request") {
  const response = await fetch(url, init);
  let payload = null;
  let malformed = false;
  try {
    payload = await response.json();
  } catch {
    malformed = true;
  }
  if (!response.ok) {
    const detail = typeof payload?.error?.message === "string"
      ? payload.error.message
      : typeof payload?.message === "string"
        ? payload.message
        : `HTTP ${response.status}`;
    const category = response.status === 401
      ? "authentication"
      : response.status === 403
        ? "permission"
        : response.status === 429
          ? "rate_limited"
          : "provider";
    throw providerError(`${label} failed: ${detail}`, {
      category,
      httpStatus: response.status,
      providerCode: payload?.error?.code ?? payload?.code ?? null,
    });
  }
  if (malformed || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw providerError(`${label} returned a malformed response.`, {
      category: "malformed_response",
      httpStatus: response.status,
    });
  }
  return payload ?? {};
}

function facebookConfigured(env) {
  return Boolean(String(env.FACEBOOK_PAGE_ID ?? "").trim() && String(env.FACEBOOK_PAGE_ACCESS_TOKEN ?? "").trim());
}

function instagramConfigured(env) {
  return Boolean(String(env.INSTAGRAM_USER_ID ?? "").trim() && String(env.INSTAGRAM_ACCESS_TOKEN ?? "").trim());
}

function threadsConfigured(env) {
  return Boolean(
    String(env.THREADS_ACCESS_TOKEN ?? "").trim()
    && (String(env.THREADS_USER_ID ?? "").trim() || String(env.THREADS_EXPECTED_USERNAME ?? "").trim()),
  );
}

function platformConfigured(env, platform) {
  return platform === "facebook" ? facebookConfigured(env) : platform === "instagram" ? instagramConfigured(env) : threadsConfigured(env);
}

function expectedAccountId(env, platform) {
  if (platform === "facebook") return String(env.FACEBOOK_PAGE_ID ?? "").trim() || null;
  if (platform === "instagram") return String(env.INSTAGRAM_USER_ID ?? "").trim() || null;
  const userId = String(env.THREADS_USER_ID ?? "").trim();
  const username = String(env.THREADS_EXPECTED_USERNAME ?? "").trim().replace(/^@/, "");
  return userId || (username ? `@${username}` : null);
}

export function readOnlyPlatformConfigured(env, platform) {
  return platformConfigured(env, platform);
}

export function readOnlyConfiguredPlatforms(env) {
  return READ_ONLY_PLATFORM_ORDER.filter((platform) => (
    platformConfigured(env, platform)
  ));
}

function sourcePost(platform, post) {
  return {
    platform,
    id: String(post?.id ?? ""),
    created: String(post?.created ?? ""),
    url: String(post?.postUrl ?? post?.url ?? ""),
  };
}

function historyMetrics(platform, post, source) {
  const aliases = platform === "threads"
    ? { views: post?.views, likes: post?.likes, replies: post?.replies, reposts: post?.reposts, quotes: post?.quotes }
    : platform === "instagram"
      ? { likes: post?.like_count ?? post?.likes, comments: post?.comments_count ?? post?.comments }
      : { likes: post?.likes, comments: post?.comments, shares: post?.shares };
  const metrics = Object.fromEntries(Object.entries(aliases).map(([key, value]) => [key, numericMetric(value)]));
  const available = Object.values(metrics).some((value) => value !== null);
  if (!available) return null;
  const interactions = [metrics.likes, metrics.comments, metrics.replies, metrics.reposts, metrics.quotes, metrics.shares]
    .filter((value) => value !== null)
    .reduce((sum, value) => sum + value, 0);
  metrics.engagement = interactions;
  return postMetricsRecord({
    platform,
    post: sourcePost(platform, post),
    metrics,
    rawMetrics: aliases,
    observations: {
      engagement: { kind: "derived", formula: "sum of returned interaction fields", source },
    },
    source,
  });
}

function recordedFacebookPost(value) {
  if (!value || typeof value !== "object" || !String(value.id ?? "").trim()) return null;
  return {
    id: String(value.id).trim(),
    created: String(value.at ?? value.created ?? ""),
    postUrl: String(value.url ?? value.postUrl ?? ""),
    likes: null,
    comments: null,
    shares: null,
  };
}

async function recentFacebookPosts(env) {
  const pageId = encodeURIComponent(String(env.FACEBOOK_PAGE_ID ?? "").trim());
  const params = new URLSearchParams({
    fields: "id,message,created_time,permalink_url,from,comments.limit(0).summary(true),reactions.limit(0).summary(true),shares",
    limit: "1",
  });
  const source = `https://graph.facebook.com/${metaApiVersion(env)}/${pageId}/feed?${params}`;
  const payload = await providerJson(source, { headers: bearerHeaders(env.FACEBOOK_PAGE_ACCESS_TOKEN) }, "Facebook Page feed");
  const items = Array.isArray(payload.data) ? payload.data : [];
  const expectedPageId = String(env.FACEBOOK_PAGE_ID ?? "").trim();
  const mismatch = items.find((item) => item?.from?.id && String(item.from.id) !== expectedPageId);
  if (mismatch) {
    throw providerError("Facebook returned a post owned by a different account.", {
      category: "account_mismatch",
      providerCode: mismatch.from?.id,
    });
  }
  return items
    .filter((item) => item?.id)
    .map((item) => ({
      id: String(item.id),
      created: String(item.created_time ?? ""),
      postUrl: String(item.permalink_url ?? ""),
      likes: item.reactions?.summary?.total_count,
      comments: item.comments?.summary?.total_count,
      shares: item.shares?.count,
    }));
}

async function recentInstagramPosts(env) {
  const userId = encodeURIComponent(String(env.INSTAGRAM_USER_ID ?? "").trim());
  const params = new URLSearchParams({
    fields: "id,caption,timestamp,permalink,media_type,media_product_type,like_count,comments_count",
    limit: "1",
  });
  const source = `https://graph.facebook.com/${metaApiVersion(env)}/${userId}/media?${params}`;
  const payload = await providerJson(source, { headers: bearerHeaders(env.INSTAGRAM_ACCESS_TOKEN) }, "Instagram media");
  return (Array.isArray(payload.data) ? payload.data : []).filter((item) => item?.id).map((item) => ({
    id: String(item.id),
    created: String(item.timestamp ?? ""),
    postUrl: String(item.permalink ?? ""),
    likes: item.like_count,
    comments: item.comments_count,
  }));
}

async function recentThreadsPosts(env, previouslyVerifiedUserId = "") {
  const params = new URLSearchParams({ fields: "id,text,timestamp,permalink,is_reply,username", limit: "1" });
  let userId = String(env.THREADS_USER_ID ?? previouslyVerifiedUserId ?? "").trim();
  let username = String(env.THREADS_EXPECTED_USERNAME ?? "").trim().replace(/^@/, "");
  let providerRequestsUsed = 0;
  if (!userId) {
    providerRequestsUsed += 1;
    let identity;
    try {
      identity = await providerJson("https://graph.threads.net/me?fields=id,username", { headers: bearerHeaders(env.THREADS_ACCESS_TOKEN) }, "Threads identity");
    } catch (error) {
      error.providerRequestsUsed = providerRequestsUsed;
      throw error;
    }
    userId = String(identity.id ?? "").trim();
    const verifiedUsername = String(identity.username ?? "").trim().replace(/^@/, "");
    if (!userId || !verifiedUsername) {
      const error = providerError("Threads did not return an account identity.", { category: "malformed_response" });
      error.providerRequestsUsed = providerRequestsUsed;
      throw error;
    }
    if (!username || verifiedUsername.toLowerCase() !== username.toLowerCase()) {
      const error = providerError("Threads token belongs to a different account.", { category: "account_mismatch", providerCode: verifiedUsername });
      error.providerRequestsUsed = providerRequestsUsed;
      throw error;
    }
    username = verifiedUsername;
  }
  const source = `https://graph.threads.net/${encodeURIComponent(userId)}/threads?${params}`;
  providerRequestsUsed += 1;
  let payload;
  try {
    payload = await providerJson(source, { headers: bearerHeaders(env.THREADS_ACCESS_TOKEN) }, "Threads posts");
  } catch (error) {
    error.providerRequestsUsed = providerRequestsUsed;
    throw error;
  }
  const posts = (Array.isArray(payload.data) ? payload.data : [])
    .filter((item) => item?.id && item?.is_reply !== true)
    .map((item) => ({ id: String(item.id), created: String(item.timestamp ?? ""), postUrl: String(item.permalink ?? ""), username: String(item.username ?? username) }));
  const mismatch = posts.find((item) => username && item.username && item.username.toLowerCase() !== username.toLowerCase());
  if (mismatch) {
    const error = providerError("Threads returned a post owned by a different account.", {
      category: "account_mismatch",
      providerCode: mismatch.username,
    });
    error.providerRequestsUsed = providerRequestsUsed;
    throw error;
  }
  return { posts, providerRequestsUsed, verifiedAccountId: userId, accountMatched: true };
}

async function measureFacebookPost(env, post, source) {
  const params = new URLSearchParams({ metric: "post_media_view,post_total_media_view_unique" });
  const insightsSource = `${source}/insights?${params}`;
  const payload = await providerJson(insightsSource, { headers: bearerHeaders(env.FACEBOOK_PAGE_ACCESS_TOKEN) }, "Facebook post insights");
  const details = parseMetricPayloadDetails(payload, insightsSource);
  const likes = numericMetric(post.likes);
  const comments = numericMetric(post.comments);
  const shares = numericMetric(post.shares);
  const metrics = {
    ...details.metrics,
    likes,
    comments,
    shares,
  };
  const values = [metrics.likes, metrics.comments, metrics.shares].filter((value) => value !== null);
  metrics.engagement = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  const observations = {
    ...details.observations,
    likes: { providerMetric: "reactions.summary.total_count", source: "Facebook Page feed" },
    comments: { providerMetric: "comments.summary.total_count", source: "Facebook Page feed" },
    shares: { providerMetric: "shares.count", source: "Facebook Page feed" },
    ...(metrics.engagement !== null ? { engagement: { kind: "derived", formula: "likes + comments + shares", source: insightsSource } } : {}),
  };
  return postMetricsRecord({
    platform: "facebook",
    post: sourcePost("facebook", post),
    metrics,
    rawMetrics: {
      ...details.rawMetrics,
      "comments.summary.total_count": comments,
      "reactions.summary.total_count": likes,
      "shares.count": shares,
    },
    observations,
    source: insightsSource,
  });
}

async function measureInstagramPost(env, post, source) {
  const params = new URLSearchParams({ metric: "views,reach,total_interactions,saved,shares" });
  const insightsSource = `${source}/insights?${params}`;
  const payload = await providerJson(insightsSource, { headers: bearerHeaders(env.INSTAGRAM_ACCESS_TOKEN) }, "Instagram media insights");
  const details = parseMetricPayloadDetails(payload, insightsSource);
  const likes = numericMetric(post.likes);
  const comments = numericMetric(post.comments);
  const metrics = { ...details.metrics, likes, comments };
  const observations = {
    ...details.observations,
    likes: { providerMetric: "like_count", source: "Instagram media" },
    comments: { providerMetric: "comments_count", source: "Instagram media" },
  };
  return postMetricsRecord({
    platform: "instagram",
    post: sourcePost("instagram", post),
    metrics,
    rawMetrics: { ...details.rawMetrics, like_count: likes, comments_count: comments },
    observations,
    source: insightsSource,
  });
}

async function measureThreadsPost(env, post, source) {
  const params = new URLSearchParams({ metric: "views,likes,replies,reposts,quotes,shares" });
  const payload = await providerJson(`${source}/insights?${params}`, { headers: bearerHeaders(env.THREADS_ACCESS_TOKEN) }, "Threads post insights");
  const details = parseMetricPayloadDetails(payload, source);
  const values = [details.metrics.likes, details.metrics.replies, details.metrics.reposts, details.metrics.quotes].filter((value) => value !== null);
  const metrics = { ...details.metrics, engagement: values.length ? values.reduce((sum, value) => sum + value, 0) : details.metrics.engagement };
  const observations = { ...details.observations };
  if (metrics.engagement !== null && !details.observations.engagement) {
    observations.engagement = { kind: "derived", formula: "likes + replies + reposts + quotes", source };
  }
  return postMetricsRecord({ platform: "threads", post: sourcePost("threads", post), metrics, rawMetrics: details.rawMetrics, observations, source });
}

function emptyPlatform(env, platform) {
  const configured = platformConfigured(env, platform);
  const expected = expectedAccountId(env, platform);
  return {
    configured,
    connectionState: configured ? "configured" : "not_configured",
    apiReachable: false,
    lastAttemptAt: null,
    lastVerifiedAt: null,
    verificationExpiresAt: null,
    expectedAccountId: expected,
    verifiedAccountId: null,
    accountMatched: false,
    verifiedAt: null,
    verificationMethod: null,
    connectionError: null,
    recentPostCount: 0,
    latestRemotePostAt: null,
    metricsState: "not_attempted",
    metricsAttemptAt: null,
    metricsError: null,
    providerRequestsUsed: 0,
    metricsStatus: "not_sampled",
    postMetrics: [],
  };
}

async function samplePlatform(env, platform, now, previousPlatform = null, publishedPost = null) {
  const result = {
    ...emptyPlatform(env, platform),
    ...(previousPlatform && typeof previousPlatform === "object" ? previousPlatform : {}),
  };
  const configured = platformConfigured(env, platform);
  const expected = expectedAccountId(env, platform);
  result.configured = configured;
  result.expectedAccountId = expected;
  result.lastAttemptAt = now.toISOString();
  result.providerRequestsUsed = 0;
  if (!result.configured) return { result, providerRequestsUsed: 0 };
  let providerRequestsUsed = 0;
  let posts;
  let verifiedAccountId = expected;
  let accountMatched = Boolean(expected);
  const recordedPost = platform === "facebook" ? recordedFacebookPost(publishedPost) : null;
  const usesRecordedFacebookPost = Boolean(recordedPost);
  try {
    if (platform === "threads") {
      const threads = await recentThreadsPosts(env, previousPlatform?.verifiedAccountId);
      posts = threads.posts;
      providerRequestsUsed += threads.providerRequestsUsed;
      verifiedAccountId = threads.verifiedAccountId;
      accountMatched = threads.accountMatched;
    } else if (usesRecordedFacebookPost) {
      posts = [recordedPost];
    } else {
      providerRequestsUsed += 1;
      posts = platform === "facebook" ? await recentFacebookPosts(env) : await recentInstagramPosts(env);
    }
  } catch (error) {
    providerRequestsUsed += Number.isFinite(Number(error?.providerRequestsUsed)) ? Number(error.providerRequestsUsed) : 0;
    result.connectionState = "needs_attention";
    result.apiReachable = false;
    result.lastVerifiedAt = result.lastVerifiedAt ?? null;
    result.verificationExpiresAt = result.verificationExpiresAt ?? null;
    result.verifiedAccountId = null;
    result.accountMatched = false;
    result.connectionError = errorDetails(error);
    result.metricsState = "not_attempted";
    result.metricsStatus = "not_sampled";
    result.metricsError = null;
    result.metricsAttemptAt = null;
    result.providerRequestsUsed = providerRequestsUsed;
    return { result, providerRequestsUsed };
  }
  const post = posts[0] ?? null;
  if (!usesRecordedFacebookPost) {
    result.apiReachable = true;
    result.connectionState = "verified";
    result.lastVerifiedAt = now.toISOString();
    result.verificationExpiresAt = new Date(now.getTime() + READ_ONLY_VERIFICATION_TTL_MS).toISOString();
    result.verifiedAccountId = verifiedAccountId;
    result.accountMatched = accountMatched;
    result.verifiedAt = result.lastVerifiedAt;
    result.verificationMethod = `${platform} read-only recent-post request`;
    result.connectionError = null;
  }
  result.recentPostCount = posts.length;
  result.latestRemotePostAt = posts.map((item) => item.created).filter(Boolean).sort().at(-1) ?? null;
  if (!post) {
    result.metricsState = "no_post";
    result.metricsStatus = "no_recent_post";
    result.metricsError = null;
    result.metricsAttemptAt = null;
    result.postMetrics = [];
    result.providerRequestsUsed = providerRequestsUsed;
    return { result, providerRequestsUsed };
  }
  const historySource = `${platform} recent-post response`;
  const existing = historyMetrics(platform, post, historySource);
  result.metricsAttemptAt = now.toISOString();
  if (providerRequestsUsed >= READ_ONLY_REQUEST_BUDGET) {
    result.metricsState = existing?.available ? "partial" : "not_attempted";
    result.metricsStatus = existing?.available ? "recent_post_fields_only" : "request_budget_used_for_account_verification";
    result.metricsError = null;
    result.postMetrics = existing ? [{ ...existing, fetchedAt: now.toISOString() }] : [];
    result.providerRequestsUsed = providerRequestsUsed;
    return { result, providerRequestsUsed };
  }
  try {
    const source = platform === "facebook"
      ? `https://graph.facebook.com/${metaApiVersion(env)}/${encodeURIComponent(post.id)}`
      : platform === "instagram"
        ? `https://graph.facebook.com/${metaApiVersion(env)}/${encodeURIComponent(post.id)}`
        : `https://graph.threads.net/${encodeURIComponent(post.id)}`;
    providerRequestsUsed += 1;
    const record = platform === "facebook"
      ? await measureFacebookPost(env, post, source)
      : platform === "instagram"
        ? await measureInstagramPost(env, post, source)
        : await measureThreadsPost(env, post, source);
    record.fetchedAt = now.toISOString();
    record.provenance.collectedAt = now.toISOString();
    result.metricsState = record.available ? "measured" : "partial";
    result.metricsStatus = record.available ? "measured" : "no_values_returned";
    result.metricsError = null;
    result.postMetrics = [record];
    if (usesRecordedFacebookPost) {
      result.apiReachable = true;
      result.connectionState = "verified";
      result.lastVerifiedAt = now.toISOString();
      result.verificationExpiresAt = new Date(now.getTime() + READ_ONLY_VERIFICATION_TTL_MS).toISOString();
      result.verifiedAccountId = verifiedAccountId;
      result.accountMatched = accountMatched;
      result.verifiedAt = result.lastVerifiedAt;
      result.verificationMethod = "facebook read-only post-insights request using the recorded publisher post";
      result.connectionError = null;
    }
  } catch (error) {
    result.metricsState = "needs_attention";
    result.metricsStatus = "needs_attention";
    result.metricsError = errorDetails(error);
    result.postMetrics = existing ? [{ ...existing, fetchedAt: now.toISOString() }] : [];
    if (usesRecordedFacebookPost) {
      result.connectionState = "needs_attention";
      result.apiReachable = false;
      result.verifiedAccountId = null;
      result.accountMatched = false;
      result.connectionError = errorDetails(error);
    }
  }
  result.providerRequestsUsed = providerRequestsUsed;
  return { result, providerRequestsUsed };
}

function nextPlatform(previous, targets) {
  if (!targets.length) return null;
  const requested = String(previous?.nextPlatform ?? "").trim().toLowerCase();
  return targets.includes(requested) ? requested : targets[0];
}

function advancePlatform(current, targets) {
  if (!targets.length) return null;
  if (!current || !targets.includes(current)) return targets[0];
  return targets[(targets.indexOf(current) + 1 + targets.length) % targets.length];
}

function parseTimestamp(value) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function applyVerificationFreshness(audit, env, now = new Date()) {
  const source = audit && typeof audit === "object" ? audit : {};
  const platforms = {};
  let reconciledThreadsIdentity = false;
  for (const platform of READ_ONLY_PLATFORM_ORDER) {
    const previous = source.platforms?.[platform] && typeof source.platforms[platform] === "object"
      ? source.platforms[platform]
      : emptyPlatform(env, platform);
    const configured = platformConfigured(env, platform);
    const expected = expectedAccountId(env, platform);
    const expiration = parseTimestamp(previous.verificationExpiresAt)
      ?? (parseTimestamp(previous.lastVerifiedAt ?? previous.verifiedAt) !== null
        ? parseTimestamp(previous.lastVerifiedAt ?? previous.verifiedAt) + READ_ONLY_VERIFICATION_TTL_MS
        : null);
    let connectionState = configured ? String(previous.connectionState ?? "configured").trim().toLowerCase() : "not_configured";
    const expectedThreadsUsername = platform === "threads" ? String(expected ?? "").replace(/^@/, "").toLowerCase() : "";
    const returnedThreadsUsername = platform === "threads"
      ? String(previous.connectionError?.providerCode ?? "").replace(/^@/, "").toLowerCase()
      : "";
    const identityAttemptAt = parseTimestamp(previous.lastAttemptAt);
    const reconciledIdentity = configured
      && platform === "threads"
      && connectionState === "needs_attention"
      && previous.connectionError?.category === "account_mismatch"
      && Boolean(expectedThreadsUsername)
      && returnedThreadsUsername === expectedThreadsUsername
      && identityAttemptAt !== null
      && identityAttemptAt + READ_ONLY_VERIFICATION_TTL_MS > now.getTime();
    if (reconciledIdentity) {
      connectionState = "verified";
      reconciledThreadsIdentity = true;
    }
    const effectiveExpiration = reconciledIdentity ? identityAttemptAt + READ_ONLY_VERIFICATION_TTL_MS : expiration;
    if (configured && connectionState === "verified" && (!effectiveExpiration || effectiveExpiration <= now.getTime())) connectionState = "stale";
    if (configured && !["configured", "verified", "stale", "needs_attention"].includes(connectionState)) connectionState = "configured";
    platforms[platform] = {
      ...emptyPlatform(env, platform),
      ...previous,
      configured,
      expectedAccountId: expected,
      connectionState,
      ...(reconciledIdentity ? {
        apiReachable: true,
        accountMatched: true,
        verifiedAccountId: expected,
        verifiedAt: previous.lastAttemptAt,
        lastVerifiedAt: previous.lastAttemptAt,
        verificationExpiresAt: new Date(effectiveExpiration).toISOString(),
        verificationMethod: "threads identity response reconciled after expected-username correction",
        connectionError: null,
      } : {}),
    };
  }
  const verifiedCount = READ_ONLY_PLATFORM_ORDER.filter((platform) => platforms[platform].connectionState === "verified").length;
  return {
    ...source,
    ...(reconciledThreadsIdentity && Number(source.providerRequestsUsed ?? source.requestsUsed ?? 0) === 0 ? {
      providerRequestsUsed: 1,
      requestsUsed: 1,
    } : {}),
    platforms,
    verifiedCount,
    verificationTotal: READ_ONLY_PLATFORM_ORDER.length,
  };
}

function selectPlatform(previous, targets, requestedPlatform) {
  const requested = String(requestedPlatform ?? "").trim().toLowerCase();
  if (READ_ONLY_PLATFORM_ORDER.includes(requested)) return requested;
  if (!targets.length) return null;
  const platforms = previous?.platforms ?? {};
  const priority = [
    (platform) => platforms[platform]?.connectionState === "needs_attention",
    (platform) => platforms[platform]?.connectionState === "stale",
    (platform) => platforms[platform]?.connectionState === "configured" || !platforms[platform]?.lastVerifiedAt,
  ];
  for (const predicate of priority) {
    const candidate = targets.find(predicate);
    if (candidate) return candidate;
  }
  return targets
    .slice()
    .sort((left, right) => (parseTimestamp(platforms[left]?.lastVerifiedAt ?? platforms[left]?.verifiedAt) ?? 0) - (parseTimestamp(platforms[right]?.lastVerifiedAt ?? platforms[right]?.verifiedAt) ?? 0))[0] ?? targets[0];
}

export async function runReadOnlyStatusSampler(env, previous = null, now = new Date(), options = {}) {
  const checkedAt = now.toISOString();
  const freshPrevious = applyVerificationFreshness(previous, env, now);
  const nextEligible = Date.parse(String(previous?.nextEligibleRefreshAt ?? ""));
  if (Number.isFinite(nextEligible) && nextEligible > now.getTime()) {
    return {
      ...freshPrevious,
      checkedAt,
      providerRequestsUsed: 0,
      requestsUsed: 0,
      skipped: true,
      sideEffects: [],
    };
  }
  const targets = readOnlyConfiguredPlatforms(env);
  const selectedPlatform = selectPlatform(freshPrevious, targets, options.platform);
  const publishedPost = selectedPlatform ? options.lastPublishedByPlatform?.[selectedPlatform] ?? null : null;
  const sample = selectedPlatform
    ? await samplePlatform(env, selectedPlatform, now, freshPrevious?.platforms?.[selectedPlatform], publishedPost)
    : { result: {}, providerRequestsUsed: 0 };
  const previousMetrics = Array.isArray(freshPrevious?.postMetrics) ? freshPrevious.postMetrics : [];
  const sampledMetrics = Array.isArray(sample.result.postMetrics) ? sample.result.postMetrics : [];
  const postMetrics = mergeNewestPostMetrics(previousMetrics, sampledMetrics).slice(-120);
  const platforms = {};
  for (const platform of READ_ONLY_PLATFORM_ORDER) {
    const configured = platformConfigured(env, platform);
    const previousPlatform = freshPrevious?.platforms?.[platform] && typeof freshPrevious.platforms[platform] === "object"
      ? freshPrevious.platforms[platform]
      : emptyPlatform(env, platform);
    platforms[platform] = {
      ...previousPlatform,
      ...(platform === selectedPlatform ? sample.result : {}),
      configured,
      connectionState: !configured
        ? "not_configured"
        : platform === selectedPlatform
          ? sample.result.connectionState ?? "configured"
          : previousPlatform.connectionState ?? "configured",
      postMetrics: postMetrics.filter((record) => record.platform === platform),
    };
  }
  const verificationFreshness = applyVerificationFreshness({ platforms }, env, now);
  const connectionError = sample.result.connectionError;
  const metricsError = sample.result.metricsError;
  return {
    ok: !connectionError && !metricsError,
    mode: "read-only-on-demand-sampler",
    checkedAt,
    collectedAt: checkedAt,
    selectedPlatform,
    nextPlatform: advancePlatform(selectedPlatform, targets),
    nextEligibleRefreshAt: new Date(now.getTime() + READ_ONLY_SAMPLER_INTERVAL_MS).toISOString(),
    providerRequestsUsed: sample.providerRequestsUsed,
    requestsUsed: sample.providerRequestsUsed,
    requestBudget: READ_ONLY_REQUEST_BUDGET,
    platforms: verificationFreshness.platforms,
    verifiedCount: verificationFreshness.verifiedCount,
    verificationTotal: verificationFreshness.verificationTotal,
    errors: connectionError
      ? [`${selectedPlatform}: ${errorText(connectionError)}`]
      : metricsError
        ? [`${selectedPlatform} metrics: ${errorText(metricsError)}`]
        : [],
    sideEffects: [],
    postMetrics,
    automation: {
      enabled: parseBoolean(env.SOCIAL_AUTOMATION_ENABLED, true),
      publishingEnabled: parseBoolean(env.SOCIAL_PUBLISH_ENABLED, false),
      repliesEnabled: parseBoolean(env.SOCIAL_REPLY_ENABLED, true),
      configuredPlatforms: targets,
    },
  };
}
