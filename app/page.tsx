import Link from "next/link";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";

const Arrow = () => <span aria-hidden="true">→</span>;

export default function Home() {
  return (
    <main>
      <SiteNav />

      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span /> PRIVACY-FIRST FULL QUOTE AUDIT FOR CAR BUYERS</div>
          <h1>Understand the numbers before you sign.</h1>
          <p className="hero-lede">
            PencilProof helps you review the quote you were handed—starting with the
            math, not the pressure. See the price, APR, fees, products, trade, and
            payment in one calm, readable audit.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/analyze">
              Review your quote free <Arrow />
            </Link>
            <Link className="text-link" href="/who-it-helps">Who it helps <Arrow /></Link>
          </div>
          <p className="hero-caution">No payment required to review the scan. Your document is read locally first, and you decide whether the complete audit is useful.</p>
          <div className="proof-row" aria-label="Product highlights">
            <span><b>Free scan first</b> before checkout</span>
            <span><b>No dealership affiliation</b> independent education</span>
            <span><b>One-time audit</b> no recurring subscription</span>
            <span><b>Private by design</b> local reading first</span>
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
            <Link href="/how-it-works#sample-audit">See what&apos;s inside <Arrow /></Link>
          </div>
        </div>
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

      <SiteFooter />
    </main>
  );
}
