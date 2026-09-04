import Link from "next/link";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";
import TrackedLink from "@/app/components/TrackedLink";

export const metadata = {
  title: "PencilProof Pricing | Full Quote Audit",
  description: "Try the quote scan free, then unlock the one-time $39 PencilProof Full Quote Audit when you are ready.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <main>
      <SiteNav />
      <section className="page-hero shell">
        <div className="page-hero-copy">
          <p className="kicker">PRICING</p>
          <h1>See it work first. Pay once only when you want the full audit.</h1>
          <p>Upload your quote free and review what PencilProof finds. The complete Full Quote Audit is a one-time $39 purchase, not a subscription.</p>
          <p className="sales-promo-banner"><strong>$1 beta offer:</strong> enter <strong>BETA1</strong> in secure checkout while the promotion remains active. The regular one-time price is $39.</p>
          <div className="page-actions"><TrackedLink analyticsCategory="pricing_hero" className="button button-primary" href="/analyze">Review your quote free <span aria-hidden="true">→</span></TrackedLink><Link className="text-link" href="/how-it-works">See how checkout works <span aria-hidden="true">→</span></Link></div>
        </div>
      </section>

      <section className="section dark-section">
        <div className="shell offer-grid">
          <div>
            <p className="kicker kicker-light">ONE-TIME FULL QUOTE AUDIT</p>
            <h2>Turn “What changed?” into a question you can actually ask.</h2>
            <p className="offer-copy">The goal is not to scare you out of a product or a deal. It is to make the cost visible, explain the terms, and help you ask better questions before you sign.</p>
          </div>
          <div className="price-card">
            <div className="price-line"><span>Full Quote Audit</span><strong>$39</strong></div>
            <p className="sales-promo-banner"><strong>Pay $1 with BETA1.</strong> Enter the code in secure Stripe checkout while the beta promotion remains active.</p>
            <ul>
              <li>Private PDF and image autofill</li>
              <li>Required import confirmation before the audit</li>
              <li>Multi-option finance menu detection</li>
              <li>Payment with and without products</li>
              <li>VSC, GAP, PPM, and add-on guidance</li>
              <li>APR and full-term cost comparison</li>
              <li>Trade-equity and payment-math checks</li>
              <li>Copy-ready dealer questions</li>
              <li>Print or save the finished audit</li>
            </ul>
            <TrackedLink analyticsCategory="pricing_audit_card" className="button button-light" href="/analyze">Start with the free scan <span aria-hidden="true">→</span></TrackedLink>
            <small>One-time payment. BETA1 availability is confirmed in checkout before payment. Educational estimate. No guaranteed savings. If your quote cannot be processed, use the support options on your receipt for help or a refund review.</small>
          </div>
        </div>
      </section>

      <section className="section shell pricing-reassurance">
        <div className="section-intro compact"><p className="kicker">NO SURPRISES</p><h2>Know what you are getting before checkout.</h2></div>
        <div className="check-list"><article><b>Free scan first</b><p>You can upload and review the detected quote information before paying.</p></article><article><b>One-time purchase</b><p>There is no monthly membership or recurring subscription for the Full Quote Audit.</p></article><article><b>Your review matters</b><p>You confirm the imported figures before the audit uses them, and you remain responsible for verifying the final contract.</p></article></div>
      </section>
      <SiteFooter />
    </main>
  );
}
