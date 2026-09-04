import test from "node:test";
import assert from "node:assert/strict";
import { validatePlan } from "./vertical-short-generator.mjs";
test("vertical short plans are bounded and deterministic", () => { assert.equal(validatePlan({ scenes: [{ text: "One", duration: 2 }, { text: "Two", duration: 3 }] }), true); assert.throws(() => validatePlan({ scenes: [{ text: "Only", duration: 2 }] }), /2_TO_12/); assert.throws(() => validatePlan({ scenes: [{ text: "One", duration: 0 }, { text: "Two", duration: 2 }] }), /SCENE_INVALID/); });
