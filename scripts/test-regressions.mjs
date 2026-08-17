import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEAL_FIELD_LABELS,
  parseDealerText,
  parsePdfFormFields,
  parseOfferMatrix,
  reconcileQuotedPayment,
  sanitizeImportedFields,
  isLocallyReadableImport,
  isDealImportFile,
  isDealImportPdf,
  DEAL_CAMERA_ACCEPT,
  dealImageScale,
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

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const salesPageSource = await readFile(join(projectRoot, "app/sales/page.tsx"), "utf8");
const accountNavSource = await readFile(join(projectRoot, "app/components/AccountNav.tsx"), "utf8");
const salesCoachSource = await readFile(join(projectRoot, "app/components/SalesCoach.tsx"), "utf8");

assert.match(salesPageSource, /const PUBLIC_SALES_URL = "https:\/\/pencilproof\.com\/sales"/);
assert.match(salesPageSource, /const PAID_AUDIT_URL = "https:\/\/audit\.pencilproof\.com\/analyze\/secure\/"/);
assert.match(salesPageSource, /UNLIMITED AUDIT ACCESS/);
assert.match(salesPageSource, /Upload quote for audit/);
assert.match(salesPageSource, /Your credit is still available/);
assert.match(salesPageSource, /finally \{\s*setBusy\(false\);\s*\}/);
assert.match(salesPageSource, /No PencilProof credit is available yet/);
assert.doesNotMatch(salesPageSource, /disabled=\{busy \|\| profile\.availableCredits < 1\}/);
assert.match(salesPageSource, /message && profile && isActive\(profile\.subscriptionStatus\)/);
assert.match(accountNavSource, /const ACCOUNT_URL = "\/account"/);
assert.match(accountNavSource, /const SALES_URL = "\/sales"/);
assert.match(salesCoachSource, /Type a customer scenario/);
assert.doesNotMatch(salesCoachSource, /FULL PLAYBOOK ·/);
const salesWorkerSource = await readFile(join(projectRoot, "worker/index.ts"), "utf8");
assert.match(salesWorkerSource, /addSalespersonSubscriptionCredit/);
assert.match(salesWorkerSource, /profile\?\.subscriptionStatus === "active"/);
assert.doesNotMatch(salesWorkerSource, /profile\?\.subscriptionStatus === "active" \|\| profile\?\.subscriptionStatus === "past_due"/);
assert.match(salesWorkerSource, /profile\.subscriptionStatus !== "active"/);
assert.match(salesWorkerSource, /accountCall\(env, "\/salesperson", \{ action: "get", userId \}\)/);
assert.match(salesWorkerSource, /stripeRequest\("\/invoiceitems"/);
assert.doesNotMatch(salesWorkerSource, /balance_transactions/);

const closeTo = (actual, expected, tolerance = 0.01) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

assert.equal(DEAL_FIELD_LABELS.rebate, "Rebate");
assert.equal(DEAL_CAMERA_ACCEPT, "image/*");

const acroFormImport = parsePdfFormFields([
  { fieldName: "Vehicle_Year", fieldValue: "2016", subtype: "Widget" },
  { fieldName: "Vehicle_Make", fieldValue: "Dodge Challenger", subtype: "Widget" },
  { fieldName: "Vehicle_IdentificationNumber", fieldValue: "1HGCM82633A004352", subtype: "Widget" },
  { fieldName: "Loan_Paid_CashPrice_Vehicle_Amount", fieldValue: "49500.00", subtype: "Widget" },
  { fieldName: "Loan_Paid_CashPrice_Accessories_Amount", fieldValue: "699.00", subtype: "Widget" },
  { fieldName: "Loan_Paid_TheftDeterrentDevice2_Amount", fieldValue: "1.00", subtype: "Widget" },
  { fieldName: "Loan_Paid_TheftDeterrentDevice3_Amount", fieldValue: "299.00", subtype: "Widget" },
  { fieldName: "Loan_Paid_SalesTax_Amount", fieldValue: "4430.48", subtype: "Widget" },
  { fieldName: "Loan_Paid_PublicOfficials_TotalOfficialFees_Amount", fieldValue: "873.00", subtype: "Widget" },
  { fieldName: "Agreement_ElectronicRegistrationOrTransferChargeFee_Amount", fieldValue: "37.00", subtype: "Widget" },
  { fieldName: "Vehicle_FeesPaidToState_Amount", fieldValue: "8.25", subtype: "Widget" },
  { fieldName: "Loan_Paid_Other_Amount", fieldValue: "50.00", subtype: "Widget" },
  { fieldName: "Loan_Paid_DocumentPreparation_Amount", fieldValue: "85.00", subtype: "Widget" },
  { fieldName: "Loan_Paid_ServiceContract_Amount", fieldValue: "5684.00", subtype: "Widget" },
  { fieldName: "Loan_Fee_GAPWaiver_Amount", fieldValue: "1200.00", subtype: "Widget" },
  { fieldName: "Vehicle_TradeIn_Amount", fieldValue: "0.00", subtype: "Widget" },
  { fieldName: "Loan_Paid_TradeInLien_Amount", fieldValue: "0.00", subtype: "Widget" },
  { fieldName: "Loan_Paid_CashDown_Amount", fieldValue: "0.00", subtype: "Widget" },
  { fieldName: "Loan_Paid_ManufacturersRebate_Amount", fieldValue: "0.00", subtype: "Widget" },
  { fieldName: "Loan_AnnualPercentage_Rate", fieldValue: "7.340", subtype: "Widget" },
  { fieldName: "Loan_Payment4_Number", fieldValue: "83", subtype: "Widget" },
  { fieldName: "Loan_Payment4_Amount", fieldValue: "959.32", subtype: "Widget" },
  { fieldName: "Loan_Payment6_Amount", fieldValue: "959.32", subtype: "Widget" },
  { fieldName: "Loan_Payment6_Due", fieldValue: "8/15/2033", subtype: "Widget" },
]);
assert.equal(acroFormImport.vehicle, "2016 Dodge Challenger");
assert.equal(acroFormImport.vin, "1HGCM82633A004352");
closeTo(acroFormImport.sellingPrice, 49500);
closeTo(acroFormImport.accessories, 999);
closeTo(acroFormImport.govFees, 968.25);
closeTo(acroFormImport.serviceContract, 5684);
closeTo(acroFormImport.gap, 1200);
assert.equal(acroFormImport.tradeValue, 0);
assert.equal(acroFormImport.cashDown, 0);
assert.equal(acroFormImport.rebate, 0);
closeTo(acroFormImport.apr, 7.34);
assert.equal(acroFormImport.term, 84);
closeTo(acroFormImport.quotedPayment, 959.32);

const phoneBridgeSource = await readFile(join(projectRoot, "app/components/PhoneCameraBridge.tsx"), "utf8");
const phonePageSource = await readFile(join(projectRoot, "app/phone/page.tsx"), "utf8");
const analyzeSource = await readFile(join(projectRoot, "app/analyze/page.tsx"), "utf8");
const phoneWorkerSource = await readFile(join(projectRoot, "worker/index.ts"), "utf8");
const wranglerSource = await readFile(join(projectRoot, "wrangler.jsonc"), "utf8");
const accountSystemSource = await readFile(join(projectRoot, "docs/account-system.md"), "utf8");
const readmeSource = await readFile(join(projectRoot, "README.md"), "utf8");
assert.match(phoneBridgeSource, /Scan with phone/);
assert.match(phoneBridgeSource, /QRCode\.toDataURL/);
assert.match(phoneBridgeSource, /photo-start/);
assert.match(phonePageSource, /capture="environment"/);
assert.match(phonePageSource, /photo-end/);
assert.match(analyzeSource, /How did you like your Full Quote Audit/);
assert.match(analyzeSource, /How was the user interface/);
assert.match(analyzeSource, /How was the overall service/);
assert.match(analyzeSource, /How was the scan quality/);
assert.match(analyzeSource, /\["0", "9\.99", "19\.99", "29\.99", "39\.99"\]/);
assert.match(analyzeSource, /paid-audit-questionnaire/);
assert.match(analyzeSource, /Save dealer-given original/);
assert.match(analyzeSource, /COUNTER PROPOSAL TO THE DEALER/);
assert.match(analyzeSource, /It was not included in the dealer-given original/);
assert.match(analyzeSource, /counterProposalDelta/);
assert.match(analyzeSource, /Live calculated payment:/);
assert.match(analyzeSource, /name: "Counter proposal"/);
assert.match(analyzeSource, /const productSummary/);
assert.match(analyzeSource, /Accessories/);
assert.match(analyzeSource, /COUNTER-PROPOSAL IMPACT/);
assert.match(analyzeSource, /counter-proposal-field/);
assert.doesNotMatch(analyzeSource, /Your desired APR/);
assert.doesNotMatch(analyzeSource, /outsideApr", "term"/);
assert.match(phoneWorkerSource, /1 Months @ 0%/);
assert.match(phoneWorkerSource, /CASH DUE \/ FINANCE AMOUNT/);
assert.match(phoneWorkerSource, /class PhoneSessionStore/);
assert.match(phoneWorkerSource, /PHONE_SESSIONS/);
assert.match(wranglerSource, /"PhoneSessionStore"/);
assert.match(wranglerSource, /"0 17 \* \* 2,5"/);
assert.match(phoneWorkerSource, /List-Unsubscribe/);
assert.match(phoneWorkerSource, /MARKETING_BUSINESS_ADDRESS/);
assert.match(phoneWorkerSource, /MARKETING_ALERT_EMAIL/);
assert.match(phoneWorkerSource, /Delivery failures/);
assert.match(readmeSource, /Hannah at PencilProof <support@pencilproof\.com>/);
assert.match(readmeSource, /MARKETING_ALERT_EMAIL/);
assert.match(accountSystemSource, /Apple Service ID/);
assert.match(accountSystemSource, /Google login has been used successfully/);

for (const name of ["quote.webp", "quote.gif", "quote.avif", "quote.heic", "quote.tiff", "quote.bmp"]) {
  assert.equal(isDealImportFile({ name, type: "" }), true, `${name} should be accepted as an image`);
}
assert.equal(isDealImportFile({ name: "quote-from-phone", type: "image/heic" }), true);
assert.equal(isDealImportFile({ name: "quote.pdf", type: "application/pdf" }), true);
assert.equal(isDealImportPdf({ name: "quote.pdf", type: "" }), true);
assert.equal(isDealImportFile({ name: "notes.txt", type: "text/plain" }), false);

const phoneScale = dealImageScale(4032, 3024, 2200);
assert.ok(phoneScale < 1, "camera originals should be downscaled before OCR");
assert.ok(4032 * 3024 * phoneScale ** 2 <= 4_000_000, "OCR image area should stay within the mobile-safe cap");

// Missing optional categories must not trigger Gemini when local extraction
// already produced a usable quote. Those categories are legitimately absent
// from many dealer worksheets.
assert.equal(isLocallyReadableImport({
  fields: {
    sellingPrice: 37966,
    tax: 3100,
    govFees: 725,
    apr: 4.49,
    term: 60,
    quotedPayment: 744.53,
    // No rebate, VSC, PPM, T&W, accessories, trade allowance, or payoff.
  },
  fieldNames: ["Selling price", "Sales tax", "Government / registration fees", "Dealer APR", "Loan term", "Quoted monthly payment"],
  offerMatrix: undefined,
}), true);
assert.equal(isLocallyReadableImport({
  fields: { sellingPrice: 37966 },
  fieldNames: ["Selling price"],
  offerMatrix: undefined,
}), false);

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

const OCRGroupedNumbers = parseDealerText([
  "Selling Price 31 000",
  "Sales Tax 9 . 375 % 4 137 . 47",
  "Government Fees 1 033 . 75",
  "Doc Fee 85 . 00",
  "Rebate 1 500",
  "APR 2 . 9 %",
  "Term 7 2 months",
  "Monthly Payment 642 . 83",
]);
closeTo(OCRGroupedNumbers.sellingPrice, 31000);
closeTo(OCRGroupedNumbers.tax, 4137.47);
closeTo(OCRGroupedNumbers.govFees, 1033.75);
closeTo(OCRGroupedNumbers.docFee, 85);
closeTo(OCRGroupedNumbers.rebate, 1500);
closeTo(OCRGroupedNumbers.apr, 2.9);
assert.equal(OCRGroupedNumbers.term, 72);
closeTo(OCRGroupedNumbers.quotedPayment, 642.83);

const plainOcrNumbers = parseDealerText([
  "Vehicle: 2025 Honda Accord Sport",
  "Selling Price 31450",
  "Sales Tax 2751",
  "Government Fees 612",
  "Documentation Fee 85",
  "Vehicle Service Contract 1295",
  "GAP Protection 895",
  "Cash Down 2500",
  "APR 7.49%",
  "Loan Term 72 months",
  "Monthly Payment 612",
]);
closeTo(plainOcrNumbers.sellingPrice, 31450);
closeTo(plainOcrNumbers.tax, 2751);
closeTo(plainOcrNumbers.govFees, 612);
closeTo(plainOcrNumbers.docFee, 85);
closeTo(plainOcrNumbers.serviceContract, 1295);
closeTo(plainOcrNumbers.gap, 895);
closeTo(plainOcrNumbers.cashDown, 2500);
closeTo(plainOcrNumbers.quotedPayment, 612);

const gwcServiceContract = parseDealerText([
  "GWC 36/100000** $5,300.00",
]);
closeTo(gwcServiceContract.serviceContract, 5300);
assert.equal(gwcServiceContract.accessories, undefined);

const labelWithMultipleAmounts = parseDealerText([
  "Sales Price $38,450.00 MSRP $40,250.00",
  "Sales Tax 9.25% $3,474.00",
  "Government Fees $612.00 Total $42,536.00",
  "Documentation Fee $85.00 Total Fees $697.00",
  "APR 7.49%",
  "Loan Term 72 months",
  "Monthly Payment $736.00 Total Payments $52,992.00",
]);
closeTo(labelWithMultipleAmounts.sellingPrice, 38450);
closeTo(labelWithMultipleAmounts.tax, 3474);
closeTo(labelWithMultipleAmounts.govFees, 612);
closeTo(labelWithMultipleAmounts.docFee, 85);
closeTo(labelWithMultipleAmounts.quotedPayment, 736);

const impossibleOcrValues = sanitizeImportedFields({
  sellingPrice: 31000,
  tax: 95000,
  apr: 99,
  term: 720,
  quotedPayment: 642.83,
});
closeTo(impossibleOcrValues.fields.sellingPrice, 31000);
closeTo(impossibleOcrValues.fields.quotedPayment, 642.83);
assert.equal(impossibleOcrValues.fields.tax, undefined);
assert.equal(impossibleOcrValues.fields.apr, undefined);
assert.equal(impossibleOcrValues.fields.term, undefined);
assert.deepEqual(impossibleOcrValues.rejected.sort(), ["apr", "tax", "term"]);

const dalyCityPhotoQuote = parseDealerText([
  "2018 Ram ProMaster City Tradesman Cargo Van 4D",
  "Estimated Payment",
  "387.97",
  "72 Months @ 5.5900%",
  "Pricing Breakdown Asking Price 18,500.00",
  "Discount (-) 500.00",
  "Sales Price 18,000.00",
  "Connected Car 1 Year Plan 299.00",
  "Zurich Shield - Standard 199.00",
  "Gap Insurance 795.00",
  "Vehicle Service Contract - (Elite) Platinum Used 36/45000 3,632.00",
  "DMV License / Title Fees 192.00",
  "DMV Reg / Transfer Fees 263.00",
  "Doc Fee 85.00",
  "Smog Certification Fee 8.25",
  "Electronic Filing Fee 37.00",
  "Sales Tax: 9.25% 1,723.55",
  "TOTAL SALES AMOUNT 25,283.80",
  "Deposit / Cash Down (-) 1,600.00",
  "CASH DUE / FINANCE AMOUNT 23,683.80",
]);
closeTo(dalyCityPhotoQuote.sellingPrice, 18000);
assert.equal(dalyCityPhotoQuote.rebate, undefined);
closeTo(dalyCityPhotoQuote.accessories, 498);
closeTo(dalyCityPhotoQuote.gap, 795);
closeTo(dalyCityPhotoQuote.serviceContract, 3632);
closeTo(dalyCityPhotoQuote.quotedPayment, 387.97);
closeTo(dalyCityPhotoQuote.apr, 5.59);
assert.equal(dalyCityPhotoQuote.term, 72);

const cashPriusQuote = parseDealerText([
  "2022 Toyota Prius Limited Hatchback 4D",
  "VIN: JTDKAMFU1N3176973",
  "Estimated Payment $30,462.63",
  "1 Months @ 0%",
  "Asking Price $27,500.00",
  "Discount (-) $1,501.00",
  "Sales Price $25,999.00",
  "Catalytic Marking - VC 24020 - Declined** $0.00",
  "Theft DNA DLP** $1.00",
  "Appearance** $699.00",
  "Connected Car 1 Year Plan** $299.00",
  "DMV License / Title Fees* $278.00",
  "DMV Reg / Transfer Fees* $327.00",
  "Doc Fee $85.00",
  "Smog Fee $50.00",
  "Smog Certification Fee $8.25",
  "Electronic Filing Fee $37.00",
  "Sales Tax: 9.875% $2,679.38",
  "TOTAL SALES AMOUNT $30,462.63",
  "Deposit / Cash Down (-) $0.00",
  "CASH DUE / FINANCE AMOUNT $30,462.63",
]);
closeTo(cashPriusQuote.sellingPrice, 25999);
closeTo(cashPriusQuote.tax, 2679.38);
closeTo(cashPriusQuote.govFees, 700.25);
closeTo(cashPriusQuote.docFee, 85);
closeTo(cashPriusQuote.accessories, 999);
closeTo(cashPriusQuote.apr, 0);
assert.equal(cashPriusQuote.term, 1);
closeTo(cashPriusQuote.quotedPayment, 30462.63);
closeTo(
  cashPriusQuote.sellingPrice +
    cashPriusQuote.tax +
    cashPriusQuote.govFees +
    cashPriusQuote.docFee +
    cashPriusQuote.accessories -
    cashPriusQuote.cashDown,
  cashPriusQuote.quotedPayment,
);
const cashSanitized = sanitizeImportedFields({ term: 1, apr: 0, quotedPayment: 30462.63 });
closeTo(cashSanitized.fields.quotedPayment, 30462.63);

const missingFeeRecoveredFromTotal = parseDealerText([
  "Sales Price $20,000.00",
  "Sales Tax $2,000.00",
  "Government Fees $500.00",
  "Doc Fee $85.00",
  "TOTAL SALES AMOUNT $22,735.00",
]);
closeTo(missingFeeRecoveredFromTotal.govFees, 650);

const paymentColumnMustNotBecomeAccessory = parseDealerText([
  "2024 Toyota RAV4 Adventure Sport Utility 4D",
  "ABS, Alloy Wheels, Backup Camera, Rear Spoiler, Roof Rails, Safety Connect",
  "Estimated Payment $625.89 84 Months @ 11.5900%",
  "Asking Price $32,500.00",
  "Discount (-) $500.00",
  "Sales Price $32,000.00",
  "Theft DNA DLP $1.00",
  "Appearance $699.00",
  "Connected Car 1 Year Plan $299.00",
  "Gap Insurance $1,200.00",
  "Sales Tax 8.625% $2,857.81",
  "TOTAL SALES AMOUNT $37,900.06",
  "Deposit / Cash Down (-) $2,000.00",
  "CASH DUE / FINANCE AMOUNT $35,900.06",
]);
closeTo(paymentColumnMustNotBecomeAccessory.accessories, 999);
closeTo(paymentColumnMustNotBecomeAccessory.quotedPayment, 625.89);

const paymentOnNextLineAfterVehicleFeatures = parseDealerText([
  "2017 Toyota Tundra CrewMax TRD Pro Pickup 4D 5 1/2 ft",
  "Estimated Payment",
  "V8, 5.7 Liter | 4WD | Auto, 6-Spd Sequential",
  "ABS (4-Wheel), Active Traction Control, Air Conditioning, Alarm System, Backup Camera, Bed",
  "Liner, Bluetooth Wireless, CD/MP3 (Single Disc), Cruise Control, Daytime Running Lights, Dual Air Bags, Entune,",
  "Power Door Locks, Power Seat, Power Sliding Rear Window, Power Windows, Running Boards, Side Air Bags, SiriusXM",
  "$786.00",
  "Satellite, Stability Control, Tilt & Telescoping Wheel, Towing Pkg, TRD Pro Pkg",
  "Connected Car 1 Year Plan $299.00",
  "Zurich Shield - Standard $199.00",
]);
closeTo(paymentOnNextLineAfterVehicleFeatures.accessories, 498);
closeTo(paymentOnNextLineAfterVehicleFeatures.quotedPayment, 786);

const namedProducts = parseDealerText([
  "Ally VSC $2,495.00",
  "AmeriPlus GAP $995.00",
  "Connected Car $299.00",
  "LoJack $695.00",
  "Zurich Shield $199.00",
]);
closeTo(namedProducts.serviceContract, 2495);
closeTo(namedProducts.gap, 995);
closeTo(namedProducts.accessories, 1193);

const categorizedDealerAddOns = parseDealerText([
  "Toyota Extra Care Vehicle Service Agreement $2,795.00",
  "Safe-Guard GAP Waiver $895.00",
  "ToyotaCare Plus Scheduled Maintenance Plan $1,025.00",
  "Zurich Tire & Wheel Protection Plan $1,249.00",
  "ResistAll Appearance Protection $699.00",
  "LoJack GPS Recovery System $795.00",
  "Nitrogen Tire Package $189.00",
  "VIN Etch $299.00",
  "Door Edge Guards $149.00",
]);
closeTo(categorizedDealerAddOns.serviceContract, 2795);
closeTo(categorizedDealerAddOns.gap, 895);
closeTo(categorizedDealerAddOns.prepaidMaintenance, 1025);
closeTo(categorizedDealerAddOns.tireWheel, 1249);
closeTo(categorizedDealerAddOns.accessories, 2131);

const photoStyleDealerAddOns = parseDealerText([
  "Ally VSC 2,495.00",
  "AmeriPlus GAP 995.00",
  "Prepaid Maintenance 899.00",
  "Tire & Wheel 1,199.00",
  "Zurich Shield 199.00",
  "Connected Car 299.00",
  "Nitrogen 189.00",
]);
closeTo(photoStyleDealerAddOns.serviceContract, 2495);
closeTo(photoStyleDealerAddOns.gap, 995);
closeTo(photoStyleDealerAddOns.prepaidMaintenance, 899);
closeTo(photoStyleDealerAddOns.tireWheel, 1199);
closeTo(photoStyleDealerAddOns.accessories, 687);

const manufacturerMaintenance = parseDealerText([
  "Mitsubishi Maintenance** $2,191.00",
]);
closeTo(manufacturerMaintenance.prepaidMaintenance, 2191);
assert.equal(manufacturerMaintenance.accessories, undefined);

const noCategoryDoubleCounting = parseDealerText([
  "Vehicle Service Contract Protection Plan $2,495.00",
  "GAP Protection Plan $995.00",
  "Tire & Wheel Protection Plan $1,199.00",
  "Appearance Protection Plan $699.00",
]);
closeTo(noCategoryDoubleCounting.serviceContract, 2495);
closeTo(noCategoryDoubleCounting.gap, 995);
closeTo(noCategoryDoubleCounting.tireWheel, 1199);
closeTo(noCategoryDoubleCounting.accessories, 699);

const reconstructedTax = parseDealerText([
  "Asking Price $44,635.00",
  "Dealer Discount $4,500.00",
  "Government Fees $1,033.75",
  "Vehicle Service Contract $3,453.00",
  "Appearance Protection $699.00",
  "Connected Car Plan $299.00",
  "Total Sales Amount $49,757.22",
]);
closeTo(reconstructedTax.sellingPrice, 40135);
assert.equal(reconstructedTax.rebate, undefined);
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
closeTo(printedPayment.sellingPrice, 29500);
assert.equal(printedPayment.rebate, undefined);
closeTo(printedPayment.quotedPayment, 642.94);
closeTo(printedPayment.accessories, 3198);

const dalyCityTacomaQuote = parseDealerText([
  "2022 Toyota Tacoma Double Cab TRD Off-Road Pickup 4D 6 ft",
  "Estimated Payment $688.13",
  "72 Months @ 5.8900%",
  "Asking Price $41,300.00",
  "Discount (-) $3,800.00",
  "Sales Price $37,500.00",
  "Catalytic Marking - VC 24020 - Declined** $0.00",
  "Theft DNA DLP** $1.00",
  "Appearance** $699.00",
  "Connected Car 1 Year Plan** $299.00",
  "Gap Insurance** $1,200.00",
  "DMV License / Title Fees* $400.00",
  "DMV Reg / Transfer Fees* $506.00",
  "Doc Fee $85.00",
  "Smog Fee $50.00",
  "Smog Certification Fee $8.25",
  "Electronic Filing Fee $37.00",
  "Sales Tax: 10% $3,863.40",
  "TOTAL SALES AMOUNT $44,648.65",
  "Deposit / Cash Down (-) $3,000.00",
  "CASH DUE / FINANCE AMOUNT $41,648.65",
]);
closeTo(dalyCityTacomaQuote.sellingPrice, 37500);
assert.equal(dalyCityTacomaQuote.rebate, undefined);
closeTo(dalyCityTacomaQuote.accessories, 999);
closeTo(dalyCityTacomaQuote.gap, 1200);
closeTo(dalyCityTacomaQuote.govFees, 1001.25);
closeTo(
  dalyCityTacomaQuote.sellingPrice +
    dalyCityTacomaQuote.tax +
    dalyCityTacomaQuote.govFees +
    dalyCityTacomaQuote.docFee +
    dalyCityTacomaQuote.accessories +
    dalyCityTacomaQuote.gap -
    dalyCityTacomaQuote.cashDown,
  41648.65,
);

const splitDownPaymentQuote = parseDealerText([
  "2025 Mitsubishi Outlander SE",
  "Sales Price $36,430.00",
  "Zurich Shield - Elite Plus $699.00",
  "Connected Car 1 Year Plan** $299.00",
  "GAP Insurance** $900.00",
  "DMV License / Title Fees* $389.00",
  "DMV Reg / Transfer Fees* $363.00",
  "Doc Fee $85.00",
  "Tire Fee $7.00",
  "Electronic Filing Fee $35.00",
  "Sales Tax: 8.625% $3,235.50",
  "TOTAL SALES AMOUNT $42,442.50",
  "Deposit / Cash Down (-) $3,000.00",
  "Deferred Down Payment Due 1/3/2026 (-) $250.00",
  "Deferred Down Payment Due 1/11/2026 (-) $250.00",
  "Deferred Down Payment Due 1/18/2026 (-) $250.00",
  "Deferred Down Payment Due 1/25/2026 (-) $250.00",
  "Trade Allowance $500.00",
  "Trade Payoff $0.00",
  "Net Trade Value (-) $500.00",
  "Factory Rebate (-) $2,500.00",
  "TOTAL DOWN AMOUNT $7,000.00",
  "CASH DUE / FINANCE AMOUNT $35,442.50",
]);
closeTo(splitDownPaymentQuote.sellingPrice, 36430);
closeTo(splitDownPaymentQuote.tax, 3235.5);
closeTo(splitDownPaymentQuote.govFees, 794);
closeTo(splitDownPaymentQuote.docFee, 85);
closeTo(splitDownPaymentQuote.gap, 900);
closeTo(splitDownPaymentQuote.accessories, 998);
closeTo(splitDownPaymentQuote.tradeValue, 500);
assert.equal(splitDownPaymentQuote.tradePayoff, 0);
closeTo(splitDownPaymentQuote.cashDown, 4000);
closeTo(splitDownPaymentQuote.rebate, 2500);
const splitDownPaymentAmountFinanced =
  splitDownPaymentQuote.sellingPrice +
  splitDownPaymentQuote.tax +
  splitDownPaymentQuote.govFees +
  splitDownPaymentQuote.docFee +
  splitDownPaymentQuote.gap +
  splitDownPaymentQuote.accessories +
  splitDownPaymentQuote.tradePayoff -
  splitDownPaymentQuote.tradeValue -
  splitDownPaymentQuote.cashDown -
  splitDownPaymentQuote.rebate;
closeTo(splitDownPaymentAmountFinanced, 35442.5);

const totalDownPaymentMustNotDoubleCount = parseDealerText([
  "Selling Price $30,000.00",
  "Deposit / Cash Down $3,000.00",
  "Deferred Down Payment Due 1/3/2026 $250.00",
  "TOTAL DOWN PAYMENT $3,250.00",
]);
closeTo(totalDownPaymentMustNotDoubleCount.cashDown, 3250);

const explicitManufacturerRebate = parseDealerText([
  "Sales Price $30,000.00",
  "Manufacturer Rebate $1,000.00",
]);
closeTo(explicitManufacturerRebate.sellingPrice, 30000);
closeTo(explicitManufacturerRebate.rebate, 1000);

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
  tireWheel: 699,
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
  trim: "Black Label",
  displayName: "2022 Lincoln Navigator",
});
assert.deepEqual(buildVehicleImageSearchQueries(navigatorIdentity), [
  "2022 Lincoln Navigator Black Label",
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

const vinQuote = parseDealerText([
  "Vehicle: 2024 Cadillac CT5 V-Series Blackwing",
  "VIN: 1G6DN5RW3P0100000",
  "Selling Price $95,000.00",
  "APR 8.99%",
  "Term 72 months",
  "Monthly Payment $1,800.00",
]);
assert.equal(vinQuote.vin, "1G6DN5RW3P0100000");
assert.equal(vinQuote.vehicle, "2024 Cadillac CT5 V-Series Blackwing");
assert.equal(sanitizeImportedFields({ vin: "not-a-vin" }).fields.vin, undefined);

const rav4Identity = parseVehicleIdentity(
  "2026 Toyota RAV4 XLE Premium VIN: 2T3A1RFV0PC123456",
);
assert.deepEqual(rav4Identity, {
  year: "2026",
  make: "Toyota",
  model: "RAV4",
  trim: "XLE Premium",
  vin: "2T3A1RFV0PC123456",
  displayName: "2026 Toyota RAV4",
});

const outlanderIdentity = parseVehicleIdentity(
  "2025 Mitsubishi Outlander SE",
);
assert.deepEqual(outlanderIdentity, {
  year: "2025",
  make: "Mitsubishi",
  model: "Outlander",
  trim: "SE",
  displayName: "2025 Mitsubishi Outlander",
});

const blackwingIdentity = parseVehicleIdentity(
  "2024 Cadillac CT5 V-Series Blackwing Sedan 4D",
);
assert.deepEqual(blackwingIdentity, {
  year: "2024",
  make: "Cadillac",
  model: "CT5",
  trim: "V-Series Blackwing",
  displayName: "2024 Cadillac CT5",
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
assert.equal(commonsImage?.exactTrimMatch, true);
assert.equal(commonsImage?.creator, "Anorak Cline");
assert.equal(commonsImage?.license, "CC BY 2.0");
assert.equal(commonsImage?.exactYearMatch, true);

const trimOnlyImage = selectBestVehicleImage(
  [
    {
      title: "File:2022 Lincoln Navigator front.jpg",
      imageinfo: [{
        thumburl: "https://upload.wikimedia.org/navigator-generic.jpg",
        descriptionurl: "https://commons.wikimedia.org/wiki/File:2022_Lincoln_Navigator_front.jpg",
        extmetadata: { LicenseShortName: { value: "CC BY 4.0" } },
      }],
    },
  ],
  navigatorIdentity,
  { requireTrim: true },
);
assert.equal(trimOnlyImage, null);

const historicalImage = selectBestVehicleImage(
  [
    {
      title: "File:Dodge Challenger lors de la rencontre du Duke's Club.jpg",
      imageinfo: [{
        thumburl: "https://upload.wikimedia.org/challenger-classic.jpg",
        descriptionurl: "https://commons.wikimedia.org/wiki/File:Dodge_Challenger_lors_de_la_rencontre_du_Duke%27s_Club.jpg",
        extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" } },
      }],
    },
  ],
  navigatorIdentity,
  { requireYear: true },
);
assert.equal(historicalImage, null);

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "quote-library");
const fixtureExpectations = [
  ["toyota-buyer-order.txt", 36100, 8.49, 72, 739.95],
  ["honda-payment-worksheet.txt", 35995, 7.99, 72, 692.41],
  ["lexus-f-and-i-menu.txt", 49800, 6.99, 60, 1012.88],
  ["gm-deal-worksheet.txt", 52400, 9.99, 72, 1038.56],
  ["ford-buyer-order.txt", 40135, 12.99, 75, 1041.28],
  ["independent-daly-city-menu.txt", 18000, 5.59, 72, 387.97],
];
for (const [fileName, sellingPrice, apr, term, payment] of fixtureExpectations) {
  const text = await readFile(join(fixtureRoot, fileName), "utf8");
  const fixture = parseDealerText(text.split(/\r?\n/));
  closeTo(fixture.sellingPrice, sellingPrice);
  closeTo(fixture.apr, apr);
  assert.equal(fixture.term, term);
  closeTo(fixture.quotedPayment, payment);
}
assert.equal(fixtureExpectations.length, 6);

const workerSource = await readFile(join(projectRoot, "worker", "index.ts"), "utf8");
assert.match(workerSource, /Native clients cannot rely on browser cookies/);
assert.match(workerSource, /authorization\.match\(\/\^Bearer\\s\+\(\.\+\)\$\/i\)/);
assert.match(workerSource, /accountCall\(env, "\/user", \{ providerSubject: provider\.id \}\)/);

console.log("PencilProof regression checks passed.");
