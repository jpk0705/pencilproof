import type { DealPdfResult, ImportedDealFields } from "@/lib/deal-pdf";

export const REVIEW_PRODUCT_FIELDS = [
  "serviceContract",
  "gap",
  "prepaidMaintenance",
  "protection",
  "accessories",
] as const satisfies readonly (keyof ImportedDealFields)[];

export const countPricedProducts = (fields: ImportedDealFields) =>
  REVIEW_PRODUCT_FIELDS.filter((field) => Number(fields[field] ?? 0) > 0).length;

export const isPreviewImportUsable = (
  result: Pick<DealPdfResult, "fields" | "fieldNames" | "offerMatrix">,
) => {
  if (result.offerMatrix?.options.length) return true;
  const numericFieldCount = Object.entries(result.fields).filter(
    ([field, value]) =>
      field !== "vehicle" &&
      typeof value === "number" &&
      Number.isFinite(value),
  ).length;
  const hasDealAnchor = Boolean(
    result.fields.sellingPrice ||
    result.fields.quotedPayment,
  );
  return result.fieldNames.length >= 3 && numericFieldCount >= 3 && hasDealAnchor;
};

export const countPreviewReviewAreas = ({
  fields,
  hasPaymentMismatch,
  hasMissingCriticalInformation,
  hasOfferMatrix,
}: {
  fields: ImportedDealFields;
  hasPaymentMismatch: boolean;
  hasMissingCriticalInformation: boolean;
  hasOfferMatrix: boolean;
}) =>
  countPricedProducts(fields) +
  Number(hasPaymentMismatch) +
  Number(hasMissingCriticalInformation) +
  Number(hasOfferMatrix);
