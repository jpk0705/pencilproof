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
          <a href="#sample-audit">Sample audit</a>
          <a href="#how-it-works">How it works</a>
          <a className="nav-cta" href={CHECKOUT_URL}>Get my audit · $39</a>
        </div>
      </nav>

      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span /> AT THE DEALERSHIP—OR SHOPPING SOON?</div>
          <h1>Know what the deal is really costing you before you sign.</h1>
          <p className="hero-lede">
            PencilProof rebuilds the payment, separates optional products from
            the vehicle, explains the finance-office language, and gives you
            the exact questions to ask while you still have leverage.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href={CHECKOUT_URL}>
              Audit my deal · $39 <Arrow />
            </a>
            <a className="button button-quiet" href="#sample-audit">See a sample audit</a>
          </div>
          <p className="hero-caution">One-time purchase. Educational estimate. Savings are not guaranteed.</p>
          <div className="proof-row" aria-label="Product highlights">
            <span><b>Dealership-insider</b> logic</span>
            <span><b>Immediate</b> browser access</span>
            <span><b>Private</b> deal inputs</span>
          </div>
        </div>

        <div className="deal-card hero-deal-card" aria-label="Sample Deal Audit preview">
          <div className="deal-card-head">
            <div>
              <p>SAMPLE DEAL AUDIT</p>
              <h2>2026 compact SUV</h2>
            </div>
            <div className="score-ring"><strong>64</strong><span>/100</span></div>
          </div>
          <div className="deal-metrics">
            <div><span>Quoted payment</span><strong>$736/mo</strong></div>
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
              <p><b>APR is 2.10 points over preapproval</b><small>The rate difference is about $3,086 over 72 months.</small></p>
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

      <section className="signal-strip" aria-label="What PencilProof checks">
        <div className="shell signal-grid">
          <div><span>01</span><b>Payment rebuild</b><small>Check the dealer math</small></div>
          <div><span>02</span><b>Product impact</b><small>See with-and-without payments</small></div>
          <div><span>03</span><b>APR cost</b><small>Measure the rate difference</small></div>
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
          </p>
          <a className="text-link" href={CHECKOUT_URL}>Get my complete audit for $39 <Arrow /></a>
        </div>
        <div className="audit-preview" aria-label="Example audit findings">
          <div className="audit-preview-head"><span>EXAMPLE FINDINGS</span><strong>What the paid audit reveals</strong></div>
          <div className="audit-finding"><span>01</span><div><b>Payment without optional products</b><p>Compare the rebuilt $742 payment with an estimated $694 payment after removing entered products.</p></div><strong>−$48/mo</strong></div>
          <div className="audit-finding"><span>02</span><div><b>Products plus estimated financing</b><p>See that $2,790 in entered products may cost roughly $3,472 when financed for the full term.</p></div><strong>$3,472</strong></div>
          <div className="audit-finding"><span>03</span><div><b>Dealer APR versus outside approval</b><p>Translate a 2.10-point rate difference into estimated dollars over the life of the loan.</p></div><strong>+$3,086</strong></div>
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
          <h2>Use it before you agree to the payment.</h2>
        </div>
        <div className="steps">
          <article>
            <span>1</span>
            <h3>Unlock the audit</h3>
            <p>Pay $39 once through secure Stripe checkout. There is no subscription or recurring charge.</p>
          </article>
          <article>
            <span>2</span>
            <h3>Enter the worksheet</h3>
            <p>Copy the selling price, taxes, products, trade, APR, term, and quoted payment from the dealer&apos;s figures.</p>
          </article>
          <article>
            <span>3</span>
            <h3>Use the action plan</h3>
            <p>Compare the rebuilt deal, understand each product, and copy the exact request for a revised buyer&apos;s order.</p>
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
              <li>Payment with and without products</li>
              <li>VSC, GAP, PPM, and add-on guidance</li>
              <li>APR and full-term cost comparison</li>
              <li>Trade-equity and payment-math checks</li>
              <li>Copy-ready dealer questions</li>
              <li>Print or save the finished review</li>
            </ul>
            <a className="button button-light" href={CHECKOUT_URL}>Audit my deal now <Arrow /></a>
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
