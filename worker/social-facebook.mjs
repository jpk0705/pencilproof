import directWorker, {
  SocialAutomationState as DirectSocialAutomationState,
  clampInteger,
  detectConfiguredPlatforms,
  isLikelyOwnComment,
  localClockParts,
  parseBoolean,
  runDirectReadOnlyAudit,
  shouldPublishNow,
  trimUnique,
} from "./social-direct.mjs";

const FACEBOOK_STATE_KEY = "social-facebook-v1";
const DEFAULT_TIMEZONE = "America/Los_Angeles";
const DEFAULT_MODEL = "@cf/meta/llama-3.2-1b-instruct";
const DEFAULT_META_API_VERSION = "v24.0";
const MAX_SEEN_COMMENTS = 2000;
const MAX_OWN_COMMENT_IDS = 1000;
const MAX_RECENT_POSTS = 100;
const MAX_PUBLISHED_KEYS = 200;
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_MAX_REPLIES_PER_RUN = 4;
const DEFAULT_MAX_REPLIES_PER_DAY = 12;
const DEFAULT_POST_INTERVAL_HOURS = 48;
const DEFAULT_ACTIVE_START_HOUR = 8;
const DEFAULT_ACTIVE_END_HOUR = 19;
const DEFAULT_FACEBOOK_AI_CALLS_PER_DAY = 6;

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

function safeErrorMessage(error) {
  return error instanceof Error ? error.message.slice(0, 500) : String(error ?? "Unknown error").slice(0, 500);
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
    publishedKeys: [],
    lastPublishedByPlatform: {},
    lastSummary: null,
  };
}

function normalizeFacebookState(value) {
  const state = value && typeof value === "object" ? value : {};
  return {
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
    publishedKeys: Array.isArray(state.publishedKeys) ? state.publishedKeys : [],
    lastPublishedByPlatform: state.lastPublishedByPlatform && typeof state.lastPublishedByPlatform === "object"
      ? state.lastPublishedByPlatform
      : {},
  };
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
    50,
  );
  if (state.counters.aiCalls >= max) {
    throw new Error("Facebook AI daily cap reached; skipping until the next local day");
  }
  state.counters.aiCalls += 1;
}

function extractAiText(result) {
  if (typeof result?.response === "string") return result.response;
  const choices = Array.isArray(result?.choices) ? result.choices : [];
  const content = choices[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function parseAiJson(text) {
  const raw = String(text ?? "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? raw;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI returned invalid JSON");
  return JSON.parse(fenced.slice(start, end + 1));
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
  const system = `You write concise Facebook Page replies for PencilProof. ${BRAND_CONTEXT}\n\nReturn JSON only: {"action":"reply"|"ignore","reply":"...","reason":"..."}. Reply only to genuine engagement or relevant car-finance/dealer-quote questions. Ignore spam, bait, harassment, politics, unrelated comments, legal disputes, credit-repair requests, individualized legal/financial advice, and requests requiring private paperwork. Never request SSNs, account numbers, DOB, addresses, or sensitive personal data. Never claim PencilProof negotiates, contacts dealers, guarantees savings, or gives legal/financial advice. If replying, stay under 350 characters, use no hashtags, and avoid hard selling.`;
  const user = `Parent post: ${String(comment.postText ?? "").slice(0, 800)}\nComment by ${comment.username || "unknown"}: ${String(comment.text ?? "").slice(0, 1200)}\nPencilProof URL: https://pencilproof.com`;
  const parsed = await aiJson(env, state, system, user, 240);
  const reply = typeof parsed?.reply === "string" ? parsed.reply.trim().slice(0, 500) : "";
  return {
    action: parsed?.action === "reply" && reply ? "reply" : "ignore",
    reply,
  };
}

async function generateFacebookPost(env, state, recentPostTexts) {
  const system = `You create educational Facebook Page posts for PencilProof. ${BRAND_CONTEXT}\n\nReturn JSON only: {"post":"..."}. Write one concrete, useful car-finance quote-checking tip. Rotate among APR, amount financed, add-ons, VSC, GAP, prepaid maintenance, tire/wheel, trade equity, negative equity, cash down, rebates, term, and monthly-payment math. Avoid fearmongering, accusations against dealers, guaranteed savings, individualized advice, and legal claims. Keep it concise and readable, ideally under 500 characters. Include https://pencilproof.com only when natural and use no more than 2 hashtags.`;
  const recent = recentPostTexts.length
    ? recentPostTexts.slice(-8).map((text, index) => `${index + 1}. ${String(text).slice(0, 400)}`).join("\n")
    : "No prior automated Facebook posts recorded.";
  const parsed = await aiJson(env, state, system, `Avoid repeating these recent posts:\n${recent}`, 260);
  const post = typeof parsed?.post === "string" ? parsed.post.trim().slice(0, 1000) : "";
  if (!post) throw new Error("AI did not generate a Facebook post");
  return post;
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

async function runFacebookAutomation(env, state, now = new Date()) {
  const summary = {
    startedAt: now.toISOString(),
    configured: facebookConfigured(env),
    postsScanned: 0,
    commentsScanned: 0,
    repliesPosted: 0,
    commentsIgnored: 0,
    postPublished: false,
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

  outer: for (const post of posts) {
    const created = Date.parse(post.created);
    if (Number.isFinite(created) && created < cutoff) continue;
    summary.postsScanned += 1;
    state.recentPosts.push({ id: post.id, post: post.post.slice(0, 500), created: post.created });

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
  const intervalHours = clampInteger(env.SOCIAL_POST_INTERVAL_HOURS, DEFAULT_POST_INTERVAL_HOURS, 6, 720);
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
  });

  if (eligibleToPublish) {
    const { date } = localClockParts(now, timeZone);
    const publishKey = `${date}:facebook`;
    if (!state.publishedKeys.includes(publishKey)) {
      try {
        const generated = await generateFacebookPost(
          env,
          state,
          state.recentPosts.map((item) => item.post).filter(Boolean),
        );
        const result = await publishFacebook(env, generated);
        state.publishedKeys.push(publishKey);
        state.lastPostAt = now.toISOString();
        state.lastPostId = String(result?.id ?? publishKey);
        state.lastPublishedByPlatform.facebook = {
          id: state.lastPostId,
          at: now.toISOString(),
        };
        state.counters.posts += 1;
        state.recentPosts.push({ id: state.lastPostId, post: generated, created: now.toISOString() });
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

function recentPostCheck(posts) {
  return {
    apiReachable: true,
    recentPostCount: posts.length,
    latestRemotePostAt: posts
      .map((post) => String(post.created ?? ""))
      .filter(Boolean)
      .sort()
      .at(-1) ?? null,
  };
}

async function buildReadOnlyAudit(env, ctx) {
  const checkedAt = new Date().toISOString();
  const directAudit = await runDirectReadOnlyAudit(env, new Date(checkedAt));
  const directResponse = await directWorker.fetch(new Request("https://social.internal/status"), env, ctx);
  const directStatus = directResponse.ok ? await directResponse.json() : {};
  const facebookStatusResponse = await stateStub(env).fetch(new Request("https://social.internal/facebook-status"));
  const facebookStatus = facebookStatusResponse.ok ? await facebookStatusResponse.json() : {};

  let facebookResult = {
    configured: facebookConfigured(env),
    apiReachable: false,
    recentPostCount: 0,
    latestRemotePostAt: null,
  };
  if (facebookResult.configured) {
    try {
      facebookResult = { configured: true, ...recentPostCheck(await getFacebookPosts(env, 5)) };
    } catch (error) {
      facebookResult.error = safeErrorMessage(error);
    }
  }

  const lastPublishedByPlatform = {
    ...(directStatus.lastPublishedByPlatform ?? {}),
    ...(facebookStatus.lastPublishedByPlatform ?? {}),
  };
  const weekStart = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const targetPlatforms = ["facebook", "instagram", "threads"];
  const platforms = {
    facebook: { ...facebookResult, lastPublished: lastPublishedByPlatform.facebook ?? null },
    instagram: {
      ...(directAudit.platforms.instagram ?? { configured: false, apiReachable: false, recentPostCount: 0, latestRemotePostAt: null }),
      lastPublished: lastPublishedByPlatform.instagram ?? null,
    },
    threads: {
      ...(directAudit.platforms.threads ?? { configured: false, apiReachable: false, recentPostCount: 0, latestRemotePostAt: null }),
      lastPublished: lastPublishedByPlatform.threads ?? null,
    },
  };
  for (const platform of targetPlatforms) {
    const lastPublished = platforms[platform].lastPublished;
    platforms[platform].publishedWithin7Days = Boolean(lastPublished?.at && Date.parse(lastPublished.at) >= weekStart);
  }

  const errors = [];
  for (const [platform, result] of Object.entries(platforms)) {
    if (result.error) errors.push(`${platform}: ${result.error}`);
  }
  if (directStatus.lastError) errors.push(`direct automation: ${directStatus.lastError}`);
  if (facebookStatus.lastError) errors.push(`facebook automation: ${facebookStatus.lastError}`);

  return {
    ok: errors.length === 0,
    mode: "read-only-health-audit",
    checkedAt,
    automation: {
      enabled: parseBoolean(env.SOCIAL_AUTOMATION_ENABLED, true),
      publishingEnabled: parseBoolean(env.SOCIAL_PUBLISH_ENABLED, false),
      repliesEnabled: parseBoolean(env.SOCIAL_REPLY_ENABLED, true),
      configuredPlatforms: combinedConfiguredPlatforms(env),
      lastDirectRunAt: directStatus.lastRunAt ?? null,
      lastFacebookRunAt: facebookStatus.lastRunAt ?? null,
    },
    platforms,
    weeklyPromotion: {
      windowDays: 7,
      completed: targetPlatforms.every((platform) => platforms[platform].publishedWithin7Days),
      targetPlatforms,
      lastPublishedByPlatform,
    },
    errors,
    sideEffects: [],
  };
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
      return responseJson({
        lastRunAt: state.lastRunAt,
        lastPostAt: state.lastPostAt,
        lastError: state.lastError,
        lastPublishedByPlatform: state.lastPublishedByPlatform,
        counters: state.counters,
        lastSummary: state.lastSummary,
      });
    }

    return super.fetch(request);
  }
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
        configuredPlatforms: combinedConfiguredPlatforms(env),
        paidPlatformsEnabled: false,
        auditEndpoint: "/audit",
      });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const directResponse = await directWorker.fetch(request, env, ctx);
      const directStatus = directResponse.ok ? await directResponse.json() : {};
      const facebookResponse = await stateStub(env).fetch(new Request("https://social.internal/facebook-status"));
      const facebookStatus = facebookResponse.ok ? await facebookResponse.json() : {};
      return responseJson({
        ...directStatus,
        configuredPlatforms: combinedConfiguredPlatforms(env),
        facebook: {
          configured: facebookConfigured(env),
          lastRunAt: facebookStatus.lastRunAt ?? null,
          lastPostAt: facebookStatus.lastPostAt ?? null,
          lastError: facebookStatus.lastError ?? null,
          lastPublishedByPlatform: facebookStatus.lastPublishedByPlatform ?? {},
          counters: facebookStatus.counters ?? null,
          lastSummary: facebookStatus.lastSummary
            ? {
                postsScanned: facebookStatus.lastSummary.postsScanned ?? 0,
                commentsScanned: facebookStatus.lastSummary.commentsScanned ?? 0,
                repliesPosted: facebookStatus.lastSummary.repliesPosted ?? 0,
                commentsIgnored: facebookStatus.lastSummary.commentsIgnored ?? 0,
                postPublished: facebookStatus.lastSummary.postPublished ?? false,
                aiCalls: facebookStatus.lastSummary.aiCalls ?? 0,
                warningCount: Array.isArray(facebookStatus.lastSummary.warnings)
                  ? facebookStatus.lastSummary.warnings.length
                  : 0,
              }
            : null,
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/audit") {
      const audit = await buildReadOnlyAudit(env, ctx);
      return responseJson(audit, audit.ok ? 200 : 503);
    }

    return directWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
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
      return;
    }

    await triggerFacebookRun(env);
  },
};
