"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Deal = {
  vehicle: string;
  sellingPrice: number;
  tax: number;
  govFees: number;
  docFee: number;
  serviceContract: number;
  gap: number;
  protection: number;
  accessories: number;
  tradeValue: number;
  tradePayoff: number;
  cashDown: number;
  rebate: number;
  apr: number;
  outsideApr: number;
  term: number;
  quotedPayment: number;
};

const sample: Deal = {
  vehicle: "2026 compact SUV",
  sellingPrice: 38450,
  tax: 3474,
  govFees: 612,
  docFee: 85,
  serviceContract: 1295,
  gap: 0,
  protection: 600,
  accessories: 0,
  tradeValue: 0,
  tradePayoff: 0,
  cashDown: 2500,
  rebate: 0,
  apr: 7.49,
  outsideApr: 5.39,
  term: 72,
  quotedPayment: 726,
};

const blank: Deal = {
  vehicle: "",
  sellingPrice: 0,
  tax: 0,
  govFees: 0,
  docFee: 0,
  serviceContract: 0,
  gap: 0,
  protection: 0,
  accessories: 0,
  tradeValue: 0,
  tradePayoff: 0,
  cashDown: 0,
  rebate: 0,
  apr: 0,
  outsideApr: 0,
  term: 60,
  quotedPayment: 0,
};

const dollars = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);

const paymentFor = (principal: number, apr: number, months: number) => {
  if (principal <= 0 || months <= 0) return 0;
  const rate = apr / 1200;
  if (rate === 0) return principal / months;
  return (principal * rate * Math.pow(1 + rate, months)) / (Math.pow(1 + rate, months) - 1);
};

function MoneyField({ label, field, value, onChange, hint }: { label: string; field: keyof Deal; value: number; onChange: (field: keyof Deal, value: string) => void; hint?: string }) {
  return (
    <label className="input-field">
      <span>{label}</span>
      <div className="input-money"><i>$</i><input aria-label={label} inputMode="decimal" type="number" min="0" step="1" value={value || ""} onChange={(event) => onChange(field, event.target.value)} /></div>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export default function AnalyzePage() {
  const [deal, setDeal] = useState<Deal>(sample);
  const [copied, setCopied] = useState(false);

  const setNumber = (field: keyof Deal, value: string) => setDeal((current) => ({ ...current, [field]: value === "" ? 0 : Number(value) }));

  const analysis = useMemo(() => {
    const addons = deal.serviceContract + deal.gap + deal.protection + deal.accessories;
    const totalFees = deal.govFees + deal.docFee;
    const tradeEquity = deal.tradeValue - deal.tradePayoff;
    const amountFinanced = Math.max(0, deal.sellingPrice + deal.tax + totalFees + addons + deal.tradePayoff - deal.tradeValue - deal.cashDown - deal.rebate);
    const calculatedPayment = paymentFor(amountFinanced, deal.apr, deal.term);
    const outsidePayment = deal.outsideApr > 0 ? paymentFor(amountFinanced, deal.outsideApr, deal.term) : 0;
    const paymentGap = deal.quotedPayment > 0 ? deal.quotedPayment - calculatedPayment : 0;
    const financeCharge = calculatedPayment * deal.term - amountFinanced;
    const aprCost = outsidePayment > 0 ? (calculatedPayment - outsidePayment) * deal.term : 0;
    const aprGap = deal.outsideApr > 0 ? deal.apr - deal.outsideApr : 0;
    let score = 100;
    if (addons > 0) score -= Math.min(22, Math.max(5, Math.round(addons / 250)));
    if (aprGap >= 2) score -= 16;
    else if (aprGap >= 1) score -= 11;
    else if (aprGap >= .25) score -= 6;
    if (deal.term >= 84) score -= 14;
    else if (deal.term > 72) score -= 9;
    else if (deal.term > 60) score -= 4;
    if (Math.abs(paymentGap) > 10) score -= 18;
    else if (Math.abs(paymentGap) > 4) score -= 9;
    if (tradeEquity < 0) score -= Math.min(14, Math.max(5, Math.round(Math.abs(tradeEquity) / 500)));
    if (deal.docFee > 1000) score -= 8;
    score = Math.max(20, Math.round(score));

    const flags: { tone: "warn" | "good" | "note"; title: string; detail: string }[] = [];
    if (addons > 0) flags.push({ tone: "warn", title: `${dollars(addons)} in optional products`, detail: "Confirm every product is optional and request a version without products for comparison." });
    else flags.push({ tone: "good", title: "No optional products entered", detail: "The quote appears clean of service contracts, GAP, protection products, and accessories." });
    if (aprGap >= .25) flags.push({ tone: "warn", title: `Dealer APR is ${aprGap.toFixed(2)} points higher`, detail: aprCost > 0 ? `Compared with your outside rate, that is about ${dollars(aprCost)} over the full term.` : "Compare the dealer offer with your own lender before signing." });
    else if (deal.outsideApr > 0) flags.push({ tone: "good", title: "Dealer APR is competitive", detail: "The entered dealer rate is close to or below your outside offer." });
    if (deal.quotedPayment > 0 && Math.abs(paymentGap) > 4) flags.push({ tone: "warn", title: `Payment differs by ${dollars(Math.abs(paymentGap))}/month`, detail: `Your inputs calculate to about ${dollars(calculatedPayment)}/month. Ask what number is missing or different.` });
    else if (deal.quotedPayment > 0) flags.push({ tone: "good", title: "Payment math is close", detail: `Your inputs calculate to about ${dollars(calculatedPayment)}/month.` });
    if (tradeEquity < 0) flags.push({ tone: "warn", title: `${dollars(Math.abs(tradeEquity))} of negative equity`, detail: "That old loan balance is being added to the new loan and can leave you upside-down longer." });
    if (deal.term >= 84) flags.push({ tone: "warn", title: `${deal.term}-month term`, detail: "A very long term lowers the payment but increases total interest and slows equity growth." });
    else if (deal.term > 60) flags.push({ tone: "note", title: `${deal.term}-month term`, detail: `Estimated finance charge is ${dollars(financeCharge)} if kept for the full term.` });
    if (!flags.length) flags.push({ tone: "note", title: "Add the quote details", detail: "Enter the numbers from the dealership to create your review." });

    return { addons, totalFees, tradeEquity, amountFinanced, calculatedPayment, financeCharge, aprCost, aprGap, paymentGap, score, flags };
  }, [deal]);

  const message = `Thanks for the quote on the ${deal.vehicle || "vehicle"}. Before I move forward, please send a revised buyer's order that:\n\n1. Shows the selling price of ${dollars(deal.sellingPrice)} before tax and government fees.\n2. Separately itemizes all dealer fees and optional products.\n${analysis.addons > 0 ? `3. Removes the optional products totaling ${dollars(analysis.addons)} so I can compare both versions.\n` : "3. Confirms no optional products are required for the advertised price or financing.\n"}${analysis.aprGap >= .25 ? `4. Shows whether you can match or beat my ${deal.outsideApr.toFixed(2)}% outside approval.\n` : "4. Confirms the APR and term shown are final, subject only to lender approval.\n"}5. Confirms there are no additional mandatory dealer charges beyond the revised buyer's order.\n\nPlease quote the out-the-door total and amount financed, not only the monthly payment.`;

  const copyMessage = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <main className="analyzer-page">
      <nav className="site-nav analyzer-nav" aria-label="Main navigation">
        <Link className="brand" href="/"><span className="brand-mark">P</span><span>PencilProof</span></Link>
        <span className="privacy-chip">Your numbers stay in this browser</span>
      </nav>

      <header className="analyzer-header shell">
        <div><p className="kicker">FINANCE DEAL CHECK</p><h1>Rebuild the deal.</h1><p>Use the figures printed on the dealership worksheet. Estimates update as you type.</p></div>
        <div className="analyzer-actions"><button type="button" onClick={() => setDeal(sample)}>Load sample</button><button type="button" onClick={() => setDeal(blank)}>Clear all</button></div>
      </header>

      <div className="analyzer-layout shell">
        <form className="deal-form" onSubmit={(event) => event.preventDefault()}>
          <section className="form-section">
            <div className="form-section-title"><span>01</span><div><h2>Vehicle & price</h2><p>Start with the top of the dealer worksheet.</p></div></div>
            <label className="input-field full-field"><span>Vehicle description</span><input aria-label="Vehicle description" type="text" placeholder="e.g. 2026 Honda CR-V EX-L" value={deal.vehicle} onChange={(event) => setDeal((current) => ({ ...current, vehicle: event.target.value }))} /></label>
            <div className="field-grid"><MoneyField label="Selling price" field="sellingPrice" value={deal.sellingPrice} onChange={setNumber} /><MoneyField label="Rebate or discount" field="rebate" value={deal.rebate} onChange={setNumber} hint="Only if not already deducted" /><MoneyField label="Sales tax" field="tax" value={deal.tax} onChange={setNumber} /><MoneyField label="Cash down" field="cashDown" value={deal.cashDown} onChange={setNumber} /></div>
          </section>

          <section className="form-section">
            <div className="form-section-title"><span>02</span><div><h2>Fees & products</h2><p>Enter each category separately. Do not combine taxes with fees.</p></div></div>
            <div className="field-grid"><MoneyField label="Government / registration" field="govFees" value={deal.govFees} onChange={setNumber} /><MoneyField label="Dealer documentation fee" field="docFee" value={deal.docFee} onChange={setNumber} /><MoneyField label="Service contract / warranty" field="serviceContract" value={deal.serviceContract} onChange={setNumber} /><MoneyField label="GAP coverage" field="gap" value={deal.gap} onChange={setNumber} /><MoneyField label="Protection products" field="protection" value={deal.protection} onChange={setNumber} /><MoneyField label="Accessories / other add-ons" field="accessories" value={deal.accessories} onChange={setNumber} /></div>
          </section>

          <section className="form-section">
            <div className="form-section-title"><span>03</span><div><h2>Trade & financing</h2><p>Use the actual payoff, not the remaining number of payments.</p></div></div>
            <div className="field-grid"><MoneyField label="Trade allowance" field="tradeValue" value={deal.tradeValue} onChange={setNumber} /><MoneyField label="Trade loan payoff" field="tradePayoff" value={deal.tradePayoff} onChange={setNumber} /></div>
            <div className="field-grid field-grid-four">
              <label className="input-field"><span>Dealer APR</span><div className="input-money input-percent"><input aria-label="Dealer APR" inputMode="decimal" type="number" min="0" step="0.01" value={deal.apr || ""} onChange={(event) => setNumber("apr", event.target.value)} /><i>%</i></div></label>
              <label className="input-field"><span>Your outside APR</span><div className="input-money input-percent"><input aria-label="Your outside APR" inputMode="decimal" type="number" min="0" step="0.01" value={deal.outsideApr || ""} onChange={(event) => setNumber("outsideApr", event.target.value)} /><i>%</i></div></label>
              <label className="input-field"><span>Loan term</span><select aria-label="Loan term" value={deal.term} onChange={(event) => setNumber("term", event.target.value)}><option value="36">36 months</option><option value="48">48 months</option><option value="60">60 months</option><option value="72">72 months</option><option value="75">75 months</option><option value="84">84 months</option><option value="96">96 months</option></select></label>
              <MoneyField label="Quoted monthly payment" field="quotedPayment" value={deal.quotedPayment} onChange={setNumber} />
            </div>
          </section>
        </form>

        <aside className="results-panel" aria-live="polite">
          <div className="results-sticky">
            <div className="result-top"><div><p>DEAL CLARITY SCORE</p><h2>{deal.vehicle || "Your finance deal"}</h2></div><div className={`big-score score-${analysis.score >= 80 ? "good" : analysis.score >= 60 ? "mid" : "low"}`}><strong>{analysis.score}</strong><span>/100</span></div></div>
            <p className="score-note">This scores the transparency and structure of the entered deal—not the vehicle&apos;s market price or condition.</p>
            <div className="result-numbers">
              <div><span>Estimated amount financed</span><strong>{dollars(analysis.amountFinanced)}</strong></div>
              <div><span>Rebuilt payment</span><strong>{dollars(analysis.calculatedPayment)}<small>/mo</small></strong></div>
              <div><span>Optional products</span><strong>{dollars(analysis.addons)}</strong></div>
              <div><span>Full-term finance charge</span><strong>{dollars(analysis.financeCharge)}</strong></div>
            </div>
            <div className="result-flags">{analysis.flags.map((flag, index) => <div className={`result-flag result-${flag.tone}`} key={`${flag.title}-${index}`}><span>{flag.tone === "good" ? "✓" : flag.tone === "warn" ? "!" : "i"}</span><p><b>{flag.title}</b><small>{flag.detail}</small></p></div>)}</div>
            <div className="dealer-message"><div><p>MESSAGE TO THE DEALER</p><button type="button" onClick={copyMessage}>{copied ? "Copied" : "Copy message"}</button></div><pre>{message}</pre></div>
            <button className="print-button" type="button" onClick={() => window.print()}>Print or save this review</button>
            <p className="result-disclaimer">Educational estimate only. Taxes and trade credits vary by state. Verify every number with the dealer and lender before signing.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
