"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildVehicleImageSearchQueries,
  parseVehicleIdentity,
  selectBestVehicleImage,
  type CommonsPage,
  type CommonsVehicleImage,
} from "@/lib/vehicle-image";

type VehiclePhotoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; image: CommonsVehicleImage }
  | { status: "unavailable" };

const CACHE_PREFIX = "pencilproof.vehicle-photo.";

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
  const [photo, setPhoto] = useState<VehiclePhotoState>({ status: "idle" });

  useEffect(() => {
    if (!identity) {
      setPhoto({ status: "idle" });
      return;
    }

    const cacheKey = identity.displayName.toLowerCase().replace(/\s+/g, "-");
    const cached = readCachedImage(cacheKey);
    if (cached) {
      setPhoto({ status: "ready", image: cached });
      return;
    }

    const controller = new AbortController();
    setPhoto({ status: "loading" });

    const load = async () => {
      for (const query of buildVehicleImageSearchQueries(identity)) {
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
            identity,
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
      setPhoto({ status: "unavailable" });
    };

    void load();
    return () => controller.abort();
  }, [identity]);

  if (!identity) return null;

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
          <strong>{identity.displayName}</strong>
          <span>Finding a representative vehicle photo…</span>
        </p>
      </div>
    );
  }

  if (photo.status !== "ready") {
    return (
      <div className={`${className} vehicle-photo-unavailable`}>
        <div aria-hidden="true">AUTO</div>
        <p>
          <strong>{identity.displayName}</strong>
          <span>Vehicle photo unavailable. Confirm the imported description.</span>
        </p>
      </div>
    );
  }

  const { image } = photo;
  return (
    <figure className={className}>
      <img
        src={image.imageUrl}
        alt={`Representative photo of a ${identity.displayName}`}
        loading="lazy"
        onError={() => setPhoto({ status: "unavailable" })}
      />
      <figcaption>
        <div>
          <strong>{identity.displayName}</strong>
          <span>
            {image.exactYearMatch
              ? "Model-year match"
              : "Representative model photo"}{" "}
            · Actual trim and color may vary
          </span>
        </div>
        <small>
          Photo:{" "}
          <a href={image.sourceUrl} target="_blank" rel="noreferrer">
            {image.creator}
          </a>
          {" · "}
          {image.licenseUrl ? (
            <a href={image.licenseUrl} target="_blank" rel="noreferrer">
              {image.license}
            </a>
          ) : (
            image.license
          )}
        </small>
      </figcaption>
    </figure>
  );
}
