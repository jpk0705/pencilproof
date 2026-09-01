import Link from "next/link";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";

export const metadata = { title: "Car Dealer Quote Guides | PencilProof", description: "Plain-language guides for understanding car payments, dealer worksheets, amount financed, trade equity, fees, and optional products.", alternates: { canonical: "/guides" } };

const guides = [
  ["QUOTE REVIEW", "How to review a car dealer quote", "Check the written price, financing, trade, fees, products, and payment.", "/guides/dealer-quote-review"],
  ["PAYMENT", "Why is my car payment different?", "Trace changes in price, APR, term, fees, products, cash, and trade.", "/guides/car-payment-different"],
  ["FINANCING", "Why is amount financed higher than price?", "Rebuild the balance from selling price to the final amount financed.", "/guides/amount-financed-higher-than-price"],
  ["TRADE", "Negative equity explained", "See how payoff and trade allowance can affect the new financing.", "/guides/negative-equity-car-deal"],
  ["PRODUCTS", "GAP, service contracts, and add-ons", "Review each optional product separately before deciding.", "/guides/gap-service-contract-add-ons"],
  ["FEES", "Car dealer fees and add-ons", "Separate government charges, dealer fees, and optional products.", "/guides/car-dealer-fees-add-ons"],
  ["WORKSHEET", "How to read a dealer worksheet", "Find the figures that create the balance and payment.", "/guides/reading-car-dealer-worksheet"],
  ["COMPARE", "How to compare dealer quotes", "Put competing written offers on the same basis.", "/guides/compare-car-dealer-quotes"],
] as const;

export default function GuidesPage() { return <main><SiteNav />
  <section className="page-hero shell"><div className="page-hero-copy"><p className="kicker">PENCILPROOF GUIDES</p><h1>Understand the written deal before you sign.</h1><p>Use these plain-language guides to identify the numbers, ask focused questions, and compare what changed without relying on the monthly payment alone.</p><div className="page-actions"><Link className="button button-primary" href="/analyze">Review your quote free <span aria-hidden="true">→</span></Link></div></div></section>
  <section className="section route-guide-section"><div className="shell"><div className="route-guide-grid guide-grid">{guides.map(([label, title, description, href]) => <Link className="route-guide-card" href={href} key={href}><span>{label}</span><h3>{title}</h3><p>{description}</p><strong>Read guide →</strong></Link>)}</div></div></section><SiteFooter />
</main>; }
