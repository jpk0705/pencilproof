import directWorker, {
  SocialAutomationState as DirectSocialAutomationState,
  clampInteger,
  detectConfiguredPlatforms,
  isLikelyOwnComment,
  isWithinActiveHours,
  localClockParts,
  parseBoolean,
  runDirectReadOnlyAudit,
  shouldPublishNow,
  trimUnique,
} from "./social-direct.mjs";
import { publicPilotUrl, routePostToPilot } from "./campaign-links.mjs";
import {
  mergeNewestPostMetrics,
  mergePostMetrics,
  postMetricsRecord,
} from "./social-metrics.mjs";
import {
  buildFallbackPost,
  contentHistoryEntry,
  contentHistoryForPlatform,
  contentPrompt,
  formatSocialPost,
  selectContentPlan,
  validateSocialPost,
} from "./social-content.mjs";
import {
  READ_ONLY_REQUEST_BUDGET,
  READ_ONLY_PLATFORM_ORDER,
  READ_ONLY_VERIFICATION_LEASE_MS,
  applyVerificationFreshness,
  readOnlyConfiguredPlatforms,
  runReadOnlyStatusSampler,
} from "./social-status.mjs";
import { buildOperationsSnapshot, operationsStatusPage } from "./operations-dashboard.mjs";

const FACEBOOK_STATE_KEY = "social-facebook-v1";
const STATUS_STATE_KEY = "social-status-v1";
const VERIFICATION_LEASE_KEY = "social-status-verification-lease-v1";
const BUSINESS_STATUS_KEY = "operations-business-status-v1";
const OPERATIONS_REPAIR_KEY = "operations-repair-v1";
const OPERATIONS_COLLECTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const OPERATIONS_COLLECTION_CRON = "7 * * * *";
const SOCIAL_HEARTBEAT_STALE_MS = 75 * 60 * 1000;
const DEFAULT_TIMEZONE = "America/Los_Angeles";
const DEFAULT_MODEL = "@cf/meta/llama-3.2-1b-instruct";
const DEFAULT_META_API_VERSION = "v24.0";
const MAX_SEEN_COMMENTS = 2000;
const MAX_OWN_COMMENT_IDS = 1000;
const MAX_RECENT_POSTS = 100;
const MAX_POST_METRICS = 120;
const MAX_METRIC_POSTS_PER_RUN = 2;
const MAX_PUBLISHED_KEYS = 200;
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_MAX_REPLIES_PER_RUN = 4;
const DEFAULT_MAX_REPLIES_PER_DAY = 12;
const DEFAULT_POST_INTERVAL_HOURS = 36;
const DEFAULT_ACTIVE_START_HOUR = 8;
const DEFAULT_ACTIVE_END_HOUR = 19;
const DEFAULT_FACEBOOK_AI_CALLS_PER_DAY = 200;

const BRAND_CONTEXT = `PencilProof is a privacy-first educational car-finance Full Quote Audit. It helps a buyer rebuild a dealer quote, compare payment with and without optional products, understand APR and trade-equity differences, and prepare questions for the dealership. PencilProof is not a broker, lender, law firm, financial adviser, or negotiating service. It does not contact dealerships. Users should verify figures with the dealer and lender before signing.`;

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

export function facebookConfigured(env = {}) {
  return Boolean(
    String(env.FACEBOOK_PAGE_ID ?? "").trim()
    && String(env.FACEBOOK_PAGE_ACCESS_TOKEN ?? "").trim(),
  );
}

export function combinedConfiguredPlatforms(env = {}) {
  const platforms = detectConfiguredPlatforms(env);
  if (facebookConfigured(env)) platforms.push("facebook");
  return [...new Set(platforms)];
}

export function facebookCommentKey(comment) {
  return `facebook:${String(comment?.commentId ?? "")}`;
}

function responseJson(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });
}

function wantsHtmlStatus(request) {
  const format = new URL(request.url).searchParams.get("format");
  if (format === "html") return true;
  if (format === "json") return false;
  return (request.headers.get("Accept") ?? "").toLowerCase().includes("text/html");
}

function safePostUrl(value) {
  const url = String(value ?? "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message.slice(0, 500) : String(error ?? "Unknown error").slice(0, 500);
}

function numericMetric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function metaApiVersion(env) {
  const raw = String(env.META_API_VERSION ?? DEFAULT_META_API_VERSION).trim() || DEFAULT_META_API_VERSION;
  return raw.startsWith("v") ? raw : `v${raw}`;
}

function facebookGraphBase(env) {
  return `https://graph.facebook.com/${metaApiVersion(env)}`;
}

function facebookPageId(env) {
  return String(env.FACEBOOK_PAGE_ID ?? "").trim();
}

function facebookToken(env) {
  return String(env.FACEBOOK_PAGE_ACCESS_TOKEN ?? "").trim();
}

async function facebookJson(env, path, init = {}, label = "Facebook request") {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${facebookToken(env)}`);
  const response = await fetch(`${facebookGraphBase(env)}${path}`, { ...init, headers });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = typeof payload?.error?.message === "string"
      ? payload.error.message
      : typeof payload?.message === "string"
        ? payload.message
        : `HTTP ${response.status}`;
    throw new Error(`${label} failed: ${detail}`);
  }
  return payload ?? {};
}

function emptyFacebookState() {
  return {
    version: 1,
    lastRunAt: null,
    lastPostAt: null,
    lastPostId: null,
    lastError: null,
    counters: { date: null, posts: 0, replies: 0, aiCalls: 0 },
    seenComments: [],
    repliedComments: [],
    ownCommentIds: [],
    recentPosts: [],
    postMetrics: [],
    publishedKeys: [],
    lastPublishedByPlatform: {},
    contentHistoryByPlatform: { facebook: [] },
    readOnlyAudit: null,
    lastSummary: null,
  };
}

function normalizeFacebookState(value) {
  const state = value && typeof value === "object" ? value : {};
  const normalized = {
    ...emptyFacebookState(),
    ...state,
    counters: {
      ...emptyFacebookState().counters,
      ...(state.counters && typeof state.counters === "object" ? state.counters : {}),
    },
    seenComments: Array.isArray(state.seenComments) ? state.seenComments : [],
    repliedComments: Array.isArray(state.repliedComments) ? state.repliedComments : [],
    ownCommentIds: Array.isArray(state.ownCommentIds) ? state.ownCommentIds : [],
    recentPosts: Array.isArray(state.recentPosts) ? state.recentPosts : [],
    postMetrics: Array.isArray(state.postMetrics) ? state.postMetrics : [],
    publishedKeys: Array.isArray(state.publishedKeys) ? state.publishedKeys : [],
    lastPublishedByPlatform: state.lastPublishedByPlatform && typeof state.lastPublishedByPlatform === "object"
      ? state.lastPublishedByPlatform
      : {},
    contentHistoryByPlatform: {
      facebook: Array.isArray(state.contentHistoryByPlatform?.facebook)
        ? state.contentHistoryByPlatform.facebook
        : [],
    },
    readOnlyAudit: state.readOnlyAudit && typeof state.readOnlyAudit === "object"
      ? state.readOnlyAudit
      : null,
  };
  if (!normalized.contentHistoryByPlatform.facebook.length) {
    normalized.contentHistoryByPlatform.facebook = normalized.recentPosts
      .filter((item) => item?.platform === "facebook" || !item?.platform)
      .map((item) => ({ platform: "facebook", post: String(item.post ?? ""), created: item.created ?? null }));
  }
  return normalized;
}

function resetDailyCounters(state, now, timeZone) {
  const { date } = localClockParts(now, timeZone);
  if (state.counters.date !== date) {
    state.counters = { date, posts: 0, replies: 0, aiCalls: 0 };
  }
}

function reserveAiCall(env, state) {
  const max = clampInteger(
    env.SOCIAL_FACEBOOK_AI_MAX_CALLS_PER_DAY,
    DEFAULT_FACEBOOK_AI_CALLS_PER_DAY,
    0,
    200,
  );
  if (state.counters.aiCalls >= max) {
    throw new Error("Facebook AI daily cap reached; skipping until the next local day");
  }
  state.counters.aiCalls += 1;
}

function extractAiText(result) {
  if (typeof result === "string") return result;
  if (typeof result?.response === "string") return result.response;
  if (result?.response && typeof result.response === "object") return result.response;
  const choices = Array.isArray(result?.choices) ? result.choices : [];
  const content = choices[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      return "";
    }).join("");
  }
  return "";
}

export function parseAiJson(text) {
  if (text && typeof text === "object") return text;
  const raw = String(text ?? "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? raw;
  const candidates = new Set([fenced]);
  for (const source of [raw, fenced]) {
    for (let start = 0; start < source.length; start += 1) {
      if (source[start] !== "{" && source[start] !== "[") continue;
      const stack = [];
      let inString = false;
      let escaped = false;
      for (let index = start; index < source.length; index += 1) {
        const character = source[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') {
          inString = true;
          continue;
        }
        if (character === "{" || character === "[") {
          stack.push(character);
          continue;
        }
        if (character === "}" || character === "]") {
          const opening = stack.at(-1);
          if ((character === "}" && opening !== "{") || (character === "]" && opening !== "[")) break;
          stack.pop();
          if (stack.length === 0) {
            candidates.add(source.slice(start, index + 1));
            break;
          }
        }
      }
    }
  }
  for (const candidate of candidates) {
    for (const value of [candidate, candidate.replace(/[“”]/g, '"')]) {
      try {
        return JSON.parse(value);
      } catch {
        // Try the next balanced candidate. The content validator remains the final gate.
      }
    }
  }
  throw new Error("AI returned invalid JSON");
}

async function aiJson(env, state, system, user, maxTokens = 260) {
  if (!env.AI?.run) throw new Error("Workers AI binding is not configured");
  reserveAiCall(env, state);
  const model = String(env.SOCIAL_AI_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const result = await env.AI.run(model, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
    response_format: { type: "json_object" },
  });
  return parseAiJson(extractAiText(result));
}

async function decideFacebookReply(env, state, comment) {
  const system = `You write concise Facebook Page replies for PencilProof. ${BRAND_CONTEXT}\n\nReturn JSON only: {"action":"reply"|"ignore","reply":"...","reason":"..."}. Reply only to genuine engagement or relevant car-finance/dealer-quote questions. Ignore spam, bait, harassment, politics, unrelated comments, legal disputes, credit-repair requests, individualized legal/financial advice, and requests requiring private paperwork. Never request SSNs, account numbers, DOB, addresses, or sensitive personal data. Never claim PencilProof negotiates, contacts dealers, guarantees savings, or gives legal/financial advice. If replying, answer the question directly, invite one useful follow-up question, and include the tracked free-review link only when it naturally helps. Stay under 350 characters, use no hashtags, and avoid hard selling.`;
  const user = `Parent post: ${String(comment.postText ?? "").slice(0, 800)}\nComment by ${comment.username || "unknown"}: ${String(comment.text ?? "").slice(0, 1200)}\nTracked free-review link: ${publicPilotUrl("facebook", "reply-qa")}`;
  const parsed = await aiJson(env, state, system, user, 240);
  const reply = typeof parsed?.reply === "string" ? parsed.reply.trim().slice(0, 500) : "";
  return {
    action: parsed?.action === "reply" && reply ? "reply" : "ignore",
    reply,
  };
}

async function generateFacebookPost(env, state, now = new Date()) {
  const platform = "facebook";
  const history = contentHistoryForPlatform(state, platform);
  const primaryPlan = selectContentPlan(now, platform, history);
  const attempt = async (plan, promptHistory = history) => {
    const parsed = await aiJson(
      env,
      state,
      `You are the content engine for PencilProof. ${BRAND_CONTEXT}\n\n${contentPrompt(platform, plan, promptHistory)}`,
      `Assigned platform: ${platform}\nAssigned content plan: ${JSON.stringify(plan)}\nCreate the post now.`,
      1400,
    );
    return formatSocialPost(typeof parsed?.post === "string" ? parsed.post : "");
  };

  let firstDraft = "";
  let firstError = null;
  try {
    firstDraft = await attempt(primaryPlan);
  } catch (error) {
    firstError = error;
    if (!safeErrorMessage(error).includes("AI returned invalid JSON")) throw error;
  }
  const firstValidation = validateSocialPost(firstDraft, primaryPlan, history, platform);
  if (!firstError && firstValidation.ok) {
    return { post: firstDraft, plan: primaryPlan, validation: firstValidation, rewritten: false, fallback: false };
  }

  const rewritePlan = selectContentPlan(new Date(new Date(now).getTime() + 86400000), platform, [
    ...history,
    { ...primaryPlan, post: firstDraft },
  ]);
  try {
    const rewrittenDraft = await attempt(rewritePlan, [...history, { ...primaryPlan, post: firstDraft }]);
    const rewrittenValidation = validateSocialPost(rewrittenDraft, rewritePlan, history, platform);
    if (rewrittenValidation.ok) {
      return { post: rewrittenDraft, plan: rewritePlan, validation: rewrittenValidation, rewritten: true, fallback: false };
    }
  } catch (error) {
    if (!safeErrorMessage(error).includes("AI returned invalid JSON")) throw error;
  }

  const fallback = buildFallbackPost(rewritePlan, platform, history);
  const fallbackValidation = validateSocialPost(fallback, rewritePlan, history, platform);
  if (!fallbackValidation.ok) throw new Error(`Facebook content fallback failed validation: ${fallbackValidation.reasons.join(", ")}`);
  return { post: fallback, plan: rewritePlan, validation: fallbackValidation, rewritten: true, fallback: true };
}

async function getFacebookPosts(env, limit = 10) {
  const params = new URLSearchParams({
    fields: "id,message,created_time,permalink_url,from",
    limit: String(limit),
  });
  const payload = await facebookJson(
    env,
    `/${encodeURIComponent(facebookPageId(env))}/feed?${params}`,
    {},
    "Facebook Page feed",
  );
  const pageId = facebookPageId(env);
  return (Array.isArray(payload.data) ? payload.data : [])
    .filter((item) => item?.id && (!item?.from?.id || String(item.from.id) === pageId))
    .map((item) => ({
      id: String(item.id),
      post: String(item.message ?? ""),
      created: String(item.created_time ?? ""),
      postUrl: String(item.permalink_url ?? ""),
    }));
}

async function getFacebookPostMetrics(env, post, now = new Date()) {
  const source = `${facebookGraphBase(env)}/${encodeURIComponent(post.id)}`;
  // The status sampler is intentionally one provider request per post. The
  // engagement summary is stable across post types and gives real values
  // without a fallback cascade that can exhaust the Worker budget.
  const fields = new URLSearchParams({ fields: "comments.limit(0).summary(true),reactions.limit(0).summary(true),shares" });
  try {
    const summary = await facebookJson(
      env,
      `/${encodeURIComponent(post.id)}?${fields}`,
      {},
      "Facebook post engagement summary",
    );
    const comments = numericMetric(summary.comments?.summary?.total_count);
    const likes = numericMetric(summary.reactions?.summary?.total_count);
    const shares = numericMetric(summary.shares?.count);
    const engagementValues = [comments, likes, shares].filter((value) => value !== null);
    const engagement = engagementValues.length
      ? engagementValues.reduce((sum, value) => sum + value, 0)
      : null;
    return postMetricsRecord({
      platform: "facebook",
      post,
      metrics: { comments, likes, shares, engagement },
      rawMetrics: { "comments.summary.total_count": comments, "reactions.summary.total_count": likes, "shares.count": shares },
      observations: {
        comments: { providerMetric: "comments.summary.total_count", source },
        likes: { providerMetric: "reactions.summary.total_count", source },
        shares: { providerMetric: "shares.count", source },
        engagement: { kind: "derived", formula: "comments + likes + shares", source },
      },
      source,
      fetchedAt: now.toISOString(),
    });
  } catch (error) {
    return postMetricsRecord({
      platform: "facebook",
      post,
      fetchedAt: now.toISOString(),
      source,
      error: safeErrorMessage(error),
    });
  }
}

async function getFacebookComments(env, post) {
  const params = new URLSearchParams({
    fields: "id,message,created_time,from,parent",
    limit: "50",
  });
  const payload = await facebookJson(
    env,
    `/${encodeURIComponent(post.id)}/comments?${params}`,
    {},
    "Facebook comments",
  );
  const pageId = facebookPageId(env);
  return (Array.isArray(payload.data) ? payload.data : [])
    .filter((item) => item?.id && item?.message)
    .map((item) => ({
      platform: "facebook",
      postId: post.id,
      postText: post.post,
      postUrl: post.postUrl,
      commentId: String(item.id),
      text: String(item.message),
      username: String(item.from?.name ?? ""),
      authorId: String(item.from?.id ?? ""),
      created: String(item.created_time ?? ""),
      isOwn: String(item.from?.id ?? "") === pageId,
    }));
}

async function replyFacebook(env, comment, message) {
  const body = new URLSearchParams({ message });
  return facebookJson(
    env,
    `/${encodeURIComponent(comment.commentId)}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    "Facebook reply",
  );
}

async function publishFacebook(env, message) {
  const body = new URLSearchParams({ message });
  return facebookJson(
    env,
    `/${encodeURIComponent(facebookPageId(env))}/feed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    "Facebook publish",
  );
}

async function resolveFacebookPostUrl(env, id, result) {
  for (const key of ["url", "postUrl", "permalink", "permalink_url"]) {
    const value = String(result?.[key] ?? "").trim();
    if (/^https?:\/\//i.test(value)) return value;
  }
  try {
    const posts = await getFacebookPosts(env, 10);
    return String(posts.find((post) => String(post.id) === String(id))?.postUrl ?? "").trim();
  } catch {
    return "";
  }
}

function hydrateFacebookPostUrl(record, recentPosts) {
  if (!record || /^https?:\/\//i.test(String(record.url ?? record.postUrl ?? "").trim())) return record;
  const match = [...(Array.isArray(recentPosts) ? recentPosts : [])]
    .reverse()
    .find((post) => String(post?.id) === String(record.id) && /^https?:\/\//i.test(String(post?.postUrl ?? "").trim()));
  return match ? { ...record, url: String(match.postUrl).trim() } : record;
}

async function runFacebookAutomation(env, state, now = new Date()) {
  const summary = {
    startedAt: now.toISOString(),
    configured: facebookConfigured(env),
    postsScanned: 0,
    commentsScanned: 0,
    repliesPosted: 0,
    commentsIgnored: 0,
    postPublished: false,
    contentPlans: [],
    contentFallbacks: 0,
    aiCalls: 0,
    warnings: [],
  };

  if (!summary.configured) return summary;

  const timeZone = String(env.SOCIAL_TIMEZONE ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  resetDailyCounters(state, now, timeZone);
  const aiCallsAtStart = state.counters.aiCalls;
  const seen = new Set(state.seenComments);
  const ownCommentIds = new Set(state.ownCommentIds);
  const ownHandles = new Set(
    String(env.SOCIAL_OWN_HANDLES ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  );

  const lookbackDays = clampInteger(env.SOCIAL_REPLY_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS, 1, 60);
  const maxRepliesPerRun = clampInteger(env.SOCIAL_MAX_REPLIES_PER_RUN, DEFAULT_MAX_REPLIES_PER_RUN, 0, 20);
  const maxRepliesPerDay = clampInteger(env.SOCIAL_MAX_REPLIES_PER_DAY, DEFAULT_MAX_REPLIES_PER_DAY, 0, 100);
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  const replyEnabled = parseBoolean(env.SOCIAL_REPLY_ENABLED, true);

  let posts = [];
  try {
    posts = await getFacebookPosts(env, 10);
  } catch (error) {
    summary.warnings.push(`facebook history: ${safeErrorMessage(error)}`);
  }

  const recentForMetrics = posts.slice(0, MAX_METRIC_POSTS_PER_RUN);
  const refreshedAt = now.getTime() - (6 * 60 * 60 * 1000);
  const staleForMetrics = recentForMetrics.filter((post) => {
    const previous = state.postMetrics.find((item) => String(item.id) === String(post.id));
    const previousAt = Date.parse(String(previous?.fetchedAt ?? ""));
    return !previous || !Number.isFinite(previousAt) || previousAt < refreshedAt;
  });
  if (staleForMetrics.length > 0) {
    const refreshedMetrics = await Promise.all(staleForMetrics.map((post) => getFacebookPostMetrics(env, post, now)));
    state.postMetrics = mergePostMetrics(state.postMetrics, refreshedMetrics, MAX_POST_METRICS);
  }

  outer: for (const post of posts) {
    const created = Date.parse(post.created);
    if (Number.isFinite(created) && created < cutoff) continue;
    summary.postsScanned += 1;
    state.recentPosts.push({
      platform: "facebook",
      id: post.id,
      post: post.post.slice(0, 500),
      created: post.created,
      postUrl: post.postUrl,
    });

    let comments = [];
    try {
      comments = await getFacebookComments(env, post);
    } catch (error) {
      summary.warnings.push(`facebook comments: ${safeErrorMessage(error)}`);
      continue;
    }

    for (const comment of comments) {
      summary.commentsScanned += 1;
      const key = facebookCommentKey(comment);
      if (seen.has(key)) continue;
      if (isLikelyOwnComment(comment, ownHandles, ownCommentIds)) {
        seen.add(key);
        summary.commentsIgnored += 1;
        continue;
      }
      if (!replyEnabled || state.counters.replies >= maxRepliesPerDay || summary.repliesPosted >= maxRepliesPerRun) {
        if (!replyEnabled) seen.add(key);
        continue;
      }

      let decision;
      try {
        decision = await decideFacebookReply(env, state, comment);
      } catch (error) {
        summary.warnings.push(`facebook reply decision ${key}: ${safeErrorMessage(error)}`);
        if (safeErrorMessage(error).includes("AI daily cap")) break outer;
        continue;
      }

      if (decision.action !== "reply") {
        seen.add(key);
        summary.commentsIgnored += 1;
        continue;
      }

      seen.add(key);
      try {
        const result = await replyFacebook(env, comment, decision.reply);
        const replyId = String(result?.id ?? "").trim();
        if (replyId) ownCommentIds.add(replyId);
        state.repliedComments.push(key);
        state.counters.replies += 1;
        summary.repliesPosted += 1;
      } catch (error) {
        summary.warnings.push(`facebook reply post ${key}: ${safeErrorMessage(error)}`);
      }

      if (summary.repliesPosted >= maxRepliesPerRun) break outer;
    }
  }

  const publishEnabled = parseBoolean(env.SOCIAL_PUBLISH_ENABLED, false);
  const requested = String(env.SOCIAL_PUBLISH_PLATFORMS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const facebookRequested = requested.length === 0 || requested.includes("facebook");
  const intervalHours = clampInteger(env.SOCIAL_POST_INTERVAL_HOURS, DEFAULT_POST_INTERVAL_HOURS, 36, 720);
  const maxPostsPerDay = clampInteger(env.SOCIAL_MAX_POSTS_PER_DAY, 1, 1, 10);
  const activeStartHour = clampInteger(env.SOCIAL_ACTIVE_START_HOUR, DEFAULT_ACTIVE_START_HOUR, 0, 23);
  const activeEndHour = clampInteger(env.SOCIAL_ACTIVE_END_HOUR, DEFAULT_ACTIVE_END_HOUR, 0, 23);

  const eligibleToPublish = publishEnabled && facebookRequested && shouldPublishNow({
    now,
    lastPostAt: state.lastPostAt,
    intervalHours,
    timeZone,
    activeStartHour,
    activeEndHour,
    postsToday: state.counters.posts,
    maxPostsPerDay,
  });

  if (eligibleToPublish) {
    const { date } = localClockParts(now, timeZone);
    const publishKey = `${date}:facebook:${state.counters.posts + 1}`;
    if (!state.publishedKeys.includes(publishKey)) {
      try {
        const generated = await generateFacebookPost(env, state, now);
        summary.contentPlans.push({
          platform: "facebook",
          context: generated.plan.context,
          angle: generated.plan.angle,
          takeaway: generated.plan.takeaway,
          structure: generated.plan.structure,
          openingStyle: generated.plan.openingStyle,
          hook: generated.plan.hook,
          contentFormat: generated.plan.contentFormat,
          callToAction: generated.plan.callToAction,
          rewritten: generated.rewritten,
          fallback: generated.fallback,
          validation: generated.validation,
        });
        if (generated.fallback) summary.contentFallbacks += 1;
        const publishedPost = routePostToPilot(generated.post, "facebook", generated.plan.structure);
        const result = await publishFacebook(env, publishedPost);
        state.publishedKeys.push(publishKey);
        state.lastPostAt = now.toISOString();
        state.lastPostId = String(result?.id ?? publishKey);
        const postUrl = await resolveFacebookPostUrl(env, state.lastPostId, result);
        state.lastPublishedByPlatform.facebook = {
          id: state.lastPostId,
          at: now.toISOString(),
          ...(postUrl ? { url: postUrl } : {}),
        };
        state.counters.posts += 1;
        state.contentHistoryByPlatform.facebook.push(contentHistoryEntry("facebook", generated.plan, generated.post, now, {
          id: state.lastPostId,
          url: postUrl || null,
          rewritten: generated.rewritten,
          fallback: generated.fallback,
        }));
        state.recentPosts.push({
          platform: "facebook",
          id: state.lastPostId,
          post: generated.post,
          created: now.toISOString(),
          postUrl: postUrl || "",
        });
        summary.postPublished = true;
      } catch (error) {
        summary.warnings.push(`facebook publish: ${safeErrorMessage(error)}`);
      }
    }
  }

  state.seenComments = trimUnique([...seen], MAX_SEEN_COMMENTS);
  state.repliedComments = trimUnique(state.repliedComments, MAX_SEEN_COMMENTS);
  state.ownCommentIds = trimUnique([...ownCommentIds], MAX_OWN_COMMENT_IDS);
  state.recentPosts = state.recentPosts.slice(-MAX_RECENT_POSTS);
  state.contentHistoryByPlatform.facebook = state.contentHistoryByPlatform.facebook.slice(-40);
  state.publishedKeys = trimUnique(state.publishedKeys, MAX_PUBLISHED_KEYS);
  state.lastRunAt = new Date().toISOString();
  state.lastError = summary.warnings.length ? summary.warnings.slice(-5).join(" | ") : null;
  summary.aiCalls = state.counters.aiCalls - aiCallsAtStart;
  state.lastSummary = summary;
  return summary;
}

function stateStub(env) {
  const id = env.SOCIAL_STATE.idFromName("pencilproof-social-global");
  return env.SOCIAL_STATE.get(id);
}

async function triggerFacebookRun(env) {
  const response = await stateStub(env).fetch(new Request("https://social.internal/facebook-run", { method: "POST" }));
  if (!response.ok) throw new Error(`Facebook automation run failed with HTTP ${response.status}`);
  return response;
}

const VERIFICATION_STATES = new Set(["not_configured", "configured", "verified", "stale", "needs_attention"]);
const METRICS_STATES = new Set(["not_attempted", "measured", "partial", "no_post", "needs_attention"]);

function boundedText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function sanitizeStoredError(value) {
  if (!value) return null;
  const source = typeof value === "string" ? { message: value } : value;
  const category = ["authentication", "permission", "account_mismatch", "rate_limited", "provider", "malformed_response"].includes(String(source.category))
    ? String(source.category)
    : "provider";
  return {
    category,
    httpStatus: Number.isFinite(Number(source.httpStatus)) ? Number(source.httpStatus) : null,
    providerCode: source.providerCode === undefined || source.providerCode === null ? null : boundedText(source.providerCode, 80),
    message: boundedText(source.message ?? source.error ?? "Provider error"),
  };
}

function sanitizeStoredMetric(record) {
  if (!record || typeof record !== "object") return null;
  const sanitized = postMetricsRecord({
    platform: boundedText(record.platform, 30),
    post: {
      id: boundedText(record.id, 200),
      created: boundedText(record.created, 80),
      postUrl: safePostUrl(record.url),
    },
    metrics: record.metrics,
    fetchedAt: boundedText(record.fetchedAt, 80) || new Date(0).toISOString(),
    error: record.error ? boundedText(record.error, 300) : null,
    source: boundedText(record.provenance?.source, 300) || "stored metric record",
    rawMetrics: record.provenance?.rawMetrics,
    observations: record.provenance?.observations,
  });
  return sanitized.platform && sanitized.id ? sanitized : null;
}

function sanitizeStoredPlatform(value) {
  const source = value && typeof value === "object" ? value : {};
  const connectionState = VERIFICATION_STATES.has(String(source.connectionState)) ? String(source.connectionState) : "configured";
  const metricsState = METRICS_STATES.has(String(source.metricsState)) ? String(source.metricsState) : "not_attempted";
  const postMetrics = (Array.isArray(source.postMetrics) ? source.postMetrics : [])
    .map(sanitizeStoredMetric)
    .filter(Boolean);
  return {
    configured: source.configured === true,
    connectionState,
    apiReachable: source.apiReachable === true,
    lastAttemptAt: boundedText(source.lastAttemptAt, 80) || null,
    lastVerifiedAt: boundedText(source.lastVerifiedAt, 80) || null,
    verificationExpiresAt: boundedText(source.verificationExpiresAt, 80) || null,
    expectedAccountId: boundedText(source.expectedAccountId, 200) || null,
    verifiedAccountId: boundedText(source.verifiedAccountId, 200) || null,
    accountMatched: source.accountMatched === true,
    verifiedAt: boundedText(source.verifiedAt, 80) || null,
    verificationMethod: boundedText(source.verificationMethod, 200) || null,
    connectionError: sanitizeStoredError(source.connectionError),
    recentPostCount: clampInteger(source.recentPostCount, 0, 0, 100),
    latestRemotePostAt: boundedText(source.latestRemotePostAt, 80) || null,
    metricsState,
    metricsAttemptAt: boundedText(source.metricsAttemptAt, 80) || null,
    metricsError: sanitizeStoredError(source.metricsError),
    providerRequestsUsed: clampInteger(source.providerRequestsUsed, 0, 0, READ_ONLY_REQUEST_BUDGET),
    metricsStatus: boundedText(source.metricsStatus, 40) || "not_sampled",
    postMetrics: mergeNewestPostMetrics(postMetrics).slice(-MAX_POST_METRICS),
  };
}

function sanitizeStoredAudit(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const platforms = {};
  for (const platform of READ_ONLY_PLATFORM_ORDER) platforms[platform] = sanitizeStoredPlatform(source.platforms?.[platform]);
  const automation = source.automation && typeof source.automation === "object"
    ? {
        enabled: source.automation.enabled === true,
        publishingEnabled: source.automation.publishingEnabled === true,
        repliesEnabled: source.automation.repliesEnabled === true,
        configuredPlatforms: Array.isArray(source.automation.configuredPlatforms)
          ? source.automation.configuredPlatforms.map((item) => boundedText(item, 30)).filter(Boolean).slice(0, 10)
          : [],
      }
    : null;
  return {
    ok: source.ok !== false,
    mode: "read-only-on-demand-sampler",
    checkedAt: boundedText(source.checkedAt, 80) || new Date().toISOString(),
    collectedAt: boundedText(source.collectedAt ?? source.checkedAt, 80) || new Date().toISOString(),
    selectedPlatform: boundedText(source.selectedPlatform, 30) || null,
    nextPlatform: boundedText(source.nextPlatform, 30) || null,
    nextEligibleRefreshAt: boundedText(source.nextEligibleRefreshAt, 80) || null,
    providerRequestsUsed: clampInteger(source.providerRequestsUsed ?? source.requestsUsed, 0, 0, READ_ONLY_REQUEST_BUDGET),
    requestsUsed: clampInteger(source.providerRequestsUsed ?? source.requestsUsed, 0, 0, READ_ONLY_REQUEST_BUDGET),
    requestBudget: READ_ONLY_REQUEST_BUDGET,
    verifiedCount: clampInteger(source.verifiedCount, 0, 0, READ_ONLY_PLATFORM_ORDER.length),
    verificationTotal: READ_ONLY_PLATFORM_ORDER.length,
    platforms,
    errors: Array.isArray(source.errors) ? source.errors.map((error) => boundedText(error, 300)).filter(Boolean).slice(-20) : [],
    postMetrics: (Array.isArray(source.postMetrics) ? source.postMetrics : [])
      .map(sanitizeStoredMetric)
      .filter(Boolean)
      .reduce((records, record) => mergeNewestPostMetrics(records, [record]), [])
      .slice(-MAX_POST_METRICS),
    automation,
    sideEffects: [],
  };
}

async function deleteStorageKey(storage, key) {
  if (typeof storage.delete === "function") {
    await storage.delete(key);
  } else {
    await storage.put(key, undefined);
  }
}

export class SocialAutomationState extends DirectSocialAutomationState {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/facebook-run") {
      let state = normalizeFacebookState(await this.state.storage.get(FACEBOOK_STATE_KEY));
      try {
        const summary = await runFacebookAutomation(this.env, state, new Date());
        await this.state.storage.put(FACEBOOK_STATE_KEY, state);
        console.log(JSON.stringify({ event: "social_facebook_run", ...summary }));
        return responseJson({ ok: true, summary });
      } catch (error) {
        state.lastRunAt = new Date().toISOString();
        state.lastError = safeErrorMessage(error);
        await this.state.storage.put(FACEBOOK_STATE_KEY, state);
        console.error(JSON.stringify({ event: "social_facebook_error", error: state.lastError }));
        return responseJson({ ok: false, error: state.lastError }, 502);
      }
    }

    if (request.method === "GET" && url.pathname === "/facebook-status") {
      const state = normalizeFacebookState(await this.state.storage.get(FACEBOOK_STATE_KEY));
      const readOnlyAudit = await this.state.storage.get(STATUS_STATE_KEY);
      const businessStatus = await this.state.storage.get(BUSINESS_STATUS_KEY);
      const repairStatus = await this.state.storage.get(OPERATIONS_REPAIR_KEY);
      return responseJson({
        lastRunAt: state.lastRunAt,
        lastPostAt: state.lastPostAt,
        lastError: state.lastError,
        contentHistoryByPlatform: state.contentHistoryByPlatform,
        lastPublishedByPlatform: {
          ...state.lastPublishedByPlatform,
          ...(state.lastPublishedByPlatform.facebook
            ? { facebook: hydrateFacebookPostUrl(state.lastPublishedByPlatform.facebook, state.recentPosts) }
            : {}),
        },
        postMetrics: state.postMetrics,
        readOnlyAudit: readOnlyAudit && typeof readOnlyAudit === "object" ? readOnlyAudit : null,
        businessStatus: businessStatus && typeof businessStatus === "object" ? businessStatus : null,
        repairStatus: repairStatus && typeof repairStatus === "object" ? repairStatus : null,
        counters: state.counters,
        lastSummary: state.lastSummary,
      });
    }

    if (request.method === "POST" && url.pathname === "/claim-read-only-verification") {
      let payload = {};
      try {
        payload = await request.json();
      } catch {
        return responseJson({ ok: false, error: "Invalid verification claim payload" }, 400);
      }
      const token = boundedText(payload.token, 100);
      if (!token) return responseJson({ ok: false, error: "Verification claim token is required" }, 400);
      const now = Date.parse(String(payload.now ?? ""));
      const nowMs = Number.isFinite(now) ? now : Date.now();
      const storedAudit = await this.state.storage.get(STATUS_STATE_KEY);
      const audit = storedAudit && typeof storedAudit === "object" ? storedAudit : null;
      const nextEligible = Date.parse(String(audit?.nextEligibleRefreshAt ?? ""));
      if (Number.isFinite(nextEligible) && nextEligible > nowMs) {
        return responseJson({ ok: false, reason: "cooldown", audit });
      }
      const existingLease = await this.state.storage.get(VERIFICATION_LEASE_KEY);
      if (existingLease?.expiresAt && Number(existingLease.expiresAt) > nowMs) {
        return responseJson({ ok: false, reason: "lease", audit });
      }
      const lease = {
        token,
        claimedAt: new Date(nowMs).toISOString(),
        expiresAt: nowMs + READ_ONLY_VERIFICATION_LEASE_MS,
      };
      await this.state.storage.put(VERIFICATION_LEASE_KEY, lease);
      return responseJson({ ok: true, expiresAt: new Date(lease.expiresAt).toISOString() });
    }

    if (request.method === "POST" && url.pathname === "/release-read-only-verification") {
      let payload = {};
      try {
        payload = await request.json();
      } catch {
        return responseJson({ ok: false, error: "Invalid verification release payload" }, 400);
      }
      const token = boundedText(payload.token, 100);
      const lease = await this.state.storage.get(VERIFICATION_LEASE_KEY);
      if (token && lease?.token === token) await deleteStorageKey(this.state.storage, VERIFICATION_LEASE_KEY);
      return responseJson({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/read-only-audit") {
      let payload = {};
      try {
        payload = await request.json();
      } catch {
        return responseJson({ ok: false, error: "Invalid read-only audit payload" }, 400);
      }
      const readOnlyAudit = sanitizeStoredAudit(payload);
      await this.state.storage.put(STATUS_STATE_KEY, readOnlyAudit);
      const token = boundedText(payload.verificationToken, 100);
      const lease = await this.state.storage.get(VERIFICATION_LEASE_KEY);
      if (token && lease?.token === token) await deleteStorageKey(this.state.storage, VERIFICATION_LEASE_KEY);
      return responseJson({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/business-status") {
      let payload = {};
      try {
        payload = await request.json();
      } catch {
        return responseJson({ ok: false, error: "Invalid business status payload" }, 400);
      }
      const snapshot = payload && typeof payload === "object" ? payload : {};
      await this.state.storage.put(BUSINESS_STATUS_KEY, snapshot);
      return responseJson({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/operations-repair") {
      let payload = {};
      try {
        payload = await request.json();
      } catch {
        return responseJson({ ok: false, error: "Invalid operations repair payload" }, 400);
      }
      const repairStatus = {
        checkedAt: boundedText(payload.checkedAt, 80) || new Date().toISOString(),
        attempted: Array.isArray(payload.attempted) ? payload.attempted.map((item) => boundedText(item, 60)).filter(Boolean).slice(0, 5) : [],
        repaired: Array.isArray(payload.repaired) ? payload.repaired.map((item) => boundedText(item, 60)).filter(Boolean).slice(0, 5) : [],
        failed: Array.isArray(payload.failed) ? payload.failed.map((item) => boundedText(item, 300)).filter(Boolean).slice(0, 5) : [],
      };
      await this.state.storage.put(OPERATIONS_REPAIR_KEY, repairStatus);
      return responseJson({ ok: true });
    }

    return super.fetch(request);
  }
}

export async function collectScheduledOperationsStatus(env, now = new Date()) {
  const stub = stateStub(env);
  const currentResponse = await stub.fetch(new Request("https://social.internal/facebook-status"));
  const current = currentResponse.ok ? await currentResponse.json() : {};
  const lastSocialCollection = Date.parse(String(current.readOnlyAudit?.collectedAt ?? current.readOnlyAudit?.checkedAt ?? ""));
  if (!Number.isFinite(lastSocialCollection) || now.getTime() - lastSocialCollection >= OPERATIONS_COLLECTION_INTERVAL_MS) {
    const verificationToken = typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${now.getTime()}-${Math.random().toString(36).slice(2)}`;
    const claimResponse = await stub.fetch(new Request("https://social.internal/claim-read-only-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: verificationToken, now: now.toISOString() }),
    }));
    const claim = claimResponse.ok ? await claimResponse.json() : { ok: false };
    if (claim.ok) {
      try {
        const sampled = await runReadOnlyStatusSampler(env, current.readOnlyAudit ?? null, now, {
          lastPublishedByPlatform: current.lastPublishedByPlatform ?? {},
        });
        sampled.verificationToken = verificationToken;
        await stub.fetch(new Request("https://social.internal/read-only-audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sampled),
        }));
      } catch (error) {
        await stub.fetch(new Request("https://social.internal/release-read-only-verification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: verificationToken }),
        }));
        console.error(JSON.stringify({ event: "operations_social_collection_error", error: safeErrorMessage(error) }));
      }
    }
  }

  await syncBusinessOperationsStatus(env, stub, current.businessStatus, now);
}

async function syncBusinessOperationsStatus(env, stub, currentBusinessStatus, now = new Date(), force = false) {
  const lastBusinessSync = Date.parse(String(currentBusinessStatus?.generatedAt ?? ""));
  if (
    !env.AUDIT_SERVICE?.fetch
    || (!force && Number.isFinite(lastBusinessSync) && now.getTime() - lastBusinessSync < OPERATIONS_COLLECTION_INTERVAL_MS)
  ) return currentBusinessStatus ?? null;

  try {
    const response = await env.AUDIT_SERVICE.fetch(new Request("https://pencilproof-audit.internal/api/internal/operations-status"));
    if (!response.ok) throw new Error(`Audit operations endpoint returned HTTP ${response.status}.`);
    const businessStatus = await response.json();
    await stub.fetch(new Request("https://social.internal/business-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(businessStatus),
    }));
    return businessStatus;
  } catch (error) {
    console.error(JSON.stringify({ event: "operations_business_sync_error", error: safeErrorMessage(error) }));
    return currentBusinessStatus ?? null;
  }
}

async function mergeLiveEmailAutomationStatus(env, currentBusinessStatus) {
  if (!env.AUDIT_SERVICE?.fetch) return currentBusinessStatus ?? null;
  try {
    const response = await env.AUDIT_SERVICE.fetch(new Request("https://pencilproof-audit.internal/api/internal/automation-status"));
    if (!response.ok) throw new Error(`Audit automation endpoint returned HTTP ${response.status}.`);
    const live = await response.json();
    if (!live?.email || typeof live.email !== "object") return currentBusinessStatus ?? null;
    return {
      ...(currentBusinessStatus && typeof currentBusinessStatus === "object" ? currentBusinessStatus : {}),
      generatedAt: currentBusinessStatus?.generatedAt ?? null,
      email: {
        ...(currentBusinessStatus?.email && typeof currentBusinessStatus.email === "object" ? currentBusinessStatus.email : {}),
        automationCheckedAt: live.generatedAt ?? null,
        automation: live.email.automation ?? currentBusinessStatus?.email?.automation ?? null,
        localDeliveries: live.email.localDeliveries ?? currentBusinessStatus?.email?.localDeliveries ?? null,
      },
    };
  } catch (error) {
    console.error(JSON.stringify({ event: "operations_email_status_error", error: safeErrorMessage(error) }));
    return currentBusinessStatus ?? null;
  }
}

function heartbeatIsStale(value, now) {
  const measured = Date.parse(String(value ?? ""));
  return !Number.isFinite(measured) || now.getTime() - measured > SOCIAL_HEARTBEAT_STALE_MS;
}

export async function repairScheduledSocialAutomation(env, controller, now = new Date()) {
  const repair = { checkedAt: now.toISOString(), attempted: [], repaired: [], failed: [] };
  if (!parseBoolean(env.SOCIAL_AUTOMATION_ENABLED, true)) return repair;
  const directResponse = await directWorker.fetch(new Request("https://social.internal/status"), env);
  const directStatus = directResponse.ok ? await directResponse.json() : {};
  const facebookResponse = await stateStub(env).fetch(new Request("https://social.internal/facebook-status"));
  const facebookStatus = facebookResponse.ok ? await facebookResponse.json() : {};

  if (
    detectConfiguredPlatforms(env).length > 0
    && (heartbeatIsStale(directStatus.lastRunAt, now) || Boolean(String(directStatus.lastError ?? "").trim()))
  ) {
    repair.attempted.push("threads/instagram automation");
    try {
      await directWorker.scheduled(controller, env, { waitUntil() {} });
      repair.repaired.push("threads/instagram automation");
    } catch (error) {
      repair.failed.push(`Threads/Instagram recovery: ${safeErrorMessage(error)}`);
    }
  }
  if (
    facebookConfigured(env)
    && (heartbeatIsStale(facebookStatus.lastRunAt, now) || Boolean(String(facebookStatus.lastError ?? "").trim()))
  ) {
    repair.attempted.push("facebook automation");
    try {
      await triggerFacebookRun(env);
      repair.repaired.push("facebook automation");
    } catch (error) {
      repair.failed.push(`Facebook recovery: ${safeErrorMessage(error)}`);
    }
  }
  await stateStub(env).fetch(new Request("https://social.internal/operations-repair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(repair),
  }));
  return repair;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return responseJson({
        ok: true,
        mode: "direct-zero-cost",
        automationEnabled: parseBoolean(env.SOCIAL_AUTOMATION_ENABLED, true),
        publishEnabled: parseBoolean(env.SOCIAL_PUBLISH_ENABLED, false),
        repliesEnabled: parseBoolean(env.SOCIAL_REPLY_ENABLED, true),
        configuredPlatforms: combinedConfiguredPlatforms(env),
        paidPlatformsEnabled: false,
        auditEndpoint: "/audit",
      });
    }

    if (request.method === "GET" && (url.pathname === "/status" || url.pathname === "/status.json")) {
      const directRequest = url.pathname === "/status.json"
        ? new Request(new URL(`/status${url.search}`, request.url), request)
        : request;
      const directResponse = await directWorker.fetch(directRequest, env, ctx);
      const directStatus = directResponse.ok ? await directResponse.json() : {};
      const stub = stateStub(env);
      const facebookResponse = await stub.fetch(new Request("https://social.internal/facebook-status"));
      const facebookStatus = facebookResponse.ok ? await facebookResponse.json() : {};
      let businessStatus = facebookStatus.businessStatus ?? null;
      businessStatus = await mergeLiveEmailAutomationStatus(env, businessStatus);
      let cachedAudit = facebookStatus.readOnlyAudit && typeof facebookStatus.readOnlyAudit === "object"
        ? applyVerificationFreshness(facebookStatus.readOnlyAudit, env, new Date())
        : applyVerificationFreshness(null, env, new Date());
      if (url.searchParams.get("refresh") === "1") {
        const verificationToken = typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const claimResponse = await stub.fetch(new Request("https://social.internal/claim-read-only-verification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: verificationToken, now: new Date().toISOString() }),
        }));
        const claim = claimResponse.ok ? await claimResponse.json() : { ok: false, reason: "claim_failed" };
        if (!claim.ok) {
          cachedAudit = claim.audit && typeof claim.audit === "object"
            ? applyVerificationFreshness(claim.audit, env, new Date())
            : cachedAudit;
        } else {
          const sampledAt = new Date();
          const sampledAudit = await runReadOnlyStatusSampler(env, cachedAudit, sampledAt, {
            platform: url.searchParams.get("platform"),
            lastPublishedByPlatform: {
              ...(directStatus.lastPublishedByPlatform ?? {}),
              ...(facebookStatus.lastPublishedByPlatform ?? {}),
            },
          });
          sampledAudit.verificationToken = verificationToken;
          const saveResponse = await stub.fetch(new Request("https://social.internal/read-only-audit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sampledAudit),
          }));
          if (!saveResponse.ok) {
            await stub.fetch(new Request("https://social.internal/release-read-only-verification", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: verificationToken }),
            }));
            return responseJson({ ok: false, error: "Read-only status snapshot could not be saved." }, 502);
          }
          cachedAudit = applyVerificationFreshness(sampledAudit, env, sampledAt);
        }
        businessStatus = await syncBusinessOperationsStatus(env, stub, businessStatus, new Date(), true);
      }
      const cachedMetrics = Array.isArray(cachedAudit?.postMetrics) ? cachedAudit.postMetrics : [];
      const mergedMetrics = mergeNewestPostMetrics(
        directStatus.postMetrics,
        facebookStatus.postMetrics,
        cachedMetrics,
      ).slice(-MAX_POST_METRICS);
      const directPublishedByPlatform = directStatus.lastPublishedByPlatform ?? {};
      const facebookPublishedByPlatform = facebookStatus.lastPublishedByPlatform ?? {};
      const status = {
        ...directStatus,
        automationEnabled: parseBoolean(env.SOCIAL_AUTOMATION_ENABLED, true),
         publishEnabled: parseBoolean(env.SOCIAL_PUBLISH_ENABLED, false),
         repliesEnabled: parseBoolean(env.SOCIAL_REPLY_ENABLED, true),
         configuredPlatforms: combinedConfiguredPlatforms(env),
         readOnlyConfiguredPlatforms: readOnlyConfiguredPlatforms(env),
        lastPublishedByPlatform: {
          ...directPublishedByPlatform,
          ...facebookPublishedByPlatform,
        },
        postMetrics: mergedMetrics.filter((record) => record?.platform !== "facebook"),
         readOnlyAudit: cachedAudit,
         businessStatus,
        reporting: {
          mode: "stored-on-demand-sampler",
          collectedAt: cachedAudit?.collectedAt ?? cachedAudit?.checkedAt ?? null,
          selectedPlatform: cachedAudit?.selectedPlatform ?? null,
          nextPlatform: cachedAudit?.nextPlatform ?? null,
          nextEligibleRefreshAt: cachedAudit?.nextEligibleRefreshAt ?? null,
          providerRequestsUsed: Number(cachedAudit?.providerRequestsUsed ?? cachedAudit?.requestsUsed ?? 0),
          requestsUsed: Number(cachedAudit?.providerRequestsUsed ?? cachedAudit?.requestsUsed ?? 0),
          requestBudget: Number(cachedAudit?.requestBudget ?? READ_ONLY_REQUEST_BUDGET),
          postRecords: mergedMetrics.length,
          errors: Array.isArray(cachedAudit?.errors) ? cachedAudit.errors : [],
        },
        facebook: {
          configured: facebookConfigured(env),
          lastRunAt: facebookStatus.lastRunAt ?? null,
          lastPostAt: facebookStatus.lastPostAt ?? null,
          lastError: facebookStatus.lastError ?? null,
          lastPublishedByPlatform: facebookPublishedByPlatform,
          postMetrics: mergedMetrics.filter((record) => record?.platform === "facebook"),
          counters: facebookStatus.counters ?? null,
          lastSummary: facebookStatus.lastSummary
            ? {
                postsScanned: facebookStatus.lastSummary.postsScanned ?? 0,
                commentsScanned: facebookStatus.lastSummary.commentsScanned ?? 0,
                repliesPosted: facebookStatus.lastSummary.repliesPosted ?? 0,
                commentsIgnored: facebookStatus.lastSummary.commentsIgnored ?? 0,
                postPublished: facebookStatus.lastSummary.postPublished ?? false,
                contentPlans: facebookStatus.lastSummary.contentPlans ?? [],
                contentFallbacks: facebookStatus.lastSummary.contentFallbacks ?? 0,
                aiCalls: facebookStatus.lastSummary.aiCalls ?? 0,
                warningCount: Array.isArray(facebookStatus.lastSummary.warnings)
                  ? facebookStatus.lastSummary.warnings.length
                  : 0,
              }
            : null,
        },
      };
      const operations = buildOperationsSnapshot({
        directStatus,
        facebookStatus,
        socialAudit: cachedAudit,
        businessStatus,
        env,
        now: new Date(),
      });
      if (url.pathname !== "/status.json" && wantsHtmlStatus(request)) return operationsStatusPage(operations);
      return responseJson(operations);
    }

    if (request.method === "GET" && url.pathname === "/audit") {
      const response = await stateStub(env).fetch(new Request("https://social.internal/facebook-status"));
      const facebookStatus = response.ok ? await response.json() : {};
      const audit = facebookStatus.readOnlyAudit && typeof facebookStatus.readOnlyAudit === "object"
         ? applyVerificationFreshness(facebookStatus.readOnlyAudit, env, new Date())
        : {
            ok: false,
            mode: "read-only-on-demand-sampler",
            collectedAt: null,
            providerRequestsUsed: 0,
            requestsUsed: 0,
            requestBudget: READ_ONLY_REQUEST_BUDGET,
            errors: ["No stored read-only sample exists yet."],
            sideEffects: [],
          };
      return responseJson(audit, audit.ok === false && !audit.collectedAt ? 503 : 200);
    }

    return directWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (controller.cron === OPERATIONS_COLLECTION_CRON) {
      const now = new Date(controller.scheduledTime ?? Date.now());
      await repairScheduledSocialAutomation(env, controller, now);
      await collectScheduledOperationsStatus(env, now);
      return;
    }

    if (!parseBoolean(env.SOCIAL_AUTOMATION_ENABLED, true)) {
      console.log(JSON.stringify({ event: "social_meta_skipped", reason: "disabled" }));
      return;
    }

    try {
      await directWorker.scheduled(controller, env, ctx);
    } catch (error) {
      console.error(JSON.stringify({ event: "social_direct_child_error", error: safeErrorMessage(error) }));
    }

    if (!facebookConfigured(env)) {
      console.log(JSON.stringify({ event: "social_facebook_skipped", reason: "missing_page_credentials" }));
    } else {
      await triggerFacebookRun(env);
    }

  },
};
