"use client";

import Link from "next/link";
import { Clerk } from "@clerk/clerk-js";
import { useEffect, useState } from "react";
import { authRedirectOptions, clearServerAccountSession, createLoadedClerk, getAuthContext, setAuthContext as persistAuthContext, syncAccountContact, type PencilProofAccountSession, type PencilProofAuthContext } from "@/lib/clerk-client";

const ACCOUNT_URL = "https://pencilproof.com/account";
const SALES_URL = "https://pencilproof.com/sales";
const PAID_AUDIT_URL = "https://audit.pencilproof.com/analyze/secure/";
const PUBLIC_ANALYZE_URL = "https://pencilproof.com/analyze";

type AccountSessionState = PencilProofAccountSession;

const sessionState = (data: { role?: string; expiresAt?: unknown; email?: unknown }, fallbackRole: PencilProofAuthContext, fallbackEmail: string): AccountSessionState => ({
  ok: true,
  role: data.role === "salesperson" ? "salesperson" : fallbackRole,
  expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
  email: typeof data.email === "string" && data.email.trim() ? data.email.trim() : fallbackEmail,
  audits: [],
  marketingOptedIn: false,
  salespersonProfile: null,
});

const readAuditHostAccount = async (): Promise<AccountSessionState | null> => {
  const response = await fetch("/api/account/me", { cache: "no-store", credentials: "include" }).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json().catch(() => ({})) as { role?: string; expiresAt?: unknown; email?: unknown };
  if (typeof data.email !== "string" || !data.email.trim()) return null;
  return sessionState(data, "consumer", data.email.trim());
};

export default function AccountNav() {
  const [clerk, setClerk] = useState<Clerk | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [serverAccountReady, setServerAccountReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState("");
  const [authContext, setAuthContext] = useState<PencilProofAuthContext>("consumer");
  const [accountSession, setAccountSession] = useState<AccountSessionState | null>(null);

  useEffect(() => {
    const isAuditHost = window.location.hostname.toLowerCase() === "audit.pencilproof.com";
    const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    let cancelled = false;
    if (!isAuditHost || publishableKey) {
      setServerAccountReady(true);
    } else {
      void readAuditHostAccount().then((account) => {
        if (cancelled) return;
        setAccountSession(account);
        setServerAccountReady(true);
      });
    }

    if (!publishableKey) {
      setAuthReady(true);
      return () => { cancelled = true; };
    }

    let unsubscribe: (() => void) | undefined;
    let profileListener: (() => void) | undefined;
    let previousSignedIn: boolean | null = null;
    let previousUserId: string | null = null;
    let previousEmail = "";
    let previousContext: PencilProofAuthContext | null = null;
    void createLoadedClerk(publishableKey)
      .then((instance) => {
        if (cancelled) return;
        setClerk(instance);
        setAuthReady(true);
        const initialSignedIn = Boolean(instance.user);
        previousSignedIn = initialSignedIn;
        previousUserId = instance.user?.id ?? null;
        previousEmail = instance.user?.primaryEmailAddress?.emailAddress.trim() ?? "";
        setSignedIn(initialSignedIn);
        setSignedInEmail(previousEmail);
        const context = getAuthContext();
        previousContext = context;
        setAuthContext(context);
        if (instance.user) {
          void syncAccountContact(instance, context).then((resolvedSession) => {
            if (cancelled) return;
            persistAuthContext(resolvedSession.role);
            setAuthContext(resolvedSession.role);
            setAccountSession(resolvedSession);
          });
        }
        profileListener = () => {
          const nextContext = getAuthContext();
          setAuthContext(nextContext);
          if (instance.user) {
            void syncAccountContact(instance, nextContext, { force: true }).then((resolvedSession) => {
              if (cancelled) return;
              persistAuthContext(resolvedSession.role);
              setAuthContext(resolvedSession.role);
              setAccountSession(resolvedSession);
            });
          }
        };
        window.addEventListener("pencilproof:salesperson-profile-updated", profileListener);
        unsubscribe = instance.addListener(() => {
          if (!cancelled) {
            const nextSignedIn = Boolean(instance.user);
            const nextUserId = instance.user?.id ?? null;
            const nextEmail = instance.user?.primaryEmailAddress?.emailAddress.trim() ?? "";
            const nextContext = getAuthContext();
            const accountChanged = previousSignedIn !== nextSignedIn
              || previousUserId !== nextUserId
              || previousEmail !== nextEmail
              || previousContext !== nextContext;
            if (previousSignedIn === true && !nextSignedIn) {
              void clearServerAccountSession();
              setAccountSession(null);
            }
            previousSignedIn = nextSignedIn;
            previousUserId = nextUserId;
            previousEmail = nextEmail;
            previousContext = nextContext;
            setSignedIn(nextSignedIn);
            setSignedInEmail(nextEmail);
            setAuthContext(nextContext);
            // Clerk also calls this listener for routine token refreshes. Those
            // refreshes keep the browser signed in but do not represent an
            // account change and must not re-run the Durable Object bootstrap.
            if (instance.user && accountChanged) {
              void syncAccountContact(instance, nextContext).then((resolvedSession) => {
                if (cancelled) return;
                persistAuthContext(resolvedSession.role);
                setAuthContext(resolvedSession.role);
                setAccountSession(resolvedSession);
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

  if (!authReady || !serverAccountReady) {
    return <span className="nav-auth-loading" aria-hidden="true" />;
  }

  const effectiveSignedIn = signedIn || Boolean(accountSession?.email);
  const effectiveRole = accountSession?.role ?? authContext;
  const effectiveEmail = accountSession?.email || signedInEmail;
  const hasPaidAccess = typeof accountSession?.expiresAt === "number" && accountSession.expiresAt > Math.floor(Date.now() / 1000);
  const uploadHref = hasPaidAccess ? PAID_AUDIT_URL : PUBLIC_ANALYZE_URL;

  if (!clerk && !effectiveSignedIn) {
    return <><Link className="nav-sales-link" href={SALES_URL}>For salespeople</Link><Link className="nav-account-link" href={ACCOUNT_URL} aria-label="Sign in">Sign in</Link><Link className="nav-cta" href={PUBLIC_ANALYZE_URL}>Upload your quote</Link></>;
  }
  if (effectiveSignedIn) {
    return <><span className="nav-account-session"><Link className="nav-account-link" href={effectiveRole === "salesperson" ? SALES_URL : ACCOUNT_URL}>{effectiveRole === "salesperson" ? "Salesperson Dashboard" : "My Audits"}</Link><span className="nav-account-email" title={`Signed in as ${effectiveEmail}`}>{effectiveEmail || "Signed-in account"}</span></span><Link className="nav-cta" href={uploadHref}>Upload your quote</Link></>;
  }
  return <><Link className="nav-sales-link" href="/sales">For salespeople</Link><button className="nav-account-button" type="button" onClick={() => clerk?.openSignIn(authRedirectOptions("consumer"))}>Sign in</button><Link className="nav-cta" href={PUBLIC_ANALYZE_URL}>Upload your quote</Link></>;
}
