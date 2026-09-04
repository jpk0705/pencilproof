import Link from "next/link";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";
import SampleAuditDemo from "@/app/components/SampleAuditDemo";
import SalesEntrySection from "@/app/components/SalesEntrySection";
import TrackedLink from "@/app/components/TrackedLink";

const Arrow = () => <span aria-hidden="true">→</span>;

export default function Home() {
  return (
    <main>
      <SiteNav />

      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span /> PRIVACY-FIRST FULL QUOTE AUDIT FOR CAR BUYERS</div>
          <h1>See what your dealer quote is really charging before you sign.</h1>
          <p className="hero-lede">
            Upload the written quote you already have. PencilProof checks the payment,
            APR, fees, optional products, trade, and amount financed so you can spot
            the numbers worth questioning. See the detected values free before deciding
            whether the complete Full Quote Audit is worth it.
          </p>
          <div className="hero-actions">
            <TrackedLink analyticsCategory="home_hero" className="button button-primary" href="/analyze">
              Scan my dealer quote free <Arrow />
            </TrackedLink>
            <Link className="text-link" href="/who-it-helps">Who it helps <Arrow /></Link>
          </div>
          <p className="hero-caution">No payment or account is required for the free scan. Your document is read locally first, and you decide whether the complete audit is useful.</p>
          <div className="proof-row" aria-label="Product highlights">
            <span><b>Free scan first</b> before checkout</span>
            <span><b>Top issues in one view</b> clear next questions</span>
            <span><b>One-time audit</b> no recurring subscription</span>
            <span><b>Private by design</b> local reading first</span>
          </div>
        </div>

        <SampleAuditDemo />
      </section>

      <section className="brand-value-section" aria-labelledby="brand-value-title">
        <div className="brand-value-frame shell">
          <div className="brand-value-copy">
            <p className="kicker">WHAT THE AUDIT MAKES CLEAR</p>
            <h2 id="brand-value-title">See what the monthly payment is really carrying.</h2>
            <p>
              A dealer worksheet can compress the whole deal into one number. PencilProof lays
              out the figures behind it so you can understand what is required, what is optional,
              and what to ask about before signing.
            </p>
            <div className="brand-value-grid" aria-label="What PencilProof checks">
              <div className="brand-value-item">
                <span>01</span>
                <div><strong>Price + rebates</strong><small>Selling price, discounts, fees, and amount financed.</small></div>
              </div>
              <div className="brand-value-item">
                <span>02</span>
                <div><strong>APR + term</strong><small>Rate, length of the loan, payment, and total finance cost.</small></div>
              </div>
              <div className="brand-value-item">
                <span>03</span>
                <div><strong>Optional products</strong><small>GAP, service contracts, maintenance, tire &amp; wheel, and more.</small></div>
              </div>
              <div className="brand-value-item">
                <span>04</span>
                <div><strong>Trade equity</strong><small>Trade value, payoff, negative equity, and cash down.</small></div>
              </div>
            </div>
            <Link className="text-link brand-value-link" href="/what-it-checks">See everything PencilProof checks <Arrow /></Link>
          </div>
          <div className="brand-value-art">
            <div className="brand-value-art-card">
              <span>FULL QUOTE AUDIT</span>
              <strong>Clearer figures.<br />Better questions.</strong>
              <small>Understand the deal before you sign.</small>
            </div>
          </div>
        </div>
      </section>

      <section className="section route-guide-section">
        <div className="shell">
          <div className="section-intro route-guide-intro">
            <p className="kicker">START WHERE YOU ARE</p>
            <h2>Everything you need to make the quote easier to understand.</h2>
            <p>Choose the page that answers your next question. When you are ready, upload your quote on the free scan page and see what PencilProof can read before checkout.</p>
          </div>
          <div className="route-guide-grid">
            <Link className="route-guide-card" href="/who-it-helps">
              <span>01 · WHO IT HELPS</span>
              <h3>Start with a clearer quote.</h3>
              <p>See how shoppers and salespeople can use the same written figures to ask for a clearer deal.</p>
              <strong>See who it helps <Arrow /></strong>
            </Link>
            <Link className="route-guide-card" href="/how-it-works">
              <span>02 · HOW IT WORKS</span>
              <h3>Upload first. Pay only if it helps.</h3>
              <p>Learn what happens during the free scan, what you confirm, and what the Full Quote Audit adds.</p>
              <strong>See the process <Arrow /></strong>
            </Link>
            <Link className="route-guide-card" href="/what-it-checks">
              <span>03 · WHAT IT CHECKS</span>
              <h3>Find where the money goes.</h3>
              <p>See how payment math, products, APR, fees, and trade figures affect the deal.</p>
              <strong>See the checks <Arrow /></strong>
            </Link>
            <Link className="route-guide-card route-guide-card-dark" href="/pricing">
              <span>04 · PRICING</span>
              <h3>Know exactly what you get for $39.</h3>
              <p>One payment. One complete audit. No subscription and no charge just to test the scan.</p>
              <strong>See Full Quote Audit <Arrow /></strong>
            </Link>
          </div>
        </div>
      </section>

      <SalesEntrySection />

      <section className="section route-guide-section" aria-labelledby="search-guide-title">
        <div className="shell">
          <div className="section-intro compact">
            <p className="kicker">START WITH THE QUESTION</p>
            <h2 id="search-guide-title">Clear answers for the quote questions people ask first.</h2>
            <p>Learn what to check, then bring your own written quote to the free scan when you are ready.</p>
          </div>
          <div className="route-guide-grid guide-grid">
            <Link className="route-guide-card" href="/guides/dealer-quote-review">
              <span>QUOTE REVIEW</span>
              <h3>How to review a dealer car quote.</h3>
              <p>See which numbers to compare before a monthly payment becomes the whole conversation.</p>
              <strong>Read the guide <Arrow /></strong>
            </Link>
            <Link className="route-guide-card" href="/guides/car-payment-different">
              <span>PAYMENT CLARITY</span>
              <h3>Why is the car payment different?</h3>
              <p>Trace changes to price, rate, term, products, fees, trade figures, and cash down.</p>
              <strong>See the causes <Arrow /></strong>
            </Link>
            <Link className="route-guide-card route-guide-card-dark" href="/guides/car-dealer-fees-add-ons">
              <span>FEES + PRODUCTS</span>
              <h3>What should you check in dealer add-ons?</h3>
              <p>Understand what optional products and fees can add to the amount financed.</p>
              <strong>See the checklist <Arrow /></strong>
            </Link>
            <Link className="route-guide-card" href="/guides/can-i-afford-this-car-payment">
              <span>AFFORDABILITY</span>
              <h3>Can I afford this car payment?</h3>
              <p>Test the payment against the rest of the ownership costs before the monthly number becomes the decision.</p>
              <strong>Check affordability <Arrow /></strong>
            </Link>
            <Link className="route-guide-card" href="/guides/amount-financed-vs-total-of-payments">
              <span>LOAN TOTALS</span>
              <h3>Amount financed vs. total of payments.</h3>
              <p>See why these two totals are different and what each one says about the cost of the loan.</p>
              <strong>Compare the totals <Arrow /></strong>
            </Link>
            <Link className="route-guide-card route-guide-card-dark" href="/guides/longer-car-loan-term-total-cost">
              <span>LOAN TERM</span>
              <h3>What does a longer car loan really cost?</h3>
              <p>See how a lower monthly payment can produce a larger total repayment over time.</p>
              <strong>See the term tradeoff <Arrow /></strong>
            </Link>
          </div>
          <Link className="text-link" href="/guides">Read all quote guides <Arrow /></Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
