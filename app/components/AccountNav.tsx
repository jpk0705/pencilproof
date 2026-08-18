"use client";

import Link from "next/link";
import { Clerk } from "@clerk/clerk-js";
import { useEffect, useState } from "react";
import { authRedirectOptions, clearServerAccountSession, createLoadedClerk, getAuthContext, setAuthContext as persistAuthContext, type PencilProofAuthContext } from "@/lib/clerk-client";

const ACCOUNT_URL = "https://pencilproof.com/account";
const ACCOUNT_API_URL = "https://audit.pencilproof.com";
const SALES_URL = "https://pencilproof.com/sales";
const PAID_AUDIT_URL = "https://audit.pencilproof.com/analyze/secure/";
const PUBLIC_ANALYZE_URL = "https://pencilproof.com/analyze";

const syncAccountContact = async (instance: Clerk, authContext: PencilProofAuthContext): Promise<PencilProofAuthContext> => {
  const token = await instance.session?.getToken();
  const email = instance.user?.primaryEmailAddress?.emailAddress.trim().toLowerCase() ?? "";
  if (!token) return authContext;
  const response = await fetch(`${ACCOUNT_API_URL}/api/account/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, token, role: authContext }),
  }).catch(() => null);
  if (!response?.ok) return authContext;
  const data = await response.json().catch(() => ({})) as { role?: string };
  return data.role === "salesperson" ? "salesperson" : "consumer";
};

export default function AccountNav() {
  const [clerk, setClerk] = useState<Clerk | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState("");
  const [authContext, setAuthContext] = useState<PencilProofAuthContext>("consumer");

  useEffect(() => {
    const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!publishableKey) {
      setAuthReady(true);
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let profileListener: (() => void) | undefined;
    let previousSignedIn: boolean | null = null;
    void createLoadedClerk(publishableKey)
      .then((instance) => {
        if (cancelled) return;
        setClerk(instance);
        setAuthReady(true);
        const initialSignedIn = Boolean(instance.user);
        previousSignedIn = initialSignedIn;
        setSignedIn(initialSignedIn);
        setSignedInEmail(instance.user?.primaryEmailAddress?.emailAddress.trim() ?? "");
        const context = getAuthContext();
        setAuthContext(context);
        void syncAccountContact(instance, context).then((resolvedContext) => {
          if (cancelled) return;
          persistAuthContext(resolvedContext);
          setAuthContext(resolvedContext);
        });
        profileListener = () => { setAuthContext(getAuthContext()); };
        window.addEventListener("pencilproof:salesperson-profile-updated", profileListener);
        unsubscribe = instance.addListener(() => {
          if (!cancelled) {
            const nextSignedIn = Boolean(instance.user);
            if (previousSignedIn === true && !nextSignedIn) void clearServerAccountSession();
            previousSignedIn = nextSignedIn;
            setSignedIn(nextSignedIn);
            setSignedInEmail(instance.user?.primaryEmailAddress?.emailAddress.trim() ?? "");
            const nextContext = getAuthContext();
            setAuthContext(nextContext);
            if (instance.user) {
              void syncAccountContact(instance, nextContext).then((resolvedContext) => {
                if (cancelled) return;
                persistAuthContext(resolvedContext);
                setAuthContext(resolvedContext);
              });
            }
          }
        });
      })
      .catch(() => {
        if (!cancelled) setAuthReady(true);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
      if (profileListener) window.removeEventListener("pencilproof:salesperson-profile-updated", profileListener);
    };
  }, []);

  if (!authReady) {
    return <span className="nav-auth-loading" aria-hidden="true" />;
  }
  if (!clerk) {
    return <><Link className="nav-sales-link" href={SALES_URL}>For salespeople</Link><Link className="nav-account-link" href={ACCOUNT_URL} aria-label="Sign in">Sign in</Link><Link className="nav-cta" href={PUBLIC_ANALYZE_URL}>Upload your quote</Link></>;
  }
  return signedIn
    ? <><span className="nav-account-session"><Link className="nav-account-link" href={authContext === "salesperson" ? SALES_URL : ACCOUNT_URL}>{authContext === "salesperson" ? "Salesperson Dashboard" : "My Audits"}</Link><span className="nav-account-email" title={`Signed in as ${signedInEmail}`}>{signedInEmail || "Signed-in account"}</span></span><Link className="nav-cta" href={PAID_AUDIT_URL}>Upload your quote</Link></>
    : <><Link className="nav-sales-link" href="/sales">For salespeople</Link><button className="nav-account-button" type="button" onClick={() => clerk.openSignIn(authRedirectOptions("consumer"))}>Sign in</button><Link className="nav-cta" href={PUBLIC_ANALYZE_URL}>Upload your quote</Link></>;
}
