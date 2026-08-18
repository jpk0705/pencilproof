import type { Metadata } from "next";
import { SiteFooter, SiteNav } from "@/app/components/SiteChrome";

export const metadata: Metadata = {
  title: "Questions & Answers | PencilProof",
  description: "Straight answers about PencilProof quote audits, quote imports, payment calculations, privacy, and what to verify before signing.",
  alternates: { canonical: "/questions" },
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
    answer: "No. It can autofill recognizable text from many digital or scanned PDFs and clear image files. Blurry, cropped, handwritten, password-protected, or unusually formatted documents may require manual entry.",
  },
  {
    question: "What if an imported number is wrong?",
    answer: "Do not pay from the free preview. Try a clearer copy or plan to enter the missing figure manually. PencilProof rejects weak scans, labels every detected value, locks preview checkout until you confirm that you reviewed the import, and requires confirmation again before the audit.",
  },
  {
    question: "Can it compare a quote with several payment choices?",
    answer: "Yes. When PencilProof recognizes an option matrix, it shows the detected finance rows so you can select the one you are considering. Always compare imported values with the original document.",
  },
  {
    question: "Does a counter proposal guarantee a better deal?",
    answer: "No. It turns the figures you entered into a clear request for the dealer to review. The dealer and lender must confirm the final price, APR, term, products, and payment in an official written quote.",
  },
  {
    question: "Who created PencilProof?",
    answer: "It was founded by an automotive professional with experience as a salesperson, sales manager, and finance manager. PencilProof remains independent and is not affiliated with a dealership or lender.",
  },
  {
    question: "Is this a dealership desking or lender-approval system?",
    answer: "No. PencilProof models the figures you enter or import. It cannot authorize a discount, access lender programs, approve credit, or replace the dealership's official buyer's order or written quote.",
  },
  {
    question: "Does PencilProof negotiate or provide advice?",
    answer: "No. It is an independent educational estimate. It does not contact dealers, arrange financing, or provide legal or financial advice.",
  },
  {
    question: "Do you store my deal?",
    answer: "Guest scan inputs are kept in your browser for the free review. If you purchase an audit or use an active account, the audit details you save may be stored in your PencilProof account for the stated access period. Stripe and Link process checkout information, but PencilProof does not receive your full card number.",
  },
  {
    question: "What should I have ready?",
    answer: "Use the dealer's buyer's order, worksheet, or written quote showing price, taxes, fees, products, trade, APR, term, and payment.",
  },
];

export default function QuestionsPage() {
  return (
    <main className="questions-page">
      <SiteNav />

      <section className="section shell faq-section">
        <div className="section-intro compact">
          <p className="kicker">STRAIGHT ANSWERS</p>
          <h1>Know what you&apos;re buying before you sign.</h1>
          <p>Clear answers about quote imports, payment math, privacy, the Full Quote Audit, and what still needs to be verified with the dealership.</p>
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

      <SiteFooter />
    </main>
  );
}
