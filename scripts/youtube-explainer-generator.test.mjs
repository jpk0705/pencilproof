import test from "node:test";
import assert from "node:assert/strict";
import { validateExplainerPlan } from "./youtube-explainer-generator.mjs";

const scene = { text: "CHECK THE WRITTEN QUOTE", caption: "Fictional educational example", duration: 10, crop: { x: 0, y: 0, width: 512, height: 512 } };
test("explainer plans are long-form and bounded", () => { assert.equal(validateExplainerPlan({ sourceImage: "visual.png", scenes: Array.from({length:12},()=>({...scene})) }), true); assert.throws(()=>validateExplainerPlan({sourceImage:"visual.png",scenes:Array.from({length:8},()=>({...scene}))}),/DURATION/); });
