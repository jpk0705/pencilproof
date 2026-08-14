"use client";

import Link from "next/link";
import { Clerk } from "@clerk/clerk-js";
import { useEffect, useState } from "react";
import { authRedirectOptions, createLoadedClerk } from "@/lib/clerk-client";

const ACCOUNT_URL = "https://audit.pencilproof.com/account";
const ACCOUNT_API_URL = "https://audit.pencilproof.com";

const syncAccountContact = async (instance: Clerk) => {
  const token = await instance.session?.getToken();
  const email = instance.user?.primaryEmailAddress?.emailAddress.trim().toLowerCase() ?? "";
  if (!token) return;
  await fetch(`${ACCOUNT_API_URL}/api/account/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, token }),
  }).catch(() => undefined);
};

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
        void syncAccountContact(instance);
        unsubscribe = instance.addListener(() => {
          if (!cancelled) {
            setSignedIn(Boolean(instance.user));
            void syncAccountContact(instance);
          }
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  if (!clerk) {
    return <Link className="nav-account-link" href={ACCOUNT_URL} aria-label="Sign in">Sign in</Link>;
  }
  return signedIn
    ? <Link className="nav-account-link" href={ACCOUNT_URL}>My Audits</Link>
    : <button className="nav-account-button" type="button" onClick={() => clerk.openSignIn(authRedirectOptions())}>Sign in</button>;
}
