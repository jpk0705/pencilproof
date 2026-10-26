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

      <section className="section shell faq-section" aria-labelledby="written-price-request">
        <div className="section-intro compact"><p className="kicker">COPY, EDIT, AND SEND</p><h2 id="written-price-request">What if a dealer won’t give you an out-the-door price?</h2><p>The FTC recommends asking the dealer to confirm the vehicle is available and send its out-the-door price in writing. Ask for the total before financing and have taxes, fees, and any required charges itemized.</p></div>
        <div className="faq-grid">
          <article><h2>A message you can use</h2><p>“I’m interested in [year, make, model, stock number]. Please confirm it is available and send the out-the-door price in writing, with taxes and each fee listed. Please show optional products separately and list any rebate or discount conditions. I’m not including a trade or financing in this price request.”</p></article>
          <article><h2>If they ask for a deposit</h2><p>Before paying, ask for the written price, what the deposit holds, how long it holds the vehicle, and the receipt or agreement’s cancellation and refund terms. Keep a copy. Deposit rules and contract obligations depend on the document and location; do not assume a deposit guarantees a price or is refundable.</p></article>
          <article><h2>If you already paid</h2><p>Save the receipt, original quote, and messages. Ask for an itemized revised price and a written explanation of each changed line. Check your signed paperwork for the agreed price and deposit terms before deciding what to do next.</p></article>
          <article><h2>If the written total changes</h2><p>Compare the vehicle, selling price, taxes, fees, products, rebates, and deposit credit line by line. Ask the dealer to explain the difference in writing. Do not sign paperwork with figures you do not understand; the FTC advises comparing signing documents with the terms sent earlier.</p></article>
        </div>
      </section>

      <GuideWorksheetExample title="Fictional example: a changed total after a deposit" explanation="Illustration only. A deposit is shown as a credit once; ask the dealer to explain each changed amount and check your own written agreement." lines={[{label:"Earlier written out-the-door total",value:"$28,600"},{label:"New optional products",value:"+$1,200"},{label:"New fee to explain",value:"+$500"},{label:"Deposit already paid",value:"−$500"},{label:"Revised amount due",value:"$29,800",emphasis:true}]} question="Which written terms changed, and where is my $500 deposit credited?" />

      <section className="section shell route-guide-section" aria-labelledby="ftc-guidance">
        <div className="section-intro compact"><p className="kicker">SOURCE AND LIMITS</p><h2 id="ftc-guidance">Keep the price request and contract in writing.</h2><p>This is general car-shopping education, not a determination of your legal rights or whether a deposit must be returned. See the <a className="text-link" href="https://consumer.ftc.gov/articles/car-dealer-ads-and-promotions-know-you-go" target="_blank" rel="noreferrer">FTC’s advice on car dealer ads and written prices</a> and its <a className="text-link" href="https://consumer.ftc.gov/articles/financing-or-leasing-car" target="_blank" rel="noreferrer">guidance on financing, signing, and changed paperwork</a>.</p></div>
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
        <div className="shell section-intro compact"><p className="kicker">NEXT STEP</p><h2>Compare the written quote you received.</h2><p>Scan a quote or revised buyer’s order for free, then verify every detected value against the original. The complete educational audit is a one-time $39 purchase; if BETA1 is available, secure checkout confirms the $1 offer before payment. No scan or payment is needed to send the price request above.</p><TrackedLink analyticsCategory="guide_dealer_quote_review_bottom" className="button button-primary" href="/analyze">Start the free scan <span aria-hidden="true">→</span></TrackedLink></div>
      </section>
      <SiteFooter />
    </main>
  );
}
