import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PUBLISHED_PATHS, verifyPublishedTargets } from "./verify-published-youtube-links.mjs";

test("checks built HTML and names a missing published target", async () => {
  const root = await mkdtemp(join(tmpdir(), "pencilproof-links-"));
  const analyze = join(root, "analyze");
  const html = join(analyze, "index.html");
  try {
    await mkdir(analyze);
    await writeFile(html, "<!doctype html><html><head><title>Analyze</title></head></html>");
    assert.equal(await verifyPublishedTargets(root, ["/analyze"]), 1);
    await assert.rejects(verifyPublishedTargets(root, ["/analyze", "/guides/missing"]), /\/guides\/missing \(missing/);
    await writeFile(html, "<html><title>404: Not found</title></html>");
    await assert.rejects(verifyPublishedTargets(root, ["/analyze"]), /invalid or 404 HTML/);
    await assert.rejects(verifyPublishedTargets(root, ["/../outside"]), /Invalid published path/);
  } finally {
    await rm(html, { force: true });
    await rmdir(analyze);
    await rmdir(root);
  }
});

test("audited manifest retains the legacy URL and has unique paths", () => {
  assert.equal(PUBLISHED_PATHS.length, 11);
  assert.equal(new Set(PUBLISHED_PATHS).size, PUBLISHED_PATHS.length);
  assert.ok(PUBLISHED_PATHS.includes("/guides/negative-equity-explained"));
  assert.ok(PUBLISHED_PATHS.includes("/guides/negative-equity-car-deal"));
});
