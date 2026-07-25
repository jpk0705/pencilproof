import type { ImportedDealFields } from "@/lib/deal-pdf";

export const REVIEW_PRODUCT_FIELDS = [
  "serviceContract",
  "gap",
  "prepaidMaintenance",
  "protection",
  "accessories",
] as const satisfies readonly (keyof ImportedDealFields)[];

export const countPricedProducts = (fields: ImportedDealFields) =>
  REVIEW_PRODUCT_FIELDS.filter((field) => Number(fields[field] ?? 0) > 0).length;

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
