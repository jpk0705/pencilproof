import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <nav className="site-nav" aria-label="Main navigation"><Link className="brand" href="/"><span className="brand-mark">P</span><span>PencilProof</span></Link><Link className="nav-cta" href="/analyze">Check my deal</Link></nav>
      <article className="legal-copy shell">
        <p className="kicker">PRIVACY</p><h1>Plain-language privacy notice.</h1><p className="legal-date">Beta version · July 16, 2026</p>
        <h2>The short version</h2><p>The beta deal calculator runs in your web browser. The financial figures you enter are used on your device to calculate the displayed results and are not intentionally sent to, or stored by, PencilProof.</p>
        <h2>Information processed</h2><p>The calculator processes the vehicle description, prices, fees, products, trade information, loan rates, term, and payment you choose to enter. Do not enter names, addresses, Social Security numbers, bank details, driver&apos;s license numbers, or other personal identifiers.</p>
        <h2>Basic site operations</h2><p>Like most hosted websites, infrastructure providers may process technical information needed to serve and secure the site, such as IP address, browser type, request time, and error logs. PencilProof does not currently use advertising cookies or sell personal information.</p>
        <h2>Future changes</h2><p>If accounts, payments, analytics, document uploads, or email features are added, this notice will be updated before those features are made available. The effective date above will change.</p>
        <h2>Your choices</h2><p>You can clear the calculator at any time with the “Clear all” button or close the browser tab. Because beta deal inputs are not stored by PencilProof, we cannot retrieve a past analysis.</p>
        <p className="legal-note">This notice describes the current beta. It should be reviewed by qualified counsel before a commercial launch.</p>
      </article>
    </main>
  );
}
