import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "public", "ocr");

await mkdir(output, { recursive: true });

const copyOrFetch = async (source, destination, url) => {
  try {
    await access(source);
    await copyFile(source, destination);
    return;
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to prepare OCR asset: HTTP ${response.status}`);
    await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
  }
};

await Promise.all([
  copyOrFetch(
    join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
    join(output, "worker.min.js"),
    "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js",
  ),
  copyOrFetch(
    join(root, "node_modules", "tesseract.js-core", "tesseract-core-lstm.wasm.js"),
    join(output, "tesseract-core-lstm.wasm.js"),
    "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-lstm.wasm.js",
  ),
  copyOrFetch(
    join(root, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"),
    join(output, "eng.traineddata.gz"),
    "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz",
  ),
]);
