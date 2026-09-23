import assert from "node:assert/strict";
import test from "node:test";
import { validateShortPlan } from "./youtube-short-generator.mjs";

const valid = {
  scenes: Array.from({ length: 6 }, (_, index) => ({ text: `Scene ${index + 1} has useful copy`, duration: 6 })),
};

test("accepts a complete 30 to 45 second vertical short plan", () => {
  assert.equal(validateShortPlan(valid), true);
});

test("rejects plans that are too short", () => {
  assert.throws(() => validateShortPlan({ scenes: valid.scenes.map((scene) => ({ ...scene, duration: 4 })) }), /30_TO_45/);
});

test("rejects unreadable scene timing", () => {
  const scenes = valid.scenes.map((scene) => ({ ...scene }));
  scenes[0].duration = 2;
  assert.throws(() => validateShortPlan({ scenes }), /SCENE_INVALID/);
});
