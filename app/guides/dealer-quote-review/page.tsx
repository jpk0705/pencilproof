import Link from "next/link";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";
import TrackedLink from "@/app/components/TrackedLink";
import GuideWorksheetExample from "@/app/components/GuideWorksheetExample";

export const metadata = {
  title: "How to Review a Dealer Car Quote | PencilProof",
  description: "Learn how to review a dealer car quote by comparing price, fees, products, trade figures, APR, term, amount financed, and payment before signing.",
  alternates: { canonical: "/guides/dealer-quote-review" },
};

export default function DealerQuoteReviewGuide() {
  return (
    <main>
      <SiteNav />
      <section className="page-hero shell">
        <div className="page-hero-copy">
          <p className="kicker">QUOTE REVIEW GUIDE</p>
          <h1>How to review a dealer car quote before you sign.</h1>
          <p>Start with the written figures, not just the monthly payment. A clear review connects the vehicle price, fees, optional products, trade, APR, term, amount financed, and payment so you can ask a specific next question.</p>
          <div className="page-actions"><TrackedLink analyticsCategory="guide_dealer_quote_review" className="button button-primary" href="/analyze">Review your quote free <span aria-hidden="true">→</span></TrackedLink><Link className="text-link" href="/how-it-works">See how it works <span aria-hidden="true">→</span></Link></div>
        </div>
      </section>

      <section className="section shell faq-section" aria-labelledby="quote-review-checklist">
        <div className="section-intro compact"><p className="kicker">THE SHORT CHECKLIST</p><h2 id="quote-review-checklist">Six questions make a dense worksheet easier to understand.</h2><p>You do not need to decide whether a deal is good or bad at a glance. First make the numbers visible, then verify what changed and what is included.</p></div>
        <div className="faq-grid">
          <article><h2>What is the selling price?</h2><p>Separate the vehicle price from rebates, discounts, taxes, government fees, documentation fees, and optional products.</p></article>
          <article><h2>What is inside the amount financed?</h2><p>Check whether products, fees, rolled-in trade payoff, or other balances are being financed instead of paid separately.</p></article>
          <article><h2>Does the payment math make sense?</h2><p>Compare the quoted payment with the amount financed, APR, term, and cash down. A lower payment can come from a longer term or changed inputs.</p></article>
          <article><h2>What changed from the earlier quote?</h2><p>Compare the original written quote with the revision line by line. Ask for any new product, fee, rate, term, or trade figure to be shown in writing.</p></article>
          <article><h2>Which products are optional?</h2><p>Ask for the name, price, term, deductible, exclusions, cancellation rules, and whether each product is included in the payment.</p></article>
          <article><h2>What should I ask next?</h2><p>Turn the review into a short request for an itemized buyer&apos;s order and a payment based on the exact structure you want to consider.</p></article>
        </div>
      </section>

      <GuideWorksheetExample title="A lower vehicle price can still produce a higher balance" explanation="This fictional worksheet shows why every line matters. The $28,000 selling price is not the amount financed after charges, products, and credits." lines={[{label:"Selling price",value:"$28,000"},{label:"Tax + government/doc fees",value:"+$2,835"},{label:"Optional products",value:"+$2,400"},{label:"Cash down",value:"−$3,000"},{label:"Illustrative amount financed",value:"$30,235",emphasis:true}]} question="Please show me each line that takes the selling price to the amount financed." />

      <section className="section route-guide-section">
        <div className="shell section-intro compact"><p className="kicker">NEXT STEP</p><h2>Bring your own quote to the free scan.</h2><p>PencilProof shows what it can detect before checkout. You confirm the imported values, and the final audit remains an educational estimate—not a dealer approval or financial recommendation.</p><TrackedLink analyticsCategory="guide_dealer_quote_review_bottom" className="button button-primary" href="/analyze">Upload your quote free <span aria-hidden="true">→</span></TrackedLink></div>
      </section>
      <SiteFooter />
    </main>
  );
}
