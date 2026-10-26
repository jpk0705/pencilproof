import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationsSnapshot, operationsStatusPage } from "./operations-dashboard.mjs";

const now = new Date("2026-08-30T21:00:00.000Z");

function healthyInput() {
  const platformAudit = (platform) => ({
    connectionState: "verified",
    apiReachable: true,
    accountMatched: true,
    lastVerifiedAt: "2026-08-30T20:00:00.000Z",
    verificationExpiresAt: "2026-08-31T20:00:00.000Z",
    postMetrics: [{ platform, id: `${platform}-1`, created: "2026-08-30T19:00:00.000Z", fetchedAt: "2026-08-30T20:00:00.000Z", url: `https://example.com/${platform}-1`, metrics: { views: 10, reach: 8, engagement: 2 } }],
  });
  return {
    now,
    env: {
      SOCIAL_AUTOMATION_ENABLED: "true",
      SOCIAL_PUBLISH_ENABLED: "true",
      SOCIAL_REPLY_ENABLED: "true",
      FACEBOOK_PAGE_ID: "facebook-page",
      FACEBOOK_PAGE_ACCESS_TOKEN: "token",
      INSTAGRAM_USER_ID: "instagram-user",
      INSTAGRAM_ACCESS_TOKEN: "token",
      THREADS_USER_ID: "threads-user",
      THREADS_ACCESS_TOKEN: "token",
    },
    directStatus: {
      lastRunAt: "2026-08-30T20:30:00.000Z",
      lastPublishedByPlatform: {
        instagram: { id: "instagram-1", at: "2026-08-30T19:00:00.000Z", url: "https://example.com/instagram-1" },
        threads: { id: "threads-1", at: "2026-08-30T19:00:00.000Z", url: "https://example.com/threads-1" },
      },
    },
    facebookStatus: {
      lastRunAt: "2026-08-30T20:30:00.000Z",
      lastPublishedByPlatform: { facebook: { id: "facebook-1", at: "2026-08-30T19:00:00.000Z", url: "https://example.com/facebook-1" } },
    },
    socialAudit: {
      collectedAt: "2026-08-30T20:00:00.000Z",
      providerRequestsUsed: 2,
      platforms: {
        facebook: platformAudit("facebook"),
        instagram: platformAudit("instagram"),
        threads: platformAudit("threads"),
      },
      postMetrics: [platformAudit("facebook").postMetrics[0], platformAudit("instagram").postMetrics[0], platformAudit("threads").postMetrics[0]],
    },
    businessStatus: {
      email: {
        automation: { state: "healthy", automaticRepair: "Retry is enabled." },
        provider: { status: "verified", checkedAt: "2026-08-30T20:00:00.000Z", messages: 7, recipients: 7, complete: true, byLastEvent: { delivered: 6, opened: 1 }, byDay: { "2026-08-30": 7 } },
        localDeliveries: { sent: 7, pendingClaims: 0, byDay: { "2026-08-30": 7 } },
      },
      traffic: {
        status: "verified",
        funnel: { visitors: 20, pageViews: 30, scanUsers: 8, scanStarts: 9, manualEntryUsers: 4, manualEntryStarts: 5, manualReadyUsers: 2, manualEntriesReady: 3, previewUsers: 6, previewsReady: 6, checkoutUsers: 2, checkoutStarts: 2, purchasers: 1 },
        sourceFunnel: [{ name: "facebook", visitors: 10, scanUsers: 5, manualEntryUsers: 2, manualReadyUsers: 1, previewUsers: 4, checkoutUsers: 1, purchasers: 1 }],
        byDay: { "2026-08-30": { page_view: 30, scan_started: 9, manual_entry_started: 5, manual_entry_ready: 3, preview_ready: 6, checkout_started: 2, payment_completed: 1 } },
      },
    },
  };
}

test("fresh operations snapshot verifies automation, platforms, email, and traffic", async () => {
  const snapshot = buildOperationsSnapshot(healthyInput());
  assert.equal(snapshot.overallState, "healthy");
  assert.equal(snapshot.automation.social.state, "healthy");
  assert.equal(snapshot.automation.social.components.direct.state, "healthy");
  assert.equal(snapshot.automation.social.components.facebook.state, "healthy");
  assert.equal(Object.values(snapshot.platforms).filter((platform) => platform.connected).length, 3);
  assert.equal(snapshot.email.provider.messages, 7);
  assert.equal(snapshot.traffic.funnel.purchasers, 1);
  assert.equal(snapshot.collection.normalStatusPageProviderRequests, 0);

  const response = operationsStatusPage(snapshot);
  const html = await response.text();
  assert.match(html, /Emails sent · 7 days/);
  assert.match(html, /Open last post/);
  assert.match(html, /What to improve next/);
  assert.match(html, /Automation health and recovery/);
  assert.match(html, /Not provided by Threads/);
  assert.match(html, /2026-08-30/);
  assert.match(html, /Manual-entry users/);
  assert.match(html, /Manual-ready users/);
  assert.match(html, /Manual entry/);
  assert.match(html, /Manual ready events/);
  assert.match(html, /<strong>4<\/strong>/);
  assert.match(html, /<strong>2<\/strong>/);
  assert.match(html, /do not add them into a total/);
  assert.doesNotMatch(html, /Unavailable|Not exposed/);
  assert.match(html, /2026-08-30<\/th><td>30<\/td><td>9<\/td><td>5<\/td><td>3<\/td><td>6<\/td><td>2<\/td><td>1<\/td>/);
});

test("stale heartbeat and an account mismatch become visible incidents", () => {
  const input = healthyInput();
  input.directStatus.lastRunAt = "2026-08-30T16:00:00.000Z";
  input.facebookStatus.lastRunAt = "2026-08-30T16:00:00.000Z";
  input.socialAudit.platforms.instagram.connectionState = "needs_attention";
  input.socialAudit.platforms.instagram.accountMatched = false;
  input.socialAudit.platforms.instagram.connectionError = { message: "Expected account did not match." };
  const snapshot = buildOperationsSnapshot(input);
  assert.equal(snapshot.overallState, "needs_attention");
  assert.equal(snapshot.automation.social.state, "needs_attention");
  assert.equal(snapshot.automation.social.components.direct.state, "missed_schedule");
  assert.ok(snapshot.incidents.some((incident) => incident.system === "instagram"));
});

test("paused marketing email is explained without a missed-run incident", async () => {
  const input = healthyInput();
  input.businessStatus.email.automation = {
    state: "paused",
    schedulePaused: true,
    automaticRepair: null,
    lastRun: { finishedAt: "2026-08-28T17:00:00.000Z", status: "healthy" },
  };
  const snapshot = buildOperationsSnapshot(input);
  assert.equal(snapshot.automation.email.state, "paused");
  assert.equal(snapshot.incidents.some((incident) => incident.system === "email automation"), false);
  const html = await operationsStatusPage(snapshot).text();
  assert.match(html, /Automatic marketing campaigns are paused/);
  assert.match(html, /Historical delivery records remain available/);
  assert.doesNotMatch(html, /latest expected email run is not confirmed healthy|waiting for the first synchronized snapshot/);
});

test("traffic recommendations do not call a zero-conversion source the winner", async () => {
  const input = healthyInput();
  input.businessStatus.traffic.funnel = { visitors: 59, pageViews: 192, scanUsers: 0, scanStarts: 0, manualEntryUsers: 0, manualEntryStarts: 0, manualReadyUsers: 0, manualEntriesReady: 0, previewUsers: 0, checkoutUsers: 1, purchasers: 0 };
  input.businessStatus.traffic.topPages = [{ name: "/analyze", sessions: 6 }, { name: "/analyze/secure/", sessions: 3 }];
  input.businessStatus.traffic.sourceFunnel = [
    { name: "direct", visitors: 34, scanUsers: 0, purchasers: 0 },
    { name: "threads/organic/free_scan", visitors: 3, scanUsers: 0, purchasers: 0 },
    { name: "m.facebook.com", visitors: 2, scanUsers: 0, purchasers: 0 },
    { name: "instagram/organic/free_scan", visitors: 1, scanUsers: 0, purchasers: 0 },
  ];
  input.businessStatus.traffic.byDay = { "2026-08-30": { page_view: 1 } };
  const snapshot = buildOperationsSnapshot(input);
  assert.match(snapshot.recommendations[0], /9 visits to quote-analysis pages but zero file-scan starts and zero manual-entry starts/);
  assert.match(snapshot.recommendations[1], /6 visitors came from tracked social sources/);
  assert.doesNotMatch(snapshot.recommendations.join(" "), /strongest measured result/);
  const html = await operationsStatusPage(snapshot).text();
  assert.match(html, /2026-08-30<\/th><td>1<\/td><td>0<\/td><td>Not measured<\/td><td>Not measured<\/td><td>0<\/td><td>0<\/td><td>0<\/td>/);
});

test("manual-only activity stays separate from file scans and avoids scan-only advice", async () => {
  const input = healthyInput();
  input.businessStatus.traffic.funnel = {
    visitors: 10,
    pageViews: 12,
    scanUsers: 0,
    scanStarts: 0,
    manualEntryUsers: 4,
    manualEntryStarts: 5,
    manualReadyUsers: 2,
    manualEntriesReady: 2,
    previewUsers: 0,
    previewsReady: 0,
    checkoutUsers: 1,
    checkoutStarts: 1,
    purchasers: 0,
  };
  input.businessStatus.traffic.topPages = [{ name: "/analyze", sessions: 7 }];
  input.businessStatus.traffic.sourceFunnel = [
    { name: "direct", visitors: 10, scanUsers: 0, manualEntryUsers: 4, manualReadyUsers: 2, purchasers: 0 },
  ];
  input.businessStatus.traffic.byDay = {
    "2026-08-30": { page_view: 12, scan_started: 0, manual_entry_started: 5, manual_entry_ready: 2 },
  };

  const snapshot = buildOperationsSnapshot(input);
  assert.match(snapshot.recommendations[0], /Manual entry started for 4 unique browsers/);
  assert.match(snapshot.recommendations[0], /manual-ready users: 2/);
  assert.match(snapshot.recommendations[0], /groups may overlap, so do not add the counts/);
  assert.doesNotMatch(snapshot.recommendations.join(" "), /Fewer than 20%|zero file-scan starts and zero manual-entry starts|zero scan-start events/);

  const html = await operationsStatusPage(snapshot).text();
  assert.match(html, /Manual-entry users/);
  assert.match(html, /Manual-ready users/);
  assert.match(html, /<strong>4<\/strong>/);
  assert.match(html, /<strong>2<\/strong>/);
  assert.match(html, /groups may overlap/);
  assert.match(html, /<tr><th>direct<\/th><td>10<\/td><td>0<\/td><td>4<\/td><td>2<\/td>/);
});

test("unavailable manual-entry metrics remain not measured", async () => {
  const input = healthyInput();
  input.businessStatus.traffic.funnel = { visitors: 10, pageViews: 12, scanUsers: 0, scanStarts: 0, previewUsers: 0 };
  input.businessStatus.traffic.topPages = [{ name: "/analyze", sessions: 7 }];
  input.businessStatus.traffic.sourceFunnel = [{ name: "direct", visitors: 10, scanUsers: 0 }];
  input.businessStatus.traffic.byDay = { "2026-08-30": { page_view: 12, scan_started: 0 } };
  const snapshot = buildOperationsSnapshot(input);
  assert.match(snapshot.recommendations[0], /manual-entry tracking is not measured/);
  const html = await operationsStatusPage(snapshot).text();
  assert.match(html, /Manual-entry users/);
  assert.match(html, /Manual-ready users/);
  assert.match(html, /Not measured/);
  assert.match(html, /<tr><th>direct<\/th><td>10<\/td><td>0<\/td><td>Not measured<\/td><td>Not measured<\/td>/);
});
