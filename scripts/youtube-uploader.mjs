import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFile, mkdir, rename, stat, unlink, writeFile, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const YOUTUBE_API_ROOT = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_UPLOAD_ROOT = "https://www.googleapis.com/upload/youtube/v3/videos";
const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const YOUTUBE_OAUTH_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
]);
const DEFAULT_REFRESH_TOKEN_FILE = "youtube-refresh-token.json";
const DEFAULT_CALLBACK_PATH = "/";
const DEFAULT_CATEGORY_ID = "27";
const DEFAULT_PRIVACY_STATUS = "private";
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_TAGS_LENGTH = 500;

export class YouTubeUploadError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "YouTubeUploadError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, status) {
  throw new YouTubeUploadError(code, status);
}

function cleanText(value) {
  return String(value ?? "").replace(/`/g, "").replace(/\s+/g, " ").trim();
}

function fieldFromSection(section, label) {
  const match = section.match(new RegExp(`^${label}:\\s*(.*)$`, "im"));
  return cleanText(match?.[1] ?? "");
}

function blockFromSection(section, label) {
  const match = section.match(new RegExp(`^${label}:\\s*(.*)$`, "im"));
  if (!match) return "";
  const remainder = section.slice(match.index + match[0].length);
  const nextLabel = remainder.search(/^[A-Z][A-Za-z ]+:\s*$/m);
  const body = remainder.slice(0, nextLabel < 0 ? remainder.length : nextLabel);
  return cleanText([match[1], body].filter(Boolean).join(" "));
}

function sectionForFormat(markdown, format) {
  const normalizedFormat = String(format ?? "short").trim().toLowerCase();
  if (!["short", "explainer"].includes(normalizedFormat)) {
    fail("CONTENT_FORMAT_UNSUPPORTED");
  }
  const sectionName = normalizedFormat === "short" ? "Short" : "explainer";
  const heading = new RegExp(`^## YouTube ${sectionName}[^\\n]*$`, "im");
  const match = heading.exec(String(markdown ?? ""));
  if (!match) fail("YOUTUBE_CONTENT_SECTION_MISSING");
  const start = match.index + match[0].length;
  const remainder = String(markdown).slice(start);
  const end = remainder.search(/^## /m);
  return { format: normalizedFormat, text: remainder.slice(0, end < 0 ? remainder.length : end) };
}

function trackedLandingUrl(landingPage, campaign, contentFormat) {
  if (!landingPage) return "";
  try {
    const url = new URL(landingPage);
    url.searchParams.set("utm_source", "youtube");
    url.searchParams.set("utm_medium", "organic_video");
    if (campaign) url.searchParams.set("utm_campaign", campaign);
    url.searchParams.set("utm_content", `${contentFormat}_v1`);
    return url.toString();
  } catch {
    return "";
  }
}

export function parseOrganicYouTubeContent(markdown, format = "short") {
  const source = String(markdown ?? "");
  const section = sectionForFormat(source, format);
  const campaign = fieldFromSection(source, "Campaign");
  const landingPage = fieldFromSection(source, "Landing page");
  const hook = fieldFromSection(section.text, "Hook");
  const titleField = fieldFromSection(section.text, "Title");
  const opening = blockFromSection(section.text, "Opening");
  const close = blockFromSection(section.text, "Close");
  const descriptionMatch = section.text.match(/^Description:\s*\n?([\s\S]*?)(?=^## |$)/im);
  const description = cleanText(descriptionMatch?.[1] ?? "");
  const title = cleanText(titleField || hook || `${campaign} ${section.format}`);
  const fallbackDescription = [opening, close, trackedLandingUrl(landingPage, campaign, section.format)]
    .filter(Boolean)
    .join(" ");
  return {
    campaign,
    landingPage,
    format: section.format,
    title,
    description: description || fallbackDescription,
    hook,
  };
}

export function normalizeVideoMetadata(input = {}) {
  const title = cleanText(input.title);
  const description = cleanText(input.description);
  const tags = Array.isArray(input.tags)
    ? input.tags.map(cleanText).filter(Boolean).slice(0, 30)
    : [];
  const privacyStatus = cleanText(input.privacyStatus || DEFAULT_PRIVACY_STATUS).toLowerCase();
  if (!title) fail("VIDEO_TITLE_REQUIRED");
  if (title.length > MAX_TITLE_LENGTH) fail("VIDEO_TITLE_TOO_LONG");
  if (!description) fail("VIDEO_DESCRIPTION_REQUIRED");
  if (description.length > MAX_DESCRIPTION_LENGTH) fail("VIDEO_DESCRIPTION_TOO_LONG");
  if (!tags.every((tag) => tag.length <= 500) || tags.join(",").length > MAX_TAGS_LENGTH) {
    fail("VIDEO_TAGS_TOO_LONG");
  }
  if (!["private", "unlisted", "public"].includes(privacyStatus)) fail("VIDEO_PRIVACY_UNSUPPORTED");
  return {
    snippet: {
      title,
      description,
      categoryId: cleanText(input.categoryId || DEFAULT_CATEGORY_ID),
      ...(tags.length ? { tags } : {}),
      ...(cleanText(input.defaultLanguage) ? { defaultLanguage: cleanText(input.defaultLanguage) } : {}),
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: input.selfDeclaredMadeForKids === true,
      notifySubscribers: input.notifySubscribers === true,
    },
  };
}

export function buildYouTubeUploadPlan({ markdown, format = "short", videoPath, metadata = {} }) {
  const content = parseOrganicYouTubeContent(markdown, format);
  const normalizedMetadata = normalizeVideoMetadata({
    title: metadata.title || content.title,
    description: metadata.description || content.description,
    ...metadata,
  });
  if (!videoPath) fail("VIDEO_PATH_REQUIRED");
  return {
    content: {
      campaign: content.campaign,
      format: content.format,
      landingPage: content.landingPage,
    },
    videoPath: resolve(videoPath),
    metadata: normalizedMetadata,
  };
}

function repoContainsPath(candidate, repoRoot) {
  const root = resolve(repoRoot).toLowerCase();
  const target = resolve(candidate).toLowerCase();
  const pathFromRoot = relative(root, target);
  return !pathFromRoot || (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot));
}

export function resolveRefreshTokenPath({ explicitPath = "", env = process.env, repoRoot = fileURLToPath(new URL("..", import.meta.url)) } = {}) {
  let candidate = cleanText(explicitPath);
  if (candidate && !isAbsolute(candidate)) fail("REFRESH_TOKEN_PATH_MUST_BE_ABSOLUTE");
  if (!candidate) {
    const configRoot = cleanText(env.LOCALAPPDATA)
      || cleanText(env.XDG_CONFIG_HOME)
      || resolve(homedir(), ...(process.platform === "win32" ? ["AppData", "Local"] : [".config"]));
    candidate = resolve(configRoot, "PencilProof", DEFAULT_REFRESH_TOKEN_FILE);
  }
  if (repoContainsPath(candidate, repoRoot)) fail("REFRESH_TOKEN_PATH_MUST_BE_OUTSIDE_REPO");
  return resolve(candidate);
}

export async function persistYouTubeRefreshToken(refreshToken, options = {}) {
  const token = String(refreshToken ?? "").trim();
  if (!token) fail("YOUTUBE_REFRESH_TOKEN_MISSING");
  const path = resolveRefreshTokenPath(options);
  const temporaryPath = `${path}.${randomBytes(12).toString("hex")}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(temporaryPath, JSON.stringify({ refreshToken: token, createdAt: new Date().toISOString() }) + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    try { await chmod(temporaryPath, 0o600); } catch { /* best effort on platforms without POSIX modes */ }
    await rename(temporaryPath, path);
  } catch {
    try { await unlink(temporaryPath); } catch { /* no-op */ }
    fail("YOUTUBE_REFRESH_TOKEN_PERSIST_FAILED");
  }
  return path;
}

export async function readYouTubeRefreshToken(options = {}) {
  const path = resolveRefreshTokenPath(options);
  let payload;
  try {
    payload = JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail("YOUTUBE_REFRESH_TOKEN_UNAVAILABLE");
  }
  const token = String(payload?.refreshToken ?? "").trim();
  if (!token) fail("YOUTUBE_REFRESH_TOKEN_INVALID");
  return token;
}

export async function readYouTubeClientConfig(configPath) {
  const path = cleanText(configPath);
  if (!path) return { clientId: "", clientSecret: "" };
  if (!isAbsolute(path)) fail("YOUTUBE_CLIENT_CONFIG_PATH_MUST_BE_ABSOLUTE");
  let payload;
  try { payload = JSON.parse(await readFile(path, "utf8")); } catch { fail("YOUTUBE_CLIENT_CONFIG_UNAVAILABLE"); }
  const client = payload?.installed ?? payload?.web ?? payload;
  const clientId = cleanText(client?.client_id);
  const clientSecret = cleanText(client?.client_secret);
  if (!clientId) fail("YOUTUBE_CLIENT_CONFIG_INVALID");
  return { clientId, clientSecret };
}

function base64Url(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createPkceAuthorizationRequest({ clientId, redirectUri, state = base64Url(randomBytes(24)), codeVerifier = base64Url(randomBytes(48)), scopes = YOUTUBE_OAUTH_SCOPES } = {}) {
  const normalizedClientId = cleanText(clientId);
  if (!normalizedClientId) fail("YOUTUBE_CLIENT_ID_MISSING");
  if (!redirectUri) fail("YOUTUBE_REDIRECT_URI_MISSING");
  const challenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const params = new URLSearchParams({
    client_id: normalizedClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { authorizationUrl: `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params}`, state, codeVerifier };
}

async function exchangeAuthorizationCode({ clientId, clientSecret = "", code, codeVerifier, redirectUri, fetchImpl }) {
  const normalizedClientId = cleanText(clientId);
  if (!normalizedClientId) fail("YOUTUBE_CLIENT_ID_MISSING");
  const body = new URLSearchParams({
    client_id: normalizedClientId,
    ...(cleanText(clientSecret) ? { client_secret: cleanText(clientSecret) } : {}),
    code: String(code ?? ""),
    code_verifier: String(codeVerifier ?? ""),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  let response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    fail("YOUTUBE_AUTH_TOKEN_NETWORK_ERROR");
  }
  let payload;
  try { payload = await response.json(); } catch { fail("YOUTUBE_AUTH_TOKEN_INVALID_RESPONSE"); }
  if (!response?.ok) {
    const providerCode = String(payload?.error ?? "FAILED").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    fail(`YOUTUBE_AUTH_TOKEN_${providerCode}`, Number.isFinite(response?.status) ? response.status : undefined);
  }
  const refreshToken = String(payload?.refresh_token ?? "").trim();
  if (!refreshToken) fail("YOUTUBE_REFRESH_TOKEN_MISSING_FROM_AUTH");
  return { refreshToken };
}

export async function refreshYouTubeAccessToken({ clientId, clientSecret = "", refreshToken, fetchImpl = fetch } = {}) {
  const normalizedClientId = cleanText(clientId);
  const normalizedRefreshToken = String(refreshToken ?? "").trim();
  if (!normalizedClientId) fail("YOUTUBE_CLIENT_ID_MISSING");
  if (!normalizedRefreshToken) fail("YOUTUBE_REFRESH_TOKEN_MISSING");
  const body = new URLSearchParams({
    client_id: normalizedClientId,
    ...(cleanText(clientSecret) ? { client_secret: cleanText(clientSecret) } : {}),
    refresh_token: normalizedRefreshToken,
    grant_type: "refresh_token",
  });
  let response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    fail("YOUTUBE_ACCESS_TOKEN_REFRESH_NETWORK_ERROR");
  }
  await responseStatus(response, "YOUTUBE_ACCESS_TOKEN_REFRESH_FAILED");
  let payload;
  try { payload = await response.json(); } catch { fail("YOUTUBE_ACCESS_TOKEN_REFRESH_INVALID_RESPONSE"); }
  const accessToken = String(payload?.access_token ?? "").trim();
  if (!accessToken) fail("YOUTUBE_ACCESS_TOKEN_REFRESH_EMPTY");
  return { accessToken, expiresIn: Number(payload?.expires_in) || 0 };
}

function callbackPage(message) {
  return `<!doctype html><meta charset="utf-8"><title>PencilProof YouTube authorization</title><p>${message}</p>`;
}

function waitForAuthorizationCallback(server, expectedState, timeoutMs) {
  return new Promise((resolveCallback, rejectCallback) => {
    const timer = setTimeout(() => rejectCallback(new YouTubeUploadError("YOUTUBE_AUTHORIZATION_TIMEOUT")), timeoutMs);
    timer.unref?.();
    const finish = (callback, value) => { clearTimeout(timer); callback(value); };
    server.on("request", (request, response) => {
      if (request.method !== "GET") { response.writeHead(405).end("Method not allowed"); return; }
      let url;
      try { url = new URL(request.url ?? "/", "http://127.0.0.1"); } catch { response.writeHead(400).end(callbackPage("Authorization failed.")); return; }
      if (url.pathname !== DEFAULT_CALLBACK_PATH) { response.writeHead(404).end("Not found"); return; }
      if (url.searchParams.get("state") !== expectedState) {
        response.writeHead(400).end(callbackPage("Authorization failed. You may close this window."));
        finish(rejectCallback, new YouTubeUploadError("YOUTUBE_AUTHORIZATION_STATE_MISMATCH"));
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        response.writeHead(400).end(callbackPage("Authorization was not completed. You may close this window."));
        finish(rejectCallback, new YouTubeUploadError("YOUTUBE_AUTHORIZATION_DENIED"));
        return;
      }
      const code = String(url.searchParams.get("code") ?? "").trim();
      if (!code) {
        response.writeHead(400).end(callbackPage("Authorization failed. You may close this window."));
        finish(rejectCallback, new YouTubeUploadError("YOUTUBE_AUTHORIZATION_CODE_MISSING"));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(callbackPage("Authorization complete. You may close this window."));
      finish(resolveCallback, code);
    });
  });
}

export async function openAuthorizationBrowser(authorizationUrl) {
  const handoffPath = String(process.env.YOUTUBE_AUTHORIZATION_URL_PATH ?? "").trim();
  if (handoffPath) {
    if (!isAbsolute(handoffPath)) fail("YOUTUBE_AUTHORIZATION_URL_PATH_NOT_ABSOLUTE");
    await mkdir(dirname(handoffPath), { recursive: true });
    await writeFile(handoffPath, authorizationUrl, { encoding: "utf8", mode: 0o600 });
    return;
  }
  return new Promise((resolveBrowser, rejectBrowser) => {
    const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", authorizationUrl] : [authorizationUrl];
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", () => rejectBrowser(new YouTubeUploadError("YOUTUBE_AUTHORIZATION_BROWSER_OPEN_FAILED")));
    child.unref();
    resolveBrowser();
  });
}

export async function authorizeInstalledYouTubeApp({ clientId, clientSecret = "", refreshTokenPath, env = process.env, repoRoot, fetchImpl = fetch, openBrowser = openAuthorizationBrowser, timeoutMs = 300000 } = {}) {
  const normalizedClientId = cleanText(clientId);
  if (!normalizedClientId) fail("YOUTUBE_CLIENT_ID_MISSING");
  const storageOptions = { explicitPath: refreshTokenPath, env, repoRoot };
  const storagePath = resolveRefreshTokenPath(storageOptions);
  const server = createServer();
  try {
    await new Promise((resolveServer, rejectServer) => {
      server.once("error", rejectServer);
      server.listen(0, "127.0.0.1", resolveServer);
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    if (!port) fail("YOUTUBE_LOOPBACK_BIND_FAILED");
    const redirectUri = `http://127.0.0.1:${port}${DEFAULT_CALLBACK_PATH}`;
    const request = createPkceAuthorizationRequest({ clientId: normalizedClientId, redirectUri });
    const callback = waitForAuthorizationCallback(server, request.state, timeoutMs);
    await openBrowser(request.authorizationUrl);
    const code = await callback;
    const token = await exchangeAuthorizationCode({ clientId: normalizedClientId, clientSecret, code, codeVerifier: request.codeVerifier, redirectUri, fetchImpl });
    await persistYouTubeRefreshToken(token.refreshToken, storageOptions);
    return { authorized: true, refreshTokenStored: true, storagePath };
  } finally {
    await new Promise((resolveClose) => server.close(() => resolveClose()));
  }
}

function authorizationHeaders(accessToken) {
  const token = String(accessToken ?? "").trim();
  if (!token) fail("YOUTUBE_ACCESS_TOKEN_MISSING");
  return { Authorization: `Bearer ${token}` };
}

async function responseStatus(response, code) {
  if (response?.ok) return;
  fail(code, Number.isFinite(response?.status) ? response.status : undefined);
}

export async function getAuthorizedYouTubeChannel({ accessToken, fetchImpl = fetch }) {
  const headers = authorizationHeaders(accessToken);
  let response;
  try {
    response = await fetchImpl(`${YOUTUBE_API_ROOT}/channels?part=id&mine=true`, { headers });
  } catch {
    fail("YOUTUBE_CHANNEL_LOOKUP_NETWORK_ERROR");
  }
  await responseStatus(response, "YOUTUBE_CHANNEL_LOOKUP_FAILED");
  let payload;
  try {
    payload = await response.json();
  } catch {
    fail("YOUTUBE_CHANNEL_LOOKUP_INVALID_RESPONSE");
  }
  const channelId = cleanText(payload?.items?.[0]?.id);
  if (!channelId) fail("YOUTUBE_CHANNEL_NOT_FOUND");
  return channelId;
}

async function createResumableSession({ accessToken, metadata, size, contentType, fetchImpl }) {
  const headers = {
    ...authorizationHeaders(accessToken),
    "Content-Type": "application/json; charset=UTF-8",
    "X-Upload-Content-Type": contentType,
    "X-Upload-Content-Length": String(size),
  };
  let response;
  try {
    response = await fetchImpl(`${YOUTUBE_UPLOAD_ROOT}?part=snippet,status`, {
      method: "POST",
      headers,
      body: JSON.stringify(metadata),
    });
  } catch {
    fail("YOUTUBE_UPLOAD_SESSION_NETWORK_ERROR");
  }
  await responseStatus(response, "YOUTUBE_UPLOAD_SESSION_FAILED");
  const location = response.headers?.get?.("location") || response.headers?.get?.("Location");
  if (!location || !/^https:\/\//i.test(location)) fail("YOUTUBE_UPLOAD_SESSION_MISSING");
  return location;
}

export async function uploadYouTubeVideo({
  plan,
  accessToken,
  expectedChannelId,
  contentType = "video/mp4",
  fetchImpl = fetch,
  createReadStreamImpl = createReadStream,
  statImpl = stat,
}) {
  if (!plan?.videoPath || !plan?.metadata) fail("UPLOAD_PLAN_INVALID");
  const expected = cleanText(expectedChannelId);
  if (!expected) fail("YOUTUBE_EXPECTED_CHANNEL_ID_MISSING");
  const channelId = await getAuthorizedYouTubeChannel({ accessToken, fetchImpl });
  if (channelId !== expected) fail("YOUTUBE_CHANNEL_BINDING_MISMATCH");

  let file;
  try {
    file = await statImpl(plan.videoPath);
  } catch {
    fail("VIDEO_FILE_UNREADABLE");
  }
  if (!file.isFile() || file.size <= 0) fail("VIDEO_FILE_INVALID");

  const sessionUrl = await createResumableSession({
    accessToken,
    metadata: plan.metadata,
    size: file.size,
    contentType,
    fetchImpl,
  });
  let response;
  try {
    response = await fetchImpl(sessionUrl, {
      method: "PUT",
      headers: {
        ...authorizationHeaders(accessToken),
        "Content-Type": contentType,
        "Content-Length": String(file.size),
      },
      body: createReadStreamImpl(plan.videoPath),
      duplex: "half",
    });
  } catch {
    fail("YOUTUBE_VIDEO_UPLOAD_NETWORK_ERROR");
  }
  await responseStatus(response, "YOUTUBE_VIDEO_UPLOAD_FAILED");
  let payload;
  try {
    payload = await response.json();
  } catch {
    fail("YOUTUBE_VIDEO_UPLOAD_INVALID_RESPONSE");
  }
  const videoId = cleanText(payload?.id);
  if (!videoId) fail("YOUTUBE_VIDEO_ID_MISSING");
  return {
    uploaded: true,
    channelId,
    videoId,
    privacyStatus: plan.metadata.status.privacyStatus,
  };
}

export async function uploadYouTubeVideoWithOAuth({
  plan,
  clientId,
  clientSecret = "",
  refreshTokenPath,
  expectedChannelId,
  env = process.env,
  repoRoot,
  fetchImpl = fetch,
  createReadStreamImpl = createReadStream,
  statImpl = stat,
}) {
  const refreshToken = await readYouTubeRefreshToken({ explicitPath: refreshTokenPath, env, repoRoot });
  const { accessToken } = await refreshYouTubeAccessToken({ clientId, clientSecret, refreshToken, fetchImpl });
  return uploadYouTubeVideo({
    plan,
    accessToken,
    expectedChannelId,
    fetchImpl,
    createReadStreamImpl,
    statImpl,
  });
}

export function dryRunReport(plan, { expectedChannelId = "" } = {}) {
  return {
    mode: "dry-run",
    wouldUpload: false,
    credentialState: "not_inspected",
    channelBinding: cleanText(expectedChannelId) ? "configured" : "missing",
    video: { fileName: basename(plan.videoPath), path: plan.videoPath },
    content: plan.content,
    metadata: plan.metadata,
  };
}

function optionValue(args, index, option) {
  if (index + 1 >= args.length || args[index + 1].startsWith("--")) {
    throw new Error(`${option}_VALUE_REQUIRED`);
  }
  return args[index + 1];
}

function parseCli(args) {
  const options = {
    format: "short",
    clientEnv: "YOUTUBE_CLIENT_ID",
    channelEnv: "YOUTUBE_EXPECTED_CHANNEL_ID",
    refreshTokenPath: "",
    clientConfigPath: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--upload") options.upload = true;
    else if (argument === "--authorize") options.authorize = true;
    else if (argument === "--made-for-kids") options.madeForKids = true;
    else if (argument === "--content") { options.contentPath = optionValue(args, index, "CONTENT"); index += 1; }
    else if (argument === "--video") { options.videoPath = optionValue(args, index, "VIDEO"); index += 1; }
    else if (argument === "--format") { options.format = optionValue(args, index, "FORMAT"); index += 1; }
    else if (argument === "--title") { options.title = optionValue(args, index, "TITLE"); index += 1; }
    else if (argument === "--description") { options.description = optionValue(args, index, "DESCRIPTION"); index += 1; }
    else if (argument === "--privacy") { options.privacyStatus = optionValue(args, index, "PRIVACY"); index += 1; }
    else if (argument === "--client-env") { options.clientEnv = optionValue(args, index, "CLIENT_ENV"); index += 1; }
    else if (argument === "--channel-env") { options.channelEnv = optionValue(args, index, "CHANNEL_ENV"); index += 1; }
    else if (argument === "--refresh-token-path") { options.refreshTokenPath = optionValue(args, index, "REFRESH_TOKEN_PATH"); index += 1; }
    else if (argument === "--client-config-path") { options.clientConfigPath = optionValue(args, index, "CLIENT_CONFIG_PATH"); index += 1; }
    else if (argument === "--help") options.help = true;
    else throw new Error("UNKNOWN_OPTION");
  }
  return options;
}

function helpText() {
  return [
    "Dry-run (default): node scripts/youtube-uploader.mjs --content content/organic/<slug>.md --format short --video <file>",
    "Authorize (installed app + PKCE loopback): node scripts/youtube-uploader.mjs --authorize",
    "Upload (requires explicit --upload, refreshed OAuth access, and channel binding): add --upload",
    "Options: --title, --description, --privacy private|unlisted|public, --made-for-kids",
    "Secret names default to YOUTUBE_CLIENT_ID and YOUTUBE_EXPECTED_CHANNEL_ID; values are never printed.",
    "Refresh-token storage defaults outside the repository; override with absolute --refresh-token-path.",
    "Optional desktop OAuth client JSON: --client-config-path <absolute-path> or YOUTUBE_CLIENT_CONFIG_PATH.",
  ].join("\n");
}

export async function runCli(args = process.argv.slice(2), env = process.env) {
  const options = parseCli(args);
  if (options.help) return helpText();
  if (options.authorize) {
    const config = await readYouTubeClientConfig(options.clientConfigPath || env.YOUTUBE_CLIENT_CONFIG_PATH);
    const result = await authorizeInstalledYouTubeApp({
      clientId: env[options.clientEnv] || config.clientId,
      clientSecret: config.clientSecret,
      refreshTokenPath: options.refreshTokenPath,
      env,
      openBrowser: openAuthorizationBrowser,
    });
    return JSON.stringify({ authorized: result.authorized, refreshTokenStored: result.refreshTokenStored }, null, 2);
  }
  if (!options.contentPath || !options.videoPath) throw new Error("CONTENT_AND_VIDEO_REQUIRED");
  const markdown = await readFile(options.contentPath, "utf8");
  const plan = buildYouTubeUploadPlan({
    markdown,
    format: options.format,
    videoPath: options.videoPath,
    metadata: {
      ...(options.title ? { title: options.title } : {}),
      ...(options.description ? { description: options.description } : {}),
      ...(options.privacyStatus ? { privacyStatus: options.privacyStatus } : {}),
      ...(options.madeForKids ? { selfDeclaredMadeForKids: true } : {}),
    },
  });
  if (!options.upload) return JSON.stringify(dryRunReport(plan), null, 2);
  const config = await readYouTubeClientConfig(options.clientConfigPath || env.YOUTUBE_CLIENT_CONFIG_PATH);
  const result = await uploadYouTubeVideoWithOAuth({
    plan,
    clientId: env[options.clientEnv] || config.clientId,
    clientSecret: config.clientSecret,
    refreshTokenPath: options.refreshTokenPath,
    expectedChannelId: env[options.channelEnv],
    env,
  });
  return JSON.stringify(result, null, 2);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().then((output) => {
    process.stdout.write(`${output}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof YouTubeUploadError ? error.code : "YOUTUBE_UPLOADER_FAILED"}\n`);
    process.exitCode = 1;
  });
}
