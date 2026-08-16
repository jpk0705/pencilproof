"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { Clerk } from "@clerk/clerk-js";
import { useEffect, useMemo, useState } from "react";
import { authRedirectOptions, createLoadedClerk, getAuthContext } from "@/lib/clerk-client";
import { SiteNav } from "@/app/components/SiteChrome";
import SalesCoach from "@/app/components/SalesCoach";

type Profile = {
  displayName: string;
  referralCode: string;
  subscriptionStatus: string;
  earnedCredits: number;
  availableCredits: number;
};

const isActive = (status: string) => status === "active" || status === "past_due";
const SALES_API_URL = "https://audit.pencilproof.com";

export default function SalespersonPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const [clerk, setClerk] = useState<Clerk | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [giftUrl, setGiftUrl] = useState("");
  const [giftCode, setGiftCode] = useState("");
  const [playbook, setPlaybook] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [nameError, setNameError] = useState("");
  const [busy, setBusy] = useState(false);

  const email = clerk?.user?.primaryEmailAddress?.emailAddress.trim().toLowerCase() ?? "";
  const referralLink = useMemo(
    () => profile ? `https://pencilproof.com/analyze?ref=${encodeURIComponent(profile.referralCode)}` : "",
    [profile],
  );

  const refresh = async () => {
    const response = await fetch(`${SALES_API_URL}/api/salesperson/me`, { cache: "no-store", credentials: "include" });
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
      await fetch(`${SALES_API_URL}/api/account/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, token, role: getAuthContext() === "salesperson" ? "salesperson" : "consumer" }),
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
    if (!profile || !isActive(profile.subscriptionStatus)) {
      setPlaybook(null);
      return;
    }
    let current = true;
    void fetch(`${SALES_API_URL}/api/salesperson/playbook`, { cache: "no-store", credentials: "include" })
      .then((response) => response.ok ? response.json() as Promise<{ playbook?: string }> : null)
      .then((data) => { if (current) setPlaybook(typeof data?.playbook === "string" ? data.playbook : null); })
      .catch(() => { if (current) setPlaybook(null); });
    return () => { current = false; };
  }, [profile?.subscriptionStatus]);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("gift")?.trim().toUpperCase() ?? "";
    if (code) setGiftCode(code);
  }, []);

  const ensureProfile = async () => {
    if (!clerk?.user || !email) return null;
    const name = displayName.trim();
    if (name.length < 2) {
      setNameError("Enter at least 2 characters customers can recognize.");
      setMessage("Choose a display name before continuing.");
      return null;
    }
    setNameError("");
    const response = await fetch(`${SALES_API_URL}/api/salesperson/me`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
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
    window.dispatchEvent(new Event("pencilproof:salesperson-profile-updated"));
    return data.profile;
  };

  const createFreeAccount = async () => {
    setBusy(true);
    setMessage("");
    const created = await ensureProfile();
    if (created) setMessage("Your free salesperson account is ready. Choose a plan below whenever you are ready.");
    setBusy(false);
  };

  const startSubscription = async () => {
    setBusy(true);
    setMessage("");
    try {
      const current = profile ?? await ensureProfile();
      if (!current) return;
      const response = await fetch(`${SALES_API_URL}/api/salesperson/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
    const response = await fetch(`${SALES_API_URL}/api/salesperson/credit`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ action: "redeem" }) });
    const data = await response.json().catch(() => ({})) as { status?: string };
    setMessage(data.status === "redeemed" ? "$20 was applied to your next PencilProof subscription invoice." : data.status === "billing_not_ready" ? "Your subscription billing profile is still being prepared." : "No available credit was found.");
    await refresh();
    setBusy(false);
  };

  const giftCredit = async () => {
    setBusy(true);
    setMessage("");
    const response = await fetch(`${SALES_API_URL}/api/salesperson/credit`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ action: "gift" }) });
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
    const response = await fetch(`${SALES_API_URL}/api/salesperson/gift/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ code: giftCode }) });
    const data = await response.json().catch(() => ({})) as { status?: string };
    setMessage(data.status === "claimed" ? "$20 PencilProof credit added to your salesperson account." : data.status === "salesperson_profile_required" ? "Create your salesperson profile first, then claim this gift." : "This gift link is unavailable or has already been claimed.");
    await refresh();
    setBusy(false);
  };

  const managePlan = async () => {
    setBusy(true);
    const response = await fetch(`${SALES_API_URL}/api/salesperson/portal`, { method: "POST", credentials: "include" });
    const data = await response.json().catch(() => ({})) as { url?: string };
    if (data.url) window.location.assign(data.url);
    else setMessage("Billing management is temporarily unavailable.");
    setBusy(false);
  };

  const signOut = async () => {
    await clerk?.signOut();
    window.location.assign("/");
  };

  if (!configured) return <><SiteNav /><main className="sales-page shell"><h1>Salesperson tools are being prepared.</h1><p>PencilProof is finishing the secure account connection.</p></main></>;
  if (!clerk) return <><SiteNav /><main className="sales-page shell"><p>Loading your PencilProof account…</p></main></>;
  if (!clerk.user) return <>
    <SiteNav />
    <main className="sales-page shell">
      <header className="sales-hero sales-hero-public"><div className="sales-hero-copy"><p className="kicker">FOR AUTOMOTIVE SALESPEOPLE</p><h1>Know the numbers before you make a promise.</h1><p>Use PencilProof to review a customer quote privately, explain the written numbers with confidence, and share a tracked link so a paid customer can earn you a $20 credit.</p><button className="button button-primary" type="button" onClick={() => clerk.openSignIn(authRedirectOptions("salesperson"))}>Sign in to start</button></div></header>
      <p className="sales-promo-banner"><strong>Try the salesperson plan.</strong> Start with the $1 first-month ALPHA1 offer. Limited to the first 100 salesperson redemptions.</p>
      <section className="sales-problem-solution" aria-labelledby="sales-public-problem-title">
        <div className="sales-story-intro"><p className="kicker">THE SALES CONVERSATION</p><h2 id="sales-public-problem-title">Turn a complicated worksheet into a clearer next conversation.</h2><p>When a customer asks what is inside the payment, a quick, private review helps you answer with the written figures in front of you.</p></div>
        <div className="sales-story-grid">
          <div className="sales-story-column sales-story-problems"><p className="sales-story-label">WITHOUT A CLEAR REVIEW</p><article><strong>Payment details are scattered</strong><span>Price, fees, products, trade equity, APR, and term may be spread across a dense worksheet.</span></article><article><strong>Don&apos;t know why the payment is different?</strong><span>It can take several trips back to the desk to retrace the math and explain what changed.</span></article><article><strong>Conversations slow down</strong><span>The customer may lose confidence while you search for the answer.</span></article><article><strong>Revised quotes restart the work</strong><span>New figures can make it hard to see what changed from the earlier worksheet.</span></article></div>
          <div className="sales-story-column sales-story-solution"><p className="sales-story-label">WITH PENCILPROOF</p><article><strong>Scan and verify the figures</strong><span>Import the written quote, correct anything that needs attention, and confirm the numbers before using them.</span></article><article><strong>Explain the deal in one view</strong><span>See payment, APR, term, fees, optional products, trade figures, and questions to verify.</span></article><article><strong>Keep the next step obvious</strong><span>Share a tracked review link or QR code while the customer is still engaged.</span></article><article><strong>Keep revisions organized</strong><span>Return to the review with updated figures and focus on what changed.</span></article></div>
        </div>
      </section>
      <section className="sales-card sales-public-benefits"><p className="kicker">WHAT YOU GET</p><h2>Useful before you go back to the desk.</h2><div className="check-list"><article><b>Private quote review</b><p>Customers review their own quote without exposing the document to you.</p></article><article><b>Tracked referrals</b><p>Share your link or QR code and receive credit when an attributed customer completes a paid audit.</p></article><article><b>Practice support</b><p>Use the free top-five coach preview, then subscribe for the complete objection playbook.</p></article></div><button className="button button-primary" type="button" onClick={() => clerk.openSignIn(authRedirectOptions("salesperson"))}>Create your salesperson account</button></section>
    </main>
  </>;

  return <>
    <SiteNav />
    <main className="sales-page shell">
      <header className="sales-hero"><div className="sales-hero-copy"><p className="kicker">PENCILPROOF SALESPERSON TOOLS</p><h1>Share a clearer quote review.</h1><p>Customers get an educational review of the written numbers. You get attribution for the customers you introduce—without seeing their private quote or audit details.</p></div><button className="sales-signout" type="button" onClick={() => void signOut()}>Sign out</button></header>
      <p className="sales-promo-banner"><strong>Try ALPHA1 at checkout.</strong> Get your first month for $1. Limited to the first 100 salesperson redemptions.</p>
      <section className="sales-problem-solution" aria-labelledby="sales-problem-title">
        <div className="sales-story-intro"><p className="kicker">THE SALES CONVERSATION</p><h2 id="sales-problem-title">Turn a complicated worksheet into a clearer next conversation.</h2><p>When the numbers are difficult to explain, the customer may lose confidence before you can answer the real question: “What is included in this payment?”</p></div>
        <div className="sales-story-grid">
          <div className="sales-story-column sales-story-problems"><p className="sales-story-label">WITHOUT A CLEAR REVIEW</p><article><strong>Payment details are scattered</strong><span>Price, fees, products, trade equity, APR, and term may be spread across a dense worksheet.</span></article><article><strong>Don&apos;t know why the payment is different?</strong><span>PencilProof helps you trace payment variance back to the written figures so you know what to verify before answering.</span></article><article><strong>Conversations slow down</strong><span>You may need to pause and retrace the math before you can explain what changed or what is optional.</span></article><article><strong>Revised quotes restart the work</strong><span>When figures change, it can be hard to compare the new worksheet with the earlier version.</span></article></div>
          <div className="sales-story-column sales-story-solution"><p className="sales-story-label">WITH PENCILPROOF</p><article><strong>Scan and verify the figures</strong><span>Import the written quote, correct anything that needs attention, and confirm the numbers before using them.</span></article><article><strong>Explain the deal in one view</strong><span>See payment, APR, term, fees, optional products, trade figures, and clear questions to verify with the customer.</span></article><article><strong>Keep the next step obvious</strong><span>Share a tracked review link or QR code while the customer is still engaged, without sharing their private quote with you.</span></article><article><strong>Keep revisions organized</strong><span>Return to the review with updated figures, focus on what changed, and make the next conversation more focused.</span></article></div>
        </div>
      </section>
      {giftCode ? <section className="sales-card gift-card"><p className="kicker">PENCILPROOF GIFT</p><h2>You received a $20 salesperson credit.</h2><p>Claim it to your PencilProof salesperson account. A PencilProof account is required.</p><button className="button button-primary" type="button" onClick={() => void claimGift()} disabled={busy}>Claim this credit</button></section> : null}
      {!profile ? <section className="sales-card"><p className="kicker">GET STARTED</p><h2>Create your referral profile</h2><p>Choose a customer-facing name for your tracked link. It can be your first name, a nickname, or a professional name—it does not need to be your legal name.</p><label className="sales-label" htmlFor="sales-display-name">Display name <span aria-hidden="true">*</span><input id="sales-display-name" value={displayName} onChange={(event) => { setDisplayName(event.target.value); if (nameError) setNameError(""); }} placeholder="Hannah or Hannah at PencilProof" maxLength={80} minLength={2} required aria-required="true" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "sales-display-name-error" : "sales-display-name-help"} /></label><small id="sales-display-name-help" className="sales-field-help">This is the name customers will see—not your legal name.</small>{nameError ? <p id="sales-display-name-error" className="sales-field-error" role="alert">{nameError}</p> : null}<button className="button button-primary" type="button" onClick={() => void createFreeAccount()} disabled={busy || displayName.trim().length < 2}>{busy ? "Creating account…" : "Create free account"}</button></section> : null}
      {profile && !isActive(profile.subscriptionStatus) ? <section id="salesperson-plan" className="sales-card sales-dashboard-onboarding"><p className="kicker">SALESPERSON DASHBOARD</p><h2>{profile.subscriptionStatus === "not_started" ? `Welcome, ${profile.displayName}` : "Resume your salesperson plan"}</h2><p>Your free salesperson account is ready. Activate the $20/month plan to unlock your tracked link, QR code, referral credits, and sales tools.</p><div className="sales-plan-offer"><strong>Try ALPHA1</strong><span>First month for $1 · first 100 redemptions</span></div><button className="button button-primary" type="button" onClick={() => void startSubscription()} disabled={busy}>{busy ? "Opening checkout…" : "Start $20/month plan"}</button>{message ? <p className="sales-message" role="status">{message}</p> : null}</section> : null}
      {profile && isActive(profile.subscriptionStatus) ? <>
        <section className="sales-card sales-dashboard"><div><p className="kicker">YOUR TRACKED LINK</p><h2>{profile.displayName}</h2><p>Customers who use this link are attributed to you. They are told that a paid audit may generate subscription credit for the person who shared the link.</p><div className="sales-link-row"><input readOnly value={referralLink} aria-label="Your referral link" /><button className="button button-quiet" type="button" onClick={() => void navigator.clipboard.writeText(referralLink)}>Copy link</button></div></div>{qrDataUrl ? <img className="sales-qr" src={qrDataUrl} alt="QR code for your PencilProof referral link" width="280" height="280" /> : null}</section>
        <section className="sales-card sales-credit-card"><div><p className="kicker">REFERRAL CREDITS</p><h2>${profile.availableCredits * 20} available</h2><p>{profile.earnedCredits} credit{profile.earnedCredits === 1 ? "" : "s"} earned. There is no six-referral cap: every verified paid Full Quote Audit adds another $20 credit.</p></div><div className="sales-credit-actions"><button className="button button-primary" type="button" onClick={() => void redeemCredit()} disabled={busy || profile.availableCredits < 1}>Use for my renewal</button><button className="button button-quiet" type="button" onClick={() => void giftCredit()} disabled={busy || profile.availableCredits < 1}>Gift $20 to someone</button><button className="button button-quiet" type="button" onClick={() => void managePlan()} disabled={busy}>Manage subscription</button></div>{giftUrl ? <div className="gift-link"><strong>Gift link</strong><input readOnly value={giftUrl} aria-label="Gift link" /><button className="button button-quiet" type="button" onClick={() => void navigator.clipboard.writeText(giftUrl)}>Copy gift link</button></div> : null}</section>
      </> : null}
      {message && !profile?.subscriptionStatus ? <p className="sales-message" role="status">{message}</p> : null}
      {profile ? <SalesCoach unlocked={isActive(profile.subscriptionStatus)} playbook={playbook} onSubscribe={() => void startSubscription()} /> : null}
      <p className="sales-note">PencilProof is an educational quote-audit tool. It does not approve financing, negotiate with a dealership, or guarantee savings. Referral rewards never reveal a customer&apos;s quote or audit information.</p>
    </main>
  </>;
}
