import Link from "next/link";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";
import TrackedLink from "@/app/components/TrackedLink";
import GuideWorksheetExample from "@/app/components/GuideWorksheetExample";

export const metadata = {
  title: "Car Dealer Fees and Add-Ons: What to Check | PencilProof",
  description: "Understand dealer fees and optional car-buying add-ons such as GAP, VSC, prepaid maintenance, tire and wheel, and accessories before signing.",
  alternates: { canonical: "/guides/car-dealer-fees-add-ons" },
};

export default function CarDealerFeesAddOnsGuide() {
  return (
    <main>
      <SiteNav />
      <section className="page-hero shell">
        <div className="page-hero-copy">
          <p className="kicker">FEES + PRODUCTS GUIDE</p>
          <h1>What should I check in dealer fees and add-ons?</h1>
          <p>Optional products are not automatically good or bad. The useful first step is to see each product, price, term, coverage description, and effect on the amount financed and payment.</p>
          <div className="page-actions"><TrackedLink analyticsCategory="guide_fees_addons" className="button button-primary" href="/analyze">Review your quote free <span aria-hidden="true">→</span></TrackedLink><Link className="text-link" href="/what-it-checks">See product explanations <span aria-hidden="true">→</span></Link></div>
        </div>
      </section>

      <section className="section product-section" aria-labelledby="product-checklist">
        <div className="shell">
          <div className="section-intro product-intro"><p className="kicker">ITEMIZE THE BALANCE</p><h2 id="product-checklist">Ask what each line is, what it costs, and whether you want it.</h2><p>Some products may be useful in a particular situation. A clear quote lets you decide without guessing what a bundled amount contains.</p></div>
          <div className="product-grid">
            <article><span>GAP</span><h3>Guaranteed asset protection</h3><p>Ask what is covered, the limits, exclusions, cancellation terms, and whether it is financed.</p></article>
            <article><span>VSC</span><h3>Vehicle service contract</h3><p>Check the coverage, deductible, exclusions, term, provider, and total price—not only the payment.</p></article>
            <article><span>PPM</span><h3>Prepaid maintenance</h3><p>Ask which scheduled services are included, for how long, and whether the price is separate or financed.</p></article>
            <article><span>T&amp;W</span><h3>Tire and wheel protection</h3><p>Verify eligible damage, deductibles, limits, cosmetic coverage, and the full product price.</p></article>
            <article><span>ADD-ONS</span><h3>Accessories and other products</h3><p>Request a line-item list for appearance, theft, etch, GPS, accessories, and other packages.</p></article>
          </div>
        </div>
      </section>

      <section className="section shell faq-section" aria-labelledby="fee-questions">
        <div className="section-intro compact"><p className="kicker">QUESTIONS TO ASK</p><h2 id="fee-questions">A clearer request is easier to answer.</h2></div>
        <div className="faq-grid"><article><h2>What is required?</h2><p>Ask which charges are government, lender, or dealer fees and which products are optional.</p></article><article><h2>What is the total price?</h2><p>Ask for every fee and product to be listed separately with its effect on the amount financed.</p></article><article><h2>What changes if I decline a product?</h2><p>Ask for the revised amount financed and payment using the same APR, term, trade, and cash down when possible.</p></article><article><h2>What should I verify?</h2><p>Compare the final buyer&apos;s order with the figures you reviewed. The signed contract controls.</p></article></div>
      </section>

      <GuideWorksheetExample title="Itemized charges explain a $3,730 increase" explanation="This fictional worksheet keeps government charges, dealer fees, and optional products separate instead of hiding them inside a payment." lines={[{label:"Government/registration",value:"$650"},{label:"Documentation fee",value:"$85"},{label:"Service contract",value:"$2,295"},{label:"GAP",value:"$700"},{label:"Total added lines",value:"$3,730",emphasis:true}]} question="Which lines are required charges, and which products may I accept or decline separately?" />

      <section className="section route-guide-section">
        <div className="shell section-intro compact"><p className="kicker">SEE YOUR OWN NUMBERS</p><h2>Start with the free scan before checkout.</h2><p>PencilProof reads the quote locally first, lets you correct what needs attention, and shows the detected values before you decide whether the full audit is useful.</p><TrackedLink analyticsCategory="guide_fees_addons_bottom" className="button button-primary" href="/analyze">Upload your quote free <span aria-hidden="true">→</span></TrackedLink></div>
      </section>
      <SiteFooter />
    </main>
  );
}
