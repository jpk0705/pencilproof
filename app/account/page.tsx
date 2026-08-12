"use client";

import Link from "next/link";
import { Clerk } from "@clerk/clerk-js";
import { useEffect, useState } from "react";
import { createLoadedClerk } from "@/lib/clerk-client";

type Audit = { id: string; createdAt: number; expiresAt: number; data: Record<string, unknown> };

export default function AccountPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const [clerk, setClerk] = useState<Clerk | null>(null);
  const [clerkError, setClerkError] = useState(false);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [marketingOptedIn, setMarketingOptedIn] = useState(false);
  const [marketingMessage, setMarketingMessage] = useState("");
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!configured) return;
    const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!publishableKey) return;

    let cancelled = false;
    void createLoadedClerk(publishableKey)
      .then((instance) => {
        if (!cancelled) setClerk(instance);
      })
      .catch(() => {
        if (!cancelled) setClerkError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [configured]);

  useEffect(() => {
    if (!clerk) return;
    const syncAuth = () => setAuthReady(Boolean(clerk.user && clerk.session));
    syncAuth();
    const interval = window.setInterval(syncAuth, 250);
    return () => window.clearInterval(interval);
  }, [clerk]);

  useEffect(() => {
    if (!clerk || !authReady) return;
    void (async () => {
      const token = await clerk.session?.getToken();
      if (token) {
        await fetch("/api/account/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
      }
      const response = await fetch("/api/account/me", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { audits?: Audit[]; expiresAt?: number | null; marketingOptedIn?: boolean };
      setAudits(data.audits ?? []);
      setExpiresAt(data.expiresAt ?? null);
      setMarketingOptedIn(data.marketingOptedIn === true);
    })();
  }, [clerk, authReady]);

  if (!configured) {
    return <main className="account-page shell"><h1>Accounts are being prepared.</h1><p>PencilProof remains fully usable as a guest.</p><Link className="button button-primary" href="/analyze">Audit another quote</Link></main>;
  }

  if (clerkError) {
    return <main className="account-page shell"><h1>Account sign-in is temporarily unavailable.</h1><p>PencilProof remains fully usable as a guest. Please try again later if you want to save your access and audits.</p><Link className="button button-primary" href="/analyze">Continue as a guest</Link></main>;
  }

  if (!clerk) {
    return <main className="account-page shell"><p>Loading your PencilProof account…</p></main>;
  }

  if (!clerk.user) {
    return <main className="account-page shell"><h1>Save your PencilProof access.</h1><p>Create a free account to use your Pass on other devices and keep eligible audits for 30 days.</p><div className="account-actions"><button className="button button-primary" type="button" onClick={() => clerk.openSignIn({})}>Sign in</button></div><p className="account-guest-note">New customers can create an account inside the same sign-in window. No account is required to continue using PencilProof as a guest.</p></main>;
  }

  const accountLabel = clerk.user.primaryEmailAddress?.emailAddress ?? clerk.user.fullName ?? "your PencilProof account";
  const days = expiresAt ? Math.max(0, Math.ceil((expiresAt * 1000 - Date.now()) / 86400000)) : 0;
  const updateMarketingPreference = async () => {
    setMarketingMessage("");
    const optIn = !marketingOptedIn;
    const emailAddress = clerk.user?.primaryEmailAddress;
    const email = emailAddress?.emailAddress.trim().toLowerCase() ?? "";
    if (optIn && (emailAddress?.verification?.status !== "verified" || !email)) {
      setMarketingMessage("Verify your account email before joining the PencilProof email list.");
      return;
    }
    const response = await fetch("/api/account/marketing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(optIn ? { email, optIn: true } : { optIn: false }),
    });
    if (!response.ok) {
      setMarketingMessage("We could not update your email preference. Please try again.");
      return;
    }
    setMarketingOptedIn(optIn);
  };

  const deleteAudit = async (id: string) => {
    await fetch("/api/account/audits", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setAudits((current) => current.filter((audit) => audit.id !== id));
  };
  const deleteAccount = async () => {
    if (!window.confirm("Delete your PencilProof account and saved audit data?")) return;
    await fetch("/api/account/delete", { method: "POST" });
    await clerk.signOut();
    setMessage("Your account and saved PencilProof data were deleted.");
  };

  return <main className="account-page shell"><header className="account-header"><div><p className="kicker">YOUR PENCILPROOF</p><h1>My Account</h1><p className="account-signed-in">Signed in as {accountLabel}</p></div><button className="nav-account-button" type="button" onClick={() => clerk.signOut()}>Sign out</button></header><section className="pass-card"><p className="kicker">PENCILPROOF 30-DAY PASS</p><h2>{days ? `${days} days remaining` : "Your 30-Day Pass has ended."}</h2><p>{days ? "Unlimited personal-use audits remain available during your pass." : "Your saved audits remain available until their individual expiration dates."}</p><Link className="button button-primary" href="/analyze">Audit another quote</Link></section><section className="marketing-preferences"><h2>Email preferences</h2><p>Receive optional PencilProof reminders, promotions, and useful car-buying information. You can change this preference anytime.</p><button className="button button-quiet" type="button" onClick={() => void updateMarketingPreference()}>{marketingOptedIn ? "Stop marketing emails" : "Join the PencilProof email list"}</button>{marketingMessage ? <p role="status">{marketingMessage}</p> : null}</section><section><h2>My Audits</h2><h3>Saved audits</h3>{audits.length ? audits.map((audit) => <article className="saved-audit" key={audit.id}><div><strong>{String(audit.data.vehicle ?? "PencilProof audit")}</strong><p>Audited {new Date(audit.createdAt * 1000).toLocaleDateString()} · available until {new Date(audit.expiresAt * 1000).toLocaleDateString()}</p></div><button type="button" onClick={() => deleteAudit(audit.id)}>Delete audit</button></article>) : <p>No saved audits yet. Your next completed audit will appear here.</p>}</section><button className="account-delete" type="button" onClick={deleteAccount}>Delete my account and data</button>{message ? <p role="status">{message}</p> : null}</main>;
}
