import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "public", "ocr");

await mkdir(output, { recursive: true });

const workerSource = join(root, "node_modules", "tesseract.js", "dist", "worker.min.js");
try {
  await access(workerSource);
  await copyFile(workerSource, join(output, "worker.min.js"));
} catch {
  const response = await fetch("https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js");
  if (!response.ok) throw new Error(`Unable to prepare OCR worker: HTTP ${response.status}`);
  await writeFile(join(output, "worker.min.js"), new Uint8Array(await response.arrayBuffer()));
}

await Promise.all([
  copyFile(
    join(root, "node_modules", "tesseract.js-core", "tesseract-core-lstm.wasm.js"),
    join(output, "tesseract-core-lstm.wasm.js"),
  ),
  copyFile(
    join(root, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"),
    join(output, "eng.traineddata.gz"),
  ),
]);
