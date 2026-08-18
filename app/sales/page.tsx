"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { Clerk } from "@clerk/clerk-js";
import { useEffect, useMemo, useState } from "react";
import { authRedirectOptions, clearServerAccountSession, createLoadedClerk, getAuthContext, setAuthContext as persistAuthContext } from "@/lib/clerk-client";
import { flushAnalyticsQueue, track } from "@/lib/analytics";
import { SiteNav } from "@/app/components/SiteChrome";
import SalesCoach from "@/app/components/SalesCoach";
import AuditComparison, { type AuditComparisonRecord } from "@/app/components/AuditComparison";
import { auditAmountFinanced, auditHistoryLabel, auditMoney, auditPayment, auditRate, groupAuditsByHistoryKey, uniqueRealAudits } from "@/lib/audit-history";

type Profile = {
  displayName: string;
  referralCode: string;
  subscriptionStatus: string;
  earnedCredits: number;
  availableCredits: number;
  lastCreditStatus: string | null;
  lastCreditAmountCents: number | null;
  lastCreditCreatedAt: number | null;
  lastCreditRedeemedAt: number | null;
};

type SavedAudit = AuditComparisonRecord;

const isActive = (status: string) => status === "active";
const SALES_API_URL = "https://audit.pencilproof.com";
const PUBLIC_SALES_URL = "https://pencilproof.com/sales";
const PAID_AUDIT_URL = "https://audit.pencilproof.com/analyze/secure/";
const SAVED_AUDITS_PER_PAGE = 5;

const creditStatusText = (profile: Profile) => {
  if (profile.availableCredits > 0) {
    return `$${profile.availableCredits * 20} is available to use for renewal or gift.`;
  }
  const amount = Math.max(1, Math.round((profile.lastCreditAmountCents ?? 2000) / 100));
  if (profile.lastCreditStatus === "pending_redeem") {
    return `Last $${amount} credit: still being processed for your next PencilProof subscription invoice.`;
  }
  if (profile.lastCreditStatus === "redeemed") {
    return `Last $${amount} credit: scheduled on your next PencilProof subscription invoice.`;
  }
  if (profile.lastCreditStatus === "gifted") {
    return `Last $${amount} credit: reserved in a gift link.`;
  }
  if (profile.earnedCredits > 0) {
    return "Your earned referral credits are not currently available to use or gift.";
  }
  return "No referral credit has been earned yet.";
};

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
  const [roleBlocked, setRoleBlocked] = useState(false);
  const [showCoachPreview, setShowCoachPreview] = useState(false);
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteDetails, setDeleteDetails] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [savedAuditDeleteId, setSavedAuditDeleteId] = useState<string | null>(null);
  const [savedAudits, setSavedAudits] = useState<SavedAudit[]>([]);
  const [savedAuditPage, setSavedAuditPage] = useState(1);

  const email = clerk?.user?.primaryEmailAddress?.emailAddress.trim().toLowerCase() ?? "";
  const referralLink = useMemo(
    () => profile ? `https://pencilproof.com/analyze?ref=${encodeURIComponent(profile.referralCode)}` : "",
    [profile],
  );

  const refreshSavedAudits = async () => {
    const response = await fetch(`${SALES_API_URL}/api/account/me`, { cache: "no-store", credentials: "include" });
    if (!response.ok) return;
    const data = await response.json() as { audits?: SavedAudit[] };
    // This page is already inside the salesperson experience. Do not discard
    // the user's audit history if a separate auth-context refresh briefly
    // reports the default consumer role while cookies settle.
    setSavedAudits(uniqueRealAudits(data.audits ?? []));
  };

  const refresh = async () => {
    const response = await fetch(`${SALES_API_URL}/api/salesperson/me`, { cache: "no-store", credentials: "include" });
    if (!response.ok) return;
    const data = await response.json() as { profile?: Profile | null };
    const nextProfile = data.profile ?? null;
    setProfile(nextProfile);
    if (data.profile?.displayName) setDisplayName(data.profile.displayName);
    if (nextProfile && isActive(nextProfile.subscriptionStatus)) await refreshSavedAudits();
    else setSavedAudits([]);
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
      const requestedRole = getAuthContext();
      const response = await fetch(`${SALES_API_URL}/api/account/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, token, role: requestedRole }),
      });
      const data = await response.json().catch(() => ({})) as { role?: string };
      const resolvedRole = data.role === "salesperson" ? "salesperson" : "consumer";
      persistAuthContext(resolvedRole);
      if (!response.ok || resolvedRole !== "salesperson") {
        setRoleBlocked(true);
        return;
      }
      setRoleBlocked(false);
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
    setSavedAuditPage((current) => Math.min(current, Math.max(1, Math.ceil(groupAuditsByHistoryKey(savedAudits).length / SAVED_AUDITS_PER_PAGE))));
  }, [savedAudits.length]);

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

  const previewSalesCoach = async () => {
    setBusy(true);
    setMessage("");
    try {
      const created = await ensureProfile();
      if (created) setShowCoachPreview(true);
    } catch {
      setMessage("We could not save your salesperson profile yet. Please try again.");
    } finally {
      setBusy(false);
    }
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
    if (!profile || profile.availableCredits < 1) {
      setMessage("No PencilProof credit is available yet. Earn one when a referred customer completes a paid Full Quote Audit.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${SALES_API_URL}/api/salesperson/credit`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ action: "redeem" }) });
      const data = await response.json().catch(() => ({})) as { status?: string; error?: string };
      setMessage(!response.ok
        ? "We could not apply the credit right now. Your credit is still available—please try again."
        : data.status === "redeemed"
          ? "$20 was applied to your next PencilProof subscription invoice."
          : data.status === "billing_not_ready"
            ? "Your subscription billing profile is still being prepared."
            : data.status === "retry"
              ? "PencilProof could not apply the credit right now. Your credit is still available—please try again."
              : "No available credit was found.");
      await refresh();
    } catch {
      setMessage("We could not connect to billing. Your credit is still available—please try again.");
    } finally {
      setBusy(false);
    }
  };

  const giftCredit = async () => {
    if (!profile || profile.availableCredits < 1) {
      setMessage("No PencilProof credit is available to gift yet. Earn one when a referred customer completes a paid Full Quote Audit.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${SALES_API_URL}/api/salesperson/credit`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ action: "gift" }) });
      const data = await response.json().catch(() => ({})) as { status?: string; code?: string };
      if (response.ok && data.status === "created" && data.code) {
        const url = `${PUBLIC_SALES_URL}?gift=${encodeURIComponent(data.code)}`;
        setGiftUrl(url);
        setMessage("Gift link created. Send it to the person you choose.");
        await refresh();
      } else if (data.status === "no_credit") {
        setMessage("No available credit is ready to gift.");
      } else {
        setMessage("We could not create the gift link right now. Your credit is still available—please try again.");
      }
    } catch {
      setMessage("We could not connect to the credit service. Your credit is still available—please try again.");
    } finally {
      setBusy(false);
    }
  };

  const claimGift = async () => {
    if (!giftCode) return;
    setBusy(true);
    try {
      const response = await fetch(`${SALES_API_URL}/api/salesperson/gift/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ code: giftCode }) });
      const data = await response.json().catch(() => ({})) as { status?: string };
      setMessage(data.status === "claimed" ? "$20 PencilProof credit added to your salesperson account." : data.status === "salesperson_profile_required" ? "Create your salesperson profile first, then claim this gift." : "This gift link is unavailable or has already been claimed.");
      await refresh();
    } catch {
      setMessage("We could not claim this gift right now. Please try again.");
    } finally {
      setBusy(false);
    }
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
    await clearServerAccountSession();
    await clerk?.signOut();
    window.location.assign("/");
  };

  const confirmDeleteAccount = async () => {
    setDeleteBusy(true);
    track({
      event: "feedback_submitted",
      category: "account_deletion",
      comment: JSON.stringify({
        category: "account_deletion",
        phase: "account-deletion",
        reason: deleteReason.trim(),
        comment: deleteDetails.trim(),
      }),
    });
    // Feedback delivery is best effort and must never hold up account deletion.
    void flushAnalyticsQueue();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    let response: Response;
    try {
      response = await fetch(`${SALES_API_URL}/api/account/delete`, { method: "POST", credentials: "include", signal: controller.signal });
    } catch {
      setMessage("We could not delete your account right now. Please try again.");
      setDeleteBusy(false);
      return;
    } finally {
      window.clearTimeout(timeoutId);
    }
    if (!response.ok) {
      setMessage("We could not delete your account right now. Please try again.");
      setDeleteBusy(false);
      return;
    }
    try {
      await Promise.race([
        clerk?.signOut() ?? Promise.resolve(),
        new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
      ]);
    } finally {
      window.location.assign("/");
    }
  };

  const deleteSavedAudit = async (id: string) => {
    setSavedAuditDeleteId(id);
    setMessage("");
    try {
      const token = await clerk?.session?.getToken();
      const response = await fetch(`${SALES_API_URL}/api/account/audits`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("delete_failed");
      setSavedAudits((current) => current.filter((audit) => audit.id !== id));
      setMessage("Saved audit deleted.");
    } catch {
      setMessage("We could not delete that saved audit. Please try again.");
    } finally {
      setSavedAuditDeleteId(null);
    }
  };

  const savedAuditGroups = groupAuditsByHistoryKey(savedAudits);
  const savedAuditPageCount = Math.max(1, Math.ceil(savedAuditGroups.length / SAVED_AUDITS_PER_PAGE));
  const currentSavedAuditPage = Math.min(savedAuditPage, savedAuditPageCount);
  const visibleSavedAuditGroups = savedAuditGroups.slice((currentSavedAuditPage - 1) * SAVED_AUDITS_PER_PAGE, currentSavedAuditPage * SAVED_AUDITS_PER_PAGE);

  const renderSavedAudit = (audit: SavedAudit) => {
    const vehicle = String(audit.data.vehicle ?? "PencilProof Full Quote Audit");
    const vin = String(audit.data.vin ?? "").trim() || "Not detected";
    const verdict = audit.data.verdict && typeof audit.data.verdict === "object"
      ? String((audit.data.verdict as { label?: unknown }).label ?? "Audit completed")
      : "Audit completed";
    const historyLabel = auditHistoryLabel(audit, savedAudits);
    const isOriginal = historyLabel === "DEALER-GIVEN ORIGINAL";
    const payment = auditPayment(audit.data, !isOriginal);
    const amountFinanced = auditAmountFinanced(audit.data);
    return <article className="saved-audit" key={audit.id}>
      <div className="saved-audit-copy"><span className="saved-audit-badge">{historyLabel}</span><strong>{vehicle}</strong><p>{verdict}</p><div className="saved-audit-metrics" aria-label="Saved audit brief history"><span><small>PRICE</small><b>{auditMoney(audit.data.sellingPrice)}</b></span><span><small>{isOriginal ? "PAYMENT" : "LIVE PAYMENT"}</small><b>{payment === null ? "Not entered" : auditMoney(payment)}</b></span><span><small>APR</small><b>{auditRate(audit.data.apr)}</b></span><span><small>AMOUNT FINANCED</small><b>{amountFinanced === null ? "Not entered" : auditMoney(amountFinanced)}</b></span></div><small className="saved-audit-vin">VIN {vin}</small><small>Completed {new Date(audit.createdAt * 1000).toLocaleDateString()} · available until {new Date(audit.expiresAt * 1000).toLocaleDateString()}</small></div>
      <div className="saved-audit-actions"><Link className="button button-quiet" href={`${PAID_AUDIT_URL}?audit=${encodeURIComponent(audit.id)}`}>Open audit <span aria-hidden="true">→</span></Link><button type="button" onClick={() => void deleteSavedAudit(audit.id)} disabled={savedAuditDeleteId === audit.id}>{savedAuditDeleteId === audit.id ? "Deleting…" : "Delete"}</button></div>
    </article>;
  };

  const renderSavedAuditGroup = (group: ReturnType<typeof groupAuditsByHistoryKey<SavedAudit>>[number]) => {
    if (group.audits.length === 1) return renderSavedAudit(group.audits[0]);
    const first = group.audits[0];
    const vehicle = String(first.data.vehicle ?? "Saved vehicle");
    const vin = String(first.data.vin ?? "").trim() || "Not detected";
    return <details className="saved-audit-group" key={group.key}>
      <summary className="saved-audit-group-summary"><span><small className="saved-audit-badge">SAME VIN · {group.audits.length} SAVED AUDITS</small><strong>{vehicle}</strong><em>VIN {vin}</em></span><b>Show history <span aria-hidden="true">⌄</span></b></summary>
      <div className="saved-audit-group-list">{group.audits.map(renderSavedAudit)}</div>
    </details>;
  };

  if (!configured) return <><SiteNav /><main className="sales-page shell"><h1>Salesperson tools are being prepared.</h1><p>PencilProof is finishing the secure account connection.</p></main></>;
  if (!clerk) return <><SiteNav /><main className="sales-page shell"><p>Loading your PencilProof account…</p></main></>;
  if (roleBlocked) return <><SiteNav /><main className="sales-page shell"><p className="kicker">CONSUMER ACCOUNT</p><h1>My Audits is your account home.</h1><p>Salesperson tools are kept separate from consumer audits. Open the account page to review your saved audits.</p><Link className="button button-primary" href="/account">Go to My Audits</Link></main></>;
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
      {!profile || !isActive(profile.subscriptionStatus) ? <p className="sales-promo-banner"><strong>Try ALPHA1 at checkout.</strong> Get your first month for $1. Limited to the first 100 salesperson redemptions.</p> : null}
      <section className="sales-problem-solution" aria-labelledby="sales-problem-title">
        <div className="sales-story-intro"><p className="kicker">THE SALES CONVERSATION</p><h2 id="sales-problem-title">Turn a complicated worksheet into a clearer next conversation.</h2><p>When the numbers are difficult to explain, the customer may lose confidence before you can answer the real question: “What is included in this payment?”</p></div>
        <div className="sales-story-grid">
          <div className="sales-story-column sales-story-problems"><p className="sales-story-label">WITHOUT A CLEAR REVIEW</p><article><strong>Payment details are scattered</strong><span>Price, fees, products, trade equity, APR, and term may be spread across a dense worksheet.</span></article><article><strong>Don&apos;t know why the payment is different?</strong><span>PencilProof helps you trace payment variance back to the written figures so you know what to verify before answering.</span></article><article><strong>Conversations slow down</strong><span>You may need to pause and retrace the math before you can explain what changed or what is optional.</span></article><article><strong>Revised quotes restart the work</strong><span>When figures change, it can be hard to compare the new worksheet with the earlier version.</span></article></div>
          <div className="sales-story-column sales-story-solution"><p className="sales-story-label">WITH PENCILPROOF</p><article><strong>Scan and verify the figures</strong><span>Import the written quote, correct anything that needs attention, and confirm the numbers before using them.</span></article><article><strong>Explain the deal in one view</strong><span>See payment, APR, term, fees, optional products, trade figures, and clear questions to verify with the customer.</span></article><article><strong>Keep the next step obvious</strong><span>Share a tracked review link or QR code while the customer is still engaged, without sharing their private quote with you.</span></article><article><strong>Keep revisions organized</strong><span>Return to the review with updated figures, focus on what changed, and make the next conversation more focused.</span></article></div>
        </div>
      </section>
      {giftCode ? <section className="sales-card gift-card"><p className="kicker">PENCILPROOF GIFT</p><h2>You received a $20 salesperson credit.</h2><p>Claim it to your PencilProof salesperson account. A PencilProof account is required.</p><button className="button button-primary" type="button" onClick={() => void claimGift()} disabled={busy}>Claim this credit</button></section> : null}
      {!profile ? <section className="sales-card"><p className="kicker">GET STARTED</p><h2>Create your referral profile</h2><p>Choose a customer-facing name for your tracked link. It can be your first name, a nickname, or a professional name—it does not need to be your legal name.</p><label className="sales-label" htmlFor="sales-display-name"><span className="sales-label-caption">Display name <span aria-hidden="true">*</span></span><input id="sales-display-name" value={displayName} onChange={(event) => { setDisplayName(event.target.value); if (nameError) setNameError(""); }} placeholder="Hannah or Hannah at PencilProof" maxLength={80} minLength={2} required aria-required="true" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "sales-display-name-error" : "sales-display-name-help"} /></label><small id="sales-display-name-help" className="sales-field-help">This is the name customers will see—not your legal name.</small>{nameError ? <p id="sales-display-name-error" className="sales-field-error" role="alert">{nameError}</p> : null}<button className="button button-primary" type="button" onClick={() => void previewSalesCoach()} disabled={busy}>{busy ? "Saving your profile…" : "Preview Sales Coach"}</button></section> : null}
      {profile && !isActive(profile.subscriptionStatus) ? <section id="salesperson-plan" className="sales-card sales-dashboard-onboarding"><p className="kicker">SALESPERSON DASHBOARD</p><h2>{profile.subscriptionStatus === "not_started" ? `Welcome, ${profile.displayName}` : "Resume your salesperson plan"}</h2><p>Your free salesperson account is ready. Activate the $20/month plan to unlock your tracked link, QR code, referral credits, and sales tools.</p><div className="sales-plan-offer"><strong>Try ALPHA1</strong><span>First month for $1 · first 100 redemptions</span></div><button className="button button-primary" type="button" onClick={() => void startSubscription()} disabled={busy}>{busy ? "Opening checkout…" : "Start $20/month plan"}</button>{message ? <p className="sales-message" role="status">{message}</p> : null}</section> : null}
      {profile && isActive(profile.subscriptionStatus) ? <>
        <section className="sales-card sales-audit-access" aria-labelledby="sales-audit-access-title">
          <div><p className="kicker">UNLIMITED AUDIT ACCESS</p><h2 id="sales-audit-access-title">Upload a quote and run your own audit.</h2><p>Your active salesperson subscription includes unlimited Full Quote Audits. Upload a PDF or image, use a phone scan, correct the imported figures, and get the complete review without buying a separate customer pass.</p></div>
          <Link className="button button-primary" href={PAID_AUDIT_URL}>Upload quote for audit <span aria-hidden="true">→</span></Link>
        </section>
        <section className="sales-card sales-saved-audits" aria-labelledby="sales-saved-audits-title">
          <div className="sales-section-heading">
            <div><p className="kicker">SAVED AUDITS</p><h2 id="sales-saved-audits-title">Previous quote audits</h2></div>
            <span>{savedAudits.length} {savedAudits.length === 1 ? "audit" : "audits"}</span>
          </div>
          <p className="sales-saved-audits-intro">Completed audits save automatically to this dashboard for 30 days. Open one again when a customer sends a revised worksheet or you need to review the numbers.</p>
          {savedAudits.length ? <div className="sales-saved-audit-list">{visibleSavedAuditGroups.map(renderSavedAuditGroup)}</div> : <div className="sales-saved-audits-empty"><strong>No saved audits yet.</strong><p>Upload a quote above. Once the audit has enough information to calculate, it will appear here automatically.</p></div>}
          {savedAuditGroups.length > SAVED_AUDITS_PER_PAGE ? <nav className="audit-pagination" aria-label="Saved audit pages">
            <button className="button button-quiet" type="button" onClick={() => setSavedAuditPage((current) => Math.max(1, current - 1))} disabled={currentSavedAuditPage === 1}>Previous</button>
            <span className="audit-pagination-label">Page {currentSavedAuditPage} of {savedAuditPageCount}</span>
            <button className="button button-quiet" type="button" onClick={() => setSavedAuditPage((current) => Math.min(savedAuditPageCount, current + 1))} disabled={currentSavedAuditPage === savedAuditPageCount}>Next</button>
          </nav> : null}
          <AuditComparison audits={savedAudits} />
        </section>
        <section className="sales-card sales-dashboard"><div><p className="kicker">YOUR TRACKED LINK</p><h2>{profile.displayName}</h2><p>Customers who use this link are attributed to you. They are told that a paid audit may generate subscription credit for the person who shared the link.</p><div className="sales-link-row"><input readOnly value={referralLink} aria-label="Your referral link" /><button className="button button-quiet" type="button" onClick={() => void navigator.clipboard.writeText(referralLink)}>Copy link</button></div></div>{qrDataUrl ? <img className="sales-qr" src={qrDataUrl} alt="QR code for your PencilProof referral link" width="280" height="280" /> : null}</section>
        <section className="sales-card sales-credit-card"><div><p className="kicker">REFERRAL CREDITS</p><h2>${profile.availableCredits * 20} available</h2><p>{profile.earnedCredits} referral credit{profile.earnedCredits === 1 ? "" : "s"} earned · $20 each.</p><p className="sales-field-help">Earn $20 in PencilProof credit when a customer uses your tracked link and completes a verified paid Full Quote Audit. Credits have no cash value and can only be applied to your PencilProof salesperson subscription or gifted to another salesperson.</p></div><div className="sales-credit-actions"><p className="sales-credit-status" role="status">{creditStatusText(profile)}</p><div className="sales-credit-buttons"><button className="button button-primary" type="button" onClick={() => void redeemCredit()} disabled={busy}>Use for my renewal</button><button className="button button-quiet" type="button" onClick={() => void giftCredit()} disabled={busy}>Gift $20 to someone</button><button className="button button-quiet" type="button" onClick={() => void managePlan()} disabled={busy}>Manage subscription</button></div></div>{giftUrl ? <div className="gift-link"><strong>Gift link</strong><input readOnly value={giftUrl} aria-label="Gift link" /><button className="button button-quiet" type="button" onClick={() => void navigator.clipboard.writeText(giftUrl)}>Copy gift link</button></div> : null}</section>
      </> : null}
      {clerk.user && profile ? (showDeletePrompt ? <section className="delete-account-prompt" aria-labelledby="sales-delete-account-prompt-title">
        <p className="kicker">BEFORE YOU GO</p>
        <h2 id="sales-delete-account-prompt-title">Why are you deleting your account?</h2>
        <p>Your answer is optional and helps us improve PencilProof. You can leave it blank and continue.</p>
        <label htmlFor="sales-delete-reason">Reason</label>
        <select id="sales-delete-reason" value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)}>
          <option value="">Choose a reason (optional)</option>
          <option value="did not use service">I did not use the service</option>
          <option value="price too high">The price was too high</option>
          <option value="site trouble">I had trouble using the site</option>
          <option value="not needed anymore">I do not need PencilProof anymore</option>
          <option value="taking a break">I am taking a break</option>
          <option value="other">Other</option>
        </select>
        <label htmlFor="sales-delete-details">Additional feedback (optional)</label>
        <textarea id="sales-delete-details" value={deleteDetails} onChange={(event) => setDeleteDetails(event.target.value)} placeholder="Tell us more, if you would like to." rows={3} />
        <div className="delete-account-actions">
          <button className="button button-quiet" type="button" onClick={() => setShowDeletePrompt(false)} disabled={deleteBusy}>Keep my account</button>
          <button className="button button-danger" type="button" onClick={() => void confirmDeleteAccount()} disabled={deleteBusy}>{deleteBusy ? "Deleting…" : "Continue to delete"}</button>
        </div>
      </section> : <button className="account-delete" type="button" onClick={() => setShowDeletePrompt(true)}>Delete my account and data</button>) : null}
      {message && profile && isActive(profile.subscriptionStatus) ? <p className="sales-message" role="status">{message}</p> : null}
      {profile || showCoachPreview ? <SalesCoach unlocked={Boolean(profile && isActive(profile.subscriptionStatus))} playbook={playbook} onSubscribe={() => void startSubscription()} startOpen={showCoachPreview && !profile} /> : null}
      <p className="sales-note">PencilProof is an educational quote-audit tool. It does not approve financing, negotiate with a dealership, or guarantee savings. Referral rewards never reveal a customer&apos;s quote or audit information.</p>
    </main>
  </>;
}
