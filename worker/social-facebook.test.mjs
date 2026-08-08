import assert from "node:assert/strict";
import test from "node:test";
import {
  combinedConfiguredPlatforms,
  facebookCommentKey,
  facebookConfigured,
} from "./social-facebook.mjs";

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
