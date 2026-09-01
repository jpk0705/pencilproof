import Link from "next/link";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";
import TrackedLink from "@/app/components/TrackedLink";

export const metadata = { title: "GAP, Service Contracts, and Dealer Add-Ons | PencilProof", description: "Learn how to review GAP, vehicle service contracts, maintenance plans, and other optional products on a car quote.", alternates: { canonical: "/guides/gap-service-contract-add-ons" } };

export default function AddOnProductsGuide() {
  return <main><SiteNav />
    <section className="page-hero shell"><div className="page-hero-copy"><p className="kicker">OPTIONAL PRODUCTS GUIDE</p><h1>Review GAP, service contracts, and add-ons one at a time.</h1><p>A bundled payment can hide what each product costs. Ask for every optional product by name, price, coverage, term, provider, and cancellation terms before deciding whether it fits your needs.</p><div className="page-actions"><TrackedLink analyticsCategory="guide_products" className="button button-primary" href="/analyze">Scan your quote free <span aria-hidden="true">→</span></TrackedLink><Link className="text-link" href="/guides/car-dealer-fees-add-ons">Review fees too <span aria-hidden="true">→</span></Link></div></div></section>
    <section className="section shell checks-grid-section" aria-labelledby="products-checklist"><div className="section-intro compact"><p className="kicker">SEPARATE THE BUNDLE</p><h2 id="products-checklist">A useful decision requires more than the monthly-payment change.</h2><p>Availability, terminology, coverage, and cancellation rights vary. Read the actual product agreement and confirm whether an item is optional before signing.</p></div><div className="check-list">
      <article><b>GAP coverage</b><p>Ask what loss it covers, exclusions, maximum benefit, term, price, and whether you already have comparable protection.</p></article><article><b>Vehicle service contract</b><p>Check covered components, deductible, repair network, exclusions, claim process, expiration, and cancellation terms.</p></article><article><b>Maintenance plan</b><p>Compare the included services, schedule, locations, time and mileage limits, and total price with paying separately.</p></article><article><b>Appearance and protection products</b><p>Request the product name, installed status, written benefit, price, and whether removal or refusal is possible.</p></article>
    </div></section>
    <section className="section route-guide-section"><div className="shell section-intro compact"><p className="kicker">ASK BEFORE SIGNING</p><h2>“Please show me the cash price and financed cost of each optional product separately.”</h2><p>Then compare the written answer with your quote and the product agreements.</p><TrackedLink analyticsCategory="guide_products_bottom" className="button button-primary" href="/analyze">Review your quote free <span aria-hidden="true">→</span></TrackedLink></div></section><SiteFooter />
  </main>;
}
