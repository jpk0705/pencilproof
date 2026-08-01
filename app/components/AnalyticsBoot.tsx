"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

export default function AnalyticsBoot() {
  useEffect(() => {
    track({ event: "page_view" });
  }, []);
  return null;
}
