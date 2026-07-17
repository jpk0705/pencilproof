import Link from "next/link";
import { CHECKOUT_URL } from "@/lib/checkout";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <nav className="site-nav" aria-label="Main navigation"><Link className="brand" href="/"><span className="brand-mark">P</span><span>PencilProof</span></Link><a className="nav-cta" href={CHECKOUT_URL}>Get my review · $39</a></nav>
      <article className="legal-copy shell">
        <p className="kicker">PRIVACY</p><h1>Plain-language privacy notice.</h1><p className="legal-date">Effective July 16, 2026</p>
        <h2>The short version</h2><p>The deal analyzer runs in your web browser. The financial figures you enter are used on your device to calculate the displayed results and are not intentionally sent to, or stored by, PencilProof.</p>
        <h2>Information processed</h2><p>The calculator processes the vehicle description, prices, fees, products, trade information, loan rates, term, and payment you choose to enter. Do not enter names, addresses, Social Security numbers, bank details, driver&apos;s license numbers, or other personal identifiers.</p>
        <h2>Checkout information</h2><p>If you purchase a review, checkout is hosted by Link and Stripe. They process information such as your name, email address, billing details, payment method, location for tax purposes, and transaction information under their own privacy terms. PencilProof may receive ordinary order details such as your name, email, purchase status, amount, and transaction reference for access and support, but does not receive your full card number. See the <a href="https://link.com/privacy">Link Privacy Policy</a> and <a href="https://stripe.com/privacy">Stripe Privacy Policy</a>.</p>
        <h2>Basic site operations</h2><p>Like most hosted websites, infrastructure providers may process technical information needed to serve and secure the site, such as IP address, browser type, request time, and error logs. PencilProof does not currently use advertising cookies or sell personal information.</p>
        <h2>Your choices</h2><p>You can clear the analyzer at any time with the “Clear all” button or close the browser tab. Because deal inputs are not stored by PencilProof, we cannot retrieve a past analysis. For checkout-data requests, use the privacy and support options provided by Link or Stripe.</p>
        <h2>Changes</h2><p>If accounts, analytics, document uploads, or additional email features are added, this notice will be updated before those features are made available. The effective date above will change.</p>
        <p className="legal-note">This notice explains the current PencilProof website and checkout flow.</p>
      </article>
    </main>
  );
}
