"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildVehicleImageSearchQueries,
  extractVehicleVin,
  parseVehicleIdentity,
  selectBestVehicleImage,
  type CommonsPage,
  type CommonsVehicleImage,
} from "@/lib/vehicle-image";
import { lookupVehicleFuelEconomy, type VehicleFuelEconomy } from "@/lib/vehicle-fuel-economy";
import { decodeVehicleVin } from "@/lib/vehicle-vin";
import type { VehicleIdentity } from "@/lib/vehicle-image";

type VehiclePhotoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; image: CommonsVehicleImage }
  | { status: "fallback" };

const CACHE_PREFIX = "pencilproof.vehicle-photo.";
const LOCAL_FALLBACK_IMAGE = "/vehicle-placeholder.png";

const readCachedImage = (key: string): CommonsVehicleImage | null => {
  try {
    const saved = sessionStorage.getItem(`${CACHE_PREFIX}${key}`);
    return saved ? (JSON.parse(saved) as CommonsVehicleImage) : null;
  } catch {
    return null;
  }
};

const cacheImage = (key: string, image: CommonsVehicleImage) => {
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(image));
  } catch {
    return;
  }
};

const commonsSearchUrl = (query: string) => {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "8",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "960",
  });
  return `https://commons.wikimedia.org/w/api.php?${params.toString()}`;
};

export default function VehiclePhoto({
  vehicle,
  tone = "light",
  compact = false,
}: {
  vehicle: string;
  tone?: "light" | "dark";
  compact?: boolean;
}) {
  const identity = useMemo(() => parseVehicleIdentity(vehicle), [vehicle]);
  const [vinIdentity, setVinIdentity] = useState<VehicleIdentity | null>(null);
  const resolvedIdentity = useMemo(() => {
    if (!identity && !vinIdentity) return null;
    if (!identity) return vinIdentity;
    if (!vinIdentity) return identity;
    return {
      ...identity,
      year: vinIdentity.year ?? identity.year,
      make: vinIdentity.make || identity.make,
      model: vinIdentity.model || identity.model,
      trim: identity.trim ?? vinIdentity.trim,
      displayName: vinIdentity.displayName || identity.displayName,
    };
  }, [identity, vinIdentity]);
  const [photo, setPhoto] = useState<VehiclePhotoState>({ status: "idle" });
  const [fuelEconomy, setFuelEconomy] = useState<VehicleFuelEconomy | null>(null);
  const [fuelEconomyLoading, setFuelEconomyLoading] = useState(false);

  useEffect(() => {
    const vin = identity?.vin ?? extractVehicleVin(vehicle);
    if (!vin) {
      setVinIdentity(null);
      return;
    }
    const controller = new AbortController();
    void decodeVehicleVin(vin, controller.signal).then((decoded) => {
      if (!controller.signal.aborted) setVinIdentity(decoded);
    });
    return () => controller.abort();
  }, [identity?.vin, vehicle]);

  useEffect(() => {
    if (!resolvedIdentity) {
      setPhoto({ status: "idle" });
      setFuelEconomy(null);
      setFuelEconomyLoading(false);
      return;
    }

    const cacheKey = resolvedIdentity.displayName.toLowerCase().replace(/\s+/g, "-");
    const cached = readCachedImage(cacheKey);
    if (cached) {
      setPhoto({ status: "ready", image: cached });
      return;
    }

    const controller = new AbortController();
    setPhoto({ status: "loading" });

    const load = async () => {
      for (const query of buildVehicleImageSearchQueries(resolvedIdentity)) {
        try {
          const response = await fetch(commonsSearchUrl(query), {
            signal: controller.signal,
          });
          if (!response.ok) continue;
          const result = (await response.json()) as {
            query?: { pages?: Record<string, CommonsPage> };
          };
          const selected = selectBestVehicleImage(
            Object.values(result.query?.pages ?? {}),
            resolvedIdentity,
          );
          if (selected) {
            cacheImage(cacheKey, selected);
            setPhoto({ status: "ready", image: selected });
            return;
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }
      setPhoto({ status: "fallback" });
    };

    void load();
    return () => controller.abort();
  }, [resolvedIdentity]);

  useEffect(() => {
    if (!resolvedIdentity?.year) {
      setFuelEconomy(null);
      setFuelEconomyLoading(false);
      return;
    }

    const controller = new AbortController();
    setFuelEconomy(null);
    setFuelEconomyLoading(true);
    void lookupVehicleFuelEconomy(resolvedIdentity, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setFuelEconomy(result ?? {
          label: "EPA estimate unavailable right now",
          note: "Check FuelEconomy.gov later for the exact model and drivetrain.",
          sourceUrl: "https://www.fueleconomy.gov/",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setFuelEconomyLoading(false);
      });
    return () => controller.abort();
  }, [resolvedIdentity]);

  if (!resolvedIdentity) return null;

  const className = [
    "vehicle-photo",
    `vehicle-photo-${tone}`,
    compact ? "vehicle-photo-compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (photo.status === "loading") {
    return (
      <div className={`${className} vehicle-photo-loading`} aria-live="polite">
        <div aria-hidden="true" />
        <p>
          <strong>{resolvedIdentity.displayName}</strong>
          <span>Finding a representative vehicle photo…</span>
        </p>
      </div>
    );
  }

  const isFallback = photo.status === "fallback";
  if (photo.status !== "ready" && !isFallback) return null;

  const image = photo.status === "ready" ? photo.image : null;
  return (
    <figure className={className}>
      <img
        src={image?.imageUrl ?? LOCAL_FALLBACK_IMAGE}
        alt={`${isFallback ? "Representative" : "Photo of"} a ${resolvedIdentity.displayName}`}
        loading="lazy"
        onError={(event) => {
          if (!isFallback) {
            event.currentTarget.src = LOCAL_FALLBACK_IMAGE;
            setPhoto({ status: "fallback" });
          }
        }}
      />
      <figcaption>
        <div className="vehicle-photo-header">
          <span className="vehicle-photo-kicker">VEHICLE MATCH</span>
          <strong>{resolvedIdentity.displayName}</strong>
          <span>
            {isFallback
              ? "Representative vehicle image · Actual trim and color may vary"
              : `${image?.exactYearMatch ? "Model-year match" : "Representative model photo"} · Actual trim and color may vary`}
          </span>
        </div>
        <div className="vehicle-photo-match-grid" aria-label="Detected vehicle details">
          <div>
            <span>YEAR</span>
            <b>{resolvedIdentity.year ?? "Not detected"}</b>
          </div>
          <div>
            <span>MAKE</span>
            <b>{resolvedIdentity.make}</b>
          </div>
          <div>
            <span>MODEL</span>
            <b>{resolvedIdentity.model}</b>
          </div>
        </div>
        <div className="vehicle-photo-reference">
          <div className="vehicle-photo-reference-heading">
            <span>QUICK VEHICLE REFERENCE</span>
            <small>{fuelEconomyLoading ? "Checking EPA data…" : "Helpful context for your review"}</small>
          </div>
          <div className="vehicle-photo-reference-grid">
            <div>
              <span>TRIM</span>
              <b>{resolvedIdentity.trim ?? "Trim not included in quote text"}</b>
            </div>
            <div>
              <span>BODY STYLE</span>
              <b>{bodyStyleFor(resolvedIdentity.model)}</b>
            </div>
            <div className="vehicle-photo-reference-wide">
              <span>EPA FUEL ECONOMY</span>
              <b>{fuelEconomy?.label ?? (fuelEconomyLoading ? "Looking up exact model…" : "Check exact trim")}</b>
              <small>
                {fuelEconomy ? (
                  <a href={fuelEconomy.sourceUrl} target="_blank" rel="noreferrer">View EPA rating</a>
                ) : "Engine and drivetrain can change the rating."}
              </small>
            </div>
            <div className="vehicle-photo-reference-wide">
              <span>VERIFY BEFORE SIGNING</span>
              <b>Trim · drivetrain · mileage</b>
              <small>These details affect value, payment, and ownership cost.</small>
            </div>
          </div>
        </div>
        <p className="vehicle-photo-note">
          Use this image as a visual reference while checking the imported
          vehicle description and quote figures.
        </p>
        {isFallback ? (
          <small>Custom PencilProof image · exact trim and color may vary</small>
        ) : (
          <small>
            Photo:{" "}
            <a href={image?.sourceUrl ?? "#"} target="_blank" rel="noreferrer">
              {image?.creator}
            </a>
            {" · "}
            {image?.licenseUrl ? (
              <a href={image.licenseUrl} target="_blank" rel="noreferrer">
                {image.license}
              </a>
            ) : (
              image?.license
            )}
          </small>
        )}
      </figcaption>
    </figure>
  );
}

const bodyStyleFor = (model: string) => {
  const value = model.toLowerCase();
  if (/\b(?:f-?150|silverado|sierra|ram|tacoma|tundra|frontier|colorado|ranger|ridgeline|titan|maverick|gladiator)\b/.test(value)) return "Pickup";
  if (/\b(?:odyssey|sienna|pacifica|carnival|transit|sprinter|promaster)\b/.test(value)) return "Van";
  if (/\b(?:cx|cr-?v|rav4|outlander|equinox|tahoe|suburban|explorer|escape|pilot|passport|highlander|4runner|rogue|murano|pathfinder|tucson|santa fe|palisade|telluride|sportage|sorento|forester|outback|ascent|grand cherokee|cherokee|wrangler|compass|renegade|x[0-9]|q[3-8]|glc|gle|glb|model y|model x|macan|cayenne|crosstrek|eclipse cross)\b/.test(value)) return "SUV / crossover";
  if (/\b(?:miata|mx-?5|mustang|camaro|corvette|challenger|charger|supra|z4|911|718|gr86|brz|roadster)\b/.test(value)) return "Coupe / sports car";
  return "Passenger vehicle";
};
