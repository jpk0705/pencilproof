"use client";

import { useEffect, useState } from "react";
import type { Clerk } from "@clerk/clerk-js";
import { CHECKOUT_URL } from "@/lib/checkout";
import { authRedirectOptions, createLoadedClerk } from "@/lib/clerk-client";

type Props = {
  onContinue: () => void;
  onPaidAccess?: () => void;
};

type AccountAccessState = "checking" | "paid" | "not_paid" | "unavailable";

const accountEndpoint = (path: string) => new URL(path, CHECKOUT_URL).toString();

export default function PreCheckoutAccountGate({ onContinue, onPaidAccess }: Props) {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const [clerk, setClerk] = useState<Clerk | null>(null);
  const [clerkError, setClerkError] = useState(false);
  const [accountReady, setAccountReady] = useState(false);
  const [accountAccessState, setAccountAccessState] = useState<AccountAccessState>("not_paid");
  const [accessCheckVersion, setAccessCheckVersion] = useState(0);
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
          setAccountAccessState(instance.user && instance.session ? "checking" : "not_paid");
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
    const checkSession = () => {
      const ready = Boolean(clerk.user && clerk.session);
      setAccountReady(ready);
      setAccountAccessState((current) => {
        if (!ready) return "not_paid";
        return current === "paid" ? current : "checking";
      });
    };
    checkSession();
    const interval = window.setInterval(checkSession, 500);
    return () => window.clearInterval(interval);
  }, [clerk]);

  useEffect(() => {
    if (!clerk?.user || !clerk.session) {
      setAccountAccessState("not_paid");
      return;
    }
    let cancelled = false;
    setAccountAccessState("checking");
    void (async () => {
      const token = await clerk.session?.getToken().catch(() => null);
      if (!token) {
        if (!cancelled) setAccountAccessState("unavailable");
        return;
      }
      const response = await fetch(accountEndpoint("/api/account/me"), {
        cache: "no-store",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null);
      if (cancelled) return;
      if (!response?.ok) {
        setAccountAccessState("unavailable");
        return;
      }
      const data = await response.json().catch(() => ({})) as { expiresAt?: unknown };
      if (typeof data.expiresAt === "number" && data.expiresAt > Math.floor(Date.now() / 1000)) {
        setAccountAccessState("paid");
        onPaidAccess?.();
      } else {
        setAccountAccessState("not_paid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessCheckVersion, clerk, clerk?.session?.id, clerk?.user?.id, onPaidAccess]);

  const continueAsAccount = async () => {
    if (!clerk?.user || !clerk.session) {
      setMessage("Finish creating or signing in to your account, then continue.");
      return;
    }
    if (accountAccessState !== "not_paid") {
      setMessage("PencilProof is still checking this account. Please try again in a moment.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const token = await clerk.session.getToken();
      if (!token) throw new Error("account_session");
      const email = clerk.user.primaryEmailAddress?.emailAddress.trim().toLowerCase() ?? "";
      const sessionResponse = await fetch(accountEndpoint("/api/account/session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, token, role: "consumer" }),
      });
      if (!sessionResponse.ok) throw new Error("account_session");

      await fetch(accountEndpoint("/api/account/marketing/activity"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ event: "scan_ready" }),
      }).catch(() => undefined);

      onContinue();
    } catch {
      setMessage("We could not finish account setup. You can continue securely as a guest.");
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
        {accountAccessState === "paid" ? (
          <button className="button button-primary" type="button" onClick={() => onPaidAccess?.()} disabled={busy || !onPaidAccess}>
            Open your paid audit
          </button>
        ) : accountReady && accountAccessState === "checking" ? (
          <button className="button button-primary" type="button" disabled>
            Checking your PencilProof access…
          </button>
        ) : accountReady && accountAccessState === "unavailable" ? (
          <>
            <button className="button button-primary" type="button" onClick={() => setAccessCheckVersion((current) => current + 1)} disabled={busy}>
              Retry access check
            </button>
            <p className="pre-checkout-message" role="status">We could not verify your account access yet. Your quote is safe; retry before opening checkout.</p>
          </>
        ) : accountReady ? (
          <button className="button button-primary" type="button" onClick={() => void continueAsAccount()} disabled={busy}>
            {busy ? "Preparing checkout…" : "Continue to secure checkout"}
          </button>
        ) : (
          <button className="button button-primary" type="button" onClick={() => clerk?.openSignUp(authRedirectOptions("consumer"))} disabled={busy || !configured || clerkError}>
            Create free account
          </button>
        )}
        {!accountReady ? (
          <button className="button button-quiet" type="button" onClick={continueAsGuest} disabled={busy}>
            Continue as guest
          </button>
        ) : null}
        {!accountReady && clerk ? (
          <button className="pre-checkout-signin" type="button" onClick={() => clerk.openSignIn(authRedirectOptions("consumer"))} disabled={busy}>
            Already have an account? Sign in
          </button>
        ) : null}
        {clerkError || !configured ? (
          <p className="pre-checkout-message">Account setup is temporarily unavailable. You can continue securely as a guest.</p>
        ) : null}
        {message ? <p className="pre-checkout-message" role="status">{message}</p> : null}
      </div>
    </section>
  );
}
