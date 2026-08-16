import type { VehicleIdentity } from "@/lib/vehicle-image";

export type VehicleFuelEconomy = {
  label: string;
  note: string;
  sourceUrl: string;
};

const API_ROOT = "https://www.fueleconomy.gov/ws/rest/vehicle";

const normalized = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const epaModelsFor = (identity: VehicleIdentity) => {
  const make = normalized(identity.make);
  const model = normalized(identity.model);
  const trim = normalized(identity.trim ?? "");
  if (
    make === "cadillac" &&
    /^(ct4|ct5)$/.test(model) &&
    (/\bv(?:series)?\b/.test(trim) || trim.includes("blackwing"))
  ) {
    return [`${identity.model} V`, `${identity.model}-V`, identity.model];
  }
  return [identity.model];
};

const readXmlField = (document: Document, name: string) =>
  document.querySelector(name)?.textContent?.trim() ?? "";

const numericField = (document: Document, name: string) => {
  const value = Number(readXmlField(document, name));
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const getXml = async (url: string, signal?: AbortSignal) => {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/xml, text/xml" },
  });
  if (!response.ok) return null;
  const text = await response.text();
  const document = new DOMParser().parseFromString(text, "application/xml");
  return document.querySelector("parsererror") ? null : document;
};

/**
 * Looks up the closest EPA-tested vehicle through FuelEconomy.gov. The quote
 * importer remains independent of this optional reference lookup: if the EPA
 * service is unavailable, the review card simply asks the buyer to verify the
 * exact trim and drivetrain.
 */
export const lookupVehicleFuelEconomy = async (
  identity: VehicleIdentity,
  signal?: AbortSignal,
): Promise<VehicleFuelEconomy | null> => {
  if (!identity.year) return null;

  try {
    let options: { id: string; text: string }[] = [];
    for (const epaModel of epaModelsFor(identity)) {
      const menuParams = new URLSearchParams({
        year: identity.year,
        make: identity.make,
        model: epaModel,
      });
      const menuDocument = await getXml(
        `${API_ROOT}/menu/options?${menuParams.toString()}`,
        signal,
      );
      options = Array.from(menuDocument?.querySelectorAll("menuItem") ?? [])
        .map((item) => ({
          id: item.querySelector("value")?.textContent?.trim() ?? "",
          text: item.querySelector("text")?.textContent?.trim() ?? "",
        }))
        .filter((option) => option.id && option.text);
      if (options.length) break;
    }
    if (!options.length) return null;

    const trimTokens = normalized(identity.trim ?? "")
      .split(" ")
      .filter(Boolean);
    const isBlackwing = trimTokens.includes("blackwing");
    const cylinders = normalized(identity.engineCylinders ?? "");
    const displacement = normalized(identity.displacementL ?? "");
    const transmission = normalized(identity.transmission ?? "");
    const driveType = normalized(identity.driveType ?? "");
    const selected = options
      .map((option, index) => {
        const optionText = normalized(option.text);
        const trimMatch = trimTokens.length > 0 && trimTokens.every((token) =>
          optionText.includes(token),
        );
        const blackwingEngineMatch = isBlackwing &&
          /6 2|8 cyl|sup charg|supercharged/.test(optionText);
        const cylinderMatch = cylinders && new RegExp(`\\b${cylinders}\\s*cyl`).test(optionText);
        const displacementMatch = displacement && optionText.includes(displacement);
        const transmissionMatch = transmission && (
          transmission.includes("manual") && /manual|man\s/.test(optionText) ||
          transmission.includes("automatic") && /auto/.test(optionText)
        );
        const driveMatch = driveType && (
          driveType.includes("all wheel") && /awd|all wheel/.test(optionText) ||
          driveType.includes("four wheel") && /4wd|4 wheel/.test(optionText) ||
          driveType.includes("front wheel") && /fwd|front wheel/.test(optionText) ||
          driveType.includes("rear wheel") && /rwd|rear wheel/.test(optionText)
        );
        const automaticMatch = /auto/.test(optionText);
        const manualMatch = /manual|man\s/.test(optionText);
        return {
          option,
          score:
            (trimMatch ? 35 : 0) +
            (blackwingEngineMatch ? 40 : 0) +
            (cylinderMatch ? 20 : 0) +
            (displacementMatch ? 18 : 0) +
            (transmissionMatch ? 8 : 0) +
            (driveMatch ? 8 : 0) +
            (automaticMatch ? 2 : 0) -
            (manualMatch ? 2 : 0) -
            index / 1000,
        };
      })
      .sort((left, right) => right.score - left.score)[0]?.option;
    if (!selected) return null;

    const detailDocument = await getXml(`${API_ROOT}/${selected.id}`, signal);
    if (!detailDocument) return null;

    const city = numericField(detailDocument, "city08");
    const highway = numericField(detailDocument, "highway08");
    const combined = numericField(detailDocument, "comb08");
    const electric = numericField(detailDocument, "combE");
    const sourceUrl = `https://www.fueleconomy.gov/feg/Find.do?action=sbs&id=${encodeURIComponent(selected.id)}`;

    if (city || highway || combined) {
      const parts = [
        city ? `${city} city` : null,
        highway ? `${highway} hwy` : null,
        combined ? `${combined} combined` : null,
      ].filter(Boolean);
      return {
        label: `${parts.join(" · ")} MPG`,
        note:
          options.length > 1
            ? "EPA estimate · exact drivetrain and equipment can change the rating"
            : "EPA estimate · real-world results vary",
        sourceUrl,
      };
    }

    if (electric) {
      return {
        label: `${electric} kWh/100 mi combined`,
        note: "EPA electricity-use estimate · actual range and use vary",
        sourceUrl,
      };
    }
  } catch {
    return null;
  }

  return null;
};
