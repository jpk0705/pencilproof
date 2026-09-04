import assert from "node:assert/strict";
import test from "node:test";
import { publicPilotUrl, routePostToPilot } from "./campaign-links.mjs";
import {
  commentKey,
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
  buildFallbackPost,
  contentHistoryEntry,
  contentPrompt,
  formatSocialPost,
  selectContentPlan,
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
