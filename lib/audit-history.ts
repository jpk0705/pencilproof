type AuditLike = { data: Record<string, unknown> };
type AuditHistoryRecord = AuditLike & { id: string };

const asNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const moneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export const auditMoney = (value: unknown) => {
  const amount = asNumber(value);
  return amount === null ? "Not entered" : moneyFormatter.format(amount);
};

export const auditRate = (value: unknown) => {
  const rate = asNumber(value);
  return rate === null ? "Not entered" : `${rate.toFixed(2)}%`;
};

export const auditPayment = (data: Record<string, unknown>, liveCalculation = false) => {
  const calculated = asNumber(data.calculatedPayment);
  const printed = asNumber(data.quotedPayment);
  if (liveCalculation && calculated !== null && calculated > 0) return calculated;
  if (printed !== null && printed > 0) return printed;
  return calculated !== null && calculated > 0 ? calculated : null;
};

export const auditAmountFinanced = (data: Record<string, unknown>) => {
  const saved = asNumber(data.amountFinanced);
  if (saved !== null && saved >= 0) return saved;
  const sellingPrice = asNumber(data.sellingPrice);
  if (sellingPrice === null || sellingPrice <= 0) return null;
  const products = ["serviceContract", "gap", "prepaidMaintenance", "tireWheel", "accessories"]
    .reduce((total, key) => total + (asNumber(data[key]) ?? 0), 0);
  return Math.max(
    0,
    sellingPrice
      + (asNumber(data.tax) ?? 0)
      + (asNumber(data.govFees) ?? 0)
      + (asNumber(data.docFee) ?? 0)
      + products
      + (asNumber(data.tradePayoff) ?? 0)
      - (asNumber(data.tradeValue) ?? 0)
      - (asNumber(data.cashDown) ?? 0)
      - (asNumber(data.rebate) ?? 0),
  );
};

const auditIdentity = (data: Record<string, unknown>) => {
  const vin = String(data.vin ?? "").trim().toLowerCase();
  if (vin) return `vin:${vin}`;
  const vehicle = String(data.vehicle ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `vehicle:${vehicle}`;
};

export const auditHistoryGroupKey = (audit: AuditHistoryRecord) => {
  const vin = String(audit.data.vin ?? "").trim().toLowerCase();
  return vin ? `vin:${vin}` : `audit:${audit.id}`;
};

export const groupAuditsByHistoryKey = <T extends AuditHistoryRecord>(audits: T[]) => {
  const groups = new Map<string, T[]>();
  for (const audit of audits) {
    const key = auditHistoryGroupKey(audit);
    const group = groups.get(key) ?? [];
    group.push(audit);
    groups.set(key, group);
  }
  return Array.from(groups, ([key, groupedAudits]) => ({ key, audits: groupedAudits }));
};

/**
 * Saved audits are returned newest first. The oldest saved audit for the same
 * VIN/vehicle is the dealer-given baseline; later saved versions are revisions.
 */
export const auditHistoryLabel = (audit: AuditHistoryRecord, audits: AuditHistoryRecord[]) => {
  const related = audits.filter((candidate) => auditIdentity(candidate.data) === auditIdentity(audit.data));
  const position = related.findIndex((candidate) => candidate.id === audit.id);
  return position === related.length - 1 ? "DEALER-GIVEN ORIGINAL" : "REVISED AUDIT";
};

const closeTo = (actual: unknown, expected: number) => {
  const value = Number(actual);
  return Number.isFinite(value) && Math.abs(value - expected) < 0.01;
};

/**
 * The paid analyzer used to autosave the built-in Load sample example. Keep
 * that demo out of real purchase history, including records created before
 * the autosave guard was added. A real quote with the same vehicle remains
 * visible when it includes a VIN or any different written figure.
 */
export const isExampleAudit = (audit: AuditLike) => {
  const data = audit.data;
  if (data.isSample === true || data.source === "sample" || data.source === "example") return true;
  if (String(data.vin ?? "").trim()) return false;
  if (String(data.vehicle ?? "").trim().toLowerCase() !== "2026 toyota rav4 xle premium") return false;
  return closeTo(data.sellingPrice, 36100)
    && closeTo(data.tax, 3474.63)
    && closeTo(data.govFees, 725)
    && closeTo(data.docFee, 85)
    && closeTo(data.serviceContract, 2495)
    && closeTo(data.gap, 995)
    && closeTo(data.accessories, 699)
    && closeTo(data.cashDown, 5000)
    && closeTo(data.apr, 8.49)
    && closeTo(data.term, 72)
    && closeTo(data.quotedPayment, 739.95);
};

export const uniqueRealAudits = <T extends AuditLike>(audits: T[]) => {
  const seen = new Set<string>();
  return audits.filter((audit) => {
    if (isExampleAudit(audit)) return false;
    const signature = JSON.stringify(audit.data);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
};
