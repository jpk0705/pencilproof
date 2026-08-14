"use client";

import Link from "next/link";
import { useState } from "react";

const Arrow = () => <span aria-hidden="true">→</span>;

type DemoView = "summary" | "questions";

export default function SampleAuditDemo() {
  const [view, setView] = useState<DemoView>("summary");

  return (
    <div className="deal-card hero-deal-card sample-demo-card" aria-label="Interactive sample Full Quote Audit">
      <div className="deal-card-head">
        <div>
          <p>INTERACTIVE SAMPLE AUDIT</p>
          <h2>2026 Toyota RAV4 XLE Premium</h2>
        </div>
        <div className="sample-status"><strong>4</strong><span>areas worth reviewing</span></div>
      </div>

      <div className="sample-demo-tabs" role="tablist" aria-label="Sample audit views">
        <button type="button" role="tab" aria-selected={view === "summary"} className={view === "summary" ? "is-active" : ""} onClick={() => setView("summary")}>What we found</button>
        <button type="button" role="tab" aria-selected={view === "questions"} className={view === "questions" ? "is-active" : ""} onClick={() => setView("questions")}>What to ask</button>
      </div>

      {view === "summary" ? (
        <>
          <div className="deal-metrics">
            <div><span>Dealer quote</span><strong>$740/mo</strong></div>
            <div><span>Calculated payment</span><strong>$703/mo</strong></div>
            <div><span>Products financed</span><strong>$4,189</strong></div>
          </div>
          <div className="flag-list">
            <div className="flag flag-warn">
              <span className="flag-icon">!</span>
              <p><b>3 products add about $74/month</b><small>A service contract, GAP, and an appearance add-on are included in the loan.</small></p>
            </div>
            <div className="flag flag-warn">
              <span className="flag-icon">!</span>
              <p><b>Quoted payment is $36.59/month higher</b><small>Quote: $739.95. Entered figures: $703.36. Ask the dealer to explain the variance.</small></p>
            </div>
            <div className="flag flag-good">
              <span className="flag-icon">✓</span>
              <p><b>Dealer-ready response included</b><small>Ask for the exact amount financed, first-payment date, and an itemized buyer&apos;s order.</small></p>
            </div>
          </div>
        </>
      ) : (
        <div className="sample-question-panel" role="tabpanel">
          <p className="sample-question-kicker">DEALER-READY QUESTIONS</p>
          <h3>Turn the findings into a clearer conversation.</h3>
          <ol>
            <li>Can you itemize the exact amount financed before optional products?</li>
            <li>Which products are optional, and what would the payment be without them?</li>
            <li>Why is the quoted payment higher than the payment from these figures?</li>
          </ol>
          <div className="sample-question-callout"><strong>What the full audit adds</strong><span>Payment comparisons, APR and term checks, trade math, product guidance, and a copy-ready response.</span></div>
        </div>
      )}

      <div className="deal-card-foot">
        <span>Example figures for illustration.</span>
        <Link href="/analyze">Try your quote free <Arrow /></Link>
      </div>
    </div>
  );
}
