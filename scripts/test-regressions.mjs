import assert from "node:assert/strict";
import {
  parseDealerText,
  parseOfferMatrix,
  reconcileQuotedPayment,
} from "../lib/deal-pdf.ts";
import { paymentFor } from "../lib/deal-calculations.ts";
import {
  countPreviewReviewAreas,
  countPricedProducts,
} from "../lib/deal-review.ts";

const closeTo = (actual, expected, tolerance = 0.01) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

const taxRateAndAmount = parseDealerText([
  "Selling Price $44,635.00",
  "Sales Tax 9.375% $4,137.47",
  "Government Fees $1,033.75",
  "Doc Fee $85.00",
  "Cash Down $10,000.00",
  "APR 12.99%",
  "Term 75 months",
  "Monthly Payment $834.58",
]);
closeTo(taxRateAndAmount.tax, 4137.47);
assert.notEqual(taxRateAndAmount.tax, 9.375);

const reconstructedTax = parseDealerText([
  "Asking Price $44,635.00",
  "Dealer Discount $4,500.00",
  "Government Fees $1,033.75",
  "Vehicle Service Contract $3,453.00",
  "Appearance Protection $699.00",
  "Connected Car Plan $299.00",
  "Total Sales Amount $49,757.22",
]);
closeTo(reconstructedTax.tax, 4137.47);

const printedPayment = parseDealerText([
  "Asking Price $31,000.00",
  "Discount $1,500.00",
  "Sales Price $29,500.00",
  "Government Fees $52.00",
  "Documentation Fee $85.00",
  "Appearance $699.00",
  "Connected Car Plan $299.00",
  "Shipping $2,200.00",
  "Cash Down $2,000.00",
  "Amount Financed $30,835.00",
  "APR 14.45%",
  "Term 72 months",
  "Monthly Payment $642.94",
]);
closeTo(printedPayment.sellingPrice, 31000);
closeTo(printedPayment.rebate, 1500);
closeTo(printedPayment.quotedPayment, 642.94);
closeTo(printedPayment.accessories, 2499);

const realGap = parseDealerText([
  "Selling Price $38,995.00",
  "GAP Protection $1,200.00",
  "Appearance $699.00",
  "Cash Down $5,000.00",
  "APR 8.99%",
  "Term 72 months",
  "Monthly Payment $695.44",
]);
closeTo(realGap.gap, 1200);

const matrix = parseOfferMatrix([
  "Cash Down 48 Months 60 Months 72 Months 24 Months 36 Months",
  "$2,000 $481.32 $385.06 $320.88 $380.53 $302.57",
  "$3,000 $458.17 $366.48 $305.38 $339.08 $276.12",
  "$4,000 $435.02 $347.91 $289.89 $297.63 $249.67",
  "$5,000 $411.87 $335.06 $274.39 $256.18 $223.22",
  "Rebate $1,000 $1,000 $1,000 $1,000 $1,000",
]);
assert.equal(matrix?.options.length, 20);
closeTo(
  matrix.options.find((option) =>
    option.type === "finance" && option.cashDown === 2000 && option.term === 60
  )?.payment,
  385.06,
);
closeTo(
  matrix.options.find((option) =>
    option.type === "finance" && option.cashDown === 2000 && option.term === 72
  )?.payment,
  320.88,
);

const mismatch = reconcileQuotedPayment({
  sellingPrice: 31000,
  cashDown: 2000,
  apr: 14.45,
  term: 72,
  quotedPayment: 700,
});
closeTo(mismatch.fields.quotedPayment, 700);
assert.match(mismatch.warnings.join(" "), /preserved both values/i);

const quoteBaseWithoutTax = 44635 + 1033.75 + 3453 + 699 + 299 - 10000;
const paymentWithMistakenTaxRate = paymentFor(quoteBaseWithoutTax + 9.375, 12.99, 75);
const paymentWithTaxAmount = paymentFor(quoteBaseWithoutTax + 4137.47, 12.99, 75);
closeTo(paymentWithTaxAmount - paymentWithMistakenTaxRate, 80.66, 0.01);

const allPricedProducts = {
  serviceContract: 3453,
  gap: 1200,
  prepaidMaintenance: 899,
  protection: 699,
  accessories: 299,
};
assert.equal(countPricedProducts(allPricedProducts), 5);
assert.equal(
  countPreviewReviewAreas({
    fields: allPricedProducts,
    hasPaymentMismatch: false,
    hasMissingCriticalInformation: false,
    hasOfferMatrix: false,
  }),
  5,
);
assert.equal(
  countPreviewReviewAreas({
    fields: allPricedProducts,
    hasPaymentMismatch: true,
    hasMissingCriticalInformation: false,
    hasOfferMatrix: false,
  }),
  6,
);

console.log("PencilProof regression checks passed.");
