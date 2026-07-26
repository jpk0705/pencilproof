import assert from "node:assert/strict";
import {
  parseDealerText,
  parseOfferMatrix,
  reconcileQuotedPayment,
} from "../lib/deal-pdf.ts";
import { paymentFor } from "../lib/deal-calculations.ts";
import {
  CHECKOUT_URL,
  QUOTE_HANDOFF_TYPE,
  createQuoteHandoffEnvelope,
} from "../lib/checkout.ts";
import {
  countPreviewReviewAreas,
  countPricedProducts,
  isPreviewImportUsable,
  shouldOfferManualEntry,
} from "../lib/deal-review.ts";
import {
  buildVehicleImageSearchQueries,
  parseVehicleIdentity,
  selectBestVehicleImage,
} from "../lib/vehicle-image.ts";

const closeTo = (actual, expected, tolerance = 0.01) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

const handoffPayload = {
  fields: { sellingPrice: 38995, apr: 7.49 },
  confidence: { sellingPrice: "high", apr: "review" },
  offerMatrix: null,
};
const handoffEnvelope = JSON.parse(
  createQuoteHandoffEnvelope(handoffPayload),
);
assert.equal(CHECKOUT_URL, "https://audit.pencilproof.com/handoff");
assert.equal(handoffEnvelope.type, QUOTE_HANDOFF_TYPE);
assert.deepEqual(handoffEnvelope.payload, handoffPayload);
assert.equal(CHECKOUT_URL.includes("#"), false);

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

const separatedPackedPayment = parseDealerText([
  "Estimated Payment",
  "V8, EcoTec3, 6.2 Liter | 4WD | Automatic",
  "ABS (4-Wheel), Adaptive Cruise Control",
  "Bluetooth Wireless, Bose Surround Sound",
  "Fog Lights, Head-Up Display",
  "Leather, LED Headlamps",
  "StabiliTrak, Surround View Camera",
  "$1,676.05",
  "Buyer Information",
  "72 Months @ 13.9400%",
  "Sales Price $70,000.00",
  "Appearance $699.00",
  "Connected Car 5 Year Plan $999.00",
  "GAP Insurance $1,200.00",
  "Government Fees $1,029.25",
  "Doc Fee $85.00",
  "Sales Tax: 9.75% $7,003.72",
  "Deposit / Cash Down $16,000.00",
  "Trade Allowance $38,000.00",
  "Trade Payoff $51,946.63",
  "Cash Due / Finance Amount $78,962.60",
]);
closeTo(separatedPackedPayment.quotedPayment, 1676.05);
const packedPaymentReview = reconcileQuotedPayment(separatedPackedPayment);
closeTo(packedPaymentReview.fields.quotedPayment, 1676.05);
assert.match(packedPaymentReview.warnings.join(" "), /packed payment/i);

const missingPrintedPayment = parseDealerText([
  "72 Months @ 13.9400%",
  "Cash Due / Finance Amount $78,962.60",
]);
assert.equal(missingPrintedPayment.quotedPayment, undefined);

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

const rav4AmountFinanced =
  36100 + 3474.63 + 725 + 85 + 2495 + 995 + 699 - 5000;
const sampleCalculatedPayment = paymentFor(rav4AmountFinanced, 8.49, 72);
const samplePaymentWithoutProducts = paymentFor(
  rav4AmountFinanced - 4189,
  8.49,
  72,
);
closeTo(rav4AmountFinanced, 39573.63);
closeTo(sampleCalculatedPayment, 703.36);
closeTo(739.95 - sampleCalculatedPayment, 36.59);
closeTo(sampleCalculatedPayment - samplePaymentWithoutProducts, 74.45);
closeTo((sampleCalculatedPayment - samplePaymentWithoutProducts) * 72, 5360.62);

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
assert.equal(
  isPreviewImportUsable({
    fields: { sellingPrice: 38000 },
    fieldNames: ["Selling price"],
    offerMatrix: undefined,
  }),
  false,
);
assert.equal(
  isPreviewImportUsable({
    fields: { sellingPrice: 38000, apr: 7.49, term: 72 },
    fieldNames: ["Selling price", "Dealer APR", "Loan term"],
    offerMatrix: undefined,
  }),
  true,
);
assert.equal(
  isPreviewImportUsable({
    fields: {},
    fieldNames: [],
    offerMatrix: matrix,
  }),
  true,
);
assert.equal(shouldOfferManualEntry(1), false);
assert.equal(shouldOfferManualEntry(2), true);
assert.equal(shouldOfferManualEntry(3), true);

const navigatorIdentity = parseVehicleIdentity(
  "2022 LINCOLN NAVIGATOR Black Label 4WD",
);
assert.deepEqual(navigatorIdentity, {
  year: "2022",
  make: "Lincoln",
  model: "Navigator",
  displayName: "2022 Lincoln Navigator",
});
assert.deepEqual(buildVehicleImageSearchQueries(navigatorIdentity), [
  "2022 Lincoln Navigator",
  "Lincoln Navigator",
]);
const navigatorQuote = parseDealerText([
  "Vehicle: 2022 Lincoln Navigator Black Label 4WD",
  "Selling Price $70,000.00",
  "APR 8.99%",
  "Term 72 months",
  "Monthly Payment $1,262.00",
]);
assert.equal(navigatorQuote.vehicle, "2022 Lincoln Navigator Black Label 4WD");
assert.equal(
  parseVehicleIdentity(navigatorQuote.vehicle)?.displayName,
  "2022 Lincoln Navigator",
);

const rav4Identity = parseVehicleIdentity(
  "2026 Toyota RAV4 XLE Premium VIN: 2T3A1RFV0PC123456",
);
assert.deepEqual(rav4Identity, {
  year: "2026",
  make: "Toyota",
  model: "RAV4",
  displayName: "2026 Toyota RAV4",
});

const commonsImage = selectBestVehicleImage(
  [
    {
      title: "File:Lincoln Navigator dashboard.jpg",
      imageinfo: [{
        thumburl: "https://upload.wikimedia.org/dashboard.jpg",
        descriptionurl:
          "https://commons.wikimedia.org/wiki/File:Lincoln_Navigator_dashboard.jpg",
      }],
    },
    {
      title: "File:2022 Lincoln Navigator Black Label front.jpg",
      imageinfo: [{
        thumburl: "https://upload.wikimedia.org/navigator.jpg",
        descriptionurl:
          "https://commons.wikimedia.org/wiki/File:2022_Lincoln_Navigator_Black_Label_front.jpg",
        extmetadata: {
          Artist: { value: "<a>Anorak Cline</a>" },
          LicenseShortName: { value: "CC BY 2.0" },
          LicenseUrl: { value: "https://creativecommons.org/licenses/by/2.0/" },
        },
      }],
    },
    {
      title: "File:2019 Lincoln Navigator side.jpg",
      imageinfo: [{
        thumburl: "https://upload.wikimedia.org/navigator-2019.jpg",
        descriptionurl:
          "https://commons.wikimedia.org/wiki/File:2019_Lincoln_Navigator_side.jpg",
      }],
    },
  ],
  navigatorIdentity,
);
assert.equal(commonsImage?.title, "2022 Lincoln Navigator Black Label front.jpg");
assert.equal(commonsImage?.creator, "Anorak Cline");
assert.equal(commonsImage?.license, "CC BY 2.0");
assert.equal(commonsImage?.exactYearMatch, true);

console.log("PencilProof regression checks passed.");
