import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Audited published YouTube targets and the 2026-11-08 Short; update for new paths.
export const PUBLISHED_PATHS = Object.freeze([
  "/analyze",
  "/guides/amount-financed-higher-than-price",
  "/guides/amount-financed-vs-total-of-payments",
  "/guides/before-you-sign-car-quote-checklist",
  "/guides/can-i-afford-this-car-payment",
  "/guides/car-dealer-fees-add-ons",
  "/guides/car-payment-different",
  "/guides/compare-car-dealer-quotes",
  "/guides/dealer-quote-review",
  "/guides/negative-equity-car-deal",
  "/guides/negative-equity-explained",
]);

export async function verifyPublishedTargets(outputRoot, paths = PUBLISHED_PATHS) {
  const failures = [];
  for (const path of paths) {
    if (!/^\/(?:[a-z0-9-]+\/)*[a-z0-9-]+$/.test(path)) {
      throw new Error(`Invalid published path: ${path}`);
    }
    const htmlPath = join(outputRoot, ...path.slice(1).split("/"), "index.html");
    try {
      const html = await readFile(htmlPath, "utf8");
      if (!/<html(?:\s|>)/i.test(html) || /<title>\s*404\b/i.test(html)) {
        failures.push(`${path} (invalid or 404 HTML)`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      failures.push(`${path} (missing ${htmlPath})`);
    }
  }
  if (failures.length) throw new Error(`Published YouTube target check failed:\n${failures.join("\n")}`);
  return paths.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
  verifyPublishedTargets(root).then((count) => {
    console.log(`Verified ${count} published YouTube targets in exported site.`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
