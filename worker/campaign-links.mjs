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

function slugPart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function publicPilotUrl(source = "social", content = "") {
  const normalized = String(source ?? "").trim().toLowerCase();
  const utmSource = SOURCE_BY_PLATFORM[normalized] ?? (normalized || "social");
  const params = new URLSearchParams({
    utm_source: utmSource,
    utm_medium: "organic",
    utm_campaign: "free_scan",
  });
  const contentLabel = slugPart(content);
  if (contentLabel) params.set("utm_content", contentLabel);
  return `${PILOT_URL}?${params.toString()}`;
}

export function routePostToPilot(post, platform = "social", content = "") {
  const normalizedPlatform = String(platform ?? "").trim().toLowerCase();
  const link = publicPilotUrl(normalizedPlatform, content);
  const maxLength = MAX_POST_LENGTH_BY_PLATFORM[normalizedPlatform] ?? 500;
  const withoutLinks = String(post ?? "")
    .replace(PENCILPROOF_URL_PATTERN, "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const availableTextLength = Math.max(0, maxLength - link.length - 1);
  const text = withoutLinks.length > availableTextLength
    ? `${withoutLinks.slice(0, Math.max(0, availableTextLength - 1)).trimEnd()}…`
    : withoutLinks;
  return text ? `${text} ${link}` : link;
}
