import assert from "node:assert/strict";
import test from "node:test";
import {
  applyVerificationFreshness,
  runReadOnlyStatusSampler,
} from "./social-status.mjs";

test("on-demand sampler uses at most two provider requests and records provenance", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/threads-user/threads?")) {
      return Response.json({
        data: [{ id: "thread-1", timestamp: "2026-08-29T18:00:00.000Z", permalink: "https://www.threads.net/@pencilproof/post/thread-1", is_reply: false }],
      });
    }
      if (url.includes("/thread-1/insights?")) {
        return Response.json({ data: [{ name: "views", values: [{ value: 0 }] }, { name: "likes", values: [{ value: 4 }] }, { name: "shares", values: [{ value: 2 }] }] });
    }
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const audit = await runReadOnlyStatusSampler(
      { THREADS_ACCESS_TOKEN: "threads-token", THREADS_USER_ID: "threads-user" },
      null,
      new Date("2026-08-29T19:00:00.000Z"),
    );
    assert.equal(requests.length, 2);
    assert.equal(audit.providerRequestsUsed, 2);
    assert.equal(audit.requestBudget, 2);
    assert.equal(audit.selectedPlatform, "threads");
    assert.equal(audit.postMetrics[0].metrics.views, 0);
    assert.equal(audit.postMetrics[0].metrics.shares, 2);
    assert.equal(audit.postMetrics[0].provenance.observations.views.kind, "measured");
    assert.equal(audit.postMetrics[0].provenance.rawMetrics.views, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Facebook reads media views and viewers in the second bounded request", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/feed?")) {
      return Response.json({
        data: [{
          id: "facebook-post-1",
          created_time: "2026-08-29T18:00:00.000Z",
          permalink_url: "https://facebook.com/post/facebook-post-1",
          from: { id: "page-1" },
          reactions: { summary: { total_count: 5 } },
          comments: { summary: { total_count: 2 } },
          shares: { count: 1 },
        }],
      });
    }
    if (url.includes("/facebook-post-1/insights?")) {
      assert.match(url, /post_media_view/);
      assert.match(url, /post_total_media_view_unique/);
      return Response.json({ data: [
        { name: "post_media_view", values: [{ value: 123 }] },
        { name: "post_total_media_view_unique", values: [{ value: 88 }] },
      ] });
    }
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const audit = await runReadOnlyStatusSampler(
      { FACEBOOK_PAGE_ID: "page-1", FACEBOOK_PAGE_ACCESS_TOKEN: "facebook-token" },
      null,
      new Date("2026-08-29T19:00:00.000Z"),
    );
    const record = audit.postMetrics[0];
    assert.equal(requests.length, 2);
    assert.equal(audit.platforms.facebook.connectionState, "verified");
    assert.equal(audit.platforms.facebook.metricsStatus, "measured");
    assert.equal(record.metrics.views, 123);
    assert.equal(record.metrics.reach, 88);
    assert.equal(record.metrics.likes, 5);
    assert.equal(record.metrics.comments, 2);
    assert.equal(record.metrics.shares, 1);
    assert.equal(record.metrics.engagement, 8);
    assert.equal(record.provenance.observations.views.providerMetric, "post_media_view");
    assert.equal(record.provenance.observations.reach.providerMetric, "post_total_media_view_unique");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Facebook can verify and measure a recorded publisher post without reading the Page feed", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    assert.doesNotMatch(url, /\/feed\?/);
    assert.match(url, /\/facebook-post-recorded\/insights\?/);
    return Response.json({ data: [
      { name: "post_media_view", values: [{ value: 41 }] },
      { name: "post_total_media_view_unique", values: [{ value: 29 }] },
    ] });
  };
  try {
    const audit = await runReadOnlyStatusSampler(
      { FACEBOOK_PAGE_ID: "page-1", FACEBOOK_PAGE_ACCESS_TOKEN: "facebook-token" },
      null,
      new Date("2026-08-29T19:00:00.000Z"),
      {
        lastPublishedByPlatform: {
          facebook: {
            id: "facebook-post-recorded",
            at: "2026-08-29T18:00:00.000Z",
            url: "https://facebook.com/post/facebook-post-recorded",
          },
        },
      },
    );
    assert.equal(requests.length, 1);
    assert.equal(audit.providerRequestsUsed, 1);
    assert.equal(audit.platforms.facebook.connectionState, "verified");
    assert.equal(audit.platforms.facebook.verificationMethod, "facebook read-only post-insights request using the recorded publisher post");
    assert.equal(audit.platforms.facebook.metricsStatus, "measured");
    assert.equal(audit.postMetrics[0].metrics.views, 41);
    assert.equal(audit.postMetrics[0].metrics.reach, 29);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Instagram reads media insights while preserving media likes and comments", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/media?")) {
      return Response.json({
        data: [{
          id: "instagram-media-1",
          timestamp: "2026-08-29T18:00:00.000Z",
          permalink: "https://instagram.com/p/instagram-media-1/",
          media_type: "IMAGE",
          media_product_type: "FEED",
          like_count: 7,
          comments_count: 2,
        }],
      });
    }
    if (url.includes("/instagram-media-1/insights?")) {
      assert.match(url, /views/);
      assert.match(url, /reach/);
      assert.match(url, /total_interactions/);
      assert.match(url, /saved/);
      assert.match(url, /shares/);
      return Response.json({ data: [
        { name: "views", values: [{ value: 500 }] },
        { name: "reach", values: [{ value: 300 }] },
        { name: "total_interactions", values: [{ value: 11 }] },
        { name: "saved", values: [{ value: 4 }] },
        { name: "shares", values: [{ value: 2 }] },
      ] });
    }
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const audit = await runReadOnlyStatusSampler(
      { INSTAGRAM_USER_ID: "instagram-user", INSTAGRAM_ACCESS_TOKEN: "instagram-token" },
      null,
      new Date("2026-08-29T19:00:00.000Z"),
    );
    const record = audit.postMetrics[0];
    assert.equal(requests.length, 2);
    assert.equal(audit.platforms.instagram.connectionState, "verified");
    assert.equal(audit.platforms.instagram.metricsStatus, "measured");
    assert.equal(record.metrics.views, 500);
    assert.equal(record.metrics.reach, 300);
    assert.equal(record.metrics.engagement, 11);
    assert.equal(record.metrics.saves, 4);
    assert.equal(record.metrics.shares, 2);
    assert.equal(record.metrics.likes, 7);
    assert.equal(record.metrics.comments, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a successful zero-post read verifies the connection", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({ data: [] });
  };
  try {
    const audit = await runReadOnlyStatusSampler(
      { THREADS_ACCESS_TOKEN: "threads-token", THREADS_USER_ID: "threads-user" },
      null,
      new Date("2026-08-29T19:00:00.000Z"),
    );
    assert.equal(requests, 1);
    assert.equal(audit.platforms.threads.connectionState, "verified");
    assert.equal(audit.platforms.threads.metricsStatus, "no_recent_post");
    assert.equal(audit.platforms.threads.verifiedAt, "2026-08-29T19:00:00.000Z");
    assert.equal(audit.errors.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an insights failure keeps the connection verified and records a separate metrics error", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/feed?")) {
      return Response.json({
        data: [{
          id: "facebook-post-2",
          created_time: "2026-08-29T18:00:00.000Z",
          permalink_url: "https://facebook.com/post/facebook-post-2",
          from: { id: "page-1" },
          reactions: { summary: { total_count: 4 } },
          comments: { summary: { total_count: 0 } },
          shares: { count: 0 },
        }],
      });
    }
    return new Response(JSON.stringify({ error: { message: "read_insights missing" } }), { status: 403, headers: { "Content-Type": "application/json" } });
  };
  try {
    const audit = await runReadOnlyStatusSampler(
      { FACEBOOK_PAGE_ID: "page-1", FACEBOOK_PAGE_ACCESS_TOKEN: "facebook-token" },
      null,
      new Date("2026-08-29T19:00:00.000Z"),
    );
    assert.equal(requests.length, 2);
    assert.equal(audit.platforms.facebook.connectionState, "verified");
    assert.equal(audit.platforms.facebook.metricsError.category, "permission");
    assert.match(audit.platforms.facebook.metricsError.message, /read_insights missing/);
    assert.equal(audit.platforms.facebook.connectionError, null);
    assert.equal(audit.postMetrics[0].metrics.likes, 4);
    assert.match(audit.errors[0], /facebook metrics/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sampler cooldown prevents repeated provider requests", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider call should not occur during cooldown");
  };
  try {
    const previous = {
      collectedAt: "2026-08-29T19:00:00.000Z",
      nextEligibleRefreshAt: "2026-08-29T19:30:00.000Z",
      nextPlatform: "instagram",
      providerRequestsUsed: 2,
      postMetrics: [],
    };
    const audit = await runReadOnlyStatusSampler({}, previous, new Date("2026-08-29T19:10:00.000Z"));
    assert.equal(audit.skipped, true);
    assert.equal(audit.providerRequestsUsed, 0);
    assert.equal(audit.nextPlatform, "instagram");
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sampler stops after the first provider error without fallback probes", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ error: { message: "token rejected" } }), { status: 401, headers: { "Content-Type": "application/json" } });
  };
  try {
    const audit = await runReadOnlyStatusSampler(
      { INSTAGRAM_ACCESS_TOKEN: "instagram-token", INSTAGRAM_USER_ID: "instagram-user" },
      null,
      new Date("2026-08-29T19:00:00.000Z"),
    );
    assert.equal(requests.length, 1);
    assert.equal(audit.providerRequestsUsed, 1);
    assert.equal(audit.ok, false);
    assert.equal(audit.platforms.instagram.connectionError.category, "authentication");
    assert.match(audit.errors[0], /token rejected/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Threads cannot be verified without an expected ID or username", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error("provider call should not occur without a Threads identity binding");
  };
  try {
    const audit = await runReadOnlyStatusSampler(
      { THREADS_ACCESS_TOKEN: "threads-token" },
      null,
      new Date("2026-08-29T19:00:00.000Z"),
    );
    assert.equal(requests, 0);
    assert.equal(audit.selectedPlatform, null);
    assert.equal(audit.platforms.threads.connectionState, "not_configured");
    assert.equal(audit.platforms.threads.expectedAccountId, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Threads verifies the token identity against the expected username without a stored numeric ID", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/me?fields=id,username")) return Response.json({ id: "threads-user", username: "pencilproof" });
    if (url.includes("/threads-user/threads?")) return Response.json({ data: [{ id: "thread-1", username: "pencilproof", timestamp: "2026-08-29T18:00:00.000Z", permalink: "https://www.threads.net/@pencilproof/post/thread-1", is_reply: false }] });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const audit = await runReadOnlyStatusSampler(
      { THREADS_ACCESS_TOKEN: "threads-token", THREADS_EXPECTED_USERNAME: "pencilproof" },
      null,
      new Date("2026-08-29T19:00:00.000Z"),
    );
    assert.equal(requests.length, 2);
    assert.equal(audit.providerRequestsUsed, 2);
    assert.equal(audit.platforms.threads.connectionState, "verified");
    assert.equal(audit.platforms.threads.accountMatched, true);
    assert.equal(audit.platforms.threads.expectedAccountId, "@pencilproof");
    assert.equal(audit.platforms.threads.verifiedAccountId, "threads-user");
    assert.equal(audit.platforms.threads.metricsStatus, "request_budget_used_for_account_verification");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Threads reuses a previously verified account ID so the second request can collect insights", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/threads-user/threads?")) {
      return Response.json({ data: [{
        id: "thread-1",
        username: "pencilproof",
        timestamp: "2026-08-29T18:00:00.000Z",
        permalink: "https://www.threads.net/@pencilproof/post/thread-1",
        is_reply: false,
      }] });
    }
    if (url.includes("/thread-1/insights?")) {
      return Response.json({ data: [
        { name: "views", values: [{ value: 20 }] },
        { name: "likes", values: [{ value: 2 }] },
        { name: "replies", values: [{ value: 1 }] },
        { name: "reposts", values: [{ value: 1 }] },
        { name: "quotes", values: [{ value: 0 }] },
      ] });
    }
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const audit = await runReadOnlyStatusSampler(
      { THREADS_ACCESS_TOKEN: "threads-token", THREADS_EXPECTED_USERNAME: "pencilproof" },
      { platforms: { threads: { connectionState: "verified", verifiedAccountId: "threads-user" } } },
      new Date("2026-08-29T19:00:00.000Z"),
      { platform: "threads" },
    );
    assert.equal(requests.length, 2);
    assert.doesNotMatch(requests[0], /\/me\?fields=id,username/);
    assert.match(requests[0], /graph\.threads\.net\/threads-user\/threads\?/);
    assert.match(requests[1], /graph\.threads\.net\/thread-1\/insights\?/);
    assert.equal(audit.platforms.threads.connectionState, "verified");
    assert.equal(audit.platforms.threads.metricsStatus, "measured");
    assert.equal(audit.postMetrics[0].metrics.views, 20);
    assert.equal(audit.postMetrics[0].metrics.engagement, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Threads rejects a token for a different username", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({ id: "wrong-user", username: "not-pencilproof" });
  };
  try {
    const audit = await runReadOnlyStatusSampler(
      { THREADS_ACCESS_TOKEN: "threads-token", THREADS_EXPECTED_USERNAME: "pencilproof" },
      null,
      new Date("2026-08-29T19:00:00.000Z"),
    );
    assert.equal(audit.platforms.threads.connectionState, "needs_attention");
    assert.equal(audit.platforms.threads.accountMatched, false);
    assert.equal(audit.platforms.threads.connectionError.category, "account_mismatch");
    assert.equal(requests, 1);
    assert.equal(audit.providerRequestsUsed, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Threads identity evidence reconciles after correcting the expected username", () => {
  const corrected = applyVerificationFreshness({
    platforms: {
      threads: {
        connectionState: "needs_attention",
        lastAttemptAt: "2026-08-30T22:14:00.000Z",
        accountMatched: false,
        apiReachable: false,
        connectionError: { category: "account_mismatch", providerCode: "pencil.proof", message: "Threads token belongs to a different account." },
      },
    },
  }, {
    THREADS_ACCESS_TOKEN: "threads-token",
    THREADS_EXPECTED_USERNAME: "pencil.proof",
  }, new Date("2026-08-30T22:20:00.000Z"));
  assert.equal(corrected.platforms.threads.connectionState, "verified");
  assert.equal(corrected.platforms.threads.apiReachable, true);
  assert.equal(corrected.platforms.threads.accountMatched, true);
  assert.equal(corrected.platforms.threads.connectionError, null);
  assert.equal(corrected.platforms.threads.expectedAccountId, "@pencil.proof");
  assert.equal(corrected.providerRequestsUsed, 1);
  assert.equal(corrected.requestsUsed, 1);
  assert.equal(corrected.verifiedCount, 1);
});

test("verification freshness becomes stale without a provider request", () => {
  const env = { FACEBOOK_PAGE_ID: "page-1", FACEBOOK_PAGE_ACCESS_TOKEN: "facebook-token" };
  const previous = {
    platforms: {
      facebook: {
        configured: true,
        connectionState: "verified",
        lastVerifiedAt: "2026-08-29T19:00:00.000Z",
        verificationExpiresAt: "2026-08-30T19:00:00.000Z",
        verifiedAccountId: "page-1",
        accountMatched: true,
      },
    },
  };
  const fresh = applyVerificationFreshness(previous, env, new Date("2026-08-30T18:59:00.000Z"));
  const stale = applyVerificationFreshness(previous, env, new Date("2026-08-30T19:00:00.000Z"));
  assert.equal(fresh.platforms.facebook.connectionState, "verified");
  assert.equal(stale.platforms.facebook.connectionState, "stale");
  assert.equal(stale.platforms.facebook.lastVerifiedAt, "2026-08-29T19:00:00.000Z");
});

test("priority selects attention and stale platforms before rotating verified platforms", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return Response.json({ data: [] });
  };
  const env = {
    FACEBOOK_PAGE_ID: "page-1",
    FACEBOOK_PAGE_ACCESS_TOKEN: "facebook-token",
    INSTAGRAM_USER_ID: "instagram-user",
    INSTAGRAM_ACCESS_TOKEN: "instagram-token",
    THREADS_USER_ID: "threads-user",
    THREADS_ACCESS_TOKEN: "threads-token",
  };
  const previous = {
    platforms: {
      facebook: { connectionState: "verified", lastVerifiedAt: "2026-08-29T18:00:00.000Z" },
      instagram: { connectionState: "stale", lastVerifiedAt: "2026-08-28T18:00:00.000Z" },
      threads: { connectionState: "needs_attention", lastVerifiedAt: "2026-08-29T17:00:00.000Z" },
    },
  };
  try {
    const audit = await runReadOnlyStatusSampler(env, previous, new Date("2026-08-30T19:00:00.000Z"));
    assert.equal(audit.selectedPlatform, "threads");
    assert.equal(requests.length, 1);
    assert.match(requests[0], /graph\.threads\.net\/threads-user\/threads\?/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit platform verification overrides rotation without exceeding two requests", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return Response.json({ data: [] });
  };
  try {
    const audit = await runReadOnlyStatusSampler(
      { INSTAGRAM_USER_ID: "instagram-user", INSTAGRAM_ACCESS_TOKEN: "instagram-token", THREADS_USER_ID: "threads-user", THREADS_ACCESS_TOKEN: "threads-token" },
      { platforms: { threads: { connectionState: "needs_attention" } } },
      new Date("2026-08-29T19:00:00.000Z"),
      { platform: "instagram" },
    );
    assert.equal(audit.selectedPlatform, "instagram");
    assert.equal(requests.length, 1);
    assert.match(requests[0], /graph\.facebook\.com\/v25\.0\/instagram-user\/media/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Facebook account mismatch is a connection failure, not a filtered success", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({ data: [{ id: "post-1", from: { id: "other-page" } }] });
  };
  try {
    const audit = await runReadOnlyStatusSampler(
      { FACEBOOK_PAGE_ID: "page-1", FACEBOOK_PAGE_ACCESS_TOKEN: "facebook-token" },
      null,
      new Date("2026-08-29T19:00:00.000Z"),
    );
    assert.equal(requests, 1);
    assert.equal(audit.platforms.facebook.connectionState, "needs_attention");
    assert.equal(audit.platforms.facebook.connectionError.category, "account_mismatch");
    assert.equal(audit.platforms.facebook.accountMatched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful HTTP with malformed JSON is classified as a provider response failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not-json", { status: 200 });
  try {
    const audit = await runReadOnlyStatusSampler(
      { INSTAGRAM_USER_ID: "instagram-user", INSTAGRAM_ACCESS_TOKEN: "instagram-token" },
      null,
      new Date("2026-08-29T19:00:00.000Z"),
    );
    assert.equal(audit.platforms.instagram.connectionState, "needs_attention");
    assert.equal(audit.platforms.instagram.connectionError.category, "malformed_response");
    assert.equal(audit.platforms.instagram.connectionError.httpStatus, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
