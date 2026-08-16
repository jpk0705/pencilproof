export type VehicleIdentity = {
  year?: string;
  make: string;
  model: string;
  trim?: string;
  vin?: string;
  engineCylinders?: string;
  displacementL?: string;
  driveType?: string;
  transmission?: string;
  fuelType?: string;
  displayName: string;
};

export type CommonsVehicleImage = {
  imageUrl: string;
  sourceUrl: string;
  title: string;
  creator: string;
  license: string;
  licenseUrl?: string;
  exactYearMatch: boolean;
  exactTrimMatch?: boolean;
};

type CommonsImageInfo = {
  thumburl?: string;
  url?: string;
  descriptionurl?: string;
  extmetadata?: {
    Artist?: { value?: string };
    LicenseShortName?: { value?: string };
    LicenseUrl?: { value?: string };
  };
};

export type CommonsPage = {
  title?: string;
  imageinfo?: CommonsImageInfo[];
};

const vehicleMakes = [
  "Alfa Romeo",
  "Aston Martin",
  "Mercedes-Benz",
  "Mercedes Benz",
  "Land Rover",
  "Range Rover",
  "Rolls-Royce",
  "Rolls Royce",
  "Lucid Motors",
  "AM General",
  "Acura",
  "Audi",
  "Bentley",
  "BMW",
  "Buick",
  "Cadillac",
  "Chevrolet",
  "Chrysler",
  "Dodge",
  "Ferrari",
  "Fiat",
  "Fisker",
  "Ford",
  "Genesis",
  "GMC",
  "Honda",
  "Hummer",
  "Hyundai",
  "Infiniti",
  "Isuzu",
  "Jaguar",
  "Jeep",
  "Kia",
  "Lamborghini",
  "Lexus",
  "Lincoln",
  "Lotus",
  "Lucid",
  "Maserati",
  "Mazda",
  "McLaren",
  "Mercury",
  "Mini",
  "Mitsubishi",
  "Nissan",
  "Oldsmobile",
  "Polestar",
  "Pontiac",
  "Porsche",
  "Ram",
  "Rivian",
  "Saab",
  "Saturn",
  "Scion",
  "Smart",
  "Subaru",
  "Suzuki",
  "Tesla",
  "Toyota",
  "VinFast",
  "Volkswagen",
  "Volvo",
].sort((a, b) => b.length - a.length);

const trimAndDetailTokens = new Set([
  "2wd",
  "4wd",
  "4x2",
  "4x4",
  "awd",
  "fwd",
  "rwd",
  "base",
  "black",
  "blackwing",
  "v-series",
  "label",
  "high",
  "country",
  "king",
  "ranch",
  "wildtrak",
  "badlands",
  "tremor",
  "raptor",
  "wilderness",
  "willys",
  "rubicon",
  "z71",
  "zr2",
  "type",
  "r-line",
  "competition",
  "plaid",
  "calligraphy",
  "prestige",
  "signature",
  "luxury",
  "technology",
  "advanced",
  "cvt",
  "denali",
  "elite",
  "ex",
  "ex-l",
  "gt",
  "gt-line",
  "hybrid",
  "l",
  "laramie",
  "lariat",
  "le",
  "limited",
  "ls",
  "lt",
  "ltz",
  "lx",
  "platinum",
  "premier",
  "premium",
  "pro",
  "reserve",
  "rst",
  "s",
  "se",
  "sel",
  "select",
  "sport",
  "sr",
  "sr5",
  "sv",
  "sx",
  "sxt",
  "titanium",
  "touring",
  "trailhawk",
  "trd",
  "xdrive",
  "xl",
  "xle",
  "xlt",
  "xse",
]);

const vehicleTrimTokens = new Set([
  "base",
  "black",
  "blackwing",
  "v-series",
  "label",
  "high",
  "country",
  "king",
  "ranch",
  "wildtrak",
  "badlands",
  "tremor",
  "raptor",
  "wilderness",
  "willys",
  "rubicon",
  "z71",
  "zr2",
  "type",
  "r-line",
  "competition",
  "plaid",
  "calligraphy",
  "prestige",
  "signature",
  "luxury",
  "technology",
  "advanced",
  "denali",
  "elite",
  "ex",
  "ex-l",
  "gt",
  "gt-line",
  "lariat",
  "le",
  "limited",
  "ls",
  "lt",
  "ltz",
  "lx",
  "platinum",
  "premier",
  "premium",
  "pro",
  "reserve",
  "rst",
  "s",
  "se",
  "sel",
  "select",
  "sport",
  "sr",
  "sr5",
  "sv",
  "sx",
  "sxt",
  "titanium",
  "touring",
  "trailhawk",
  "trd",
  "xl",
  "xle",
  "xlt",
  "xse",
]);

const trimContinuationTokens = new Set([
  ...vehicleTrimTokens,
  "series",
  "line",
  "edition",
  "package",
  "group",
  "plus",
  "max",
  "performance",
  "appearance",
]);

const bodyStyleTokens = new Set([
  "sedan",
  "coupe",
  "convertible",
  "hatchback",
  "wagon",
  "roadster",
  "suv",
  "utility",
  "pickup",
  "truck",
  "van",
  "minivan",
  "4d",
  "2d",
]);

const excludedImageTerms =
  /\b(?:antique|badge|brochure|cab|classic|concept|custom|dashboard|diagram|engine|grille|hot\s*rod|interior|logo|manual|oldtimer|parts?|prototype|reproduction|replica|restomod|retro|seat|steering|vintage|wheel)\b/i;

const normalize = (value: string) =>
  value
    .replace(/[|•·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripHtml = (value?: string) =>
  (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const comparable = (value: string) =>
  value
    .toLowerCase()
    .replace(/mercedes[\s-]+benz/g, "mercedes")
    .replace(/rolls[\s-]+royce/g, "rollsroyce")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const makePattern = (make: string) =>
  new RegExp(
    `\\b${make
      .split(/[\s-]+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s-]+")}\\b`,
    "i",
  );

export const extractVehicleVin = (rawVehicle: string) =>
  rawVehicle.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0].toUpperCase();

const formatModelToken = (token: string) => {
  if (
    /^[A-Z]{4,}$/.test(token) &&
    !/\d/.test(token) &&
    !token.includes("-")
  ) {
    return `${token.charAt(0)}${token.slice(1).toLowerCase()}`;
  }
  return token;
};

export const parseVehicleIdentity = (
  rawVehicle: string,
): VehicleIdentity | null => {
  const vin = extractVehicleVin(rawVehicle);
  const cleaned = normalize(
    rawVehicle
      .replace(/\b(?:vin|stock)\s*(?:number|no\.?|#)?\s*[:#-]?\s*[A-HJ-NPR-Z0-9]{6,17}\b/gi, " ")
      .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, " "),
  );
  if (!cleaned) return null;

  const yearMatch = cleaned.match(/\b(19[8-9]\d|20[0-3]\d)\b/);
  const matchedMake = vehicleMakes.find((make) => makePattern(make).test(cleaned));
  if (!matchedMake) return null;

  const makeMatch = makePattern(matchedMake).exec(cleaned);
  if (!makeMatch) return null;
  const afterMake = normalize(cleaned.slice(makeMatch.index + makeMatch[0].length));
  if (!afterMake) return null;

  let trim: string | undefined;
  let model = "";
  const modelTokens: string[] = [];
  const trimTokens: string[] = [];
  for (const token of afterMake.split(" ")) {
    const cleanToken = token.replace(/[(),]/g, "");
    const normalizedToken = cleanToken.toLowerCase();
    const isHardStop =
      bodyStyleTokens.has(normalizedToken) ||
      /^(?:[248]dr|automatic|manual|electric|diesel|gas|phev|hev)$/i.test(
        normalizedToken,
      ) ||
      /^(?:v[468]|i[346]|[124]\.\d[lt]?)$/i.test(normalizedToken);

    if (trimTokens.length > 0) {
      if (isHardStop || !trimContinuationTokens.has(normalizedToken)) break;
      trimTokens.push(cleanToken);
      continue;
    }

    if (modelTokens.length > 0 && isHardStop) break;
    if (modelTokens.length > 0 && vehicleTrimTokens.has(normalizedToken)) {
      trimTokens.push(cleanToken);
      continue;
    }

    modelTokens.push(cleanToken);
    if (modelTokens.length === 3) break;
  }
  model = normalize(modelTokens.map(formatModelToken).join(" "));
  if (trimTokens.length > 0) trim = normalize(trimTokens.join(" "));
  if (!model) return null;
  const canonicalMake =
    matchedMake === "Mercedes Benz"
      ? "Mercedes-Benz"
      : matchedMake === "Rolls Royce"
        ? "Rolls-Royce"
        : matchedMake;
  const year = yearMatch?.[1];

  return {
    year,
    make: canonicalMake,
    model,
    ...(trim ? { trim } : {}),
    ...(vin ? { vin } : {}),
    displayName: normalize(
      [year, canonicalMake, model].filter(Boolean).join(" "),
    ),
  };
};

export const buildVehicleImageSearchQueries = (
  identity: VehicleIdentity,
) => {
  const exactWithTrim = [identity.year, identity.make, identity.model, identity.trim]
    .filter(Boolean)
    .join(" ");
  const exact = [identity.year, identity.make, identity.model]
    .filter(Boolean)
    .join(" ");
  const representative = `${identity.make} ${identity.model}`;
  return [...new Set(
    [exactWithTrim, exact, representative].filter(Boolean),
  )];
};

const validCommonsUrl = (value?: string) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["upload.wikimedia.org", "commons.wikimedia.org"].includes(url.hostname)
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

const validLicenseUrl = (value?: string) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      ![
        "creativecommons.org",
        "www.creativecommons.org",
        "commons.wikimedia.org",
      ].includes(url.hostname)
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

export const selectBestVehicleImage = (
  pages: CommonsPage[],
  identity: VehicleIdentity,
  options?: { requireTrim?: boolean; requireYear?: boolean },
): CommonsVehicleImage | null => {
  const makeNeedle = comparable(identity.make);
  const modelNeedles = comparable(identity.model).split(" ").filter(Boolean);
  const trimNeedles = comparable(identity.trim ?? "").split(" ").filter(Boolean);
  const candidates = pages
    .map<{ image: CommonsVehicleImage; score: number } | null>((page) => {
      const title = normalize((page.title ?? "").replace(/^File:/i, ""));
      const titleComparable = comparable(title);
      const imageInfo = page.imageinfo?.[0];
      const imageUrl = validCommonsUrl(imageInfo?.thumburl ?? imageInfo?.url);
      const sourceUrl = validCommonsUrl(imageInfo?.descriptionurl);
      if (
        !title ||
        !imageUrl ||
        !sourceUrl ||
        excludedImageTerms.test(title) ||
        !titleComparable.includes(makeNeedle) ||
        !modelNeedles.every((part) => titleComparable.includes(part))
      ) {
        return null;
      }

      const exactYearMatch = Boolean(
        identity.year && new RegExp(`\\b${identity.year}\\b`).test(title),
      );
      if (options?.requireYear && !exactYearMatch) return null;
      const exactTrimMatch = trimNeedles.length > 0 && trimNeedles.every((part) => titleComparable.includes(part));
      if (options?.requireTrim && !exactTrimMatch) return null;
      const creator =
        stripHtml(imageInfo?.extmetadata?.Artist?.value) || "Wikimedia contributor";
      const license = stripHtml(
        imageInfo?.extmetadata?.LicenseShortName?.value,
      );
      if (!license) return null;
      const licenseUrl = validLicenseUrl(
        imageInfo?.extmetadata?.LicenseUrl?.value,
      );
      const frontOrExteriorBonus = /\b(?:front|exterior|three-quarter)\b/i.test(
        title,
      )
        ? 2
        : 0;
      const image: CommonsVehicleImage = {
        imageUrl,
        sourceUrl,
        title,
        creator,
        license,
        ...(licenseUrl ? { licenseUrl } : {}),
        exactYearMatch,
        ...(exactTrimMatch ? { exactTrimMatch: true } : {}),
      };
      return {
        image,
        score: (exactTrimMatch ? 20 : 0) + (exactYearMatch ? 10 : 0) + frontOrExteriorBonus,
      };
    })
    .filter(
      (
        candidate,
      ): candidate is { image: CommonsVehicleImage; score: number } =>
        candidate !== null,
    )
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.image ?? null;
};
