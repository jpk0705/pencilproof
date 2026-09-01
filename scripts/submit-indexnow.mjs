import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sitemap = await readFile(join(root, "public", "sitemap.xml"), "utf8");
const key = "34b058ca-7d36-4052-ac50-a56d3de97540";
const urlList = Array.from(sitemap.matchAll(/<loc>(https:\/\/pencilproof\.com\/[^<]*)<\/loc>/g), (match) => match[1]);
if (!urlList.length) throw new Error("INDEXNOW_URL_LIST_EMPTY");
const keyResponse = await fetch(`https://pencilproof.com/${key}.txt`);
if (!keyResponse.ok || (await keyResponse.text()).trim() !== key) throw new Error("INDEXNOW_KEY_NOT_LIVE");
const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ host: "pencilproof.com", key, keyLocation: `https://pencilproof.com/${key}.txt`, urlList }),
});
if (![200, 202].includes(response.status)) throw new Error(`INDEXNOW_HTTP_${response.status}`);
console.log(JSON.stringify({ accepted: true, status: response.status, submitted: urlList.length }));
