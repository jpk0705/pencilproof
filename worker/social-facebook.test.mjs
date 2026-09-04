import assert from "node:assert/strict";
import test from "node:test";
import {
  combinedConfiguredPlatforms,
  facebookCommentKey,
  facebookConfigured,
  parseAiJson,
  SocialAutomationState,
  collectScheduledOperationsStatus,
  repairScheduledSocialAutomation,
} from "./social-facebook.mjs";
import socialWorker from "./social-facebook.mjs";
import { formatMetricValue, mergeNewestPostMetrics } from "./social-metrics.mjs";

test("Facebook requires both Page ID and Page access token", () => {
  assert.equal(facebookConfigured({ FACEBOOK_PAGE_ID: "123", FACEBOOK_PAGE_ACCESS_TOKEN: "token" }), true);
  assert.equal(facebookConfigured({ FACEBOOK_PAGE_ID: "123" }), false);
  assert.equal(facebookConfigured({ FACEBOOK_PAGE_ACCESS_TOKEN: "token" }), false);
});

test("combined configured platforms includes Facebook once", () => {
  assert.deepEqual(combinedConfiguredPlatforms({
    FACEBOOK_PAGE_ID: "123",
    FACEBOOK_PAGE_ACCESS_TOKEN: "token",
    THREADS_ACCESS_TOKEN: "threads-token",
  }), ["threads", "facebook"]);
});

test("Facebook comment keys are namespaced", () => {
  assert.equal(facebookCommentKey({ commentId: "456" }), "facebook:456");
});

test("Facebook AI JSON parsing tolerates surrounding prose", () => {
  assert.deepEqual(parseAiJson('Result:\n{"post":"Check the amount financed."}\nThanks.'), {
    post: "Check the amount financed.",
  });
});

test("browser status view is readable while JSON status remains available", async () => {
  const env = {
    SOCIAL_AUTOMATION_ENABLED: "true",
    SOCIAL_PUBLISH_ENABLED: "true",
    SOCIAL_REPLY_ENABLED: "true",
    FACEBOOK_PAGE_ID: "page",
    FACEBOOK_PAGE_ACCESS_TOKEN: "facebook-token",
    INSTAGRAM_USER_ID: "instagram-user",
    INSTAGRAM_ACCESS_TOKEN: "instagram-token",
    THREADS_ACCESS_TOKEN: "threads-token",
    THREADS_USER_ID: "threads-user",
    SOCIAL_STATE: {
      idFromName: () => "social-state",
      get: () => ({
        fetch: async (request) => {
          const path = new URL(request.url).pathname;
          if (path === "/status") {
            return Response.json({
              lastRunAt: "2026-08-27T22:00:00.000Z",
              lastPostAt: "2026-08-27T17:00:00.000Z",
              lastError: null,
              lastPublishedByPlatform: {
                threads: { at: "2026-08-27T17:00:00.000Z", url: "https://www.threads.net/@pencilproof/post/18090197546296438" },
                instagram: { at: "2026-08-27T01:00:00.000Z", url: "https://www.instagram.com/p/example/" },
              },
              postMetrics: [
                { platform: "threads", id: "thread-1", created: "2026-08-27T17:00:00.000Z", fetchedAt: "2026-08-27T18:00:00.000Z", url: "https://www.threads.net/@pencilproof/post/18090197546296438", available: true, metrics: { views: 15, reach: 12, engagement: 3, comments: 1 } },
                { platform: "threads", id: "thread-zero", created: "2026-08-26T17:00:00.000Z", fetchedAt: "2026-08-27T18:00:00.000Z", available: true, metrics: { views: 0, impressions: null } },
              ],
              counters: { posts: 1, replies: 0 },
              lastSummary: { postsScanned: 4, warningCount: 0 },
            });
          }
          if (path === "/facebook-status") {
            return Response.json({
              lastError: null,
              lastSummary: null,
              lastPublishedByPlatform: { facebook: { at: "2026-08-27T01:30:00.000Z", url: "https://www.facebook.com/123_456" } },
            });
          }
          return new Response("Not found", { status: 404 });
        },
      }),
    },
  };

  const htmlResponse = await socialWorker.fetch(
    new Request("https://pencilproof-social.jpkwork0705.workers.dev/status", { headers: { Accept: "text/html" } }),
    env,
  );
  const html = await htmlResponse.text();
  assert.equal(htmlResponse.status, 200);
  assert.equal(htmlResponse.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.match(html, /What works\. What needs attention\./);
  assert.match(html, /Threads/);
  assert.match(html, /https:\/\/www\.threads\.net\/@pencilproof\/post\/18090197546296438/);
  assert.match(html, /https:\/\/www\.instagram\.com\/p\/example\//);
  assert.match(html, /https:\/\/www\.facebook\.com\/123_456/);
  assert.match(html, /Platform connections and latest posts/);
  assert.match(html, /Email activity/);
  assert.match(html, /Seven-day traffic funnel/);
  assert.match(html, /Normal page loads make 0 provider requests/);
  assert.doesNotMatch(html, /Unavailable|Not exposed/);
  assert.match(html, /Incidents and automatic repair/);
  assert.match(html, /15/);

  const jsonResponse = await socialWorker.fetch(
    new Request("https://pencilproof-social.jpkwork0705.workers.dev/status?format=json", { headers: { Accept: "text/html" } }),
    env,
  );
  const json = await jsonResponse.json();
  assert.equal(json.platforms.threads.configured, true);
  assert.equal(json.platforms.threads.metrics.views, 15);

  const aliasResponse = await socialWorker.fetch(
    new Request("https://pencilproof-social.jpkwork0705.workers.dev/status.json", { headers: { Accept: "text/html" } }),
    env,
  );
  assert.equal(aliasResponse.status, 200);
  assert.equal(aliasResponse.headers.get("Content-Type"), "application/json; charset=utf-8");
  const aliasJson = await aliasResponse.json();
  assert.deepEqual(aliasJson.platforms, json.platforms);
});

test("newest stored metric record wins and preserves measured versus derived provenance", () => {
  const older = {
    platform: "threads",
    id: "thread-1",
    fetchedAt: "2026-08-29T10:00:00.000Z",
    metrics: { views: 4, likes: 2 },
  };
  const newer = {
    platform: "threads",
    id: "thread-1",
    fetchedAt: "2026-08-29T11:00:00.000Z",
    metrics: { views: null, likes: 3, engagement: 3 },
    provenance: { observations: { engagement: { kind: "derived", formula: "likes + replies" } } },
  };
  const merged = mergeNewestPostMetrics([older], [newer]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].metrics.views, 4);
  assert.equal(merged[0].metrics.likes, 3);
  assert.equal(merged[0].provenance.observations.engagement.kind, "derived");
  assert.equal(formatMetricValue(0), "0");
  assert.equal(formatMetricValue(null), "—");
});

test("stored audit endpoint does not call providers", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider call should not occur on stored audit");
  };
  try {
    const env = {
      SOCIAL_STATE: {
        idFromName: () => "social-state",
        get: () => ({
          fetch: async (request) => {
            assert.equal(new URL(request.url).pathname, "/facebook-status");
            return Response.json({ readOnlyAudit: { ok: true, collectedAt: "2026-08-29T22:00:00.000Z", requestsUsed: 2, requestBudget: 2, postMetrics: [] } });
          },
        }),
      },
    };
    const response = await socialWorker.fetch(new Request("https://pencilproof-social.jpkwork0705.workers.dev/audit"), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).requestsUsed, 2);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit refresh uses the isolated status namespace and normal loads stay cached", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const values = new Map();
  let fullBusinessCalls = 0;
  let lightweightBusinessCalls = 0;
  const durableState = new SocialAutomationState({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
    },
  }, {});
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/threads-user/threads?")) return Response.json({ data: [{ id: "thread-1", timestamp: "2026-08-29T18:00:00.000Z", permalink: "https://www.threads.net/@pencilproof/post/thread-1", is_reply: false }] });
    if (url.includes("/thread-1/insights?")) return Response.json({ data: [{ name: "views", values: [{ value: 9 }] }] });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const env = {
      THREADS_ACCESS_TOKEN: "threads-token",
      THREADS_USER_ID: "threads-user",
      SOCIAL_STATE: {
        idFromName: () => "social-state",
        get: () => durableState,
      },
      AUDIT_SERVICE: {
        fetch: async (request) => {
          const path = new URL(request.url).pathname;
          if (path === "/api/internal/automation-status") {
            lightweightBusinessCalls += 1;
            return Response.json({
              generatedAt: new Date().toISOString(),
              email: { automation: { state: "healthy", lastRun: { status: "healthy" } }, localDeliveries: { sent: 0 } },
            });
          }
          fullBusinessCalls += 1;
          return Response.json({
            generatedAt: "2026-08-29T18:00:00.000Z",
            email: {
              automation: { state: "healthy", lastRun: { status: "healthy" } },
              provider: { status: "verified", messages: 5 },
              localDeliveries: { sent: 0 },
            },
            traffic: { status: "verified", funnel: { visitors: 7 } },
          });
        },
      },
    };
    const refreshed = await socialWorker.fetch(new Request("https://pencilproof-social.jpkwork0705.workers.dev/status?format=json&refresh=1"), env);
    const refreshedJson = await refreshed.json();
    assert.equal(requests.length, 2);
    assert.equal(refreshedJson.collection.socialProviderRequestsLastCycle, 2);
    assert.equal(refreshedJson.platforms.threads.metrics.views, 9);
    assert.equal(refreshedJson.email.provider.messages, 5);
    assert.equal(refreshedJson.email.automation.state, "healthy");
    assert.equal(refreshedJson.traffic.funnel.visitors, 7);
    assert.equal(fullBusinessCalls, 1);
    assert.equal(lightweightBusinessCalls, 1);
    assert.ok(values.has("social-status-v1"));
    const facebookState = values.get("social-facebook-v1");
    assert.equal(facebookState?.readOnlyAudit, undefined);

    requests.length = 0;
    globalThis.fetch = async () => { throw new Error("provider call should not occur on normal status"); };
    const cached = await socialWorker.fetch(new Request("https://pencilproof-social.jpkwork0705.workers.dev/status?format=json"), env);
    const cachedJson = await cached.json();
    assert.equal(requests.length, 0);
    assert.equal(cachedJson.platforms.threads.metrics.views, 9);
    assert.equal(cachedJson.email.provider.messages, 5);
    assert.equal(cachedJson.email.automation.state, "healthy");
    assert.equal(fullBusinessCalls, 1);
    assert.equal(lightweightBusinessCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scheduled operations collection stays within provider and business-sync limits", async () => {
  const originalFetch = globalThis.fetch;
  const values = new Map();
  let providerCalls = 0;
  let businessCalls = 0;
  const env = {
    THREADS_ACCESS_TOKEN: "threads-token",
    THREADS_USER_ID: "threads-user",
    SOCIAL_STATE: {
      idFromName: () => "social-state",
      get: () => durableState,
    },
    AUDIT_SERVICE: {
      fetch: async () => {
        businessCalls += 1;
        return Response.json({
          generatedAt: "2026-08-30T18:00:00.000Z",
          email: { provider: { status: "verified", messages: 2 }, automation: { state: "healthy" } },
          traffic: { status: "verified", funnel: { visitors: 3 } },
        });
      },
    },
  };
  const durableState = new SocialAutomationState({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
      delete: async (key) => values.delete(key),
    },
  }, env);
  globalThis.fetch = async (input) => {
    providerCalls += 1;
    const url = String(input);
    if (url.includes("/threads-user/threads?")) return Response.json({ data: [{ id: "thread-1", timestamp: "2026-08-30T17:00:00.000Z", permalink: "https://www.threads.net/@pencilproof/post/thread-1", is_reply: false }] });
    if (url.includes("/thread-1/insights?")) return Response.json({ data: [{ name: "views", values: [{ value: 4 }] }] });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    await collectScheduledOperationsStatus(env, new Date("2026-08-30T18:00:00.000Z"));
    assert.equal(providerCalls, 2);
    assert.equal(businessCalls, 1);
    assert.equal(values.get("social-status-v1").providerRequestsUsed, 2);
    assert.equal(values.get("operations-business-status-v1").email.provider.messages, 2);

    await collectScheduledOperationsStatus(env, new Date("2026-08-30T19:00:00.000Z"));
    assert.equal(providerCalls, 2);
    assert.equal(businessCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations watchdog repairs stale or failed configured social branches", async () => {
  let directRuns = 0;
  let facebookRuns = 0;
  let storedRepair = null;
  let fresh = false;
  let directError = false;
  let facebookError = false;
  const env = {
    SOCIAL_AUTOMATION_ENABLED: "true",
    THREADS_ACCESS_TOKEN: "threads-token",
    THREADS_USER_ID: "threads-user",
    FACEBOOK_PAGE_ID: "facebook-page",
    FACEBOOK_PAGE_ACCESS_TOKEN: "facebook-token",
    SOCIAL_STATE: {
      idFromName: () => "social-state",
      get: () => ({
        fetch: async (request) => {
          const path = new URL(request.url).pathname;
          if (path === "/status") return Response.json({ lastRunAt: fresh ? "2026-08-30T17:50:00.000Z" : "2026-08-30T12:00:00.000Z", lastError: directError ? "publish failed" : null });
          if (path === "/facebook-status") return Response.json({ lastRunAt: fresh ? "2026-08-30T17:50:00.000Z" : "2026-08-30T12:00:00.000Z", lastError: facebookError ? "reply failed" : null });
          if (path === "/run") {
            directRuns += 1;
            return Response.json({ ok: true });
          }
          if (path === "/facebook-run") {
            facebookRuns += 1;
            return Response.json({ ok: true });
          }
          if (path === "/operations-repair") {
            storedRepair = await request.json();
            return Response.json({ ok: true });
          }
          return new Response("Not found", { status: 404 });
        },
      }),
    },
  };
  const now = new Date("2026-08-30T18:00:00.000Z");
  const repaired = await repairScheduledSocialAutomation(env, { cron: "7 * * * *", scheduledTime: now.getTime() }, now);
  assert.equal(directRuns, 1);
  assert.equal(facebookRuns, 1);
  assert.deepEqual(repaired.repaired, ["threads/instagram automation", "facebook automation"]);
  assert.deepEqual(storedRepair.repaired, repaired.repaired);

  fresh = true;
  const healthy = await repairScheduledSocialAutomation(env, { cron: "7 * * * *", scheduledTime: now.getTime() }, now);
  assert.equal(directRuns, 1);
  assert.equal(facebookRuns, 1);
  assert.deepEqual(healthy.attempted, []);

  directError = true;
  facebookError = true;
  const failed = await repairScheduledSocialAutomation(env, { cron: "7 * * * *", scheduledTime: now.getTime() }, now);
  assert.equal(directRuns, 2);
  assert.equal(facebookRuns, 2);
  assert.deepEqual(failed.repaired, ["threads/instagram automation", "facebook automation"]);
});

test("normal status loads do not call provider APIs", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider call should not occur on a cached status load");
  };

  try {
    const env = {
      THREADS_ACCESS_TOKEN: "threads-token",
      INSTAGRAM_ACCESS_TOKEN: "instagram-token",
      INSTAGRAM_USER_ID: "instagram-user",
      FACEBOOK_PAGE_ID: "page",
      FACEBOOK_PAGE_ACCESS_TOKEN: "facebook-token",
      SOCIAL_STATE: {
        idFromName: () => "social-state",
        get: () => ({
          fetch: async (request) => {
            const path = new URL(request.url).pathname;
            if (path === "/status") return Response.json({ lastPublishedByPlatform: {}, postMetrics: [], counters: { posts: 0, replies: 0 } });
            if (path === "/facebook-status") return Response.json({ lastPublishedByPlatform: {}, postMetrics: [], counters: { posts: 0, replies: 0 } });
            return new Response("Not found", { status: 404 });
          },
        }),
      },
    };

    const response = await socialWorker.fetch(
      new Request("https://pencilproof-social.jpkwork0705.workers.dev/status", { headers: { Accept: "text/html" } }),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("read-only reporting snapshots persist metrics and provenance for normal loads", async () => {
  const values = new Map();
  const state = {
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
    },
  };
  const durableState = new SocialAutomationState(state, {});
  const saveResponse = await durableState.fetch(new Request("https://social.internal/read-only-audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      checkedAt: "2026-08-29T22:00:00.000Z",
      collectedAt: "2026-08-29T22:00:00.000Z",
      nextPlatform: "instagram",
      requestsUsed: 2,
      requestBudget: 2,
      postMetrics: [{
        platform: "threads",
        id: "thread-1",
        fetchedAt: "2026-08-29T22:00:00.000Z",
        metrics: { views: 15, impressions: null },
        provenance: { source: "threads insights", observations: { views: { value: 15, kind: "measured", source: "threads insights" } } },
      }],
    }),
  }));
  assert.equal(saveResponse.status, 200);
  const statusResponse = await durableState.fetch(new Request("https://social.internal/facebook-status"));
  const status = await statusResponse.json();
  assert.equal(status.readOnlyAudit.nextPlatform, "instagram");
  assert.equal(status.readOnlyAudit.requestsUsed, 2);
  assert.equal(status.readOnlyAudit.requestBudget, 2);
  assert.equal(status.readOnlyAudit.resend, undefined);
  assert.equal(status.readOnlyAudit.postMetrics[0].metrics.views, 15);
  assert.equal(status.readOnlyAudit.postMetrics[0].provenance.observations.views.kind, "measured");
});

test("status never calls providers to resolve missing post IDs", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (input) => {
    providerCalls += 1;
    throw new Error(`Unexpected provider request: ${String(input)}`);
  };

  try {
    const env = {
      THREADS_ACCESS_TOKEN: "threads-token",
      FACEBOOK_PAGE_ID: "page",
      FACEBOOK_PAGE_ACCESS_TOKEN: "facebook-token",
      SOCIAL_STATE: {
        idFromName: () => "social-state",
        get: () => ({
          fetch: async (request) => {
            const path = new URL(request.url).pathname;
            if (path === "/status") {
              return Response.json({
                lastPublishedByPlatform: { threads: { id: "thread-1", at: "2026-08-27T17:00:00.000Z" } },
                counters: { posts: 1, replies: 0 },
                lastSummary: null,
              });
            }
            if (path === "/facebook-status") {
              return Response.json({
                lastPublishedByPlatform: { facebook: { id: "page-1", at: "2026-08-27T17:00:00.000Z" } },
                lastSummary: null,
              });
            }
            return new Response("Not found", { status: 404 });
          },
        }),
      },
    };

    const response = await socialWorker.fetch(new Request("https://pencilproof-social.jpkwork0705.workers.dev/status?format=json"), env);
    const json = await response.json();
    assert.equal(json.platforms.threads.lastPost.url, null);
    assert.equal(json.platforms.facebook.lastPost.url, null);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verification lease allows one active check and blocks concurrent or cooling-down checks", async () => {
  const values = new Map();
  const storage = {
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, value),
    delete: async (key) => values.delete(key),
  };
  const durableState = new SocialAutomationState({ storage }, {});
  const first = await durableState.fetch(new Request("https://social.internal/claim-read-only-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "first", now: "2026-08-30T19:00:00.000Z" }),
  }));
  assert.equal((await first.json()).ok, true);

  const concurrent = await durableState.fetch(new Request("https://social.internal/claim-read-only-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "second", now: "2026-08-30T19:00:01.000Z" }),
  }));
  assert.equal((await concurrent.json()).reason, "lease");

  await durableState.fetch(new Request("https://social.internal/release-read-only-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "first" }),
  }));
  await durableState.fetch(new Request("https://social.internal/read-only-audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nextEligibleRefreshAt: "2026-08-30T19:30:00.000Z" }),
  }));
  const cooldown = await durableState.fetch(new Request("https://social.internal/claim-read-only-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "third", now: "2026-08-30T19:10:00.000Z" }),
  }));
  assert.equal((await cooldown.json()).reason, "cooldown");
});
