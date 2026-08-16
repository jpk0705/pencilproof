import Link from "next/link";
import { SiteFooter, SiteNav, AuditCta } from "@/app/components/SiteChrome";

const productCards = [
  { short: "VSC", title: "Vehicle service contract", copy: "May cover certain repairs after the factory warranty. Check the price, deductible, exclusions, term, and cancellation rules." },
  { short: "GAP", title: "Guaranteed asset protection", copy: "May help cover the gap between an insurance settlement and a loan balance after a covered total loss. Limits and exclusions matter." },
  { short: "PPM", title: "Prepaid maintenance", copy: "Prepays listed maintenance services. It is not a repair warranty, so separate convenience from included value." },
  { short: "T&W", title: "Tire & wheel protection", copy: "May cover eligible road-hazard damage. Verify cosmetic coverage, deductibles, limits, and exclusions." },
  { short: "ADD-ONS", title: "Accessories and other add-ons", copy: "Appearance, GPS, theft, etch, nitrogen, physical accessories, and other packages can raise both the amount financed and the interest you pay." },
];

export const metadata = {
  title: "What PencilProof Checks | Products, APR, Trade, and Payment",
  description: "See how PencilProof breaks down payment math, products, APR, trade equity, fees, and the full-term cost of a vehicle quote.",
  alternates: { canonical: "/what-it-checks" },
};

export default function WhatItChecksPage() {
  return (
    <main>
      <SiteNav />
      <section className="page-hero shell">
        <div className="page-hero-copy">
          <p className="kicker">WHAT IT CHECKS</p>
          <h1>See where the money goes before it becomes a monthly payment.</h1>
          <p>A lower payment can hide a longer term, a higher rate, financed products, or rolled-in trade debt. PencilProof separates the pieces so you can see the actual impact.</p>
          <div className="page-actions"><Link className="button button-primary" href="https://pencilproof.com/analyze">Review your quote free <span aria-hidden="true">→</span></Link><Link className="text-link" href="/pricing">Pricing <span aria-hidden="true">→</span></Link></div>
        </div>
      </section>

      <section className="section product-section">
        <div className="shell">
          <div className="section-intro product-intro">
            <p className="kicker">UNDERSTAND THE FINANCE OFFICE</p>
            <h2>Know what each product does—and what it adds to the loan.</h2>
            <p>PencilProof does not automatically label every product good or bad. It shows the cost and gives you the questions needed to decide whether it fits your situation.</p>
          </div>
          <div className="product-grid">{productCards.map((product) => <article key={product.short}><span>{product.short}</span><h3>{product.title}</h3><p>{product.copy}</p></article>)}</div>
        </div>
      </section>

      <section className="section shell checks-grid-section">
        <div className="section-intro compact"><p className="kicker">THE BIG FOUR</p><h2>The quote is more than the payment.</h2><p>Full Quote Audit puts the important relationships in one place so a monthly number does not hide the rest of the deal.</p></div>
        <div className="check-list">
          <article><b>Payment math</b><p>Rebuild the estimated payment from price, taxes, fees, products, cash down, APR, and term.</p></article>
          <article><b>Full-term cost</b><p>See what financed products and interest can add over the life of the loan, not just this month.</p></article>
          <article><b>Trade equity</b><p>Separate trade allowance, payoff, and rolled-in balance so negative equity is not invisible.</p></article>
          <article><b>Questions to ask</b><p>Turn findings into a copy-ready request for exact figures from the dealership.</p></article>
        </div>
        <AuditCta />
      </section>
      <SiteFooter />
    </main>
  );
}
