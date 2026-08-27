import assert from "node:assert/strict";
import test from "node:test";
import {
  combinedConfiguredPlatforms,
  facebookCommentKey,
  facebookConfigured,
} from "./social-facebook.mjs";
import socialWorker from "./social-facebook.mjs";

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

test("browser status view is readable while JSON status remains available", async () => {
  const env = {
    SOCIAL_AUTOMATION_ENABLED: "true",
    SOCIAL_PUBLISH_ENABLED: "true",
    SOCIAL_REPLY_ENABLED: "true",
    THREADS_ACCESS_TOKEN: "threads-token",
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
  assert.match(html, /Promotion system status/);
  assert.match(html, /Threads/);
  assert.match(html, /https:\/\/www\.threads\.net\/@pencilproof\/post\/18090197546296438/);
  assert.match(html, /https:\/\/www\.instagram\.com\/p\/example\//);
  assert.match(html, /https:\/\/www\.facebook\.com\/123_456/);
  assert.match(html, /Last post \(Pacific\)/);
  assert.match(html, /No current errors/);

  const jsonResponse = await socialWorker.fetch(
    new Request("https://pencilproof-social.jpkwork0705.workers.dev/status?format=json", { headers: { Accept: "text/html" } }),
    env,
  );
  const json = await jsonResponse.json();
  assert.equal(json.configuredPlatforms[0], "threads");
  assert.equal(json.lastSummary.postsScanned, 4);
});
