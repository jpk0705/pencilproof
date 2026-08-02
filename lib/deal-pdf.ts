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
      `Payment warning: the document shows $${fields.quotedPayment.toFixed(2)}, while the imported figures calculate to $${roundedCalculatedPayment.toFixed(2)} per monthâ€”a $${difference.toFixed(2)} difference. PencilProof preserved both values. Ask the dealer to reconcile the amount financed, APR, term, and first-payment due date; an undisclosed amount, deferred first payment, or packed payment may explain the gap.`,
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
  const detectionScale = Math.ßÞw¶‰žËkºwµçAMÑÉ¥¹œ¹™É½µ¡…É½‘” ¸¸¹‰åÑ•Ì¹ÍÕ‰…ÉÉ…ä¡¥¹‘•à°5…Ñ ¹µ¥¸¡¥¹‘•à€¬¡Õ¹­M¥é”°‰åÑ•Ì¹±•¹Ñ ¤¤¤ì(€ô(€É•ÑÕÉ¸‰Ñ½„¡‰¥¹…Éä¤ì)ôì()½¹ÍÐ¥ÍA¡½Ñ½1¥­•%µ…”€ô…Íå¹Œ€¡™¥±”è¥±”¤€ôøì(€¥˜€¡ÑåÁ•½˜Ý¥¹‘½Ü€ôôô€‰Õ¹‘•™¥¹•ˆ¤É•ÑÕÉ¸™…±Í”ì(€ÑÉäì(€€€½¹ÍÐ‰¥Ñµ…À€ô…Ý…¥ÐÉ•…Ñ•%µ…•	¥Ñµ…À¡™¥±”¤ì(€€€½¹ÍÐÁ¥á•±Ì€ô‰¥Ñµ…À¹Ý¥‘Ñ €¨‰¥Ñµ…À¹¡•¥¡Ðì(€€€½¹ÍÐÁ¡½Ñ½1¥­”€ô5…Ñ ¹µ…à¡‰¥Ñµ…À¹Ý¥‘Ñ °‰¥Ñµ…À¹¡•¥¡Ð¤€ð€ÄÐÀÀñðÁ¥á•±Ì€ð€Å|ÀÀÁ|ÀÀÀì(€€€‰¥Ñµ…À¹±½Í” ¤ì(€€€É•ÑÕÉ¸Á¡½Ñ½1¥­”ì(€ô…Ñ ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô)ôì((¼¼Mµ…±°Á¡½¹”ÍÉ••¹Í¡½ÑÌ…¹½µÁÉ•ÍÍ•Í½¥…°µµ•‘¥„¥µ…•Ì±½Í”Ñ¡”¡…É…Ñ•È(¼¼‘•Ñ…¥°Ñ¡…Ð‰½Ñ Q•ÍÍ•É…Ð…¹Ù¥Í¥½¸µ½‘•±Ì¹••¸UÁÍ…±”‰•™½É”Ñ¡”Í•ÉÙ•È(¼¼É•ÅÕ•ÍÐ°Ý¡¥±”­••Á¥¹œÑ¡”½É¥¥¹…°Õ¹Ñ½Õ¡•™½ÈÑ¡”ÕÍ•ÈÌ•Ù¥‘•¹”Ù¥•Ü¸)½¹ÍÐÁÉ•Á…É•Y¥Í¥½¹%µ…”€ô…Íå¹Œ€¡™¥±”è¥±”¤€ôøì(€¥˜€¡ÑåÁ•½˜Ý¥¹‘½Ü€ôôô€‰Õ¹‘•™¥¹•ˆ¤É•ÑÕÉ¸ì‰åÑ•Ìè¹•ÜU¥¹ÐáÉÉ…ä¡…Ý…¥Ð™¥±”¹…ÉÉ…å	Õ™™•È ¤¤°µ¥µ•QåÁ”è™¥±”¹ÑåÁ”ôì(€½¹ÍÐ‰¥Ñµ…À€ô…Ý…¥ÐÉ•…Ñ•%µ…•	¥Ñµ…À¡™¥±”¤ì(€½¹ÍÐÍ…±”€ô5…Ñ ¹µ¥¸ Ô°5…Ñ ¹µ…à È°€ÄàÀÀ€¼5…Ñ ¹µ…à¡‰¥Ñµ…À¹Ý¥‘Ñ °‰¥Ñµ…À¹¡•¥¡Ð¤¤¤ì(€½¹ÍÐ…¹Ù…Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰…¹Ù…Ìˆ¤ì(€…¹Ù…Ì¹Ý¥‘Ñ €ô5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹¡‰¥Ñµ…À¹Ý¥‘Ñ €¨Í…±”¤¤ì(€…¹Ù…Ì¹¡•¥¡Ð€ô5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹¡‰¥Ñµ…À¹¡•¥¡Ð€¨Í…±”¤¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…¹Ù…Ì¹•Ñ½¹Ñ•áÐ ˆÉˆ°ì…±Á¡„è™…±Í”ô¤ì(€¥˜€ …½¹Ñ•áÐ¤Ñ¡É½Ü¹•ÜÉÉ½È ‰%5}AIAI=MM}II=Hˆ¤ì(€½¹Ñ•áÐ¹¥µ…•Mµ½½Ñ¡¥¹¹…‰±•€ôÑÉÕ”ì(€½¹Ñ•áÐ¹¥µ…•Mµ½½Ñ¡¥¹EÕ…±¥Ñä€ô€‰¡¥ ˆì(€½¹Ñ•áÐ¹™¥±Ñ•È€ô€‰É…åÍ…±” Ä¤½¹ÑÉ…ÍÐ Ä¸ÄÈ¤‰É¥¡Ñ¹•ÍÌ Ä¸ÀÌ¤ˆì(€½¹Ñ•áÐ¹‘É…Ý%µ…”¡‰¥Ñµ…À°€À°€À°…¹Ù…Ì¹Ý¥‘Ñ °…¹Ù…Ì¹¡•¥¡Ð¤ì(€‰¥Ñµ…À¹±½Í” ¤ì(€½¹ÍÐ‰±½ˆ€ô…Ý…¥Ð¹•ÜAÉ½µ¥Í”ñ	±½ˆø ¡É•Í½±Ù”°É•©•Ð¤€ôøì(€€€…¹Ù…Ì¹Ñ½	±½ˆ ¡Ù…±Õ”¤€ôøÙ…±Õ”€üÉ•Í½±Ù”¡Ù…±Õ”¤€èÉ•©•Ð¡¹•ÜÉÉ½È ‰%5}AIAI=MM}II=Hˆ¤¤°€‰¥µ…”½©Á•œˆ°€À¸äÐ¤ì(€ô¤ì(€…¹Ù…Ì¹Ý¥‘Ñ €ô€Äì(€…¹Ù…Ì¹¡•¥¡Ð€ô€Äì(€É•ÑÕÉ¸ì‰åÑ•Ìè¹•ÜU¥¹ÐáÉÉ…ä¡…Ý…¥Ð‰±½ˆ¹…ÉÉ…å	Õ™™•È ¤¤°µ¥µ•QåÁ”è€‰¥µ…”½©Á•œˆôì)ôì((¼¨¨(€¨EÕ½Ñ••™•¹‘•ÈÌ…ÕÉ…ä…‘Ù…¹Ñ…”½µ•Ì™É½´Í•ÉÙ•ÈµÍ¥‘”‘½Õµ•¹ÐÙ¥Í¥½¸(€¨™½±±½Ý•‰ä„±…å½ÕÐµ…Ý…É”ÍÑÉÕÑÕÉ••áÑÉ…Ñ¥½¸ÁÉ½µÁÐ¸A•¹¥±AÉ½½˜­••ÁÌ(€¨Ñ¡”±½…°=HÁ…Ñ …Ì„™…±±‰…¬°‰ÕÐÕÍ•ÌÑ¡”Í…µ”ÍÑÉ½¹•È…É¡¥Ñ•ÑÕÉ”(€¨Ý¡•¹•Ù•ÈÑ¡”ÁÉ½‘ÕÑ¥½¸$¥µÁ½ÉÑ•È¥Ì½¹™¥ÕÉ•¸(€¨¼)½¹ÍÐ•áÑÉ…Ñ•…±]¥Ñ¡M•ÉÙ•ÉY¥Í¥½¸€ô…Íå¹Œ€ (€™¥±”è¥±”°(€½¹AÉ½É•ÍÌüè€¡ÕÁ‘…Ñ”è•…±%µÁ½ÉÑAÉ½É•ÍÌ¤€ôøÙ½¥°(€ÕÁ±½…üèì‰åÑ•ÌèU¥¹ÐáÉÉ…äìµ¥µ•QåÁ”èÍÑÉ¥¹œô°(¤èAÉ½µ¥Í”ñ•…±A‘™I•ÍÕ±Ðø€ôøì(€¥˜€¡ÑåÁ•½˜Ý¥¹‘½Ü€ôôô€‰Õ¹‘•™¥¹•ˆ¤Ñ¡É½Ü¹•ÜÉÉ½È ‰%}%5A=IQ}U9Y%1	1ˆ¤ì(€½¹ÍÐÁÉ•Á…É•€ôÕÁ±½…€üüì‰åÑ•Ìè¹•ÜU¥¹ÐáÉÉ…ä¡…Ý…¥Ð™¥±”¹…ÉÉ…å	Õ™™•È ¤¤°µ¥µ•QåÁ”è™¥±”¹ÑåÁ”ñð€‰¥µ…”½Á¹œˆôì(€½¹AÉ½É•ÍÌü¸¡ìÁÉ½É•ÍÌè€À¸Àà°ÍÑ…ÑÕÌè€‰Í•¹‘¥¹œÑ¡”‘½Õµ•¹ÐÑ¼A•¹¥±AÉ½½˜Ù¥Í¥½¸¥µÁ½ÉÐˆô¤ì(€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ  ‰¡ÑÑÁÌè¼½…Õ‘¥Ð¹Á•¹¥±ÁÉ½½˜¹½´½…Á¤½…¤µ¥µÁ½ÉÐˆ°ì(€€€µ•Ñ¡½è€‰A=MPˆ°(€€€¡•…‘•ÉÌèì€‰½¹Ñ•¹ÐµQåÁ”ˆè€‰…ÁÁ±¥…Ñ¥½¸½©Í½¸ˆô°(€€€‰½‘äè)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€€€µ¥µ•QåÁ”èÁÉ•Á…É•¹µ¥µ•QåÁ”ñð€¡™¥±”¹¹…µ”¹Ñ½1½Ý•É…Í” ¤¹•¹‘Í]¥Ñ  ˆ¹Á‘˜ˆ¤€ü€‰…ÁÁ±¥…Ñ¥½¸½Á‘˜ˆ€è€‰¥µ…”½Á¹œˆ¤°(€€€€€‰…Í”ØÐè‰åÑ•ÍQ½	…Í”ØÐ¡ÁÉ•Á…É•¹‰åÑ•Ì¤°(€€€ô¤°(€ô¤ì(€½¹ÍÐÁ…å±½…€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹©Í½¸ ¤…Ìì(€€€™¥•±‘ÌüèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì(€€€Ý…É¹¥¹ÌüèÍÑÉ¥¹mtì(€€€™¥•±‘½¹™¥‘•¹”üè•…±A‘™I•ÍÕ±Ñl‰™¥•±‘½¹™¥‘•¹”‰tì(€€€•ÉÉ½ÈüèÍÑÉ¥¹œì(€€€ÁÉ½Ù¥‘•É½‘”üèÍÑÉ¥¹œì(€ôì(€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì(€€€½¹ÍÐ½‘”€ôÁ…å±½…¹ÁÉ½Ù¥‘•É½‘”€ü|‘íÁ…å±½…¹ÁÉ½Ù¥‘•É½‘•õ€€è€ˆˆì(€€€Ñ¡É½Ü¹•ÜÉÉ½È¡Á…å±½…¹•ÉÉ½È€ôôô€‰%}%5A=IQ}AI=Y%I}II=Hˆ€ü%}%5A=IQ}AI=Y%H‘í½‘•õ€€è€¡Á…å±½…¹•ÉÉ½È€üü€‰%}%5A=IQ}U9Y%1	1ˆ¤¤ì(€ô(€½¹ÍÐÍ½ÕÉ”€ô€¡Á…å±½…¹™¥•±‘Ì€üüíô¤…Ì%µÁ½ÉÑ•‘•…±¥•±‘Ìì(€½¹ÍÐ™¥•±‘Ì€ôÍ…¹¥Ñ¥é•%µÁ½ÉÑ•‘¥•±‘Ì¡Í½ÕÉ”¤¹™¥•±‘Ìì(€¥˜€ …=‰©•Ð¹­•åÌ¡™¥•±‘Ì¤¹±•¹Ñ ¤Ñ¡É½Ü¹•ÜÉÉ½È ‰%}%5A=IQ}5AQdˆ¤ì(€½¹ÍÐÉ•½¹¥±•€ôÉ•½¹¥±•EÕ½Ñ•‘A…åµ•¹Ð¡™¥•±‘Ì¤ì(€½¹ÍÐÝ…É¹¥¹Ì€ôl¸¸¸¡Á…å±½…¹Ý…É¹¥¹Ì€üümt¤°€¸¸¹É•½¹¥±•¹Ý…É¹¥¹Ítì(€½¹AÉ½É•ÍÌü¸¡ìÁÉ½É•ÍÌè€Ä°ÍÑ…ÑÕÌè€‰$‘½Õµ•¹Ð•áÑÉ…Ñ¥½¸½µÁ±•Ñ”ˆô¤ì(€É•ÑÕÉ¸ì(€€€™¥•±‘ÌèÉ•½¹¥±•¹™¥•±‘Ì°(€€€™¥•±‘½¹™¥‘•¹”èÁ…å±½…¹™¥•±‘½¹™¥‘•¹”€üü½¹™¥‘•¹•½È¡É•½¹¥±•¹™¥•±‘Ì°€‰É•Ù¥•Üˆ¤°(€€€™¥•±‘9…µ•Ìè=‰©•Ð¹­•åÌ¡É•½¹¥±•¹™¥•±‘Ì¤¹µ…À ¡™¥•±¤€ôø1}%1}1	1Mm™¥•±…Ì­•å½˜%µÁ½ÉÑ•‘•…±¥•±‘Ít¤°(€€€Á…•½Õ¹Ðè™¥±”¹ÑåÁ”€ôôô€‰…ÁÁ±¥…Ñ¥½¸½Á‘˜ˆñð™¥±”¹¹…µ”¹Ñ½1½Ý•É…Í” ¤¹•¹‘Í]¥Ñ  ˆ¹Á‘˜ˆ¤€ü€Ä€è€Ä°(€€€Í½ÕÉ•QåÁ”è™¥±”¹ÑåÁ”€ôôô€‰…ÁÁ±¥…Ñ¥½¸½Á‘˜ˆñð™¥±”¹¹…µ”¹Ñ½1½Ý•É…Í” ¤¹•¹‘Í]¥Ñ  ˆ¹Á‘˜ˆ¤€ü€‰Á‘˜ˆ€è€‰¥µ…”ˆ°(€€€ÕÍ•‘=ÈèÑÉÕ”°(€€€Á…•ÍAÉ½•ÍÍ•è€Ä°(€€€Ý…É¹¥¹Ì°(€ôì)ôì((¼¨¨(€¨ÅÕ½Ñ”‘½•Ì¹½Ð¹••Ù¥Í¥½¸µ•É•±ä‰•…ÕÍ”½ÁÑ¥½¹…°…Ñ•½É¥•Ì…É”…‰Í•¹Ð¸(€¨I•‰…Ñ”°YM°AA4°P™\°…•ÍÍ½É¥•Ì°…¹ÑÉ…‘”™¥•±‘Ì…É”±•¥Ñ¥µ…Ñ•±ä(€¨µ¥ÍÍ¥¹œ½¸µ…¹ä‘•…±•ÈÝ½É­Í¡••ÑÌ¸Í…±…Ñ”½¹±äÝ¡•¸±½…°•áÑÉ…Ñ¥½¸‘¥(€¨¹½ÐÁÉ½‘Õ”•¹½Õ ¹Õµ•É¥Œ‘•…°‘…Ñ„Ñ¼‰”„ÕÍ…‰±”ÅÕ½Ñ”ÁÉ•Ù¥•Ü¸(€¨¼)•áÁ½ÉÐ½¹ÍÐ¥Í1½…±±åI•…‘…‰±•%µÁ½ÉÐ€ô€¡É•ÍÕ±ÐèA¥¬ñ•…±A‘™I•ÍÕ±Ð°€‰™¥•±‘Ìˆð€‰™¥•±‘9…µ•Ìˆð€‰½™™•É5…ÑÉ¥àˆø¤€ôøì(€¥˜€¡É•ÍÕ±Ð¹½™™•É5…ÑÉ¥àü¹½ÁÑ¥½¹Ì¹±•¹Ñ ¤É•ÑÕÉ¸ÑÉÕ”ì(€½¹ÍÐ¹Õµ•É¥¥•±‘½Õ¹Ð€ô=‰©•Ð¹•¹ÑÉ¥•Ì¡É•ÍÕ±Ð¹™¥•±‘Ì¤¹™¥±Ñ•È (€€€€¡m™¥•±°Ù…±Õ•t¤€ôø(€€€€€™¥•±€„ôô€‰Ù•¡¥±”ˆ€˜˜(€€€€€ÑåÁ•½˜Ù…±Õ”€ôôô€‰¹Õµ‰•Èˆ€˜˜(€€€€€9Õµ‰•È¹¥Í¥¹¥Ñ”¡Ù…±Õ”¤°(€€¤¹±•¹Ñ ì(€½¹ÍÐ¡…Í•…±¹¡½È€ô	½½±•…¸ (€€€É•ÍÕ±Ð¹™¥•±‘Ì¹Í•±±¥¹AÉ¥”ñð(€€€É•ÍÕ±Ð¹™¥•±‘Ì¹ÅÕ½Ñ•‘A…åµ•¹Ð°(€€¤ì(€É•ÑÕÉ¸É•ÍÕ±Ð¹™¥•±‘9…µ•Ì¹±•¹Ñ €øô€Ì€˜˜¹Õµ•É¥¥•±‘½Õ¹Ð€øô€Ì€˜˜¡…Í•…±¹¡½Èì)ôì()½¹ÍÐÉ•½¹¥±•1½…±¹‘Y¥Í¥½¸€ô€ (€±½…°è•…±A‘™I•ÍÕ±Ð°(€Ù¥Í¥½¸è•…±A‘™I•ÍÕ±Ð°(¤è•…±A‘™I•ÍÕ±Ð€ôøì(€½¹ÍÐ™¥•±‘Ì€ôì€¸¸¹±½…°¹™¥•±‘Ìô…ÌI•½Éñ­•å½˜%µÁ½ÉÑ•‘•…±¥•±‘Ì°ÍÑÉ¥¹œð¹Õµ‰•ÈðÕ¹‘•™¥¹•øì(€½¹ÍÐ½¹™¥‘•¹”è•…±A‘™I•ÍÕ±Ñl‰™¥•±‘½¹™¥‘•¹”‰t€ôì€¸¸¹±½…°¹™¥•±‘½¹™¥‘•¹”ôì((€€¼¼-••ÀÍÑÉ½¹œ‘¥¥Ñ…°Ñ•áÐ•Ù¥‘•¹”¸UÍ”Ù¥Í¥½¸™½Èµ¥ÍÍ¥¹œ½È=Hµ½¹±ä(€€¼¼Ù…±Õ•Ì°Ý¡¥±”É•Ñ…¥¹¥¹œÑ¡”É•Ù¥•Ü™±…œ™½ÈÕÍ•È½¹™¥Éµ…Ñ¥½¸¸(€€¡=‰©•Ð¹­•åÌ¡1}%1}1	1L¤…Ì€¡­•å½˜%µÁ½ÉÑ•‘•…±¥•±‘Ì¥mt¤¹™½É…  ¡™¥•±¤€ôøì(€€€½¹ÍÐ±½…±Y…±Õ”€ô±½…°¹™¥•±‘Ím™¥•±‘tì(€€€½¹ÍÐÙ¥Í¥½¹Y…±Õ”€ôÙ¥Í¥½¸¹™¥•±‘Ím™¥•±‘tì(€€€¥˜€¡±½…±Y…±Õ”€ôôôÕ¹‘•™¥¹•€˜˜Ù¥Í¥½¹Y…±Õ”€„ôôÕ¹‘•™¥¹•¤ì(€€€€€™¥•±‘Ím™¥•±‘t€ôÙ¥Í¥½¹Y…±Õ”ì(€€€€€½¹™¥‘•¹•m™¥•±‘t€ô€‰É•Ù¥•Üˆì(€€€ô•±Í”¥˜€¡±½…°¹ÕÍ•‘=È€˜˜Ù¥Í¥½¹Y…±Õ”€„ôôÕ¹‘•™¥¹•€˜˜½¹™¥‘•¹•m™¥•±‘t€„ôô€‰¡¥ ˆ¤ì(€€€€€™¥•±‘Ím™¥•±‘t€ôÙ¥Í¥½¹Y…±Õ”ì(€€€€€½¹™¥‘•¹•m™¥•±‘t€ô€‰É•Ù¥•Üˆì(€€€ô(€ô¤ì((€½¹ÍÐÍ…¹¥Ñ¥é•€ôÍ…¹¥Ñ¥é•%µÁ½ÉÑ•‘¥•±‘Ì¡™¥•±‘Ì…Ì%µÁ½ÉÑ•‘•…±¥•±‘Ì¤¹™¥•±‘Ìì(€½¹ÍÐÉ•½¹¥±•€ôÉ•½¹¥±•EÕ½Ñ•‘A…åµ•¹Ð¡Í…¹¥Ñ¥é•¤ì(€½¹ÍÐÝ…É¹¥¹Ì€ôÉÉ…ä¹™É½´¡¹•ÜM•Ð¡l(€€€€¸¸¸¡±½…°¹Ý…É¹¥¹Ì€üümt¤°(€€€€¸¸¸¡Ù¥Í¥½¸¹Ý…É¹¥¹Ì€üümt¤°(€€€€¸¸¹É•½¹¥±•¹Ý…É¹¥¹Ì°(€t¤¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¹±½…°°(€€€™¥•±‘ÌèÉ•½¹¥±•¹™¥•±‘Ì°(€€€™¥•±‘½¹™¥‘•¹”è=‰©•Ð¹™É½µ¹ÑÉ¥•Ì (€€€€€=‰©•Ð¹­•åÌ¡É•½¹¥±•¹™¥•±‘Ì¤¹µ…À ¡™¥•±¤€ôøm™¥•±°½¹™¥‘•¹•m™¥•±…Ì­•å½˜%µÁ½ÉÑ•‘•…±¥•±‘Ít€üü€‰É•Ù¥•Ü‰t¤°(€€€€¤…Ì•…±A‘™I•ÍÕ±Ñl‰™¥•±‘½¹™¥‘•¹”‰t°(€€€™¥•±‘9…µ•Ìè=‰©•Ð¹­•åÌ¡É•½¹¥±•¹™¥•±‘Ì¤¹µ…À ¡™¥•±¤€ôø1}%1}1	1Mm™¥•±…Ì­•å½˜%µÁ½ÉÑ•‘•…±¥•±‘Ít¤°(€€€Ý…É¹¥¹Ì°(€ôì)ôì()•áÁ½ÉÐ½¹ÍÐ•áÑÉ…Ñ•…±É½µ¥±”€ô…Íå¹Œ€ (€™¥±”è¥±”°(€½¹AÉ½É•ÍÌüè€¡ÕÁ‘…Ñ”è•…±%µÁ½ÉÑAÉ½É•ÍÌ¤€ôøÙ½¥°(¤èAÉ½µ¥Í”ñ•…±A‘™I•ÍÕ±Ðø€ôøì(€½¹ÍÐ¹…µ”€ô™¥±”¹¹…µ”¹Ñ½1½Ý•É…Í” ¤ì(€½¹ÍÐ¥ÍA‘˜€ô™¥±”¹ÑåÁ”€ôôô€‰…ÁÁ±¥…Ñ¥½¸½Á‘˜ˆñð¹…µ”¹•¹‘Í]¥Ñ  ˆ¹Á‘˜ˆ¤ì(€½¹ÍÐ¥Í)Á•œ€ô™¥±”¹ÑåÁ”€ôôô€‰¥µ…”½©Á•œˆñð€½p¹©Á”ýœ¼¹Ñ•ÍÐ¡¹…µ”¤ì(€½¹ÍÐ¥ÍA¹œ€ô™¥±”¹ÑåÁ”€ôôô€‰¥µ…”½Á¹œˆñð¹…µ”¹•¹‘Í]¥Ñ  ˆ¹Á¹œˆ¤ì(€½¹ÍÐ¥Í]•‰À€ô™¥±”¹ÑåÁ”€ôôô€‰¥µ…”½Ý•‰Àˆñð¹…µ”¹•¹‘Í]¥Ñ  ˆ¹Ý•‰Àˆ¤ì((€¥˜€¡¥ÍA‘˜ñð¥Í)Á•œñð¥ÍA¹œñð¥Í]•‰À¤ì(€€€¥˜€ …¥ÍA‘˜€˜˜…Ý…¥Ð¥ÍA¡½Ñ½1¥­•%µ…”¡™¥±”¤¤ì(€€€€€½¹AÉ½É•ÍÌü¸¡ìÁÉ½É•ÍÌè€À¸ÀÈ°ÍÑ…ÑÕÌè€‰•¹¡…¹¥¹œÑ¡”¥µ…”™½ÈÙ¥Í¥½¸¥µÁ½ÉÐˆô¤ì(€€€€€ÑÉäì(€€€€€€€½¹ÍÐÕÁ±½…€ô…Ý…¥ÐÁÉ•Á…É•Y¥Í¥½¹%µ…”¡™¥±”¤ì(€€€€€€€É•ÑÕÉ¸…Ý…¥Ð•áÑÉ…Ñ•…±]¥Ñ¡M•ÉÙ•ÉY¥Í¥½¸¡™¥±”°½¹AÉ½É•ÍÌ°ÕÁ±½…¤ì(€€€€€ô…Ñ €¡Ù¥Í¥½¹ÉÉ½È¤ì(€€€€€€€€¼¼½È„Ñ¥¹äÁ¡½Ñ¼°±½…°=H¥Ì¹½Ð„ÑÉÕÍÑÝ½ÉÑ¡ä™…±±‰…¬¸AÉ•Í•ÉÙ”(€€€€€€€€¼¼Ñ¡”Í•ÉÙ•È‘¥…¹½ÍÑ¥ŒÍ¼Ñ¡”ÕÍ•È…¸É•ÑÉä½ÈÕÍ”µ…¹Õ…°•¹ÑÉä¸(€€€€€€€Ñ¡É½ÜÙ¥Í¥½¹ÉÉ½Èì(€€€€€ô(€€€ô(€€€±•Ð±½…±I•ÍÕ±Ðè•…±A‘™I•ÍÕ±Ðì(€€€ÑÉäì(€€€€€±½…±I•ÍÕ±Ð€ô¥ÍA‘˜(€€€€€€€€ü…Ý…¥Ð•áÑÉ…Ñ•…±É½µA‘˜¡™¥±”°½¹AÉ½É•ÍÌ¤(€€€€€€€€è…Ý…¥Ð•áÑÉ…Ñ•…±É½µ%µ…”¡™¥±”°½¹AÉ½É•ÍÌ¤ì(€€€ô…Ñ €¡±½…±ÉÉ½È¤ì(€€€€€ÑÉäì(€€€€€€€É•ÑÕÉ¸…Ý…¥Ð•áÑÉ…Ñ•…±]¥Ñ¡M•ÉÙ•ÉY¥Í¥½¸¡™¥±”°½¹AÉ½É•ÍÌ¤ì(€€€€€ô…Ñ ì(€€€€€€€Ñ¡É½Ü±½…±ÉÉ½Èì(€€€€€ô(€€€ô((€€€€¼¼5¥ÍÍ¥¹œ½ÁÑ¥½¹…°™¥•±‘Ì…É”¹½Éµ…°¸=¹”±½…°=H¡…ÌÁÉ½‘Õ•„(€€€€¼¼ÕÍ…‰±”ÅÕ½Ñ”°ÁÉ•Í•ÉÙ”¥Ð…¹‘¼¹½ÐÍÁ•¹•µ¥¹¤ÅÕ½Ñ„½È±•ÐÙ¥Í¥½¸(€€€€¼¼½Ù•ÉÝÉ¥Ñ”½ÉÉ•Ð±½…°Ù…±Õ•Ì¸(€€€¥˜€¡¥Í1½…±±åI•…‘…‰±•%µÁ½ÉÐ¡±½…±I•ÍÕ±Ð¤¤É•ÑÕÉ¸±½…±I•ÍÕ±Ðì((€€€ÑÉäì(€€€€€½¹ÍÐÙ¥Í¥½¹I•ÍÕ±Ð€ô…Ý…¥Ð•áÑÉ…Ñ•…±]¥Ñ¡M•ÉÙ•ÉY¥Í¥½¸¡™¥±”°½¹AÉ½É•ÍÌ¤ì(€€€€€É•ÑÕÉ¸É•½¹¥±•1½…±¹‘Y¥Í¥½¸¡±½…±I•ÍÕ±Ð°Ù¥Í¥½¹I•ÍÕ±Ð¤ì(€€€ô…Ñ ì(€€€€€€¼¼•µ¥¹¤¥Ì½ÁÑ¥½¹…°…¹µ…ä‰”Õ¹…Ù…¥±…‰±”½ÈÅÕ½Ñ„µ±¥µ¥Ñ•¸9•Ù•È(€€€€€€¼¼‘¥Í…É„ÕÍ…‰±”±½…°É•ÍÕ±ÐÝ¡•¸Ñ¡”ÁÉ½Ù¥‘•È‘½•Ì¹½Ð…¹ÍÝ•È¸(€€€€€É•ÑÕÉ¸±½…±I•ÍÕ±Ðì(€€€ô(€ô(€Ñ¡É½Ü¹•ÜÉÉ½È ‰U9MUAA=IQ}%1ˆ¤ì)ôì(