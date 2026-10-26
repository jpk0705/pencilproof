import assert from "node:assert/strict";
import test from "node:test";
import { publicPilotUrl, routePostToPilot } from "./campaign-links.mjs";
import {
  commentKey,
  SocialAutomationState as DirectSocialAutomationState,
  detectConfiguredPlatforms,
  isLikelyOwnComment,
  isWithinActiveHours,
  normalizePlatform,
  parseAiJson,
  pickPublishPlatforms,
  runDirectReadOnlyAudit,
  shouldPublishNow,
  trimUnique,
  uniquePlatforms,
} from "./social-direct.mjs";
import { parseMetricPayload } from "./social-metrics.mjs";
import {
  buildZeroAiSocialPost,
  buildFallbackPost,
  contentHistoryEntry,
  contentPrompt,
  formatSocialPost,
  selectContentPlan,
  selectValidatedFallback,
  selectSocialAngle,
  validateSocialPost,
} from "./social-content.mjs";
import directWorker from "./social-direct.mjs";

test("campaign links send social visitors to the free pilot with attribution", () => {
  const url = publicPilotUrl("Threads");
  assert.match(url, /^https:\/\/pencilproof\.com\/pilot\?/);
  assert.match(url, /utm_source=threads/);
  assert.match(url, /utm_campaign=free_scan/);

  const post = routePostToPilot("Compare APR and amount financed. https://pencilproof.com", "threads");
  assert.match(post, /https:\/\/pencilproof\.com\/pilot\?/);
  assert.doesNotMatch(post, /https:\/\/pencilproof\.com\s*$/);
  assert.ok(post.length <= 500);

  const facebookPost = routePostToPilot("A payment can hide optional products. https://pencilproof.com", "facebook");
  assert.match(facebookPost, /utm_source=facebook/);
  const instagramPost = routePostToPilot("Check the amount financed. https://pencilproof.com", "instagram");
  assert.match(instagramPost, /utm_source=instagram/);
  const labeledPost = routePostToPilot("See the answer.", "threads", "buyer_qa");
  assert.match(labeledPost, /utm_content=buyer-qa/);
  const readablePost = routePostToPilot("Hook sentence.\n\nExplanation sentence.", "facebook");
  assert.match(readablePost, /Hook sentence\.\n\nExplanation sentence\./);
});

test("zero-AI educational posts validate across platforms without fictional customer claims", () => {
  for (const platform of ["facebook", "instagram", "threads"]) {
    const history = [];
    for (let index = 0; index < 20; index += 1) {
      const generated = buildZeroAiSocialPost(
        platform,
        history,
        new Date(Date.UTC(2026, 9, 1 + index)),
      );
      assert.equal(generated.validation.ok, true, `${platform}: ${generated.validation.reasons.join(", ")}`);
      assert.equal(generated.validation.sentenceCount, 10);
      assert.ok(generated.validation.paragraphCount >= 3);
      if (platform === "threads") assert.ok(generated.validation.length <= 420);
      assert.doesNotMatch(generated.post, /\b(?:a customer|one customer|a family|they compared|they noticed|they reviewed)\b/i);
      if (generated.plan.context === "APR and loan term") {
        assert.match(generated.post, /APR expresses (?:the )?(?:cost of borrowing|borrowing cost) as (?:a )?yearly rate/i);
        assert.match(generated.post, /note(?: interest)? rate can differ from APR/i);
      }
      assert.equal(history.slice(-8).some((entry) => entry.post === generated.post), false);
      history.push(contentHistoryEntry(platform, generated.plan, generated.post, new Date(Date.UTC(2026, 9, 1 + index))));
    }
  }
});

test("zero-AI mode publishes Threads and Instagram education without AI or replies", async () => {
  const originalFetch = globalThis.fetch;
  const RealDate = globalThis.Date;
  const fixedTime = RealDate.parse("2026-10-26T16:00:00.000Z");
  let aiCalls = 0;
  const requests = [];
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixedTime])); }
    static now() { return fixedTime; }
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method ?? "GET").toUpperCase();
    requests.push({ url, method });
    if (url.host === "graph.threads.net") {
      if (url.pathname === "/me" && method === "GET") return Response.json({ id: "threads-user", username: "pencil.proof" });
      if (url.pathname === "/me/threads" && method === "GET") {
        return Response.json({ data: [{ id: "thread-old", text: "A recent PencilProof post.", timestamp: "2026-10-24T15:00:00.000Z", is_reply: false }] });
      }
      if (url.pathname === "/thread-old/replies") return Response.json({ data: [{ id: "thread-comment", text: "Should I compare the total?", timestamp: "2026-10-26T15:30:00.000Z", username: "reader" }] });
      if (url.pathname === "/thread-old/insights") return Response.json({ data: [] });
      if (url.pathname === "/me/threads" && method === "POST") return Response.json({ id: "thread-new", permalink: "https://www.threads.net/@pencil.proof/post/thread-new" });
    }
    if (url.host === "graph.instagram.com") {
      if (url.pathname.endsWith("/instagram-user/media") && method === "GET") {
        return Response.json({ data: [{ id: "instagram-old", caption: "A recent PencilProof post.", timestamp: "2026-10-26T15:00:00.000Z", permalink: "https://www.instagram.com/p/old/" }] });
      }
      if (url.pathname === "/v24.0/instagram-old/comments") return Response.json({ data: [{ id: "instagram-comment", text: "What does APR mean?", from: { id: "reader-id", username: "reader" } }] });
      if (url.pathname === "/v24.0/instagram-old") return Response.json({ like_count: 1, comments_count: 1 });
      if (url.pathname.endsWith("/instagram-user/media") && method === "POST") return Response.json({ id: "instagram-container" });
      if (url.pathname === "/v24.0/instagram-container") return Response.json({ status_code: "FINISHED" });
      if (url.pathname.endsWith("/instagram-user/media_publish")) return Response.json({ id: "instagram-new", permalink: "https://www.instagram.com/p/new/" });
    }
    throw new Error(`Unexpected provider request: ${method} ${url}`);
  };

  try {
    const env = {
      SOCIAL_ZERO_AI_MODE: "true",
      SOCIAL_AUTOMATION_ENABLED: "true",
      SOCIAL_PUBLISH_ENABLED: "true",
      SOCIAL_REPLY_ENABLED: "true",
      SOCIAL_PUBLISH_PLATFORMS: "threads,instagram",
      SOCIAL_TIMEZONE: "UTC",
      SOCIAL_ACTIVE_START_HOUR: "8",
      SOCIAL_ACTIVE_END_HOUR: "19",
      SOCIAL_POST_INTERVAL_HOURS: "36",
      SOCIAL_MAX_POSTS_PER_DAY: "2",
      THREADS_USER_ID: "threads-user",
      THREADS_ACCESS_TOKEN: "threads-token",
      INSTAGRAM_USER_ID: "instagram-user",
      INSTAGRAM_ACCESS_TOKEN: "instagram-token",
      INSTAGRAM_IMAGE_URL: "https://pencilproof.com/pencilproof-cover.png",
      AI: { run: async () => { aiCalls += 1; throw new Error("AI must not be called"); } },
    };
    const values = new Map();
    const state = new DirectSocialAutomationState({ storage: { get: async (key) => values.get(key), put: async (key, value) => values.set(key, value) } }, env);
    const response = await state.fetch(new Request("https://social.internal/run", { method: "POST" }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(aiCalls, 0);
    assert.deepEqual(result.summary.postsPublished.map((item) => item.platform).sort(), ["instagram", "threads"]);
    assert.equal(result.summary.repliesPosted, 0);
    assert.equal(result.summary.aiCalls, 0);
    const stored = values.get("social-direct-v1");
    assert.equal(stored.seenComments.includes("threads:thread-comment"), false);
    assert.equal(stored.seenComments.includes("instagram:instagram-comment"), false);
    assert.equal(requests.some(({ method, url }) => method === "POST" && url.searchParams.has("reply_to_id")), false);
    assert.equal(requests.some(({ method, url }) => method === "POST" && url.pathname.endsWith("/replies")), false);
    assert.equal(result.summary.contentFallbacks, 2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = RealDate;
  }
});

test("manual Threads posts enforce the 36-hour cadence and unverifiable history fails closed", async () => {
  const originalFetch = globalThis.fetch;
  const RealDate = globalThis.Date;
  const fixedTime = RealDate.parse("2026-10-26T16:00:00.000Z");
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixedTime])); }
    static now() { return fixedTime; }
  };

  try {
    for (const scenario of [
      { name: "35 hours", timestamp: "2026-10-25T05:00:00.000Z", shouldPublish: false },
      { name: "36 hours", timestamp: "2026-10-25T04:00:00.000Z", shouldPublish: true },
      { name: "history error", historyError: true, shouldPublish: false },
      { name: "missing timestamp", missingTimestamp: true, shouldPublish: false },
      { name: "pagination next link", timestamp: "2026-10-25T05:00:00.000Z", pagingNext: true, shouldPublish: false },
      { name: "next without cursor", ambiguousNext: true, shouldPublish: false },
      { name: "failed continuation page", failContinuation: true, shouldPublish: false },
      { name: "full old page without next link", timestamp: "2026-10-24T04:00:00.000Z", fullPage: true, shouldPublish: true },
    ]) {
      const requests = [];
      globalThis.fetch = async (input, init = {}) => {
        const url = new URL(String(input));
        const method = String(init.method ?? "GET").toUpperCase();
        requests.push({ url, method });
        if (url.host !== "graph.threads.net") throw new Error(`Unexpected provider request: ${method} ${url}`);
        if (url.pathname === "/me" && method === "GET") return Response.json({ id: "threads-user", username: "pencil.proof" });
        if (url.pathname === "/me/threads" && method === "GET") {
          if (!url.searchParams.has("since")) return Response.json({ data: [] });
          if (scenario.historyError) return new Response(JSON.stringify({ error: { message: "temporarily unavailable" } }), { status: 503 });
          const after = url.searchParams.get("after");
          if (scenario.failContinuation && after === "cursor-1") return new Response(JSON.stringify({ error: { message: "page unavailable" } }), { status: 503 });
          if (scenario.ambiguousNext) return Response.json({ data: [], paging: { next: "https://provider.invalid/next", cursors: {} } });
          if (scenario.pagingNext && !after) {
            return Response.json({
              data: [{ id: "old-page-thread", text: "Older post.", timestamp: "2026-10-24T04:00:00.000Z", is_reply: false }],
              paging: { next: "https://provider.invalid/next", cursors: { after: "cursor-1" } },
            });
          }
          if (scenario.pagingNext && after === "cursor-1") {
            return Response.json({ data: [{ id: "manual-thread", text: "Official manually published post.", timestamp: scenario.timestamp, is_reply: false }] });
          }
          if (scenario.fullPage && after === "cursor-old") return Response.json({ data: [] });
          const count = scenario.fullPage ? 10 : 1;
          const data = Array.from({ length: count }, (_, index) => ({ id: scenario.fullPage ? `manual-thread-${index}` : "manual-thread", text: "Official manually published post.", is_reply: false }));
          if (scenario.pagingNext) return Response.json({ data, paging: { next: "https://graph.threads.net/next-page" } });
          const post = data[0];
          if (!scenario.missingTimestamp) post.timestamp = scenario.timestamp;
          if (scenario.fullPage) for (const item of data) item.timestamp = scenario.timestamp;
          return Response.json({ data, ...(scenario.fullPage ? { paging: { cursors: { after: "cursor-old" } } } : {}) });
        }
        if (/^\/(?:manual-thread(?:-\d+)?|old-page-thread)\/insights$/.test(url.pathname)) return Response.json({ data: [] });
        if (/^\/(?:manual-thread(?:-\d+)?|old-page-thread)\/replies$/.test(url.pathname)) return Response.json({ data: [] });
        if (url.pathname === "/me/threads" && method === "POST") {
          return Response.json({ id: "automated-thread", permalink: "https://www.threads.net/@pencil.proof/post/automated-thread" });
        }
        throw new Error(`Unexpected provider request: ${method} ${url}`);
      };

      const env = {
        SOCIAL_ZERO_AI_MODE: "true",
        SOCIAL_PUBLISH_ENABLED: "true",
        SOCIAL_REPLY_ENABLED: "false",
        SOCIAL_PUBLISH_PLATFORMS: "threads",
        SOCIAL_TIMEZONE: "UTC",
        SOCIAL_ACTIVE_START_HOUR: "8",
        SOCIAL_ACTIVE_END_HOUR: "19",
        SOCIAL_POST_INTERVAL_HOURS: "36",
        THREADS_USER_ID: "threads-user",
        THREADS_ACCESS_TOKEN: "threads-token",
        AI: { run: async () => { throw new Error("AI must not be called"); } },
      };
      const values = new Map();
      const state = new DirectSocialAutomationState({ storage: { get: async (key) => values.get(key), put: async (key, value) => values.set(key, value) } }, env);
      const response = await state.fetch(new Request("https://social.internal/run", { method: "POST" }));
      const result = await response.json();
      assert.equal(response.status, 200, scenario.name);
      assert.equal(result.summary.postsPublished.length === 1, scenario.shouldPublish, scenario.name);
      assert.equal(requests.some(({ method, url }) => method === "POST" && url.pathname === "/me/threads"), scenario.shouldPublish, scenario.name);
      const cadenceReads = requests.filter(({ method, url }) => method === "GET" && url.pathname === "/me/threads" && url.searchParams.has("since"));
      assert.equal(cadenceReads.length >= 1, true, scenario.name);
      assert.ok(cadenceReads.every(({ url }) => url.searchParams.get("since") === String(Math.floor((fixedTime - 36 * 60 * 60 * 1000) / 1000))), scenario.name);
      if (scenario.historyError || scenario.missingTimestamp || scenario.ambiguousNext || scenario.failContinuation) {
        assert.ok(result.summary.warnings.some((warning) => warning.includes("history") || warning.includes("unknown timestamp") || warning.includes("incomplete or paginated")), scenario.name);
      }
      assert.doesNotMatch(result.summary.warnings.join(" "), /threads-token|provider\.invalid|graph\.threads\.net/i, scenario.name);
      if (scenario.pagingNext) {
        const pages = requests.filter(({ method, url }) => method === "GET" && url.pathname === "/me/threads" && url.searchParams.has("since"));
        assert.equal(pages.length, 2, scenario.name);
        assert.deepEqual(pages.map(({ url }) => url.searchParams.get("after")), [null, "cursor-1"], scenario.name);
        assert.equal(requests.some(({ url }) => url.hostname === "provider.invalid"), false, scenario.name);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = RealDate;
  }
});

test("Threads reply monitoring keeps its 14-day lookback while cadence checks use a separate 36-hour window", async () => {
  const originalFetch = globalThis.fetch;
  const RealDate = globalThis.Date;
  const fixedTime = RealDate.parse("2026-10-26T16:00:00.000Z");
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixedTime])); }
    static now() { return fixedTime; }
  };
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method ?? "GET").toUpperCase();
    requests.push({ url, method });
    if (url.pathname === "/me" && method === "GET") return Response.json({ id: "threads-user", username: "pencil.proof" });
    if (url.pathname === "/me/threads" && method === "GET") {
      if (url.searchParams.has("since")) return Response.json({ data: [] });
      return Response.json({ data: [{ id: "old-thread", text: "Older educational post.", timestamp: "2026-10-20T16:00:00.000Z", is_reply: false }] });
    }
    if (url.pathname === "/old-thread/insights") return Response.json({ data: [] });
    if (url.pathname === "/old-thread/replies") return Response.json({ data: [{ id: "old-thread-comment", text: "What does APR mean?", timestamp: "2026-10-20T17:00:00.000Z", username: "reader" }] });
    throw new Error(`Unexpected provider request: ${method} ${url}`);
  };
  try {
    const env = {
      SOCIAL_ZERO_AI_MODE: "false",
      SOCIAL_PUBLISH_ENABLED: "true",
      SOCIAL_REPLY_ENABLED: "true",
      SOCIAL_PUBLISH_PLATFORMS: "threads",
      SOCIAL_REPLY_LOOKBACK_DAYS: "14",
      SOCIAL_POST_INTERVAL_HOURS: "36",
      SOCIAL_TIMEZONE: "UTC",
      SOCIAL_ACTIVE_START_HOUR: "20",
      SOCIAL_ACTIVE_END_HOUR: "22",
      THREADS_USER_ID: "threads-user",
      THREADS_EXPECTED_USERNAME: "pencil.proof",
      THREADS_ACCESS_TOKEN: "threads-token",
      AI: { run: async () => ({ response: JSON.stringify({ action: "ignore", reason: "test fixture" }) }) },
    };
    const values = new Map();
    const state = new DirectSocialAutomationState({ storage: { get: async (key) => values.get(key), put: async (key, value) => values.set(key, value) } }, env);
    const response = await state.fetch(new Request("https://social.internal/run", { method: "POST" }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.summary.postsScanned, 1);
    assert.equal(result.summary.commentsScanned, 1);
    assert.equal(result.summary.aiCalls, 1);
    assert.equal(result.summary.postsPublished.length, 0);
    const monitoringRead = requests.find(({ method, url }) => method === "GET" && url.pathname === "/me/threads" && !url.searchParams.has("since"));
    const cadenceRead = requests.find(({ method, url }) => method === "GET" && url.pathname === "/me/threads" && url.searchParams.has("since"));
    assert.ok(monitoringRead);
    assert.equal(cadenceRead.url.searchParams.get("since"), String(Math.floor((fixedTime - 36 * 60 * 60 * 1000) / 1000)));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = RealDate;
  }
});

test("Threads account identity must match an expected ID or username before reading history or posting", async () => {
  const originalFetch = globalThis.fetch;
  const RealDate = globalThis.Date;
  const fixedTime = RealDate.parse("2026-10-26T16:00:00.000Z");
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixedTime])); }
    static now() { return fixedTime; }
  };

  try {
    const scenarios = [
      { name: "correct identity", expectedId: "threads-user", expectedUsername: "pencil.proof", identity: { id: "threads-user", username: "pencil.proof" }, shouldPublish: true },
      { name: "username-only expected identity", expectedUsername: "pencil.proof", identity: { id: "threads-user", username: "pencil.proof" }, shouldPublish: true },
      { name: "wrong ID", expectedId: "other-user", expectedUsername: "pencil.proof", identity: { id: "threads-user", username: "pencil.proof" }, shouldPublish: false },
      { name: "wrong username", expectedId: "threads-user", expectedUsername: "brand-other", identity: { id: "threads-user", username: "pencil.proof" }, shouldPublish: false },
      { name: "missing expected identity", identity: { id: "threads-user", username: "pencil.proof" }, shouldPublish: false },
      { name: "malformed identity", expectedId: "threads-user", expectedUsername: "pencil.proof", identity: { id: "threads-user" }, shouldPublish: false },
    ];
    for (const scenario of scenarios) {
      const requests = [];
      globalThis.fetch = async (input, init = {}) => {
        const url = new URL(String(input));
        const method = String(init.method ?? "GET").toUpperCase();
        requests.push({ url, method });
        if (url.pathname === "/me" && method === "GET") return Response.json(scenario.identity);
        if (url.pathname === "/me/threads" && method === "GET") return Response.json({ data: [] });
        if (url.pathname === "/me/threads" && method === "POST") return Response.json({ id: "automated-thread", permalink: "https://www.threads.net/@pencil.proof/post/automated-thread" });
        throw new Error(`Unexpected provider request: ${method} ${url}`);
      };
      const env = {
        SOCIAL_ZERO_AI_MODE: "true",
        SOCIAL_PUBLISH_ENABLED: "true",
        SOCIAL_REPLY_ENABLED: "false",
        SOCIAL_PUBLISH_PLATFORMS: "threads",
        SOCIAL_TIMEZONE: "UTC",
        SOCIAL_ACTIVE_START_HOUR: "8",
        SOCIAL_ACTIVE_END_HOUR: "19",
        SOCIAL_POST_INTERVAL_HOURS: "36",
        THREADS_ACCESS_TOKEN: "threads-token",
        AI: { run: async () => { throw new Error("AI must not be called"); } },
      };
      if (scenario.expectedId) env.THREADS_USER_ID = scenario.expectedId;
      if (scenario.expectedUsername) env.THREADS_EXPECTED_USERNAME = scenario.expectedUsername;
      const values = new Map();
      const state = new DirectSocialAutomationState({ storage: { get: async (key) => values.get(key), put: async (key, value) => values.set(key, value) } }, env);
      const response = await state.fetch(new Request("https://social.internal/run", { method: "POST" }));
      const result = await response.json();
      assert.equal(response.status, 200, scenario.name);
      assert.equal(result.summary.postsPublished.length === 1, scenario.shouldPublish, scenario.name);
      assert.equal(requests.some(({ method, url }) => method === "GET" && url.pathname === "/me/threads"), scenario.shouldPublish, scenario.name);
      assert.equal(requests.some(({ method, url }) => method === "POST" && url.pathname === "/me/threads"), scenario.shouldPublish, scenario.name);
      if (!scenario.shouldPublish) assert.ok(result.summary.warnings.some((warning) => warning.includes("threads identity")), scenario.name);
      assert.equal(requests.some(({ url }) => url.searchParams.has("access_token")), false, scenario.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = RealDate;
  }
});

test("Threads history follows a bounded cursor window and blocks when pagination remains incomplete", async () => {
  const originalFetch = globalThis.fetch;
  const RealDate = globalThis.Date;
  const fixedTime = RealDate.parse("2026-10-26T16:00:00.000Z");
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixedTime])); }
    static now() { return fixedTime; }
  };

  try {
    for (const platform of ["threads"]) {
      const requests = [];
      globalThis.fetch = async (input, init = {}) => {
        const url = new URL(String(input));
        const method = String(init.method ?? "GET").toUpperCase();
        requests.push({ url, method });
        if (url.pathname === "/me" && method === "GET") return Response.json({ id: "threads-user", username: "pencil.proof" });
        if (url.host === "graph.threads.net" && url.pathname === "/me/threads" && method === "GET") {
          const current = Number.parseInt(String(url.searchParams.get("after") ?? "cursor-0").replace("cursor-", ""), 10);
          return Response.json({ data: [], paging: { next: "https://provider.invalid/next", cursors: { after: `cursor-${current + 1}` } } });
        }
        throw new Error(`Unexpected provider request: ${method} ${url}`);
      };
      const env = {
        SOCIAL_ZERO_AI_MODE: "true",
        SOCIAL_PUBLISH_ENABLED: "true",
        SOCIAL_REPLY_ENABLED: "false",
        SOCIAL_PUBLISH_PLATFORMS: platform,
        SOCIAL_TIMEZONE: "UTC",
        SOCIAL_ACTIVE_START_HOUR: "8",
        SOCIAL_ACTIVE_END_HOUR: "19",
        SOCIAL_POST_INTERVAL_HOURS: "36",
        THREADS_USER_ID: "threads-user",
        THREADS_ACCESS_TOKEN: "threads-token",
        AI: { run: async () => { throw new Error("AI must not be called"); } },
      };
      const values = new Map();
      const state = new DirectSocialAutomationState({ storage: { get: async (key) => values.get(key), put: async (key, value) => values.set(key, value) } }, env);
      const response = await state.fetch(new Request("https://social.internal/run", { method: "POST" }));
      const result = await response.json();
      assert.equal(response.status, 200, platform);
      assert.deepEqual(result.summary.postsPublished, [], platform);
      assert.ok(result.summary.warnings.some((warning) => warning.includes("threads history could not be verified")), platform);
      const threadReads = requests.filter(({ url, method }) => method === "GET" && url.pathname === "/me/threads" && url.searchParams.has("since"));
      assert.equal(threadReads.length, 5, platform);
      assert.ok(threadReads.every(({ url }) => url.searchParams.get("since") === String(Math.floor((fixedTime - 36 * 60 * 60 * 1000) / 1000))), platform);
      assert.deepEqual(threadReads.map(({ url }) => url.searchParams.get("after")), [null, "cursor-1", "cursor-2", "cursor-3", "cursor-4"], platform);
      assert.equal(requests.some(({ url }) => url.hostname === "provider.invalid"), false, platform);
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = RealDate;
  }
});

test("malformed Threads history responses fail closed while valid empty feeds remain valid", async () => {
  const originalFetch = globalThis.fetch;
  const RealDate = globalThis.Date;
  const fixedTime = RealDate.parse("2026-10-26T16:00:00.000Z");
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixedTime])); }
    static now() { return fixedTime; }
  };

  try {
    for (const platform of ["threads"]) {
      const env = {
        SOCIAL_ZERO_AI_MODE: "true",
        SOCIAL_PUBLISH_ENABLED: "false",
        SOCIAL_REPLY_ENABLED: "false",
        SOCIAL_PUBLISH_PLATFORMS: platform,
        SOCIAL_TIMEZONE: "UTC",
        SOCIAL_ACTIVE_START_HOUR: "8",
        SOCIAL_ACTIVE_END_HOUR: "19",
        SOCIAL_POST_INTERVAL_HOURS: "36",
        THREADS_USER_ID: "threads-user",
        THREADS_ACCESS_TOKEN: "threads-token",
        AI: { run: async () => { throw new Error("AI must not be called"); } },
      };
      const runScenario = async (historyPayload) => {
        globalThis.fetch = async (input, init = {}) => {
          const url = new URL(String(input));
          const method = String(init.method ?? "GET").toUpperCase();
          if (url.pathname === "/me" && method === "GET") return Response.json({ id: "threads-user", username: "pencil.proof" });
          if (method === "GET" && url.pathname === "/me/threads") {
            return Response.json(historyPayload);
          }
          throw new Error(`Unexpected provider request for ${platform}: ${method} ${url}`);
        };
        const values = new Map();
        const state = new DirectSocialAutomationState({ storage: { get: async (key) => values.get(key), put: async (key, value) => values.set(key, value) } }, env);
        const response = await state.fetch(new Request("https://social.internal/run", { method: "POST" }));
        return { response, result: await response.json() };
      };
      const malformed = await runScenario({ data: {} });
      assert.equal(malformed.response.status, 200, platform);
      assert.deepEqual(malformed.result.summary.postsPublished, [], platform);
      assert.ok(malformed.result.summary.warnings.some((warning) => warning.includes("threads history could not be verified")), platform);
      const empty = await runScenario({ data: [] });
      assert.equal(empty.response.status, 200, platform);
      assert.equal(empty.result.summary.warnings.some((warning) => warning.includes(`${platform} history`)), false, platform);
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = RealDate;
  }
});

test("explicitly disabled direct replies still mark scanned comments seen outside zero-AI mode", async () => {
  const originalFetch = globalThis.fetch;
  const RealDate = globalThis.Date;
  const fixedTime = RealDate.parse("2026-10-26T16:00:00.000Z");
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixedTime])); }
    static now() { return fixedTime; }
  };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/me") return Response.json({ id: "threads-user", username: "pencil.proof" });
    if (url.pathname === "/me/threads") return Response.json({ data: [{ id: "thread-old", text: "Recent post.", timestamp: "2026-10-26T15:00:00.000Z", is_reply: false }] });
    if (url.pathname === "/thread-old/insights") return Response.json({ data: [] });
    if (url.pathname === "/thread-old/replies") return Response.json({ data: [{ id: "thread-comment", text: "What does APR mean?", timestamp: "2026-10-26T15:30:00.000Z", username: "reader" }] });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const env = {
      SOCIAL_ZERO_AI_MODE: "false",
      SOCIAL_PUBLISH_ENABLED: "false",
      SOCIAL_REPLY_ENABLED: "false",
      THREADS_USER_ID: "threads-user",
      THREADS_ACCESS_TOKEN: "threads-token",
      AI: { run: async () => { throw new Error("Replies are disabled"); } },
    };
    const values = new Map();
    const state = new DirectSocialAutomationState({ storage: { get: async (key) => values.get(key), put: async (key, value) => values.set(key, value) } }, env);
    const response = await state.fetch(new Request("https://social.internal/run", { method: "POST" }));
    assert.equal(response.status, 200);
    assert.equal(values.get("social-direct-v1").seenComments.includes("threads:thread-comment"), true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = RealDate;
  }
});

test("zero-AI Threads publishing completes 20 scheduled cycles without recent repeats", async () => {
  const originalFetch = globalThis.fetch;
  const RealDate = globalThis.Date;
  const originalLog = console.log;
  const start = RealDate.parse("2026-10-01T16:00:00.000Z");
  let cycle = 0;
  let aiCalls = 0;
  const published = [];
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [start + cycle * 48 * 60 * 60 * 1000])); }
    static now() { return start + cycle * 48 * 60 * 60 * 1000; }
  };
  console.log = () => {};
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method ?? "GET").toUpperCase();
    if (url.host !== "graph.threads.net") throw new Error(`Unexpected provider request: ${method} ${url}`);
    if (url.pathname === "/me" && method === "GET") return Response.json({ id: "threads-user", username: "pencil.proof" });
    if (url.pathname === "/me/threads" && method === "GET") return Response.json({ data: [] });
    if (url.pathname === "/me/threads" && method === "POST") {
      published.push(url.searchParams.get("text"));
      return Response.json({ id: `thread-${published.length}`, permalink: `https://www.threads.net/@pencil.proof/post/thread-${published.length}` });
    }
    throw new Error(`Unexpected provider request: ${method} ${url}`);
  };

  try {
    const env = {
      SOCIAL_ZERO_AI_MODE: "true",
      SOCIAL_PUBLISH_ENABLED: "true",
      SOCIAL_REPLY_ENABLED: "true",
      SOCIAL_PUBLISH_PLATFORMS: "threads",
      SOCIAL_TIMEZONE: "UTC",
      SOCIAL_ACTIVE_START_HOUR: "8",
      SOCIAL_ACTIVE_END_HOUR: "19",
      SOCIAL_POST_INTERVAL_HOURS: "36",
      SOCIAL_MAX_POSTS_PER_DAY: "2",
      THREADS_USER_ID: "threads-user",
      THREADS_ACCESS_TOKEN: "threads-token",
      AI: { run: async () => { aiCalls += 1; throw new Error("AI must not be called"); } },
    };
    const values = new Map();
    const state = new DirectSocialAutomationState({ storage: { get: async (key) => values.get(key), put: async (key, value) => values.set(key, value) } }, env);
    for (cycle = 0; cycle < 20; cycle += 1) {
      const response = await state.fetch(new Request("https://social.internal/run", { method: "POST" }));
      const result = await response.json();
      assert.equal(response.status, 200);
      assert.equal(result.summary.postsPublished.length, 1, `cycle ${cycle}`);
      assert.equal(result.summary.aiCalls, 0, `cycle ${cycle}`);
      assert.equal(result.summary.contentPlans[0].validation.ok, true, `cycle ${cycle}`);
      assert.ok(result.summary.contentPlans[0].validation.highestSimilarity < 0.72, `cycle ${cycle}`);
      assert.equal(published.slice(-9, -1).includes(published.at(-1)), false, `cycle ${cycle} repeated a post within the history window`);
    }
    assert.equal(published.length, 20);
    assert.equal(aiCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = RealDate;
    console.log = originalLog;
  }
});

test("provider metrics normalize views, reach, engagement, and interactions", () => {
  const metrics = parseMetricPayload({
    data: [
      { name: "views", values: [{ value: 15 }] },
      { name: "reach", values: [{ value: 12 }] },
      { name: "total_interactions", values: [{ value: 3 }] },
      { name: "comments", values: [{ value: 1 }] },
    ],
  });
  assert.deepEqual(metrics, {
    views: 15,
    reach: 12,
    impressions: null,
    engagement: 3,
    comments: 1,
    replies: null,
    shares: null,
    reposts: null,
    quotes: null,
    likes: null,
    saves: null,
    linkClicks: null,
  });
});

test("content angles rotate by date and remain platform-aware", () => {
  const first = selectSocialAngle(new Date("2026-08-27T12:00:00.000Z"), "threads");
  const second = selectSocialAngle(new Date("2026-08-28T12:00:00.000Z"), "threads");
  assert.notEqual(first.topic, second.topic);
  assert.ok(first.hook && first.direction);
});

test("content plans rotate structure and context independently per platform", () => {
  const history = [
    { platform: "facebook", structure: "dealership_story", context: "APR", post: "A dealership story about APR." },
    { platform: "facebook", structure: "finance_lesson", context: "loan term", post: "A finance lesson about term." },
  ];
  const facebook = selectContentPlan(new Date("2026-08-29T12:00:00.000Z"), "facebook", history);
  const instagram = selectContentPlan(new Date("2026-08-29T12:00:00.000Z"), "instagram", []);
  assert.notEqual(facebook.structure, "dealership_story");
  assert.notEqual(facebook.structure, "finance_lesson");
  assert.notEqual(facebook.context, "APR");
  assert.notEqual(facebook.context, "loan term");
  assert.notEqual(facebook.structure, instagram.structure);
});

test("fallback content is visible, varied, and passes the sentence rules", () => {
  for (const platform of ["facebook", "instagram", "threads"]) {
    const plan = selectContentPlan(new Date("2026-08-29T12:00:00.000Z"), platform, []);
    const post = buildFallbackPost(plan, platform, []);
    const validation = validateSocialPost(post, plan, [], platform);
    assert.equal(validation.ok, true, `${platform}: ${validation.reasons.join(", ")}`);
    assert.equal(validation.sentenceCount, 10);
    assert.ok(validation.paragraphCount >= 3);
    assert.doesNotMatch(post, /a buyer reviewing/i);
  }
});

test("every Threads fallback structure passes the production validator", () => {
  const structures = [
    "conversation",
    "salesperson_coaching",
    "quick_calculation",
    "buyer_qa",
    "dealership_story",
    "salesperson_objection",
    "myth_reality",
    "closing_technique",
    "quote_comparison",
    "trade_scenario",
    "checklist",
    "finance_lesson",
  ];
  for (const structure of structures) {
    const plan = {
      structure,
      context: "amount financed",
      hook: "What changed in this dealer quote?",
    };
    const post = buildFallbackPost(plan, "threads", []);
    const validation = validateSocialPost(post, plan, [], "threads");
    assert.equal(validation.ok, true, `${structure}: ${validation.reasons.join(", ")}`);
    assert.equal(validation.sentenceCount, 10);
    assert.ok(validation.length <= 420, `${structure}: ${validation.length} characters`);
  }
});

test("Threads fallbacks remain distinct across a rolling production history", () => {
  const history = [];
  const start = new Date("2026-08-20T18:00:00.000Z");
  for (let day = 0; day < 24; day += 1) {
    const now = new Date(start.getTime() + day * 86400000);
    const plan = selectContentPlan(now, "threads", history);
    const post = buildFallbackPost(plan, "threads", history);
    const validation = validateSocialPost(post, plan, history, "threads");
    assert.equal(validation.ok, true, `day ${day} ${plan.structure}: ${validation.reasons.join(", ")}`);
    assert.ok(validation.length <= 420, `day ${day} ${plan.structure}: ${validation.length} characters`);
    history.push(contentHistoryEntry("threads", plan, post, now));
  }
});

test("Threads fallback search finds a valid post after the first candidate collides with saturated history", () => {
  const now = new Date("2026-10-09T18:00:00.000Z");
  const basePlan = selectContentPlan(now, "threads", []);
  const repeated = buildFallbackPost(basePlan, "threads", []);
  const history = Array.from({ length: 120 }, (_, index) => contentHistoryEntry(
    "threads",
    basePlan,
    repeated,
    new Date(now.getTime() - (120 - index) * 86400000),
  ));

  const selected = selectValidatedFallback(basePlan, "threads", history, 48, now);

  assert.ok(selected.attempts >= 1);
  assert.equal(selected.validation.ok, true, selected.validation.reasons.join(", "));
  assert.notEqual(selected.post, repeated);
  assert.ok(selected.validation.highestSimilarity < 0.72);
});

test("Threads fallback escapes a recent generic template without exceeding the platform limit", () => {
  const now = new Date("2026-09-24T15:00:00.000Z");
  const plan = selectContentPlan(now, "threads", []);
  const generic = buildFallbackPost(plan, "threads", []);
  const history = [contentHistoryEntry("threads", plan, generic, new Date(now.getTime() - 86400000))];
  const next = buildFallbackPost(plan, "threads", history);
  const validation = validateSocialPost(next, plan, history, "threads");
  assert.notEqual(next, generic);
  assert.ok(next.length <= 420);
  assert.equal(validation.ok, true, validation.reasons.join(", "));
  assert.ok(validation.highestSimilarity < 0.72);
});

test("Instagram fallbacks choose contextual copy when the generic template is recent", () => {
  const now = new Date("2026-09-23T15:00:00.000Z");
  const plan = selectContentPlan(now, "instagram", []);
  const generic = buildFallbackPost(plan, "instagram", []);
  const history = [contentHistoryEntry("instagram", plan, generic, new Date(now.getTime() - 86400000))];
  const next = buildFallbackPost(plan, "instagram", history);
  const validation = validateSocialPost(next, plan, history, "instagram");
  assert.notEqual(next, generic);
  assert.equal(validation.ok, true, validation.reasons.join(", "));
  assert.ok(validation.highestSimilarity < 0.72);
});

test("Threads validation still blocks an actual duplicate fallback", () => {
  const plan = selectContentPlan(new Date("2026-08-29T18:00:00.000Z"), "threads", []);
  const post = buildFallbackPost(plan, "threads", []);
  const validation = validateSocialPost(post, plan, [contentHistoryEntry("threads", plan, post)], "threads");
  assert.equal(validation.ok, false);
  assert.ok(validation.highestSimilarity >= 0.99);
  assert.match(validation.reasons.join(", "), /wording is too similar/i);
});

test("content prompts make the hook, Q&A, and free-review direction explicit", () => {
  const plan = selectContentPlan(new Date("2026-08-29T12:00:00.000Z"), "threads", []);
  const prompt = contentPrompt("threads", { ...plan, structure: "buyer_qa", structureLabel: "Buyer Q&A" }, []);
  assert.match(prompt, /first sentence must use this hook/i);
  assert.match(prompt, /Q&A session/i);
  assert.match(prompt, /tracked free-review link/i);
});

test("formatting separates a long post into readable paragraphs", () => {
  const formatted = formatSocialPost("One complete sentence here. Another complete sentence follows. A third complete sentence lands. A fourth complete sentence follows.");
  assert.match(formatted, /\n\n/);
});

test("content validation catches the old short and repetitive pattern", () => {
  const plan = selectContentPlan(new Date("2026-08-29T12:00:00.000Z"), "facebook", []);
  const recent = [{ ...plan, post: "A buyer reviewing APR can start by writing down the exact line and amount shown on the quote." }];
  const invalid = "A buyer reviewing APR can start by writing down the exact line and amount shown on the quote.";
  const validation = validateSocialPost(invalid, plan, recent, "facebook");
  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.some((reason) => reason.includes("forbidden") || reason.includes("sentence count")));
});

test("AI JSON parsing tolerates fenced output and surrounding prose", () => {
  assert.deepEqual(parseAiJson('Here is the result:\n```json\n{"post":"A useful quote check."}\n```'), {
    post: "A useful quote check.",
  });
  assert.deepEqual(parseAiJson({ post: "Already decoded." }), { post: "Already decoded." });
});

test("normalizes and deduplicates platform names", () => {
  assert.equal(normalizePlatform("X"), "twitter");
  assert.deepEqual(uniquePlatforms(["Threads", "threads", "Instagram"]), ["threads", "instagram"]);
});

test("detects direct social accounts only when their required credentials exist", () => {
  assert.deepEqual(detectConfiguredPlatforms({
    BLUESKY_HANDLE: "pencilproof.bsky.social",
    BLUESKY_APP_PASSWORD: "app-password",
    THREADS_ACCESS_TOKEN: "threads-token",
    INSTAGRAM_ACCESS_TOKEN: "ig-token",
    INSTAGRAM_USER_ID: "ig-id",
    LINKEDIN_ACCESS_TOKEN: "li-token",
    LINKEDIN_AUTHOR_URN: "urn:li:organization:123",
  }), ["bluesky", "threads", "instagram", "linkedin"]);

  assert.deepEqual(detectConfiguredPlatforms({
    BLUESKY_HANDLE: "pencilproof.bsky.social",
    INSTAGRAM_ACCESS_TOKEN: "ig-token",
  }), []);
});

test("read-only audit is inert when no direct accounts are configured", async () => {
  const audit = await runDirectReadOnlyAudit({}, new Date("2026-08-10T18:00:00.000Z"));
  assert.equal(audit.checkedAt, "2026-08-10T18:00:00.000Z");
  assert.deepEqual(audit.platforms, {});
});

test("publish selection excludes paid-only and unsupported networks", () => {
  assert.deepEqual(
    pickPublishPlatforms(["bluesky", "threads", "instagram", "linkedin"], ["threads", "x", "bluesky"]),
    ["bluesky", "threads"],
  );
});

test("detects comments authored by the linked PencilProof account", () => {
  const handles = new Set(["pencilproof"]);
  const ownIds = new Set(["own-1"]);
  assert.equal(isLikelyOwnComment({ isOwn: true, username: "buyer", commentId: "x" }, handles, ownIds), true);
  assert.equal(isLikelyOwnComment({ username: "@PencilProof", commentId: "x" }, handles, ownIds), true);
  assert.equal(isLikelyOwnComment({ username: "someone", commentId: "own-1" }, handles, ownIds), true);
  assert.equal(isLikelyOwnComment({ username: "someone", commentId: "x" }, handles, ownIds), false);
});

test("comment keys include the platform", () => {
  assert.equal(commentKey({ platform: "Threads", commentId: "123" }), "threads:123");
});

test("active-hour calculations work across normal daytime windows", () => {
  const atNinePacific = new Date("2026-08-08T16:00:00.000Z");
  const atTwentyPacific = new Date("2026-08-09T03:00:00.000Z");
  assert.equal(isWithinActiveHours(atNinePacific, "America/Los_Angeles", 8, 19), true);
  assert.equal(isWithinActiveHours(atTwentyPacific, "America/Los_Angeles", 8, 19), false);
});

test("publishing requires interval, active hours, and daily cap", () => {
  const now = new Date("2026-08-08T18:00:00.000Z");
  assert.equal(shouldPublishNow({
    now,
    lastPostAt: "2026-08-06T17:00:00.000Z",
    intervalHours: 48,
    timeZone: "America/Los_Angeles",
    activeStartHour: 8,
    activeEndHour: 19,
    postsToday: 0,
  }), true);
  assert.equal(shouldPublishNow({
    now,
    lastPostAt: "2026-08-07T18:00:00.000Z",
    intervalHours: 48,
    timeZone: "America/Los_Angeles",
    activeStartHour: 8,
    activeEndHour: 19,
    postsToday: 0,
  }), false);
  assert.equal(shouldPublishNow({
    now,
    lastPostAt: null,
    intervalHours: 48,
    timeZone: "America/Los_Angeles",
    activeStartHour: 8,
    activeEndHour: 19,
    postsToday: 1,
  }), false);
  assert.equal(shouldPublishNow({
    now,
    lastPostAt: "2026-08-08T12:00:00.000Z",
    intervalHours: 6,
    timeZone: "America/Los_Angeles",
    activeStartHour: 8,
    activeEndHour: 19,
    postsToday: 1,
    maxPostsPerDay: 2,
  }), true);
  assert.equal(shouldPublishNow({
    now,
    lastPostAt: "2026-08-08T12:00:00.000Z",
    intervalHours: 6,
    timeZone: "America/Los_Angeles",
    activeStartHour: 8,
    activeEndHour: 19,
    postsToday: 2,
    maxPostsPerDay: 2,
  }), false);
});

test("direct status adapter preserves stored post metrics", async () => {
  const env = {
    SOCIAL_STATE: {
      idFromName: () => "social-state",
      get: () => ({
        fetch: async (request) => {
          assert.equal(new URL(request.url).pathname, "/status");
          return Response.json({
            postMetrics: [{ platform: "threads", id: "thread-1", metrics: { views: 0, likes: 4 } }],
          });
        },
      }),
    },
  };
  const response = await directWorker.fetch(new Request("https://social.internal/status"), env);
  const status = await response.json();
  assert.deepEqual(status.postMetrics, [{ platform: "threads", id: "thread-1", metrics: { views: 0, likes: 4 } }]);
});

test("read-only audit collects supported provider post metrics without side effects", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/me/threads?")) {
      return Response.json({
        data: [{ id: "thread-1", text: "Payment math", timestamp: "2026-08-27T17:00:00.000Z", permalink: "https://www.threads.net/@pencilproof/post/thread-1", is_reply: false }],
      });
    }
    if (url.includes("/thread-1/insights?")) {
      return Response.json({
        data: [
          { name: "views", values: [{ value: 15 }] },
          { name: "likes", values: [{ value: 2 }] },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const audit = await runDirectReadOnlyAudit({ THREADS_ACCESS_TOKEN: "threads-token" }, new Date("2026-08-27T18:00:00.000Z"));
    assert.equal(audit.platforms.threads.postMetrics[0].available, true);
    assert.equal(audit.platforms.threads.postMetrics[0].metrics.views, 15);
    assert.equal(audit.platforms.threads.postMetrics[0].metrics.likes, 2);
    assert.equal(audit.platforms.threads.postMetrics[0].metrics.engagement, 2);
    assert.equal(audit.platforms.threads.postMetrics[0].provenance.observations.engagement.kind, "derived");
    assert.equal(audit.requestsUsed, 2);
    assert.equal(audit.requestBudget, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Bluesky feed counts populate metrics without a separate metrics request", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("createSession")) return Response.json({ accessJwt: "jwt", did: "did:plc:owner" });
    if (url.includes("getAuthorFeed")) {
      return Response.json({
        feed: [{
          post: {
            uri: "at://did:plc:owner/app.bsky.feed.post/abc",
            cid: "cid",
            author: { did: "did:plc:owner", handle: "pencilproof.bsky.social" },
            record: { text: "A post", createdAt: "2026-08-27T17:00:00.000Z" },
            likeCount: 0,
            replyCount: 2,
            repostCount: 3,
            quoteCount: 1,
          },
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const audit = await runDirectReadOnlyAudit({
      BLUESKY_HANDLE: "pencilproof.bsky.social",
      BLUESKY_APP_PASSWORD: "app-password",
    }, new Date("2026-08-27T18:00:00.000Z"));
    const record = audit.platforms.bluesky.postMetrics[0];
    assert.equal(record.metrics.likes, 0);
    assert.equal(record.metrics.replies, 2);
    assert.equal(record.metrics.reposts, 3);
    assert.equal(record.metrics.quotes, 1);
    assert.equal(record.metrics.engagement, 6);
    assert.equal(record.provenance.observations.engagement.kind, "derived");
    assert.equal(requests.length, 2);
    assert.ok(requests.every((url) => !url.includes("insights") && !url.includes("metrics")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Instagram metrics errors do not trigger a fallback cascade", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/media?")) {
      return Response.json({ data: [{ id: "media-1", caption: "A post", timestamp: "2026-08-27T17:00:00.000Z", permalink: "https://www.instagram.com/p/media-1/" }] });
    }
    return new Response(JSON.stringify({ error: { message: "metrics unavailable" } }), { status: 403, headers: { "Content-Type": "application/json" } });
  };
  try {
    const audit = await runDirectReadOnlyAudit({
      INSTAGRAM_ACCESS_TOKEN: "instagram-token",
      INSTAGRAM_USER_ID: "instagram-user",
    }, new Date("2026-08-27T18:00:00.000Z"));
    const record = audit.platforms.instagram.postMetrics[0];
    assert.equal(record.status, "error");
    assert.match(record.error, /metrics unavailable/);
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("trimUnique keeps the newest distinct values", () => {
  assert.deepEqual(trimUnique(["a", "b", "a", "c", "d"], 3), ["a", "c", "d"]);
});
