import Link from "next/link";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";
import TrackedLink from "@/app/components/TrackedLink";
import GuideWorksheetExample from "@/app/components/GuideWorksheetExample";

export const metadata = {
  title: "Why Is My Car Payment Different From the Quote? | PencilProof",
  description: "Find out why a car payment can differ from a dealer quote when price, APR, term, fees, products, trade equity, or cash down changes.",
  alternates: { canonical: "/guides/car-payment-different" },
};

export default function CarPaymentDifferentGuide() {
  return (
    <main>
      <SiteNav />
      <section className="page-hero shell">
        <div className="page-hero-copy">
          <p className="kicker">PAYMENT CLARITY GUIDE</p>
          <h1>Why is my car payment different from the quote?</h1>
          <p>The payment is the end of a calculation. If the payment moved, compare the inputs that create it: selling price, taxes, fees, products, trade equity, cash down, APR, and loan term.</p>
          <div className="page-actions"><TrackedLink analyticsCategory="guide_payment_difference" className="button button-primary" href="/analyze">Review your quote free <span aria-hidden="true">→</span></TrackedLink><Link className="text-link" href="/what-it-checks">See what it checks <span aria-hidden="true">→</span></Link></div>
        </div>
      </section>

      <section className="section shell checks-grid-section" aria-labelledby="payment-causes">
        <div className="section-intro compact"><p className="kicker">TRACE THE CHANGE</p><h2 id="payment-causes">The most common causes are visible in the written figures.</h2><p>A payment difference does not identify the cause by itself. PencilProof helps you isolate the changed number so you can verify the revised quote.</p></div>
        <div className="check-list">
          <article><b>Price or rebate</b><p>A changed selling price, discount, or rebate changes the amount being financed.</p></article>
          <article><b>Fees or taxes</b><p>Documentation, government, registration, sales tax, and other fees can be added or moved into financing.</p></article>
          <article><b>Products</b><p>GAP, service contracts, maintenance, tire and wheel, accessories, and other add-ons can raise the balance and the interest paid.</p></article>
          <article><b>Trade or cash down</b><p>A different trade allowance, payoff, negative equity, or cash-down amount changes the financed balance.</p></article>
          <article><b>APR</b><p>The same amount financed can produce a different payment when the rate changes. The lender must confirm the final rate.</p></article>
          <article><b>Term</b><p>A longer term can lower the monthly payment while increasing the number of payments and potentially the total interest.</p></article>
        </div>
      </section>

      <GuideWorksheetExample title="The same $30,000 balance can create two different payments" explanation="At an illustrative 7.50% APR, changing only the term lowers the monthly payment but adds twelve payments and more total interest." lines={[{label:"Amount financed",value:"$30,000"},{label:"APR",value:"7.50%"},{label:"60-month payment",value:"about $601/mo"},{label:"72-month payment",value:"about $519/mo"},{label:"Difference",value:"about $82/mo lower",emphasis:true}]} question="Did the price change, or did the payment fall because the term became longer?" />
      <p className="shell section-intro compact">Then review the <Link className="text-link" href="/guides/can-i-afford-this-car-payment">full ownership budget</Link>, including costs outside the written payment.</p>

      <section className="section route-guide-section">
        <div className="shell section-intro compact"><p className="kicker">MAKE IT SPECIFIC</p><h2>Compare the written quote with the numbers you want to discuss.</h2><p>Upload a PDF or image for free, review the detected values, and use the result to ask what changed before you sign.</p><TrackedLink analyticsCategory="guide_payment_difference_bottom" className="button button-primary" href="/analyze">Start the free scan <span aria-hidden="true">→</span></TrackedLink></div>
      </section>
      <SiteFooter />
    </main>
  );
}
