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
        <h2>Account and PencilProof emails</h2><p>When you create an account or provide an email address, PencilProof may send account-related messages and, for its U.S.-focused service, recurring reminders, promotions, and helpful car-buying information. These messages include an unsubscribe link. If you unsubscribe, PencilProof keeps a minimal suppression record so the address is not re-added to promotional campaigns.</p>
        <h2>Guest scans and saved audits</h2><p>Guest scan inputs and results are kept in your browser unless you use the optional vision importer. If you purchase an audit or use an active account and choose to save an audit, PencilProof stores the saved audit details, vehicle information, and related review history so you can reopen them during the stated access period. You can delete saved audits from your account when that option is available. The selected document sent to the vision importer is used for that extraction request and is not intentionally stored as a user document.</p>
        <h2>Your choices</h2><p>You can clear a guest scan at any time with the “Clear all” button or by closing the browser tab. You can review or delete saved account audits from My Audits or the salesperson dashboard. For checkout-data requests, use the privacy and support options provided by Link or Stripe.</p>
        <h2>Changes</h2><p>If the account, analytics, document-processing, or email practices change materially, this notice will be updated and the effective date above will change.</p>
        <p className="legal-note">This notice explains the current PencilProof website and checkout flow.</p>
      </article>
    </main>
  );
}
