"use client";

import { useMemo, useState } from "react";

type Objection = {
  category: string;
  question: string;
  keywords: string[];
  responses: string[];
};

type CoachMessage = {
  role: "coach" | "you";
  text: string;
};

type SalesCoachProps = {
  unlocked?: boolean;
  playbook?: string | null;
  onSubscribe?: () => void;
};

const previewObjections: Objection[] = [
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

const cleanPlaybookLine = (line: string) => line
  .replace(/^>\s?/, "")
  .replace(/^\*\*|\*\*$/g, "")
  .trim();

const keywordsFor = (question: string) => question
  .toLowerCase()
  .replace(/[“”"!?.,/]/g, "")
  .split(/\s+/)
  .filter((word) => word.length > 3 && !["what", "this", "that", "with", "your", "need", "want", "have", "will", "from", "about", "just", "only", "dont", "doesnt"].includes(word));

const parsePlaybook = (source: string): Objection[] => {
  const entries: Objection[] = [];
  let category = "General practice";
  let current: Objection | null = null;

  const commit = () => {
    if (current && current.responses.length > 0) entries.push(current);
    current = null;
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    const categoryMatch = line.match(/^#\s+[A-Z]\.\s+(.+)$/);
    if (categoryMatch) {
      commit();
      category = categoryMatch[1].trim();
      continue;
    }
    const questionMatch = line.match(/^###\s+\d+\.\s+(.+)$/);
    if (questionMatch) {
      commit();
      const question = cleanPlaybookLine(questionMatch[1]);
      current = { category, question, keywords: keywordsFor(question), responses: [] };
      continue;
    }
    if (!current || !line || line === "---" || line.startsWith("**Answer") || line.startsWith("**This ")) continue;
    if (line.startsWith("“") || line.startsWith('"')) {
      const response = cleanPlaybookLine(line);
      if (response) current.responses.push(response);
    }
  }
  commit();
  return entries.filter((entry) => entry.responses.length > 0);
};

const findObjection = (prompt: string, source: Objection[]) => {
  const text = prompt.toLowerCase();
  return source.find((objection) => objection.keywords.some((keyword) => text.includes(keyword))) ?? null;
};

const shuffled = (items: string[]) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
};

const respond = (prompt: string, source: Objection[], unlocked: boolean) => {
  const objection = findObjection(prompt, source);
  if (!objection) {
    return unlocked
      ? { category: "General practice", text: fallbackResponse, allResponses: [] }
      : { category: "More practice available", text: "That question is outside the five free preview topics. Subscribe for more categories, saved answers, and the complete coaching playbook.", allResponses: [] };
  }
  const ordered = shuffled(objection.responses);
  return {
    category: objection.category,
    text: ordered[0],
    allResponses: ordered,
  };
};

export default function SalesCoach({ unlocked = false, playbook = null, onSubscribe }: SalesCoachProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [librarySearch, setLibrarySearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [showAllResponses, setShowAllResponses] = useState(false);
  const [lastAnswers, setLastAnswers] = useState<string[]>([]);
  const [messages, setMessages] = useState<CoachMessage[]>([
    { role: "coach", text: "Choose one of the five common objections below, or type a customer objection to practice. Each topic has three saved responses and rotates the order for practice." },
  ]);
  const fullObjections = useMemo(() => unlocked && playbook ? parsePlaybook(playbook) : [], [playbook, unlocked]);
  const practiceObjections = unlocked && fullObjections.length > 0 ? fullObjections : previewObjections;
  const categories = useMemo(() => ["All categories", ...Array.from(new Set(fullObjections.map((objection) => objection.category)))], [fullObjections]);
  const filteredObjections = useMemo(() => {
    const query = librarySearch.trim().toLowerCase();
    return fullObjections.filter((objection) => {
      const categoryMatch = categoryFilter === "All categories" || objection.category === categoryFilter;
      const searchMatch = !query || (objection.question + " " + objection.category + " " + objection.responses.join(" ")).toLowerCase().includes(query);
      return categoryMatch && searchMatch;
    });
  }, [categoryFilter, fullObjections, librarySearch]);
  const lastMessage = useMemo(() => messages[messages.length - 1], [messages]);

  const ask = (value = prompt) => {
    const question = value.trim();
    if (!question) return;
    const response = respond(question, practiceObjections, unlocked);
    setLastAnswers(response.allResponses);
    setShowAllResponses(false);
    setMessages((current) => [
      ...current,
      { role: "you", text: question },
      { role: "coach", text: response.category + "\n" + response.text },
    ]);
    setPrompt("");
  };

  return <div className={"sales-coach " + (open ? "is-open" : "")}>
    {open ? <section id="sales-coach-panel" className="sales-coach-panel" aria-label="PencilProof sales coach">
      <div className="sales-coach-head"><div><p className="kicker">PRIVATE PRACTICE</p><h2>Sales coach</h2></div><button className="sales-coach-close" type="button" onClick={() => setOpen(false)} aria-label="Close sales coach">×</button></div>
      <p className="sales-coach-note">{unlocked ? "Full subscriber library: browse every category, search the complete playbook, and practice all saved responses privately." : "Free preview: five common dealership objections. Use this when you’re stuck, then subscribe to unlock the complete categorized playbook."}</p>
      <div className="sales-coach-messages" aria-live="polite">{messages.slice(-4).map((message, index) => <p className={"sales-coach-message " + message.role} key={message.role + "-" + index}>{message.text}</p>)}</div>
      {unlocked && lastAnswers.length > 0 ? <div className="sales-coach-response-actions"><button className="button button-quiet" type="button" onClick={() => setShowAllResponses((current) => !current)}>{showAllResponses ? "Hide saved responses" : "Show all " + lastAnswers.length + " saved responses"}</button>{showAllResponses ? <div className="sales-coach-all-responses">{lastAnswers.map((answer, index) => <p key={"answer-" + index}><b>Approach {index + 1}</b>{answer}</p>)}</div> : null}</div> : null}
      <p className="sales-coach-section-label">TOP 5 QUICK PRACTICE</p>
      <div className="sales-coach-suggestions">{previewObjections.map((objection) => <button type="button" key={objection.question} onClick={() => ask(objection.question)}><small>{objection.category}</small>{objection.question}</button>)}</div>
      {unlocked ? <><p className="sales-coach-section-label">FULL PLAYBOOK · {fullObjections.length} OBJECTIONS</p><div className="sales-coach-library-controls"><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter playbook category">{categories.map((category) => <option key={category}>{category}</option>)}</select><input value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="Search objections…" aria-label="Search full playbook" /></div><div className="sales-coach-library">{filteredObjections.map((objection) => <button type="button" key={objection.category + "-" + objection.question} onClick={() => ask(objection.question)}><small>{objection.category}</small>{objection.question}</button>)}</div>{playbook ? <details className="sales-coach-reference"><summary>Open complete coaching reference</summary><pre>{playbook}</pre></details> : null}</> : <div className="sales-coach-upgrade"><strong>Use this when you’re stuck.</strong><p>Subscribe to unlock the full categorized objection playbook, every saved answer, and the complete coaching reference.</p><button className="button button-primary" type="button" onClick={onSubscribe} disabled={!onSubscribe}>Go to secure checkout</button></div>}
      <form className="sales-coach-form" onSubmit={(event) => { event.preventDefault(); ask(); }}><input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask about an objection…" aria-label="Ask the sales coach" /><button className="button button-primary" type="submit">Ask</button></form>
      {lastMessage.role === "coach" ? <small className="sales-coach-footer">A.C.I.C.: acknowledge → clarify → isolate → close conditionally. Keep the customer’s choice and the written numbers at the center.</small> : null}
    </section> : null}
    <button className="sales-coach-toggle" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-controls="sales-coach-panel"><span aria-hidden="true">✦</span>{open ? "Close coach" : "Practice with sales coach"}</button>
  </div>;
}
