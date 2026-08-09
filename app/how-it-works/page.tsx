import Link from "next/link";
import { CHECKOUT_URL } from "@/lib/checkout";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";

const Arrow = () => <span aria-hidden="true">→</span>;

export const metadata = {
  title: "How PencilProof Works | Free Quote Scan",
  description: "Upload a vehicle quote free, check the imported figures, and unlock a Full Quote Audit only when you know what PencilProof found.",
};

export default function HowItWorksPage() {
  return (
    <main>
      <SiteNav />
      <section className="page-hero shell">
        <div className="page-hero-copy">
          <p className="kicker">HOW IT WORKS</p>
          <h1>See what PencilProof can read before you pay for the full answer.</h1>
          <p>There is no mystery checkout wall. The free scan comes first, you review the detected numbers, and only then decide whether the complete audit is worth it.</p>
          <div className="page-actions"><Link className="button button-primary" href="/#free-scan">Review your quote free <Arrow /></Link><Link className="text-link" href="/pricing">See what&apos;s included <Arrow /></Link></div>
        </div>
      </section>

      <section className="section shell">
        <div className="section-intro">
          <p className="kicker">THREE CLEAR STEPS</p>
          <h2>From a confusing worksheet to a deal you can question with confidence.</h2>
        </div>
        <div className="steps">
          <article><span>1</span><h3>Upload the quote free</h3><p>Scan a dealer PDF or image in your browser. PencilProof looks for the vehicle, price, cash down, trade, products, APR, term, payment, and other deal figures.</p></article>
          <article><span>2</span><h3>Check every imported number</h3><p>Compare the detected values with the original quote. If there are multiple payment choices, select the exact option you are considering before continuing.</p></article>
          <article><span>3</span><h3>Open the complete audit</h3><p>Pay once to compare scenarios, see product and payment impact, review the math, and create a specific request for a revised buyer&apos;s order.</p></article>
        </div>
      </section>

      <section className="signal-strip" aria-label="What PencilProof checks">
        <div className="shell signal-grid">
          <div><span>01</span><b>Payment rebuild</b><small>Check the dealer math</small></div>
          <div><span>02</span><b>Product impact</b><small>See with-and-without payments</small></div>
          <div><span>03</span><b>Desired APR</b><small>See the payment at your target rate</small></div>
          <div><span>04</span><b>Trade equity</b><small>Expose rolled-in debt</small></div>
        </div>
      </section>

      <section className="section shell sample-section" id="sample-audit">
        <div className="sample-copy">
          <p className="kicker">WHAT THE AUDIT REVEALS</p>
          <h2>You shouldn&apos;t need years inside a dealership to know whether your own deal adds up.</h2>
          <p>PencilProof separates the vehicle, financing, trade, fees, and optional products, then shows what changed and what to ask next.</p>
          <Link className="text-link" href={CHECKOUT_URL}>Review the Full Quote Audit · $39 <Arrow /></Link>
        </div>
        <div className="audit-preview" aria-label="Example audit findings">
          <div className="audit-preview-head"><span>EXAMPLE FINDINGS</span><strong>What the Full Quote Audit reveals</strong></div>
          <div className="audit-finding"><span>01</span><div><b>Quoted payment versus calculated payment</b><p>Compare the dealer&apos;s $739.95 quote with the $703.36 payment calculated from the entered figures.</p></div><strong>+$36.59/mo</strong></div>
          <div className="audit-finding"><span>02</span><div><b>Products plus estimated financing</b><p>See that $4,189 in entered products may cost roughly $5,361 when financed for the full term.</p></div><strong>$5,361</strong></div>
          <div className="audit-finding"><span>03</span><div><b>Amount financed rebuilt</b><p>See how the vehicle, tax, fees, products, and cash down produce the estimated loan balance.</p></div><strong>$39,574</strong></div>
          <div className="audit-unlock"><span>THE FULL QUOTE AUDIT ALSO INCLUDES</span><ul><li>Plain-language product explanations</li><li>Prioritized questions for the finance office</li><li>A copy-ready request for a revised quote</li><li>Printable action plan</li></ul></div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
