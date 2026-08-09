import Link from "next/link";
import { CHECKOUT_URL } from "@/lib/checkout";

export function SiteNav() {
  return (
    <nav className="site-nav" aria-label="Main navigation">
      <Link className="brand" href="/" aria-label="PencilProof home">
        <img className="brand-logo" src="/pencilproof-profile-mark.png" alt="" width="40" height="40" />
        <span>PencilProof</span>
      </Link>
      <div className="nav-links">
        <Link href="/who-it-helps">Who it helps</Link>
        <Link href="/how-it-works">How it works</Link>
        <Link href="/what-it-checks">What it checks</Link>
        <Link href="/questions">Q&amp;A</Link>
        <Link href="/pricing">Pricing</Link>
        <Link className="nav-cta" href="/#free-scan">Review your quote</Link>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <div className="shell footer-grid">
        <Link className="brand brand-footer" href="/">
          <img className="brand-logo" src="/pencilproof-profile-mark.png" alt="" width="40" height="40" />
          <span>PencilProof</span>
        </Link>
        <p className="footer-disclaimer">PencilProof is an educational quote-audit tool. It is not a dealership, lender, broker, law firm, financial adviser, or negotiation service.</p>
        <div>
          <Link href="/who-it-helps">Who it helps</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/what-it-checks">What it checks</Link>
          <Link href="/questions">Q&amp;A</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="mailto:support@pencilproof.com">Contact us</a>
        </div>
      </div>
    </footer>
  );
}

export function AuditCta({ light = false }: { light?: boolean }) {
  return (
    <Link className={`button ${light ? "button-light" : "button-primary"}`} href={CHECKOUT_URL}>
      Review the Full Quote Audit · $39 <span aria-hidden="true">→</span>
    </Link>
  );
}
