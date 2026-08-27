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
import { routePostToPilot } from "./campaign-links.mjs";

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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[character] ?? character));
}

function formattedStatusDate(value) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" })
    : "Not recorded yet";
}

function wantsHtmlStatus(request) {
  const format = new URL(request.url).searchParams.get("format");
  if (format === "html") return true;
  if (format === "json") return false;
  return (request.headers.get("Accept") ?? "").toLowerCase().includes("text/html");
}

function statusPageResponse(status) {
  const configured = new Set(Array.isArray(status.configuredPlatforms) ? status.configuredPlatforms : []);
  const platformRows = ["facebook", "instagram", "threads"].map((platform) => {
    const platformStatus = platform === "facebook"
      ? (status.facebook ?? {})
      : { lastError: null, lastPostAt: status.lastPublishedByPlatform?.[platform]?.at ?? null };
    const isConfigured = platform === "facebook"
      ? platformStatus.configured === true
      : configured.has(platform);
    const hasError = Boolean(platformStatus.lastError);
    const state = hasError ? "Needs attention" : isConfigured ? "Configured" : "Not configured";
    const stateClass = hasError ? "bad" : isConfigured ? "good" : "muted";
    return `<tr><th scope="row">${escapeHtml(platform[0].toUpperCase() + platform.slice(1))}</th><td><span class="pill ${stateClass}">${state}</span></td><td>${escapeHtml(formattedStatusDate(platformStatus.lastPostAt))}</td><td>${hasError ? `<span class="error">${escapeHtml(platformStatus.lastError)}</span>` : "No current error"}</td></tr>`;
  }).join("");
  const directSummary = status.lastSummary ?? {};
  const facebookSummary = status.facebook?.lastSummary ?? {};
  const overallError = status.lastError || status.facebook?.lastError || "";
  const overallState = overallError ? "Needs attention" : "Operating normally";
  const overallClass = overallError ? "bad" : "good";
  const stat = (label, value, detail) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PencilProof automation status</title>
<style>
:root{font-family:Arial,sans-serif;color:#f3f6fb;background:#061329}*{box-sizing:border-box}body{margin:0;background:linear-gradient(145deg,#061329 0%,#0b2346 100%);min-height:100vh}.shell{max-width:1080px;margin:auto;padding:34px 20px 60px}header{display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid #274269;padding-bottom:18px;margin-bottom:28px}.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:20px}.logo{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:#f5bf3f;color:#061329;font-size:20px;font-weight:900}.refresh{border:1px solid #4a6488;border-radius:999px;padding:9px 14px;color:#f3f6fb;text-decoration:none;font-size:13px;font-weight:700}.hero,.panel{background:#102b52;border:1px solid #35557d;border-radius:18px;box-shadow:0 14px 40px #0003}.hero{padding:28px;display:flex;align-items:flex-end;justify-content:space-between;gap:22px}.eyebrow{display:block;color:#f5bf3f;letter-spacing:.14em;font-size:11px;font-weight:800;text-transform:uppercase;margin-bottom:10px}.hero h1{font:700 clamp(30px,6vw,52px)/1.05 Georgia,serif;margin:0}.hero p{max-width:620px;color:#c4d2e5;line-height:1.55;margin:14px 0 0}.pill{display:inline-block;border-radius:999px;padding:7px 11px;font-size:12px;font-weight:800;white-space:nowrap}.pill.good{background:#153f3b;color:#79e2c4}.pill.bad{background:#542d2d;color:#ffb5a9}.pill.muted{background:#283b55;color:#bac8da}.hero>.pill{font-size:14px;padding:10px 14px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.stat{background:#0b1e3a;border:1px solid #2a476c;border-radius:14px;padding:16px}.stat span,.stat small{display:block;color:#a9bad0}.stat span{font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:800}.stat strong{display:block;font-size:20px;margin:9px 0 5px}.stat small{font-size:12px}.panel{padding:22px;margin-top:18px}.panel h2{font:700 26px Georgia,serif;margin:0 0 7px}.panel p{color:#bfcde0;line-height:1.5;font-size:13px;margin:0 0 16px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:680px;font-size:13px}th,td{border-bottom:1px solid #29476e;padding:13px 10px;text-align:left;vertical-align:top}thead th{color:#a9bad0;font-size:11px;letter-spacing:.1em;text-transform:uppercase}tbody th{font-size:14px}.error{color:#ffb5a9}.notice{background:#0b1e3a;border-left:4px solid #f5bf3f;padding:13px 15px;color:#c4d2e5;font-size:13px;line-height:1.5}.footer{color:#90a6c0;font-size:12px;margin-top:18px}.footer a{color:#f5bf3f}@media(max-width:760px){.hero{display:block}.hero>.pill{margin-top:18px}.stats{grid-template-columns:repeat(2,1fr)}}@media(max-width:480px){.shell{padding:22px 14px 42px}.stats{grid-template-columns:1fr}.hero{padding:22px}.panel{padding:18px}}
</style></head><body><main class="shell"><header><div class="brand"><span class="logo">P</span><span>PencilProof</span></div><a class="refresh" href="/status?format=html">Refresh status</a></header>
<section class="hero"><div><span class="eyebrow">LIVE AUTOMATION</span><h1>Promotion system status</h1><p>This page shows whether the connected PencilProof social automation is running. It never displays access tokens, passwords, or customer content.</p></div><span class="pill ${overallClass}">${overallState}</span></section>
<section class="stats">${stat("Automation", status.automationEnabled === false ? "Paused" : "Enabled", "Scheduled checks are active")}${stat("Publishing", status.publishEnabled === false ? "Paused" : "Enabled", "Posts follow the configured cadence")}${stat("Replies", status.repliesEnabled === false ? "Paused" : "Enabled", "Replies remain policy-limited")}${stat("Last run", formattedStatusDate(status.lastRunAt), "Pacific time")}</section>
<section class="panel"><h2>Platform connections</h2><p>Configured means the required provider connection is present. A successful post time is shown when the system has recorded one.</p><div class="table-wrap"><table><thead><tr><th>Platform</th><th>Status</th><th>Last published</th><th>Errors</th></tr></thead><tbody>${platformRows}</tbody></table></div></section>
<section class="panel"><h2>Latest activity</h2><p>Recent activity from the direct-network loop, without exposing post or comment text.</p><div class="stats">${stat("Posts today", String(status.counters?.posts ?? 0), "Publishing actions")}${stat("Replies today", String(status.counters?.replies ?? 0), "Reply actions")}${stat("Posts scanned", String(directSummary.postsScanned ?? 0), "Latest direct run")}${stat("Warnings", String((directSummary.warningCount ?? 0) + (facebookSummary.warningCount ?? 0)), "Latest run warnings")}</div>${overallError ? `<div class="notice"><strong>Attention needed:</strong> ${escapeHtml(overallError)}</div>` : `<div class="notice"><strong>No current errors.</strong> The system is waiting for its next permitted scheduled action when the cadence and active hours allow it.</div>`}</section>
<p class="footer">Need the machine-readable response? Use <a href="/status?format=json">JSON status</a>. Read-only endpoints do not publish, reply, or change provider settings.</p></main></body></html>`;
  return new Response(html, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      Vary: "Accept",
    },
  });
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
        const publishedPost = routePostToPilot(generated, "facebook");
        const result = await publishFacebook(env, publishedPost);
        state.publishedKeys.push(publishKey);
        state.lastPostAt = now.toISOString();
        state.lastPostId = String(result?.id ?? publishKey);
        state.lastPublishedByPlatform.facebook = {
          id: state.lastPostId,
          at: now.toISOString(),
        };
        state.counters.posts += 1;
        state.recentPosts.push({ id: state.lastPostId, post: publishedPost, created: now.toISOString() });
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
      repliesEnabled: false,
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
        repliesEnabled: parseBoolean(env.SOCIAL_REPLY_ENABLED, true),
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
      const status = {
        ...directStatus,
        automationEnabled: parseBoolean(env.SOCIAL_AUTOMATION_ENABLED, true),
        publishEnabled: parseBoolean(env.SOCIAL_PUBLISH_ENABLED, false),
        repliesEnabled: parseBoolean(env.SOCIAL_REPLY_ENABLED, true),
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
      };
      return wantsHtmlStatus(request)
        ? statusPageResponse(status)
        : responseJson(status);
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
