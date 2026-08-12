"use client";

import Link from "next/link";
import { Clerk } from "@clerk/clerk-js";
import { useEffect, useState } from "react";
import { createLoadedClerk } from "@/lib/clerk-client";

const ACCOUNT_URL = "https://audit.pencilproof.com/account";

export default function AccountNav() {
  const [clerk, setClerk] = useState<Clerk | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!publishableKey) return;

    let cancelled = false;
    void createLoadedClerk(publishableKey)
      .then((instance) => {
        if (!cancelled) {
          setClerk(instance);
          setAuthReady(Boolean(instance.user && instance.session));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!clerk) return;
    const syncAuth = () => setAuthReady(Boolean(clerk.user && clerk.session));
    syncAuth();
    const interval = window.setInterval(syncAuth, 250);
    return () => window.clearInterval(interval);
  }, [clerk]);

  if (!clerk || !authReady) {
    return <button className="nav-account-button" type="button" onClick={() => clerk?.openSignIn({})} disabled={!clerk}>Sign in</button>;
  }

  if (!clerk.user) {
    return <button className="nav-account-button" type="button" onClick={() => clerk.openSignIn({})}>Sign in</button>;
  }

  return (
    <span className="nav-account-state">
      <Link className="nav-account-button" href={ACCOUNT_URL}>My Account</Link>
      <span className="nav-account-signed-in">Signed in</span>
    </span>
  );
}
