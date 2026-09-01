import Link from "next/link";
import { SiteFooter, SiteNav, AuditCta } from "@/app/components/SiteChrome";

export const metadata = {
  title: "Who PencilProof Helps | Shoppers and Salespeople",
  description: "See how shoppers and salespeople can use a written vehicle quote to ask clearer questions and structure a better request.",
  alternates: { canonical: "/who-it-helps" },
};

export default function WhoItHelpsPage() {
  return (
    <main>
      <SiteNav />
      <section className="page-hero shell">
        <div className="page-hero-copy">
          <p className="kicker">WHO IT HELPS</p>
          <h1>Use the written quote as a clearer starting point.</h1>
          <p>Whether you are buying a car or helping a customer buy one, PencilProof turns the written quote into a specific conversation instead of another round of guesswork.</p>
          <div className="page-actions"><Link className="button button-primary" href="https://pencilproof.com/analyze">Review your quote free <span aria-hidden="true">→</span></Link><Link className="text-link" href="/how-it-works">See how it works <span aria-hidden="true">→</span></Link></div>
        </div>
      </section>

      <section className="section desk-section">
        <div className="shell desk-layout">
          <div className="desk-copy">
            <p className="kicker">FOR SHOPPERS</p>
            <h2>Ask for the deal you actually want to review.</h2>
            <p>Instead of waiting while numbers move back and forth, start with the quote in front of you. Compare the payment without optional products, review trade equity, see what changed in a revision, and ask for an itemized buyer&apos;s order.</p>
            <p className="desk-limit">PencilProof does not negotiate, approve discounts, or replace the dealer&apos;s official worksheet. It helps you understand the request you want the dealership to price.</p>
          </div>
          <div className="audience-grid">
            <article>
              <span>SEE THE CHANGE</span>
              <h3>Know what moved before you respond.</h3>
              <p>A lower payment can come from a longer term, more cash down, a different rate, or products being moved around. PencilProof shows the inputs behind the estimate.</p>
            </article>
            <article>
              <span>LEAVE WITH QUESTIONS</span>
              <h3>Walk into finance prepared.</h3>
              <p>Use the audit&apos;s prioritized questions and copy-ready request to ask for exact figures instead of trying to remember what changed.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="section founder-section">
        <div className="shell founder-layout">
          <div>
            <p className="kicker">BUILT FOR WRITTEN CLARITY</p>
            <h2>Designed around the numbers buyers actually receive.</h2>
          </div>
          <div className="founder-copy">
            <p className="founder-lede">PencilProof focuses on the written quote: price, payment, APR, term, fees, products, trade figures, and amount financed.</p>
            <p>Instead of asking buyers to negotiate from memory, it organizes the figures into a clearer starting point for questions and comparison.</p>
            <div className="role-row" aria-label="PencilProof review areas"><span>Quote math</span><span>Trade equity</span><span>Optional products</span></div>
            <small>Independent educational software. PencilProof is not a dealership, lender, broker, or approval system.</small>
          </div>
        </div>
      </section>

      <section className="section shell audience-next-step">
        <div className="section-intro compact">
          <p className="kicker">THE SIMPLE NEXT STEP</p>
          <h2>Start with the quote and the questions.</h2>
          <p>Upload a PDF or image for free. PencilProof shows what it can detect before you decide whether a Full Quote Audit is useful.</p>
          <AuditCta />
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
