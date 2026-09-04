import { publicPilotUrl, routePostToPilot } from "./campaign-links.mjs";
import {
  mergePostMetrics,
  parseMetricPayloadDetails,
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

const STATE_KEY = "social-direct-v1";
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
const DEFAULT_MAX_POSTS_PER_DAY = 1;
const DEFAULT_ACTIVE_START_HOUR = 8;
const DEFAULT_ACTIVE_END_HOUR = 19;
const DEFAULT_TIMEZONE = "America/Los_Angeles";
const DEFAULT_MODEL = "@cf/meta/llama-3.2-1b-instruct";
const DEFAULT_AI_CALLS_PER_DAY = 12;
const DEFAULT_THREADS_AI_CALLS_PER_DAY = 200;
const DEFAULT_INSTAGRAM_AI_CALLS_PER_DAY = 400;
const DEFAULT_META_API_VERSION = "v24.0";
const DEFAULT_LINKEDIN_API_VERSION = "202604";

const PLATFORM_ORDER = ["bluesky", "threads", "instagram", "linkedin"];
const AUTO_PUBLISH_SUPPORTED = new Set(PLATFORM_ORDER);
const REPLY_SUPPORTED = new Set(PLATFORM_ORDER);

const BRAND_CONTEXT = `PencilProof is a privacy-first educational car-finance Full Quote Audit. It helps a buyer rebuild a dealer quote, compare payment with and without optional products, understand APR and trade-equity differences, and prepare questions for the dealership. PencilProof is not a broker, lender, law firm, financial adviser, or negotiating service. It does not contact dealerships. Users should verify figures with the dealer and lender before signing.`;

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

export function parseBoolean(value, fallback = false) {
  if (typeof value !== "string") return fallback;
  if (/^(1|true|yes|on)$/i.test(value.trim())) return true;
  if (/^(0|false|no|off)$/i.test(value.trim())) return false;
  return fallback;
}

export function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function normalizePlatform(value) {
  const platform = String(value ?? "").trim().toLowerCase();
  if (platform === "x" || platform === "x/twitter") return "twitter";
  if (platform === "facebook pages" || platform === "facebook_page") return "facebook";
  if (platform === "linked-in") return "linkedin";
  return platform;
}

export function uniquePlatforms(values) {
  return [...new Set((values ?? []).map(normalizePlatform).filter(Boolean))];
}

export function detectConfiguredPlatforms(env = {}) {
  const platforms = [];
  if (String(env.BLUESKY_HANDLE ?? "").trim() && String(env.BLUESKY_APP_PASSWORD ?? "").trim()) {
    platforms.push("bluesky");
  }
  if (String(env.THREADS_ACCESS_TOKEN ?? "").trim()) {
    platforms.push("threads");
  }
  if (String(env.INSTAGRAM_ACCESS_TOKEN ?? "").trim() && String(env.INSTAGRAM_USER_ID ?? "").trim()) {
    platforms.push("instagram");
  }
  if (String(env.LINKEDIN_ACCESS_TOKEN ?? "").trim() && String(env.LINKEDIN_AUTHOR_URN ?? "").trim()) {
    platforms.push("linkedin");
  }
  return platforms;
}

export function pickPublishPlatforms(activePlatforms, requestedPlatforms = []) {
  const active = uniquePlatforms(activePlatforms);
  const requested = uniquePlatforms(requestedPlatforms);
  const allowed = requested.length ? new Set(requested) : null;
  return active.filter((platform) => AUTO_PUBLISH_SUPPORTED.has(platform) && (!allowed || allowed.has(platform)));
}

export function localClockParts(now, timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hour: Number.parseInt(map.hour, 10),
  };
}

export function isWithinActiveHours(now, timeZone, startHour, endHour) {
  const { hour } = localClockParts(now, timeZone);
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

export function shouldPublishNow({
  now,
  lastPostAt,
  intervalHours,
  timeZone,
  activeStartHour,
  activeEndHour,
  postsToday,
  maxPostsPerDay = DEFAULT_MAX_POSTS_PER_DAY,
}) {
  if (postsToday >= maxPostsPerDay) return false;
  if (!isWithinActiveHours(now, timeZone, activeStartHour, activeEndHour)) return false;
  if (!lastPostAt) return true;
  const last = Date.parse(lastPostAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= intervalHours * 60 * 60 * 1000;
}

export function commentKey(comment) {
  return `${normalizePlatform(comment.platform)}:${String(comment.commentId ?? "")}`;
}

export function isLikelyOwnComment(comment, ownHandles, ownCommentIds) {
  if (comment?.isOwn === true) return true;
  const id = String(comment?.commentId ?? "");
  if (ownCommentIds.has(id)) return true;
  const normalizedUser = String(comment?.username ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!normalizedUser) return false;
  return ownHandles.has(normalizedUser);
}

export function trimUnique(values, max) {
  const seen = new Set();
  const output = [];
  for (let i = values.length - 1; i >= 0 && output.length < max; i -= 1) {
    const value = values[i];
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output.reverse();
}

function emptyState() {
  return {
    version: 2,
    lastRunAt: null,
    lastPostAt: null,
    lastPostId: null,
    lastError: null,
    counters: { date: null, posts: 0, postsByPlatform: {}, replies: 0, aiCalls: 0, aiCallsByPlatform: {} },
    seenComments: [],
    repliedComments: [],
    ownCommentIds: [],
    recentPosts: [],
    postMetrics: [],
    publishedKeys: [],
    lastPublishedByPlatform: {},
    lastPostAtByPlatform: {},
    contentHistoryByPlatform: { threads: [], instagram: [] },
    lastSummary: null,
  };
}

function normalizeState(value) {
  const state = value && typeof value === "object" ? value : {};
  const normalized = {
    ...emptyState(),
    ...state,
    counters: {
      ...emptyState().counters,
      ...(state.counters && typeof state.counters === "object" ? state.counters : {}),
      postsByPlatform: state.counters?.postsByPlatform && typeof state.counters.postsByPlatform === "object"
        ? state.counters.postsByPlatform
        : {},
      aiCallsByPlatform: state.counters?.aiCallsByPlatform && typeof state.counters.aiCallsByPlatform === "object"
        ? state.counters.aiCallsByPlatform
        : {},
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
    lastPostAtByPlatform: state.lastPostAtByPlatform && typeof state.lastPostAtByPlatform === "object"
      ? state.lastPostAtByPlatform
      : {},
    contentHistoryByPlatform: {
      ...emptyState().contentHistoryByPlatform,
      ...(state.contentHistoryByPlatform && typeof state.contentHistoryByPlatform === "object" ? state.contentHistoryByPlatform : {}),
      threads: Array.isArray(state.contentHistoryByPlatform?.threads) ? state.contentHistoryByPlatform.threads : [],
      instagram: Array.isArray(state.contentHistoryByPlatform?.instagram) ? state.contentHistoryByPlatform.instagram : [],
    },
  };
  for (const platform of ["threads", "instagram"]) {
    if (!normalized.lastPostAtByPlatform[platform] && normalized.lastPublishedByPlatform[platform]?.at) {
      normalized.lastPostAtByPlatform[platform] = normalized.lastPublishedByPlatform[platform].at;
    }
    if (!normalized.contentHistoryByPlatform[platform].length) {
      normalized.contentHistoryByPlatform[platform] = normalized.recentPosts
        .filter((item) => item?.platform === platform || item?.platform === "multi")
        .map((item) => ({ platform, post: String(item.post ?? ""), created: item.created ?? null }));
    }
    if (normalized.counters.postsByPlatform[platform] == null && normalized.counters.date) {
      const prefix = `${normalized.counters.date}:${platform}:`;
      const migratedCount = normalized.publishedKeys.filter((key) => String(key).startsWith(prefix)).length;
      if (migratedCount > 0) normalized.counters.postsByPlatform[platform] = migratedCount;
    }
  }
  return normalized;
}

function responseJson(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message.slice(0, 500) : String(error ?? "Unknown error").slice(0, 500);
}

function numericMetric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function errorDetail(payload, fallback) {
  if (typeof payload?.message === "string") return payload.message;
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  if (typeof payload?.error?.error === "string") return payload.error.error;
  return fallback;
}

async function fetchJson(url, init = {}, label = "request") {
  const response = await fetch(url, init);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(`${label} failed: ${errorDetail(payload, `HTTP ${response.status}`)}`);
  }
  return { payload: payload ?? {}, response };
}

function bearerHeaders(token, extra = {}) {
  return new Headers({ Authorization: `Bearer ${token}`, ...extra });
}

function configuredRequestedPublishPlatforms(env) {
  return uniquePlatforms(String(env.SOCIAL_PUBLISH_PLATFORMS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
}

function ownHandles(env) {
  return new Set(
    String(env.SOCIAL_OWN_HANDLES ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  );
}

function resetDailyCounters(state, now, timeZone) {
  const { date } = localClockParts(now, timeZone);
  if (state.counters.date !== date) {
    state.counters = { date, posts: 0, postsByPlatform: {}, replies: 0, aiCalls: 0, aiCallsByPlatform: {} };
  } else if (Object.keys(state.counters.aiCallsByPlatform ?? {}).length === 0 && state.counters.aiCalls > 0) {
    // Preserve today's legacy aggregate usage conservatively during migration.
    const legacyCalls = clampInteger(state.counters.aiCalls, 0, 0, 100000);
    state.counters.aiCallsByPlatform = { threads: legacyCalls, instagram: legacyCalls };
  }
}

function aiCallLimit(env, platform) {
  if (platform === "threads") {
    return clampInteger(env.SOCIAL_THREADS_AI_MAX_CALLS_PER_DAY, DEFAULT_THREADS_AI_CALLS_PER_DAY, 0, 200);
  }
  if (platform === "instagram") {
    return clampInteger(env.SOCIAL_INSTAGRAM_AI_MAX_CALLS_PER_DAY, DEFAULT_INSTAGRAM_AI_CALLS_PER_DAY, 0, 400);
  }
  return clampInteger(env.SOCIAL_AI_MAX_CALLS_PER_DAY, DEFAULT_AI_CALLS_PER_DAY, 0, 400);
}

function reserveAiCall(env, state, platform = "") {
  const key = normalizePlatform(platform) || "direct";
  const used = Number.isFinite(Number(state.counters.aiCallsByPlatform?.[key]))
    ? Number(state.counters.aiCallsByPlatform[key])
    : Number(state.counters.aiCalls ?? 0);
  const max = aiCallLimit(env, key);
  if (used >= max) {
    throw new Error(`${key} AI daily cap reached; skipping until the next local day`);
  }
  state.counters.aiCallsByPlatform[key] = used + 1;
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

async function aiJson(env, state, system, user, maxTokens = 320, platform = "") {
  if (!env.AI?.run) throw new Error("Workers AI binding is not configured");
  reserveAiCall(env, state, platform);
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

async function decideReply(env, state, comment) {
  const system = `You write concise social replies for PencilProof. ${BRAND_CONTEXT}\n\nReturn JSON only: {"action":"reply"|"ignore","reply":"...","reason":"..."}. Reply only when the person is genuinely engaging with a PencilProof post or asking a relevant car-finance/dealer-quote question. Ignore spam, bait, harassment, politics, unrelated comments, legal disputes, credit-repair requests, requests for individualized legal/financial advice, and anything that would require seeing private paperwork. Never ask for SSNs, account numbers, DOB, addresses, or other sensitive personal data. Never claim PencilProof can negotiate, contact the dealer, guarantee savings, or give legal/financial advice. If replying, answer the question directly, invite one useful follow-up question, and include the tracked free-review link only when it naturally helps. Keep the reply under 350 characters, use no hashtags, and avoid hard selling.`;
  const user = `Platform: ${comment.platform}\nParent post: ${String(comment.postText ?? "").slice(0, 800)}\nComment by ${comment.username || "unknown"}: ${String(comment.text ?? "").slice(0, 1200)}\nTracked free-review link: ${publicPilotUrl(comment.platform, "reply-qa")}`;
  const parsed = await aiJson(env, state, system, user, 240, comment.platform);
  const action = parsed?.action === "reply" ? "reply" : "ignore";
  const reply = typeof parsed?.reply === "string" ? parsed.reply.trim().slice(0, 500) : "";
  return {
    action: action === "reply" && reply ? "reply" : "ignore",
    reply,
    reason: typeof parsed?.reason === "string" ? parsed.reason.slice(0, 200) : "",
  };
}

async function generatePost(env, state, platform, now = new Date()) {
  const history = contentHistoryForPlatform(state, platform);
  const primaryPlan = selectContentPlan(now, platform, history);
  const attempt = async (plan, promptHistory = history) => {
    const parsed = await aiJson(
      env,
      state,
      `You are the content engine for PencilProof. ${BRAND_CONTEXT}\n\n${contentPrompt(platform, plan, promptHistory)}`,
      `Assigned platform: ${platform}\nAssigned content plan: ${JSON.stringify(plan)}\nCreate the post now.`,
      platform === "threads" ? 800 : 1400,
      platform,
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

  const rewriteHistory = [...history, { ...primaryPlan, post: firstDraft }];
  const rewritePlan = selectContentPlan(new Date(new Date(now).getTime() + 86400000), platform, rewriteHistory);
  try {
    const rewrittenDraft = await attempt(rewritePlan, rewriteHistory);
    const rewrittenValidation = validateSocialPost(rewrittenDraft, rewritePlan, history, platform);
    if (rewrittenValidation.ok) {
      return { post: rewrittenDraft, plan: rewritePlan, validation: rewrittenValidation, rewritten: true, fallback: false };
    }
  } catch (error) {
    if (!safeErrorMessage(error).includes("AI returned invalid JSON")) throw error;
  }

  const fallback = buildFallbackPost(rewritePlan, platform, history);
  const fallbackValidation = validateSocialPost(fallback, rewritePlan, history, platform);
  if (!fallbackValidation.ok) throw new Error(`Content fallback failed validation: ${fallbackValidation.reasons.join(", ")}`);
  return { post: fallback, plan: rewritePlan, validation: fallbackValidation, rewritten: true, fallback: true };
}

// Bluesky -------------------------------------------------------------------

function blueskyPds(env) {
  return String(env.BLUESKY_PDS_URL ?? "https://bsky.social").trim().replace(/\/$/, "");
}

async function getBlueskySession(env, runtime) {
  if (runtime.blueskySession) return runtime.blueskySession;
  const { payload } = await fetchJson(`${blueskyPds(env)}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: String(env.BLUESKY_HANDLE ?? "").trim(),
      password: String(env.BLUESKY_APP_PASSWORD ?? "").trim(),
    }),
  }, "Bluesky login");
  if (!payload.accessJwt || !payload.did) throw new Error("Bluesky login returned an incomplete session");
  runtime.blueskySession = payload;
  return payload;
}

async function getBlueskyRecentPosts(env, runtime, limit = 10) {
  const session = await getBlueskySession(env, runtime);
  const params = new URLSearchParams({ actor: String(env.BLUESKY_HANDLE).trim(), limit: String(limit) });
  const { payload } = await fetchJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?${params}`, {}, "Bluesky author feed");
  return (Array.isArray(payload.feed) ? payload.feed : [])
    .map((item) => item?.post)
    .filter((post) => post?.uri && post?.cid && post?.author?.did === session.did)
    .map((post) => ({
      platform: "bluesky",
      id: post.uri,
      cid: post.cid,
      post: String(post.record?.text ?? ""),
      created: String(post.record?.createdAt ?? post.indexedAt ?? ""),
      postUrl: post.author?.handle && post.uri ? `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split("/").pop()}` : "",
      likeCount: numericMetric(post.likeCount),
      replyCount: numericMetric(post.replyCount),
      repostCount: numericMetric(post.repostCount),
      quoteCount: numericMetric(post.quoteCount),
    }));
}

async function getBlueskyComments(env, runtime, post) {
  const session = await getBlueskySession(env, runtime);
  const params = new URLSearchParams({ uri: post.id, depth: "4", parentHeight: "0" });
  const { payload } = await fetchJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?${params}`, {}, "Bluesky thread");
  const comments = [];
  const visit = (node, depth = 0) => {
    if (!node?.post?.uri || node.post.uri === post.id) {
      for (const reply of Array.isArray(node?.replies) ? node.replies : []) visit(reply, depth + 1);
      return;
    }
    comments.push({
      platform: "bluesky",
      postId: post.id,
      postCid: post.cid,
      postText: post.post,
      postUrl: post.postUrl,
      commentId: node.post.uri,
      commentCid: node.post.cid,
      text: String(node.post.record?.text ?? ""),
      username: String(node.post.author?.handle ?? ""),
      authorId: String(node.post.author?.did ?? ""),
      created: String(node.post.record?.createdAt ?? node.post.indexedAt ?? ""),
      depth,
      isOwn: node.post.author?.did === session.did,
    });
    for (const reply of Array.isArray(node.replies) ? node.replies : []) visit(reply, depth + 1);
  };
  visit(payload.thread, -1);
  return comments;
}

async function createBlueskyRecord(env, runtime, record) {
  const session = await getBlueskySession(env, runtime);
  const { payload } = await fetchJson(`${blueskyPds(env)}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: bearerHeaders(session.accessJwt, { "Content-Type": "application/json" }),
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
  }, "Bluesky create post");
  return payload;
}

async function publishBluesky(env, runtime, text) {
  return createBlueskyRecord(env, runtime, {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
  });
}

async function replyBluesky(env, runtime, comment, text) {
  return createBlueskyRecord(env, runtime, {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    reply: {
      root: { uri: comment.postId, cid: comment.postCid },
      parent: { uri: comment.commentId, cid: comment.commentCid },
    },
  });
}

// Threads -------------------------------------------------------------------

function threadsHost(env) {
  return String(env.THREADS_API_HOST ?? "https://graph.threads.net").trim().replace(/\/$/, "");
}

function threadsToken(env) {
  return String(env.THREADS_ACCESS_TOKEN ?? "").trim();
}

async function getThreadsRecentPosts(env, _runtime, limit = 10) {
  const params = new URLSearchParams({ fields: "id,text,timestamp,permalink,is_reply", limit: String(limit) });
  const { payload } = await fetchJson(`${threadsHost(env)}/me/threads?${params}`, {
    headers: bearerHeaders(threadsToken(env)),
  }, "Threads posts");
  return (Array.isArray(payload.data) ? payload.data : [])
    .filter((item) => item?.id && item?.is_reply !== true)
    .map((item) => ({
      platform: "threads",
      id: String(item.id),
      post: String(item.text ?? ""),
      created: String(item.timestamp ?? ""),
      postUrl: String(item.permalink ?? ""),
    }));
}

async function getThreadsComments(env, _runtime, post) {
  const params = new URLSearchParams({
    fields: "id,text,timestamp,username,is_reply_owned_by_me,permalink",
    reverse: "false",
    limit: "50",
  });
  const { payload } = await fetchJson(`${threadsHost(env)}/${encodeURIComponent(post.id)}/replies?${params}`, {
    headers: bearerHeaders(threadsToken(env)),
  }, "Threads replies");
  return (Array.isArray(payload.data) ? payload.data : []).filter((item) => item?.id && item?.text).map((item) => ({
    platform: "threads",
    postId: post.id,
    postText: post.post,
    postUrl: post.postUrl,
    commentId: String(item.id),
    text: String(item.text),
    username: String(item.username ?? ""),
    created: String(item.timestamp ?? ""),
    depth: 0,
    isOwn: item.is_reply_owned_by_me === true,
  }));
}

async function createThreadsText(env, text, replyToId = "") {
  const params = new URLSearchParams({ media_type: "TEXT", text, auto_publish_text: "true" });
  if (replyToId) params.set("reply_to_id", replyToId);
  const { payload } = await fetchJson(`${threadsHost(env)}/me/threads?${params}`, {
    method: "POST",
    headers: bearerHeaders(threadsToken(env)),
  }, replyToId ? "Threads reply" : "Threads publish");
  return payload;
}

async function publishThreads(env, _runtime, text) {
  return createThreadsText(env, text);
}

async function replyThreads(env, _runtime, comment, text) {
  return createThreadsText(env, text, comment.commentId);
}

// Instagram -----------------------------------------------------------------

function metaApiVersion(env) {
  const value = String(env.META_API_VERSION ?? DEFAULT_META_API_VERSION).trim();
  return value.startsWith("v") ? value : `v${value}`;
}

function instagramHost(env) {
  return String(env.INSTAGRAM_API_HOST ?? "https://graph.instagram.com").trim().replace(/\/$/, "");
}

function instagramToken(env) {
  return String(env.INSTAGRAM_ACCESS_TOKEN ?? "").trim();
}

async function getInstagramRecentPosts(env, _runtime, limit = 10) {
  const userId = String(env.INSTAGRAM_USER_ID ?? "").trim();
  const params = new URLSearchParams({ fields: "id,caption,timestamp,permalink,media_type,media_product_type", limit: String(limit) });
  const { payload } = await fetchJson(`${instagramHost(env)}/${metaApiVersion(env)}/${encodeURIComponent(userId)}/media?${params}`, {
    headers: bearerHeaders(instagramToken(env)),
  }, "Instagram media");
  return (Array.isArray(payload.data) ? payload.data : []).filter((item) => item?.id).map((item) => ({
    platform: "instagram",
    id: String(item.id),
    post: String(item.caption ?? ""),
    created: String(item.timestamp ?? ""),
    postUrl: String(item.permalink ?? ""),
    mediaType: String(item.media_type ?? ""),
    mediaProductType: String(item.media_product_type ?? ""),
  }));
}

async function getInstagramComments(env, _runtime, post) {
  const params = new URLSearchParams({ fields: "from,text", limit: "50" });
  const { payload } = await fetchJson(`${instagramHost(env)}/${metaApiVersion(env)}/${encodeURIComponent(post.id)}/comments?${params}`, {
    headers: bearerHeaders(instagramToken(env)),
  }, "Instagram comments");
  const ownUserId = String(env.INSTAGRAM_USER_ID ?? "").trim();
  return (Array.isArray(payload.data) ? payload.data : []).filter((item) => item?.id && item?.text).map((item) => ({
    platform: "instagram",
    postId: post.id,
    postText: post.post,
    postUrl: post.postUrl,
    commentId: String(item.id),
    text: String(item.text),
    username: String(item.from?.username ?? ""),
    authorId: String(item.from?.id ?? ""),
    created: "",
    depth: 0,
    isOwn: String(item.from?.id ?? "") === ownUserId,
  }));
}

async function publishInstagram(env, _runtime, text) {
  const imageUrl = String(env.INSTAGRAM_IMAGE_URL ?? "").trim();
  if (!imageUrl) throw new Error("INSTAGRAM_IMAGE_URL is required for Instagram publishing");
  const userId = String(env.INSTAGRAM_USER_ID ?? "").trim();
  const createParams = new URLSearchParams({ image_url: imageUrl, caption: text });
  const { payload: container } = await fetchJson(`${instagramHost(env)}/${metaApiVersion(env)}/${encodeURIComponent(userId)}/media?${createParams}`, {
    method: "POST",
    headers: bearerHeaders(instagramToken(env)),
  }, "Instagram media container");
  if (!container.id) throw new Error("Instagram did not return a media container ID");
  const statusParams = new URLSearchParams({ fields: "status_code,status" });
  let mediaStatus = "";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { payload: status } = await fetchJson(`${instagramHost(env)}/${metaApiVersion(env)}/${encodeURIComponent(container.id)}?${statusParams}`, {
      headers: bearerHeaders(instagramToken(env)),
    }, "Instagram media container status");
    mediaStatus = String(status?.status_code ?? status?.status ?? "").trim().toUpperCase();
    if (!mediaStatus || mediaStatus === "FINISHED") break;
    if (["ERROR", "EXPIRED"].includes(mediaStatus)) {
      throw new Error(`Instagram media container ${mediaStatus.toLowerCase()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (mediaStatus && mediaStatus !== "FINISHED") {
    throw new Error(`Instagram media container was not ready after polling: ${mediaStatus}`);
  }
  const publishParams = new URLSearchParams({ creation_id: String(container.id) });
  const { payload } = await fetchJson(`${instagramHost(env)}/${metaApiVersion(env)}/${encodeURIComponent(userId)}/media_publish?${publishParams}`, {
    method: "POST",
    headers: bearerHeaders(instagramToken(env)),
  }, "Instagram publish");
  return payload;
}

async function replyInstagram(env, _runtime, comment, text) {
  const { payload } = await fetchJson(`${instagramHost(env)}/${metaApiVersion(env)}/${encodeURIComponent(comment.commentId)}/replies`, {
    method: "POST",
    headers: bearerHeaders(instagramToken(env), { "Content-Type": "application/json" }),
    body: JSON.stringify({ message: text }),
  }, "Instagram reply");
  return payload;
}

// LinkedIn ------------------------------------------------------------------

function linkedinToken(env) {
  return String(env.LINKEDIN_ACCESS_TOKEN ?? "").trim();
}

function linkedinAuthor(env) {
  return String(env.LINKEDIN_AUTHOR_URN ?? "").trim();
}

function linkedinHeaders(env, extra = {}) {
  return bearerHeaders(linkedinToken(env), {
    "Linkedin-Version": String(env.LINKEDIN_API_VERSION ?? DEFAULT_LINKEDIN_API_VERSION).trim(),
    "X-Restli-Protocol-Version": "2.0.0",
    ...extra,
  });
}

async function getLinkedInRecentPosts(env, _runtime, limit = 10) {
  const params = new URLSearchParams({
    author: linkedinAuthor(env),
    q: "author",
    count: String(limit),
    sortBy: "CREATED",
    viewContext: "AUTHOR",
  });
  const { payload } = await fetchJson(`https://api.linkedin.com/rest/posts?${params}`, {
    headers: linkedinHeaders(env, { "X-RestLi-Method": "FINDER" }),
  }, "LinkedIn posts");
  return (Array.isArray(payload.elements) ? payload.elements : []).filter((item) => item?.id).map((item) => ({
    platform: "linkedin",
    id: String(item.id),
    post: String(item.commentary ?? ""),
    created: Number.isFinite(item.createdAt) ? new Date(item.createdAt).toISOString() : "",
    postUrl: "",
  }));
}

async function getLinkedInComments(env, _runtime, post) {
  const target = encodeURIComponent(post.id);
  const { payload } = await fetchJson(`https://api.linkedin.com/rest/socialActions/${target}/comments`, {
    headers: linkedinHeaders(env),
  }, "LinkedIn comments");
  const author = linkedinAuthor(env);
  return (Array.isArray(payload.elements) ? payload.elements : []).filter((item) => item?.id && item?.message?.text).map((item) => ({
    platform: "linkedin",
    postId: post.id,
    postText: post.post,
    postUrl: post.postUrl,
    commentId: String(item.id),
    commentUrn: String(item.commentUrn ?? ""),
    objectUrn: String(item.object ?? post.id),
    text: String(item.message.text),
    username: String(item.actor ?? ""),
    authorId: String(item.actor ?? ""),
    created: Number.isFinite(item.created?.time) ? new Date(item.created.time).toISOString() : "",
    depth: item.parentComment ? 1 : 0,
    isOwn: String(item.actor ?? "") === author,
  }));
}

async function publishLinkedIn(env, _runtime, text) {
  const { payload, response } = await fetchJson("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: linkedinHeaders(env, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      author: linkedinAuthor(env),
      commentary: text,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  }, "LinkedIn publish");
  return { ...payload, id: response.headers.get("x-restli-id") || payload.id || "" };
}

async function replyLinkedIn(env, _runtime, comment, text) {
  const target = comment.commentUrn || `urn:li:comment:(${comment.objectUrn},${comment.commentId})`;
  const { payload, response } = await fetchJson(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(target)}/comments`, {
    method: "POST",
    headers: linkedinHeaders(env, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      actor: linkedinAuthor(env),
      object: comment.objectUrn || comment.postId,
      message: { text },
      parentComment: target,
    }),
  }, "LinkedIn reply");
  return {
    ...payload,
    id: response.headers.get("x-restli-id") || response.headers.get("x-resourceidentity-urn") || payload.id || "",
  };
}

// Adapter dispatch -----------------------------------------------------------

async function getRecentPlatformPosts(env, runtime, platform, limit) {
  if (platform === "bluesky") return getBlueskyRecentPosts(env, runtime, limit);
  if (platform === "threads") return getThreadsRecentPosts(env, runtime, limit);
  if (platform === "instagram") return getInstagramRecentPosts(env, runtime, limit);
  if (platform === "linkedin") return getLinkedInRecentPosts(env, runtime, limit);
  return [];
}

async function getDirectPostMetrics(env, platform, post, now = new Date()) {
  try {
    if (platform === "threads") {
      const params = new URLSearchParams({ metric: "views,likes,replies,reposts,quotes" });
      const source = `${threadsHost(env)}/${encodeURIComponent(post.id)}/insights`;
      const { payload } = await fetchJson(`${source}?${params}`, {
        headers: bearerHeaders(threadsToken(env)),
      }, "Threads post insights");
      const details = parseMetricPayloadDetails(payload, source);
      const interactionParts = [details.metrics.likes, details.metrics.replies, details.metrics.reposts, details.metrics.quotes]
        .filter((value) => typeof value === "number" && Number.isFinite(value));
      const metrics = {
        ...details.metrics,
        engagement: interactionParts.length ? interactionParts.reduce((sum, value) => sum + value, 0) : details.metrics.engagement,
      };
      const observations = { ...details.observations };
      if (metrics.engagement !== null && metrics.engagement !== undefined && !details.observations.engagement) {
        observations.engagement = {
          kind: "derived",
          formula: "likes + replies + reposts + quotes",
          source,
        };
      }
      return postMetricsRecord({ platform, post, metrics, rawMetrics: details.rawMetrics, observations, source, fetchedAt: now.toISOString() });
    }

    if (platform === "instagram") {
      const source = `${instagramHost(env)}/${metaApiVersion(env)}/${encodeURIComponent(post.id)}`;
      const summaryParams = new URLSearchParams({ fields: "like_count,comments_count" });
      const { payload } = await fetchJson(`${source}?${summaryParams}`, {
        headers: bearerHeaders(instagramToken(env)),
      }, "Instagram post summary");
      const likes = numericMetric(payload?.like_count);
      const comments = numericMetric(payload?.comments_count);
      const interactionParts = [likes, comments].filter((value) => value !== null);
      const engagement = interactionParts.length ? interactionParts.reduce((sum, value) => sum + value, 0) : null;
      return postMetricsRecord({
        platform,
        post,
        metrics: { likes, comments, engagement },
        rawMetrics: { like_count: likes, comments_count: comments },
        observations: {
          likes: { providerMetric: "like_count", source },
          comments: { providerMetric: "comments_count", source },
          engagement: { kind: "derived", formula: "like_count + comments_count", source },
        },
        source,
        fetchedAt: now.toISOString(),
      });
    }

    if (platform === "bluesky") {
      const source = "Bluesky author feed";
      const interactionParts = [post.likeCount, post.replyCount, post.repostCount, post.quoteCount]
        .filter((value) => typeof value === "number" && Number.isFinite(value));
      return postMetricsRecord({
        platform,
        post,
        metrics: {
          likes: post.likeCount,
          replies: post.replyCount,
          reposts: post.repostCount,
          quotes: post.quoteCount,
          engagement: interactionParts.length ? interactionParts.reduce((sum, value) => sum + value, 0) : null,
        },
        rawMetrics: {
          likeCount: post.likeCount,
          replyCount: post.replyCount,
          repostCount: post.repostCount,
          quoteCount: post.quoteCount,
        },
        observations: {
          likes: { providerMetric: "likeCount", source },
          replies: { providerMetric: "replyCount", source },
          reposts: { providerMetric: "repostCount", source },
          quotes: { providerMetric: "quoteCount", source },
          engagement: { kind: "derived", formula: "likeCount + replyCount + repostCount + quoteCount", source },
        },
        source,
        fetchedAt: now.toISOString(),
      });
    }

    if (platform === "linkedin") {
      return postMetricsRecord({
        platform,
        post,
        fetchedAt: now.toISOString(),
        error: "LinkedIn post insights are not enabled in this integration.",
      });
    }

    return postMetricsRecord({ platform, post, fetchedAt: now.toISOString(), error: "No metrics adapter is configured." });
  } catch (error) {
    return postMetricsRecord({ platform, post, fetchedAt: now.toISOString(), error: safeErrorMessage(error) });
  }
}

export async function runDirectReadOnlyAudit(env, now = new Date(), options = {}) {
  const runtime = { blueskySession: null };
  const results = {};
  const configuredPlatforms = detectConfiguredPlatforms(env);
  const requestedPlatforms = Array.isArray(options.platforms) && options.platforms.length
    ? options.platforms
      .map((platform) => normalizePlatform(platform))
      .filter((platform, index, list) => platform && list.indexOf(platform) === index)
    : configuredPlatforms;
  let requestsUsed = 0;
  for (const platform of requestedPlatforms) {
    if (!configuredPlatforms.includes(platform)) {
      results[platform] = { configured: false, apiReachable: false, recentPostCount: 0, latestRemotePostAt: null, postMetrics: [] };
      continue;
    }
    try {
      const posts = await getRecentPlatformPosts(env, runtime, platform, 1);
      requestsUsed += 1;
      const latestPost = posts[0] ?? null;
      const postMetrics = latestPost ? [await getDirectPostMetrics(env, platform, latestPost, now)] : [];
      if (latestPost) requestsUsed += 1;
      results[platform] = {
        configured: true,
        apiReachable: true,
        recentPostCount: posts.length,
        latestRemotePostAt: posts
          .map((post) => String(post.created ?? ""))
          .filter(Boolean)
          .sort()
          .at(-1) ?? null,
        postMetrics,
      };
    } catch (error) {
      results[platform] = {
        configured: true,
        apiReachable: false,
        recentPostCount: 0,
        latestRemotePostAt: null,
        error: safeErrorMessage(error),
      };
    }
  }
  return { checkedAt: now.toISOString(), platforms: results, requestsUsed, requestBudget: 2 };
}

async function getPostComments(env, runtime, platform, post) {
  if (platform === "bluesky") return getBlueskyComments(env, runtime, post);
  if (platform === "threads") return getThreadsComments(env, runtime, post);
  if (platform === "instagram") return getInstagramComments(env, runtime, post);
  if (platform === "linkedin") return getLinkedInComments(env, runtime, post);
  return [];
}

async function publishToPlatform(env, runtime, platform, text) {
  if (platform === "bluesky") return publishBluesky(env, runtime, text);
  if (platform === "threads") return publishThreads(env, runtime, text);
  if (platform === "instagram") return publishInstagram(env, runtime, text);
  if (platform === "linkedin") return publishLinkedIn(env, runtime, text);
  throw new Error(`Unsupported publishing platform: ${platform}`);
}

async function replyToPlatform(env, runtime, comment, text) {
  if (comment.platform === "bluesky") return replyBluesky(env, runtime, comment, text);
  if (comment.platform === "threads") return replyThreads(env, runtime, comment, text);
  if (comment.platform === "instagram") return replyInstagram(env, runtime, comment, text);
  if (comment.platform === "linkedin") return replyLinkedIn(env, runtime, comment, text);
  throw new Error(`Unsupported reply platform: ${comment.platform}`);
}

function outboundId(result) {
  return String(result?.id ?? result?.uri ?? result?.commentId ?? "").trim();
}

function outboundUrl(result) {
  for (const key of ["url", "postUrl", "permalink", "permalink_url"]) {
    const value = String(result?.[key] ?? "").trim();
    if (/^https?:\/\//i.test(value)) return value;
  }
  return "";
}

async function resolvePublishedPostUrl(env, runtime, platform, id, result) {
  const directUrl = outboundUrl(result);
  if (directUrl) return directUrl;
  try {
    return await resolveRecentPlatformPostUrl(env, runtime, platform, id);
  } catch {
    return "";
  }
}

export async function resolveRecentPlatformPostUrl(env, runtime, platform, id) {
  const posts = await getRecentPlatformPosts(env, runtime, platform, 10);
  return String(posts.find((post) => String(post.id) === String(id))?.postUrl ?? "").trim();
}

function hydratePublishedPostUrls(publishedByPlatform, recentPosts) {
  const hydrated = { ...(publishedByPlatform && typeof publishedByPlatform === "object" ? publishedByPlatform : {}) };
  for (const [platform, record] of Object.entries(hydrated)) {
    if (outboundUrl(record)) continue;
    const match = [...(Array.isArray(recentPosts) ? recentPosts : [])]
      .reverse()
      .find((post) => post?.platform === platform && String(post.id) === String(record?.id) && outboundUrl(post));
    if (match) hydrated[platform] = { ...record, url: outboundUrl(match) };
  }
  return hydrated;
}

function canPublishPlatform(env, platform) {
  if (platform === "instagram" && !String(env.INSTAGRAM_IMAGE_URL ?? "").trim()) return false;
  return true;
}

async function runAutomation(env, state, now = new Date()) {
  const startedAt = now.toISOString();
  const summary = {
    startedAt,
    activePlatforms: [],
    publishPlatforms: [],
    postsScanned: 0,
    commentsScanned: 0,
    repliesPosted: 0,
    commentsIgnored: 0,
    postsPublished: [],
    contentPlans: [],
    contentFallbacks: 0,
    aiCalls: 0,
    warnings: [],
  };
  const runtime = { blueskySession: null };
  const timeZone = String(env.SOCIAL_TIMEZONE ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  resetDailyCounters(state, now, timeZone);
  const aiCallsAtStart = state.counters.aiCalls;

  const activePlatforms = detectConfiguredPlatforms(env);
  summary.activePlatforms = activePlatforms;
  const requestedPublish = configuredRequestedPublishPlatforms(env);
  let publishPlatforms = pickPublishPlatforms(activePlatforms, requestedPublish);

  const unsupportedRequested = requestedPublish.filter((platform) => platform !== "facebook" && !AUTO_PUBLISH_SUPPORTED.has(platform));
  for (const platform of unsupportedRequested) {
    summary.warnings.push(`${platform} is intentionally disabled in zero-cost mode.`);
  }

  publishPlatforms = publishPlatforms.filter((platform) => {
    if (canPublishPlatform(env, platform)) return true;
    summary.warnings.push(`${platform} publishing is not configured; monitoring/replies remain available.`);
    return false;
  });
  summary.publishPlatforms = publishPlatforms;

  const handles = ownHandles(env);
  const blueskyHandle = String(env.BLUESKY_HANDLE ?? "").trim().toLowerCase().replace(/^@/, "");
  if (blueskyHandle) handles.add(blueskyHandle);
  const seen = new Set(state.seenComments);
  const ownCommentIds = new Set(state.ownCommentIds);

  const lookbackDays = clampInteger(env.SOCIAL_REPLY_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS, 1, 60);
  const maxRepliesPerRun = clampInteger(env.SOCIAL_MAX_REPLIES_PER_RUN, DEFAULT_MAX_REPLIES_PER_RUN, 0, 20);
  const maxRepliesPerDay = clampInteger(env.SOCIAL_MAX_REPLIES_PER_DAY, DEFAULT_MAX_REPLIES_PER_DAY, 0, 100);
  const replyEnabled = parseBoolean(env.SOCIAL_REPLY_ENABLED, true);
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  const monitorPlatforms = activePlatforms.filter((platform) => REPLY_SUPPORTED.has(platform));

  outer: for (const platform of monitorPlatforms) {
    let posts;
    try {
      posts = await getRecentPlatformPosts(env, runtime, platform, 10);
    } catch (error) {
      summary.warnings.push(`${platform} history: ${safeErrorMessage(error)}`);
      continue;
    }
      const recentForMetrics = posts.slice(0, MAX_METRIC_POSTS_PER_RUN);
    const refreshedAt = now.getTime() - (6 * 60 * 60 * 1000);
    const staleForMetrics = recentForMetrics.filter((post) => {
      const previous = state.postMetrics.find((item) => item.platform === platform && String(item.id) === String(post.id));
      const previousAt = Date.parse(String(previous?.fetchedAt ?? ""));
      return !previous || !Number.isFinite(previousAt) || previousAt < refreshedAt;
    });
    if (staleForMetrics.length > 0) {
      const refreshedMetrics = await Promise.all(staleForMetrics.map((post) => getDirectPostMetrics(env, platform, post, now)));
      state.postMetrics = mergePostMetrics(state.postMetrics, refreshedMetrics, MAX_POST_METRICS);
    }
    for (const post of posts) {
      const created = Date.parse(String(post.created ?? ""));
      if (Number.isFinite(created) && created < cutoff) continue;
      if (!post.id) continue;
      summary.postsScanned += 1;
      state.recentPosts.push({
        platform,
        id: post.id,
        post: String(post.post ?? "").slice(0, 500),
        created: String(post.created ?? ""),
        postUrl: String(post.postUrl ?? ""),
      });
      let comments;
      try {
        comments = await getPostComments(env, runtime, platform, post);
      } catch (error) {
        summary.warnings.push(`${platform} comments: ${safeErrorMessage(error)}`);
        continue;
      }
      for (const comment of comments) {
        summary.commentsScanned += 1;
        const key = commentKey(comment);
        if (seen.has(key)) continue;
        if (isLikelyOwnComment(comment, handles, ownCommentIds)) {
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
          decision = await decideReply(env, state, comment);
        } catch (error) {
          summary.warnings.push(`reply decision ${key}: ${safeErrorMessage(error)}`);
          if (safeErrorMessage(error).includes("Free-tier AI daily cap")) break outer;
          continue;
        }
        if (decision.action !== "reply") {
          seen.add(key);
          summary.commentsIgnored += 1;
          continue;
        }

        seen.add(key);
        try {
          const result = await replyToPlatform(env, runtime, comment, decision.reply);
          const id = outboundId(result);
          if (id) ownCommentIds.add(id);
          state.repliedComments.push(key);
          state.counters.replies += 1;
          summary.repliesPosted += 1;
        } catch (error) {
          summary.warnings.push(`reply post ${key}: ${safeErrorMessage(error)}`);
        }

        if (summary.repliesPosted >= maxRepliesPerRun) break outer;
      }
    }
  }

  const publishEnabled = parseBoolean(env.SOCIAL_PUBLISH_ENABLED, false);
  const intervalHours = clampInteger(env.SOCIAL_POST_INTERVAL_HOURS, DEFAULT_POST_INTERVAL_HOURS, 36, 720);
  const maxPostsPerDay = clampInteger(env.SOCIAL_MAX_POSTS_PER_DAY, DEFAULT_MAX_POSTS_PER_DAY, 1, 10);
  const activeStartHour = clampInteger(env.SOCIAL_ACTIVE_START_HOUR, DEFAULT_ACTIVE_START_HOUR, 0, 23);
  const activeEndHour = clampInteger(env.SOCIAL_ACTIVE_END_HOUR, DEFAULT_ACTIVE_END_HOUR, 0, 23);
  const duePlatforms = publishEnabled
    ? publishPlatforms.filter((platform) => shouldPublishNow({
      now,
      lastPostAt: state.lastPostAtByPlatform[platform] ?? state.lastPublishedByPlatform[platform]?.at ?? null,
      intervalHours,
      timeZone,
      activeStartHour,
      activeEndHour,
      postsToday: Number(state.counters.postsByPlatform?.[platform] ?? 0),
      maxPostsPerDay,
    }))
    : [];

  for (const platform of duePlatforms) {
    const { date } = localClockParts(now, timeZone);
    const platformPostsToday = Number(state.counters.postsByPlatform?.[platform] ?? 0);
    const publishKey = `${date}:${platform}:${platformPostsToday + 1}`;
    if (state.publishedKeys.includes(publishKey)) continue;
    try {
      const generated = await generatePost(env, state, platform, now);
      summary.contentPlans.push({
        platform,
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
      const publishedPost = routePostToPilot(generated.post, platform, generated.plan.structure);
      const result = await publishToPlatform(env, runtime, platform, publishedPost);
      const id = outboundId(result) || publishKey;
      state.publishedKeys.push(publishKey);
      const url = await resolvePublishedPostUrl(env, runtime, platform, id, result);
      state.lastPublishedByPlatform[platform] = {
        id,
        at: now.toISOString(),
        ...(url ? { url } : {}),
      };
      state.lastPostAtByPlatform[platform] = now.toISOString();
      state.counters.postsByPlatform[platform] = platformPostsToday + 1;
      state.counters.posts += 1;
      state.lastPostAt = now.toISOString();
      state.lastPostId = `${platform}:${id}`.slice(0, 500);
      if (!Array.isArray(state.contentHistoryByPlatform[platform])) state.contentHistoryByPlatform[platform] = [];
      state.contentHistoryByPlatform[platform].push(contentHistoryEntry(platform, generated.plan, generated.post, now, {
        id,
        url: url || null,
        rewritten: generated.rewritten,
        fallback: generated.fallback,
      }));
      state.recentPosts.push({
        platform,
        id,
        post: generated.post,
        created: now.toISOString(),
        postUrl: url || "",
      });
      summary.postsPublished.push({ platform, id, ...(url ? { url } : {}) });
    } catch (error) {
      summary.warnings.push(`publish ${platform}: ${safeErrorMessage(error)}`);
    }
  }
  if (publishEnabled && activePlatforms.length === 0) {
    summary.warnings.push("No direct social account credentials are configured yet.");
  }

  state.seenComments = trimUnique([...seen], MAX_SEEN_COMMENTS);
  state.repliedComments = trimUnique(state.repliedComments, MAX_SEEN_COMMENTS);
  state.ownCommentIds = trimUnique([...ownCommentIds], MAX_OWN_COMMENT_IDS);
  state.recentPosts = state.recentPosts.slice(-MAX_RECENT_POSTS);
  for (const platform of ["threads", "instagram"]) {
    state.contentHistoryByPlatform[platform] = state.contentHistoryByPlatform[platform].slice(-40);
  }
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

export class SocialAutomationState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/run") {
      let state = normalizeState(await this.state.storage.get(STATE_KEY));
      try {
        const summary = await runAutomation(this.env, state, new Date());
        await this.state.storage.put(STATE_KEY, state);
        console.log(JSON.stringify({ event: "social_direct_run", ...summary }));
        return responseJson({ ok: true, summary });
      } catch (error) {
        state.lastRunAt = new Date().toISOString();
        state.lastError = safeErrorMessage(error);
        await this.state.storage.put(STATE_KEY, state);
        console.error(JSON.stringify({ event: "social_direct_error", error: state.lastError }));
        return responseJson({ ok: false, error: state.lastError }, 502);
      }
    }
    if (request.method === "GET" && url.pathname === "/status") {
      const state = normalizeState(await this.state.storage.get(STATE_KEY));
      return responseJson({
        lastRunAt: state.lastRunAt,
        lastPostAt: state.lastPostAt,
        lastPostId: state.lastPostId,
        lastError: state.lastError,
        lastPublishedByPlatform: hydratePublishedPostUrls(state.lastPublishedByPlatform, state.recentPosts),
        lastPostAtByPlatform: state.lastPostAtByPlatform,
        contentHistoryByPlatform: state.contentHistoryByPlatform,
        postMetrics: state.postMetrics,
        counters: state.counters,
        lastSummary: state.lastSummary,
      });
    }
    return new Response("Not found", { status: 404 });
  }
}

async function triggerRun(env) {
  const response = await stateStub(env).fetch(new Request("https://social.internal/run", { method: "POST" }));
  if (!response.ok) throw new Error(`Social automation run failed with HTTP ${response.status}`);
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return responseJson({
        ok: true,
        mode: "direct-zero-cost",
        automationEnabled: parseBoolean(env.SOCIAL_AUTOMATION_ENABLED, true),
        publishEnabled: parseBoolean(env.SOCIAL_PUBLISH_ENABLED, false),
        repliesEnabled: parseBoolean(env.SOCIAL_REPLY_ENABLED, true),
        configuredPlatforms: detectConfiguredPlatforms(env),
        paidPlatformsEnabled: false,
      });
    }
    if (url.pathname === "/status" && request.method === "GET") {
      const response = await stateStub(env).fetch(new Request("https://social.internal/status"));
      if (!response.ok) return response;
      const status = await response.json();
      return responseJson({
        mode: "direct-zero-cost",
        lastRunAt: status.lastRunAt ?? null,
        lastPostAt: status.lastPostAt ?? null,
        lastError: status.lastError ?? null,
        lastPublishedByPlatform: status.lastPublishedByPlatform ?? {},
        lastPostAtByPlatform: status.lastPostAtByPlatform ?? {},
        contentHistoryByPlatform: status.contentHistoryByPlatform ?? {},
        postMetrics: status.postMetrics ?? [],
        counters: status.counters ?? null,
        lastSummary: status.lastSummary
          ? {
              activePlatforms: status.lastSummary.activePlatforms ?? [],
              publishPlatforms: status.lastSummary.publishPlatforms ?? [],
              postsScanned: status.lastSummary.postsScanned ?? 0,
              commentsScanned: status.lastSummary.commentsScanned ?? 0,
              repliesPosted: status.lastSummary.repliesPosted ?? 0,
              commentsIgnored: status.lastSummary.commentsIgnored ?? 0,
              postsPublished: status.lastSummary.postsPublished ?? [],
              contentPlans: status.lastSummary.contentPlans ?? [],
              contentFallbacks: status.lastSummary.contentFallbacks ?? 0,
              aiCalls: status.lastSummary.aiCalls ?? 0,
              warningCount: Array.isArray(status.lastSummary.warnings) ? status.lastSummary.warnings.length : 0,
            }
          : null,
      });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller, env) {
    if (!parseBoolean(env.SOCIAL_AUTOMATION_ENABLED, true)) {
      console.log(JSON.stringify({ event: "social_direct_skipped", reason: "disabled" }));
      return;
    }
    if (detectConfiguredPlatforms(env).length === 0) {
      console.log(JSON.stringify({ event: "social_direct_skipped", reason: "no_direct_accounts_configured" }));
      return;
    }
    await triggerRun(env);
  },
};
