import Link from "next/link";
import { CHECKOUT_URL } from "@/lib/checkout";
import FreeQuotePreview from "@/app/components/FreeQuotePreview";

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
    short: "T&W",
    title: "Tire & wheel protection",
    copy: "May cover eligible road-hazard damage. Cosmetic coverage, deductibles, limits, and exclusions should be verified.",
  },
  {
    short: "ADD-ONS",
    title: "Accessories and other add-ons",
    copy: "Appearance, GPS, theft, etch, nitrogen, physical accessories, and other packages can raise both the amount financed and the interest you pay.",
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
          <Link href="/questions">Q&amp;A</Link>
          <a href="#pricing">Pricing</a>
          <a className="nav-cta" href="#free-scan">Scan my quote free</a>
        </div>
      </nav>

      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span /> THE DEAL MAY BE FAIR. VERIFY IT BEFORE YOU SIGN.</div>
          <h1>Stop negotiating blind. See what you&apos;re really paying for.</h1>
          <p className="hero-lede">
            Tired of hearing “Let me check with my manager,” then waiting 30 minutes?
            PencilProof turns the written quote into clear numbers so you can see the price, rate, fees, products, trade, and payment math before agreeing to anything.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#free-scan">
              Scan my quote free <Arrow />
            </a>
            <a className="button button-quiet" href="#deal-questions">See a sample audit</a>
          </div>
          <p className="hero-caution">No payment required to test your quote. Unlock the Full Quote Audit only after PencilProof shows what it found.</p>
          <div className="proof-row" aria-label="Product highlights">
            <span><b>Free quote scan</b> before checkout</span>
            <span><b>No commissions</b> from dealers</span>
            <span><b>For shoppers</b> at the dealership</span>
            <span><b>For salespeople</b> checking scenarios</span>
            <span><b>Founded by</b> a dealership professional</span>
            <span><b>Private</b> numbers stay in your browser</span>
          </div>
        </div>

        <div className="deal-card hero-deal-card" aria-label="Sample Full Quote Audit preview">
          <div className="deal-card-head">
            <div>
              <p>SAMPLE FULL QUOTE AUDIT</p>
              <h2>2026 Toyota RAV4 XLE Premium</h2>
            </div>
            <div className="sample-status"><strong>4</strong><span>areas worth reviewing</span></div>
          </div>
          <div className="deal-metrics">
            <div><span>Dealer quote</span><strong>$740/mo</strong></div>
            <div><span>Calculated payment</span><strong>$703/mo</strong></div>
            <div><span>Products financed</span><strong>$4,189</strong></div>
          </div>
          <div className="flag-list">
            <div className="flag flag-warn">
              <span className="flag-icon">!</span>
              <p><b>3 products add about $74/month</b><small>A service contract, GAP, and an appearance add-on are included in the loan.</small></p>
            </div>
            <div className="flag flag-warn">
              <span className="flag-icon">!</span>
              <p><b>Quoted payment is $36.59/month higher</b><small>Quote: $739.95. Entered figures: $703.36. Ask the dealer to explain the variance.</small></p>
            </div>
            <div className="flag flag-good">
              <span className="flag-icon">✓</span>
              <p><b>Dealer-ready response included</b><small>Ask for the exact amount financed, first-payment date, and an itemized buyer&apos;s order.</small></p>
            </div>
          </div>
          <div className="deal-card-foot">
            <span>Example based on entered figures.</span>
            <a href="#deal-questions">See what&apos;s inside <Arrow /></a>
          </div>
        </div>
      </section>

      <FreeQuotePreview />

      <section className="section founder-section">
        <div className="shell founder-layout">
          <div>
            <p className="kicker">BUILT FROM INSIDE THE BUSINESS</p>
            <h2>Created by someone who has worked the deal from three different seats.</h2>
          </div>
          <div className="founder-copy">
            <p className="founder-lede">
              PencilProof was founded by an automotive professional who has worked as a salesperson, sales manager, and finance manager.
            </p>
            <p>
              That experience exposed the same bottleneck from every side: customers wait while a change moves back and forth to the manager,
              and salespeople often cannot test a cleaner structure on their own. PencilProof turns the written figures into an understandable
              draft so both sides can discuss a specific deal structure sooner.
            </p>
            <div className="role-row" aria-label="Founder dealership experience">
              <span>Salesperson</span>
              <span>Sales manager</span>
              <span>Finance manager</span>
            </div>
            <small>Independent educational software. PencilProof is not a dealership, lender, broker, or approval system.</small>
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

      <section className="section shell sample-section" id="deal-questions">
        <div className="sample-copy">
          <p className="kicker">TRANSPARENCY IS THE SOLUTION</p>
          <h2>You shouldn&apos;t need years inside a dealership to know whether your own deal adds up.</h2>
          <p>
            PencilProof is designed for the moment you have an actual dealer
            worksheet and do not want to be confused, pressured, or taken
            advantage of. It separates the vehicle, financing, trade, fees, and
            optional products, then shows what changed and what to ask next.
          </p>
          <a className="text-link" href={CHECKOUT_URL}>Unlock My Full Quote Audit · $39 <Arrow /></a>
        </div>
        <div className="audit-preview" aria-label="Example audit findings">
          <div className="audit-preview-head"><span>EXAMPLE FINDINGS</span><strong>What the Full Quote Audit reveals</strong></div>
          <div className="audit-finding"><span>01</span><div><b>Quoted payment versus calculated payment</b><p>Compare the dealer&apos;s $739.95 quote with the $703.36 payment calculated from the entered figures.</p></div><strong>+$36.59/mo</strong></div>
          <div className="audit-finding"><span>02</span><div><b>Products plus estimated financing</b><p>See that $4,189 in entered products may cost roughly $5,361 when financed for the full term.</p></div><strong>$5,361</strong></div>
          <div className="audit-finding"><span>03</span><div><b>Amount financed rebuilt</b><p>See how the vehicle, tax, fees, products, and cash down produce the estimated loan balance.</p></div><strong>$39,574</strong></div>
          <div className="audit-unlock">
            <span>THE FULL QUOTE AUDIT ALSO INCLUDES</span>
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
          <p className="kicker">SEE PROOF BEFORE CHECKOUT</p>
          <h2>Know PencilProof can read your deal before you pay.</h2>
        </div>
        <div className="steps">
          <article>
            <span>1</span>
            <h3>Upload the quote free</h3>
            <p>Scan a dealer PDF or photo in your browser. No payment is required to see what PencilProof can detect.</p>
          </article>
          <article>
            <span>2</span>
            <h3>Check every imported number</h3>
            <p>Compare the detected values with the original quote. Checkout stays locked until you confirm that you reviewed the import.</p>
          </article>
          <article>
            <span>3</span>
            <h3>Unlock the complete solution</h3>
            <p>Pay once to see exact differences, compare scenarios, change products or terms, and create a specific request for a revised buyer&apos;s order.</p>
          </article>
        </div>
      </section>

      <section className="section dark-section" id="pricing">
        <div className="shell offer-grid">
          <div>
            <p className="kicker kicker-light">ONE-TIME FULL QUOTE AUDIT</p>
            <h2>See that it works first. Then decide if the $39 Full Quote Audit is worth it.</h2>
            <p className="offer-copy">
              The goal is not to scare you out of a product or a deal. It is to
              make the cost visible, explain the terms, and help you ask better
              questions before you sign.
            </p>
          </div>
          <div className="price-card">
            <div className="price-line"><span>Full Quote Audit</span><strong>$39</strong></div>
            <ul>
              <li>Private PDF and photo autofill</li>
              <li>Required import confirmation before the audit</li>
              <li>Multi-option finance and lease menu detection</li>
              <li>Payment with and without products</li>
              <li>VSC, GAP, PPM, and add-on guidance</li>
              <li>APR and full-term cost comparison</li>
              <li>Trade-equity and payment-math checks</li>
              <li>Copy-ready dealer questions</li>
              <li>Print or save the finished audit</li>
            </ul>
            <a className="button button-light" href={CHECKOUT_URL}>Unlock My Full Quote Audit · $39 <Arrow /></a>
            <small>One-time payment. Educational estimate. No guaranteed savings. If your quote cannot be processed, use the support options on your receipt for help or a refund review.</small>
          </div>
        </div>
      </section>

      <footer>
        <div className="shell footer-grid">
          <Link className="brand brand-footer" href="/"><span className="brand-mark">P</span><span>PencilProof</span></Link>
          <p>Independent educational quote audit. Not affiliated with any dealership or lender.</p>
          <div><Link href="/questions">Q&amp;A</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href="mailto:support@pencilproof.com">Contact us</a></div>
        </div>
      </footer>
    </main>
  );
}
