type AuditLike = { data: Record<string, unknown> };

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
