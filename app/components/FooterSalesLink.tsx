"use client";

import Link from "next/link";
import { Clerk } from "@clerk/clerk-js";
import { useEffect, useState } from "react";
import { createLoadedClerk } from "@/lib/clerk-client";

export default function FooterSalesLink() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!publishableKey) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void createLoadedClerk(publishableKey)
      .then((instance: Clerk) => {
        if (cancelled) return;
        const updateVisibility = () => setVisible(!instance.user);
        updateVisibility();
        unsubscribe = instance.addListener(updateVisibility);
      })
      .catch(() => {
        // Keep the public link visible if Clerk cannot load.
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return visible ? <Link href="/sales">For salespeople</Link> : null;
}
