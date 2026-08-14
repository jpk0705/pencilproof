"use client";

import Link from "next/link";
import { Clerk } from "@clerk/clerk-js";
import { useEffect, useState } from "react";
import { authRedirectOptions, createLoadedClerk } from "@/lib/clerk-client";

const ACCOUNT_URL = "https://audit.pencilproof.com/account";

export default function AccountNav() {
  const [clerk, setClerk] = useState<Clerk | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!publishableKey) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void createLoadedClerk(publishableKey)
      .then((instance) => {
        if (cancelled) return;
        setClerk(instance);
        setSignedIn(Boolean(instance.user));
        unsubscribe = instance.addListener(() => {
          if (!cancelled) setSignedIn(Boolean(instance.user));
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  if (!clerk) {
    return <button className="nav-account-button" type="button" disabled aria-label="Sign in loading">Sign in</button>;
  }
  return signedIn
    ? <Link className="nav-account-link" href={ACCOUNT_URL}>My Audits</Link>
    : <button className="nav-account-button" type="button" onClick={() => clerk.openSignIn(authRedirectOptions())}>Sign in</button>;
}
