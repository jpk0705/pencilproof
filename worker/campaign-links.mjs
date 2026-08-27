const PILOT_URL = "https://pencilproof.com/pilot";

const SOURCE_BY_PLATFORM = {
  bluesky: "bluesky",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  threads: "threads",
  twitter: "twitter",
};

const MAX_POST_LENGTH_BY_PLATFORM = {
  bluesky: 300,
  facebook: 63206,
  instagram: 2200,
  linkedin: 3000,
  threads: 500,
  twitter: 280,
};

const PENCILPROOF_URL_PATTERN = /https?:\/\/(?:www\.)?pencilproof\.com(?:\/[^\s]*)?/gi;

export function publicPilotUrl(source = "social") {
  const normalized = String(source ?? "").trim().toLowerCase();
  const utmSource = SOURCE_BY_PLATFORM[normalized] ?? (normalized || "social");
  const params = new URLSearchParams({
    utm_source: utmSource,
    utm_medium: "organic",
    utm_campaign: "free_scan",
  });
  return `${PILOT_URL}?${params.toString()}`;
}

export function routePostToPilot(post, platform = "social") {
  const normalizedPlatform = String(platform ?? "").trim().toLowerCase();
  const link = publicPilotUrl(normalizedPlatform);
  const maxLength = MAX_POST_LENGTH_BY_PLATFORM[normalizedPlatform] ?? 500;
  const withoutLinks = String(post ?? "")
    .replace(PENCILPROOF_URL_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
  const availableTextLength = Math.max(0, maxLength - link.length - 1);
  const text = withoutLinks.length > availableTextLength
    ? `${withoutLinks.slice(0, Math.max(0, availableTextLength - 1)).trimEnd()}…`
    : withoutLinks;
  return text ? `${text} ${link}` : link;
}

