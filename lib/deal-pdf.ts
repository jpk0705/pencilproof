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
  outsideApr: "Desired APR",
  term: "Loan term",
  quotedPayment: "Quoted monthly payment",
};

export type DealPdfResult = {
  fields: ImportedDealFields;
  fieldNames: string[];
  pageCount: number;
  sourceType: "pdf" | "image";
  usedOcr?: boolean;
  pagesProcessed?: number;
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

const usableValues = (line: string, allowZero = false) =>
  valuesOnLine(line).filter(({ value }) => allowZero || value > 0);

const currencyValues = (line: string, allowZero = false) =>
  usableValues(line, allowZero).filter(({ raw }) => raw.includes("$") || raw.includes(","));

const priceValues = (line: string, allowZero = false) =>
  usableValues(line, allowZero).filter(({ raw }) =>
    raw.includes("$") || raw.includes(",") || /\.\d{2}\s*\)?$/.test(raw.trim()),
  );

const findAmount = (lines: string[], labels: RegExp[], options?: { allowZero?: boolean }) => {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!labels.some((label) => label.test(line))) continue;

    const onLineCurrency = currencyValues(line, options?.allowZero);
    if (onLineCurrency.length) return onLineCurrency[onLineCurrency.length - 1].value;

    for (let offset = 1; offset <= 2; offset += 1) {
      const nextLine = lines[index + offset];
      if (!nextLine) break;
      const nextValues = currencyValues(nextLine, options?.allowZero);
      if (nextValues.length) return nextValues[0].value;
      if (/[A-Za-z]{4,}/.test(nextLine) && !/^\s*[$\d(.-]/.test(nextLine)) break;
    }

    const usable = priceValues(line, options?.allowZero);
    if (usable.length) return usable[usable.length - 1].value;

    for (let offset = 1; offset <= 2; offset += 1) {
      const nextLine = lines[index + offset];
      if (!nextLine) break;
      const nextValues = priceValues(nextLine, options?.allowZero);
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
    const match = line.match(/\b((?:19|20)\d{2}\s+[A-Za-z][A-Za-z0-9-]{1,20}(?:\s+[A-Za-z0-9][A-Za-z0-9./-]{0,20}){1,7})\b/);
    if (match) return match[1].replace(/\s{2,}/g, " ").slice(0, 90);
  }

  const yearLineIndex = lines.findIndex((line) => /^\s*year\s+make\s+model/i.test(line));
  if (yearLineIndex >= 0 && lines[yearLineIndex + 1]) return lines[yearLineIndex + 1].slice(0, 90);
  return undefined;
};

const sumDistinctAmounts = (lines: string[], labels: RegExp[]) => {
  const matchedAmountLines = new Set<number>();
  let total = 0;
  lines.forEach((line, index) => {
    if (!labels.some((label) => label.test(line))) return;
    const candidates = [index, index + 1, index - 1];
    for (const amountLineIndex of candidates) {
      if (amountLineIndex < 0 || matchedAmountLines.has(amountLineIndex)) continue;
      const amountLine = lines[amountLineIndex] ?? "";
      if (amountLineIndex !== index && /[A-Za-z]{3,}/.test(amountLine)) continue;
      const values = currencyValues(amountLine);
      if (!values.length) continue;
      matchedAmountLines.add(amountLineIndex);
      total += values[values.length - 1].value;
      break;
    }
  });
  return total || undefined;
};

const findAmountWithin = (lines: string[], labels: RegExp[], lookahead: number) => {
  for (let index = 0; index < lines.length; index += 1) {
    if (!labels.some((label) => label.test(lines[index]))) continue;
    for (let offset = 0; offset <= lookahead; offset += 1) {
      const values = currencyValues(lines[index + offset] ?? "");
      if (values.length) return values[values.length - 1].value;
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
    /\b(?:electronic\s+)?filing fees?\b/i,
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
    /\bAPP\s+Major Guard\b/i,
    /\bMajor Guard\b/i,
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
    /\bappearance(?:\*+)?\b/i,
    /\bappearance protection\b/i,
    /\bpaint(?: and|\s*&)? fabric\b/i,
    /\btheft protection\b/i,
    /\betch(?:ing)?\b/i,
    /\btire(?: and|\s*&)? wheel\b/i,
    /\bprotection (?:plan|package|product)\b/i,
  ]);
  if (protection) fields.protection = protection;

  const accessories = sumDistinctAmounts(lines, [
    /\bconnected car(?: \d+ year)? plan\b/i,
    /\bcarnamic connect(?: \d+ year)? plan\b/i,
    /\bshipping\b/i,
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
    /\bdeposit\s*\/\s*cash down\b/i,
  ], { allowZero: true });
  if (cashDown !== undefined) fields.cashDown = cashDown;

  const rebate = findAmount(lines, [
    /\bmanufacturer rebate\b/i,
    /\bcash rebate\b/i,
    /\bdealer discount\b/i,
    /^discount(?:\s*\(-\))?\b/i,
    /\bincentive(?:s)?\b/i,
    /\brebate(?:s)?\b/i,
  ]);
  if (rebate) fields.rebate = rebate;

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
  const quotedPayment = findAmount(lines, paymentLabels) ?? findAmountWithin(lines, paymentLabels, 15);
  const joinedPaymentText = lines.join(" ");
  const individuallySpacedPayment = joinedPaymentText.match(/\$\s*((?:\d\s+){3,6}\d)\b/);
  const splitCentsPayment = joinedPaymentText.match(/\$\s*(\d{2,4})\s+(\d)\s+(\d)\b/);
  const spacedPaymentDigits = individuallySpacedPayment?.[1].replace(/\s/g, "");
  const resolvedQuotedPayment = spacedPaymentDigits && spacedPaymentDigits.length >= 3
    ? Number(`${spacedPaymentDigits.slice(0, -2)}.${spacedPaymentDigits.slice(-2)}`)
    : splitCentsPayment
    ? Number(`${splitCentsPayment[1]}.${splitCentsPayment[2]}${splitCentsPayment[3]}`)
    : quotedPayment;
  if (resolvedQuotedPayment) fields.quotedPayment = resolvedQuotedPayment;

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

const renderPdfPageForOcr = async (page: PdfRenderablePageLike) => {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const canvasContext = canvas.getContext("2d", { alpha: false });
  if (!canvasContext) throw new Error("PDF_RENDER_ERROR");

  await page.render({ canvas, canvasContext, viewport }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PDF_RENDER_ERROR")), "image/jpeg", 0.9);
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
  if (Object.keys(digitalFields).length) {
    const fieldNames = Object.keys(digitalFields).map((field) => DEAL_FIELD_LABELS[field as keyof ImportedDealFields]);
    return { fields: digitalFields, fieldNames, pageCount: pdfDocument.numPages, sourceType: "pdf" };
  }

  const pagesProcessed = Math.min(pdfDocument.numPages, 5);
  const images: Uint8Array[] = [];
  for (let pageNumber = 1; pageNumber <= pagesProcessed; pageNumber += 1) {
    onProgress?.({ progress: (pageNumber - 1) / pagesProcessed, status: `preparing scanned PDF page ${pageNumber} of ${pagesProcessed}` });
    const page = await pdfDocument.getPage(pageNumber);
    images.push(await renderPdfPageForOcr(page as unknown as PdfRenderablePageLike));
  }

  const ocrText = await recognizeImages(images, onProgress);
  if (ocrText.replace(/\s/g, "").length < 30) throw new Error("UNREADABLE_IMAGE");
  const fields = parseDealerText([...lines, ...ocrText.split(/\r?\n/)]);
  const fieldNames = Object.keys(fields).map((field) => DEAL_FIELD_LABELS[field as keyof ImportedDealFields]);
  return {
    fields,
    fieldNames,
    pageCount: pdfDocument.numPages,
    sourceType: "pdf",
    usedOcr: true,
    pagesProcessed,
  };
};

export const extractDealFromImage = async (
  file: File,
  onProgress?: (update: DealImportProgress) => void,
): Promise<DealPdfResult> => {
  onProgress?.({ progress: 0, status: "isolating the dealer worksheet" });
  const imageData = new Uint8Array(await file.arrayBuffer());
  const preparedImage = await preprocessDealPhoto(file);
  let text = await recognizeImages([preparedImage], onProgress, "form");
  if (text.replace(/\s/g, "").length < 30) throw new Error("UNREADABLE_IMAGE");

  let fields = parseDealerText(text.split(/\r?\n/));
  if (Object.keys(fields).length < 12) {
    onProgress?.({ progress: 0, status: "trying an alternate image layout" });
    const alternateText = await recognizeImages([preparedImage], onProgress, "sparse");
    const alternateFields = parseDealerText(alternateText.split(/\r?\n/));
    fields = { ...alternateFields, ...fields };
    text = `${text}\n${alternateText}`;
  }
  if (!Object.keys(fields).length) {
    onProgress?.({ progress: 0, status: "trying the full camera frame" });
    const fullFrameText = await recognizeImages([imageData], onProgress, "sparse");
    fields = parseDealerText(fullFrameText.split(/\r?\n/));
  }
  const fieldNames = Object.keys(fields).map((field) => DEAL_FIELD_LABELS[field as keyof ImportedDealFields]);
  return { fields, fieldNames, pageCount: 1, sourceType: "image", usedOcr: true, pagesProcessed: 1 };
};

export const extractDealFromFile = async (
  file: File,
  onProgress?: (update: DealImportProgress) => void,
): Promise<DealPdfResult> => {
  const name = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
  const isJpeg = file.type === "image/jpeg" || /\.jpe?g$/.test(name);
  const isPng = file.type === "image/png" || name.endsWith(".png");

  if (isPdf) return extractDealFromPdf(file, onProgress);
  if (isJpeg || isPng) return extractDealFromImage(file, onProgress);
  throw new Error("UNSUPPORTED_FILE");
};
