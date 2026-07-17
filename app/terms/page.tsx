import Link from "next/link";
import { CHECKOUT_URL } from "@/lib/checkout";

export default function TermsPage() {
  return (
    <main className="legal-page">
      <nav className="site-nav" aria-label="Main navigation"><Link className="brand" href="/"><span className="brand-mark">P</span><span>PencilProof</span></Link><a className="nav-cta" href={CHECKOUT_URL}>Get my review · $39</a></nav>
      <article className="legal-copy shell">
        <p className="kicker">TERMS</p><h1>Understand the limits before using the review.</h1><p className="legal-date">Effective July 16, 2026</p>
        <h2>Educational tool only</h2><p>PencilProof provides automated mathematical estimates and general educational information based solely on the figures you enter. It does not provide legal, tax, lending, investment, mechanical, or financial advice.</p>
        <h2>Purchase and delivery</h2><p>A $39 purchase provides access to the automated browser-based deal analyzer for a financed vehicle purchase. It is a one-time purchase, not a subscription. Access is delivered through the confirmation shown after successful checkout. You are responsible for saving or printing any review you want to keep.</p>
        <h2>Payments, taxes, and support</h2><p>Checkout is processed through Stripe Managed Payments, with Link acting as merchant of record. Applicable tax may be added at checkout. For payment, receipt, or refund questions, use the Link support options and customer-support details provided with your receipt. Refund rights required by applicable law are not limited by these terms.</p>
        <h2>No brokerage or representation</h2><p>PencilProof does not locate vehicles, contact dealers, negotiate transactions, arrange financing, take deposits, complete paperwork, or represent buyers or sellers. You are responsible for communicating with the dealership and making every purchase decision.</p>
        <h2>Verify the numbers</h2><p>Vehicle taxes, registration fees, trade credits, lender rules, product pricing, and disclosures vary by state and transaction. Results may be incomplete or inaccurate if the inputs are incomplete or if local rules differ. Verify the final contract with the dealership, lender, and appropriate licensed professionals before signing.</p>
        <h2>No guarantee</h2><p>A score or flag does not mean a vehicle is fairly priced, safe, reliable, or suitable. PencilProof does not inspect vehicles, verify market value, obtain credit information, or guarantee savings, financing approval, dealer acceptance, or any outcome.</p>
        <h2>Availability and limitation</h2><p>The service may change, become temporarily unavailable, or contain errors. To the fullest extent permitted by law, use is at your own risk and PencilProof is not liable for decisions or losses arising from reliance on an estimate. Nothing in these terms excludes rights or liability that cannot legally be excluded.</p>
        <p className="legal-note">By purchasing or using PencilProof, you agree to these terms and the terms presented by Link at checkout.</p>
      </article>
    </main>
  );
}
