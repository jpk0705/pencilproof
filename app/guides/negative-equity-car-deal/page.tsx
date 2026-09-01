import Link from "next/link";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";
import TrackedLink from "@/app/components/TrackedLink";

export const metadata = { title: "Negative Equity in a Car Deal, Explained | PencilProof", description: "Understand how trade payoff, trade allowance, and negative equity affect a new car loan and monthly payment.", alternates: { canonical: "/guides/negative-equity-car-deal" } };

export default function NegativeEquityGuide() {
  return <main><SiteNav />
    <section className="page-hero shell"><div className="page-hero-copy"><p className="kicker">TRADE EQUITY GUIDE</p><h1>What does negative equity do to a car deal?</h1><p>Negative equity is the amount by which the payoff on your current loan exceeds the trade allowance. When that difference is rolled into a new deal, you may finance part of the old vehicle along with the new one.</p><div className="page-actions"><TrackedLink analyticsCategory="guide_negative_equity" className="button button-primary" href="/analyze">Review your quote free <span aria-hidden="true">→</span></TrackedLink><Link className="text-link" href="/guides/compare-car-dealer-quotes">Compare written quotes <span aria-hidden="true">→</span></Link></div></div></section>
    <section className="section shell checks-grid-section" aria-labelledby="equity-example"><div className="section-intro compact"><p className="kicker">SIMPLE EXAMPLE</p><h2 id="equity-example">A $20,000 payoff and $16,000 allowance creates $4,000 of negative equity.</h2><p>If the lender and deal structure allow it, that $4,000 can be added to the new balance. It can raise the amount financed, payment, and interest paid even when the new vehicle price stays the same.</p></div><div className="check-list">
      <article><b>Get the current payoff</b><p>Use a current lender payoff, not only the remaining balance shown on an older statement.</p></article><article><b>Find the written allowance</b><p>The trade allowance should be visible separately from the selling price and other credits.</p></article><article><b>Calculate the difference</b><p>Payoff minus allowance equals negative equity when the result is above zero.</p></article><article><b>Verify where it went</b><p>Ask the dealer to identify the exact worksheet or contract line containing the carried balance.</p></article>
    </div></section>
    <section className="section route-guide-section"><div className="shell section-intro compact"><p className="kicker">ASK BEFORE SIGNING</p><h2>“What are my trade allowance, payoff, and net equity—and where is that difference shown?”</h2><p>PencilProof can help organize the written figures, but your lender and signed contract determine the final financing.</p><TrackedLink analyticsCategory="guide_negative_equity_bottom" className="button button-primary" href="/analyze">Check the written numbers <span aria-hidden="true">→</span></TrackedLink></div></section><SiteFooter />
  </main>;
}
