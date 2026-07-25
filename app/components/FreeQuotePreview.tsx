"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { CHECKOUT_URL, QUOTE_HANDOFF_KEY } from "@/lib/checkout";
import {
  DEAL_FIELD_LABELS,
  extractDealFromFile,
  type DealPdfResult,
  type ImportedDealFields,
} from "@/lib/deal-pdf";
import { paymentFor } from "@/lib/deal-calculations";
import {
  countPreviewReviewAreas,
  countPricedProducts,
  isPreviewImportUsable,
  shouldOfferManualEntry,
} from "@/lib/deal-review";
import VehiclePhoto from "@/app/components/VehiclePhoto";

type ScanState =
  | { status: "idle" }
  | { status: "loading"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; result: DealPdfResult; fileName: string };

const previewFields: (keyof ImportedDealFields)[] = [
  "vehicle",
  "sellingPrice",
  "rebate",
  "tax",
  "govFees",
  "docFee",
  "serviceContract",
  "gap",
  "prepaidMaintenance",
  "protection",
  "accessories",
  "tradeValue",
  "tradePayoff",
  "cashDown",
  "apr",
  "term",
  "quotedPayment",
];

const money = (value: number, cents = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(Number.isFinite(value) ? value : 0);

const formatValue = (field: keyof ImportedDealFields, value: string | number) => {
  if (field === "vehicle") return String(value);
  if (field === "apr" || field === "outsideApr") return `${Number(value).toFixed(2)}%`;
  if (field === "term") return `${Number(value)} months`;
  return money(Number(value), field === "quotedPayment");
};

export default function FreeQuotePreview() {
  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const [importReviewed, setImportReviewed] = useState(false);
  const [failedImportAttempts, setFailedImportAttempts] = useState(0);
  const [manualMode, setManualMode] = useState(false);
  const [manualFields, setManualFields] = useState<ImportedDealFields>({ term: 72 });
  const [manualError, setManualError] = useState("");

  const showManualFallback = shouldOfferManualEntry(failedImportAttempts);

  const failImport = (message: string) => {
    setFailedImportAttempts((attempts) => attempts + 1);
    setScan({ status: "error", message });
  };

  const updateManualField = (
    field: keyof ImportedDealFields,
    rawValue: string,
  ) => {
    const value =
      field === "vehicle"
        ? rawValue
        : rawValue === ""
          ? undefined
          : Number(rawValue);
    setManualFields((fields) => ({ ...fields, [field]: value }));
    setManualError("");
  };

  const previewManualEntry = () => {
    const fields = Object.fromEntries(
      Object.entries(manualFields).filter(
        ([, value]) => value !== undefined && value !== "",
      ),
    ) as ImportedDealFields;
    const fieldNames = previewFields
      .filter((field) => fields[field] !== undefined)
      .map((field) => DEAL_FIELD_LABELS[field]);
    if (!isPreviewImportUsable({ fields, fieldNames, offerMatrix: undefined })) {
      setManualError(
        "Enter at least the selling price plus two other deal figures. APR, term, and the dealer’s quoted payment produce the most useful preview.",
      );
      return;
    }
    const fieldConfidence = previewFields.reduce<
      DealPdfResult["fieldConfidence"]
    >((confidence, field) => {
      if (fields[field] !== undefined) confidence[field] = "review";
      return confidence;
    }, {});
    setImportReviewed(false);
    setFailedImportAttempts(0);
    setManualMode(false);
    setScan({
      status: "ready",
      fileName: "Manual quote entry",
      result: {
        fields,
        fieldConfidence,
        fieldNames,
        pageCount: 0,
        sourceType: "pdf",
      },
    });
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportReviewed(false);

    const lowerName = file.name.toLowerCase();
    const supported =
      file.type === "application/pdf" ||
      file.type === "image/jpeg" ||
      file.type === "image/png" ||
      /\.(pdf|jpe?g|png)$/.test(lowerName);
    if (!supported) {
      setScan({ status: "error", message: "Choose a dealer PDF, JPG, JPEG, or PNG file." });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setScan({ status: "error", message: "That file is larger than 15 MB. Try a smaller copy." });
      return;
    }

    setScan({ status: "loading", message: `Reading ${file.name} in your browser…` });
    try {
      const result = await extractDealFromFile(file, ({ progress, status }) => {
        const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
        const readable = status.replace(/_/g, " ");
        setScan({
          status: "loading",
          message: `${readable.charAt(0).toUpperCase()}${readable.slice(1)}${progress > 0 ? ` · ${percent}%` : ""}`,
        });
      });
      if (!isPreviewImportUsable(result)) {
        failImport(
          "PencilProof found some text, but not enough deal information for a useful preview. Try a clearer or more complete copy before paying.",
        );
        return;
      }
      setFailedImportAttempts(0);
      setScan({ status: "ready", result, fileName: file.name });
    } catch {
      failImport(
        "PencilProof could not read this file. Try a brighter, sharper copy before paying.",
      );
    }
  };

  const preview = useMemo(() => {
    if (scan.status !== "ready") return null;
    const fields = scan.result.fields;
    const products =
      (fields.serviceContract ?? 0) +
      (fields.gap ?? 0) +
      (fields.prepaidMaintenance ?? 0) +
      (fields.protection ?? 0) +
      (fields.accessories ?? 0);
    const amountFinanced = fields.sellingPrice
      ? Math.max(
          0,
          fields.sellingPrice +
            (fields.tax ?? 0) +
            (fields.govFees ?? 0) +
            (fields.docFee ?? 0) +
            products +
            (fields.tradePayoff ?? 0) -
            (fields.tradeValue ?? 0) -
            (fields.cashDown ?? 0) -
            (fields.rebate ?? 0),
        )
      : 0;
    const calculatedPayment =
      amountFinanced && fields.apr && fields.term
        ? paymentFor(amountFinanced, fields.apr, fields.term)
        : 0;
    const paymentDifference =
      calculatedPayment && fields.quotedPayment
        ? Math.abs(fields.quotedPayment - calculatedPayment)
        : 0;
    const criticalFields: (keyof ImportedDealFields)[] = [
      "sellingPrice",
      "tax",
      "apr",
      "term",
      "quotedPayment",
    ];
    const missingCritical = criticalFields.filter((field) => fields[field] === undefined);
    const found = previewFields.filter((field) => fields[field] !== undefined);
    const highConfidence = found.filter(
      (field) => scan.result.fieldConfidence[field] === "high",
    ).length;
    const reviewCount = found.length - highConfidence;
    const pricedProductCount = countPricedProducts(fields);
    const hasPaymentMismatch = paymentDifference > 5;
    const reviewAreas = countPreviewReviewAreas({
      fields,
      hasPaymentMismatch,
      hasMissingCriticalInformation: missingCritical.length > 0,
      hasOfferMatrix: Boolean(scan.result.offerMatrix),
    });
    const paymentTone =
      !calculatedPayment || !fields.quotedPayment
        ? "preview-note"
        : paymentDifference > 5
          ? "preview-warn"
          : "preview-good";

    return {
      fields,
      found,
      highConfidence,
      reviewCount,
      products,
      pricedProductCount,
      amountFinanced,
      calculatedPayment,
      paymentDifference,
      hasPaymentMismatch,
      paymentTone,
      missingCritical,
      reviewAreas,
    };
  }, [scan]);

  return (
    <section className="section free-scan-section" id="free-scan">
      <div className="shell free-scan-layout">
        <div className="free-scan-copy">
          <p className="kicker">PROVE IT WORKS BEFORE YOU PAY</p>
          <h2>Upload free. Check every imported number. Pay only if it looks right.</h2>
          <p>
            Your file stays in this browser. The free scan shows exactly what
            imported, what is missing, and which values need review before
            checkout becomes available.
          </p>
          <ul>
            <li>See the detected numbers before checkout</li>
            <li>Compare every value with the original quote</li>
            <li>Get a limited math and issue preview</li>
            <li>Do not pay if the import is not useful</li>
          </ul>
        </div>

        <div className="free-scan-card">
          <div className="free-scan-head">
            <div>
              <span>FREE QUOTE CHECK</span>
              <h3>{scan.status === "ready" ? scan.fileName : "Does PencilProof read my quote?"}</h3>
            </div>
            <span className="free-badge">
              {scan.status === "ready" && preview
                ? preview.reviewAreas
                  ? `${preview.reviewAreas} TO REVIEW`
                  : "SCAN COMPLETE"
                : scan.status === "loading"
                  ? "READING QUOTE"
                  : "FREE PREVIEW"}
            </span>
          </div>

          {scan.status === "idle" ? (
            <div className="free-scan-drop">
              <strong>Start with the written quote</strong>
              <p>Use a dealer-generated PDF or a bright, sharp photo with the full page visible.</p>
              <label className="button button-primary">
                Upload PDF or image
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                  onChange={handleFile}
                />
              </label>
              <small>PDF, JPG, JPEG, or PNG · up to 15 MB</small>
            </div>
          ) : null}

          {scan.status === "loading" ? (
            <div className="free-scan-progress" role="status" aria-live="polite">
              <span>…</span>
              <div><strong>Reading your quote</strong><p>{scan.message}</p></div>
            </div>
          ) : null}

          {scan.status === "error" ? (
            <div className="free-scan-error" role="alert">
              <strong>
                {showManualFallback
                  ? "Two scans could not read enough of the quote."
                  : "This copy needs another try."}
              </strong>
              <p>{scan.message}</p>
              {showManualFallback ? (
                <p>
                  You can still test the deal before paying. Enter the written
                  figures yourself for the same limited preview, or try one
                  more file.
                </p>
              ) : null}
              <div className="free-scan-error-actions">
                <label className="button button-quiet">
                  {showManualFallback ? "Try another file" : "Choose another file"}
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                    onChange={handleFile}
                  />
                </label>
                {showManualFallback ? (
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => setManualMode((open) => !open)}
                    aria-expanded={manualMode}
                  >
                    Enter numbers manually
                  </button>
                ) : null}
              </div>
              {showManualFallback && manualMode ? (
                <div className="free-manual-entry">
                  <div>
                    <strong>Enter the figures shown on the quote</strong>
                    <p>Leave anything blank if the dealer did not provide it.</p>
                  </div>
                  <div className="free-manual-grid">
                    {previewFields.map((field) => (
                      <label
                        className={field === "vehicle" ? "manual-field-wide" : ""}
                        key={field}
                      >
                        <span>{DEAL_FIELD_LABELS[field]}</span>
                        <input
                          aria-label={`Manual ${DEAL_FIELD_LABELS[field]}`}
                          type={field === "vehicle" ? "text" : "number"}
                          inputMode={field === "vehicle" ? undefined : "decimal"}
                          min={field === "vehicle" ? undefined : "0"}
                          step={field === "term" ? "1" : "0.01"}
                          value={manualFields[field] ?? ""}
                          placeholder={
                            field === "vehicle"
                              ? "2026 Toyota RAV4 XLE Premium"
                              : field === "term"
                                ? "72"
                                : "0.00"
                          }
                          onChange={(event) =>
                            updateManualField(field, event.target.value)
                          }
                        />
                      </label>
                    ))}
                  </div>
                  {manualError ? <p className="free-manual-error">{manualError}</p> : null}
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={previewManualEntry}
                  >
                    Preview my numbers <span aria-hidden="true">→</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {scan.status === "ready" && preview ? (
            <div className="free-scan-results">
              <div className="free-scan-summary">
                <div><strong>{preview.found.length}</strong><span>values found</span></div>
                <div><strong>{preview.highConfidence}</strong><span>high confidence</span></div>
                <div><strong>{preview.reviewCount}</strong><span>need review</span></div>
                <div><strong>{scan.result.offerMatrix?.options.length ?? 0}</strong><span>payment choices</span></div>
              </div>

              <VehiclePhoto
                vehicle={String(preview.fields.vehicle ?? "")}
                compact
              />

              <div className="free-detected-values">
                {preview.found.map((field) => {
                  const value = preview.fields[field];
                  if (value === undefined) return null;
                  const confidence = scan.result.fieldConfidence[field] === "high" ? "high" : "review";
                  return (
                    <div key={field}>
                      <span>{DEAL_FIELD_LABELS[field]}</span>
                      <strong>{formatValue(field, value)}</strong>
                      <small className={`confidence-${confidence}`}>
                        {confidence === "high" ? "High confidence" : "Verify on quote"}
                      </small>
                    </div>
                  );
                })}
              </div>

              <div className="free-math-preview">
                <div>
                  <span>ESTIMATED AMOUNT FINANCED</span>
                  <strong>{preview.amountFinanced ? money(preview.amountFinanced, true) : "Not enough data"}</strong>
                  <small>Limited preview from the detected figures</small>
                </div>
                <div className="free-preview-statuses">
                  <p className={preview.paymentTone}>
                    <b>Payment math</b>
                    <span>
                      {!preview.calculatedPayment || !preview.fields.quotedPayment
                        ? "Enter the printed payment to compare"
                        : preview.hasPaymentMismatch
                          ? "Possible packed payment or undisclosed amount"
                          : "Quoted payment is within $5"}
                    </span>
                  </p>
                  <p className={preview.products > 0 ? "preview-warn" : "preview-note"}>
                    <b>Products and add-ons</b>
                    <span>
                      {preview.pricedProductCount > 0
                        ? `${preview.pricedProductCount} priced item${preview.pricedProductCount === 1 ? "" : "s"} detected`
                        : "No priced items detected"}
                    </span>
                  </p>
                  <p className={preview.missingCritical.length ? "preview-warn" : "preview-good"}>
                    <b>Required information</b>
                    <span>{preview.missingCritical.length ? `${preview.missingCritical.length} key item${preview.missingCritical.length === 1 ? "" : "s"} not found` : "Key fields found"}</span>
                  </p>
                </div>
              </div>

              <div className="free-unlock">
                <div>
                  <span>PREVIEW COMPLETE</span>
                  <strong>
                    {preview.reviewAreas
                      ? `${preview.reviewAreas} area${preview.reviewAreas === 1 ? "" : "s"} worth reviewing`
                      : "The quote is ready for a complete review"}
                  </strong>
                  <p>Unlock exact payment differences, product cost, APR scenarios, full-term totals, and a dealer-ready request.</p>
                </div>
                <label className="free-import-confirm">
                  <input
                    type="checkbox"
                    checked={importReviewed}
                    onChange={(event) => setImportReviewed(event.target.checked)}
                  />
                  <span>
                    <b>I compared the imported values with my quote.</b>
                    <small>I understand that missing fields must be entered manually and every value must be confirmed again before analysis.</small>
                  </span>
                </label>
                {importReviewed ? (
                  <a
                    className="button button-primary"
                    href={CHECKOUT_URL}
                    onClick={() => {
                      sessionStorage.setItem(
                        QUOTE_HANDOFF_KEY,
                        JSON.stringify({
                          fields: scan.result.fields,
                          confidence: scan.result.fieldConfidence,
                          fileName: scan.fileName,
                          offerMatrix: scan.result.offerMatrix ?? null,
                        }),
                      );
                    }}
                  >
                    Unlock full analysis · $39 <span aria-hidden="true">→</span>
                  </a>
                ) : (
                  <button className="button button-primary" type="button" disabled>
                    Review the imported values to continue
                  </button>
                )}
                <button type="button" onClick={() => { setScan({ status: "idle" }); setImportReviewed(false); }}>Scan another quote</button>
              </div>
            </div>
          ) : null}

          <p className="free-scan-note">
            OCR can make mistakes. Do not pay unless the detected values match
            your quote or you are comfortable entering missing figures manually.
            PencilProof is an educational estimate, not a lender approval or dealer offer.
          </p>
        </div>
      </div>
    </section>
  );
}
