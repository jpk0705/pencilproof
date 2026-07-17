export type ImportedDealFields = Partial<{
  vehicle: string;
  sellingPrice: number;
  tax: number;
  govFees: number;
  docFee: number;
  serviceContract: number;
  gap: number;
  prepaidMaintenance: number;
  protection: number;
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
  protection: "Appearance / protection products",
  accessories: "Accessories / other add-ons",
  tradeValue: "Trade allowance",
  tradePayoff: "Trade payoff",
  cashDown: "Cash down",
  rebate: "Rebate / discount",
  apr: "Dealer APR",
  outsideApr: "Outside APR",
  term: "Loan term",
  quotedPayment: "Quoted monthly payment",
};

export type DealPdfResult = {
  fields: ImportedDealFields;
  fieldNames: string[];
  pageCount: number;
  sourceType: "pdf" | "image";
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

const moneyPattern = /(?:\(\s*)?-?\$?\s*\d[\d,]*(?:\.\d{1,2})?(?:\s*\))?/g;

const parseMoney = (raw: string) => {
  const negative = raw.includes("(") || raw.trim().startsWith("-");
  const numeric = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? (negative ? -numeric : numeric) : undefined;
};

const valuesOnLine = (line: string) =>
  [...line.matchAll(moneyPattern)]
    .map((match) => ({ value: parseMoney(match[0]), raw: match[0] }))
    .filter((entry): entry is { value: number; raw: string } => entry.value !== undefined);

const findAmount = (lines: string[], labels: RegExp[], options?: { allowZero?: boolean }) => {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!labels.some((label) => label.test(line))) continue;

    const values = valuesOnLine(line);
    const usable = values.filter(({ value }) => options?.allowZero || value > 0);
    if (usable.length) return usable[usable.length - 1].value;

    for (let offset = 1; offset <= 2; offset += 1) {
      const nextLine = lines[index + offset];
      if (!nextLine) break;
      const nextValues = valuesOnLine(nextLine).filter(({ value }) => options?.allowZero || value > 0);
      if (nextValues.length) return nextValues[0].value;
      if (/[A-Za-z]{4,}/.test(nextLine) && !/^\s*[$\d(.-]/.test(nextLine)) break;
    }
  }
  return undefined;
};

const findPercent = (lines: string[], labels: RegExp[]) => {
  for (let index = 0; index < lines.length; index += 1) {
    if (!labels.some((label) => label.test(lines[index]))) continue;
    const nearby = lines.slice(index, index + 2).join(" ");
    const percent = nearby.match(/(?:\b|\s)(\d{1,2}(?:\.\d{1,3})?)\s*%/);
    if (percent) return Number(percent[1]);
    const afterLabel = nearby.match(/(?:APR|annual percentage rate|interest rate)[^\d]{0,20}(\d{1,2}(?:\.\d{1,3})?)/i);
    if (afterLabel) return Number(afterLabel[1]);
  }
  return undefined;
};

const findTerm = (lines: string[]) => {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/(?:loan\s+)?term|number of payments|months/i.test(line)) continue;
    const nearby = lines.slice(index, index + 2).join(" ");
    const months = nearby.match(/\b(24|30|36|39|42|48|54|60|63|66|72|75|78|84|96)\s*(?:months?|mos?\.?|payments?)?\b/i);
    if (months) return Number(months[1]);
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
    const match = line.match(/\b((?:19|20)\d{2}\s+[A-Za-z][A-Za-z0-9-]{1,20}(?:\s+[A-Za-z0-9][A-Za-z0-9./-]{0,20}){1,5})\b/);
    if (match) return match[1].replace(/\s{2,}/g, " ").slice(0, 90);
  }

  const yearLineIndex = lines.findIndex((line) => /^\s*year\s+make\s+model/i.test(line));
  if (yearLineIndex >= 0 && lines[yearLineIndex + 1]) return lines[yearLineIndex + 1].slice(0, 90);
  return undefined;
};

const sumDistinctAmounts = (lines: string[], labels: RegExp[]) => {
  const matched = new Set<number>();
  let total = 0;
  lines.forEach((line, index) => {
    if (!labels.some((label) => label.test(line))) return;
    const values = valuesOnLine(line).filter(({ value }) => value > 0);
    if (!values.length || matched.has(index)) return;
    matched.add(index);
    total += values[values.length - 1].value;
  });
  return total || undefined;
};

export const parseDealerText = (rawLines: string[]): ImportedDealFields => {
  const lines = rawLines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const fields: ImportedDealFields = {};

  const vehicle = vehicleFromLines(lines);
  if (vehicle) fields.vehicle = vehicle;

  const sellingPrice = findAmount(lines, [
    /\b(?:selling|sale|vehicle|cash)\s+price\b/i,
    /\bagreed(?: upon)? (?:price|value)\b/i,
    /\bprice of vehicle\b/i,
  ]);
  if (sellingPrice) fields.sellingPrice = sellingPrice;

  const tax = findAmount(lines, [
    /\b(?:sales|state|local|vehicle)\s+tax\b/i,
    /\btax amount\b/i,
  ]);
  if (tax) fields.tax = tax;

  const combinedGovernmentFees = findAmount(lines, [
    /\bgovernment fees?\b/i,
    /\bDMV\s*(?:\/|&|and)?\s*(?:title|registration|fees?)\b/i,
    /\btitle(?:,|\s+and)?\s+registration\b/i,
    /\blicense(?:,|\s+and)?\s+registration\b/i,
  ]);
  const itemizedGovernmentFees = sumDistinctAmounts(lines, [
    /\bregistration fee\b/i,
    /\btitle fee\b/i,
    /\blicense fee\b/i,
    /\bfiling fee\b/i,
  ]);
  if (combinedGovernmentFees || itemizedGovernmentFees) fields.govFees = combinedGovernmentFees ?? itemizedGovernmentFees;

  const docFee = findAmount(lines, [
    /\bdoc(?:umentary|umentation)?\s+fee\b/i,
    /\bdealer service fee\b/i,
    /\bprocessing fee\b/i,
  ]);
  if (docFee) fields.docFee = docFee;

  const serviceContract = findAmount(lines, [
    /\bVSC\b/i,
    /\bvehicle service contract\b/i,
    /\bservice contract\b/i,
    /\bextended warranty\b/i,
  ]);
  if (serviceContract) fields.serviceContract = serviceContract;

  const gap = findAmount(lines, [
    /\bGAP(?: protection| waiver| coverage| insurance)?\b/i,
    /\bguaranteed asset protection\b/i,
  ]);
  if (gap) fields.gap = gap;

  const prepaidMaintenance = findAmount(lines, [
    /\bPPM\b/i,
    /\bprepaid maintenance\b/i,
    /\bmaintenance (?:plan|package|agreement)\b/i,
  ]);
  if (prepaidMaintenance) fields.prepaidMaintenance = prepaidMaintenance;

  const protection = findAmount(lines, [
    /\bappearance protection\b/i,
    /\bpaint(?: and|\s*&)? fabric\b/i,
    /\btheft protection\b/i,
    /\betch(?:ing)?\b/i,
    /\btire(?: and|\s*&)? wheel\b/i,
    /\bprotection (?:plan|package|product)\b/i,
  ]);
  if (protection) fields.protection = protection;

  const accessories = findAmount(lines, [
    /\bdealer installed (?:options|accessories)\b/i,
    /\baccessories\b/i,
    /\bother add[- ]?ons\b/i,
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
  ]);
  if (cashDown) fields.cashDown = cashDown;

  const rebate = findAmount(lines, [
    /\bmanufacturer rebate\b/i,
    /\bcash rebate\b/i,
    /\bdealer discount\b/i,
    /\bincentive(?:s)?\b/i,
    /\brebate(?:s)?\b/i,
  ]);
  if (rebate) fields.rebate = rebate;

  const apr = findPercent(lines, [
    /\bAPR\b/i,
    /\bannual percentage rate\b/i,
    /\binterest rate\b/i,
  ]);
  if (apr !== undefined) fields.apr = apr;

  const term = findTerm(lines);
  if (term) fields.term = term;

  const quotedPayment = findAmount(lines, [
    /\bmonthly payment\b/i,
    /\bpayment amount\b/i,
    /\bamount of (?:each )?payment\b/i,
    /\bpayment per month\b/i,
  ]);
  if (quotedPayment) fields.quotedPayment = quotedPayment;

  return fields;
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

export const extractDealFromPdf = async (file: File): Promise<DealPdfResult> => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data }).promise;
  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    lines.push(...await pageLines(page));
  }

  if (lines.join("").replace(/\s/g, "").length < 30) {
    throw new Error("SCANNED_PDF");
  }

  const fields = parseDealerText(lines);
  const fieldNames = Object.keys(fields).map((field) => DEAL_FIELD_LABELS[field as keyof ImportedDealFields]);
  return { fields, fieldNames, pageCount: document.numPages, sourceType: "pdf" };
};

export const extractDealFromImage = async (
  file: File,
  onProgress?: (update: DealImportProgress) => void,
): Promise<DealPdfResult> => {
  const { createWorker } = await import("tesseract.js");
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

  try {
    const result = await worker.recognize(file, { rotateAuto: true });
    const text = result.data.text.trim();
    if (text.replace(/\s/g, "").length < 30) throw new Error("UNREADABLE_IMAGE");

    const fields = parseDealerText(text.split(/\r?\n/));
    const fieldNames = Object.keys(fields).map((field) => DEAL_FIELD_LABELS[field as keyof ImportedDealFields]);
    return { fields, fieldNames, pageCount: 1, sourceType: "image" };
  } finally {
    await worker.terminate();
  }
};

export const extractDealFromFile = async (
  file: File,
  onProgress?: (update: DealImportProgress) => void,
): Promise<DealPdfResult> => {
  const name = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
  const isJpeg = file.type === "image/jpeg" || /\.jpe?g$/.test(name);

  if (isPdf) return extractDealFromPdf(file);
  if (isJpeg) return extractDealFromImage(file, onProgress);
  throw new Error("UNSUPPORTED_FILE");
};
