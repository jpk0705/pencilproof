import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="legal-page">
      <nav className="site-nav" aria-label="Main navigation"><Link className="brand" href="/"><span className="brand-mark">P</span><span>PencilProof</span></Link><Link className="nav-cta" href="/analyze">Check my deal</Link></nav>
      <article className="legal-copy shell">
        <p className="kicker">BETA TERMS</p><h1>Understand the limits before using the estimate.</h1><p className="legal-date">Beta version · July 16, 2026</p>
        <h2>Educational tool only</h2><p>PencilProof provides automated mathematical estimates and general educational information based solely on the figures you enter. It does not provide legal, tax, lending, investment, mechanical, or financial advice.</p>
        <h2>No brokerage or representation</h2><p>PencilProof does not locate vehicles, contact dealers, negotiate transactions, arrange financing, take deposits, complete paperwork, or represent buyers or sellers. You are responsible for communicating with the dealership and making every purchase decision.</p>
        <h2>Verify the numbers</h2><p>Vehicle taxes, registration fees, trade credits, lender rules, product pricing, and disclosures vary by state and transaction. Results may be incomplete or inaccurate if the inputs are incomplete or if local rules differ. Verify the final contract with the dealership, lender, and appropriate licensed professionals before signing.</p>
        <h2>No guarantee</h2><p>A score or flag does not mean a vehicle is fairly priced, safe, reliable, or suitable. PencilProof does not inspect vehicles, verify market value, obtain credit information, or guarantee savings, financing approval, dealer acceptance, or any outcome.</p>
        <h2>Beta availability</h2><p>The beta is provided without charge and may change, become unavailable, or contain errors. To the fullest extent permitted by law, use is at your own risk and PencilProof is not liable for decisions or losses arising from reliance on an estimate.</p>
        <p className="legal-note">These beta terms are a product draft and should be reviewed by qualified counsel before accepting payment from customers.</p>
      </article>
    </main>
  );
}
