import test from "node:test";
import assert from "node:assert/strict";

const { track, flushAnalyticsQueue } = await import("../lib/analytics.ts");

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("local previews do not send events; the public site still does", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const sent = [];
  globalThis.document = { referrer: "" };
  globalThis.fetch = async (url, options) => {
    sent.push({ url, event: JSON.parse(options.body) });
    return { ok: true };
  };

  try {
    for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
      globalThis.window = { location: { hostname, search: "", pathname: "/" }, localStorage: storage(), sessionStorage: storage(), innerWidth: 900 };
      track({ event: "page_view" });
      await flushAnalyticsQueue();
    }
    assert.equal(sent.length, 0);

    globalThis.window = { location: { hostname: "pencilproof.com", search: "", pathname: "/" }, localStorage: storage(), sessionStorage: storage(), innerWidth: 900 };
    track({ event: "page_view" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].event.event, "page_view");
    assert.equal(sent[0].url, "https://audit.pencilproof.com/api/analytics/event");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});
