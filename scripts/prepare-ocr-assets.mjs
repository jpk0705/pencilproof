import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "public", "ocr");

await mkdir(output, { recursive: true });

await Promise.all([
  copyFile(
    join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
    join(output, "worker.min.js"),
  ),
  copyFile(
    join(root, "node_modules", "tesseract.js-core", "tesseract-core-lstm.wasm.js"),
    join(output, "tesseract-core-lstm.wasm.js"),
  ),
  copyFile(
    join(root, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"),
    join(output, "eng.traineddata.gz"),
  ),
]);
