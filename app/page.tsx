import Link from "next/link";
import { CHECKOUT_URL } from "@/lib/checkout";

const Arrow = () => <span aria-hidden="true">→</span>;

const productCards = [
  {
    short: "VSC",
    title: "Vehicle service contract",
    copy: "May cover certain repairs after the factory warranty. The audit helps you question price, deductible, exclusions, term, and cancellation rules.",
  },
  {
    short: "GAP",
    title: "Guaranteed asset protection",
    copy: "May help with the difference between an insurance settlement and your loan balance after a covered total loss. Limits and exclusions matter.",
  },
  {
    short: "PPM",
    title: "Prepaid maintenance",
    copy: "Prepays listed maintenance services. It is not a repair warranty, so the audit separates convenience from actual included value.",
  },
  {
    short: "ADD-ONS",
    title: "Protection and accessories",
    copy: "Appearance products, theft products, accessories, and other packages can raise both the amount financed and the interest you pay.",
  },
];

export default function Home() {
  return (
    <main>
      <nav className="site-nav" aria-label="Main navigation">
        <Link className="brand" href="/" aria-label="PencilProof home">
          <span className="brand-mark">P</span>
          <span>PencilProof</span>
        </Link>
        <div className="nav-links">
          <a href="#structure-yourself">Who it helps</a>
          <a href="#how-it-works">How it works</a>
          <a className="nav-cta" href={CHECKOUT_URL}>Structure my deal · $39</a>
        </div>
      </nav>

      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span /> ASKED FOR A DISCOUNT, RATE, OR PRODUCT CHANGE?</div>
          <h1>Stop waiting 30 minutes. Structure the deal yourself.</h1>
          <p className="hero-lede">
            You asked for a discount, a better rate, or the payment without a product—and the salesperson disappeared for 30 minutes.
            Upload the quote or enter the figures yourself. PencilProof rebuilds the deal, compares payment options, separates products,
            and helps you decide what revised structure to request before anyone returns from the manager&apos;s office.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href={CHECKOUT_URL}>
              Structure my deal · $39 <Arrow />
            </a>
            <a className="button button-quiet" href="#sample-audit">See a sample audit</a>
          </div>
          <p className="hero-caution">One-time purchase. Educational estimate. Savings are not guaranteed.</p>
          <div className="proof-row" aria-label="Product highlights">
            <span><b>For shoppers</b> at the dealership</span>
            <span><b>For salespeople</b> checking scenarios</span>
            <span><b>Private</b> browser-based inputs</span>
          </div>
        </div>

        <div className="deal-card hero-deal-card" aria-label="Sample Deal Audit preview">
          <div className="deal-card-head">
            <div>
              <p>SAMPLE DEAL AUDIT</p>
              <h2>2026 compact SUV</h2>
            </div>
            <div className="score-ring"><strong>60</strong><span>/100</span></div>
          </div>
          <div className="deal-metrics">
            <div><span>With products</span><strong>$742/mo</strong></div>
            <div><span>Without products</span><strong>$694/mo</strong></div>
            <div><span>Products financed</span><strong>$2,790</strong></div>
          </div>
          <div className="flag-list">
            <div className="flag flag-warn">
              <span className="flag-icon">!</span>
              <p><b>Products add about $48/month</b><small>VSC, maintenance, and protection are included in the loan.</small></p>
            </div>
            <div className="flag flag-warn">
              <span className="flag-icon">!</span>
              <p><b>Dealer APR is 2.10 points above the desired APR</b><small>At 5.39%, the estimated payment is $699/month—about $3,086 less over 72 months.</small></p>
            </div>
            <div className="flag flag-good">
              <span className="flag-icon">✓</span>
              <p><b>Dealer-ready response included</b><small>Ask for the exact no-products payment and an itemized buyer&apos;s order.</small></p>
            </div>
          </div>
          <div className="deal-card-foot">
            <span>Example based on entered figures.</span>
            <a href="#sample-audit">See what&apos;s inside <Arrow /></a>
          </div>
        </div>
      </section>

      <section className="section desk-section" id="structure-yourself">
        <div className="shell desk-layout">
          <div className="desk-copy">
            <p className="kicker">STOP WAITING FOR THE MANAGER</p>
            <h2>See what the revised deal could look like before the salesperson comes back.</h2>
            <p>Change the down payment, term, desired APR, trade figures, or optional products yourself. PencilProof immediately shows how those entered changes affect the estimated payment and full-term cost.</p>
            <p className="desk-limit">PencilProof does not approve discounts, set lender rates, or replace the dealer&apos;s official worksheet. It helps you structure and understand the request you want the dealership to price.</p>
          </div>
          <div className="audience-grid">
            <article>
              <span>SHOPPERS</span>
              <h3>Ask for a specific revised deal.</h3>
              <p>Instead of waiting without knowing what changed, compare the payment without products, test a desired APR, and request an itemized buyer&apos;s order with exact numbers.</p>
            </article>
            <article>
              <span>SALESPEOPLE</span>
              <h3>Preview a cleaner structure for your customer.</h3>
              <p>If only management can desk and approve the deal, use the customer&apos;s written figures to explore scenarios and prepare a clearer request for the desk. Final figures still require dealership and lender approval.</p>
            </article>
          </div>
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
          <p className="kicker">MORE THAN A PAYMENT CALCULATOR</p>
          <h2>A calculator gives you a payment. An audit tells you what to question.</h2>
          <p>
            Free calculators can estimate a loan. PencilProof is designed for
            the moment you have an actual dealer worksheet and need to separate
            the vehicle, financing, trade, fees, and optional products.
            It can also detect many multi-option payment menus so you can choose and compare the row you are actually considering.
          </p>
          <a className="text-link" href={CHECKOUT_URL}>Get my complete audit for $39 <Arrow /></a>
        </div>
        <div className="audit-preview" aria-label="Example audit findings">
          <div className="audit-preview-head"><span>EXAMPLE FINDINGS</span><strong>What the paid audit reveals</strong></div>
          <div className="audit-finding"><span>01</span><div><b>Payment without optional products</b><p>Compare the rebuilt $742 payment with an estimated $694 payment after removing entered products.</p></div><strong>−$48/mo</strong></div>
          <div className="audit-finding"><span>02</span><div><b>Products plus estimated financing</b><p>See that $2,790 in entered products may cost roughly $3,472 when financed for the full term.</p></div><strong>$3,472</strong></div>
          <div className="audit-finding"><span>03</span><div><b>Dealer APR versus your desired APR</b><p>Compare the $742 rebuilt payment with an estimated $699 payment at the desired 5.39% APR.</p></div><strong>−$43/mo</strong></div>
          <div className="audit-unlock">
            <span>THE COMPLETE AUDIT ALSO INCLUDES</span>
            <ul><li>Plain-language product explanations</li><li>Prioritized questions for the finance office</li><li>A copy-ready request for a revised quote</li><li>Printable action plan</li></ul>
          </div>
        </div>
      </section>

      <section className="section product-section" id="products">
        <div className="shell">
          <div className="section-intro product-intro">
            <p className="kicker">UNDERSTAND THE FINANCE OFFICE</p>
            <h2>Know what each product does—and what it adds to the loan.</h2>
            <p>PencilProof does not automatically label every product good or bad. It shows the cost and gives you the questions needed to decide whether it fits your situation.</p>
          </div>
          <div className="product-grid">
            {productCards.map((product) => (
              <article key={product.short}>
                <span>{product.short}</span>
                <h3>{product.title}</h3>
                <p>{product.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section shell" id="how-it-works">
        <div className="section-intro">
          <p className="kicker">THE FIVE-MINUTE SECOND OPINION</p>
          <h2>Build your counter-request before the revised quote comes back.</h2>
        </div>
        <div className="steps">
          <article>
            <span>1</span>
            <h3>Unlock the audit</h3>
            <p>Pay $39 once through secure Stripe checkout. There is no subscription or recurring charge.</p>
          </article>
          <article>
            <span>2</span>
            <h3>Upload or enter the worksheet</h3>
            <p>Import a digital or scanned dealer PDF or clear JPG/JPEG/PNG image, or copy the selling price, taxes, products, trade, APR, term, and payment yourself.</p>
          </article>
          <article>
            <span>3</span>
            <h3>Structure the next version</h3>
            <p>Compare the rebuilt deal, change the rate, term, down payment, or products, and copy a specific request for a revised buyer&apos;s order.</p>
          </article>
        </div>
      </section>

      <section className="section dark-section" id="pricing">
        <div className="shell offer-grid">
          <div>
            <p className="kicker kicker-light">ONE-TIME DEAL AUDIT</p>
            <h2>$39 before a decision worth tens of thousands.</h2>
            <p className="offer-copy">
              The goal is not to scare you out of a product or a deal. It is to
              make the cost visible, explain the terms, and help you ask better
              questions before you sign.
            </p>
          </div>
          <div className="price-card">
            <div className="price-line"><span>Complete Deal Audit</span><strong>$39</strong></div>
            <ul>
              <li>Private PDF and photo autofill</li>
              <li>Multi-option finance and lease menu detection</li>
              <li>Payment with and without products</li>
              <li>VSC, GAP, PPM, and add-on guidance</li>
              <li>APR and full-term cost comparison</li>
              <li>Trade-equity and payment-math checks</li>
              <li>Copy-ready dealer questions</li>
              <li>Print or save the finished review</li>
            </ul>
            <a className="button button-light" href={CHECKOUT_URL}>Structure my deal now <Arrow /></a>
            <small>One-time payment. Educational estimate. No guaranteed savings.</small>
          </div>
        </div>
      </section>

      <section className="section shell faq-section">
        <div className="section-intro compact">
          <p className="kicker">STRAIGHT ANSWERS</p>
          <h2>Know what you&apos;re buying.</h2>
        </div>
        <div className="faq-grid">
          <article><h3>Is this just a payment calculator?</h3><p>No. It rebuilds the payment, separates entered products, explains common finance-office products, measures APR and trade impact, and creates an action plan.</p></article>
          <article><h3>Does PencilProof guarantee savings?</h3><p>No. It may identify costs worth questioning, but actual savings depend on the deal, lender, products, dealer, and choices you make.</p></article>
          <article><h3>Can I update the deal after the dealer responds?</h3><p>Yes. Change the inputs to compare a revised worksheet, then print or save the updated review before signing.</p></article>
          <article><h3>Can PencilProof read every document?</h3><p>No. It can autofill recognizable text from many digital or scanned PDFs and clear JPG/JPEG/PNG images. Blurry, cropped, handwritten, password-protected, or unusually formatted documents may require manual entry.</p></article>
          <article><h3>Can it compare a quote with several payment choices?</h3><p>Yes. When PencilProof recognizes an option matrix, it shows the detected finance and lease rows so you can select the one you are considering. Always compare imported values with the original document.</p></article>
          <article><h3>Is this a dealership desking or lender-approval system?</h3><p>No. PencilProof models the figures you enter or import. It cannot authorize a discount, access lender programs, approve credit, or replace the dealership&apos;s official buyer&apos;s order or lease worksheet.</p></article>
          <article><h3>Does PencilProof negotiate or provide advice?</h3><p>No. It is an independent educational estimate. It does not contact dealers, arrange financing, or provide legal or financial advice.</p></article>
          <article><h3>Do you store my deal?</h3><p>No. Deal inputs stay in your browser. Stripe and Link process checkout information, but PencilProof does not receive your full card number.</p></article>
          <article><h3>What should I have ready?</h3><p>Use the dealer&apos;s buyer&apos;s order, worksheet, or written quote showing price, taxes, fees, products, trade, APR, term, and payment.</p></article>
        </div>
      </section>

      <footer>
        <div className="shell footer-grid">
          <Link className="brand brand-footer" href="/"><span className="brand-mark">P</span><span>PencilProof</span></Link>
          <p>Independent educational deal analysis. Not affiliated with any dealership or lender.</p>
          <div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
        </div>
      </footer>
    </main>
  );
}
