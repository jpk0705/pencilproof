const TOPICS = [
  {
    context: "APR",
    angle: "buyer education",
    takeaway: "APR is the rate that helps explain the cost of borrowing, not just the monthly payment.",
  },
  {
    context: "loan term",
    angle: "finance lesson",
    takeaway: "A longer term can lower the monthly payment while extending the time interest is charged.",
  },
  {
    context: "amount financed",
    angle: "buyer education",
    takeaway: "The amount financed connects the vehicle price, credits, trade figures, products, taxes, fees, and cash down to the loan.",
  },
  {
    context: "add-ons",
    angle: "buyer education",
    takeaway: "Every optional product should be named, priced, and shown clearly in the amount financed or paid separately.",
  },
  {
    context: "GAP coverage",
    angle: "buyer education",
    takeaway: "GAP coverage has a specific purpose and should be evaluated separately from other protection products.",
  },
  {
    context: "vehicle service contracts",
    angle: "buyer education",
    takeaway: "A vehicle service contract has coverage terms, exclusions, deductible rules, and a price worth reviewing before signing.",
  },
  {
    context: "trade equity",
    angle: "trade-in scenario",
    takeaway: "Trade value minus payoff shows whether a trade contributes equity or requires the next loan to absorb a shortfall.",
  },
  {
    context: "negative equity",
    angle: "trade-in scenario",
    takeaway: "Negative equity should be shown as its own line so it is not mistaken for the price of the next vehicle.",
  },
  {
    context: "rebates and discounts",
    angle: "buyer education",
    takeaway: "A rebate or discount should be identified and placed on the quote so the buyer can see what it changes.",
  },
  {
    context: "payment math",
    angle: "finance lesson",
    takeaway: "Payment math makes more sense when price, amount financed, APR, term, and total of payments are viewed together.",
  },
  {
    context: "dealership story",
    angle: "realistic dealership story",
    takeaway: "A calm side-by-side quote review can turn a confusing conversation into specific questions everyone can answer.",
  },
  {
    context: "finance basics",
    angle: "finance lesson",
    takeaway: "A financed purchase has separate building blocks, including price, taxes, fees, credits, down payment, APR, and term.",
  },
  {
    context: "closing techniques",
    angle: "closing technique",
    takeaway: "A clear close summarizes the agreed figures and asks for confirmation before paperwork is signed.",
  },
  {
    context: "objection handling",
    angle: "objection handling",
    takeaway: "A useful response to a payment objection is to identify which quote line needs explanation before changing the number.",
  },
  {
    context: "salesperson coaching",
    angle: "salesperson coaching",
    takeaway: "A salesperson can build trust by explaining the quote in the same order a customer sees it and pausing for questions.",
  },
];

const HOOK_LIBRARY = {
  dealership_story: [
    "The payment changed—but which line caused it?",
    "Two dealer quotes can show different payments for the same vehicle. Why?",
    "A customer saw two payments. The useful question was what changed underneath.",
  ],
  myth_reality: [
    "A lower payment can still mean a more expensive loan—did you check the term?",
    "The monthly payment is the result, not the explanation. What built it?",
    "Myth: the lowest payment is automatically the best deal.",
  ],
  buyer_qa: [
    "Q&A: What should you ask when a dealer quote shows a payment?",
    "Q&A: Can one optional product change the payment that much?",
    "Q&A: What changed between the first quote and the revised quote?",
    "Q&A: Where should a trade payoff appear on the worksheet?",
  ],
  salesperson_objection: [
    "A customer says, “The payment is too high.” Which line comes first?",
    "What should a salesperson say when a buyer asks why the payment changed?",
    "A payment objection is often a question about the worksheet—not a dead end.",
  ],
  finance_lesson: [
    "Before comparing payments, find the amount financed.",
    "A $1,000 change does not always create the same payment change. Why?",
    "APR, term, and amount financed work together—so which one moved?",
  ],
  closing_technique: [
    "Before asking for a signature, can both sides explain every payment line?",
    "The cleanest close starts with the numbers the customer can see.",
    "A clear recap can prevent a last-minute payment surprise.",
  ],
  quote_comparison: [
    "Which line changed between the dealer’s original quote and the revision?",
    "Same vehicle, different payment—what should you compare first?",
    "A payment comparison is incomplete until the amount financed is compared too.",
  ],
  add_on_explanation: [
    "A product name is not an explanation. What does it cost and include?",
    "Can you identify every optional product inside this payment?",
    "One bundled product price can hide several separate decisions.",
  ],
  trade_scenario: [
    "Trade value minus payoff: is the difference helping or following the next loan?",
    "The trade looks positive—did you subtract the payoff separately?",
    "A lower payment can hide negative equity. Where is it shown?",
  ],
  what_changed: [
    "What changed from the first worksheet to the latest one?",
    "The payment moved. Can you find the first changed number?",
    "A revised quote should come with a written change list.",
  ],
  decision_framework: [
    "Three questions can make a complicated quote easier to decide: what, where, and why?",
    "Before deciding on the payment, what does each line actually mean?",
    "A clear decision starts by separating price, products, and financing.",
  ],
  salesperson_coaching: [
    "The customer points to the payment. What should the salesperson explain first?",
    "A better sales conversation begins with the line the customer is asking about.",
    "How can a salesperson answer a quote objection without guessing?",
  ],
  checklist: [
    "Before signing, can you answer these eight quote questions?",
    "A short quote checklist can expose the reason a payment changed.",
    "Do not compare only the payment—check these lines first.",
  ],
  conversation: [
    "Buyer: “Why is this payment different?” What should happen next?",
    "A useful quote conversation starts with one exact customer question.",
    "Buyer and salesperson can review the same numbers without talking past each other.",
  ],
  quick_calculation: [
    "Payment math needs context: which number changed first?",
    "A $2,000 product does not have a $2,000 monthly payment—but it still matters.",
    "Want to understand the payment? Start with the amount financed.",
  ],
  default: [
    "The payment changed—but which line caused it?",
    "What should you verify before accepting a dealer quote?",
    "A clear quote review starts with the numbers behind the payment.",
  ],
};

const PLATFORM_GUIDANCE = {
  facebook: "Use a conversational opening, one concrete example, and finish with a question that invites a real answer.",
  instagram: "Write a caption that is easy to scan beside a quote graphic: lead with the hook, use short paragraphs, and end with a save-or-share question.",
  threads: "Write like a useful conversation starter: keep each sentence compact, answer one question clearly, and end with one concise question.",
};

function contentFormatFor(structure, platform) {
  if (structure === "buyer_qa") return "Q&A session";
  if (structure === "conversation" || structure === "salesperson_objection") return "conversation starter";
  if (platform === "instagram") return "caption with visual cue";
  return "educational post";
}

function callToActionFor(structure) {
  if (structure === "buyer_qa") {
    return "Invite readers to leave the next quote question for the next Q&A session, then try the free quote review from the tracked link.";
  }
  return "Invite readers to check their own quote with the free review and ask which line they want explained.";
}

const STRUCTURE_SEQUENCES = {
  facebook: [
    "dealership_story", "finance_lesson", "buyer_qa", "salesperson_objection", "checklist", "trade_scenario", "closing_technique",
    "quote_comparison", "decision_framework", "myth_reality", "add_on_explanation", "what_changed", "salesperson_coaching",
  ],
  instagram: [
    "myth_reality", "quote_comparison", "buyer_qa", "add_on_explanation", "trade_scenario", "finance_lesson",
    "dealership_story", "checklist", "what_changed", "decision_framework", "closing_technique", "salesperson_coaching",
  ],
  threads: [
    "conversation", "salesperson_coaching", "quick_calculation", "buyer_qa", "dealership_story", "salesperson_objection",
    "myth_reality", "closing_technique", "quote_comparison", "trade_scenario", "checklist", "finance_lesson",
  ],
  facebook_page: [
    "dealership_story", "finance_lesson", "buyer_qa", "salesperson_objection", "checklist", "trade_scenario", "closing_technique",
    "quote_comparison", "decision_framework", "myth_reality", "add_on_explanation", "what_changed", "salesperson_coaching",
  ],
};

const STRUCTURE_LABELS = {
  dealership_story: "dealership story",
  myth_reality: "myth versus reality",
  buyer_qa: "buyer Q&A",
  salesperson_objection: "salesperson objection-handling scenario",
  finance_lesson: "finance lesson with simple numbers",
  closing_technique: "closing-technique example",
  quote_comparison: "quote comparison",
  add_on_explanation: "add-on explanation",
  trade_scenario: "trade or negative-equity scenario",
  what_changed: "what changed breakdown",
  decision_framework: "customer decision framework",
  salesperson_coaching: "salesperson coaching scenario",
  checklist: "numbered checklist",
  conversation: "customer conversation",
  quick_calculation: "quick calculation",
};

const OPENING_STYLES = {
  dealership_story: ["scene-setting", "dialogue"],
  myth_reality: ["surprising statement", "myth question"],
  buyer_qa: ["buyer question", "direct question"],
  salesperson_objection: ["objection", "dialogue"],
  finance_lesson: ["simple number", "surprising statement"],
  closing_technique: ["closing question", "scenario"],
  quote_comparison: ["comparison", "direct question"],
  add_on_explanation: ["surprising statement", "checklist lead"],
  trade_scenario: ["scene-setting", "buyer question"],
  what_changed: ["direct question", "comparison"],
  decision_framework: ["action question", "scenario"],
  salesperson_coaching: ["salesperson scenario", "dialogue"],
  checklist: ["checklist lead", "direct question"],
  conversation: ["dialogue", "buyer question"],
  quick_calculation: ["simple number", "surprising statement"],
};

const STRUCTURE_FALLBACKS = {
  dealership_story: (topic) => [
    "A customer paused when two vehicle quotes showed different payments.",
    `The first question was about the ${topic.context} line, not the salesperson's confidence.`,
    "The salesperson placed both quotes side by side.",
    "They named the price, trade figure, APR, term, and amount financed.",
    "The customer noticed that one change affected several numbers.",
    `That moment made the ${topic.context} discussion specific instead of stressful.`,
    "No one needed to guess which figure had moved.",
    "The customer wrote down the remaining questions.",
    "The salesperson answered each question before presenting the paperwork.",
    "A clear quote review gives both sides a better chance to catch misunderstandings.",
  ],
  myth_reality: (topic) => [
    `Myth: the ${topic.context} line can be judged from the monthly payment alone.`,
    "Reality: a payment is the result of several figures working together.",
    "Check the selling price before looking at the loan terms.",
    "Then check taxes, fees, credits, trade equity, and cash down.",
    `The ${topic.context} figure should be shown in plain language.`,
    "Compare APR and term instead of assuming a lower payment costs less.",
    "Ask whether any optional product was added to the amount financed.",
    "Ask what changed from the first quote to the latest quote.",
    "Write the answer beside the exact line that changed.",
    "A myth fades quickly when the complete quote is visible.",
  ],
  buyer_qa: (topic) => [
    `Question: what should I ask about ${topic.context} before signing?`,
    "Answer: ask what it is, what it costs, and where it appears in the quote.",
    "Ask whether it changes the amount financed.",
    "Ask whether the price is paid once or included in the loan.",
    "Ask which figures change if the item is removed.",
    "Ask for the APR, term, and total of payments.",
    "Ask how a trade payoff or cash down affects the calculation.",
    "Keep the answers with the version of the quote you reviewed.",
    "A good question is easier to answer when every line has a name.",
    "That is how a buyer turns a quick presentation into an informed decision.",
  ],
  salesperson_objection: (topic) => [
    "Customer: the payment is higher than I expected.",
    "Salesperson: let us identify the exact line driving the difference.",
    `They start with the ${topic.context} figure and review the surrounding lines.`,
    "They confirm the selling price, taxes, fees, trade figures, and cash down.",
    "They also confirm the APR, term, and amount financed.",
    "The customer does not have to accept a vague explanation.",
    "The salesperson does not need to defend a number that can be displayed.",
    "Together they compare the original quote with the revised quote.",
    "The objection becomes a question about facts instead of a disagreement.",
    "Specific explanations create a more respectful closing conversation.",
  ],
  finance_lesson: (topic) => [
    `Here is a simple lesson about ${topic.context}.`,
    "Imagine a quote with a price of 24,000 dollars.",
    "Taxes and fees add to the amount that must be covered.",
    "A 2,000-dollar trade credit can reduce the amount financed.",
    "A 1,000-dollar product can increase it again.",
    "A longer term can lower the monthly payment.",
    "The APR still affects the cost of borrowing across that term.",
    "The total of payments shows more than the monthly number.",
    "Write each change on its own line before comparing quotes.",
    "Simple math makes a complicated worksheet easier to discuss.",
  ],
  closing_technique: (topic) => [
    `A strong close begins by summarizing the ${topic.context} discussion.`,
    "The salesperson names the agreed vehicle price and trade figures.",
    "Next, they confirm taxes, fees, products, cash down, APR, and term.",
    "The customer can ask for any unclear line to be explained.",
    "The conversation stays focused on the written quote.",
    "The salesperson asks which items the customer wants to keep.",
    "They confirm the amount financed before showing the final payment.",
    "They confirm the total of payments before signatures.",
    "A final recap prevents a last-minute surprise from becoming a guess.",
    "Clarity is a practical closing technique for both sides of the desk.",
  ],
  quote_comparison: (topic) => [
    `Put two quotes beside each other when comparing ${topic.context}.`,
    "Start with the vehicle price and the trade allowance.",
    "Mark every tax, fee, credit, and optional product.",
    "Then compare cash down and the amount financed.",
    "Compare APR and term on the same row.",
    "A changed payment is a clue, not the complete explanation.",
    "Circle the first number that differs between the quotes.",
    "Ask whether that difference changes any later line.",
    "Save both versions so the conversation stays concrete.",
    "A side-by-side view turns a payment comparison into quote analysis.",
  ],
  add_on_explanation: (topic) => [
    `Optional products deserve their own explanation before ${topic.context} is finalized.`,
    "Ask for the product name and the exact price.",
    "Ask whether the price is paid separately or financed.",
    "Ask what coverage, service, or benefit the product provides.",
    "Ask about exclusions, deductibles, cancellation rules, and term.",
    "Do not combine several products into one unexplained bundle.",
    "Check how the item changes the amount financed.",
    "Check how the item changes the payment and total of payments.",
    "The answer can be recorded without making an accusation.",
    "Clear product details let the customer choose with better information.",
  ],
  trade_scenario: (topic) => [
    `A trade-in conversation can change the ${topic.context} calculation quickly.`,
    "Start with the trade value shown on the worksheet.",
    "Then write down the payoff amount separately.",
    "The difference is the trade equity being applied to the deal.",
    "Positive equity can act like a credit.",
    "Negative equity can increase the amount financed on the next vehicle.",
    "Cash down and rebates may change the remaining balance.",
    "Ask where each figure appears in the final quote.",
    "Compare the trade numbers before comparing monthly payments.",
    "A clear trade scenario prevents old loan balance from disappearing into a new number.",
  ],
  what_changed: (topic) => [
    `What changed between the first quote and the latest ${topic.context} quote?`,
    "Read both versions from top to bottom.",
    "Mark the vehicle price, trade value, payoff, and cash down.",
    "Mark taxes, fees, rebates, and optional products.",
    "Then mark APR, term, amount financed, and payment.",
    "One changed line can create several downstream changes.",
    "A lower payment may come from a longer term or different cash down.",
    "A higher payment may come from a larger amount financed.",
    "Ask for an explanation beside each changed line.",
    "A written change log is more useful than trying to remember the presentation.",
  ],
  decision_framework: (topic) => [
    `Use a three-part decision framework for ${topic.context}.`,
    "First, confirm what the number means.",
    "Second, confirm where it appears in the quote.",
    "Third, decide whether it fits the customer's priorities.",
    "Keep price and financing questions separate.",
    "Keep optional-product questions separate from the vehicle choice.",
    "Review trade equity before relying on a payment comparison.",
    "Review APR, term, and total of payments before signing.",
    "Write down any question that still needs an answer.",
    "A repeatable framework makes a fast decision easier to evaluate later.",
  ],
  salesperson_coaching: (topic) => [
    `Salesperson coaching note: explain ${topic.context} in the customer's order of questions.`,
    "Start with the line the customer is pointing at.",
    "Use the written quote instead of a verbal shortcut.",
    "Explain the price, credits, trade figures, and cash down.",
    "Then explain amount financed, APR, term, and total of payments.",
    "Name optional products individually when they are present.",
    "Invite the customer to repeat the part that remains unclear.",
    "A calm pause often surfaces the real objection.",
    "Answer the objection with a line-by-line comparison.",
    "Coaching works best when clarity supports the customer's decision.",
  ],
  checklist: (topic) => [
    `Before signing, use this ${topic.context} checklist.`,
    "One: confirm the vehicle selling price.",
    "Two: confirm taxes, fees, rebates, and trade figures.",
    "Three: list every optional product by name and price.",
    "Four: confirm cash down and amount financed.",
    "Five: confirm APR, term, payment, and total of payments.",
    "Six: compare the current quote with any earlier version.",
    "Seven: ask about every line that changed.",
    "Eight: keep a copy of the figures you reviewed.",
    "A short checklist can make a long worksheet much easier to verify.",
  ],
  conversation: (topic) => [
    `Buyer: can we slow down and review the ${topic.context} line?`,
    "Salesperson: yes, we can start with that line and follow the numbers.",
    "Buyer: does it change the amount financed?",
    "Salesperson: the quote shows whether it is included or paid separately.",
    "Buyer: what happens if the item changes?",
    "Salesperson: we can compare the revised quote with the original.",
    "Buyer: I also want to see the APR and term together.",
    "Salesperson: those figures help explain the payment and borrowing cost.",
    "Buyer: please show the total of payments too.",
    "A clear conversation gives every important number a place on the page.",
  ],
  quick_calculation: (topic) => [
    `Quick calculation: start with the ${topic.context} line, then follow its effect.`,
    "A 1,000-dollar change is not always a 1,000-dollar payment change.",
    "The APR affects interest across the loan.",
    "The term affects how many payments are made.",
    "Trade equity changes the balance before financing is calculated.",
    "Cash down changes the amount that remains.",
    "An optional product can add to that amount.",
    "Compare the amount financed before comparing the payment.",
    "Compare the total of payments before making a final choice.",
    "The useful calculation is the one that explains the complete quote.",
  ],
};

function normalizedPlatform(platform) {
  const value = String(platform ?? "").trim().toLowerCase();
  return value === "facebook page" || value === "facebook_page" ? "facebook" : value;
}

function daySeed(now) {
  return Math.floor(new Date(now).getTime() / 86400000);
}

function textOf(item) {
  return String(item?.post ?? item?.text ?? "").trim();
}

function recentMetadata(history) {
  return (Array.isArray(history) ? history : []).slice(-8).map((item) => ({
    context: String(item?.context ?? "").trim(),
    angle: String(item?.angle ?? "").trim(),
    takeaway: String(item?.takeaway ?? "").trim(),
    structure: String(item?.structure ?? "").trim(),
    openingStyle: String(item?.openingStyle ?? "").trim(),
    hook: String(item?.hook ?? "").trim(),
    callToAction: String(item?.callToAction ?? "").trim(),
    post: textOf(item).slice(0, 900),
  }));
}

function firstSentence(post) {
  return String(post ?? "").trim().split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
}

function normalizedWords(text) {
  return new Set(String(text ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean));
}

function overlap(left, right) {
  const a = normalizedWords(left);
  const b = normalizedWords(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common += 1;
  return common / Math.max(1, Math.min(a.size, b.size));
}

function jaccardOverlap(left, right) {
  const a = normalizedWords(left);
  const b = normalizedWords(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common += 1;
  return common / Math.max(1, a.size + b.size - common);
}

function sentenceParts(post) {
  return String(post ?? "")
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function formatSocialPost(post) {
  const raw = String(post ?? "").replace(/\r/g, "").trim();
  if (!raw) return "";
  const sentences = sentenceParts(raw);
  if (sentences.length < 3) return raw.replace(/\s+/g, " ").trim();
  const paragraphs = [];
  for (let index = 0; index < sentences.length; index += 3) {
    paragraphs.push(sentences.slice(index, index + 3).join(" "));
  }
  return paragraphs.join("\n\n");
}

export function selectContentPlan(now = new Date(), platform = "", history = []) {
  const normalized = normalizedPlatform(platform);
  const sequence = STRUCTURE_SEQUENCES[normalized] ?? STRUCTURE_SEQUENCES.facebook;
  const records = recentMetadata(history);
  const recentStructures = new Set(records.slice(-4).map((item) => item.structure).filter(Boolean));
  const recentContexts = new Set(records.slice(-2).map((item) => item.context).filter(Boolean));
  const seed = daySeed(now) + normalized.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0);
  let structureIndex = seed % sequence.length;
  let structure = sequence[structureIndex];
  for (let attempt = 0; attempt < sequence.length; attempt += 1) {
    const candidate = sequence[(structureIndex + attempt) % sequence.length];
    if (!recentStructures.has(candidate) || attempt === sequence.length - 1) {
      structureIndex = (structureIndex + attempt) % sequence.length;
      structure = candidate;
      break;
    }
  }
  const topicStart = (seed + structureIndex * 3) % TOPICS.length;
  let topic = TOPICS[topicStart];
  for (let attempt = 0; attempt < TOPICS.length; attempt += 1) {
    const candidate = TOPICS[(topicStart + attempt) % TOPICS.length];
    if (!recentContexts.has(candidate.context) || attempt === TOPICS.length - 1) {
      topic = candidate;
      break;
    }
  }
  const styles = OPENING_STYLES[structure] ?? ["direct question"];
  const openingStyle = styles[(seed + structureIndex) % styles.length];
  const hookCandidates = HOOK_LIBRARY[structure] ?? HOOK_LIBRARY.default;
  const recentHooks = new Set(records.slice(-5).map((item) => item.hook).filter(Boolean));
  const hookStart = (seed + structureIndex * 7 + normalized.length) % hookCandidates.length;
  let hook = hookCandidates[hookStart];
  for (let attempt = 0; attempt < hookCandidates.length; attempt += 1) {
    const candidate = hookCandidates[(hookStart + attempt) % hookCandidates.length];
    if (!recentHooks.has(candidate) || attempt === hookCandidates.length - 1) {
      hook = candidate;
      break;
    }
  }
  return {
    platform: normalized,
    context: topic.context,
    topic: topic.context,
    angle: topic.angle,
    takeaway: topic.takeaway,
    structure,
    structureLabel: STRUCTURE_LABELS[structure] ?? structure,
    openingStyle,
    hook,
    contentFormat: contentFormatFor(structure, normalized),
    callToAction: callToActionFor(structure),
  };
}

export function selectSocialAngle(now = new Date(), platform = "", history = []) {
  const plan = selectContentPlan(now, platform, history);
  return {
    topic: plan.context,
    hook: plan.hook,
    direction: plan.takeaway,
  };
}

export function contentPrompt(platform, plan, history = []) {
  const normalized = normalizedPlatform(platform);
  const sentenceRule = normalized === "threads"
    ? "Use exactly 10 meaningful sentences and stay under 420 characters before the link."
    : "Use 10–18 meaningful, complete sentences and stay within the platform's normal length limit.";
  const historyText = recentMetadata(history).map((item, index) =>
    `${index + 1}. context=${item.context || "unknown"}; angle=${item.angle || "unknown"}; structure=${item.structure || "unknown"}; opening=${item.openingStyle || "unknown"}; hook=${item.hook || "unknown"}; post=${item.post}`,
  ).join("\n") || "No prior content metadata is recorded for this platform.";
  const qaRule = plan.structure === "buyer_qa"
    ? "This is a Q&A session: include a customer question, a direct answer, one useful follow-up question and answer, and an invitation for readers to submit the next question."
    : "Use one practical reader question or decision point so the post invites discussion.";
  return `You create an educational ${normalized} post for PencilProof. Return JSON only: {"post":"..."}. The first sentence must use this hook or a very close equivalent: ${plan.hook} Use this exact structure: ${plan.structureLabel}. This is a ${plan.contentFormat}. Use this context: ${plan.context}. Use this angle: ${plan.angle}. Make this takeaway clear: ${plan.takeaway} ${sentenceRule} ${PLATFORM_GUIDANCE[normalized] ?? PLATFORM_GUIDANCE.facebook} ${qaRule} End with this direction: ${plan.callToAction} Do not write a URL yourself; the system appends a tracked free-review link. Use readable paragraphs separated by blank lines. Never use the phrase "A buyer reviewing" anywhere. The same broad topic may appear on another platform, but do not repeat this platform's recent context, takeaway, structure, opening style, hook, or wording consecutively. If a draft feels similar, rewrite it into the assigned structure rather than skipping the post. Use realistic dealership stories, customer conversations, buyer Q&A, salesperson coaching, objection handling, finance basics, simple numbers, and clear closing examples when assigned. Avoid fearmongering, accusations, guarantees, individualized financial or legal advice, and private information. Do not use short sentence fragments. Recent ${normalized} content metadata follows:\n${historyText}`;
}

export function validateSocialPost(post, plan = {}, history = [], platform = "") {
  const text = String(post ?? "").trim();
  const sentences = sentenceParts(text);
  const meaningful = sentences.filter((sentence) => normalizedWords(sentence).size >= 4);
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const first = firstSentence(text);
  const plannedHook = firstSentence(plan.hook);
  const recent = recentMetadata(history);
  const reasons = [];
  if (text.length === 0) reasons.push("empty post");
  if (sentences.length < 10 || sentences.length > 25) reasons.push(`sentence count ${sentences.length} is outside 10-25`);
  if (meaningful.length !== sentences.length) reasons.push("contains sentence fragments");
  const hasHookCue = /[?!]|\$\s?\d|^\s*(?:Q&A|Question|Buyer:|Customer:|Myth:|Before|What|Why|How|Can|Did|Which|Want to)/i.test(first);
  const followsPlannedHook = plannedHook && overlap(first, plannedHook) >= 0.55;
  if (normalizedWords(first).size < 5 || (!hasHookCue && !followsPlannedHook)) {
    reasons.push("first sentence is not a strong hook");
  }
  if (paragraphs.length < 3) reasons.push("needs at least three readable paragraphs");
  if (/a buyer reviewing/i.test(text)) reasons.push("forbidden opening phrase present");
  const recentOpenings = recent.slice(-4).map((item) => firstSentence(item.post)).filter(Boolean);
  if (recentOpenings.some((opening) => overlap(first, opening) >= 0.72)) reasons.push("opening repeats a recent opening");
  // Whole-post similarity uses union-based Jaccard overlap. The earlier
  // smaller-set ratio falsely rejected distinct short Threads posts whenever
  // they shared necessary quote terms such as APR, payment, term, and price.
  // Exact and lightly edited duplicates still remain close to 1.0.
  const highestSimilarity = recent.reduce((highest, item) => Math.max(highest, jaccardOverlap(text, item.post)), 0);
  if (highestSimilarity >= 0.72) reasons.push("wording is too similar to a recent post");
  const normalized = normalizedPlatform(platform);
  const maxLength = normalized === "threads" ? 420 : normalized === "instagram" ? 2050 : 60000;
  if (text.length > maxLength) reasons.push(`length ${text.length} exceeds ${normalized} pre-link limit ${maxLength}`);
  if (plan.structure === "buyer_qa" && !/\b(?:Q&A|question|answer|ask)\b/i.test(text)) reasons.push("Q&A post is missing a question-and-answer cue");
  return {
    ok: reasons.length === 0,
    reasons,
    sentenceCount: sentences.length,
    meaningfulSentenceCount: meaningful.length,
    paragraphCount: paragraphs.length,
    length: text.length,
    highestSimilarity,
    context: plan.context ?? null,
    structure: plan.structure ?? null,
  };
}

export function buildFallbackPost(plan = {}, platform = "", history = []) {
  const normalized = normalizedPlatform(platform);
  const topic = {
    context: String(plan.context ?? plan.topic ?? "the quote").trim(),
  };
  let sentences = (STRUCTURE_FALLBACKS[plan.structure] ?? STRUCTURE_FALLBACKS.finance_lesson)(topic);
  if (normalized === "threads") {
    const compact = {
      myth_reality: ["Payment myths need more context.", "Check the vehicle price first.", "Then check the loan term.", "Review the quoted APR too.", "Optional products can change the balance.", "The trade payoff can change it.", "Cash down changes the amount financed.", "Rebates may change the selling price.", "Ask what changed between both quotes.", "Compare total payments before signing."],
      buyer_qa: ["Question: what changed in this quote?", "Answer: read every numbered line.", "Check the vehicle price and fees.", "Check the trade value too.", "Check the payoff as a separate line.", "Review the APR and loan term.", "Ask about every optional product.", "Confirm the full amount financed.", "Compare the total of payments.", "Keep the written dealer quote."],
      conversation: ["Buyer: can we slow this down?", "Salesperson: let us review every line.", "Start with the vehicle price.", "Then check the taxes and fees.", "Review the trade payoff separately.", "Review the quoted APR too.", "Check the complete loan term.", "Ask about every optional product.", "Confirm the full amount financed.", "Sign only after every question is answered."],
      quick_calculation: ["Payment math needs complete context.", "Check the vehicle price and fees.", "Review the trade payoff separately.", "Check the cash down amount too.", "Optional products change the financed balance.", "The APR affects total borrowing cost.", "The term changes the payment count.", "Amount financed connects every quote line.", "Ask which exact number changed.", "Compare the total of payments."],
      salesperson_coaching: ["Coaching begins with the buyer's question.", "Repeat the concern before explaining figures.", "Point to the exact worksheet line.", "Separate price from financing terms.", "Name each optional protection product.", "Show trade value beside payoff.", "Connect APR with total borrowing cost.", "Confirm the customer's preferred change.", "Recap the agreed written numbers.", "Ask whether the concern is resolved."],
      dealership_story: ["A revised worksheet surprised one customer.", "They compared both pages at the dealership.", "The selling price stayed visible.", "A discount changed the taxable balance.", "Trade equity lowered the financed amount.", "Products explained the remaining difference.", "The quoted APR stayed unchanged.", "The term showed every payment month.", "Written notes prevented another misunderstanding.", "The final decision used verified figures."],
      salesperson_objection: ["Customer: this payment feels too high.", "Which figure concerns you most?", "They checked the financed balance first.", "The product total needed clarification.", "Trade credit needed explanation too.", "APR showed the borrowing percentage.", "Term showed the repayment timeline.", "The customer requested written changes.", "Both reviewed the new calculation.", "Specific questions replaced confusion."],
      closing_technique: ["Before closing, summarize every agreed figure.", "Restate the final selling price.", "List credits and cash down.", "Confirm trade value and payoff.", "Read each selected product aloud.", "Verify taxes and official fees.", "Repeat the APR and term.", "Show the resulting amount financed.", "Ask whether anything remains unclear.", "Request commitment only after confirmation."],
      quote_comparison: ["Place both dealer worksheets together.", "Match the vehicle description first.", "Compare each selling price next.", "Mark changed taxes and fees.", "Separate added products by name.", "Check trade values and payoffs.", "Circle different APR figures.", "Count every month in each term.", "Compare both financed balances.", "Explain the payment difference last."],
      trade_scenario: ["Trade math starts with two figures.", "Write down the appraised value.", "Write down the current payoff.", "Subtract payoff from trade value.", "Positive equity reduces the next balance.", "Negative equity increases that balance.", "Keep cash down separate.", "Check where the difference appears.", "Recalculate the financed amount.", "Verify the result before signing."],
      checklist: ["Use this written quote checklist.", "Confirm the exact vehicle and price.", "Identify every discount or rebate.", "Review taxes and government fees.", "Name every optional product.", "Verify trade value and payoff.", "Check cash down separately.", "Read the APR and term.", "Confirm the amount financed.", "Keep a copy before signing."],
      finance_lesson: ["Loan cost has several moving parts.", "Principal begins with the financed amount.", "APR describes the borrowing rate.", "Term counts the scheduled payments.", "Products can increase principal.", "Trade equity can reduce principal.", "Negative equity can increase it.", "Longer terms may lower payments.", "Total payments reveal broader cost.", "Compare every part before deciding."],
    }[plan.structure];
    if (compact) sentences = compact;
    else sentences = ["A clear dealer quote needs context.", "Start with the vehicle price.", "Then check the taxes and fees.", "Review the trade figures separately.", "Check the trade payoff separately too.", "Review the APR and loan term.", "Ask about every optional product.", "Confirm the full amount financed.", "Ask which exact line changed.", "Compare the total of payments."];
  }
  if (String(plan.hook ?? "").trim()) sentences[0] = firstSentence(plan.hook);
  return formatSocialPost(sentences.join(" "));
}

export function contentHistoryEntry(platform, plan, post, at = new Date(), extra = {}) {
  return {
    platform: normalizedPlatform(platform),
    context: String(plan?.context ?? "").trim(),
    angle: String(plan?.angle ?? "").trim(),
    takeaway: String(plan?.takeaway ?? "").trim(),
    structure: String(plan?.structure ?? "").trim(),
    openingStyle: String(plan?.openingStyle ?? "").trim(),
    hook: String(plan?.hook ?? "").trim(),
    contentFormat: String(plan?.contentFormat ?? "").trim(),
    callToAction: String(plan?.callToAction ?? "").trim(),
    post: String(post ?? "").trim(),
    created: new Date(at).toISOString(),
    ...extra,
  };
}

export function contentHistoryForPlatform(state, platform) {
  const normalized = normalizedPlatform(platform);
  const byPlatform = state?.contentHistoryByPlatform;
  const explicit = Array.isArray(byPlatform?.[normalized]) ? byPlatform[normalized] : [];
  if (explicit.length) return explicit;
  return (Array.isArray(state?.recentPosts) ? state.recentPosts : [])
    .filter((item) => normalizedPlatform(item?.platform) === normalized)
    .map((item) => ({ platform: normalized, post: textOf(item), created: item?.created ?? null }));
}
