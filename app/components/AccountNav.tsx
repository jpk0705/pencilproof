"use client";

import Link from "next/link";
import { Clerk } from "@clerk/clerk-js";
import { useEffect, useState } from "react";
import { authRedirectOptions, createLoadedClerk } from "@/lib/clerk-client";

const ACCOUNT_URL = "https://audit.pencilproof.com/account";

export default function AccountNav() {
  const [clerk, setClerk] = useState<Clerk | null>(null);

  useEffect(() => {
    const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!publishableKey) return;

    let cancelled = false;
    void createLoadedClerk(publishableKey)
      .then((instance) => {
        if (!cancelled) setClerk(instance);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  if (!clerk) return null;
  return clerk.user
    ? <Link href={ACCOUNT_URL}>My Audits</Link>
    : <button className="nav-account-button" type="button" onClick={() => clerk.openSignIn(authRedirectOptions())}>Sign in</button>;
}
