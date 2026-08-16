"use client";

import { useMemo, useState } from "react";

type Objection = {
  category: string;
  question: string;
  keywords: string[];
  responses: string[];
};

const objections: Objection[] = [
  {
    category: "Readiness",
    question: "I’m not ready yet.",
    keywords: ["not ready", "not buying", "not today", "just looking", "researching", "think"],
    responses: [
      "I understand. What would need to happen before you feel ready?",
      "No pressure. Is the hesitation about the vehicle, the numbers, the trade, financing, or timing?",
      "If we found the right vehicle and the written numbers made sense, would you be comfortable moving forward today?",
    ],
  },
  {
    category: "Payment",
    question: "The payment is too high.",
    keywords: ["payment", "monthly", "month", "500", "afford"],
    responses: [
      "I understand. Is the payment the only thing preventing you from moving forward?",
      "What payment would be comfortable for your household?",
      "There are four variables we can review: vehicle price, down payment, term, and trade position. Which one makes the most sense to adjust?",
    ],
  },
  {
    category: "Price",
    question: "Your price is too high.",
    keywords: ["price", "expensive", "cost", "best price", "lowest", "discount", "off"],
    responses: [
      "I understand. Is it too high compared with another vehicle or compared with what you planned to spend?",
      "What number were you expecting?",
      "If we solve the budget issue, is this the vehicle you want?",
    ],
  },
  {
    category: "Comparison",
    question: "Another dealer is cheaper.",
    keywords: ["another dealer", "other dealer", "cheaper", "elsewhere", "match", "quote", "shop"],
    responses: [
      "Do you have their written quote so we can compare it line by line?",
      "Is it the identical year, trim, equipment, mileage, fees, and availability?",
      "If the offers are genuinely identical, give us the opportunity to see whether we can earn your business.",
    ],
  },
  {
    category: "Decision timing",
    question: "I need to think about it.",
    keywords: ["think", "later", "wait", "decide", "sleep on it", "call you"],
    responses: [
      "Of course. What specifically would you like to think through?",
      "Other than that, is there anything else preventing you from moving forward?",
      "Before you go, let’s make sure you have the figures and the one question you still need answered.",
    ],
  },
];

const fallbackResponse = "Start with the customer’s concern, then make one number or decision easier to understand. Acknowledge it, clarify it, isolate the real issue, and only then ask whether solving it would make sense to move forward.";

const findObjection = (prompt: string) => {
  const text = prompt.toLowerCase();
  return objections.find((objection) => objection.keywords.some((keyword) => text.includes(keyword))) ?? null;
};

const shuffled = (items: string[]) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
};

const respond = (prompt: string) => {
  const objection = findObjection(prompt);
  if (!objection) return { category: "General practice", text: fallbackResponse };
  const [first, ...rest] = shuffled(objection.responses);
  return {
    category: `${objection.category} · randomized response`,
    text: `${first}\n\nTry another approach when you practice: ${rest[0]}`,
  };
};

export default function SalesCoach() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([
    { role: "coach", text: "Choose one of the five common objections below, or type a customer objection to practice. Each topic has three saved responses and rotates the order for practice." },
  ]);
  const lastMessage = useMemo(() => messages[messages.length - 1], [messages]);

  const ask = (value = prompt) => {
    const question = value.trim();
    if (!question) return;
    const response = respond(question);
    setMessages((current) => [
      ...current,
      { role: "you", text: question },
      { role: "coach", text: `${response.category}\n${response.text}` },
    ]);
    setPrompt("");
  };

  return <div className={`sales-coach ${open ? "is-open" : ""}`}>
    {open ? <section id="sales-coach-panel" className="sales-coach-panel" aria-label="PencilProof sales coach">
      <div className="sales-coach-head"><div><p className="kicker">PRIVATE PRACTICE</p><h2>Sales coach</h2></div><button className="sales-coach-close" type="button" onClick={() => setOpen(false)} aria-label="Close sales coach">×</button></div>
      <p className="sales-coach-note">Five common dealership objections. Pick a category or type your own wording. Nothing here is sent to a customer.</p>
      <div className="sales-coach-messages" aria-live="polite">{messages.slice(-4).map((message, index) => <p className={`sales-coach-message ${message.role}`} key={`${message.role}-${index}`}>{message.text}</p>)}</div>
      <p className="sales-coach-section-label">TOP 5 OBJECTIONS</p>
      <div className="sales-coach-suggestions">{objections.map((objection) => <button type="button" key={objection.question} onClick={() => ask(objection.question)}><small>{objection.category}</small>{objection.question}</button>)}</div>
      <form className="sales-coach-form" onSubmit={(event) => { event.preventDefault(); ask(); }}><input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask about an objection…" aria-label="Ask the sales coach" /><button className="button button-primary" type="submit">Ask</button></form>
      {lastMessage.role === "coach" ? <small className="sales-coach-footer">A.C.I.C.: acknowledge → clarify → isolate → close conditionally. Keep the customer’s choice and the written numbers at the center.</small> : null}
    </section> : null}
    <button className="sales-coach-toggle" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-controls="sales-coach-panel"><span aria-hidden="true">✦</span>{open ? "Close coach" : "Practice with sales coach"}</button>
  </div>;
}
