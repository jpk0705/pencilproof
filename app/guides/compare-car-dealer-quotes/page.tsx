import Link from "next/link";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";
import TrackedLink from "@/app/components/TrackedLink";
import GuideWorksheetExample from "@/app/components/GuideWorksheetExample";

const Arrow = () => <span aria-hidden="true">→</span>;

export const metadata = {
  title: "How to Compare Car Dealer Quotes | PencilProof",
  description: "Compare two car dealer quotes by checking the vehicle, selling price, fees, optional products, trade equity, APR, term, amount financed, and payment.",
  alternates: { canonical: "/guides/compare-car-dealer-quotes" },
};

export default function CompareDealerQuotesGuide() {
  return (
    <main>
      <SiteNav />
      <section className="page-hero shell">
        <div className="page-hero-copy">
          <p className="kicker">QUOTE COMPARISON GUIDE</p>
          <h1>How to compare two car dealer quotes fairly.</h1>
          <p>The lowest payment is not enough to compare offers. Put both quotes on the same frame, identify what changed, and separate the vehicle, financing, trade, fees, and products.</p>
          <div className="page-actions"><TrackedLink analyticsCategory="guide_compare_quotes" className="button button-primary" href="/pilot">Review your quote free <Arrow /></TrackedLink><Link className="text-link" href="/guides/car-payment-different">Trace a payment change <Arrow /></Link></div>
        </div>
      </section>

      <section className="section shell checks-grid-section" aria-labelledby="comparison-types">
        <div className="section-intro compact"><p className="kicker">TWO USEFUL COMPARISONS</p><h2 id="comparison-types">Compare the change you actually need to understand.</h2><p>PencilProof is designed to explain the written numbers neutrally. It does not decide whether a deal is good or bad for you.</p></div>
        <div className="check-list">
          <article><b>Original quote vs revised quote</b><p>Keep the dealer&apos;s original figures as the baseline, then compare price, rebate, fees, products, trade, cash down, APR, term, amount financed, and payment in the revision.</p></article>
          <article><b>Vehicle A vs Vehicle B</b><p>Compare the vehicle identity first, then compare the price, equipment context, trade structure, financing terms, products, and resulting payment.</p></article>
          <article><b>Hold the frame steady</b><p>If the term, APR, cash down, or trade payoff changes between quotes, call that out before treating the payments as comparable.</p></article>
          <article><b>Show products separately</b><p>Ask for a version with products and without products when possible. A lower payment may simply reflect a different product bundle or a longer term.</p></article>
          <article><b>Explain payment variance</b><p>Trace the payment back to the inputs. This turns “Why is the payment different?” into a specific question about the changed number.</p></article>
          <article><b>Turn differences into a request</b><p>Ask for the exact figure you want revised or explained, such as a lower price, a removed product, a different term, or an itemized fee.</p></article>
        </div>
      </section>

      <GuideWorksheetExample title="Quote B has the lower payment—but the longer term" explanation="These fictional quotes use the same vehicle and down payment. Comparing payment alone would miss the term and product differences." lines={[{label:"Quote A",value:"$30,000 · 60 mo · $601/mo"},{label:"Quote B",value:"$31,500 · 72 mo · $545/mo"},{label:"Products in Quote B",value:"$1,500"},{label:"Extra payments in Quote B",value:"12"},{label:"Useful comparison",value:"Balance + APR + term + products",emphasis:true}]} question="Can both quotes be shown with the same APR, term, cash down, trade, and product choices?" />

      <section className="section route-guide-section">
        <div className="shell section-intro compact"><p className="kicker">COMPARE YOUR OWN NUMBERS</p><h2>Start with the quote you already have.</h2><p>Upload a PDF or photo for a free scan. Verify the import, save the review when useful, and compare a revised quote or another vehicle when the figures are available.</p><TrackedLink analyticsCategory="guide_compare_quotes_bottom" className="button button-primary" href="/pilot">Start the free scan <Arrow /></TrackedLink></div>
      </section>
      <SiteFooter />
    </main>
  );
}
