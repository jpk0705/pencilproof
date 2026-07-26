import Link from "next/link";
import type { Metadata } from "next";
import { CHECKOUT_URL } from "@/lib/checkout";

export const metadata: Metadata = {
  title: "Questions & Answers | PencilProof",
  description: "Straight answers about PencilProof quote audits, quote imports, payment calculations, privacy, and what to verify before signing.",
};

const questions = [
  {
    question: "Is this just a payment calculator?",
    answer: "No. It rebuilds the payment, separates entered products, explains common finance-office products, measures APR and trade impact, and creates an action plan.",
  },
  {
    question: "Does PencilProof guarantee savings?",
    answer: "No. It may identify costs worth questioning, but actual savings depend on the deal, lender, products, dealer, and choices you make.",
  },
  {
    question: "Can I update the deal after the dealer responds?",
    answer: "Yes. Change the inputs to compare a revised worksheet, then print or save the updated audit before signing.",
  },
  {
    question: "Can PencilProof read every document?",
    answer: "No. It can autofill recognizable text from many digital or scanned PDFs and clear JPG/JPEG/PNG images. Blurry, cropped, handwritten, password-protected, or unusually formatted documents may require manual entry.",
  },
  {
    question: "What if an imported number is wrong?",
    answer: "Do not pay from the free preview. Try a clearer copy or plan to enter the missing figure manually. PencilProof rejects weak scans, labels every detected value, locks preview checkout until you confirm that you reviewed the import, and requires confirmation again before the audit.",
  },
  {
    question: "Can it compare a quote with several payment choices?",
    answer: "Yes. When PencilProof recognizes an option matrix, it shows the detected finance and lease rows so you can select the one you are considering. Always compare imported values with the original document.",
  },
  {
    question: "Does a desired APR mean I am approved?",
    answer: "No. It is a what-if scenario showing the payment at a rate you choose. Only a lender can approve an APR and final loan terms.",
  },
  {
    question: "Who created PencilProof?",
    answer: "It was founded by an automotive professional with experience as a salesperson, sales manager, and finance manager. PencilProof remains independent and is not affiliated with a dealership or lender.",
  },
  {
    question: "Is this a dealership desking or lender-approval system?",
    answer: "No. PencilProof models the figures you enter or import. It cannot authorize a discount, access lender programs, approve credit, or replace the dealership's official buyer's order or lease worksheet.",
  },
  {
    question: "Does PencilProof negotiate or provide advice?",
    answer: "No. It is an independent educational estimate. It does not contact dealers, arrange financing, or provide legal or financial advice.",
  },
  {
    question: "Do you store my deal?",
    answer: "No. Deal inputs stay in your browser. Stripe and Link process checkout information, but PencilProof does not receive your full card number.",
  },
  {
    question: "What should I have ready?",
    answer: "Use the dealer's buyer's order, worksheet, or written quote showing price, taxes, fees, products, trade, APR, term, and payment.",
  },
];

export default function QuestionsPage() {
  return (
    <main className="questions-page">
      <nav className="site-nav" aria-label="Main navigation">
        <Link className="brand" href="/" aria-label="PencilProof home">
          <span className="brand-mark">P</span>
          <span>PencilProof</span>
        </Link>
        <div className="nav-links">
          <Link href="/">Home</Link>
          <Link href="/#pricing">Pricing</Link>
          <a className="nav-cta" href={CHECKOUT_URL}>Full Quote Audit · $39</a>
        </div>
      </nav>

      <section className="section shell faq-section">
        <div className="section-intro compact">
          <p className="kicker">STRAIGHT ANSWERS</p>
          <h1>Know what you&apos;re buying.</h1>
          <p>Clear answers about what PencilProof does, how quote imports work, and what to verify before you pay or sign.</p>
        </div>
        <div className="faq-grid">
          {questions.map(({ question, answer }) => (
            <article key={question}>
              <h2>{question}</h2>
              <p>{answer}</p>
            </article>
          ))}
        </div>
      </section>

      <footer>
        <div className="shell footer-grid">
          <Link className="brand brand-footer" href="/"><span className="brand-mark">P</span><span>PencilProof</span></Link>
          <p>Independent educational quote audit. Not affiliated with any dealership or lender.</p>
          <div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
        </div>
      </footer>
    </main>
  );
}
