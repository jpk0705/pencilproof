export type ImportedDealFields = Partial<{
  vehicle: string;
  sellingPrice: number;
  tax: number;
  govFees: number;
  docFee: number;
  serviceContract: number;
  gap: number;
  prepaidMaintenance: number;
  tireWheel: number;
  accessories: number;
  tradeValue: number;
  tradePayoff: number;
  cashDown: number;
  rebate: number;
  apr: number;
  outsideApr: number;
  term: number;
  quotedPayment: number;
}>;

export const DEAL_FIELD_LABELS: Record<keyof ImportedDealFields, string> = {
  vehicle: "Vehicle",
  sellingPrice: "Selling price",
  tax: "Sales tax",
  govFees: "Government / registration fees",
  docFee: "Documentation fee",
  serviceContract: "VSC / service contract",
  gap: "GAP protection",
  prepaidMaintenance: "Prepaid maintenance",
  tireWheel: "Tire & wheel protection (T&W)",
  accessories: "Accessories / other add-ons",
  tradeValue: "Trade allowance",
  tradePayoff: "Trade payoff",
  cashDown: "Cash down",
  rebate: "Rebate",
  apr: "Dealer APR",
  outsideApr: "Desired APR",
  term: "Loan term",
  quotedPayment: "Quoted monthly payment",
};

export type DealPdfResult = {
  fields: ImportedDealFields;
  fieldConfidence: Partial<Record<keyof ImportedDealFields, "high" | "review">>;
  fieldNames: string[];
  pageCount: number;
  sourceType: "pdf" | "image";
  usedOcr?: boolean;
  pagesProcessed?: number;
  warnings?: string[];
  offerMatrix?: DealOfferMatrix;
};

const IMAGE_FILE_EXTENSIONS = /\.(avif|bmp|gif|heic|heif|ico|jpe?g|jfif|jxl|png|svg|tif?f|webp)$/i;
const IMAGE_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  ico: "image/x-icon",
  jfif: "image/jpeg",
  jpe: "image/jpeg",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  jxl: "image/jxl",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
  pdf: "application/pdf",
};

/**
 * The browser file picker can report a blank MIME type for files copied from
 * some phones, messaging apps, and cloud drives. Keep the extension fallback
 * so those files are not rejected before the decoder gets a chance to read
 * them. Image decoding and OCR still determine whether the file is usable.
 */
export const isDealImportFile = (file: Pick<File, "name" | "type">) => {
  const name = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  return mimeType === "application/pdf" || name.endsWith(".pdf") ||
    mimeType.startsWith("image/") || IMAGE_FILE_EXTENSIONS.test(name);
};

export const isDealImportPdf = (file: Pick<File, "name" | "type">) =>
  file.type.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

const mimeTypeForDealImport = (file: Pick<File, "name" | "type">) => {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return IMAGE_MIME_TYPES_BY_EXTENSION[extension] ?? "image/png";
};

export const DEAL_IMPORT_ACCEPT = "application/pdf,image/*,.pdf";

export type DealOfferOption = {
  id: string;
  type: "finance" | "lease";
  cashDown: number;
  term: number;
  payment: number;
  rebate?: number;
  apr?: number;
  purchaseOption?: number;
};

export type DealOfferMatrix = {
  options: DealOfferOption[];
  warnings: string[];
};

export type DealImportProgress = {
  progress: number;
  status: string;
};

type PdfTextItem = {
  str: string;
  transform: number[];
};

type PdfPageLike = {
  getTextContent: () => Promise<{ items: unknown[] }>;
};

type PdfViewportLike = {
  width: number;
  height: number;
};

type PdfRenderablePageLike = PdfPageLike & {
  getViewport: (options: { scale: number }) => PdfViewportLike;
  render: (options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewportLike;
  }) => { promise: Promise<unknown> };
};

const PAYMENT_IMPORT_TOLERANCE = 5;

export const reconcileQuotedPayment = (sourceFields: ImportedDealFields) => {
  const fields = { ...sourceFields };
  if (!fields.sellingPrice || !fields.apr || !fields.term || !fields.quotedPayment) {
    return { fields, warnings: [] as string[] };
  }

  const products = (fields.serviceContract ?? 0) + (fields.gap ?? 0) +
    (fields.prepaidMaintenance ?? 0) + (fields.tireWheel ?? 0) + (fields.accessories ?? 0);
  const amountFinanced = Math.max(0,
    fields.sellingPrice + (fields.tax ?? 0) + (fields.govFees ?? 0) + (fields.docFee ?? 0) + products +
    (fields.tradePayoff ?? 0) - (fields.tradeValue ?? 0) - (fields.cashDown ?? 0) - (fields.rebate ?? 0),
  );
  if (!amountFinanced) return { fields, warnings: [] as string[] };

  const monthlyRate = fields.apr / 1200;
  const calculatedPayment = monthlyRate === 0
    ? amountFinanced / fields.term
    : amountFinanced * monthlyRate / (1 - Math.pow(1 + monthlyRate, -fields.term));
  const roundedCalculatedPayment = Math.round(calculatedPayment * 100) / 100;
  const difference = Math.abs(fields.quotedPayment - roundedCalculatedPayment);
  if (difference <= PAYMENT_IMPORT_TOLERANCE) return { fields, warnings: [] as string[] };

  return {
    fields,
    warnings: [
      `Payment warning: the document shows $${fields.quotedPayment.toFixed(2)}, while the imported figures calculate to $${roundedCalculatedPayment.toFixed(2)} per month—a $${difference.toFixed(2)} difference. PencilProof preserved both values. Ask the dealer to reconcile the amount financed, APR, term, and first-payment due date; an undisclosed amount, deferred first payment, or packed payment may explain the gap.`,
    ],
  };
};

const confidenceFor = (
  fields: ImportedDealFields,
  confidence: "high" | "review",
): DealPdfResult["fieldConfidence"] =>
  Object.fromEntries(
    Object.keys(fields).map((field) => [field, confidence]),
  ) as DealPdfResult["fieldConfidence"];

const allowedLoanTerms = [24, 30, 36, 39, 42, 48, 54, 60, 63, 66, 72, 75, 78, 84, 96];

const criticalImportFields: (keyof ImportedDealFields)[] = [
  "sellingPrice",
  "apr",
  "term",
  "quotedPayment",
];

/**
 * OCR can produce a perfectly numeric value that is still impossible for a
 * vehicle worksheet, for example a misplaced decimal or a page number read
 * as the APR. Remove those values before they reach the calculator. Missing
 * values remain missing and are shown as "Not found" for the user to verify.
 */
export const sanitizeImportedFields = (sourceFields: ImportedDealFields) => {
  const fields = { ...sourceFields };
  const limits: Partial<Record<keyof ImportedDealFields, [number, number]>> = {
    sellingPrice: [1000, 250000],
    tax: [0, 50000],
    govFees: [0, 30000],
    docFee: [0, 1000],
    serviceContract: [0, 20000],
    gap: [0, 5000],
    prepaidMaintenance: [0, 10000],
    tireWheel: [0, 10000],
    accessories: [0, 30000],
    tradeValue: [0, 200000],
    tradePayoff: [0, 250000],
    cashDown: [0, 100000],
    rebate: [0, 50000],
    apr: [0, 40],
    outsideApr: [0, 40],
    term: [24, 96],
    quotedPayment: [50, 5000],
  };
  const rejected: (keyof ImportedDealFields)[] = [];

  (Object.keys(limits) as (keyof ImportedDealFields)[]).forEach((field) => {
    const value = fields[field];
    const range = limits[field];
    if (typeof value !== "number" || !Number.isFinite(value) || !range) return;
    if (value < range[0] || value > range[1]) {
      delete fields[field];
      rejected.push(field);
    }
  });

  if (fields.sellingPrice && fields.tax && fields.tax > fields.sellingPrice * 0.3) {
    delete fields.tax;
    rejected.push("tax");
  }
  if (fields.apr !== undefined && fields.apr > 0 && fields.apr < 0.01) {
    delete fields.apr;
    rejected.push("apr");
  }
  if (fields.term !== undefined && !allowedLoanTerms.includes(fields.term)) {
    delete fields.term;
    rejected.push("term");
  }

  return { fields, rejected };
};

const importCandidateScore = (fields: ImportedDealFields) => {
  let score = Object.keys(fields).length;
  score += criticalImportFields.filter((field) => fields[field] !== undefined).length * 5;
  if (fields.sellingPrice && fields.sellingPrice >= 1000) score += 2;
  if (fields.apr !== undefined && fields.apr >= 0 && fields.apr <= 40) score += 2;
  if (fields.term !== undefined && [24, 30, 36, 39, 42, 48, 54, 60, 63, 66, 72, 75, 78, 84, 96].includes(fields.term)) score += 2;
  if (fields.quotedPayment !== undefined && fields.quotedPayment >= 50 && fields.quotedPayment <= 5000) score += 2;
  return score;
};

/**
 * OCR is probabilistic. Merge independent parses by value agreement instead
 * of allowing the last OCR pass to overwrite a better value.
 */
const mergeImportedCandidates = (candidates: ImportedDealFields[]) => {
  const usable = candidates.filter((candidate) => Object.keys(candidate).length);
  if (!usable.length) return {};
  const bestCandidate = [...usable].sort((a, b) => importCandidateScore(b) - importCandidateScore(a))[0];
  const merged: ImportedDealFields = {};

  (Object.keys(DEAL_FIELD_LABELS) as (keyof ImportedDealFields)[]).forEach((field) => {
    const values = usable
      .map((candidate) => candidate[field])
      .filter((value): value is string | number => value !== undefined && value !== null);
    if (!values.length) return;
    if (field === "vehicle") {
      const textValues = values.filter((value): value is string => typeof value === "string");
      merged.vehicle = [...textValues].sort((a, b) => b.length - a.length)[0] ?? String(values[0]);
      return;
    }

    const numericValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (!numericValues.length) return;
    const clusters: { value: number; count: number }[] = [];
    numericValues.forEach((value) => {
      const cluster = clusters.find((entry) => Math.abs(entry.value - value) <= 0.01);
      if (cluster) cluster.count += 1;
      else clusters.push({ value, count: 1 });
    });
    clusters.sort((a, b) => b.count - a.count || Math.abs(a.value - Number(bestCandidate[field] ?? a.value)) - Math.abs(b.value - Number(bestCandidate[field] ?? b.value)));
    merged[field] = clusters[0].value;
  });
  return merged;
};

// Dealer exports and OCR frequently split a grouped amount into separate
// digit groups, for example "$ 31 000", "31 000", or "2 . 9 %". Keep the
// spaces inside the numeric token so the parser can normalize them instead
// of treating the groups as separate amounts.
const moneyPattern = /(?:\(\s*)?-?\$?\s*\d[\d,]*(?:\s+\d{3})*(?:\s*\.\s*\d{1,2})?(?:\s*\))?/g;

const hasGroupedDigits = (raw: string) => /\d\s+\d{3}(?:\s+\d{3})*/.test(raw);
const hasDecimalCents = (raw: string) => /\.\s*\d{2}\s*\)?$/.test(raw.trim());

const parseMoney = (raw: string) => {
  const negative = raw.includes("(") || raw.trim().startsWith("-");
  const numeric = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? (negative ? -numeric : numeric) : undefined;
};

const valuesOnLine = (line: string) =>
  [...line.matchAll(moneyPattern)]
    .map((match) => ({ value: parseMoney(match[0]), raw: match[0] }))
    .filter((entry): entry is { value: number; raw: string } => entry.value !== undefined);

export const parseOfferMatrix = (rawLines: string[]): DealOfferMatrix | undefined => {
  const lines = rawLines.map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line, index) => /cash down/i.test(line) &&
    ((lines.slice(index, index + 8).join(" ").match(/\b\d{2}\s*months?\b/gi)?.length ?? 0) >= 2));
  if (headerIndex < 0) return undefined;

  const headerText = lines.slice(headerIndex, headerIndex + 8).join(" ");
  const terms = [...headerText.matchAll(/\b(\d{2})\s*months?\b/gi)].map((match) => Number(match[1]));
  if (terms.length < 2) return undefined;
  const termDropIndex = terms.findIndex((term, index) => index > 0 && term < terms[index - 1]);
  const financeCount = termDropIndex > 0 ? termDropIndex : Math.max(1, terms.length - 2);
  const directRows: { cashDown: number; payments: number[] }[] = [];
  const tableEndIndex = lines.findIndex((line, index) => index > headerIndex && /\brebate\b|purchase option|estimated apr/i.test(line));
  const tableLines = lines.slice(headerIndex + 1, tableEndIndex > headerIndex ? tableEndIndex : headerIndex + 12);

  for (const line of tableLines) {
    const values = valuesOnLine(line).map(({ value }) => value);
    if (values.length < terms.length + 1) continue;
    const cashDown = values[0];
    const payments = values.slice(1, terms.length + 1);
    if (cashDown < 500 || cashDown > 50000 || payments.some((payment) => payment < 50 || payment > 5000)) continue;
    directRows.push({ cashDown, payments });
  }

  const flattenedValues = tableLines.flatMap((line) => valuesOnLine(line).map(({ value }) => value));
  const verticalRows: { cashDown: number; payments: number[] }[] = [];
  for (let index = 0; index + terms.length < flattenedValues.length;) {
    const cashDown = flattenedValues[index];
    const payments = flattenedValues.slice(index + 1, index + terms.length + 1);
    if (cashDown >= 500 && cashDown <= 50000 && payments.length === terms.length &&
      payments.every((payment) => payment >= 50 && payment <= 5000)) {
      verticalRows.push({ cashDown, payments });
      index += terms.length + 1;
    } else {
      index += 1;
    }
  }

  const scoreRows = (candidateRows: { cashDown: number; payments: number[] }[]) => {
    if (!candidateRows.length) return -Infinity;
    let score = candidateRows.length * 10;
    const sorted = [...candidateRows].sort((first, second) => first.cashDown - second.cashDown);
    if (new Set(sorted.map((row) => row.cashDown)).size !== sorted.length) score -= 30;
    for (let column = 0; column < terms.length; column += 1) {
      for (let row = 1; row < sorted.length; row += 1) {
        score += sorted[row].payments[column] < sorted[row - 1].payments[column] ? 3 : -20;
      }
    }
    for (const row of sorted) {
      for (let column = 1; column < financeCount; column += 1) {
        score += row.payments[column] < row.payments[column - 1] ? 2 : -15;
      }
    }
    const allPayments = sorted.flatMap((row) => row.payments).sort((first, second) => first - second);
    const median = allPayments[Math.floor(allPayments.length / 2)];
    score -= allPayments.filter((payment) => payment > median * 3 || payment < median * 0.25).length * 25;
    return score;
  };

  const rows = scoreRows(verticalRows) > scoreRows(directRows) ? verticalRows : directRows;
  if (!rows.length || scoreRows(rows) < 0) return undefined;

  const rebateLine = lines.slice(headerIndex + 1).find((line) => /^rebate\b/i.test(line));
  const rebates = rebateLine ? valuesOnLine(rebateLine).map(({ value }) => value).slice(0, terms.length) : [];
  const options: DealOfferOption[] = [];
  rows.forEach((row, rowIndex) => {
    terms.forEach((term, columnIndex) => {
      options.push({
        id: `${columnIndex < financeCount ? "finance" : "lease"}-${rowIndex}-${term}`,
        type: columnIndex < financeCount ? "finance" : "lease",
        cashDown: row.cashDown,
        term,
        payment: row.payments[columnIndex],
        rebate: rebates[columnIndex],
      });
    });
  });

  return {
    options,
    warnings: [
      "This is a payment-options worksheet, not a complete contract. Taxes, fees, products, lender terms, and lease details may be missing.",
    ],
  };
};

const offerMatrixQuality = (matrix?: DealOfferMatrix) => {
  if (!matrix?.options.length) return -Infinity;
  const payments = matrix.options.map((option) => option.payment).sort((first, second) => first - second);
  const median = payments[Math.floor(payments.length / 2)];
  let score = matrix.options.length * 2;
  const groups = new Map<string, DealOfferOption[]>();
  matrix.options.forEach((option) => {
    const key = `${option.type}-${option.term}`;
    groups.set(key, [...(groups.get(key) ?? []), option]);
  });
  groups.forEach((options) => {
    const sorted = options.sort((first, second) => first.cashDown - second.cashDown);
    for (let index = 1; index < sorted.length; index += 1) {
      score += sorted[index].payment < sorted[index - 1].payment ? 4 : -30;
    }
  });
  score -= payments.filter((payment) => payment > median * 3 || payment < median * 0.25).length * 40;
  return score;
};

const chooseBetterOfferMatrix = (first?: DealOfferMatrix, second?: DealOfferMatrix) =>
  offerMatrixQuality(second) > offerMatrixQuality(first) ? second : first;

const usableValues = (line: string, allowZero = false) =>
  valuesOnLine(line).filter(({ value }) => allowZero || value > 0);

const currencyValues = (line: string, allowZero = false) =>
  usableValues(line, allowZero).filter(({ raw }) => raw.includes("$") || raw.includes(",") || hasGroupedDigits(raw));

const priceValues = (line: string, allowZero = false) =>
  usableValues(line, allowZero).filter(({ raw }) =>
    raw.includes("$") || raw.includes(",") || hasGroupedDigits(raw) || hasDecimalCents(raw),
  );

// Some dealer exports and OCR engines remove every currency marker and
// thousands separator. Only accept a plain number when it is on a line that
// is otherwise numeric, or directly after a field label. This prevents page
// numbers and years from becoming prices while still handling `Tax 3474`.
const plainNumericValues = (line: string, allowZero = false) =>
  usableValues(line, allowZero).filter(({ raw }) => {
    const remainder = line.replace(raw, "").replace(/[\s:|()\-+/@%]/g, "");
    return remainder.length === 0;
  });

const textContainsPrintedAmount = (text: string, amount: number) => {
  const fixed = amount.toFixed(2);
  const [whole, cents] = fixed.split(".");
  const withCommas = Number(whole).toLocaleString("en-US");
  return new RegExp(`\\$\\s*(?:${whole}|${withCommas.replace(/,/g, "\\,")})\\s*\\.\\s*${cents}\\b`).test(text);
};

const findAmount = (lines: string[], labels: RegExp[], options?: { allowZero?: boolean }) => {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matchingLabel = labels.find((label) => label.test(line));
    if (!matchingLabel) continue;

    // Prefer the first decorated amount after the matched label. The old
    // implementation chose the last amount on the whole line, which could
    // silently import a total, a rate, or a second column instead of the
    // value belonging to the label.
    const labelMatch = line.match(matchingLabel);
    const afterLabel = labelMatch?.index === undefined
      ? line
      : line.slice(labelMatch.index + labelMatch[0].length);
    const afterLabelCurrency = currencyValues(afterLabel, options?.allowZero);
    if (afterLabelCurrency.length) return afterLabelCurrency[0].value;
    const afterLabelPrice = priceValues(afterLabel, options?.allowZero);
    if (afterLabelPrice.length) return afterLabelPrice[0].value;
    const afterLabelPlain = plainNumericValues(afterLabel, options?.allowZero);
    if (afterLabelPlain.length) return afterLabelPlain[0].value;

    const onLineCurrency = currencyValues(line, options?.allowZero);
    if (onLineCurrency.length) return onLineCurrency[onLineCurrency.length - 1].value;

    const onLinePrice = priceValues(line, options?.allowZero);
    if (onLinePrice.length) return onLinePrice[onLinePrice.length - 1].value;

    for (let offset = 1; offset <= 2; offset += 1) {
      const nextLine = lines[index + offset];
      if (!nextLine) break;
      const nextValues = currencyValues(nextLine, options?.allowZero);
      if (nextValues.length) return nextValues[0].value;
      if (/[A-Za-z]{4,}/.test(nextLine) && !/^\s*[$\d(.-]/.test(nextLine)) break;
    }

    for (let offset = 1; offset <= 2; offset += 1) {
      const nextLine = lines[index + offset];
      if (!nextLine) break;
      const nextValues = priceValues(nextLine, options?.allowZero);
      if (nextValues.length) return nextValues[0].value;
      const nextPlainValues = plainNumericValues(nextLine, options?.allowZero);
      if (nextPlainValues.length) return nextPlainValues[0].value;
      if (/[A-Za-z]{4,}/.test(nextLine) && !/^\s*[$\d(.-]/.test(nextLine)) break;
    }
  }
  return undefined;
};

const findPercent = (lines: string[], labels: RegExp[]) => {
  for (let index = 0; index < lines.length; index += 1) {
    if (!labels.some((label) => label.test(lines[index]))) continue;
    const nearby = lines.slice(index, index + 2).join(" ");
    const percent = nearby.match(/(?:\b|\s)(\d{1,2}(?:\s*\.\s*\d{1,3})?)\s*%/);
    if (percent) return Number(percent[1].replace(/\s/g, ""));
    const afterLabel = nearby.match(/(?:APR|annual percentage rate|interest rate)[^\d]{0,20}(\d{1,2}(?:\s*\.\s*\d{1,3})?)/i);
    if (afterLabel) return Number(afterLabel[1].replace(/\s/g, ""));
  }
  return undefined;
};

const findTerm = (lines: string[]) => {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/(?:loan\s+)?term|number of payments|months/i.test(line)) continue;
    const nearby = lines.slice(index, index + 2).join(" ");
    const months = nearby.match(/\b(24|30|36|39|42|48|54|60|63|66|72|75|78|84|96)\s*(?:months?|mos?\.?|payments?)?\b/i) ??
      nearby.match(/\b(\d)\s+(\d)\s*(?:months?|mos?\.?|payments?)\b/i);
    if (months) return months[2] ? Number(`${months[1]}${months[2]}`) : Number(months[1]);
  }
  return undefined;
};

const vehicleFromLines = (lines: string[]) => {
  const labeled = lines.find((line) => /(?:vehicle|description)\s*[:#-]/i.test(line));
  if (labeled) {
    const value = labeled
      .replace(/^.*?(?:vehicle|description)\s*[:#-]\s*/i, "")
      .replace(/\bVIN\b.*$/i, "")
      .trim();
    if (/\b(?:19|20)\d{2}\b/.test(value) && value.length >= 8) return value.slice(0, 90);
  }

  for (const line of lines) {
    if (/date|expiration|copyright|printed/i.test(line)) continue;
    const match = line.match(/\b((?:19|20)\d{2}\s+[A-Za-z][A-Za-z0-9-]{1,20}(?:\s+[A-Za-z0-9][A-Za-z0-9./-]{0,20}){1,7})\b/);
    if (match) return match[1].replace(/\s{2,}/g, " ").slice(0, 90);
  }

  const yearLineIndex = lines.findIndex((line) => /^\s*year\s+make\s+model/i.test(line));
  if (yearLineIndex >= 0 && lines[yearLineIndex + 1]) return lines[yearLineIndex + 1].slice(0, 90);
  return undefined;
};

const sumDistinctAmounts = (
  lines: string[],
  labels: RegExp[],
  excludedLabels: RegExp[] = [],
) => {
  const matchedAmountLines = new Set<number>();
  let total = 0;
  lines.forEach((line, index) => {
    if (!labels.some((label) => label.test(line))) return;
    if (excludedLabels.some((label) => label.test(line))) return;
    // Vehicle equipment descriptions can share an extracted PDF line with
    // the payment column. For example, "Roof Rails ... Estimated Payment
    // $625.89" must not turn the printed payment into an accessory price.
    // An accessory amount is still accepted when it appears on its own
    // itemized line, even if that line contains a physical accessory label.
    if (/(?:estimated|monthly|quoted|payment)\b|\b(?:months?|mos?)\s*@/i.test(line)) return;
    const candidates = [index, index + 1, index - 1];
    for (const amountLineIndex of candidates) {
      if (amountLineIndex < 0 || matchedAmountLines.has(amountLineIndex)) continue;
      const amountLine = lines[amountLineIndex] ?? "";
      if (amountLineIndex !== index && /[A-Za-z]{3,}/.test(amountLine)) continue;
      const values = priceValues(amountLine);
      if (!values.length) continue;
      matchedAmountLines.add(amountLineIndex);
      total += values[values.length - 1].value;
      break;
    }
  });
  return total ? Math.round(total * 100) / 100 : undefined;
};

const findPaymentNearLabel = (lines: string[], labels: RegExp[]) => {
  for (let index = 0; index < lines.length; index += 1) {
    const matchingLabel = labels.find((label) => label.test(lines[index]));
    if (!matchingLabel) continue;
    const labelMatch = lines[index].match(matchingLabel);
    const afterLabel = labelMatch?.index === undefined
      ? lines[index]
      : lines[index].slice(labelMatch.index + labelMatch[0].length);
    const directValues = [
      ...priceValues(afterLabel),
      ...plainNumericValues(afterLabel),
    ].filter(({ value }) => value >= 50 && value <= 5000);
    if (directValues.length) return directValues[0].value;
    for (let distance = 0; distance <= 12; distance += 1) {
      for (const candidateIndex of distance ? [index + distance, index - distance] : [index]) {
        const candidateLine = lines[candidateIndex] ?? "";
        const values = priceValues(candidateLine);
        const printedPayment = values.find(({ value, raw }) => {
          if (value < 50 || value > 5000) return false;
          const remainingText = candidateLine
            .replace(raw, "")
            .replace(/[:|()[\].,-]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          return remainingText.length === 0 || labels.some((label) => label.test(remainingText));
        });
        if (printedPayment) return printedPayment.value;

        const plainPayment = plainNumericValues(candidateLine).find(({ value }) =>
          value >= 50 && value <= 5000,
        );
        if (plainPayment) return plainPayment.value;

        const joinedCents = values.find(({ value, raw }) =>
          value >= 50000 && value <= 500000 && raw.includes("$") && !raw.includes(",") && !raw.includes("."),
        );
        if (joinedCents) return joinedCents.value / 100;
      }
    }
  }
  return undefined;
};

export const parseDealerText = (rawLines: string[]): ImportedDealFields => {
  const lines = rawLines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const fields: ImportedDealFields = {};

  const vehicle = vehicleFromLines(lines);
  if (vehicle) fields.vehicle = vehicle;

  const sellingPrice = findAmount(lines, [
    /\b(?:selling|sales?|vehicle|cash)\s+price\b/i,
    /\bveh[a-z]{2,8}\s+price\b/i,
    /\bagreed(?: upon)? (?:price|value)\b/i,
    /\bprice of vehicle\b/i,
  ]);
  if (sellingPrice) fields.sellingPrice = sellingPrice;
  const askingPrice = findAmount(lines, [/\basking price\b/i]);
  const dealerDiscount = findAmount(lines, [
    /\bdealer discount\b/i,
    /\bdiscount(?:\s*\(-\))?\b/i,
  ]);
  if (!fields.sellingPrice && askingPrice) {
    fields.sellingPrice = Math.max(0, askingPrice - (dealerDiscount ?? 0));
  }

  const linesWithoutTaxRates = lines.map((line) => line.replace(/\b\d{1,2}(?:\.\d{1,4})?\s*%/g, ""));
  const tax = findAmount(linesWithoutTaxRates, [
    /\b(?:sales|state|local|vehicle)\s+tax\b/i,
    /\btax amount\b/i,
  ]);
  if (tax) fields.tax = tax;

  const combinedGovernmentFees = findAmount(lines, [
    /\bgovernment fees?\b/i,
    /\btitle(?:,|\s+and)?\s+registration\b/i,
    /\blicense(?:,|\s+and)?\s+registration\b/i,
  ]);
  const itemizedGovernmentFees = sumDistinctAmounts(lines, [
    /\bDMV\s+License\s*\/\s*Title Fees?\b/i,
    /\bDMV\s+Reg(?:istration)?\s*\/\s*Transfer Fees?\b/i,
    /\bReg\s*\/\s*Trans[a-z]*\s*\/\s*DMV Fees?\b/i,
    /\bregistration fees?\b/i,
    /\btitle fees?\b/i,
    /\blicense fees?\b/i,
    /\btire fees?\b/i,
    /\bsmog(?: certification)? fees?\b/i,
    /\b(?:electronic\s+)?filing fees?\b/i,
  ]);
  if (combinedGovernmentFees || itemizedGovernmentFees) fields.govFees = combinedGovernmentFees ?? itemizedGovernmentFees;

  const docFee = findAmount(lines, [
    /\bdoc(?:umentary|umentation)?\s+fee\b/i,
    /\bdealer service fee\b/i,
    /\bprocessing fee\b/i,
  ]);
  if (docFee) fields.docFee = docFee;

  const serviceContractLabels = [
    /\bVSC\b/i,
    /\bvehicle service contract\b/i,
    /\bservice contract\b/i,
    /\bservice agreement\b/i,
    /\bextended warranty\b/i,
    /\bmechanical breakdown (?:coverage|insurance|protection|contract)\b/i,
    /\bvehicle protection (?:plan|program|agreement)\b/i,
    /\bAlly\b.*\b(?:vehicle protection|Major Guard)\b/i,
    /\bAPP\s+Major Guard\b/i,
    /\bMajor Guard\b/i,
    /\b(?:Toyota Extra Care|Ford Protect|Mopar Vehicle Protection|GM Protection Plan)\b/i,
    // GWC is commonly printed as a provider name followed by term/mileage and price.
    /\bGWC\b/i,
    /\b(?:XtraRide|AUL|CNA National|Portfolio|Protective)\b.*\b(?:service|vehicle|warranty|coverage|contract)\b/i,
    /\b(?:Fidelity|JM&A|Zurich|Safe[- ]?Guard)\b.*\b(?:VSC|service contract|vehicle protection|mechanical breakdown)\b/i,
  ];
  const serviceContract = findAmount(lines, serviceContractLabels);
  if (serviceContract) fields.serviceContract = serviceContract;

  const gapLabels = [
    /\bGAP(?: protection| waiver| coverage| insurance)?\b/i,
    /\bguaranteed asset protection\b/i,
    /\bdebt cancellation (?:agreement|addendum|waiver|coverage)\b/i,
    /\bdeficiency waiver\b/i,
    /\bloan(?:\s*\/\s*| and )lease (?:gap|payoff)\b/i,
    /\bAmeri\s*Plus\b.*\b(?:debt cancellation|total loss protection)\b/i,
    /\b(?:Ameri\s*Plus|Ally|Zurich|Safe[- ]?Guard|Fidelity|JM&A|Portfolio)\b.*\bGAP\b/i,
  ];
  const gap = findAmount(lines, gapLabels);
  if (gap) fields.gap = gap;

  const prepaidMaintenanceLabels = [
    /\bPPM\b/i,
    /\bprepaid maintenance\b/i,
    /\bmaintenance (?:plan|package|agreement)\b/i,
    /\bscheduled maintenance (?:plan|program|coverage)\b/i,
    /\bmaintenance care\b/i,
    // Manufacturer menus often shorten the product to a brand name plus
    // "Maintenance", for example "Mitsubishi Maintenance**". Some exports
    // print only "Maintenance" beside the product amount.
    /\bmaintenance\b(?=\s*\**\s*(?:\$|\d))/i,
    /\b(?:ToyotaCare Plus|Audi Care|BMW Ultimate Care)\b/i,
    /\b(?:Honda Care|Mercedes-Benz|Mopar)\b.*\bmaintenance\b/i,
  ];
  const prepaidMaintenance = findAmount(lines, prepaidMaintenanceLabels);
  if (prepaidMaintenance) fields.prepaidMaintenance = prepaidMaintenance;

  const tireWheelLabels = [
    /\bT\s*&\s*W\b/i,
    /\btire(?:s)?\s*(?:and|&|\/)\s*wheel(?:s)?\b/i,
    /\bwheel(?:s)?\s*(?:and|&|\/)\s*tire(?:s)?\b/i,
    /\btire[- ]wheel (?:protection|coverage|plan|package)\b/i,
    /\broad hazard(?: protection| coverage| plan)?\b/i,
    /\b(?:Safe[- ]?Guard|Zurich|Sonsio|Fidelity|JM&A|IAS)\b.*\b(?:tire|wheel|road hazard)\b/i,
  ];
  const tireWheel = findAmount(lines, tireWheelLabels);
  if (tireWheel) fields.tireWheel = tireWheel;

  const accessories = sumDistinctAmounts(lines, [
    /\bconnected car(?: \d+ year)?(?: plan)?\b/i,
    /\bcarnamic connect(?: \d+ year)? plan\b/i,
    /\bZurich Shield\b/i,
    /\bResistAll\b/i,
    /\bCilajet\b/i,
    /\bXzilon\b/i,
    /\bSimoniz(?: GlassCoat)?\b/i,
    /\bPermaPlate\b/i,
    /\bLuxCare\b/i,
    /\bDiamond Ceramic\b/i,
    /\bNanoCure\b/i,
    /\bECP\b.*\b(?:appearance|paint|fabric|environmental)\b/i,
    /\bLo\s*Jack\b/i,
    /\bKahu\b/i,
    /\bStarGard\b/i,
    /\bSWAT\b.*\b(?:GPS|recovery|theft)\b/i,
    /\bRecovR\b/i,
    /\bPassTime\b/i,
    /\bSpireon\b/i,
    /\bElo GPS\b/i,
    /\bGuidepoint\b/i,
    /\bIkon\b.*\b(?:GPS|connect|recovery)\b/i,
    /\bGPS(?: tracker| tracking| recovery| system| device| package)?\b/i,
    /\bvehicle recovery (?:device|system)\b/i,
    /\banti[- ]?theft (?:device|system)\b/i,
    /\btheft DNA(?: DLP)?\b/i,
    /\bappearance(?:\*+)?(?: protection| package| product| plan)?\b/i,
    /\bpaint\s*(?:and|&|\/)\s*fabric(?: protection)?\b/i,
    /\bpaint protection film\b/i,
    /\bPPF\b/i,
    /\bceramic(?: coat(?:ing)?| protection| package)?\b/i,
    /\bclear(?: ?coat)? protection\b/i,
    /\binterior protection\b/i,
    /\benvironmental protection\b/i,
    /\bwindshield (?:protection|coverage|repair)\b/i,
    /\bdent(?: and|\s*&)? ding\b/i,
    /\bkey (?:replacement|protection|coverage)\b/i,
    /\btheft protection\b/i,
    /\bVIN (?:etch|etching)\b/i,
    /\betch(?:ing)?\b/i,
    /\bdata dots?\b/i,
    /\bnitrogen(?: tire| fill| package| protection)?\b/i,
    /\bwindow tint\b/i,
    /\bsecurity (?:system|package)\b/i,
    /\balarm(?: system)?\b/i,
    /\bwheel locks?\b/i,
    /\bfloor mats?\b/i,
    /\bcargo (?:liner|mat|tray)\b/i,
    /\bcargo net\b/i,
    /\bdoor edge guards?\b/i,
    /\bdoor cup guards?\b/i,
    /\bsplash guards?\b/i,
    /\bmud guards?\b/i,
    /\brunning boards?\b/i,
    /\bside steps?\b/i,
    /\bbed ?liner\b/i,
    /\btonneau cover\b/i,
    /\broof (?:rack|rails?)\b/i,
    /\bcross ?bars?\b/i,
    /\btow(?:ing)? hitch\b/i,
    /\bpinstripes?\b/i,
    /\bprotection (?:plan|package|product)\b/i,
    /\bshipping\b/i,
    /\bdealer installed (?:options|accessories)\b/i,
    /\baccessories\b/i,
    /\bother add[- ]?ons\b/i,
  ], [
    ...serviceContractLabels,
    ...gapLabels,
    ...prepaidMaintenanceLabels,
    ...tireWheelLabels,
  ]);
  if (accessories) fields.accessories = accessories;

  const tradeValue = findAmount(lines, [
    /\btrade(?:-in)? (?:allowance|value|credit)\b/i,
    /\bless trade\b/i,
  ]);
  if (tradeValue) fields.tradeValue = tradeValue;

  const tradePayoff = findAmount(lines, [
    /\btrade(?:-in)? (?:loan )?payoff\b/i,
    /\bpayoff (?:amount|balance)\b/i,
    /\bamount owed on trade\b/i,
  ]);
  if (tradePayoff) fields.tradePayoff = tradePayoff;

  const cashDown = findAmount(lines, [
    /\bcash down\b/i,
    /\bdown payment\b/i,
    /\bcash deposit\b/i,
    /\bdeposit\s*\/\s*cash down\b/i,
  ], { allowZero: true });
  if (cashDown !== undefined) fields.cashDown = cashDown;

  const rebate = findAmount(lines, [
    /\bmanufacturer rebate\b/i,
    /\bcash rebate\b/i,
    /\bcustomer(?: cash)? rebate\b/i,
    /\brebate(?:s)?\b/i,
  ]);
  if (rebate) fields.rebate = rebate;

  const totalSalesAmount = findAmount(lines, [/\btotal sales amount\b/i]);
  if (totalSalesAmount) {
    if (!fields.tax && fields.sellingPrice) {
      const netVehiclePrice = fields.sellingPrice - (fields.rebate ?? 0);
      const knownPretaxAmount = netVehiclePrice + (fields.govFees ?? 0) + (fields.docFee ?? 0) +
        (fields.serviceContract ?? 0) + (fields.gap ?? 0) + (fields.prepaidMaintenance ?? 0) +
        (fields.tireWheel ?? 0) + (fields.accessories ?? 0);
      const reconstructedTax = totalSalesAmount - knownPretaxAmount;
      if (reconstructedTax > 0 && reconstructedTax <= netVehiclePrice * 0.2) {
        fields.tax = Math.round(reconstructedTax * 100) / 100;
      }
    }
    const knownExtras = (fields.tax ?? 0) + (fields.govFees ?? 0) + (fields.docFee ?? 0) +
      (fields.serviceContract ?? 0) + (fields.gap ?? 0) + (fields.prepaidMaintenance ?? 0) +
      (fields.tireWheel ?? 0) + (fields.accessories ?? 0);
    const reconciledSellingPrice = totalSalesAmount - knownExtras + (fields.rebate ?? 0);
    if (reconciledSellingPrice >= 1000 && (!fields.sellingPrice || fields.sellingPrice < 1000)) {
      fields.sellingPrice = Math.round(reconciledSellingPrice * 100) / 100;
    }
  }

  const apr = findPercent(lines, [
    /\bAPR\b/i,
    /\bannual percentage rate\b/i,
    /\binterest rate\b/i,
  ]);
  const termAndApr = lines.join(" ").match(/\b(24|30|36|39|42|48|54|60|63|66|72|75|78|84|96)\s*months?\s*@\s*(\d{1,2}(?:\.\d{1,4})?)\s*%/i);
  const resolvedApr = apr ?? (termAndApr ? Number(termAndApr[2]) : undefined);
  if (resolvedApr !== undefined) fields.apr = resolvedApr;

  const term = findTerm(lines);
  if (term) fields.term = term;

  const paymentLabels = [
    /\bmonthly payment\b/i,
    /\bpayment amount\b/i,
    /\bamount of (?:each )?payment\b/i,
    /\bpayment per month\b/i,
    /\bestimated payment\b/i,
  ];
  const labeledQuotedPayment = findPaymentNearLabel(lines, paymentLabels);
  const knownNonPaymentAmounts = [
    fields.sellingPrice,
    fields.tax,
    fields.govFees,
    fields.docFee,
    fields.serviceContract,
    fields.gap,
    fields.prepaidMaintenance,
    fields.tireWheel,
    fields.accessories,
    fields.tradeValue,
    fields.tradePayoff,
    fields.cashDown,
    fields.rebate,
  ].filter((value): value is number => value !== undefined);

  if (labeledQuotedPayment && labeledQuotedPayment >= 50 && labeledQuotedPayment <= 5000) {
    fields.quotedPayment = labeledQuotedPayment;
  }

  if (!fields.quotedPayment) {
    const joinedPaymentText = lines.join(" ");
    const individuallySpacedPayment = joinedPaymentText.match(/\$\s*((?:\d\s+){3,6}\d)\b/);
    const splitCentsPayment = joinedPaymentText.match(/\$\s*(\d{2,4})\s+(\d)\s+(\d)\b/);
    const spacedPaymentDigits = individuallySpacedPayment?.[1].replace(/\s/g, "");
    const spacedQuotedPayment = spacedPaymentDigits && spacedPaymentDigits.length >= 3
      ? Number(`${spacedPaymentDigits.slice(0, -2)}.${spacedPaymentDigits.slice(-2)}`)
      : splitCentsPayment
        ? Number(`${splitCentsPayment[1]}.${splitCentsPayment[2]}${splitCentsPayment[3]}`)
        : undefined;
    const duplicatesKnownAmount = spacedQuotedPayment !== undefined &&
      knownNonPaymentAmounts.some((value) => Math.abs(value - spacedQuotedPayment) < 0.01);
    if (spacedQuotedPayment && spacedQuotedPayment >= 50 && spacedQuotedPayment <= 5000 && !duplicatesKnownAmount) {
      fields.quotedPayment = spacedQuotedPayment;
    }
  }

  if (!fields.quotedPayment) {
    const unmatchedPaymentCandidates = [...new Set(
      lines.flatMap((line) => priceValues(line).map(({ value }) => value))
        .filter((value) => value >= 50 && value <= 5000)
        .filter((value) => !knownNonPaymentAmounts.some((known) => Math.abs(known - value) < 0.01)),
    )];
    if (unmatchedPaymentCandidates.length === 1) {
      fields.quotedPayment = unmatchedPaymentCandidates[0];
    } else if (unmatchedPaymentCandidates.length > 1 && fields.apr && fields.term) {
      const financeAmount = findAmount(lines, [
        /\bcash due\s*\/\s*finance amount\b/i,
        /\bamount financed\b/i,
        /\bfinance amount\b/i,
      ]);
      if (financeAmount && financeAmount >= 1000) {
        const monthlyRate = fields.apr / 1200;
        const calculatedPayment = monthlyRate === 0
          ? financeAmount / fields.term
          : financeAmount * monthlyRate / (1 - Math.pow(1 + monthlyRate, -fields.term));
        const closestPrintedAmount = unmatchedPaymentCandidates
          .sort((first, second) => Math.abs(first - calculatedPayment) - Math.abs(second - calculatedPayment))[0];
        if (Math.abs(closestPrintedAmount - calculatedPayment) <= Math.max(5, calculatedPayment * 0.02)) {
          fields.quotedPayment = closestPrintedAmount;
        }
      }
    }
  }

  return sanitizeImportedFields(fields).fields;
};

const pageLines = async (page: PdfPageLike) => {
  const content = await page.getTextContent();
  const groups = new Map<number, { x: number; text: string }[]>();

  content.items.forEach((item) => {
    if (!item || typeof item !== "object" || !("str" in item) || typeof item.str !== "string" || !item.str.trim()) return;
    const textItem = item as PdfTextItem;
    const x = textItem.transform[4] ?? 0;
    const y = Math.round((textItem.transform[5] ?? 0) * 2) / 2;
    const group = groups.get(y) ?? [];
    group.push({ x, text: textItem.str.trim() });
    groups.set(y, group);
  });

  return [...groups.entries()]
    .sort(([firstY], [secondY]) => secondY - firstY)
    .map(([, items]) => items.sort((first, second) => first.x - second.x).map((item) => item.text).join(" "));
};

const createDealOcrWorker = async (
  onProgress?: (update: DealImportProgress) => void,
  layout: "sparse" | "form" = "sparse",
) => {
  const { createWorker, PSM } = await import("tesseract.js");
  const firstPathSegment = window.location.pathname.split("/").filter(Boolean)[0];
  const siteBasePath = window.location.hostname.endsWith("github.io") && firstPathSegment
    ? `/${firstPathSegment}`
    : "";
  const ocrBasePath = `${siteBasePath}/ocr`;
  const worker = await createWorker("eng", 1, {
    workerPath: `${ocrBasePath}/worker.min.js`,
    corePath: `${ocrBasePath}/tesseract-core-lstm.wasm.js`,
    langPath: ocrBasePath,
    logger: ({ progress, status }) => onProgress?.({ progress, status }),
  });
  await worker.setParameters({
    tessedit_pageseg_mode: layout === "form" ? PSM.SINGLE_BLOCK : PSM.SPARSE_TEXT,
  });
  return worker;
};

const recognizeImages = async (
  images: Uint8Array[],
  onProgress?: (update: DealImportProgress) => void,
  layout: "sparse" | "form" = "sparse",
) => {
  const worker = await createDealOcrWorker(onProgress, layout);
  const text: string[] = [];

  try {
    for (let index = 0; index < images.length; index += 1) {
      if (images.length > 1) {
        onProgress?.({ progress: 0, status: `reading scanned PDF page ${index + 1} of ${images.length}` });
      }
      const result = await worker.recognize(images[index] as unknown as File, { rotateAuto: true });
      text.push(result.data.text);
    }
  } finally {
    await worker.terminate();
  }

  return text.join("\n").trim();
};

const preprocessDealPhoto = async (file: File) => {
  const bitmap = await createImageBitmap(file);
  const detectionScale = Math.min(1, 520 / Math.max(bitmap.width, bitmap.height));
  const detectionWidth = Math.max(1, Math.round(bitmap.width * detectionScale));
  const detectionHeight = Math.max(1, Math.round(bitmap.height * detectionScale));
  const detectionCanvas = document.createElement("canvas");
  detectionCanvas.width = detectionWidth;
  detectionCanvas.height = detectionHeight;
  const detectionContext = detectionCanvas.getContext("2d", { alpha: false });
  if (!detectionContext) throw new Error("IMAGE_PREPROCESS_ERROR");
  detectionContext.drawImage(bitmap, 0, 0, detectionWidth, detectionHeight);

  const pixels = detectionContext.getImageData(0, 0, detectionWidth, detectionHeight).data;
  const bright = new Uint8Array(detectionWidth * detectionHeight);
  for (let index = 0; index < bright.length; index += 1) {
    const pixelIndex = index * 4;
    const red = pixels[pixelIndex];
    const green = pixels[pixelIndex + 1];
    const blue = pixels[pixelIndex + 2];
    const luma = red * 0.299 + green * 0.587 + blue * 0.114;
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
    bright[index] = luma >= 145 && spread <= 95 ? 1 : 0;
  }

  const visited = new Uint8Array(bright.length);
  const queue = new Int32Array(bright.length);
  let best = { area: 0, minX: 0, minY: 0, maxX: detectionWidth - 1, maxY: detectionHeight - 1 };
  for (let start = 0; start < bright.length; start += 1) {
    if (!bright[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let area = 0;
    let minX = detectionWidth;
    let minY = detectionHeight;
    let maxX = 0;
    let maxY = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const current = queue[head++];
      const x = current % detectionWidth;
      const y = Math.floor(current / detectionWidth);
      area += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const neighbors = [current - 1, current + 1, current - detectionWidth, current + detectionWidth];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= bright.length || visited[neighbor] || !bright[neighbor]) continue;
        const neighborX = neighbor % detectionWidth;
        if (Math.abs(neighborX - x) > 1) continue;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    if (area > best.area) best = { area, minX, minY, maxX, maxY };
  }

  const detectedWidth = best.maxX - best.minX + 1;
  const detectedHeight = best.maxY - best.minY + 1;
  const detectedBoxArea = detectedWidth * detectedHeight;
  const frameArea = detectionWidth * detectionHeight;
  const useCrop = best.area >= frameArea * 0.08 && detectedBoxArea <= frameArea * 0.92 &&
    detectedWidth >= detectionWidth * 0.28 && detectedHeight >= detectionHeight * 0.28;
  const padding = useCrop ? Math.round(Math.max(detectedWidth, detectedHeight) * 0.025) : 0;
  const cropX = useCrop ? Math.max(0, best.minX - padding) : 0;
  const cropY = useCrop ? Math.max(0, best.minY - padding) : 0;
  const cropRight = useCrop ? Math.min(detectionWidth, best.maxX + padding + 1) : detectionWidth;
  const cropBottom = useCrop ? Math.min(detectionHeight, best.maxY + padding + 1) : detectionHeight;
  const sourceX = Math.round(cropX / detectionScale);
  const sourceY = Math.round(cropY / detectionScale);
  const sourceWidth = Math.min(bitmap.width - sourceX, Math.round((cropRight - cropX) / detectionScale));
  const sourceHeight = Math.min(bitmap.height - sourceY, Math.round((cropBottom - cropY) / detectionScale));
  const outputScale = Math.min(2.5, Math.max(1, 1400 / Math.max(1, sourceWidth)));
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = Math.max(1, Math.round(sourceWidth * outputScale));
  outputCanvas.height = Math.max(1, Math.round(sourceHeight * outputScale));
  const outputContext = outputCanvas.getContext("2d", { alpha: false });
  if (!outputContext) throw new Error("IMAGE_PREPROCESS_ERROR");
  outputContext.filter = "grayscale(1) contrast(1.2)";
  outputContext.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    outputCanvas.width,
    outputCanvas.height,
  );
  bitmap.close();
  detectionCanvas.width = 1;
  detectionCanvas.height = 1;
  const blob = await new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob((value) => value ? resolve(value) : reject(new Error("IMAGE_PREPROCESS_ERROR")), "image/jpeg", 0.92);
  });
  outputCanvas.width = 1;
  outputCanvas.height = 1;
  return new Uint8Array(await blob.arrayBuffer());
};

const preprocessDealPhotoFullFrame = async (file: File, threshold = false) => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(2.5, Math.max(1, 2200 / Math.max(bitmap.width, bitmap.height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("IMAGE_PREPROCESS_ERROR");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = threshold ? "grayscale(1) contrast(1.45) brightness(1.08)" : "grayscale(1) contrast(1.3)";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (threshold) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const value = pixels.data[index] >= 170 ? 255 : 0;
      pixels.data[index] = value;
      pixels.data[index + 1] = value;
      pixels.data[index + 2] = value;
    }
    context.putImageData(pixels, 0, 0);
  }
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("IMAGE_PREPROCESS_ERROR")), "image/png");
  });
  canvas.width = 1;
  canvas.height = 1;
  return new Uint8Array(await blob.arrayBuffer());
};

const renderPdfPageForOcr = async (page: PdfRenderablePageLike) => {
  const viewport = page.getViewport({ scale: 3 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const canvasContext = canvas.getContext("2d", { alpha: false });
  if (!canvasContext) throw new Error("PDF_RENDER_ERROR");

  await page.render({ canvas, canvasContext, viewport }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PDF_RENDER_ERROR")), "image/png");
  });
  const image = new Uint8Array(await blob.arrayBuffer());
  canvas.width = 1;
  canvas.height = 1;
  return image;
};

export const extractDealFromPdf = async (
  file: File,
  onProgress?: (update: DealImportProgress) => void,
): Promise<DealPdfResult> => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const pdfDocument = await pdfjs.getDocument({ data }).promise;
  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    lines.push(...await pageLines(page));
  }

  const digitalFields = parseDealerText(lines);
  const digitalOfferMatrix = parseOfferMatrix(lines);
  const digitalNeedsVerification = criticalImportFields.some((field) => digitalFields[field] === undefined) ||
    Object.keys(digitalFields).length < 8;
  let fields = digitalFields;
  let offerMatrix = digitalOfferMatrix;
  let usedOcr = false;
  let pagesProcessed = 0;
  let warnings: string[] = [];

  // A PDF may contain a partial text layer. OCR it when critical values are
  // missing, rather than accepting a plausible-looking partial import.
  if (digitalNeedsVerification) {
    pagesProcessed = Math.min(pdfDocument.numPages, 10);
    const images: Uint8Array[] = [];
    for (let pageNumber = 1; pageNumber <= pagesProcessed; pageNumber += 1) {
      onProgress?.({ progress: (pageNumber - 1) / pagesProcessed, status: `preparing scanned PDF page ${pageNumber} of ${pagesProcessed}` });
      const page = await pdfDocument.getPage(pageNumber);
      images.push(await renderPdfPageForOcr(page as unknown as PdfRenderablePageLike));
    }
    const ocrText = await recognizeImages(images, onProgress, "sparse");
    const ocrFields = parseDealerText(ocrText.split(/\r?\n/));
    if (ocrText.replace(/\s/g, "").length >= 30) {
      fields = mergeImportedCandidates([digitalFields, ocrFields]);
      offerMatrix = chooseBetterOfferMatrix(digitalOfferMatrix, parseOfferMatrix(ocrText.split(/\r?\n/)));
      usedOcr = true;
    } else if (!Object.keys(digitalFields).length && !digitalOfferMatrix) {
      throw new Error("UNREADABLE_IMAGE");
    }
  }

  const reconciled = reconcileQuotedPayment(fields);
  warnings = reconciled.warnings;
  const fieldConfidence = confidenceFor(reconciled.fields, usedOcr ? "review" : "high");
  if (reconciled.warnings.length && reconciled.fields.quotedPayment) fieldConfidence.quotedPayment = "review";
  const fieldNames = Object.keys(reconciled.fields).map((field) => DEAL_FIELD_LABELS[field as keyof ImportedDealFields]);
  return {
    fields: reconciled.fields,
    fieldConfidence,
    fieldNames,
    pageCount: pdfDocument.numPages,
    sourceType: "pdf",
    usedOcr,
    pagesProcessed,
    warnings,
    offerMatrix,
  };
};

export const extractDealFromImage = async (
  file: File,
  onProgress?: (update: DealImportProgress) => void,
): Promise<DealPdfResult> => {
  onProgress?.({ progress: 0, status: "isolating the dealer worksheet" });
  const preparedImage = await preprocessDealPhoto(file);
  const thresholdImage = await preprocessDealPhotoFullFrame(file, true);
  const fullFrameImage = await preprocessDealPhotoFullFrame(file);
  const texts: string[] = [];
  onProgress?.({ progress: 0, status: "reading the document with multiple layouts" });
  texts.push(await recognizeImages([preparedImage], onProgress, "form"));
  onProgress?.({ progress: 0, status: "checking alternate document layout" });
  texts.push(await recognizeImages([preparedImage], onProgress, "sparse"));
  onProgress?.({ progress: 0, status: "checking enhanced full frame" });
  texts.push(await recognizeImages([fullFrameImage], onProgress, "sparse"));
  onProgress?.({ progress: 0, status: "checking high-contrast text" });
  texts.push(await recognizeImages([thresholdImage], onProgress, "sparse"));

  const readableTexts = texts.filter((text) => text.replace(/\s/g, "").length >= 30);
  if (!readableTexts.length) throw new Error("UNREADABLE_IMAGE");
  const candidates = readableTexts.map((text) => parseDealerText(text.split(/\r?\n/)));
  let fields = mergeImportedCandidates(candidates);
  let offerMatrix: DealOfferMatrix | undefined;
  for (const text of readableTexts) offerMatrix = chooseBetterOfferMatrix(offerMatrix, parseOfferMatrix(text.split(/\r?\n/)));
  const reconciled = reconcileQuotedPayment(fields);
  const fieldNames = Object.keys(reconciled.fields).map((field) => DEAL_FIELD_LABELS[field as keyof ImportedDealFields]);
  return {
    fields: reconciled.fields,
    fieldConfidence: confidenceFor(reconciled.fields, "review"),
    fieldNames,
    pageCount: 1,
    sourceType: "image",
    usedOcr: true,
    pagesProcessed: 1,
    warnings: reconciled.warnings,
    offerMatrix,
  };
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return btoa(binary);
};

// Small phone screenshots and compressed social-media images lose the character
// detail that both Tesseract and vision models need. Upscale before the server
// request, while keeping the original untouched for the user's evidence view.
const prepareVisionImage = async (file: File) => {
  if (typeof window === "undefined") return { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(5, Math.max(2, 1800 / Math.max(bitmap.width, bitmap.height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("IMAGE_PREPROCESS_ERROR");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = "grayscale(1) contrast(1.12) brightness(1.03)";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("IMAGE_PREPROCESS_ERROR")), "image/jpeg", 0.94);
  });
  canvas.width = 1;
  canvas.height = 1;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: "image/jpeg" };
};

/**
 * Server-side document vision is an escalation path after local extraction,
 * not the first step. This keeps ordinary quote images private and avoids
 * spending provider quota when browser OCR already found a usable quote.
 */
const extractDealWithServerVision = async (
  file: File,
  onProgress?: (update: DealImportProgress) => void,
  upload?: { bytes: Uint8Array; mimeType: string },
): Promise<DealPdfResult> => {
  if (typeof window === "undefined") throw new Error("AI_IMPORT_UNAVAILABLE");
  const prepared = upload ?? { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: mimeTypeForDealImport(file) };
  onProgress?.({ progress: 0.08, status: "sending the document to PencilProof vision import" });
  const response = await fetch("https://audit.pencilproof.com/api/ai-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mimeType: prepared.mimeType || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/png"),
      base64: bytesToBase64(prepared.bytes),
    }),
  });
  const payload = await response.json() as {
    fields?: Record<string, unknown>;
    warnings?: string[];
    fieldConfidence?: DealPdfResult["fieldConfidence"];
    offerMatrix?: DealOfferMatrix;
    error?: string;
    providerCode?: string;
  };
  if (!response.ok) {
    const code = payload.providerCode ? `_${payload.providerCode}` : "";
    throw new Error(payload.error === "AI_IMPORT_PROVIDER_ERROR" ? `AI_IMPORT_PROVIDER${code}` : (payload.error ?? "AI_IMPORT_UNAVAILABLE"));
  }
  const source = (payload.fields ?? {}) as ImportedDealFields;
  const fields = sanitizeImportedFields(source).fields;
  if (!Object.keys(fields).length) throw new Error("AI_IMPORT_EMPTY");
  const reconciled = reconcileQuotedPayment(fields);
  const warnings = [...(payload.warnings ?? []), ...reconciled.warnings];
  const offerMatrix = payload.offerMatrix?.options?.length
    ? {
      options: payload.offerMatrix.options,
      warnings: payload.offerMatrix.warnings ?? [],
    }
    : undefined;
  onProgress?.({ progress: 1, status: "AI document extraction complete" });
  return {
    fields: reconciled.fields,
    fieldConfidence: payload.fieldConfidence ?? confidenceFor(reconciled.fields, "review"),
    fieldNames: Object.keys(reconciled.fields).map((field) => DEAL_FIELD_LABELS[field as keyof ImportedDealFields]),
    pageCount: file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? 1 : 1,
    sourceType: file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "image",
    usedOcr: true,
    pagesProcessed: 1,
    warnings,
    offerMatrix,
  };
};

/**
 * A quote does not need vision merely because optional categories are absent.
 * Rebate, VSC, PPM, T&W, accessories, and trade fields are legitimately
 * missing on many dealer worksheets. Escalate only when local extraction did
 * not produce enough numeric deal data to be a usable quote preview.
 */
export const isLocallyReadableImport = (result: Pick<DealPdfResult, "fields" | "fieldNames" | "offerMatrix">) => {
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

const reconcileLocalAndVision = (
  local: DealPdfResult,
  vision: DealPdfResult,
): DealPdfResult => {
  const fields = { ...local.fields } as Record<keyof ImportedDealFields, string | number | undefined>;
  const confidence: DealPdfResult["fieldConfidence"] = { ...local.fieldConfidence };

  // Keep strong digital text evidence. Use vision for missing or OCR-only
  // values, while retaining the review flag for user confirmation.
  (Object.keys(DEAL_FIELD_LABELS) as (keyof ImportedDealFields)[]).forEach((field) => {
    const localValue = local.fields[field];
    const visionValue = vision.fields[field];
    if (localValue === undefined && visionValue !== undefined) {
      fields[field] = visionValue;
      confidence[field] = "review";
    } else if (local.usedOcr && visionValue !== undefined && confidence[field] !== "high") {
      fields[field] = visionValue;
      confidence[field] = "review";
    }
  });

  const sanitized = sanitizeImportedFields(fields as ImportedDealFields).fields;
  const reconciled = reconcileQuotedPayment(sanitized);
  const warnings = Array.from(new Set([
    ...(local.warnings ?? []),
    ...(vision.warnings ?? []),
    ...reconciled.warnings,
  ]));
  return {
    ...local,
    fields: reconciled.fields,
    fieldConfidence: Object.fromEntries(
      Object.keys(reconciled.fields).map((field) => [field, confidence[field as keyof ImportedDealFields] ?? "review"]),
    ) as DealPdfResult["fieldConfidence"],
    fieldNames: Object.keys(reconciled.fields).map((field) => DEAL_FIELD_LABELS[field as keyof ImportedDealFields]),
    warnings,
  };
};

export const extractDealFromFile = async (
  file: File,
  onProgress?: (update: DealImportProgress) => void,
): Promise<DealPdfResult> => {
  const isPdf = isDealImportPdf(file);
  const isImage = isDealImportFile(file) && !isPdf;

  if (isPdf || isImage) {
    let localResult: DealPdfResult;
    try {
      localResult = isPdf
        ? await extractDealFromPdf(file, onProgress)
        : await extractDealFromImage(file, onProgress);
    } catch (localError) {
      try {
        const upload = isImage ? await prepareVisionImage(file) : undefined;
        return await extractDealWithServerVision(file, onProgress, upload);
      } catch (visionError) {
        // When local extraction failed and the escalation provider also fails,
        // preserve the provider category so the user sees the actionable cause
        // instead of a generic OCR failure.
        throw visionError instanceof Error ? visionError : localError;
      }
    }

    // Missing optional fields are normal. Once local OCR has produced a
    // usable quote, preserve it and do not spend Gemini quota or let vision
    // overwrite correct local values.
    if (isLocallyReadableImport(localResult)) return localResult;

    const upload = isImage ? await prepareVisionImage(file) : undefined;
    const visionResult = await extractDealWithServerVision(file, onProgress, upload);
    return reconcileLocalAndVision(localResult, visionResult);
  }
  throw new Error("UNSUPPORTED_FILE");
};
