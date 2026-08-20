"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createLoadedClerk } from "@/lib/clerk-client";

const Arrow = () => <span aria-hidden="true">→</span>;

export default function SalesEntrySection() {
  const [visible, setVisible] = useState<boolean | null>(null);

  useEffect(() => {
    const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!publishableKey) {
      setVisible(true);
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void createLoadedClerk(publishableKey)
      .then((clerk) => {
        if (cancelled) return;
        const update = () => setVisible(!clerk.user);
        update();
        unsubscribe = clerk.addListener(update);
      })
      .catch(() => {
        if (!cancelled) setVisible(true);
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  if (visible !== true) return null;

  return (
    <section className="sales-entry-section section" aria-labelledby="sales-entry-title">
      <div className="shell sales-entry-card">
        <div>
          <p className="kicker">FOR AUTOMOTIVE SALESPEOPLE</p>
          <h2 id="sales-entry-title">A clearer way to review the numbers with your customer.</h2>
          <p>Use the same private quote scan to understand payment structure, optional products, APR, term, trade figures, and the questions a customer may have—without exposing their quote to PencilProof or to another salesperson.</p>
        </div>
        <div className="sales-entry-actions">
          <Link className="button button-primary" href="/sales">Explore salesperson tools <Arrow /></Link>
          <span>$20/month · tracked link · unlimited referral credits</span>
        </div>
      </div>
    </section>
  );
}
