import Link from "next/link";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";
import TrackedLink from "@/app/components/TrackedLink";
import GuideWorksheetExample from "@/app/components/GuideWorksheetExample";

const Arrow = () => <span aria-hidden="true">→</span>;

export const metadata = {
  title: "How to Read a Car Dealer Worksheet | PencilProof",
  description: "Learn how to read a car dealer worksheet by finding the vehicle price, fees, products, trade figures, APR, term, amount financed, and payment.",
  alternates: { canonical: "/guides/reading-car-dealer-worksheet" },
};

export default function ReadingDealerWorksheetGuide() {
  return (
    <main>
      <SiteNav />
      <section className="page-hero shell">
        <div className="page-hero-copy">
          <p className="kicker">DEALER WORKSHEET GUIDE</p>
          <h1>How to read a car dealer worksheet without getting lost in the numbers.</h1>
          <p>A worksheet can show the vehicle, price, trade, fees, products, financing terms, and payment in different places. Start by finding each input, then check how the inputs connect before you decide what to ask.</p>
          <div className="page-actions"><TrackedLink analyticsCategory="guide_reading_worksheet" className="button button-primary" href="/pilot">Review your quote free <Arrow /></TrackedLink><Link className="text-link" href="/guides/dealer-quote-review">See the short checklist <Arrow /></Link></div>
        </div>
      </section>

      <section className="section shell faq-section" aria-labelledby="worksheet-sections">
        <div className="section-intro compact"><p className="kicker">FIND THE INPUTS</p><h2 id="worksheet-sections">Read the worksheet in five passes.</h2><p>The exact labels differ between dealerships. The goal is to locate the figures that determine the total price, amount financed, and monthly payment.</p></div>
        <div className="faq-grid">
          <article><h2>1. Identify the vehicle</h2><p>Check year, make, model, trim, VIN, mileage, and whether the vehicle is new or used. A wrong trim can change equipment, value, and fuel-economy context.</p></article>
          <article><h2>2. Separate price from charges</h2><p>Find selling price, discounts, rebates, sales tax, documentation, government or registration fees, and other charges. Do not treat the payment as the price.</p></article>
          <article><h2>3. Itemize products</h2><p>Look for GAP, service contracts, prepaid maintenance, tire and wheel, accessories, protection packages, and other add-ons. Ask for each product&apos;s price and whether it is financed.</p></article>
          <article><h2>4. Check trade and cash</h2><p>Compare the trade allowance with the payoff, then check cash down. Negative equity can be rolled into the new balance and change the payment even when the vehicle price stays the same.</p></article>
          <article><h2>5. Trace the payment</h2><p>Verify APR, term, amount financed, and quoted payment together. A longer term or different rate can lower the monthly number while changing the total cost.</p></article>
          <article><h2>What if a line is unclear?</h2><p>Ask for an itemized version of the quote and a revised payment using the same vehicle, trade, cash down, APR, and term. The signed contract and lender terms control the final deal.</p></article>
        </div>
      </section>

      <GuideWorksheetExample title="Read from price to payment—not backward from payment" explanation="A fictional worksheet becomes easier to audit when the figures are grouped into price, charges, credits, and financing terms." lines={[{label:"Selling price",value:"$31,500"},{label:"Tax + fees + products",value:"+$4,210"},{label:"Trade equity + cash",value:"−$5,000"},{label:"Amount financed",value:"$30,710"},{label:"APR / term",value:"6.90% / 60 months",emphasis:true}]} question="Can you provide this same structure on the buyer's order with every product itemized?" />

      <section className="section route-guide-section">
        <div className="shell section-intro compact"><p className="kicker">MAKE IT EASIER</p><h2>Let PencilProof organize the worksheet for you.</h2><p>Upload a PDF or photo for a free scan, review the detected values, and correct anything that needs attention before deciding whether a full audit is useful.</p><TrackedLink analyticsCategory="guide_reading_worksheet_bottom" className="button button-primary" href="/pilot">Start with the free scan <Arrow /></TrackedLink></div>
      </section>
      <SiteFooter />
    </main>
  );
}
