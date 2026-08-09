import type { Metadata } from "next";
import { SiteNav } from "@/app/components/SiteChrome";

export const metadata: Metadata = {
  title: "Privacy | PencilProof",
  description: "PencilProof privacy notice for quote processing, analytics, and checkout.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <SiteNav />
      <article className="legal-copy shell">
        <p className="kicker">PRIVACY</p><h1>Plain-language privacy notice.</h1><p className="legal-date">Effective July 25, 2026</p>
        <h2>The short version</h2><p>The quote-audit tool and document importer run in your web browser first. The financial figures you enter or import are used on your device to calculate the displayed results. If local extraction cannot confidently read a document, the selected file may be sent to PencilProof&apos;s secured vision importer for one-time extraction and is not intentionally stored as a user document.</p>
        <h2>Information processed</h2><p>The audit tool processes the vehicle description, prices, fees, products, trade information, loan rates, term, and payment you choose to enter. Digital documents and images are read locally in your browser first. When the local result is incomplete or ambiguous, the selected document may be sent through PencilProof&apos;s secured server-side vision importer to improve label and value matching. That service may use Google Gemini for document extraction. Avoid files containing Social Security numbers, bank details, driver&apos;s license numbers, or other unnecessary identifiers.</p>
        <h2>Representative vehicle photos</h2><p>When PencilProof recognizes a vehicle description, it may send only the detected year, make, and model to Wikimedia Commons to find a representative photo. Your quote file, prices, payment, trade, and other deal figures are not included in that photo request. Wikimedia may receive ordinary technical request information such as your IP address and browser details under the <a href="https://foundation.wikimedia.org/wiki/Policy:Privacy_policy">Wikimedia Privacy Policy</a>. The displayed photo may not match the exact trim, equipment, or color of the vehicle you are considering.</p>
        <h2>Checkout information</h2><p>If you purchase an audit, checkout is hosted by Link and Stripe. They process information such as your name, email address, billing details, payment method, location for tax purposes, and transaction information under their own privacy terms. PencilProof may receive ordinary order details such as your name, email, purchase status, amount, and transaction reference for access and support, but does not receive your full card number. See the <a href="https://link.com/privacy">Link Privacy Policy</a> and <a href="https://stripe.com/privacy">Stripe Privacy Policy</a>.</p>
        <h2>Basic site operations</h2><p>Like most hosted websites, infrastructure providers may process technical information needed to serve and secure the site, such as IP address, browser type, request time, and error logs. PencilProof does not currently use advertising cookies or sell personal information.</p>
        <h2>Your choices</h2><p>You can clear the audit tool at any time with the “Clear all” button or close the browser tab. Local deal inputs are not stored by PencilProof, and the optional vision importer is used only to process the selected document request. For checkout-data requests, use the privacy and support options provided by Link or Stripe.</p>
        <h2>Changes</h2><p>If accounts, analytics, additional server-based document processing, or additional email features are added, this notice will be updated before those features are made available. The effective date above will change.</p>
        <p className="legal-note">This notice explains the current PencilProof website and checkout flow.</p>
      </article>
    </main>
  );
}
