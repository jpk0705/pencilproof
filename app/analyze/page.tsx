"use client";

import Link from "next/link";
import { useMemo, useState, type ChangeEvent } from "react";
import { extractDealFromFile } from "@/lib/deal-pdf";

type Deal = {
  vehicle: string;
  sellingPrice: number;
  tax: number;
  govFees: number;
  docFee: number;
  serviceContract: number;
  gap: number;
  prepaidMaintenance: number;
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

type ProductInsight = {
  name: string;
  amount: number;
  explanation: string;
  question: string;
};

type DealImportState = {
  status: "idle" | "loading" | "success" | "error";
  message: string;
  fields: string[];
};

const sample: Deal = {
  vehicle: "2026 compact SUV",
  sellingPrice: 38450,
  tax: 3474,
  govFees: 612,
  docFee: 85,
  serviceContract: 1295,
  gap: 0,
  prepaidMaintenance: 895,
  protection: 600,
  accessories: 0,
  tradeValue: 0,
  tradePayoff: 0,
  cashDown: 2500,
  rebate: 0,
  apr: 7.49,
  outsideApr: 5.39,
  term: 72,
  quotedPayment: 736,
};

const blank: Deal = {
  vehicle: "",
  sellingPrice: 0,
  tax: 0,
  govFees: 0,
  docFee: 0,
  serviceContract: 0,
  gap: 0,
  prepaidMaintenance: 0,
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
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);

const paymentFor = (principal: number, apr: number, months: number) => {
  if (principal <= 0 || months <= 0) return 0;
  const rate = apr / 1200;
  if (rate === 0) return principal / months;
  return (principal * rate * Math.pow(1 + rate, months)) / (Math.pow(1 + rate, months) - 1);
};

function MoneyField({
  label,
  field,
  value,
  onChange,
  hint,
}: {
  label: string;
  field: keyof Deal;
  value: number;
  onChange: (field: keyof Deal, value: string) => void;
  hint?: string;
}) {
  return (
    <label className="input-field">
      <span>{label}</span>
      <div className="input-money">
        <i>$</i>
        <input
          aria-label={label}
          inputMode="decimal"
          type="number"
          min="0"
          step="1"
          value={value || ""}
          onChange={(event) => onChange(field, event.target.value)}
        />
      </div>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export default function AnalyzePage() {
  const [deal, setDeal] = useState<Deal>(blank);
  const [copied, setCopied] = useState(false);
  const [dealImport, setDealImport] = useState<DealImportState>({ status: "idle", message: "", fields: [] });

  const setNumber = (field: keyof Deal, value: string) =>
    setDeal((current) => ({ ...current, [field]: value === "" ? 0 : Number(value) }));

  const importDealFile = async (file: File) => {
    const lowerName = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
    const isJpeg = file.type === "image/jpeg" || /\.jpe?g$/.test(lowerName);
    const isPng = file.type === "image/png" || lowerName.endsWith(".png");
    if (!isPdf && !isJpeg && !isPng) {
      setDealImport({ status: "error", message: "Choose a PDF, JPG, JPEG, or PNG file from the dealership.", fields: [] });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setDealImport({ status: "error", message: "That file is larger than 15 MB. Use a smaller copy or enter the figures manually.", fields: [] });
      return;
    }

    setDealImport({
      status: "loading",
      message: isPdf
        ? `Reading ${file.name} in your browser…`
        : `Preparing image recognition for ${file.name}… The first image can take a moment.`,
      fields: [],
    });
    try {
      const result = await extractDealFromFile(file, ({ progress, status }) => {
        const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
        const readableStatus = status.replace(/_/g, " ");
        setDealImport({
          status: "loading",
          message: `${readableStatus.charAt(0).toUpperCase()}${readableStatus.slice(1)}${progress > 0 ? ` · ${percent}%` : ""}`,
          fields: [],
        });
      });
      if (!result.fieldNames.length) {
        setDealImport({
          status: "error",
          message: "The file contains readable text, but its labels did not match the supported dealer fields. Enter the figures manually and double-check the worksheet.",
          fields: [],
        });
        return;
      }
      setDeal((current) => ({ ...current, ...(result.fields as Partial<Deal>) }));
      setDealImport({
        status: "success",
        message: `Filled ${result.fieldNames.length} field${result.fieldNames.length === 1 ? "" : "s"} from ${file.name}${result.sourceType === "pdf" ? ` (${result.pageCount} page${result.pageCount === 1 ? "" : "s"}${result.usedOcr ? ", scanned-document OCR" : ""})` : ""}. Review every imported value against the original before using the audit.`,
        fields: result.fieldNames,
      });
    } catch (error) {
      console.error("PencilProof document import failed", error);
      const unreadableImage = error instanceof Error && error.message === "UNREADABLE_IMAGE";
      setDealImport({
        status: "error",
        message: unreadableImage
          ? "PencilProof could not find enough readable text in that image or scanned PDF. Try a brighter, sharper copy or enter the figures manually."
          : "PencilProof could not read this file. It may be password-protected, blurry, or use an unsupported format. Your file was not uploaded; enter the figures manually.",
        fields: [],
      });
    }
  };

  const handleDealFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await importDealFile(file);
  };

  const analysis = useMemo(() => {
    const addons =
      deal.serviceContract +
      deal.gap +
      deal.prepaidMaintenance +
      deal.protection +
      deal.accessories;
    const totalFees = deal.govFees + deal.docFee;
    const tradeEquity = deal.tradeValue - deal.tradePayoff;
    const amountFinanced = Math.max(
      0,
      deal.sellingPrice +
        deal.tax +
        totalFees +
        addons +
        deal.tradePayoff -
        deal.tradeValue -
        deal.cashDown -
        deal.rebate,
    );
    const amountWithoutProducts = Math.max(0, amountFinanced - addons);
    const calculatedPayment = paymentFor(amountFinanced, deal.apr, deal.term);
    const paymentWithoutProducts = paymentFor(amountWithoutProducts, deal.apr, deal.term);
    const productPaymentImpact = Math.max(0, calculatedPayment - paymentWithoutProducts);
    const productCostOverTerm = productPaymentImpact * deal.term;
    const productFinancingCost = Math.max(0, productCostOverTerm - addons);
    const desiredPayment = deal.outsideApr > 0 ? paymentFor(amountFinanced, deal.outsideApr, deal.term) : 0;
    const paymentGap = deal.quotedPayment > 0 ? deal.quotedPayment - calculatedPayment : 0;
    const financeCharge = Math.max(0, calculatedPayment * deal.term - amountFinanced);
    const totalPayments = calculatedPayment * deal.term;
    const aprCost = desiredPayment > 0 ? Math.max(0, (calculatedPayment - desiredPayment) * deal.term) : 0;
    const aprGap = deal.outsideApr > 0 ? deal.apr - deal.outsideApr : 0;

    let score = 100;
    if (addons > 0) score -= Math.min(22, Math.max(5, Math.round(addons / 250)));
    if (aprGap >= 2) score -= 16;
    else if (aprGap >= 1) score -= 11;
    else if (aprGap >= 0.25) score -= 6;
    if (deal.term >= 84) score -= 14;
    else if (deal.term > 72) score -= 9;
    else if (deal.term > 60) score -= 4;
    if (Math.abs(paymentGap) > 10) score -= 18;
    else if (Math.abs(paymentGap) > 4) score -= 9;
    if (tradeEquity < 0) score -= Math.min(14, Math.max(5, Math.round(Math.abs(tradeEquity) / 500)));
    if (deal.docFee > 1000) score -= 8;
    score = Math.max(20, Math.round(score));

    const flags: { tone: "warn" | "good" | "note"; title: string; detail: string }[] = [];
    if (addons > 0) {
      flags.push({
        tone: "warn",
        title: `${dollars(addons)} in entered optional products`,
        detail: `${dollars(productPaymentImpact)}/month and about ${dollars(productCostOverTerm)} over the entered term when financed at the entered APR.`,
      });
    } else {
      flags.push({
        tone: "good",
        title: "No optional products entered",
        detail: "Check the worksheet carefully for service contracts, GAP, maintenance, protection packages, and accessories.",
      });
    }
    if (aprGap >= 0.25) {
      flags.push({
        tone: "warn",
        title: `Dealer APR is ${aprGap.toFixed(2)} points above your desired APR`,
        detail: aprCost > 0
          ? `At your desired rate, the estimated payment is ${dollars(desiredPayment)}/month—about ${dollars(aprCost)} less over the full term.`
          : "Compare the dealer offer with your target rate before signing.",
      });
    } else if (deal.outsideApr > 0) {
      flags.push({
        tone: "good",
        title: "Dealer APR meets your desired rate",
        detail: "The entered dealer rate is close to or below your desired APR.",
      });
    }
    if (deal.quotedPayment > 0 && Math.abs(paymentGap) > 4) {
      flags.push({
        tone: "warn",
        title: `Payment differs by ${dollars(Math.abs(paymentGap))}/month`,
        detail: `The entered figures calculate to about ${dollars(calculatedPayment)}/month. Ask which figure is missing or different.`,
      });
    } else if (deal.quotedPayment > 0) {
      flags.push({
        tone: "good",
        title: "Payment math is close",
        detail: `The entered figures calculate to about ${dollars(calculatedPayment)}/month.`,
      });
    }
    if (tradeEquity < 0) {
      flags.push({
        tone: "warn",
        title: `${dollars(Math.abs(tradeEquity))} of negative trade equity`,
        detail: "That old loan balance is being added to the new loan and can leave you upside-down longer.",
      });
    }
    if (deal.term >= 84) {
      flags.push({
        tone: "warn",
        title: `${deal.term}-month term`,
        detail: "A very long term lowers the payment but increases total interest and slows equity growth.",
      });
    } else if (deal.term > 60) {
      flags.push({
        tone: "note",
        title: `${deal.term}-month term`,
        detail: `Estimated finance charge is ${dollars(financeCharge)} if the loan is kept for the full term.`,
      });
    }
    if (!deal.sellingPrice) {
      flags.unshift({
        tone: "note",
        title: "Start with the dealer worksheet",
        detail: "Enter the written figures or load the sample to see how a complete audit works.",
      });
    }

    const productInsights: ProductInsight[] = [];
    if (deal.serviceContract > 0) {
      productInsights.push({
        name: "Vehicle service contract (VSC)",
        amount: deal.serviceContract,
        explanation: "May cover certain mechanical or electrical repairs under a separate contract. Coverage, exclusions, deductible, term, provider, and cancellation rules determine its value.",
        question: "Can I see the full contract, cash price, deductible, covered systems, exclusions, expiration mileage, and cancellation terms before deciding?",
      });
    }
    if (deal.gap > 0) {
      productInsights.push({
        name: "GAP protection",
        amount: deal.gap,
        explanation: "May cover some or all of the difference between an insurance settlement and the loan balance after a covered total loss. Benefit limits and exclusions vary.",
        question: "What is the benefit limit, what is excluded, when does coverage end, and how does this price compare with my insurer or lender?",
      });
    }
    if (deal.prepaidMaintenance > 0) {
      productInsights.push({
        name: "Prepaid maintenance (PPM)",
        amount: deal.prepaidMaintenance,
        explanation: "Prepays listed scheduled-maintenance services. It is not a repair warranty and may be limited by time, mileage, service locations, or included operations.",
        question: "Which exact services and intervals are included, where can I use it, and what would those services cost if I paid as I went?",
      });
    }
    if (deal.protection > 0) {
      productInsights.push({
        name: "Appearance or protection products",
        amount: deal.protection,
        explanation: "May include paint, fabric, wheel, tire, key, theft, or other protection. Product benefits and whether treatment was already applied should be itemized.",
        question: "What exact products are included, what has already been installed, what claims are covered, and can I decline the package?",
      });
    }
    if (deal.accessories > 0) {
      productInsights.push({
        name: "Accessories and other add-ons",
        amount: deal.accessories,
        explanation: "Dealer-installed equipment can be useful, but it also increases the amount financed and may cost more than purchasing comparable equipment separately.",
        question: "Please itemize every accessory, its installed price, and whether the vehicle can be purchased without it.",
      });
    }

    return {
      addons,
      tradeEquity,
      amountFinanced,
      calculatedPayment,
      paymentWithoutProducts,
      productPaymentImpact,
      productCostOverTerm,
      productFinancingCost,
      financeCharge,
      totalPayments,
      desiredPayment,
      aprCost,
      aprGap,
      score,
      flags,
      productInsights,
    };
  }, [deal]);

  const productRequest = analysis.addons > 0
    ? `Removes the entered optional products totaling ${dollars(analysis.addons)} and shows the revised payment without them.`
    : "Confirms in writing whether any optional products are included or required.";
  const rateRequest = analysis.aprGap >= 0.25
    ? `Shows whether you can match or beat my desired APR of ${deal.outsideApr.toFixed(2)}%.`
    : "Confirms the final APR and term, subject only to lender approval.";
  const message = `Thanks for the quote on the ${deal.vehicle || "vehicle"}. Before I move forward, please send a revised buyer's order that:\n\n1. Shows the selling price of ${dollars(deal.sellingPrice)} before tax and government fees.\n2. Separately itemizes every dealer fee and optional product.\n3. ${productRequest}\n4. ${rateRequest}\n5. Confirms there are no additional mandatory dealer charges beyond the revised buyer's order.\n\nPlease quote the out-the-door total, amount financed, APR, term, and payment—not only the monthly payment.`;

  const copyMessage = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <main className="analyzer-page">
      <nav className="site-nav analyzer-nav" aria-label="Main navigation">
        <Link className="brand" href="/"><span className="brand-mark">P</span><span>PencilProof</span></Link>
        <span className="privacy-chip">Your deal inputs stay in this browser</span>
      </nav>

      <header className="analyzer-header shell">
        <div>
          <p className="kicker">COMPLETE DEAL AUDIT</p>
          <h1>Rebuild it before you sign it.</h1>
          <p>Use the written figures from the dealership. The audit updates as you type and separates the vehicle, financing, trade, and products.</p>
        </div>
        <div className="analyzer-actions">
          <button type="button" onClick={() => { setDeal(sample); setDealImport({ status: "idle", message: "", fields: [] }); }}>Load sample</button>
          <button type="button" onClick={() => { setDeal(blank); setDealImport({ status: "idle", message: "", fields: [] }); }}>Clear all</button>
        </div>
      </header>

      <section className="pdf-import shell" aria-labelledby="pdf-import-title">
        <div className="pdf-import-main">
          <div className="pdf-badge" aria-hidden="true">SCAN</div>
          <div>
            <p className="pdf-kicker">OPTIONAL QUICK START</p>
            <h2 id="pdf-import-title">Upload the dealer worksheet or photo</h2>
            <p>Choose a digital or scanned PDF, JPG, JPEG, or PNG. PencilProof reads it in this browser and fills recognizable fields; the document is not sent to PencilProof.</p>
          </div>
          <label className={`pdf-upload-button ${dealImport.status === "loading" ? "pdf-upload-loading" : ""}`}>
            <input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" disabled={dealImport.status === "loading"} onChange={handleDealFileChange} />
            {dealImport.status === "loading" ? "Reading file…" : "Choose PDF or image"}
          </label>
        </div>
        {dealImport.status !== "idle" ? (
          <div className={`pdf-import-status pdf-status-${dealImport.status}`} role="status" aria-live="polite">
            <span aria-hidden="true">{dealImport.status === "success" ? "✓" : dealImport.status === "error" ? "!" : "…"}</span>
            <div>
              <p>{dealImport.message}</p>
              {dealImport.fields.length ? <div className="pdf-field-list">{dealImport.fields.map((field) => <small key={field}>{field}</small>)}</div> : null}
            </div>
          </div>
        ) : null}
        <p className="pdf-import-note">Best results: use a dealer-generated PDF or a bright, sharp, straight-on image with the full figures visible. Scanned PDFs use OCR on up to the first five pages. OCR can make mistakes, so compare every imported value with the original.</p>
      </section>

      <div className="analyzer-layout shell">
        <form className="deal-form" onSubmit={(event) => event.preventDefault()}>
          <section className="form-section">
            <div className="form-section-title"><span>01</span><div><h2>Vehicle & price</h2><p>Start with the top of the buyer&apos;s order or dealer worksheet.</p></div></div>
            <label className="input-field full-field"><span>Vehicle description</span><input aria-label="Vehicle description" type="text" placeholder="e.g. 2026 Honda CR-V EX-L" value={deal.vehicle} onChange={(event) => setDeal((current) => ({ ...current, vehicle: event.target.value }))} /></label>
            <div className="field-grid">
              <MoneyField label="Selling price" field="sellingPrice" value={deal.sellingPrice} onChange={setNumber} />
              <MoneyField label="Rebate or discount" field="rebate" value={deal.rebate} onChange={setNumber} hint="Only if not already deducted" />
              <MoneyField label="Sales tax" field="tax" value={deal.tax} onChange={setNumber} />
              <MoneyField label="Cash down" field="cashDown" value={deal.cashDown} onChange={setNumber} />
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-title"><span>02</span><div><h2>Fees & finance products</h2><p>Use the individual prices shown on the worksheet or product menu.</p></div></div>
            <div className="field-grid">
              <MoneyField label="Government / registration" field="govFees" value={deal.govFees} onChange={setNumber} />
              <MoneyField label="Dealer documentation fee" field="docFee" value={deal.docFee} onChange={setNumber} />
              <MoneyField label="VSC / service contract" field="serviceContract" value={deal.serviceContract} onChange={setNumber} hint="Sometimes called an extended warranty" />
              <MoneyField label="GAP protection" field="gap" value={deal.gap} onChange={setNumber} />
              <MoneyField label="Prepaid maintenance (PPM)" field="prepaidMaintenance" value={deal.prepaidMaintenance} onChange={setNumber} />
              <MoneyField label="Appearance / protection products" field="protection" value={deal.protection} onChange={setNumber} />
              <MoneyField label="Accessories / other add-ons" field="accessories" value={deal.accessories} onChange={setNumber} />
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-title"><span>03</span><div><h2>Trade & financing</h2><p>Use the actual trade payoff and the APR—not only the monthly payment.</p></div></div>
            <div className="field-grid">
              <MoneyField label="Trade allowance" field="tradeValue" value={deal.tradeValue} onChange={setNumber} />
              <MoneyField label="Trade loan payoff" field="tradePayoff" value={deal.tradePayoff} onChange={setNumber} />
            </div>
            <div className="field-grid field-grid-four">
              <label className="input-field"><span>Dealer APR</span><div className="input-money input-percent"><input aria-label="Dealer APR" inputMode="decimal" type="number" min="0" step="0.01" value={deal.apr || ""} onChange={(event) => setNumber("apr", event.target.value)} /><i>%</i></div></label>
              <label className="input-field"><span>Your desired APR</span><div className="input-money input-percent"><input aria-label="Your desired APR" inputMode="decimal" type="number" min="0" step="0.01" value={deal.outsideApr || ""} onChange={(event) => setNumber("outsideApr", event.target.value)} /><i>%</i></div><small>See the estimated payment at your target rate</small></label>
              <label className="input-field"><span>Loan term</span><select aria-label="Loan term" value={deal.term} onChange={(event) => setNumber("term", event.target.value)}><option value="36">36 months</option><option value="48">48 months</option><option value="60">60 months</option><option value="72">72 months</option><option value="75">75 months</option><option value="84">84 months</option><option value="96">96 months</option></select></label>
              <MoneyField label="Quoted monthly payment" field="quotedPayment" value={deal.quotedPayment} onChange={setNumber} />
            </div>
          </section>
        </form>

        <aside className="results-panel" aria-live="polite">
          <div className="results-sticky">
            <div className="result-top">
              <div><p>DEAL CLARITY SCORE</p><h2>{deal.vehicle || "Your finance deal"}</h2></div>
              <div className={`big-score score-${analysis.score >= 80 ? "good" : analysis.score >= 60 ? "mid" : "low"}`}><strong>{analysis.score}</strong><span>/100</span></div>
            </div>
            <p className="score-note">This scores the transparency and structure of the entered figures—not the vehicle&apos;s market value, condition, or reliability.</p>

            <div className="payment-compare">
              <div><span>REBUILT PAYMENT</span><strong>{dollars(analysis.calculatedPayment)}<small>/mo</small></strong><small>with entered products</small></div>
              <b aria-hidden="true">→</b>
              <div><span>AT YOUR DESIRED APR</span><strong>{deal.outsideApr > 0 ? dollars(analysis.desiredPayment) : "—"}{deal.outsideApr > 0 ? <small>/mo</small> : null}</strong><small>{deal.outsideApr > 0 ? `${deal.outsideApr.toFixed(2)}% · same amount and term` : "Enter your desired APR to compare"}</small></div>
            </div>

            <div className="result-numbers">
              <div><span>Estimated amount financed</span><strong>{dollars(analysis.amountFinanced)}</strong></div>
              <div><span>Entered optional products</span><strong>{dollars(analysis.addons)}</strong></div>
              <div><span>Total of payments</span><strong>{dollars(analysis.totalPayments)}</strong></div>
              <div><span>Total finance charge</span><strong>{dollars(analysis.financeCharge)}</strong></div>
            </div>

            <div className="result-section-title"><span>PRIORITY FINDINGS</span></div>
            <div className="result-flags">
              {analysis.flags.map((flag, index) => (
                <div className={`result-flag result-${flag.tone}`} key={`${flag.title}-${index}`}>
                  <span>{flag.tone === "good" ? "✓" : flag.tone === "warn" ? "!" : "i"}</span>
                  <p><b>{flag.title}</b><small>{flag.detail}</small></p>
                </div>
              ))}
            </div>

            <div className="product-breakdown">
              <div className="result-section-title"><span>WHAT THE PRODUCTS DO</span></div>
              {analysis.productInsights.length ? analysis.productInsights.map((product) => (
                <article className="product-insight" key={product.name}>
                  <div><h3>{product.name}</h3><strong>{dollars(product.amount)}</strong></div>
                  <p>{product.explanation}</p>
                  <small><b>Ask:</b> {product.question}</small>
                </article>
              )) : (
                <p className="empty-products">Enter any VSC, GAP, maintenance, protection, or accessory prices shown on the quote to receive product-specific guidance.</p>
              )}
            </div>

            <div className="dealer-message">
              <div><p>MESSAGE TO THE DEALER</p><button type="button" onClick={copyMessage}>{copied ? "Copied" : "Copy message"}</button></div>
              <pre>{message}</pre>
            </div>
            <button className="print-button" type="button" onClick={() => window.print()}>Print or save this Deal Audit</button>
            <p className="result-disclaimer">Educational estimate only. Coverage, taxes, fees, trade credits, lender rules, and product terms vary. Verify every figure and contract before signing. No savings are guaranteed.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
