import Link from "next/link";
import { CHECKOUT_URL } from "@/lib/checkout";

export function SiteNav() {
  return (
    <nav className="site-nav" aria-label="Main navigation">
      <Link className="brand" href="/" aria-label="PencilProof home">
        <span className="brand-mark">P</span>
        <span>PencilProof</span>
      </Link>
      <div className="nav-links">
        <Link href="/who-it-helps">Who it helps</Link>
        <Link href="/how-it-works">How it works</Link>
        <Link href="/what-it-checks">What it checks</Link>
        <Link href="/questions">Q&amp;A</Link>
        <Link href="/pricing">Pricing</Link>
        <Link className="nav-cta" href="/#free-scan">Scan my quote free</Link>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <div className="shell footer-grid">
        <Link className="brand brand-footer" href="/">
          <span className="brand-mark">P</span>
          <span>PencilProof</span>
        </Link>
        <p>Independent educational quote audit. Not affiliated with any dealership or lender.</p>
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
      Unlock the Full Quote Audit · $39 <span aria-hidden="true">→</span>
    </Link>
  );
}
