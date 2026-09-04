const PLATFORM_ORDER = ["facebook", "instagram", "threads"];

const text = (value, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const timestamp = (value) => {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const newestIso = (...values) => {
  const newest = values.map(timestamp).filter((value) => value !== null).sort((left, right) => right - left)[0];
  return newest === undefined ? null : new Date(newest).toISOString();
};
const safeUrl = (value) => {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};
const configuredPlatforms = (env) => new Set(PLATFORM_ORDER.filter((platform) => {
  if (platform === "facebook") return Boolean(text(env.FACEBOOK_PAGE_ID) && text(env.FACEBOOK_PAGE_ACCESS_TOKEN));
  if (platform === "instagram") return Boolean(text(env.INSTAGRAM_USER_ID) && text(env.INSTAGRAM_ACCESS_TOKEN));
  return Boolean((text(env.THREADS_USER_ID) || text(env.THREADS_EXPECTED_USERNAME)) && text(env.THREADS_ACCESS_TOKEN));
}));

function latestMetricRecord(records, platform) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => record?.platform === platform)
    .sort((left, right) => (timestamp(right?.fetchedAt ?? right?.created) ?? 0) - (timestamp(left?.fetchedAt ?? left?.created) ?? 0))[0] ?? null;
}

function platformSnapshot(platform, configured, published, audit, metricRecords) {
  const record = latestMetricRecord(metricRecords, platform);
  const connectionState = !configured
    ? "not_configured"
    : text(audit?.connectionState, "not_verified");
  const lastPostAt = newestIso(published?.at, record?.created, audit?.latestRemotePostAt);
  const lastPostUrl = safeUrl(published?.url ?? published?.postUrl ?? record?.url);
  const metrics = record?.metrics && typeof record.metrics === "object" ? record.metrics : {};
  return {
    platform,
    configured,
    connectionState,
    connected: connectionState === "verified" && audit?.apiReachable === true && audit?.accountMatched === true,
    checkedAt: audit?.lastVerifiedAt ?? audit?.verifiedAt ?? null,
    verificationExpiresAt: audit?.verificationExpiresAt ?? null,
    lastPost: lastPostAt || lastPostUrl ? { timestamp: lastPostAt, url: lastPostUrl, id: text(published?.id ?? record?.id, "") || null } : null,
    metrics: {
      views: number(metrics.views),
      reach: number(metrics.reach),
      engagement: number(metrics.engagement),
      likes: number(metrics.likes),
      comments: number(metrics.comments),
      replies: number(metrics.replies),
      shares: number(metrics.shares),
      reposts: number(metrics.reposts),
      linkClicks: number(metrics.linkClicks),
    },
    metricsCheckedAt: record?.fetchedAt ?? null,
    metricsStatus: record ? text(record.status, "measured") : "not_measured_yet",
    error: audit?.connectionError?.message ?? audit?.metricsError?.message ?? null,
  };
}

function automationComponent(configured, lastRunAt, error, enabled, now) {
  const ageMs = lastRunAt ? now.getTime() - Date.parse(lastRunAt) : null;
  const state = !configured
    ? "not_configured"
    : !enabled
      ? "paused"
      : error
        ? "needs_attention"
        : ageMs === null
          ? "no_run_evidence"
          : ageMs > 75 * 60 * 1000
            ? "missed_schedule"
            : "healthy";
  return {
    configured,
    state,
    lastRunAt,
    lastRunAgeMinutes: ageMs === null ? null : Math.max(0, Math.round(ageMs / 60000)),
    lastError: error || null,
  };
}

function trafficRecommendations(traffic) {
  const funnel = traffic?.funnel ?? {};
  const visitors = number(funnel.visitors) ?? 0;
  const scanUsers = number(funnel.scanUsers) ?? 0;
  const previewUsers = number(funnel.previewUsers) ?? 0;
  const checkoutUsers = number(funnel.checkoutUsers) ?? 0;
  const purchasers = number(funnel.purchasers) ?? 0;
  const byEvent = traffic?.byEvent ?? {};
  const importSuccesses = number(byEvent.import_success) ?? 0;
  const importFailures = number(byEvent.import_failed) ?? 0;
  const scanDurations = traffic?.scanDurations ?? {};
  const completedScans = Object.values(scanDurations).reduce((total, row) => total + Number(row?.completed ?? 0), 0);
  const weightedDuration = Object.values(scanDurations).reduce((total, row) => total + (Number(row?.averageMilliseconds ?? 0) * Number(row?.completed ?? 0)), 0);
  const averageScanSeconds = completedScans ? weightedDuration / completedScans / 1000 : 0;
  const recommendations = [];
  const analysisPageVisitors = (Array.isArray(traffic?.topPages) ? traffic.topPages : [])
    .filter((page) => /^\/analyze(?:\/|$)/.test(text(page?.name)))
    .reduce((total, page) => total + Number(page?.sessions ?? 0), 0);
  if (visitors === 0) recommendations.push("No tracked visitors reached PencilProof in this period. Verify campaign links and increase distribution before changing the checkout.");
  else if (scanUsers === 0 && analysisPageVisitors > 0) recommendations.push(`Analytics recorded ${analysisPageVisitors} visits to quote-analysis pages but zero scan-start events. Verify scan-start tracking first; until it is confirmed, do not treat this funnel as proof that visitors refused to scan.`);
  else if (scanUsers / visitors < 0.2) recommendations.push("Fewer than 20% of visitors started a scan. Test a stronger first-screen promise and a more visible free-scan button.");
  else if (previewUsers / Math.max(scanUsers, 1) < 0.5) recommendations.push(`Many scans did not reach a preview. Recorded import outcomes: ${importSuccesses} successes and ${importFailures} categorized failures. Review the failure categories and make manual correction easier.`);
  else if (checkoutUsers / Math.max(previewUsers, 1) < 0.1) recommendations.push("Preview users rarely opened checkout. Strengthen the audit-value explanation immediately before the paid step.");
  else if (purchasers / Math.max(checkoutUsers, 1) < 0.25) recommendations.push("Checkout starts are not converting well. Review price clarity, trust signals, and payment friction.");
  else recommendations.push("The measured funnel has no immediate critical drop. Compare traffic sources and repeat the content that produces the most scans and purchases.");
  if (averageScanSeconds > 15) recommendations.push(`Completed scans averaged ${averageScanSeconds.toFixed(1)} seconds. Reduce document-processing time or set clearer progress expectations.`);
  const sources = Array.isArray(traffic?.sourceFunnel) ? traffic.sourceFunnel : [];
  const best = [...sources]
    .filter((source) => Number(source?.purchasers ?? 0) > 0 || Number(source?.scanUsers ?? 0) > 0)
    .sort((left, right) => Number(right?.purchasers ?? 0) - Number(left?.purchasers ?? 0) || Number(right?.scanUsers ?? 0) - Number(left?.scanUsers ?? 0) || Number(right?.visitors ?? 0) - Number(left?.visitors ?? 0))[0];
  if (best && Number(best.visitors ?? 0) > 0) {
    recommendations.push(`${text(best.name, "The leading source")} produced the strongest measured result (${Number(best.visitors ?? 0)} visitors, ${Number(best.scanUsers ?? 0)} scans, ${Number(best.purchasers ?? 0)} purchases). Reuse its hook and campaign format before increasing weaker sources.`);
  } else if (visitors > 0) {
    const socialVisitors = sources
      .filter((source) => /(?:facebook|instagram|threads)/i.test(text(source?.name)))
      .reduce((total, source) => total + Number(source?.visitors ?? 0), 0);
    recommendations.push(socialVisitors > 0
      ? `${socialVisitors} visitors came from tracked social sources, but no source has a measured scan or purchase yet. Test stronger question-based hooks and a single free-scan call to action before increasing posting volume.`
      : "No traffic source has a measured scan or purchase yet. Confirm conversion tracking, then compare sources by scans and purchases—not visits alone.");
  }
  return recommendations;
}

export function buildOperationsSnapshot({ directStatus = {}, facebookStatus = {}, socialAudit = {}, businessStatus = null, env = {}, now = new Date() }) {
  const configured = configuredPlatforms(env);
  const allMetrics = [
    ...(Array.isArray(directStatus.postMetrics) ? directStatus.postMetrics : []),
    ...(Array.isArray(facebookStatus.postMetrics) ? facebookStatus.postMetrics : []),
    ...(Array.isArray(socialAudit.postMetrics) ? socialAudit.postMetrics : []),
  ];
  const published = {
    ...(directStatus.lastPublishedByPlatform ?? {}),
    ...(facebookStatus.lastPublishedByPlatform ?? {}),
  };
  const platforms = Object.fromEntries(PLATFORM_ORDER.map((platform) => [platform, platformSnapshot(
    platform,
    configured.has(platform),
    published[platform],
    socialAudit?.platforms?.[platform] ?? {},
    allMetrics,
  )]));
  const lastRunAt = newestIso(directStatus.lastRunAt, facebookStatus.lastRunAt);
  const directError = directStatus.lastError ? String(directStatus.lastError).slice(0, 500) : null;
  const facebookError = facebookStatus.lastError ? String(facebookStatus.lastError).slice(0, 500) : null;
  const enabled = String(env.SOCIAL_AUTOMATION_ENABLED ?? "true").toLowerCase() !== "false";
  const components = {
    direct: automationComponent(configured.has("threads") || configured.has("instagram"), directStatus.lastRunAt ?? null, directError, enabled, now),
    facebook: automationComponent(configured.has("facebook"), facebookStatus.lastRunAt ?? null, facebookError, enabled, now),
  };
  const expectedComponents = Object.values(components).filter((component) => component.configured);
  const socialState = !enabled
    ? "paused"
    : expectedComponents.length === 0
      ? "not_configured"
      : expectedComponents.some((component) => component.state !== "healthy")
        ? "needs_attention"
        : "healthy";
  const incidents = [];
  for (const [name, component] of Object.entries(components)) {
    if (component.configured && component.state !== "healthy") incidents.push({ system: `${name} social automation`, state: component.state, detail: component.lastError ?? "The scheduled heartbeat is missing or stale." });
  }
  for (const platform of PLATFORM_ORDER) {
    const item = platforms[platform];
    if (!item.configured) incidents.push({ system: platform, state: "not_configured", detail: "The required account ID or access token is not configured." });
    else if (!item.connected) incidents.push({ system: platform, state: item.connectionState, detail: item.error ?? "The expected account has not been verified by a current read-only request." });
  }
  const email = businessStatus?.email ?? null;
  if (!email) incidents.push({ system: "email reporting", state: "not_measured_yet", detail: "The website/email snapshot has not been synchronized yet." });
  else {
    if (email.automation?.state && email.automation.state !== "healthy") incidents.push({ system: "email automation", state: email.automation.state, detail: email.automation?.lastRun?.details?.error ?? "The latest expected email run is not confirmed healthy." });
    if (email.provider?.status && email.provider.status !== "verified") incidents.push({ system: "Resend", state: email.provider.status, detail: email.provider.error ?? "The Resend account activity check needs attention." });
  }
  const traffic = businessStatus?.traffic ?? null;
  if (!traffic || traffic.status !== "verified") incidents.push({ system: "traffic analytics", state: traffic?.status ?? "not_measured_yet", detail: traffic?.error ?? "The seven-day website ledger is not verified." });
  const repairStatus = facebookStatus.repairStatus ?? null;
  if (Array.isArray(repairStatus?.failed) && repairStatus.failed.length) incidents.push({ system: "automatic social repair", state: "failed", detail: repairStatus.failed.join(" | ") });
  const criticalStates = new Set(["needs_attention", "missed_schedule", "failed", "not_configured", "not_verified", "stale", "no_run_evidence"]);
  return {
    schemaVersion: 2,
    generatedAt: now.toISOString(),
    overallState: incidents.some((item) => criticalStates.has(item.state)) ? "needs_attention" : incidents.length ? "monitoring" : "healthy",
    automation: {
      social: {
        state: socialState,
        enabled,
        publishingEnabled: String(env.SOCIAL_PUBLISH_ENABLED ?? "false").toLowerCase() === "true",
        repliesEnabled: String(env.SOCIAL_REPLY_ENABLED ?? "true").toLowerCase() !== "false",
        expectedSchedule: "Every 30 minutes; publishing still obeys the configured 36-hour cadence and active hours.",
        lastRunAt,
        components,
        lastRepair: repairStatus,
        automaticRepair: "A separate hourly watchdog reruns a stale social branch once. Provider and business snapshots remain limited to one six-hour collection cycle. Expired verification locks are cleared automatically. Credentials and permissions require owner action.",
      },
      email: email?.automation ?? null,
    },
    platforms,
    email,
    traffic,
    recommendations: trafficRecommendations(traffic),
    incidents,
    collection: {
      socialProviderRequestsLastCycle: number(socialAudit.providerRequestsUsed) ?? 0,
      socialProviderRequestLimit: 2,
      normalStatusPageProviderRequests: 0,
      businessSyncCadenceHours: 6,
    },
  };
}

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");
const formatDate = (value) => {
  const parsed = timestamp(value);
  if (parsed === null) return "Not measured yet";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }).format(new Date(parsed));
};
const formatCount = (value) => number(value) === null ? "Not measured" : new Intl.NumberFormat("en-US").format(value);
const formatPlatformMetric = (platform, metric, value) => platform === "threads" && metric === "reach"
  ? "Not provided by Threads"
  : formatCount(value);
const stateLabel = (value) => text(value, "not_measured_yet").replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
const pillClass = (value) => value === "healthy" || value === "verified" ? "good" : value === "needs_attention" || value === "missed_schedule" || value === "failed" ? "bad" : "watch";

function stat(label, value, detail = "") {
  return `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`;
}

function platformRows(snapshot) {
  return PLATFORM_ORDER.map((platform) => {
    const item = snapshot.platforms[platform];
    const postLink = item.lastPost?.url ? `<a href="${escapeHtml(item.lastPost.url)}" target="_blank" rel="noopener noreferrer">Open last post</a>` : "Post link not measured yet";
    return `<tr><th>${escapeHtml(platform[0].toUpperCase() + platform.slice(1))}</th><td><span class="pill ${pillClass(item.connectionState)}">${escapeHtml(stateLabel(item.connectionState))}</span><small>Checked ${escapeHtml(formatDate(item.checkedAt))}</small></td><td>${escapeHtml(formatDate(item.lastPost?.timestamp))}<small>${postLink}</small></td><td>${escapeHtml(formatPlatformMetric(platform, "views", item.metrics.views))}</td><td>${escapeHtml(formatPlatformMetric(platform, "reach", item.metrics.reach))}</td><td>${escapeHtml(formatPlatformMetric(platform, "engagement", item.metrics.engagement))}</td><td>${escapeHtml(item.error ?? "No current provider error")}</td></tr>`;
  }).join("");
}

function sourceRows(traffic) {
  const rows = Array.isArray(traffic?.sourceFunnel) ? traffic.sourceFunnel : [];
  if (!rows.length) return `<tr><td colspan="6">No tracked traffic sources in this seven-day period.</td></tr>`;
  return rows.map((row) => `<tr><th>${escapeHtml(row.name ?? "direct")}</th><td>${escapeHtml(formatCount(row.visitors))}</td><td>${escapeHtml(formatCount(row.scanUsers))}</td><td>${escapeHtml(formatCount(row.previewUsers))}</td><td>${escapeHtml(formatCount(row.checkoutUsers))}</td><td>${escapeHtml(formatCount(row.purchasers))}</td></tr>`).join("");
}

function trafficDailyRows(traffic) {
  const rows = Object.entries(traffic?.byDay ?? {}).sort(([left], [right]) => right.localeCompare(left)).slice(0, 7);
  if (!rows.length) return `<tr><td colspan="6">No daily traffic events were recorded in this seven-day period.</td></tr>`;
  return rows.map(([day, events]) => `<tr><th>${escapeHtml(day)}</th><td>${escapeHtml(formatCount(events?.page_view ?? 0))}</td><td>${escapeHtml(formatCount(events?.scan_started ?? 0))}</td><td>${escapeHtml(formatCount(events?.preview_ready ?? 0))}</td><td>${escapeHtml(formatCount(events?.checkout_started ?? 0))}</td><td>${escapeHtml(formatCount(events?.payment_completed ?? 0))}</td></tr>`).join("");
}

function emailDailyRows(provider, local) {
  const days = [...new Set([...Object.keys(provider?.byDay ?? {}), ...Object.keys(local?.byDay ?? {})])].sort().reverse().slice(0, 7);
  if (!days.length) return `<tr><td colspan="3">No sent-email records were measured in this seven-day period.</td></tr>`;
  return days.map((day) => `<tr><th>${escapeHtml(day)}</th><td>${escapeHtml(formatCount(provider?.byDay?.[day] ?? 0))}</td><td>${escapeHtml(formatCount(local?.byDay?.[day] ?? 0))}</td></tr>`).join("");
}

export function operationsStatusPage(snapshot) {
  const funnel = snapshot.traffic?.funnel ?? {};
  const resend = snapshot.email?.provider ?? {};
  const localEmail = snapshot.email?.localDeliveries ?? {};
  const incidentHtml = snapshot.incidents.length
    ? snapshot.incidents.map((incident) => `<li><strong>${escapeHtml(incident.system)}</strong><span class="pill ${pillClass(incident.state)}">${escapeHtml(stateLabel(incident.state))}</span><p>${escapeHtml(incident.detail)}</p></li>`).join("")
    : `<li><strong>No active incidents</strong><p>All monitored systems have current healthy evidence.</p></li>`;
  const recommendationHtml = snapshot.recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const directAutomation = snapshot.automation.social.components?.direct ?? {};
  const facebookAutomation = snapshot.automation.social.components?.facebook ?? {};
  const repair = snapshot.automation.social.lastRepair ?? {};
  const repairDetail = Array.isArray(repair.failed) && repair.failed.length
    ? repair.failed.join(" | ")
    : Array.isArray(repair.repaired) && repair.repaired.length
      ? `Recovered ${repair.repaired.join(", ")}`
      : "No stale social branch required recovery during the latest watchdog check.";
  const eventCounts = resend.byLastEvent && typeof resend.byLastEvent === "object"
    ? Object.entries(resend.byLastEvent).map(([event, count]) => `${stateLabel(event)} ${formatCount(count)}`).join(" · ")
    : "No provider events measured";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PencilProof operations</title><style>
:root{font-family:Inter,Arial,sans-serif;color:#f5f7fb;background:#061126}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top right,#17375e 0,#061126 42%);min-height:100vh}.shell{max-width:1180px;margin:auto;padding:28px 18px 60px}header{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:22px}.brand{font-weight:900;font-size:20px}.brand b{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:11px;background:#f7c548;color:#07152d;margin-right:10px}.updated{color:#9fb0c7;font-size:12px}.hero,.panel{background:#0c1e3b;border:1px solid #29486d;border-radius:18px;box-shadow:0 18px 50px #0004}.hero{padding:26px;display:flex;justify-content:space-between;align-items:end;gap:20px}.eyebrow{color:#f7c548;font-size:11px;font-weight:900;letter-spacing:.15em;text-transform:uppercase}h1{font:700 clamp(32px,6vw,56px)/1.02 Georgia,serif;margin:10px 0 8px}.hero p,.panel>p{color:#b8c5d7;line-height:1.55;margin:0}.pill{display:inline-block;padding:7px 10px;border-radius:999px;font-size:11px;font-weight:900;white-space:nowrap}.good{background:#133f39;color:#76e6c6}.bad{background:#532c32;color:#ffb5bd}.watch{background:#3b3525;color:#f8d777}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.stat{padding:16px;background:#08182f;border:1px solid #274361;border-radius:14px}.stat span,.stat small{display:block;color:#9fb0c7}.stat span{font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.stat strong{display:block;font-size:22px;margin:9px 0 5px}.stat small{font-size:12px}.panel{padding:22px;margin-top:18px}.panel h2{font:700 28px Georgia,serif;margin:0 0 7px}.table{overflow:auto;margin-top:14px}table{border-collapse:collapse;width:100%;min-width:960px}th,td{text-align:left;vertical-align:top;padding:13px 10px;border-bottom:1px solid #254260;font-size:13px}thead th{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#9fb0c7}td small{display:block;margin-top:7px;color:#9fb0c7}a{color:#f7c548;font-weight:800}.list{padding:0;margin:14px 0 0;list-style:none}.list li{background:#08182f;border:1px solid #274361;border-radius:12px;padding:14px;margin-top:10px}.list strong{margin-right:9px}.list p{color:#b8c5d7;margin:8px 0 0;line-height:1.45}.recommendations{color:#d5dfeb;line-height:1.6}.foot{color:#8499b5;font-size:12px;margin-top:20px}@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}.hero{display:block}.hero>.pill{margin-top:16px}}@media(max-width:480px){.grid{grid-template-columns:1fr}.shell{padding:20px 12px 40px}.hero,.panel{padding:18px}}
</style></head><body><main class="shell"><header><div class="brand"><b>P</b>PencilProof operations</div><div class="updated">Stored snapshot · ${escapeHtml(formatDate(snapshot.generatedAt))}</div></header>
<section class="hero"><div><span class="eyebrow">OPERATIONS AND GROWTH</span><h1>What works. What needs attention.</h1><p>Current evidence from the automation heartbeat, connected platforms, Resend activity, and PencilProof's seven-day traffic ledger.</p></div><span class="pill ${pillClass(snapshot.overallState)}">${escapeHtml(stateLabel(snapshot.overallState))}</span></section>
<section class="grid">${stat("Social automation", stateLabel(snapshot.automation.social.state), `Last run ${formatDate(snapshot.automation.social.lastRunAt)}`)}${stat("Connections", `${Object.values(snapshot.platforms).filter((item) => item.connected).length}/3 verified`, "Expected accounts reached")}${stat("Emails sent · 7 days", formatCount(resend.messages), resend.complete === false ? "Lower bound or not measured" : eventCounts)}${stat("Visitors · 7 days", formatCount(funnel.visitors), `${formatCount(funnel.pageViews)} page views`)}</section>
<section class="panel"><h2>Automation health and recovery</h2><p>The publishing/reply branches are checked independently. The watchdog runs separately from publishing and reruns only a branch whose heartbeat is more than 75 minutes old.</p><div class="grid">${stat("Threads / Instagram", stateLabel(directAutomation.state), `Last run ${formatDate(directAutomation.lastRunAt)}`)}${stat("Facebook", stateLabel(facebookAutomation.state), `Last run ${formatDate(facebookAutomation.lastRunAt)}`)}${stat("Email automation", stateLabel(snapshot.automation.email?.state), `Last run ${formatDate(snapshot.automation.email?.lastRun?.finishedAt)}`)}${stat("Last watchdog", formatDate(repair.checkedAt), repairDetail)}</div><p>${escapeHtml(snapshot.automation.social.automaticRepair)}</p></section>
<section class="panel"><h2>Platform connections and latest posts</h2><p>Verified means a current read-only provider request reached the expected account. The post timestamp and link come from the provider or the confirmed publish receipt.</p><div class="table"><table><thead><tr><th>Platform</th><th>Connection</th><th>Latest post</th><th>Views</th><th>Reach</th><th>Engagement</th><th>Evidence</th></tr></thead><tbody>${platformRows(snapshot)}</tbody></table></div></section>
<section class="panel"><h2>Email activity</h2><p>Resend account activity and PencilProof's own completed campaign-delivery ledger for the last seven days.</p><div class="grid">${stat("Resend connection", stateLabel(resend.status), `Checked ${formatDate(resend.checkedAt)}`)}${stat("Messages", formatCount(resend.messages), "Sent-email records")}${stat("Recipients", formatCount(resend.recipients), eventCounts)}${stat("Local completed sends", formatCount(localEmail.sent), `${formatCount(localEmail.pendingClaims)} stale claims`)}</div><div class="table"><table><thead><tr><th>Day</th><th>Resend sent records</th><th>PencilProof completed sends</th></tr></thead><tbody>${emailDailyRows(resend, localEmail)}</tbody></table></div><p>${escapeHtml(snapshot.automation.email?.automaticRepair ?? "Automatic email repair is waiting for the first synchronized snapshot.")}</p></section>
<section class="panel"><h2>Seven-day traffic funnel</h2><p>Unique tracked browsers at each step. These figures show where traffic or conversion is being lost.</p><div class="grid">${stat("Visitors", formatCount(funnel.visitors), `${formatCount(funnel.pageViews)} page views`)}${stat("Scan users", formatCount(funnel.scanUsers), `${formatCount(funnel.scanStarts)} starts`)}${stat("Preview users", formatCount(funnel.previewUsers), `${formatCount(funnel.previewsReady)} ready`)}${stat("Purchasers", formatCount(funnel.purchasers), `${formatCount(funnel.checkoutStarts)} checkout starts`)}</div><div class="table"><table><thead><tr><th>Source</th><th>Visitors</th><th>Scans</th><th>Previews</th><th>Checkouts</th><th>Purchases</th></tr></thead><tbody>${sourceRows(snapshot.traffic)}</tbody></table></div><div class="table"><table><thead><tr><th>Day</th><th>Page views</th><th>Scan starts</th><th>Previews ready</th><th>Checkout starts</th><th>Payments</th></tr></thead><tbody>${trafficDailyRows(snapshot.traffic)}</tbody></table></div></section>
<section class="panel"><h2>What to improve next</h2><ul class="recommendations">${recommendationHtml}</ul></section>
<section class="panel"><h2>Incidents and automatic repair</h2><p>Safe transient faults are retried or recovered automatically. Credential expiry, lost permissions, and account mismatches are never guessed; they remain visible here for owner action.</p><ul class="list">${incidentHtml}</ul></section>
<p class="foot">Normal page loads make ${snapshot.collection.normalStatusPageProviderRequests} provider requests. Scheduled social verification is capped at ${snapshot.collection.socialProviderRequestLimit} provider requests per collection cycle and rotates across platforms.</p>
</main></body></html>`, { headers: { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
}
