"use client";

import Link from "next/link";
import { Clerk } from "@clerk/clerk-js";
import { useEffect, useState, type ReactNode } from "react";
import { authRedirectOptions, createLoadedClerk } from "@/lib/clerk-client";
import { flushAnalyticsQueue, track } from "@/lib/analytics";
import { SiteNav } from "@/app/components/SiteChrome";

type Audit = {
  id: string;
  createdAt: number;
  expiresAt: number;
  data: Record<string, unknown>;
};

const date = (seconds: number) => new Date(seconds * 1000).toLocaleDateString();

export default function AccountPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const [clerk, setClerk] = useState<Clerk | null>(null);
  const [clerkError, setClerkError] = useState(false);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [auditPath, setAuditPath] = useState("/analyze");
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteDetails, setDeleteDetails] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (window.location.hostname.toLowerCase() === "audit.pencilproof.com") setAuditPath("/analyze/secure/");
  }, []);

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
    if (!clerk?.user) return;
    void (async () => {
      const token = await clerk.session?.getToken();
      const email = clerk.user?.primaryEmailAddress?.emailAddress.trim().toLowerCase() ?? "";
      if (token) {
        await fetch("/api/account/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, token }),
        });
      }
      const response = await fetch("/api/account/me", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as {
        audits?: Audit[];
        expiresAt?: number | null;
      };
      setAudits(data.audits ?? []);
      setExpiresAt(data.expiresAt ?? null);
    })();
  }, [clerk]);

  const shell = (content: ReactNode) => <><SiteNav />{content}</>;

  if (!configured) {
    return shell(<main className="account-page shell"><h1>Accounts are being prepared.</h1><p>PencilProof remains fully usable as a guest.</p><Link className="button button-primary" href={auditPath}>Audit another quote</Link></main>);
  }
  if (clerkError) {
    return shell(<main className="account-page shell"><h1>Account sign-in is temporarily unavailable.</h1><p>PencilProof remains fully usable as a guest. Please try again later if you want to save your access and audits.</p><Link className="button button-primary" href={auditPath}>Continue as a guest</Link></main>);
  }
  if (!clerk) {
    return shell(<main className="account-page shell"><p>Loading your PencilProof account…</p></main>);
  }
  if (!clerk.user) {
    return shell(<main className="account-page shell"><h1>Save your PencilProof access.</h1><p>Create a free account to use your Pass on other devices and keep eligible audits for 30 days.</p><div className="account-actions"><button className="button button-primary" type="button" onClick={() => clerk.openSignUp(authRedirectOptions())}>Create account</button><button className="button button-quiet" type="button" onClick={() => clerk.openSignIn(authRedirectOptions())}>Sign in</button></div><p className="account-guest-note">No account is required. You can continue using PencilProof as a guest.</p></main>);
  }

  const days = expiresAt ? Math.max(0, Math.ceil((expiresAt * 1000 - Date.now()) / 86400000)) : 0;
  const signedInEmail = clerk.user.primaryEmailAddress?.emailAddress.trim() ?? "Signed-in account";
  const deleteAudit = async (id: string) => {
    await fetch("/api/account/audits", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setAudits((current) => current.filter((audit) => audit.id !== id));
  };

  const confirmDeleteAccount = async () => {
    if (!window.confirm("Delete your PencilProof account and saved audit data?")) return;
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
    await flushAnalyticsQueue();
    await fetch("/api/account/delete", { method: "POST" });
    await clerk.signOut();
    setMessage("Your account and saved PencilProof data were deleted.");
    setShowDeletePrompt(false);
    setDeleteBusy(false);
  };

  return shell(
    <main className="account-page shell">
      <header className="account-header">
        <div><p className="kicker">YOUR PENCILPROOF</p><h1>My Audits</h1><p className="account-identity"><span>Signed in as</span><strong>{signedInEmail}</strong></p></div>
        <button className="nav-account-button" type="button" onClick={() => clerk.signOut()}>Sign out</button>
      </header>

      <section className="pass-card">
        <p className="kicker">PENCILPROOF 30-DAY PASS</p>
        <h2>{days ? `${days} days remaining` : "Your 30-Day Pass has ended."}</h2>
        <p>{days ? "Unlimited personal-use audits remain available during your pass." : "Your paid audit history remains available until each audit expires."}</p>
        <Link className="button button-primary" href={auditPath}>Audit another quote</Link>
      </section>

      <section className="account-history" aria-labelledby="audit-history-title">
        <div className="account-section-heading"><div><p className="kicker">YOUR PURCHASES</p><h2 id="audit-history-title">Paid audit history</h2></div><span>{audits.length} {audits.length === 1 ? "audit" : "audits"}</span></div>
        {audits.length ? audits.map((audit) => {
          const vehicle = String(audit.data.vehicle ?? "PencilProof Full Quote Audit");
          const verdict = audit.data.verdict && typeof audit.data.verdict === "object" ? String((audit.data.verdict as { label?: unknown }).label ?? "Audit completed") : "Audit completed";
          return <article className="saved-audit" key={audit.id}>
            <div className="saved-audit-copy"><span className="saved-audit-badge">FULL QUOTE AUDIT</span><strong>{vehicle}</strong><p>{verdict}</p><small>Completed {date(audit.createdAt)} · available until {date(audit.expiresAt)}</small></div>
            <button type="button" onClick={() => void deleteAudit(audit.id)}>Delete</button>
          </article>;
        }) : <div className="account-empty"><strong>No paid audits yet.</strong><p>Your completed Full Quote Audits will appear here automatically.</p><Link className="text-link" href={auditPath}>Start a quote scan →</Link></div>}
      </section>

      {showDeletePrompt ? (
        <section className="delete-account-prompt" aria-labelledby="delete-account-prompt-title">
          <p className="kicker">BEFORE YOU GO</p>
          <h2 id="delete-account-prompt-title">Why are you deleting your account?</h2>
          <p>Your answer is optional and helps us improve PencilProof. You can leave it blank and continue.</p>
          <label htmlFor="delete-reason">Reason</label>
          <select id="delete-reason" value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)}>
            <option value="">Choose a reason (optional)</option>
            <option value="completed purchase">I completed my car purchase</option>
            <option value="did not use service">I did not use the service</option>
            <option value="price too high">The price was too high</option>
            <option value="site trouble">I had trouble using the site</option>
            <option value="not needed anymore">I do not need PencilProof anymore</option>
            <option value="other">Other</option>
          </select>
          <label htmlFor="delete-details">Additional feedback (optional)</label>
          <textarea id="delete-details" value={deleteDetails} onChange={(event) => setDeleteDetails(event.target.value)} placeholder="Tell us more, if you would like to." rows={3} />
          <div className="delete-account-actions">
            <button className="button button-quiet" type="button" onClick={() => setShowDeletePrompt(false)} disabled={deleteBusy}>Keep my account</button>
            <button className="button button-danger" type="button" onClick={() => void confirmDeleteAccount()} disabled={deleteBusy}>{deleteBusy ? "Deleting…" : "Continue to delete"}</button>
          </div>
        </section>
      ) : <button className="account-delete" type="button" onClick={() => setShowDeletePrompt(true)}>Delete my account and data</button>}
      {message ? <p role="status">{message}</p> : null}
    </main>,
  );
}
