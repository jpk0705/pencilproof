import Link from "next/link";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";
import TrackedLink from "@/app/components/TrackedLink";

const Arrow = () => <span aria-hidden="true">→</span>;
const pilotAnalyzeUrl = "/analyze?utm_source=public_pilot&utm_medium=organic&utm_campaign=pilot";

export const metadata = {
  title: "Review a Car Dealer Quote Free | PencilProof",
  description: "Upload a car dealer quote and see the payment, APR, fees, products, trade figures, and vehicle details before you decide whether a full audit is useful.",
  alternates: { canonical: "/pilot" },
};

export default function PilotPage() {
  return (
    <main>
      <SiteNav />
      <section className="page-hero shell pilot-hero">
        <div className="page-hero-copy">
          <p className="kicker">START WITH THE QUOTE IN FRONT OF YOU</p>
          <h1>Know what the dealer payment is carrying before you sign.</h1>
          <p>Upload a PDF or photo of the written quote. PencilProof gives you a free, readable scan of the vehicle, price, payment, APR, term, fees, optional products, and trade figures before you decide whether the complete audit is useful.</p>
          <div className="page-actions">
            <TrackedLink analyticsCategory="public_pilot_hero" className="button button-primary" href={pilotAnalyzeUrl}>Review your quote free <Arrow /></TrackedLink>
            <Link className="text-link" href="/how-it-works">See how it works <Arrow /></Link>
          </div>
          <p className="hero-caution">No payment is required to see the detected values. You review and correct the import before any checkout decision.</p>
        </div>
      </section>

      <section className="signal-strip" aria-label="What happens in the free scan">
        <div className="shell signal-grid pilot-signal-grid">
          <div><span>01</span><b>Upload once</b><small>Use the PDF or photo you already have</small></div>
          <div><span>02</span><b>Verify the import</b><small>Correct any value that needs attention</small></div>
          <div><span>03</span><b>See the next step</b><small>Understand the deal before checkout</small></div>
        </div>
      </section>

      <section className="section shell pilot-proof-section">
        <div className="section-intro compact">
          <p className="kicker">A CALMER WAY TO REVIEW</p>
          <h2>From one crowded worksheet to the few numbers that matter first.</h2>
          <p>PencilProof separates the written deal into a quick vehicle reference, payment math, financing terms, fees, products, trade equity, and questions to verify. It explains what the quote says and what the entered math shows without calling the dealer dishonest or making a financial recommendation.</p>
        </div>
        <div className="steps pilot-steps">
          <article><span>1</span><h3>See the whole deal</h3><p>Review the figures that can change the monthly payment or amount financed.</p></article>
          <article><span>2</span><h3>Find what needs a closer look</h3><p>Compare the quoted payment with the calculation and see the impact of products, fees, rate, term, trade, and cash down.</p></article>
          <article><span>3</span><h3>Ask a clearer question</h3><p>Use the result to request the exact number or explanation you want from the dealership.</p></article>
        </div>
        <TrackedLink analyticsCategory="public_pilot_bottom" className="button button-primary" href={pilotAnalyzeUrl}>Start the free scan <Arrow /></TrackedLink>
      </section>

      <section className="section route-guide-section pilot-guide-section">
        <div className="shell section-intro compact">
          <p className="kicker">WANT A QUICK ANSWER FIRST?</p>
          <h2>Learn the common quote questions, then check your own numbers.</h2>
          <p><Link className="text-link" href="/guides/car-payment-different">Why is the payment different? <Arrow /></Link> <Link className="text-link" href="/guides/car-dealer-fees-add-ons">What are the fees and add-ons? <Arrow /></Link> <Link className="text-link" href="/guides/reading-car-dealer-worksheet">How do I read the worksheet? <Arrow /></Link> <Link className="text-link" href="/guides/compare-car-dealer-quotes">How do I compare quotes? <Arrow /></Link></p>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
