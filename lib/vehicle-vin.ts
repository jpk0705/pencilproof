import type { VehicleIdentity } from "@/lib/vehicle-image";

const API_ROOT = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";

type VinResult = {
  ErrorCode?: string;
  Make?: string;
  Model?: string;
  ModelYear?: string;
  Series?: string;
  Trim?: string;
};

const clean = (value?: string) => value?.trim() || undefined;

export const decodeVehicleVin = async (
  vin: string,
  signal?: AbortSignal,
): Promise<VehicleIdentity | null> => {
  try {
    const response = await fetch(`${API_ROOT}/${encodeURIComponent(vin)}?format=json`, {
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
      vin,
    };
  } catch {
    return null;
  }
};
