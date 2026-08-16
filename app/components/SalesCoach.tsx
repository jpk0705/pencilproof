"use client";

import { useMemo, useState } from "react";

const suggestions = [
  "Payment is too high",
  "Why did the payment change?",
  "What should I ask about add-ons?",
  "Customer wants to think about it",
];

const respond = (prompt: string) => {
  const text = prompt.toLowerCase();
  if (text.includes("payment") && (text.includes("high") || text.includes("expensive"))) {
    return "A calm response: “I understand. Let’s separate the vehicle price, APR, term, trade figures, and optional products so we can see what is driving the payment. Which part would you like to review first?”";
  }
  if (text.includes("change") || text.includes("different") || text.includes("variance")) {
    return "Try: “Let’s compare the two worksheets line by line. We should verify the selling price, fees, products, cash down, trade payoff, APR, term, and payment before we decide what changed.”";
  }
  if (text.includes("add-on") || text.includes("product") || text.includes("gap") || text.includes("vsc")) {
    return "Ask: “Which products are optional, what does each one cost, and what would the payment be without them?” Keep the conversation focused on the written figures and the customer’s choice.";
  }
  if (text.includes("think") || text.includes("later") || text.includes("wait")) {
    return "Try: “Of course. Before you go, let’s make sure you have the figures and the questions you want answered. Is there one part of the quote that is still unclear?”";
  }
  return "Start with the customer’s concern, then make one number or decision easier to understand. Ask what they want verified, show the written figures, and avoid promising an outcome you cannot support.";
};

export default function SalesCoach() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([{ role: "coach", text: "Practice a customer objection or ask how to explain a quote. This private coach does not contact customers." }]);
  const lastMessage = useMemo(() => messages[messages.length - 1], [messages]);

  const ask = (value = prompt) => {
    const question = value.trim();
    if (!question) return;
    setMessages((current) => [...current, { role: "you", text: question }, { role: "coach", text: respond(question) }]);
    setPrompt("");
  };

  return <div className={`sales-coach ${open ? "is-open" : ""}`}>
    {open ? <section id="sales-coach-panel" className="sales-coach-panel" aria-label="PencilProof sales coach">
      <div className="sales-coach-head"><div><p className="kicker">PRIVATE PRACTICE</p><h2>Sales coach</h2></div><button className="sales-coach-close" type="button" onClick={() => setOpen(false)} aria-label="Close sales coach">×</button></div>
      <p className="sales-coach-note">Practice closing language and objection handling. Nothing here is sent to a customer.</p>
      <div className="sales-coach-messages" aria-live="polite">{messages.slice(-4).map((message, index) => <p className={`sales-coach-message ${message.role}`} key={`${message.role}-${index}`}>{message.text}</p>)}</div>
      <div className="sales-coach-suggestions">{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => ask(suggestion)}>{suggestion}</button>)}</div>
      <form className="sales-coach-form" onSubmit={(event) => { event.preventDefault(); ask(); }}><input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask about an objection…" aria-label="Ask the sales coach" /><button className="button button-primary" type="submit">Ask</button></form>
      {lastMessage.role === "coach" ? <small className="sales-coach-footer">Keep the customer’s choice and the written numbers at the center.</small> : null}
    </section> : null}
    <button className="sales-coach-toggle" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-controls="sales-coach-panel"><span aria-hidden="true">✦</span>{open ? "Close coach" : "Practice with sales coach"}</button>
  </div>;
}
