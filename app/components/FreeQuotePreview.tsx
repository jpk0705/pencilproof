"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  CHECKOUT_URL,
  createQuoteHandoffEnvelope,
} from "@/lib/checkout";
import {
  DEAL_IMPORT_ACCEPT,
  DEAL_FIELD_LABELS,
  extractDealFromFile,
  isDealImportFile,
  type DealPdfResult,
  type DealOfferOption,
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
import { track } from "@/lib/analytics";

type ScanState =
  | { status: "idle" }
  | { status: "loading"; message: string; progress: number }
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
  "tireWheel",
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

export default function FreeQuotePreview() {
  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [importReviewed, setImportReviewed] = useState(false);
  const [failedImportAttempts, setFailedImportAttempts] = useState(0);
  const [manualMode, setManualMode] = useState(false);
  const [manualFields, setManualFields] = useState<ImportedDealFields>({ term: 72 });
  const [manualError, setManualError] = useState("");
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackCategory, setFeedbackCategory] = useState("clarity");
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const manualPanelRef = useRef<HTMLDivElement>(null);
  const uploadPanelRef = useRef<HTMLDivElement>(null);
  const shouldScrollToUploadRef = useRef(false);

  const showManualFallback = shouldOfferManualEntry(failedImportAttempts);

  useEffect(() => {
    if (!manualMode) return;
    const frame = requestAnimationFrame(() => {
      manualPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      manualPanelRef.current
        ?.querySelector<HTMLInputElement>("input")
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [manualMode]);

  useEffect(() => {
    if (scan.status !== "idle" || !shouldScrollToUploadRef.current) return;
    shouldScrollToUploadRef.current = false;
    const frame = requestAnimationFrame(() => {
      uploadPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [scan.status]);

  const failImport = (message: string) => {
    setFailedImportAttempts((attempts) => attempts + 1);
    setScan({ status: "error", message });
    track({ event: "import_failed" });
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

  const updateReadyField = (
    field: keyof ImportedDealFields,
    rawValue: string,
  ) => {
    setImportReviewed(false);
    setScan((current) => {
      if (current.status !== "ready") return current;
      const fields = { ...current.result.fields };
      const fieldConfidence = { ...current.result.fieldConfidence };
      const empty = rawValue.trim() === "";

      if (empty) {
        delete fields[field];
        delete fieldConfidence[field];
      } else {
        const editableFields = fields as Record<
          keyof ImportedDealFields,
          string | number | undefined
        >;
        editableFields[field] = field === "vehicle" ? rawValue : Number(rawValue);
        fieldConfidence[field] = "review";
      }

      return {
        ...current,
        result: {
          ...current.result,
          fields,
          fieldConfidence,
          fieldNames: previewFields
            .filter((candidate) => fields[candidate] !== undefined)
            .map((candidate) => DEAL_FIELD_LABELS[candidate]),
        },
      };
    });
  };

  const chooseOffer = (option: DealOfferOption) => {
    setSelectedOfferId(option.id);
    setImportReviewed(false);
    setScan((current) => {
      if (current.status !== "ready" || option.type !== "finance") return current;
      return {
        ...current,
        result: {
          ...current.result,
          fields: {
            ...current.result.fields,
            cashDown: option.cashDown,
            term: option.term,
            quotedPayment: option.payment,
            ...(option.apr !== undefined ? { apr: option.apr } : {}),
          },
          fieldNames: Array.from(new Set([
            ...current.result.fieldNames,
            DEAL_FIELD_LABELS.cashDown,
            DEAL_FIELD_LABELS.term,
            DEAL_FIELD_LABELS.quotedPayment,
            ...(option.apr !== undefined ? [DEAL_FIELD_LABELS.apr] : []),
          ])),
          fieldConfidence: {
            ...current.result.fieldConfidence,
            cashDown: "review",
            term: "review",
            quotedPayment: "review",
            ...(option.apr !== undefined ? { apr: "review" as const } : {}),
          },
        },
      };
    });
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
    track({ event: "audit_completed" });
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportReviewed(false);
    setSelectedOfferId("");

    if (!isDealImportFile(file)) {
      setScan({ status: "error", message: "Choose a dealer PDF or image file." });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setScan({ status: "error", message: "That file is larger than 15 MB. Try a smaller copy." });
      return;
    }

    setScan({ status: "loading", message: `Preparing ${file.name}…`, progress: 0.02 });
    track({ event: "scan_started" });
    try {
      const result = await extractDealFromFile(file, ({ progress, status }) => {
        const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
        const readable = status.replace(/_/g, " ");
        setScan({
          status: "loading",
          message: `${readable.charAt(0).toUpperCase()}${readable.slice(1)}${progress > 0 ? ` · ${percent}%` : ""}`,
          progress,
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
      track({ event: "import_success" });
      track({ event: "audit_completed" });
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
      (fields.tireWheel ?? 0) +
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
    const missing = previewFields.filter((field) => fields[field] === undefined);
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
      missing,
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

  const selectedOffer = scan.status === "ready"
    ? scan.result.offerMatrix?.options.find((option) => option.id === selectedOfferId)
    : undefined;

  return (
    <section className="section free-scan-section" id="free-scan">
      <div className="shell free-scan-layout">
        <div className="free-scan-copy">
          <p className="kicker">REVIEW YOUR QUOTE FIRST</p>
          <h2>Start with a free scan. Keep the decision in your hands.</h2>
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
                  ? "PROCESSING QUOTE"
                  : "FREE PREVIEW"}
            </span>
          </div>

          {scan.status === "idle" ? (
            <div className="free-scan-drop" ref={uploadPanelRef}>
              <strong>Start with the written quote</strong>
              <p>Use a dealer-generated PDF or a bright, sharp image with the full page visible.</p>
              <label className="button button-primary">
                Upload PDF or image
                <input
                  type="file"
                  accept={DEAL_IMPORT_ACCEPT}
                  capture="environment"
                  onChange={handleFile}
                />
              </label>
              <small>PDF or any image format · up to 15 MB</small>
            </div>
          ) : null}

          {scan.status === "loading" ? (
            <div className="free-scan-progress" role="status" aria-live="polite">
              <span className="free-scan-progress-icon" aria-hidden="true">↗</span>
              <div className="free-scan-progress-body">
                <div className="free-scan-progress-heading"><strong>Working on your quote</strong><b>{Math.round(scan.progress * 100)}%</b></div>
                <div className="free-scan-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(scan.progress * 100)}><span style={{ width: `${Math.max(3, Math.round(scan.progress * 100))}%` }} /></div>
                <p>{scan.message}</p>
                <small>Keep this screen open while PencilProof checks the document.</small>
              </div>
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
                    accept={DEAL_IMPORT_ACCEPT}
                    capture="environment"
                    onChange={handleFile}
                  />
                </label>
                {showManualFallback ? (
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => {
                      setManualMode(true);
                      track({ event: "manual_fallback_opened" });
                    }}
                    aria-expanded={manualMode}
                  >
                    {manualMode ? "Manual entry open below" : "Enter numbers manually"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {showManualFallback && manualMode ? (
            <div className="free-manual-entry" ref={manualPanelRef}>
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

          {scan.status === "ready" && preview ? (
            <div className="free-scan-results">
              <div className="free-scan-summary">
                <div><strong>{preview.found.length}</strong><span>values found</span></div>
                <div><strong>{preview.highConfidence}</strong><span>high confidence</span></div>
                <div><strong>{preview.reviewCount}</strong><span>need review</span></div>
                <div><strong>{scan.result.offerMatrix?.options.length ?? 0}</strong><span>payment choices</span></div>
              </div>

              {scan.result.offerMatrix ? (
                <div className="offer-matrix free-offer-matrix" aria-labelledby="free-offer-matrix-title">
                  <div className="offer-matrix-heading">
                    <div>
                      <p className="eyebrow">MULTIPLE OPTIONS DETECTED</p>
                      <h3 id="free-offer-matrix-title">Choose the payment option you plan to use</h3>
                    </div>
                    <span>{scan.result.offerMatrix.options.length} choices</span>
                  </div>
                  {(["finance", "lease"] as const).map((type) => {
                    const options = scan.result.offerMatrix?.options.filter((option) => option.type === type) ?? [];
                    if (!options.length) return null;
                    return (
                      <section className="offer-group" key={type} aria-label={`${type} options`}>
                        <div className="offer-group-title">
                          <h4>{type === "finance" ? "Finance alternatives" : "Lease estimates"}</h4>
                          <p>{type === "finance" ? "Select one row. This choice will be sent into your Full Quote Audit." : "Lease rows are shown for comparison only."}</p>
                        </div>
                        <div className="offer-options-grid">
                          {options.map((option) => (
                            <button
                              type="button"
                              key={option.id}
                              className={`offer-card ${selectedOfferId === option.id ? "offer-card-selected" : ""}`}
                              onClick={() => chooseOffer(option)}
                              aria-pressed={selectedOfferId === option.id}
                            >
                              <strong>{money(option.payment, true)}<small>/mo</small></strong>
                              <span>{option.term} months</span>
                              <span>{money(option.cashDown)} down</span>
                              {option.rebate !== undefined ? <em>{money(option.rebate)} rebate shown</em> : null}
                              <b>{selectedOfferId === option.id ? "Selected" : "Choose"}</b>
                            </button>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                  <p className="offer-matrix-warning">{scan.result.offerMatrix.warnings.join(" ")} Select the exact row you are considering. PencilProof will use its down payment, term, and printed payment for the audit.</p>
                </div>
              ) : null}

              <VehiclePhoto
                vehicle={String(preview.fields.vehicle ?? "")}
                compact
              />

              <div className={`free-import-warning ${preview.missing.length ? "free-import-warning-missing" : ""}`}>
                <strong>
                  {preview.missing.length
                    ? `Import incomplete: ${preview.missing.length} categor${preview.missing.length === 1 ? "y was" : "ies were"} not found`
                    : "Review every imported value"}
                </strong>
                <p>
                  {preview.missing.length
                    ? "Check the quote and enter any missing numbers below. A blank field may mean the item does not apply, or that OCR missed it."
                    : "OCR can still be wrong. Every value below is editable, and checkout will relock after a correction until you confirm the import again."}
                </p>
              </div>

              <div className="free-detected-values">
                {previewFields.map((field) => {
                  const value = preview.fields[field];
                  const confidence = value === undefined
                    ? "missing"
                    : scan.result.fieldConfidence[field] === "high"
                      ? "high"
                      : "review";
                  return (
                    <div className={`free-detected-field confidence-${confidence}`} key={field}>
                      <span>{DEAL_FIELD_LABELS[field]}</span>
                      <input
                        aria-label={`Review ${DEAL_FIELD_LABELS[field]}`}
                        type={field === "vehicle" ? "text" : "number"}
                        inputMode={field === "vehicle" ? undefined : "decimal"}
                        min={field === "vehicle" ? undefined : "0"}
                        step={field === "term" ? "1" : "0.01"}
                        value={value ?? ""}
                        placeholder={field === "vehicle" ? "Not found" : "0.00"}
                        onChange={(event) =>
                          updateReadyField(field, event.target.value)
                        }
                      />
                      <small>
                        {confidence === "missing"
                          ? "Not found — enter manually"
                          : confidence === "high"
                            ? "Imported — verify"
                            : "Verify on quote"}
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
                      : "The quote is ready for a Full Quote Audit"}
                  </strong>
                  <p>Review exact payment differences, product cost, APR scenarios, full-term totals, and a dealer-ready request.</p>
                </div>
                <label className="free-import-confirm">
                  <input
                    type="checkbox"
                    checked={importReviewed}
                    onChange={(event) => setImportReviewed(event.target.checked)}
                  />
                  <span>
                    <b>I compared the imported values with my quote.</b>
                    <small>I understand that missing fields must be entered manually and every value must be confirmed again before the audit.</small>
                  </span>
                </label>
                {importReviewed && (!scan.result.offerMatrix || selectedOffer) ? (
                  <a
                    className="button button-primary"
                    href={CHECKOUT_URL}
                    onClick={() => {
                      track({ event: "checkout_started" });
                      window.name = createQuoteHandoffEnvelope({
                        fields: scan.result.fields,
                        confidence: scan.result.fieldConfidence,
                        offerMatrix: scan.result.offerMatrix ?? null,
                        selectedOfferId: selectedOfferId || null,
                      });
                    }}
                  >
                    Review the Full Quote Audit · $39 <span aria-hidden="true">→</span>
                  </a>
                ) : (
                  <button className="button button-primary" type="button" disabled>
                    {scan.result.offerMatrix && !selectedOffer ? "Choose a payment option to continue" : "Review the imported values to continue"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    shouldScrollToUploadRef.current = true;
                    setScan({ status: "idle" });
                    setImportReviewed(false);
                    setManualMode(false);
                    setManualError("");
                  }}
                >
                  Scan another quote
                </button>
              </div>

              <div className="feedback-card">
                <div>
                  <span className="kicker">HELP US IMPROVE THE BETA</span>
                  <strong>Was this preview clear and useful?</strong>
                  <p>No quote, name, VIN, or payment details are collected in this form.</p>
                </div>
                {feedbackSent ? (
                  <p className="feedback-thanks" role="status">Thanks — your feedback was recorded.</p>
                ) : (
                  <form onSubmit={(event) => {
                    event.preventDefault();
                    if (!feedbackRating && !feedbackComment.trim()) return;
                    track({
                      category: feedbackCategory,
                      comment: feedbackComment.trim(),
                      event: "feedback_submitted",
                      value: feedbackRating,
                    });
                    setFeedbackSent(true);
                  }}>
                    <div className="feedback-rating" aria-label="Rate the preview">
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <button
                          aria-label={`${rating} out of 5`}
                          className={rating <= feedbackRating ? "selected" : ""}
                          key={rating}
                          onClick={() => setFeedbackRating(rating)}
                          type="button"
                        >★</button>
                      ))}
                    </div>
                    <label>
                      <span>What would you improve?</span>
                      <select value={feedbackCategory} onChange={(event) => setFeedbackCategory(event.target.value)}>
                        <option value="clarity">The result was confusing</option>
                        <option value="import">The numbers were imported incorrectly</option>
                        <option value="manual">Manual entry needs work</option>
                        <option value="trust">I had a trust or privacy concern</option>
                        <option value="other">Something else</option>
                      </select>
                    </label>
                    <label>
                      <span>Optional note</span>
                      <textarea maxLength={1000} value={feedbackComment} onChange={(event) => setFeedbackComment(event.target.value)} placeholder="Tell us what happened…" />
                    </label>
                    <button className="button button-quiet" type="submit">Send feedback</button>
                  </form>
                )}
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
