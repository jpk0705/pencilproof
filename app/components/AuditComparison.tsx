"use client";

import { useEffect, useState } from "react";

export type AuditComparisonRecord = {
  id: string;
  createdAt: number;
  expiresAt: number;
  data: Record<string, unknown>;
};

type CompareField = {
  key: string;
  label: string;
  kind: "text" | "money" | "percent" | "months" | "verdict";
};

const compareFields: CompareField[] = [
  { key: "vehicle", label: "Vehicle", kind: "text" },
  { key: "vin", label: "VIN", kind: "text" },
  { key: "sellingPrice", label: "Selling price", kind: "money" },
  { key: "rebate", label: "Rebate", kind: "money" },
  { key: "tax", label: "Sales tax", kind: "money" },
  { key: "govFees", label: "Government / registration fees", kind: "money" },
  { key: "docFee", label: "Documentation fee", kind: "money" },
  { key: "serviceContract", label: "VSC / service contract", kind: "money" },
  { key: "gap", label: "GAP protection", kind: "money" },
  { key: "prepaidMaintenance", label: "Prepaid maintenance", kind: "money" },
  { key: "tireWheel", label: "Tire & wheel protection", kind: "money" },
  { key: "accessories", label: "Accessories / other add-ons", kind: "money" },
  { key: "tradeValue", label: "Trade allowance", kind: "money" },
  { key: "tradePayoff", label: "Trade payoff", kind: "money" },
  { key: "cashDown", label: "Cash down", kind: "money" },
  { key: "apr", label: "Dealer APR", kind: "percent" },
  { key: "outsideApr", label: "Desired APR", kind: "percent" },
  { key: "term", label: "Loan term", kind: "months" },
  { key: "quotedPayment", label: "Printed monthly payment", kind: "money" },
  { key: "calculatedPayment", label: "Estimated payment", kind: "money" },
  { key: "verdict", label: "Audit result", kind: "verdict" },
];

const date = (seconds: number) => new Date(seconds * 1000).toLocaleDateString();

const valueFor = (audit: AuditComparisonRecord, field: CompareField): string => {
  const raw = audit.data[field.key];
  if (field.kind === "verdict") {
    if (!raw || typeof raw !== "object") return "Not available";
    return String((raw as { label?: unknown }).label ?? "Audit completed");
  }
  if (raw === undefined || raw === null || raw === "") return "Not entered";
  if (field.kind === "text") return String(raw);
  const number = Number(raw);
  if (!Number.isFinite(number)) return String(raw);
  if (field.kind === "percent") return `${number.toFixed(2)}%`;
  if (field.kind === "months") return `${number} months`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(number);
};

const optionLabel = (audit: AuditComparisonRecord) => {
  const vehicle = String(audit.data.vehicle ?? "PencilProof Full Quote Audit");
  return `${vehicle} · ${date(audit.createdAt)}`;
};

export default function AuditComparison({ audits }: { audits: AuditComparisonRecord[] }) {
  const [leftId, setLeftId] = useState(audits[0]?.id ?? "");
  const [rightId, setRightId] = useState(audits[1]?.id ?? "");

  useEffect(() => {
    if (!audits.some((audit) => audit.id === leftId)) setLeftId(audits[0]?.id ?? "");
    if (!audits.some((audit) => audit.id === rightId) || leftId === rightId) {
      setRightId(audits.find((audit) => audit.id !== leftId)?.id ?? "");
    }
  }, [audits, leftId, rightId]);

  if (audits.length < 2) return null;

  const left = audits.find((audit) => audit.id === leftId) ?? audits[0];
  const right = audits.find((audit) => audit.id === rightId) ?? audits.find((audit) => audit.id !== left.id) ?? audits[1];

  const chooseLeft = (id: string) => {
    setLeftId(id);
    if (id === right.id) setRightId(audits.find((audit) => audit.id !== id)?.id ?? "");
  };
  const chooseRight = (id: string) => {
    setRightId(id);
    if (id === left.id) setLeftId(audits.find((audit) => audit.id !== id)?.id ?? "");
  };

  return (
    <section className="audit-compare" aria-labelledby="audit-compare-title">
      <div className="audit-compare-heading">
        <div>
          <p className="kicker">COMPARE SAVED AUDITS</p>
          <h3 id="audit-compare-title">See two quote versions side by side.</h3>
          <p>Compare the written figures, products, trade numbers, payment, and VIN without reopening each audit.</p>
        </div>
        <span>{audits.length} available</span>
      </div>

      <div className="audit-compare-pickers">
        <label>
          <span>First audit</span>
          <select value={left.id} onChange={(event) => chooseLeft(event.target.value)} aria-label="First audit to compare">
            {audits.map((audit) => <option key={audit.id} value={audit.id}>{optionLabel(audit)}</option>)}
          </select>
        </label>
        <label>
          <span>Second audit</span>
          <select value={right.id} onChange={(event) => chooseRight(event.target.value)} aria-label="Second audit to compare">
            {audits.map((audit) => <option key={audit.id} value={audit.id}>{optionLabel(audit)}</option>)}
          </select>
        </label>
      </div>

      <div className="audit-compare-table" role="table" aria-label="Saved audit comparison">
        <div className="audit-compare-table-head" role="row">
          <span role="columnheader">What to compare</span>
          <span role="columnheader"><strong>{String(left.data.vehicle ?? "First audit")}</strong><small>Completed {date(left.createdAt)}</small></span>
          <span role="columnheader"><strong>{String(right.data.vehicle ?? "Second audit")}</strong><small>Completed {date(right.createdAt)}</small></span>
        </div>
        {compareFields.map((field) => {
          const leftValue = valueFor(left, field);
          const rightValue = valueFor(right, field);
          const changed = leftValue !== rightValue;
          return <div className={`audit-compare-row${changed ? " is-changed" : ""}`} role="row" key={field.key}>
            <span role="rowheader">{field.label}{changed ? <em>Changed</em> : null}</span>
            <strong role="cell">{leftValue}</strong>
            <strong role="cell">{rightValue}</strong>
          </div>;
        })}
      </div>
      <p className="audit-compare-note">Highlighted rows differ between the two saved audits. PencilProof shows the figures as entered; verify any revised worksheet before relying on it.</p>
    </section>
  );
}
