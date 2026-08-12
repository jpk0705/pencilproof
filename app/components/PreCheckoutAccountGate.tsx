"use client";

import { useEffect, useState } from "react";
import type { Clerk } from "@clerk/clerk-js";
import { CHECKOUT_URL } from "@/lib/checkout";
import { createLoadedClerk } from "@/lib/clerk-client";

type Props = {
  onContinue: () => void;
};

const accountEndpoint = (path: string) => new URL(path, CHECKOUT_URL).toString();

export default function PreCheckoutAccountGate({ onContinue }: Props) {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const [clerk, setClerk] = useState<Clerk | null>(null);
  const [clerkError, setClerkError] = useState(false);
  const [accountReady, setAccountReady] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!configured) return;
    const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!publishableKey) return;

    let cancelled = false;
    void createLoadedClerk(publishableKey)
      .then((instance) => {
        if (!cancelled) {
          setClerk(instance);
          setAccountReady(Boolean(instance.user && instance.session));
        }
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
    const checkSession = () => setAccountReady(Boolean(clerk.user && clerk.session));
    checkSession();
    const interval = window.setInterval(checkSession, 500);
    return () => window.clearInterval(interval);
  }, [clerk]);

  const continueAsAccount = async () => {
    if (!clerk?.user || !clerk.session) {
      setMessage("Finish creating or signing in to your account, then continue.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const token = await clerk.session.getToken();
      if (!token) throw new Error("account_session");
      const sessionResponse = await fetch(accountEndpoint("/api/account/session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });
      if (!sessionResponse.ok) throw new Error("account_session");

      if (marketingOptIn) {
        const emailAddress = clerk.user.primaryEmailAddress;
        const email = emailAddress?.emailAddress.trim().toLowerCase() ?? "";
        const verified = emailAddress?.verification?.status === "verified";
        if (!verified || !email) throw new Error("email_verification");
        const marketingResponse = await fetch(accountEndpoint("/api/account/marketing"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, optIn: true }),
        });
        if (!marketingResponse.ok) throw new Error("marketing");
      }

      onContinue();
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === "email_verification"
          ? "Verify your email before joining the PencilProof email list."
          : "We could not finish account setup. You can continue securely as a guest.",
      );
      setBusy(false);
    }
  };

  const continueAsGuest = () => {
    if (busy) return;
    onContinue();
  };

  return (
    <section className="pre-checkout-account-gate shell" aria-labelledby="pre-checkout-account-title">
      <div className="pre-checkout-account-copy">
        <p className="kicker">BEFORE SECURE CHECKOUT</p>
        <h2 id="pre-checkout-account-title">Save your PencilProof access?</h2>
        <p>Create a free account to use your 30-Day Pass on other devices, retrieve saved audits, and keep your audit history for 30 days.</p>
        <p className="pre-checkout-privacy">Your quote scan stays in this browser. An account is optional and does not change the price or require a subscription.</p>
      </div>
      <div className="pre-checkout-account-actions">
        {accountReady ? (
          <button className="button button-primary" type="button" onClick={() => void continueAsAccount()} disabled={busy}>
            {busy ? "Preparing checkout…" : "Continue to secure checkout"}
          </button>
        ) : (
          <button className="button button-primary" type="button" onClick={() => clerk?.openSignIn({})} disabled={busy || !configured || clerkError}>
            Sign in
          </button>
        )}
        <button className="button button-quiet" type="button" onClick={continueAsGuest} disabled={busy}>
          Continue as guest
        </button>
        <label className="pre-checkout-consent">
          <input type="checkbox" checked={marketingOptIn} onChange={(event) => setMarketingOptIn(event.target.checked)} disabled={busy} />
          <span>Optional: email me PencilProof reminders, promotions, and useful car-buying information. Change this preference later from My Audits.</span>
        </label>
        {clerkError || !configured ? (
          <p className="pre-checkout-message">Account setup is temporarily unavailable. You can continue securely as a guest.</p>
        ) : null}
        {message ? <p className="pre-checkout-message" role="status">{message}</p> : null}
      </div>
    </section>
  );
}
