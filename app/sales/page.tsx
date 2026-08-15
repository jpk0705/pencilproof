"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { Clerk } from "@clerk/clerk-js";
import { useEffect, useMemo, useState } from "react";
import { authRedirectOptions, createLoadedClerk } from "@/lib/clerk-client";
import { SiteNav } from "@/app/components/SiteChrome";

type Profile = {
  displayName: string;
  referralCode: string;
  subscriptionStatus: string;
  earnedCredits: number;
  availableCredits: number;
};

const isActive = (status: string) => status === "active" || status === "past_due";

export default function SalespersonPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const [clerk, setClerk] = useState<Clerk | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [giftUrl, setGiftUrl] = useState("");
  const [giftCode, setGiftCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const email = clerk?.user?.primaryEmailAddress?.emailAddress.trim().toLowerCase() ?? "";
  const referralLink = useMemo(
    () => profile ? `https://pencilproof.com/analyze?ref=${encodeURIComponent(profile.referralCode)}` : "",
    [profile],
  );

  const refresh = async () => {
    const response = await fetch("/api/salesperson/me", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { profile?: Profile | null };
    setProfile(data.profile ?? null);
    if (data.profile?.displayName) setDisplayName(data.profile.displayName);
  };

  useEffect(() => {
    if (!configured) return;
    const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!key) return;
    void createLoadedClerk(key).then(setClerk).catch(() => setMessage("Sign-in is temporarily unavailable."));
  }, [configured]);

  useEffect(() => {
    if (!clerk?.user || !clerk.session) return;
    void (async () => {
      const token = await clerk.session?.getToken();
      if (!token) return;
      await fetch("/api/account/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token }),
      });
      await refresh();
    })();
  }, [clerk, email]);

  useEffect(() => {
    if (!profile?.referralCode) return;
    void QRCode.toDataURL(referralLink, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 280,
      color: { dark: "#07152d", light: "#ffffff" },
    }).then(setQrDataUrl).catch(() => setQrDataUrl(""));
  }, [profile?.referralCode, referralLink]);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("gift")?.trim().toUpperCase() ?? "";
    if (code) setGiftCode(code);
  }, []);

  const ensureProfile = async () => {
    if (!clerk?.user || !email) return null;
    const name = displayName.trim() || clerk.user.fullName?.trim() || "PencilProof salesperson";
    if (name.length < 2) {
      setMessage("Enter the name you want customers to see on your referral link.");
      return null;
    }
    const response = await fetch("/api/salesperson/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, displayName: name }),
    });
    if (!response.ok) {
      setMessage("We could not create your salesperson profile yet.");
      return null;
    }
    const data = await response.json() as { profile?: Profile };
    if (!data.profile) return null;
    setProfile(data.profile);
    setDisplayName(data.profile.displayName);
    return data.profile;
  };

  const startSubscription = async () => {
    setBusy(true);
    setMessage("");
    try {
      const current = profile ?? await ensureProfile();
      if (!current) return;
      const response = await fetch("/api/salesperson/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName: current.displayName }),
      });
      const data = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error ?? "checkout");
      window.location.assign(data.url);
    } catch (error) {
      setMessage(error instanceof Error && error.message.includes("not configured")
        ? "The $20/month salesperson plan is not connected to Stripe yet."
        : "We could not open the secure salesperson checkout. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const redeemCredit = async () => {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/salesperson/credit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "redeem" }) });
    const data = await response.json().catch(() => ({})) as { status?: string };
    setMessage(data.status === "redeemed" ? "$20 was applied to your next PencilProof subscription invoice." : data.status === "billing_not_ready" ? "Your subscription billing profile is still being prepared." : "No available credit was found.");
    await refresh();
    setBusy(false);
  };

  const giftCredit = async () => {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/salesperson/credit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "gift" }) });
    const data = await response.json().catch(() => ({})) as { status?: string; code?: string };
    if (data.status === "created" && data.code) {
      const url = `https://audit.pencilproof.com/sales?gift=${encodeURIComponent(data.code)}`;
      setGiftUrl(url);
      setMessage("Gift link created. Send it to the person you choose.");
      await refresh();
    } else setMessage("No available credit is ready to gift.");
    setBusy(false);
  };

  const claimGift = async () => {
    if (!giftCode) return;
    setBusy(true);
    const response = await fetch("/api/salesperson/gift/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: giftCode }) });
    const data = await response.json().catch(() => ({})) as { status?: string };
    setMessage(data.status === "claimed" ? "$20 PencilProof credit added to your salesperson account." : data.status === "salesperson_profile_required" ? "Create your salesperson profile first, then claim this gift." : "This gift link is unavailable or has already been claimed.");
    await refresh();
    setBusy(false);
  };

  const managePlan = async () => {
    setBusy(true);
    const response = await fetch("/api/salesperson/portal", { method: "POST" });
    const data = await response.json().catch(() => ({})) as { url?: string };
    if (data.url) window.location.assign(data.url);
    else setMessage("Billing management is temporarily unavailable.");
    setBusy(false);
  };

  if (!configured) return <><SiteNav /><main className="sales-page shell"><h1>Salesperson tools are being prepared.</h1><p>PencilProof is finishing the secure account connection.</p></main></>;
  if (!clerk) return <><SiteNav /><main className="sales-page shell"><p>Loading your PencilProof account…</p></main></>;
  if (!clerk.user) return <><SiteNav /><main className="sales-page shell"><p className="kicker">FOR AUTOMOTIVE SALESPEOPLE</p><h1>Know the numbers before you make a promise.</h1><p>Use PencilProof to review a customer quote privately, then share a tracked link so a paid customer can earn you a $20 credit.</p><button className="button button-primary" type="button" onClick={() => clerk.openSignIn(authRedirectOptions())}>Sign in to start</button></main></>;

  return <>
    <SiteNav />
    <main className="sales-page shell">
      <header className="sales-hero"><p className="kicker">PENCILPROOF SALESPERSON TOOLS</p><h1>Share a clearer quote review.</h1><p>Customers get an educational review of the written numbers. You get attribution for the customers you introduce—without seeing their private quote or audit details.</p></header>
      {giftCode ? <section className="sales-card gift-card"><p className="kicker">PENCILPROOF GIFT</p><h2>You received a $20 salesperson credit.</h2><p>Claim it to your PencilProof salesperson account. A PencilProof account is required.</p><button className="button button-primary" type="button" onClick={() => void claimGift()} disabled={busy}>Claim this credit</button></section> : null}
      {!profile ? <section className="sales-card"><p className="kicker">GET STARTED</p><h2>Create your referral profile</h2><p>Choose the name customers should see when they open your tracked quote-review link.</p><label className="sales-label">Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" maxLength={80} /></label><button className="button button-primary" type="button" onClick={() => void startSubscription()} disabled={busy}>{busy ? "Preparing…" : "Start the $20/month plan"}</button></section> : null}
      {profile && !isActive(profile.subscriptionStatus) ? <section className="sales-card"><p className="kicker">SALESPERSON PLAN</p><h2>{profile.subscriptionStatus === "not_started" ? "Activate your referral tools" : "Resume your salesperson plan"}</h2><p>$20/month, cancellable through Stripe. Customers who pay for a Full Quote Audit can earn you one $20 credit, up to six total.</p><button className="button button-primary" type="button" onClick={() => void startSubscription()} disabled={busy}>{busy ? "Opening checkout…" : "Continue to secure checkout"}</button>{message ? <p className="sales-message" role="status">{message}</p> : null}</section> : null}
      {profile && isActive(profile.subscriptionStatus) ? <>
        <section className="sales-card sales-dashboard"><div><p className="kicker">YOUR TRACKED LINK</p><h2>{profile.displayName}</h2><p>Customers who use this link are attributed to you. They are told that a paid audit may generate subscription credit for the person who shared the link.</p><div className="sales-link-row"><input readOnly value={referralLink} aria-label="Your referral link" /><button className="button button-quiet" type="button" onClick={() => void navigator.clipboard.writeText(referralLink)}>Copy link</button></div></div>{qrDataUrl ? <img className="sales-qr" src={qrDataUrl} alt="QR code for your PencilProof referral link" width="280" height="280" /> : null}</section>
        <section className="sales-card sales-credit-card"><div><p className="kicker">REFERRAL CREDITS</p><h2>${profile.availableCredits * 20} available</h2><p>{profile.earnedCredits} credit{profile.earnedCredits === 1 ? "" : "s"} earned. There is no six-referral cap: every verified paid Full Quote Audit adds another $20 credit.</p></div><div className="sales-credit-actions"><button className="button button-primary" type="button" onClick={() => void redeemCredit()} disabled={busy || profile.availableCredits < 1}>Use for my renewal</button><button className="button button-quiet" type="button" onClick={() => void giftCredit()} disabled={busy || profile.availableCredits < 1}>Gift $20 to someone</button><button className="button button-quiet" type="button" onClick={() => void managePlan()} disabled={busy}>Manage subscription</button></div>{giftUrl ? <div className="gift-link"><strong>Gift link</strong><input readOnly value={giftUrl} aria-label="Gift link" /><button className="button button-quiet" type="button" onClick={() => void navigator.clipboard.writeText(giftUrl)}>Copy gift link</button></div> : null}</section>
      </> : null}
      {message && !profile?.subscriptionStatus ? <p className="sales-message" role="status">{message}</p> : null}
      <p className="sales-note">PencilProof is an educational quote-audit tool. It does not approve financing, negotiate with a dealership, or guarantee savings. Referral rewards never reveal a customer&apos;s quote or audit information.</p>
      <Link className="text-link" href="/account">Back to My Audits →</Link>
    </main>
  </>;
}
