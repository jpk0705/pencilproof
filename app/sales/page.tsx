import type { Metadata } from "next";
import { SiteNav } from "@/app/components/SiteChrome";
import { SalesPublicGate, SalesSignInButton } from "./SalesPublicGate";
import SalesDashboard from "./SalesDashboard";

const PUBLIC_SALES_URL = "https://pencilproof.com/sales";

export const metadata: Metadata = {
  title: "PencilProof for Automotive Salespeople | Quote Review & Referrals",
  description: "Review vehicle quotes privately, explain payment details with confidence, and share tracked PencilProof links. Salesperson tools include a coach preview and referral credits.",
  alternates: { canonical: "/sales" },
  openGraph: {
    type: "website",
    url: PUBLIC_SALES_URL,
    siteName: "PencilProof",
    title: "PencilProof for Automotive Salespeople",
    description: "Review vehicle quote details, support clearer customer conversations, and share tracked referral links with PencilProof salesperson tools.",
    images: [{ url: "/pencilproof-profile-mark.png", alt: "PencilProof" }],
  },
  twitter: {
    card: "summary",
    title: "PencilProof for Automotive Salespeople",
    description: "Review vehicle quote details and share tracked referral links with PencilProof salesperson tools.",
    images: ["/pencilproof-profile-mark.png"],
  },
};

export default function SalesPage() {
  return <>
    <SalesPublicGate>
      <SiteNav />
      <main className="sales-page shell">
        <header className="sales-hero sales-hero-public"><div className="sales-hero-copy"><p className="kicker">FOR AUTOMOTIVE SALESPEOPLE</p><h1>Know the numbers before you make a promise.</h1><p>Use PencilProof to review a customer quote privately, explain the written numbers with confidence, and share a tracked link so a paid customer can earn you a $20 credit.</p><SalesSignInButton>Sign in to start</SalesSignInButton></div></header>
        <p className="sales-promo-banner"><strong>ALPHA1 launch offer:</strong> first month $1, then $20/month unless canceled. Limited to the first 100 redemptions; availability is confirmed in checkout.</p>
        <section className="sales-problem-solution" aria-labelledby="sales-public-problem-title">
          <div className="sales-story-intro"><p className="kicker">THE SALES CONVERSATION</p><h2 id="sales-public-problem-title">Turn a complicated worksheet into a clearer next conversation.</h2><p>When a customer asks what is inside the payment, a quick, private review helps you answer with the written figures in front of you.</p></div>
          <div className="sales-story-grid">
            <div className="sales-story-column sales-story-problems"><p className="sales-story-label">WITHOUT A CLEAR REVIEW</p><article><strong>Payment details are scattered</strong><span>Price, fees, products, trade equity, APR, and term may be spread across a dense worksheet.</span></article><article><strong>Don&apos;t know why the payment is different?</strong><span>It can take several trips back to the desk to retrace the math and explain what changed.</span></article><article><strong>Conversations slow down</strong><span>The customer may lose confidence while you search for the answer.</span></article><article><strong>Revised quotes restart the work</strong><span>New figures can make it hard to see what changed from the earlier worksheet.</span></article></div>
            <div className="sales-story-column sales-story-solution"><p className="sales-story-label">WITH PENCILPROOF</p><article><strong>Scan and verify the figures</strong><span>Import the written quote, correct anything that needs attention, and confirm the numbers before using them.</span></article><article><strong>Explain the deal in one view</strong><span>See payment, APR, term, fees, optional products, trade figures, and questions to verify.</span></article><article><strong>Keep the next step obvious</strong><span>Share a tracked review link or QR code while the customer is still engaged.</span></article><article><strong>Keep revisions organized</strong><span>Return to the review with updated figures and focus on what changed.</span></article></div>
          </div>
        </section>
        <section className="sales-card sales-public-benefits"><p className="kicker">WHAT YOU GET</p><h2>Useful before you go back to the desk.</h2><div className="check-list"><article><b>Private quote review</b><p>Customers review their own quote without exposing the document to you.</p></article><article><b>Tracked referrals</b><p>Share your link or QR code and receive credit when an attributed customer completes a paid audit.</p></article><article><b>Practice support</b><p>Use the free top-five coach preview, then subscribe for the complete objection playbook.</p></article></div><SalesSignInButton>Create your salesperson account</SalesSignInButton></section>
        <p className="sales-note">PencilProof is an educational quote-audit tool. It does not approve financing, negotiate with a dealership, or guarantee savings. Referral rewards never reveal a customer&apos;s quote or audit information.</p>
      </main>
    </SalesPublicGate>
    <SalesDashboard />
  </>;
}
