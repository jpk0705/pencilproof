import type { VehicleIdentity } from "@/lib/vehicle-image";

const API_ROOT = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";

type VinResult = {
  ErrorCode?: string;
  DriveType?: string;
  DisplacementL?: string;
  EngineCylinders?: string;
  FuelTypePrimary?: string;
  Make?: string;
  Model?: string;
  ModelYear?: string;
  Series?: string;
  TransmissionStyle?: string;
  Trim?: string;
};

const clean = (value?: string) => value?.trim() || undefined;

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export const normalizeVehicleVin = (value?: string) => {
  const compact = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // VINs exclude I, O, and Q. Treat those impossible letters as the OCR
  // look-alike digits 1 or 0 before strict validation.
  const normalized = compact.replace(/I/g, "1").replace(/[OQ]/g, "0");
  return VIN_PATTERN.test(normalized) ? normalized : undefined;
};

/** Finds a VIN in OCR text, including a VIN printed with spaces between characters. */
export const extractVinFromText = (text: string) => {
  // Preserve strict VIN validation while handling common OCR spacing in the
  // label, such as “V I N” or “Vehicle Identification Number”.
  const normalizedText = text
    .replace(/\bV\s*[I1]\s*N\b/gi, "VIN")
    .replace(/\bVehicle\s+(?:Identification|ID)\s+(?:Number|No\.?)\b/gi, "VIN");
  const labeledSections = normalizedText.split(/\bVIN\s*(?:number|no\.?|#)?\s*[:#-]?/i).slice(1);
  for (const section of labeledSections.slice(0, 4)) {
    const candidate = section.match(/(?:[A-Z0-9](?:[\s-]*[A-Z0-9]){16})/i)?.[0];
    const normalizedCandidate = normalizeVehicleVin(candidate);
    if (normalizedCandidate) return normalizedCandidate;
  }

  const directMatches = normalizedText.match(/\b[A-Z0-9]{17}\b/gi) ?? [];
  for (const candidate of directMatches) {
    const normalizedDirect = normalizeVehicleVin(candidate);
    if (normalizedDirect) return normalizedDirect;
  }

  return undefined;
};

export const decodeVehicleVin = async (
  vin: string,
  signal?: AbortSignal,
): Promise<VehicleIdentity | null> => {
  try {
    const normalizedVin = normalizeVehicleVin(vin);
    if (!normalizedVin) return null;
    const response = await fetch(`${API_ROOT}/${encodeURIComponent(normalizedVin)}?format=json`, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { Results?: VinResult[] };
    const result = payload.Results?.[0];
    const year = clean(result?.ModelYear);
    const make = clean(result?.Make);
    const model = clean(result?.Model);
    const errorCode = result?.ErrorCode?.split(",").map((code) => code.trim()) ?? [];
    if (!year || !make || !model || !errorCode.includes("0")) return null;
    const normalizedMake = make.charAt(0) + make.slice(1).toLowerCase();
    const trim = clean(result?.Trim) ?? clean(result?.Series);
    return {
      year,
      make: normalizedMake,
      model,
      ...(trim ? { trim } : {}),
      displayName: `${year} ${normalizedMake} ${model}`,
      vin: normalizedVin,
      ...(clean(result?.EngineCylinders) ? { engineCylinders: clean(result?.EngineCylinders) } : {}),
      ...(clean(result?.DisplacementL) ? { displacementL: clean(result?.DisplacementL) } : {}),
      ...(clean(result?.DriveType) ? { driveType: clean(result?.DriveType) } : {}),
      ...(clean(result?.TransmissionStyle) ? { transmission: clean(result?.TransmissionStyle) } : {}),
      ...(clean(result?.FuelTypePrimary) ? { fuelType: clean(result?.FuelTypePrimary) } : {}),
    };
  } catch {
    return null;
  }
};
