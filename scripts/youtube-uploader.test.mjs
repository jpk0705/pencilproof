import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  authorizeInstalledYouTubeApp,
  buildYouTubeUploadPlan,
  createPkceAuthorizationRequest,
  dryRunReport,
  normalizeVideoMetadata,
  parseOrganicYouTubeContent,
  readYouTubeClientConfig,
  persistYouTubeRefreshToken,
  readYouTubeRefreshToken,
  refreshYouTubeAccessToken,
  resolveRefreshTokenPath,
  uploadYouTubeVideo,
  uploadYouTubeVideoWithOAuth,
  YouTubeUploadError,
} from "./youtube-uploader.mjs";

const content = `# Why amount financed can be higher than the car price

Campaign: \`amount-financed-explained-v1\`
Landing page: \`https://pencilproof.com/guides/amount-financed-higher-than-price\`

## YouTube Short — 35 seconds

Hook: “The car is $27,500. So why does the loan say $30,860?”

Description:

Review the written balance and check your quote: https://pencilproof.com/guides/amount-financed-higher-than-price

## YouTube explainer — 2–4 minutes

Title: Why Your Car Loan Can Be Higher Than the Vehicle Price

Opening:

“If the vehicle price is $27,500 but the amount financed is over $30,000, itemize the equation.”

Outline and script:

1. Add the clearly identified charges.

Close:

“PencilProof is educational software, not a lender or dealership.”
`;

test("parses existing organic short content and retains tracked destination", () => {
  const parsed = parseOrganicYouTubeContent(content, "short");
  assert.match(parsed.title, /loan say/);
  assert.match(parsed.description, /https:\/\/pencilproof\.com\/guides/);
  assert.equal(parsed.campaign, "amount-financed-explained-v1");
});

test("parses explainer title and multiline opening/close blocks", () => {
  const parsed = parseOrganicYouTubeContent(content, "explainer");
  assert.equal(parsed.title, "Why Your Car Loan Can Be Higher Than the Vehicle Price");
  assert.match(parsed.description, /itemize the equation/);
  assert.match(parsed.description, /educational software/);
  assert.match(parsed.description, /utm_source=youtube/);
});

test("builds a private-by-default plan without inspecting credentials", () => {
  const plan = buildYouTubeUploadPlan({ markdown: content, format: "short", videoPath: "./clip.mp4" });
  assert.equal(plan.metadata.status.privacyStatus, "private");
  const report = dryRunReport(plan);
  assert.equal(report.mode, "dry-run");
  assert.equal(report.credentialState, "not_inspected");
  assert.equal(report.channelBinding, "missing");
});

test("rejects invalid metadata before any provider call", () => {
  assert.throws(
    () => normalizeVideoMetadata({ title: "x".repeat(101), description: "description" }),
    (error) => error instanceof YouTubeUploadError && error.code === "VIDEO_TITLE_TOO_LONG",
  );
});

test("creates an installed-app PKCE request with only the YouTube scopes", () => {
  const request = createPkceAuthorizationRequest({
    clientId: "synthetic-client-id",
    redirectUri: "http://127.0.0.1:12345/oauth2callback",
    state: "synthetic-state",
    codeVerifier: "synthetic-verifier",
  });
  const url = new URL(request.authorizationUrl);
  assert.equal(url.searchParams.get("client_id"), "synthetic-client-id");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("scope"), /youtube\.upload/);
  assert.match(url.searchParams.get("scope"), /youtube\.readonly/);
  assert.equal(url.searchParams.has("client_secret"), false);
});

test("reads desktop OAuth client JSON without exposing secrets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pencilproof-youtube-client-"));
  const path = join(directory, "client.json");
  try {
    await writeFile(path, JSON.stringify({ installed: { client_id: "synthetic-id", client_secret: "synthetic-secret" } }));
    assert.deepEqual(await readYouTubeClientConfig(path), { clientId: "synthetic-id", clientSecret: "synthetic-secret" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("includes client secret in refresh requests when supplied and preserves client-ID-only support", async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => { bodies.push(new URLSearchParams(init.body).toString()); return new Response(JSON.stringify({ access_token: "synthetic-access" }), { status: 200 }); };
  await refreshYouTubeAccessToken({ clientId: "synthetic-id", clientSecret: "synthetic-secret", refreshToken: "synthetic-refresh", fetchImpl });
  await refreshYouTubeAccessToken({ clientId: "synthetic-id", refreshToken: "synthetic-refresh", fetchImpl });
  assert.match(bodies[0], /client_secret=synthetic-secret/);
  assert.doesNotMatch(bodies[1], /client_secret/);
});

test("keeps refresh-token storage outside the repository and persists with a custom absolute path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pencilproof-youtube-storage-"));
  const path = join(directory, "refresh.json");
  try {
    assert.equal(resolveRefreshTokenPath({ explicitPath: path, repoRoot: join(directory, "repo") }), path);
    await persistYouTubeRefreshToken("synthetic-refresh-value", { explicitPath: path, repoRoot: join(directory, "repo") });
    assert.equal((await readYouTubeRefreshToken({ explicitPath: path, repoRoot: join(directory, "repo") })).length > 0, true);
    await assert.rejects(
      persistYouTubeRefreshToken("synthetic-refresh-value", { explicitPath: join(directory, "repo", "token.json"), repoRoot: join(directory, "repo") }),
      (error) => error instanceof YouTubeUploadError && error.code === "REFRESH_TOKEN_PATH_MUST_BE_OUTSIDE_REPO",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refreshes access before OAuth upload and never falls back to the stored refresh value", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pencilproof-youtube-oauth-"));
  const tokenPath = join(directory, "refresh.json");
  const videoPath = join(directory, "clip.mp4");
  await writeFile(videoPath, "video-bytes");
  await persistYouTubeRefreshToken("synthetic-refresh-value", { explicitPath: tokenPath, repoRoot: join(directory, "repo") });
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(String(url));
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "synthetic-access-value", expires_in: 3600 }), { status: 200 });
    }
    if (String(url).includes("/channels?")) return new Response(JSON.stringify({ items: [{ id: "channel-123" }] }), { status: 200 });
    if (String(url).includes("/upload/youtube/v3/videos")) return new Response(null, { status: 200, headers: { Location: "https://upload.example/session" } });
    return new Response(JSON.stringify({ id: "video-789" }), { status: 200 });
  };
  try {
    const result = await uploadYouTubeVideoWithOAuth({
      plan: buildYouTubeUploadPlan({ markdown: content, videoPath }),
      clientId: "synthetic-client-id",
      refreshTokenPath: tokenPath,
      expectedChannelId: "channel-123",
      repoRoot: join(directory, "repo"),
      fetchImpl,
    });
    assert.equal(result.videoId, "video-789");
    assert.equal(calls[0], "https://oauth2.googleapis.com/token");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("completes authorization through a local loopback callback in a mocked browser", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pencilproof-youtube-auth-"));
  const tokenPath = join(directory, "refresh.json");
  const fetchImpl = async (url) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    return new Response(JSON.stringify({ refresh_token: "synthetic-auth-refresh-value" }), { status: 200 });
  };
  try {
    const result = await authorizeInstalledYouTubeApp({
      clientId: "synthetic-client-id",
      refreshTokenPath: tokenPath,
      repoRoot: join(directory, "repo"),
      fetchImpl,
      openBrowser: async (authorizationUrl) => {
        const url = new URL(authorizationUrl);
        const redirect = new URL(url.searchParams.get("redirect_uri"));
        redirect.searchParams.set("code", "synthetic-code");
        redirect.searchParams.set("state", url.searchParams.get("state"));
        const callbackUrl = redirect.toString();
        await globalThis.fetch(callbackUrl);
      },
      timeoutMs: 5000,
    });
    assert.equal(result.authorized, true);
    assert.equal(result.refreshTokenStored, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("enforces channel binding and uploads through a mocked resumable session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pencilproof-youtube-"));
  const videoPath = join(directory, "clip.mp4");
  await writeFile(videoPath, "video-bytes");
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init });
    if (String(url).includes("/channels?")) {
      return new Response(JSON.stringify({ items: [{ id: "channel-123" }] }), { status: 200 });
    }
    if (String(url).includes("/upload/youtube/v3/videos")) {
      return new Response(null, { status: 200, headers: { Location: "https://upload.example/session" } });
    }
    return new Response(JSON.stringify({ id: "video-456" }), { status: 200 });
  };
  try {
    const result = await uploadYouTubeVideo({
      plan: buildYouTubeUploadPlan({ markdown: content, videoPath }),
      accessToken: "placeholder-only",
      expectedChannelId: "channel-123",
      fetchImpl,
    });
    assert.deepEqual(result, { uploaded: true, channelId: "channel-123", videoId: "video-456", privacyStatus: "private" });
    assert.equal(requests.length, 3);
    assert.equal(requests[0].init.headers.Authorization.startsWith("Bearer "), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails closed on a channel mismatch before creating an upload session", async () => {
  let calls = 0;
  await assert.rejects(
    uploadYouTubeVideo({
      plan: { videoPath: "unused.mp4", metadata: normalizeVideoMetadata({ title: "Title", description: "Description" }) },
      accessToken: "placeholder-only",
      expectedChannelId: "channel-expected",
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ items: [{ id: "channel-other" }] }), { status: 200 });
      },
    }),
    (error) => error instanceof YouTubeUploadError && error.code === "YOUTUBE_CHANNEL_BINDING_MISMATCH",
  );
  assert.equal(calls, 1);
});
