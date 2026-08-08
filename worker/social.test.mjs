import assert from "node:assert/strict";
import test from "node:test";
import {
  commentKey,
  flattenComments,
  isLikelyOwnComment,
  isWithinActiveHours,
  normalizePlatform,
  pickPublishPlatforms,
  shouldPublishNow,
  trimUnique,
  uniquePlatforms,
} from "./social.mjs";

test("normalizes and deduplicates platform names", () => {
  assert.equal(normalizePlatform("X"), "twitter");
  assert.deepEqual(uniquePlatforms(["X", "twitter", "Instagram"]), ["twitter", "instagram"]);
});

test("publish platform selection respects active and requested networks", () => {
  assert.deepEqual(
    pickPublishPlatforms(["instagram", "linkedin", "youtube"], ["linkedin", "instagram"]),
    ["instagram", "linkedin"],
  );
  assert.deepEqual(
    pickPublishPlatforms(["instagram", "youtube"], []),
    ["instagram"],
  );
});

test("flattens nested comment replies", () => {
  const payload = {
    instagram: [
      {
        commentId: "c1",
        comment: "Top level",
        username: "buyer",
        replies: [
          { commentId: "c2", comment: "Nested", username: "buyer2" },
        ],
      },
    ],
  };
  const comments = flattenComments(payload, "instagram", { id: "p1", post: "hello" });
  assert.equal(comments.length, 2);
  assert.equal(comments[1].depth, 1);
  assert.equal(commentKey(comments[0]), "instagram:c1");
});

test("detects comments authored by the linked PencilProof account", () => {
  const handles = new Set(["pencilproof"]);
  const ownIds = new Set(["own-1"]);
  assert.equal(isLikelyOwnComment({ username: "@PencilProof", commentId: "x" }, handles, ownIds), true);
  assert.equal(isLikelyOwnComment({ username: "someone", commentId: "own-1" }, handles, ownIds), true);
  assert.equal(isLikelyOwnComment({ username: "someone", commentId: "x" }, handles, ownIds), false);
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
