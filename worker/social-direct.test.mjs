import assert from "node:assert/strict";
import test from "node:test";
import {
  commentKey,
  detectConfiguredPlatforms,
  isLikelyOwnComment,
  isWithinActiveHours,
  normalizePlatform,
  pickPublishPlatforms,
  shouldPublishNow,
  trimUnique,
  uniquePlatforms,
} from "./social-direct.mjs";

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
});

test("trimUnique keeps the newest distinct values", () => {
  assert.deepEqual(trimUnique(["a", "b", "a", "c", "d"], 3), ["a", "c", "d"]);
});
