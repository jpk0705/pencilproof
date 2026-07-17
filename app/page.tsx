import Link from "next/link";
import { CHECKOUT_URL } from "@/lib/checkout";

const Arrow = () => <span aria-hidden="true">→</span>;

export default function Home() {
  return (
    <main>
      <nav className="site-nav" aria-label="Main navigation">
        <Link className="brand" href="/" aria-label="PencilProof home">
          <span className="brand-mark">P</span>
          <span>PencilProof</span>
        </Link>
        <div className="nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
          <a className="nav-cta" href={CHECKOUT_URL}>Get my review · $39</a>
        </div>
      </nav>

      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span /> Built by a dealership insider</div>
          <h1>See the deal the way a desk manager does.</h1>
          <p className="hero-lede">
            Enter the numbers from your dealer quote. PencilProof checks the
            payment math, financing, fees, add-ons, and trade equity—then gives
            you a clean list of what to question before you sign.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href={CHECKOUT_URL}>
              Get my deal review <Arrow />
            </a>
            <a className="button button-quiet" href="#how-it-works">See how it works</a>
          </div>
          <div className="proof-row" aria-label="Product highlights">
            <span><b>Instant access</b> after secure checkout</span>
            <span><b>Private</b> numbers stay in your browser</span>
            <span><b>No commissions</b> from dealers</span>
          </div>
        </div>

        <div className="deal-card" id="sample" aria-label="Sample deal analysis">
          <div className="deal-card-head">
            <div>
              <p>DEAL SNAPSHOT</p>
              <h2>2026 compact SUV</h2>
            </div>
            <div className="score-ring"><strong>72</strong><span>/100</span></div>
          </div>
          <div className="deal-metrics">
            <div><span>Vehicle price</span><strong>$38,450</strong></div>
            <div><span>Amount financed</span><strong>$42,016</strong></div>
            <div><span>Quoted payment</span><strong>$726/mo</strong></div>
          </div>
          <div className="flag-list">
            <div className="flag flag-warn">
              <span className="flag-icon">!</span>
              <p><b>$1,895 in optional add-ons</b><small>Ask for an itemized, no-products quote.</small></p>
            </div>
            <div className="flag flag-warn">
              <span className="flag-icon">!</span>
              <p><b>APR is 2.1 points over preapproval</b><small>That difference costs about $3,022.</small></p>
            </div>
            <div className="flag flag-good">
              <span className="flag-icon">✓</span>
              <p><b>Payment math checks out</b><small>The quoted payment is within $1 of the inputs.</small></p>
            </div>
          </div>
          <div className="deal-card-foot">
            <span>Clear numbers. No scare tactics.</span>
            <a href={CHECKOUT_URL}>Review my deal <Arrow /></a>
          </div>
        </div>
      </section>

      <section className="signal-strip" aria-label="What PencilProof checks">
        <div className="shell signal-grid">
          <div><span>01</span><b>Payment math</b><small>Catch quote mismatches</small></div>
          <div><span>02</span><b>APR impact</b><small>See the real dollar cost</small></div>
          <div><span>03</span><b>Fees & add-ons</b><small>Separate required from optional</small></div>
          <div><span>04</span><b>Trade equity</b><small>Spot hidden negative equity</small></div>
        </div>
      </section>

      <section className="section shell" id="how-it-works">
        <div className="section-intro">
          <p className="kicker">THE FIVE-MINUTE SECOND OPINION</p>
          <h2>A deal worksheet is designed for the dealership. This is designed for you.</h2>
        </div>
        <div className="steps">
          <article>
            <span>1</span>
            <h3>Start secure checkout</h3>
            <p>Pay once through Stripe and Link. There is no subscription or recurring charge.</p>
          </article>
          <article>
            <span>2</span>
            <h3>Enter the quote</h3>
            <p>Copy the price, taxes, fees, add-ons, trade, APR, term, and payment into the private analyzer.</p>
          </article>
          <article>
            <span>3</span>
            <h3>Save your action plan</h3>
            <p>See what moves the deal, then print the review and copy the exact questions for the dealership.</p>
          </article>
        </div>
      </section>

      <section className="section dark-section" id="pricing">
        <div className="shell offer-grid">
          <div>
            <p className="kicker kicker-light">ONE-TIME DEAL REVIEW</p>
            <h2>One clear review before you sign.</h2>
            <p className="offer-copy">
              Pay once, then get immediate access to the browser-based deal
              analyzer. Rebuild the quote, identify the pressure points, and
              leave with a dealer-ready action plan.
            </p>
          </div>
          <div className="price-card">
            <div className="price-line"><span>Deal review</span><strong>$39</strong></div>
            <ul>
              <li>Finance payment cross-check</li>
              <li>Add-on and fee breakdown</li>
              <li>APR comparison and total cost</li>
              <li>Copy-ready dealer questions</li>
            </ul>
            <a className="button button-light" href={CHECKOUT_URL}>Get instant access <Arrow /></a>
            <small>One-time payment. Secure checkout. No subscription.</small>
          </div>
        </div>
      </section>

      <section className="section shell faq-section">
        <div className="section-intro compact">
          <p className="kicker">STRAIGHT ANSWERS</p>
          <h2>What PencilProof does—and does not do.</h2>
        </div>
        <div className="faq-grid">
          <article><h3>Does PencilProof negotiate for me?</h3><p>No. We never contact a dealer, arrange a purchase, or act as a broker. We help you understand the numbers you already received.</p></article>
          <article><h3>Is this legal or financial advice?</h3><p>No. Results are educational estimates based on the numbers you enter. Verify final terms with the dealer and your lender.</p></article>
          <article><h3>How is the review delivered?</h3><p>After payment, you receive immediate access to the browser-based analyzer. Enter the quote, then print or save the finished review.</p></article>
          <article><h3>Do you store my deal?</h3><p>No. Deal inputs stay in your browser. Link and Stripe process checkout information, but PencilProof does not receive your full card number.</p></article>
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
