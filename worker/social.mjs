const AYRSHARE_BASE_URL = "https://api.ayrshare.com/api";
const STATE_KEY = "social-automation-v1";
const MAX_SEEN_COMMENTS = 2000;
const MAX_OWN_COMMENT_IDS = 1000;
const MAX_RECENT_POSTS = 100;
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_MAX_REPLIES_PER_RUN = 4;
const DEFAULT_MAX_REPLIES_PER_DAY = 12;
const DEFAULT_POST_INTERVAL_HOURS = 48;
const DEFAULT_ACTIVE_START_HOUR = 8;
const DEFAULT_ACTIVE_END_HOUR = 19;
const DEFAULT_TIMEZONE = "America/Los_Angeles";
const DEFAULT_MODEL = "@cf/zai-org/glm-4.7-flash";

const REPLY_SUPPORTED = new Set([
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "twitter",
]);

const AUTO_PUBLISH_SUPPORTED = new Set([
  "bluesky",
  "facebook",
  "instagram",
  "linkedin",
  "telegram",
  "threads",
  "twitter",
]);

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
  return platform;
}

export function uniquePlatforms(values) {
  return [...new Set((values ?? []).map(normalizePlatform).filter(Boolean))];
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
}) {
  if (postsToday >= 1) return false;
  if (!isWithinActiveHours(now, timeZone, activeStartHour, activeEndHour)) return false;
  if (!lastPostAt) return true;
  const last = Date.parse(lastPostAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= intervalHours * 60 * 60 * 1000;
}

export function flattenComments(payload, platform, post) {
  const items = Array.isArray(payload?.[platform])
    ? payload[platform]
    : Array.isArray(payload?.comments)
      ? payload.comments
      : [];
  const output = [];
  const visit = (item, depth = 0) => {
    if (!item || typeof item !== "object") return;
    const commentId = String(item.commentId ?? item.id ?? "").trim();
    const text = String(item.comment ?? item.text ?? "").trim();
    if (commentId && text) {
      output.push({
        platform,
        postId: String(post.id ?? ""),
        postText: String(post.post ?? ""),
        postUrl: String(post.postUrl ?? post.permalink ?? ""),
        commentId,
        text,
        username: String(item.username ?? item.userName ?? item.from?.username ?? item.from?.name ?? "").trim(),
        created: String(item.created ?? ""),
        depth,
        videoId: String(item.videoId ?? post.videoId ?? "").trim(),
      });
    }
    if (Array.isArray(item.replies)) {
      for (const reply of item.replies) visit(reply, depth + 1);
    }
  };
  for (const item of items) visit(item, 0);
  return output;
}

export function commentKey(comment) {
  return `${normalizePlatform(comment.platform)}:${String(comment.commentId ?? "")}`;
}

export function isLikelyOwnComment(comment, ownHandles, ownCommentIds) {
  const id = String(comment.commentId ?? "");
  if (ownCommentIds.has(id)) return true;
  const normalizedUser = String(comment.username ?? "").trim().toLowerCase().replace(/^@/, "");
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
    version: 1,
    lastRunAt: null,
    lastPostAt: null,
    lastPostId: null,
    lastError: null,
    counters: { date: null, posts: 0, replies: 0 },
    seenComments: [],
    repliedComments: [],
    ownCommentIds: [],
    recentPosts: [],
    lastSummary: null,
  };
}

function normalizeState(value) {
  const state = value && typeof value === "object" ? value : {};
  return {
    ...emptyState(),
    ...state,
    counters: {
      ...emptyState().counters,
      ...(state.counters && typeof state.counters === "object" ? state.counters : {}),
    },
    seenComments: Array.isArray(state.seenComments) ? state.seenComments : [],
    repliedComments: Array.isArray(state.repliedComments) ? state.repliedComments : [],
    ownCommentIds: Array.isArray(state.ownCommentIds) ? state.ownCommentIds : [],
    recentPosts: Array.isArray(state.recentPosts) ? state.recentPosts : [],
  };
}

function responseJson(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
}

function profileHeaders(env, contentType = false) {
  const headers = new Headers({
    Authorization: `Bearer ${String(env.AYRSHARE_API_KEY ?? "").trim()}`,
  });
  const profileKey = String(env.AYRSHARE_PROFILE_KEY ?? "").trim();
  if (profileKey) headers.set("Profile-Key", profileKey);
  const xApiKey = String(env.AYRSHARE_X_API_KEY ?? "").trim();
  const xApiSecret = String(env.AYRSHARE_X_API_SECRET ?? "").trim();
  if (xApiKey && xApiSecret) {
    headers.set("X-Twitter-OAuth1-Api-Key", xApiKey);
    headers.set("X-Twitter-OAuth1-Api-Secret", xApiSecret);
  }
  if (contentType) headers.set("Content-Type", "application/json");
  return headers;
}

async function ayrshareRequest(env, path, init = {}) {
  const apiKey = String(env.AYRSHARE_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("AYRSHARE_API_KEY is not configured");
  const headers = profileHeaders(env, init.body !== undefined);
  const response = await fetch(`${AYRSHARE_BASE_URL}${path}`, { ...init, headers });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error === "string"
        ? payload.error
        : `HTTP ${response.status}`;
    throw new Error(`Ayrshare ${path} failed: ${detail}`);
  }
  return payload ?? {};
}

async function getUserProfile(env) {
  return ayrshareRequest(env, "/user");
}

async function getRecentPlatformPosts(env, platform, limit = 10) {
  const params = new URLSearchParams({ limit: String(limit) });
  const payload = await ayrshareRequest(env, `/history/${encodeURIComponent(platform)}?${params}`);
  return Array.isArray(payload?.posts) ? payload.posts : [];
}

async function getPostComments(env, platform, postId) {
  const params = new URLSearchParams({ platform, searchPlatformId: "true" });
  return ayrshareRequest(env, `/comments/${encodeURIComponent(postId)}?${params}`);
}

function extractAiText(result) {
  if (typeof result?.response === "string") return result.response;
  const choices = Array.isArray(result?.choices) ? result.choices : [];
  const content = choices[0]?.message?.content;
  if (typeof content === "string") return content;
  return "";
}

function parseAiJson(text) {
  const raw = String(text ?? "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? raw;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI returned invalid JSON");
  return JSON.parse(fenced.slice(start, end + 1));
}

async function aiJson(env, system, user, maxTokens = 500) {
  if (!env.AI?.run) throw new Error("Workers AI binding is not configured");
  const model = String(env.SOCIAL_AI_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const result = await env.AI.run(model, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_completion_tokens: maxTokens,
    temperature: 0.35,
    response_format: { type: "json_object" },
  });
  return parseAiJson(extractAiText(result));
}

async function decideReply(env, comment) {
  const system = `You write concise social replies for PencilProof. ${BRAND_CONTEXT}\n\nReturn JSON only: {"action":"reply"|"ignore","reply":"...","reason":"..."}. Reply only when the person is genuinely engaging with a PencilProof post or asking a relevant car-finance/dealer-quote question. Ignore spam, bait, harassment, politics, unrelated comments, legal disputes, credit-repair requests, requests for individualized legal/financial advice, and anything that would require seeing private paperwork. Never ask for SSNs, account numbers, DOB, addresses, or other sensitive personal data. Never claim PencilProof can negotiate, contact the dealer, guarantee savings, or give legal/financial advice. If replying, be useful and conversational, under 400 characters, at most one link, no hashtags, no hard sell.`;
  const user = `Platform: ${comment.platform}\nParent post: ${comment.postText.slice(0, 1000)}\nComment by ${comment.username || "unknown"}: ${comment.text.slice(0, 1500)}\nPencilProof URL: https://pencilproof.com`;
  const parsed = await aiJson(env, system, user, 350);
  const action = parsed?.action === "reply" ? "reply" : "ignore";
  const reply = typeof parsed?.reply === "string" ? parsed.reply.trim().slice(0, 600) : "";
  return {
    action: action === "reply" && reply ? "reply" : "ignore",
    reply,
    reason: typeof parsed?.reason === "string" ? parsed.reason.slice(0, 240) : "",
  };
}

async function generatePost(env, recentPostTexts, platforms) {
  const system = `You create educational social posts for PencilProof. ${BRAND_CONTEXT}\n\nReturn JSON only: {"post":"...","imageSearch":"..."}. Write one concrete, useful tip for a car buyer reviewing a dealer finance quote. Rotate among APR, amount financed, add-ons, VSC, GAP, prepaid maintenance, tire/wheel, trade equity, negative equity, cash down, rebates, term, and monthly-payment math. Avoid fearmongering, accusations against dealers, guaranteed savings, individualized advice, and legal claims. Keep the post under 260 characters so it works on X. Include https://pencilproof.com only when natural; do not use more than 2 hashtags. imageSearch must be a short neutral Unsplash search phrase suitable for an automotive/finance educational post.`;
  const recent = recentPostTexts.length
    ? recentPostTexts.slice(-8).map((text, index) => `${index + 1}. ${text.slice(0, 400)}`).join("\n")
    : "No prior automated posts recorded.";
  const user = `Publishing to: ${platforms.join(", ")}\nAvoid repeating these recent posts:\n${recent}`;
  const parsed = await aiJson(env, system, user, 450);
  const post = typeof parsed?.post === "string" ? parsed.post.trim().slice(0, 320) : "";
  if (!post) throw new Error("AI did not generate a post");
  return {
    post,
    imageSearch: typeof parsed?.imageSearch === "string" && parsed.imageSearch.trim()
      ? parsed.imageSearch.trim().slice(0, 80)
      : "car dealership paperwork",
  };
}

async function publishPost(env, post, platforms, imageSearch, idempotencyKey) {
  const body = {
    post,
    platforms,
    idempotencyKey,
    notes: "PencilProof unattended social automation",
  };
  if (platforms.includes("instagram")) body.unsplash = imageSearch;
  return ayrshareRequest(env, "/post", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function extractReplyIds(payload) {
  const ids = [];
  if (typeof payload?.commentId === "string") ids.push(payload.commentId);
  if (payload && typeof payload === "object") {
    for (const value of Object.values(payload)) {
      if (value && typeof value === "object" && typeof value.commentId === "string") {
        ids.push(value.commentId);
      }
    }
  }
  return ids;
}

async function postReply(env, comment, reply) {
  const body = {
    platforms: [comment.platform],
    comment: reply,
    searchPlatformId: true,
  };
  if (comment.platform === "tiktok" && comment.videoId) body.videoId = comment.videoId;
  return ayrshareRequest(env, `/comments/reply/${encodeURIComponent(comment.commentId)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function hasXCredentials(env) {
  return Boolean(
    String(env.AYRSHARE_X_API_KEY ?? "").trim()
    && String(env.AYRSHARE_X_API_SECRET ?? "").trim(),
  );
}

function configuredRequestedPublishPlatforms(env) {
  return uniquePlatforms(String(env.SOCIAL_PUBLISH_PLATFORMS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
}

function ownHandlesFromProfile(profile, env) {
  const handles = new Set(
    String(env.SOCIAL_OWN_HANDLES ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  );
  for (const item of Array.isArray(profile?.displayNames) ? profile.displayNames : []) {
    for (const candidate of [item?.username, item?.displayName, item?.pageName]) {
      const value = String(candidate ?? "").trim().toLowerCase().replace(/^@/, "");
      if (value) handles.add(value);
    }
  }
  return handles;
}

function resetDailyCounters(state, now, timeZone) {
  const { date } = localClockParts(now, timeZone);
  if (state.counters.date !== date) {
    state.counters = { date, posts: 0, replies: 0 };
  }
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
    postPublished: false,
    warnings: [],
  };

  const timeZone = String(env.SOCIAL_TIMEZONE ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  resetDailyCounters(state, now, timeZone);

  const profile = await getUserProfile(env);
  const activePlatforms = uniquePlatforms(profile?.activeSocialAccounts ?? []);
  summary.activePlatforms = activePlatforms;
  const requestedPublish = configuredRequestedPublishPlatforms(env);
  let publishPlatforms = pickPublishPlatforms(activePlatforms, requestedPublish);
  if (publishPlatforms.includes("twitter") && !hasXCredentials(env)) {
    publishPlatforms = publishPlatforms.filter((platform) => platform !== "twitter");
    summary.warnings.push("X/Twitter is linked but BYO X API credentials are not configured; skipping X.");
  }
  summary.publishPlatforms = publishPlatforms;
  const ownHandles = ownHandlesFromProfile(profile, env);
  const seen = new Set(state.seenComments);
  const ownCommentIds = new Set(state.ownCommentIds);

  const lookbackDays = clampInteger(env.SOCIAL_REPLY_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS, 1, 60);
  const maxRepliesPerRun = clampInteger(env.SOCIAL_MAX_REPLIES_PER_RUN, DEFAULT_MAX_REPLIES_PER_RUN, 0, 20);
  const maxRepliesPerDay = clampInteger(env.SOCIAL_MAX_REPLIES_PER_DAY, DEFAULT_MAX_REPLIES_PER_DAY, 0, 100);
  const replyEnabled = parseBoolean(env.SOCIAL_REPLY_ENABLED, true);
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;

  const monitorPlatforms = activePlatforms.filter((platform) =>
    REPLY_SUPPORTED.has(platform)
    && (platform !== "twitter" || hasXCredentials(env))
  );
  outer: for (const platform of monitorPlatforms) {
    let posts;
    try {
      posts = await getRecentPlatformPosts(env, platform, 10);
    } catch (error) {
      summary.warnings.push(`${platform} history: ${safeErrorMessage(error)}`);
      continue;
    }
    for (const post of posts) {
      const created = Date.parse(String(post.created ?? post.publishedAt ?? ""));
      if (Number.isFinite(created) && created < cutoff) continue;
      const postId = String(post.id ?? post.postId ?? "").trim();
      if (!postId) continue;
      summary.postsScanned += 1;
      state.recentPosts.push({
        platform,
        id: postId,
        post: String(post.post ?? "").slice(0, 500),
        created: String(post.created ?? post.publishedAt ?? ""),
      });
      let commentsPayload;
      try {
        commentsPayload = await getPostComments(env, platform, postId);
      } catch (error) {
        summary.warnings.push(`${platform} comments: ${safeErrorMessage(error)}`);
        continue;
      }
      const comments = flattenComments(commentsPayload, platform, { ...post, id: postId });
      for (const comment of comments) {
        summary.commentsScanned += 1;
        const key = commentKey(comment);
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
          decision = await decideReply(env, comment);
        } catch (error) {
          summary.warnings.push(`reply decision ${key}: ${safeErrorMessage(error)}`);
          continue;
        }
        if (decision.action !== "reply") {
          seen.add(key);
          summary.commentsIgnored += 1;
          continue;
        }

        // Mark the source comment before the outbound call. If the network call
        // succeeds but the Worker is interrupted before state is persisted, the
        // Durable Object still serializes this run; this ordering also favors
        // avoiding duplicate public replies over aggressive retries.
        seen.add(key);
        try {
          const result = await postReply(env, comment, decision.reply);
          for (const id of extractReplyIds(result)) ownCommentIds.add(id);
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
  const intervalHours = clampInteger(env.SOCIAL_POST_INTERVAL_HOURS, DEFAULT_POST_INTERVAL_HOURS, 6, 720);
  const activeStartHour = clampInteger(env.SOCIAL_ACTIVE_START_HOUR, DEFAULT_ACTIVE_START_HOUR, 0, 23);
  const activeEndHour = clampInteger(env.SOCIAL_ACTIVE_END_HOUR, DEFAULT_ACTIVE_END_HOUR, 0, 23);
  const eligibleToPublish = publishEnabled && publishPlatforms.length > 0 && shouldPublishNow({
    now,
    lastPostAt: state.lastPostAt,
    intervalHours,
    timeZone,
    activeStartHour,
    activeEndHour,
    postsToday: state.counters.posts,
  });

  if (eligibleToPublish) {
    try {
      const recentTexts = state.recentPosts.map((item) => String(item.post ?? "")).filter(Boolean);
      const generated = await generatePost(env, recentTexts, publishPlatforms);
      const { date } = localClockParts(now, timeZone);
      const idempotencyKey = `pencilproof-auto-${date}`;
      const result = await publishPost(env, generated.post, publishPlatforms, generated.imageSearch, idempotencyKey);
      state.lastPostAt = now.toISOString();
      state.lastPostId = typeof result?.id === "string" ? result.id : idempotencyKey;
      state.counters.posts += 1;
      state.recentPosts.push({
        platform: "multi",
        id: state.lastPostId,
        post: generated.post,
        created: now.toISOString(),
      });
      summary.postPublished = true;
    } catch (error) {
      summary.warnings.push(`publish: ${safeErrorMessage(error)}`);
    }
  } else if (publishEnabled && publishPlatforms.length === 0) {
    summary.warnings.push("No linked auto-publishable social accounts matched SOCIAL_PUBLISH_PLATFORMS.");
  }

  state.seenComments = trimUnique([...seen], MAX_SEEN_COMMENTS);
  state.repliedComments = trimUnique(state.repliedComments, MAX_SEEN_COMMENTS);
  state.ownCommentIds = trimUnique([...ownCommentIds], MAX_OWN_COMMENT_IDS);
  state.recentPosts = state.recentPosts.slice(-MAX_RECENT_POSTS);
  state.lastRunAt = new Date().toISOString();
  state.lastError = summary.warnings.length ? summary.warnings.slice(-5).join(" | ") : null;
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
        console.log(JSON.stringify({ event: "social_automation_run", ...summary }));
        return responseJson({ ok: true, summary });
      } catch (error) {
        state.lastRunAt = new Date().toISOString();
        state.lastError = safeErrorMessage(error);
        await this.state.storage.put(STATE_KEY, state);
        console.error(JSON.stringify({ event: "social_automation_error", error: state.lastError }));
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
        automationEnabled: parseBoolean(env.SOCIAL_AUTOMATION_ENABLED, true),
        publishEnabled: parseBoolean(env.SOCIAL_PUBLISH_ENABLED, false),
      });
    }
    if (url.pathname === "/status" && request.method === "GET") {
      const response = await stateStub(env).fetch(new Request("https://social.internal/status"));
      if (!response.ok) return response;
      const status = await response.json();
      return responseJson({
        lastRunAt: status.lastRunAt ?? null,
        lastPostAt: status.lastPostAt ?? null,
        counters: status.counters ?? null,
        lastSummary: status.lastSummary
          ? {
              activePlatforms: status.lastSummary.activePlatforms ?? [],
              publishPlatforms: status.lastSummary.publishPlatforms ?? [],
              postsScanned: status.lastSummary.postsScanned ?? 0,
              commentsScanned: status.lastSummary.commentsScanned ?? 0,
              repliesPosted: status.lastSummary.repliesPosted ?? 0,
              commentsIgnored: status.lastSummary.commentsIgnored ?? 0,
              postPublished: status.lastSummary.postPublished ?? false,
              warningCount: Array.isArray(status.lastSummary.warnings) ? status.lastSummary.warnings.length : 0,
            }
          : null,
      });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller, env) {
    if (!parseBoolean(env.SOCIAL_AUTOMATION_ENABLED, true)) {
      console.log(JSON.stringify({ event: "social_automation_skipped", reason: "disabled" }));
      return;
    }
    if (!String(env.AYRSHARE_API_KEY ?? "").trim()) {
      console.log(JSON.stringify({ event: "social_automation_skipped", reason: "missing_ayrshare_api_key" }));
      return;
    }
    await triggerRun(env);
  },
};
