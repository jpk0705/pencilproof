"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  DEAL_IMPORT_ACCEPT,
  DEAL_CAMERA_ACCEPT,
  DEAL_FIELD_LABELS,
  extractDealFromFile,
  isDealImportFile,
  isDealImportPdf,
  type DealOfferMatrix,
  type DealOfferOption,
  type ImportedDealFields,
} from "@/lib/deal-pdf";
import { paymentFor } from "@/lib/deal-calculations";
import {
  isPreviewImportUsable,
} from "@/lib/deal-review";
import {
  CHECKOUT_URL,
  createQuoteHandoffEnvelope,
  QUOTE_HANDOFF_KEY,
} from "@/lib/checkout";
import { track } from "@/lib/analytics";
import VehiclePhoto from "@/app/components/VehiclePhoto";
import PhoneCameraBridge from "@/app/components/PhoneCameraBridge";
import PreCheckoutAccountGate from "@/app/components/PreCheckoutAccountGate";
import PreCheckoutFeedback from "@/app/components/PreCheckoutFeedback";
import AccountNav from "@/app/components/AccountNav";
import { createLoadedClerk } from "@/lib/clerk-client";

type Deal = {
  vehicle: string;
  vin?: string;
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
};

type ProductInsight = {
  name: string;
  amount: number;
  monthlyImpact: number;
  financedTotal: number;
  financingCost: number;
  explanation: string;
  question: string;
};

type DealImportState = {
  status: "idle" | "loading" | "success" | "warning" | "error";
  message: string;
  fields: string[];
  progress?: number;
};

type PendingImport = {
  fields: Partial<Deal>;
  confidence: Partial<Record<keyof ImportedDealFields, "high" | "review">>;
  fileName: string;
  sourceUrl?: string;
  sourceType?: "pdf" | "image";
};

type CheckoutPayload = {
  fields: Partial<Deal>;
  confidence: PendingImport["confidence"];
  fileName: string;
  offerMatrix: DealOfferMatrix | null;
  selectedOfferId: string | null;
  referralCode?: string;
  preCheckoutFeedbackCompleted?: boolean;
};

const PENDING_CHECKOUT_KEY = "pencilproof:pending-checkout";
const PRECHECKOUT_FEEDBACK_KEY = "pencilproof:pre-checkout-feedback-completed";
const PAID_AUDIT_FEEDBACK_KEY = "pencilproof:paid-audit-feedback-completed";
const QUOTE_BASELINE_KEY = "pencilproof:quote-baseline";
const REFERRAL_CODE_KEY = "pencilproof:referral-code";

const auditFeedbackRatings = [
  { value: 1, label: "Very poor" },
  { value: 2, label: "Poor" },
  { value: 3, label: "Okay" },
  { value: 4, label: "Good" },
  { value: 5, label: "Excellent" },
] as const;

const auditFeedbackWorth = ["0", "9.99", "19.99", "29.99", "39.99"] as const;

type CreditTier = "excellent" | "veryGood" | "good" | "fair";
type CreditVehicleType = "new" | "used";

const creditTierEstimates: Record<CreditTier, { label: string; newRate: number; usedRate: number; basis: string }> = {
  excellent: { label: "Excellent", newRate: 4.55, usedRate: 6.30, basis: "Super prime" },
  veryGood: { label: "Very good", newRate: 5.39, usedRate: 7.54, basis: "Planning midpoint" },
  good: { label: "Good", newRate: 6.23, usedRate: 8.77, basis: "Prime" },
  fair: { label: "Fair", newRate: 9.67, usedRate: 14.03, basis: "Near prime" },
};

const verificationFields: (keyof ImportedDealFields)[] = [
  "vehicle",
  "sellingPrice",
  "rebate",
  "tax",
  "govFees",
  "docFee",
  "serviceContract",
  "gap",
  "prepaidMaintenance",
  "tireWheel",
  "accessories",
  "tradeValue",
  "tradePayoff",
  "cashDown",
  "apr",
  "term",
  "quotedPayment",
];

const Arrow = () => <span aria-hidden="true">→</span>;
const PUBLIC_ANALYZE_URL = "https://pencilproof.com/analyze";
const ACCOUNT_API_URL = "https://audit.pencilproof.com";
const PAID_AUDIT_URL = "https://audit.pencilproof.com/analyze/secure/";

const sample: Deal = {
  vehicle: "2026 Toyota RAV4 XLE Premium",
  sellingPrice: 36100,
  tax: 3474.63,
  govFees: 725,
  docFee: 85,
  serviceContract: 2495,
  gap: 995,
  prepaidMaintenance: 0,
  tireWheel: 0,
  accessories: 699,
  tradeValue: 0,
  tradePayoff: 0,
  cashDown: 5000,
  rebate: 0,
  apr: 8.49,
  outsideApr: 0,
  term: 72,
  quotedPayment: 739.95,
};

const blank: Deal = {
  vehicle: "",
  sellingPrice: 0,
  tax: 0,
  govFees: 0,
  docFee: 0,
  serviceContract: 0,
  gap: 0,
  prepaidMaintenance: 0,
  tireWheel: 0,
  accessories: 0,
  tradeValue: 0,
  tradePayoff: 0,
  cashDown: 0,
  rebate: 0,
  apr: 0,
  outsideApr: 0,
  term: 60,
  quotedPayment: 0,
};

const numericDealFields: (keyof Deal)[] = [
  "sellingPrice",
  "tax",
  "govFees",
  "docFee",
  "serviceContract",
  "gap",
  "prepaidMaintenance",
  "tireWheel",
  "accessories",
  "tradeValue",
  "tradePayoff",
  "cashDown",
  "rebate",
  "apr",
  "outsideApr",
  "term",
  "quotedPayment",
];

const dollars = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);

const dollarsAndCents = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);

const PAYMENT_MATCH_TOLERANCE = 5;

type RevisionChange = {
  field: keyof Deal;
  before: string;
  after: string;
  beforeValue: number;
  afterValue: number;
};

const dealMathFor = (value: Deal) => {
  const addons = value.serviceContract + value.gap + value.prepaidMaintenance + value.tireWheel + value.accessories;
  const amountFinanced = Math.max(
    0,
    value.sellingPrice
      + value.tax
      + value.govFees
      + value.docFee
      + addons
      + value.tradePayoff
      - value.tradeValue
      - value.cashDown
      - value.rebate,
  );
  return { amountFinanced, calculatedPayment: paymentFor(amountFinanced, value.apr, value.term) };
};

const counterProposalLabels: Partial<Record<keyof Deal, string>> = {
  sellingPrice: "Selling price",
  rebate: "Rebate",
  tax: "Sales tax",
  govFees: "Government / registration fees",
  docFee: "Documentation fee",
  serviceContract: "VSC / service contract",
  gap: "GAP protection",
  prepaidMaintenance: "Prepaid maintenance (PPM)",
  tireWheel: "Tire & wheel protection",
  accessories: "Accessories / other add-ons",
  tradeValue: "Trade allowance",
  tradePayoff: "Trade loan payoff",
  cashDown: "Cash down",
  apr: "Dealer APR",
  term: "Loan term",
  quotedPayment: "Dealer quoted payment",
};

const counterProposalLabel = (field: keyof Deal) => counterProposalLabels[field] ?? String(field);

const counterProposalDelta = (field: keyof Deal, value: number) => {
  const amount = Math.abs(value);
  if (field === "apr") return `${amount.toFixed(2)} percentage points`;
  if (field === "term") return `${amount} months`;
  return dollarsAndCents(amount);
};

function MoneyField({
  label,
  field,
  value,
  onChange,
  hint,
}: {
  label: string;
  field: keyof Deal;
  value: number;
  onChange: (field: keyof Deal, value: string) => void;
  hint?: string;
}) {
  return (
    <label className="input-field">
      <span>{label}</span>
      <div className="input-money">
        <i>$</i>
        <input
          aria-label={label}
          inputMode="decimal"
          type="number"
          min="0"
          step="0.01"
          value={value || ""}
          onChange={(event) => onChange(field, event.target.value)}
        />
      </div>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export default function AnalyzePage() {
  // The public Pages site and the paid audit Worker share this static build.
  // Default to the public state so an unauthenticated visitor never gets a
  // client-side glimpse of the paid calculator while the host is being read.
  const [isPaidAuditHost, setIsPaidAuditHost] = useState(false);
  const [auditHostResolved, setAuditHostResolved] = useState(false);
  const [deal, setDeal] = useState<Deal>(blank);
  const [copied, setCopied] = useState(false);
  const [dealImport, setDealImport] = useState<DealImportState>({ status: "idle", message: "", fields: [] });
  const [offerMatrix, setOfferMatrix] = useState<DealOfferMatrix | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [selectedOfferType, setSelectedOfferType] = useState<DealOfferOption["type"] | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importSource, setImportSource] = useState<{ url: string; type: "pdf" | "image" } | null>(null);
  const [auditFeedback, setAuditFeedback] = useState({
    ui: 0,
    service: 0,
    scanQuality: 0,
    worth: "",
  });
  const [auditFeedbackSent, setAuditFeedbackSent] = useState(false);
  // The survey belongs to the current scan, not to the browser or account globally.
  // This keeps it visible for a new quote while the handoff flag preserves the
  // completed-before-payment decision across the checkout redirect.
  const [preCheckoutFeedbackCompleted, setPreCheckoutFeedbackCompleted] = useState(false);
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const savedAuditKey = useRef("");
  const [accountPromptDismissed, setAccountPromptDismissed] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState<CheckoutPayload | null>(null);
  const [savedRevision, setSavedRevision] = useState<Deal | null>(null);
  const [hasReferralAttribution, setHasReferralAttribution] = useState(false);
  const [accountRole, setAccountRole] = useState<"consumer" | "salesperson">("consumer");
  const [accountRoleKnown, setAccountRoleKnown] = useState(false);
  const [auditSaveRequest, setAuditSaveRequest] = useState(0);
  const [auditSaveMessage, setAuditSaveMessage] = useState("");
  const [creditTier, setCreditTier] = useState<CreditTier>("good");
  const [creditVehicleType, setCreditVehicleType] = useState<CreditVehicleType>("new");
  const printAfterSaveRef = useRef(false);
  const checkoutGateRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIsPaidAuditHost(
      window.location.hostname.toLowerCase() === "audit.pencilproof.com"
      && (window.location.pathname === "/analyze/secure" || window.location.pathname.startsWith("/analyze/secure/")),
    );
    setAuditHostResolved(true);
  }, []);

  useEffect(() => {
    if (!isPaidAuditHost) {
      setAccountRoleKnown(true);
      return;
    }
    setAccountRoleKnown(false);
    let current = true;
    void fetch("/api/account/me", { cache: "no-store", credentials: "include" })
      .then((response) => response.ok ? response.json() as Promise<{ role?: string }> : null)
      .then((data) => {
        if (!current) return;
        setAccountRole(data?.role === "salesperson" ? "salesperson" : "consumer");
        setAccountRoleKnown(true);
      })
      .catch(() => {
        if (current) setAccountRoleKnown(true);
      });
    return () => { current = false; };
  }, [isPaidAuditHost]);

  useEffect(() => {
    // A public scan link is still the correct entry for guests, but an account
    // with an active pass or salesperson subscription must not be sent through
    // checkout again. The account API is on the audit host because that is where
    // the signed account cookie and entitlement are maintained.
    if (isPaidAuditHost) return;
    let current = true;
    const redirectIfPaid = async () => {
      const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
      if (!publishableKey) return;
      const clerk = await createLoadedClerk(publishableKey).catch(() => null);
      if (!current || !clerk?.user || !clerk.session) return;
      const token = await clerk.session.getToken().catch(() => null);
      if (!token) return;
      const response = await fetch(`${ACCOUNT_API_URL}/api/account/me`, {
        cache: "no-store",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null);
      if (!current || !response?.ok) return;
      const data = await response.json().catch(() => ({})) as { expiresAt?: unknown };
      if (typeof data.expiresAt === "number" && data.expiresAt > Math.floor(Date.now() / 1000)) {
        window.location.replace(PAID_AUDIT_URL);
      }
    };
    void redirectIfPaid();
    const retryTimer = window.setTimeout(() => void redirectIfPaid(), 900);
    return () => {
      current = false;
      window.clearTimeout(retryTimer);
    };
  }, [isPaidAuditHost]);

  useEffect(() => {
    if (!isPaidAuditHost) return;
    const auditId = new URLSearchParams(window.location.search).get("audit")?.trim() ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(auditId)) return;
    let current = true;
    void fetch("/api/audits", { cache: "no-store", credentials: "include" })
      .then((response) => response.ok ? response.json() as Promise<{ audits?: { id: string; data?: Record<string, unknown> }[] }> : null)
      .then((payload) => {
        if (!current) return;
        const saved = payload?.audits?.find((audit) => audit.id === auditId);
        if (!saved?.data) return;
        const data = saved.data;
        const loaded: Deal = {
          ...blank,
          vehicle: typeof data.vehicle === "string" ? data.vehicle : "",
          ...(typeof data.vin === "string" ? { vin: data.vin } : {}),
        };
        for (const field of numericDealFields) {
          if (typeof data[field] === "number" && Number.isFinite(data[field])) loaded[field] = data[field] as never;
        }
        savedAuditKey.current = JSON.stringify(loaded);
        setSampleLoaded(false);
        setDeal(loaded);
        setDealImport({ status: "success", message: "Loaded this saved audit. You can update the figures and run the review again.", fields: [] });
      })
      .catch(() => undefined);
    return () => { current = false; };
  }, [isPaidAuditHost]);

  useEffect(() => () => {
    if (importSource?.url) URL.revokeObjectURL(importSource.url);
  }, [importSource]);

  useEffect(() => {
    const referralCode = new URLSearchParams(window.location.search).get("ref")?.trim() ?? "";
    if (/^[A-Za-z0-9]{8,32}$/.test(referralCode)) {
      window.localStorage.setItem(REFERRAL_CODE_KEY, referralCode.toUpperCase());
      setHasReferralAttribution(true);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(QUOTE_BASELINE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Deal;
      if (parsed && typeof parsed === "object" && typeof parsed.vehicle === "string") setSavedRevision(parsed);
    } catch {
      window.localStorage.removeItem(QUOTE_BASELINE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!pendingCheckout) return;
    sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(pendingCheckout));
    const scrollTimer = window.setTimeout(() => {
      checkoutGateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(scrollTimer);
  }, [pendingCheckout]);

  useEffect(() => {
    if (localStorage.getItem(PRECHECKOUT_FEEDBACK_KEY) === "true") setPreCheckoutFeedbackCompleted(true);
    if (sessionStorage.getItem(PAID_AUDIT_FEEDBACK_KEY) === "true") setAuditFeedbackSent(true);
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!saved) return;
    try {
      const payload = JSON.parse(saved) as CheckoutPayload;
      if (!payload.fields || !Object.keys(payload.fields).length) return;
      setPendingCheckout(payload);
      setPreCheckoutFeedbackCompleted(payload.preCheckoutFeedbackCompleted === true);
      setPendingImport({
        fields: payload.fields,
        confidence: payload.confidence ?? {},
        fileName: payload.fileName ?? "your quote scan",
      });
      setOfferMatrix(payload.offerMatrix ?? null);
      const selectedOffer = payload.offerMatrix && payload.selectedOfferId
        ? payload.offerMatrix.options.find((option) => option.id === payload.selectedOfferId)
        : undefined;
      setSelectedOfferId(selectedOffer?.id ?? "");
      setSelectedOfferType(selectedOffer?.type ?? null);
      setDealImport({
        status: payload.offerMatrix ? "warning" : "success",
        message: "Your quote scan is ready. Confirm the detected values before checkout.",
        fields: Object.keys(payload.fields).map((field) => DEAL_FIELD_LABELS[field as keyof ImportedDealFields]),
      });
    } catch {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
    }
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(QUOTE_HANDOFF_KEY);
    if (!saved) return;
    try {
      const handoff = JSON.parse(saved) as {
        fields?: Partial<Deal>;
        confidence?: PendingImport["confidence"];
        fileName?: string;
        offerMatrix?: DealOfferMatrix | null;
        selectedOfferId?: string | null;
        preCheckoutFeedbackCompleted?: boolean;
      };
      if (!handoff.fields || !Object.keys(handoff.fields).length) return;
      setPreCheckoutFeedbackCompleted(handoff.preCheckoutFeedbackCompleted === true);
      const importedFields = { ...handoff.fields } as Partial<Deal> & { protection?: number };
      if (importedFields.protection) {
        importedFields.accessories = (importedFields.accessories ?? 0) + importedFields.protection;
        delete importedFields.protection;
      }
      if (handoff.offerMatrix) {
        delete importedFields.cashDown;
        delete importedFields.term;
        delete importedFields.quotedPayment;
        delete importedFields.apr;
        delete importedFields.rebate;

        const selectedOffer = handoff.selectedOfferId
          ? handoff.offerMatrix.options.find((option) => option.id === handoff.selectedOfferId)
          : undefined;
        if (selectedOffer?.type === "finance") {
          importedFields.cashDown = selectedOffer.cashDown;
          importedFields.term = selectedOffer.term;
          importedFields.quotedPayment = selectedOffer.payment;
          if (selectedOffer.apr !== undefined) importedFields.apr = selectedOffer.apr;
        }
      }
      setPendingImport({
        fields: importedFields,
        confidence: handoff.confidence ?? {},
        fileName: handoff.fileName ?? "your free quote scan",
      });
      setOfferMatrix(handoff.offerMatrix ?? null);
      const selectedHandoffOffer = handoff.offerMatrix && handoff.selectedOfferId
        ? handoff.offerMatrix.options.find((option) => option.id === handoff.selectedOfferId)
        : undefined;
      setSelectedOfferId(selectedHandoffOffer?.id ?? "");
      setSelectedOfferType(selectedHandoffOffer?.type ?? null);
      setDealImport({
        status: handoff.offerMatrix ? "warning" : "success",
        message: handoff.offerMatrix
          ? `Your free scan found ${handoff.offerMatrix.options.length} payment choices. Select the option you are considering, then confirm the imported values.`
          : "Your free quote scan is ready. Confirm the detected values before the Full Quote Audit uses them.",
        fields: Object.keys(importedFields).map(
          (field) => DEAL_FIELD_LABELS[field as keyof ImportedDealFields],
        ),
      });
    } catch {
      sessionStorage.removeItem(QUOTE_HANDOFF_KEY);
      return;
    }
    sessionStorage.removeItem(QUOTE_HANDOFF_KEY);
  }, []);

  const setNumber = (field: keyof Deal, value: string) => {
    setSampleLoaded(false);
    setDeal((current) => ({ ...current, [field]: value === "" ? 0 : Number(value) }));
  };

  const saveCurrentQuote = () => {
    if (!deal.vehicle.trim() && !deal.sellingPrice) return;
    window.localStorage.setItem(QUOTE_BASELINE_KEY, JSON.stringify(deal));
    setSavedRevision(deal);
  };

  const clearSavedQuote = () => {
    window.localStorage.removeItem(QUOTE_BASELINE_KEY);
    setSavedRevision(null);
  };

  const scrollToQuoteUpload = () => {
    document.getElementById("pdf-import-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const revisionComparison = useMemo(() => {
    const revisedMath = dealMathFor(deal);
    if (!savedRevision || !deal.vehicle.trim()) return { sameVehicle: false, changes: [] as RevisionChange[], originalMath: null, revisedMath };
    const sameVehicle = savedRevision.vehicle.trim().toLowerCase() === deal.vehicle.trim().toLowerCase();
    const originalMath = dealMathFor(savedRevision);
    if (!sameVehicle) return { sameVehicle, changes: [] as RevisionChange[], originalMath, revisedMath };
    const comparableFields: (keyof Deal)[] = [
      "sellingPrice", "rebate", "tax", "govFees", "docFee", "serviceContract", "gap",
      "prepaidMaintenance", "tireWheel", "accessories", "tradeValue", "tradePayoff",
      "cashDown", "apr", "term", "quotedPayment",
    ];
    const format = (field: keyof Deal, value: Deal[keyof Deal]) => {
      if (field === "apr") return `${Number(value).toFixed(2)}%`;
      if (field === "term") return `${Number(value)} months`;
      return dollarsAndCents(Number(value));
    };
    const changes = comparableFields
      .filter((field) => savedRevision[field] !== deal[field])
      .map((field) => ({
        field,
        before: format(field, savedRevision[field]),
        after: format(field, deal[field]),
        beforeValue: Number(savedRevision[field]),
        afterValue: Number(deal[field]),
      }));
    return { sameVehicle, changes, originalMath, revisedMath };
  }, [deal, savedRevision]);

  const pendingVerificationSummary = useMemo(() => {
    if (!pendingImport) return null;
    const detected = verificationFields.filter((field) => pendingImport.fields[field] !== undefined).length;
    const missing = verificationFields.length - detected;
    const needsReview = verificationFields.filter((field) => (
      pendingImport.fields[field] !== undefined && (pendingImport.confidence[field] ?? "review") === "review"
    )).length;
    return { detected, missing, needsReview };
  }, [pendingImport]);

  const manualCheckoutFields = useMemo(() => {
    const fields = Object.fromEntries(
      Object.entries(deal).filter(([field, value]) =>
        field !== "outsideApr" && (
          field === "vehicle" || field === "vin"
            ? typeof value === "string" && value.trim().length > 0
            : typeof value === "number" && Number.isFinite(value) && value > 0
        ),
      ),
    ) as ImportedDealFields;
    const fieldNames = Object.keys(fields).map(
      (field) => DEAL_FIELD_LABELS[field as keyof ImportedDealFields],
    );
    return {
      fields,
      fieldNames,
      ready: isPreviewImportUsable({ fields, fieldNames, offerMatrix: undefined }),
    };
  }, [deal]);

  const startCheckout = (payload: CheckoutPayload) => {
    track({ event: "checkout_started" });
    sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
    const referralCode = window.localStorage.getItem(REFERRAL_CODE_KEY) ?? "";
    window.name = createQuoteHandoffEnvelope({
      ...payload,
      ...( /^[A-Za-z0-9]{8,32}$/.test(referralCode) ? { referralCode: referralCode.toUpperCase() } : {}),
    });
    window.location.assign(CHECKOUT_URL);
  };

  const openCheckout = (payload: unknown) => {
    setPendingCheckout(payload as CheckoutPayload);
  };

  const continueCheckout = () => {
    if (pendingCheckout === null) return;
    const payload = pendingCheckout;
    setPendingCheckout(null);
    startCheckout(payload);
  };

  const completePreCheckoutFeedback = () => {
    setPreCheckoutFeedbackCompleted(true);
    localStorage.setItem(PRECHECKOUT_FEEDBACK_KEY, "true");
    const saved = sessionStorage.getItem(PENDING_CHECKOUT_KEY);
    if (saved) {
      try {
        const payload = JSON.parse(saved) as CheckoutPayload;
        const completedPayload = { ...payload, preCheckoutFeedbackCompleted: true };
        sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(completedPayload));
      } catch {
        sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
      }
    }
    setPendingCheckout((current) => current ? { ...current, preCheckoutFeedbackCompleted: true } : current);
  };

  const importDealFile = async (file: File) => {
    setSampleLoaded(false);
    const isPdf = isDealImportPdf(file);
    if (!isDealImportFile(file)) {
      setDealImport({ status: "error", message: "Choose a PDF or image file from the dealership.", fields: [] });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setDealImport({ status: "error", message: "That file is larger than 15 MB. Use a smaller copy or enter the figures manually.", fields: [] });
      return;
    }

    const sourceType = isPdf ? "pdf" : "image";
    const sourceUrl = URL.createObjectURL(file);
    setImportSource((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return { url: sourceUrl, type: sourceType };
    });

    setDealImport({
      status: "loading",
      message: isPdf
        ? `Reading ${file.name} in your browser…`
        : `Preparing image recognition for ${file.name}… The first image can take a moment.`,
      fields: [],
      progress: 0.02,
    });
    try {
      const result = await extractDealFromFile(file, ({ progress, status }) => {
        const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
        const readableStatus = status.replace(/_/g, " ");
        setDealImport({
          status: "loading",
          message: `${readableStatus.charAt(0).toUpperCase()}${readableStatus.slice(1)}${progress > 0 ? ` · ${percent}%` : ""}`,
          fields: [],
          progress,
        });
      });
      if (!isPreviewImportUsable(result)) {
        setDealImport({
          status: "error",
          message: "The file contains readable text, but PencilProof did not find enough recognizable deal information for a reliable import. Try a clearer or more complete copy, or enter the figures manually and double-check the worksheet.",
          fields: [],
        });
        return;
      }
      const importedFields = { ...(result.fields as Partial<Deal>) };
      if (result.offerMatrix) {
        delete importedFields.cashDown;
        delete importedFields.term;
        delete importedFields.quotedPayment;
        delete importedFields.apr;
        delete importedFields.rebate;
      }
      setPendingImport({
        fields: importedFields,
        confidence: result.fieldConfidence,
        fileName: file.name,
        sourceUrl,
        sourceType: result.sourceType,
      });
      setOfferMatrix(result.offerMatrix ?? null);
      setSelectedOfferId("");
      setSelectedOfferType(null);
      const missingVerificationFields = verificationFields.filter(
        (field) => result.fields[field] === undefined,
      );
      const hasImportGaps = missingVerificationFields.length > 0;
      setDealImport({
        status: result.warnings?.length || hasImportGaps ? "warning" : "success",
        message: result.warnings?.length
          ? `Filled ${result.fieldNames.length} fields from ${file.name}. ${result.warnings.join(" ")}${hasImportGaps ? ` ${missingVerificationFields.length} categories were not detected. Review every field and enter missing numbers manually.` : ""}`
          : result.offerMatrix
            ? `Detected ${result.offerMatrix.options.length} payment choices in ${file.name}. Select the finance or lease option you are considering.${hasImportGaps ? ` ${missingVerificationFields.length} other categories were not detected; review and enter them manually.` : ""}`
            : `Found ${result.fieldNames.length} field${result.fieldNames.length === 1 ? "" : "s"} in ${file.name}${result.sourceType === "pdf" ? ` (${result.pageCount} page${result.pageCount === 1 ? "" : "s"}${result.usedOcr ? ", scanned-document OCR" : ""})` : ""}.${hasImportGaps ? ` Import incomplete: ${missingVerificationFields.length} categories were not detected. Review every field and enter missing numbers manually.` : " Confirm every value before starting the audit."}`,
        fields: result.fieldNames,
        progress: 1,
      });
    } catch (error) {
      console.error("PencilProof document import failed", error);
      const unreadableImage = error instanceof Error && error.message === "UNREADABLE_IMAGE";
      setDealImport({
        status: "error",
        message: unreadableImage
          ? "PencilProof could not find enough readable text in that image or scanned PDF. Try a brighter, sharper copy or enter the figures manually."
          : error instanceof Error && error.message.startsWith("AI_IMPORT_PROVIDER_QUOTA")
            ? "PencilProof's vision importer reached its Google Gemini usage limit. Please try again shortly or enter the figures manually."
            : error instanceof Error && error.message.startsWith("AI_IMPORT_PROVIDER_AUTHENTICATION")
              ? "PencilProof could not authenticate with Google Gemini. Please try again later or enter the figures manually."
              : error instanceof Error && error.message.startsWith("AI_IMPORT_PROVIDER_PERMISSION")
                ? "Google Gemini is not permitted to process this import right now. Please try again later or enter the figures manually."
                : error instanceof Error && error.message.startsWith("AI_IMPORT_PROVIDER_BAD_REQUEST")
                  ? "Google Gemini rejected this file request. Try the original full-resolution quote or enter the figures manually."
                  : error instanceof Error && error.message.startsWith("AI_IMPORT_PROVIDER_INVALID_RESPONSE")
                    ? "Google Gemini returned an unusable extraction response. Please try again or enter the figures manually."
                    : error instanceof Error && error.message.startsWith("AI_IMPORT_PROVIDER_PROVIDER_UNAVAILABLE")
                      ? "Google Gemini is temporarily unavailable. Please try again shortly or enter the figures manually."
                      : error instanceof Error && error.message.startsWith("AI_IMPORT_PROVIDER_REQUEST_TOO_LARGE")
                        ? "This file is too large for the vision importer. Use a smaller copy or enter the figures manually."
                        : error instanceof Error && error.message.startsWith("AI_IMPORT_PROVIDER_MODEL_UNAVAILABLE")
                          ? "No compatible Google Gemini vision model is available right now. Please try again later or enter the figures manually."
                      : error instanceof Error && error.message.startsWith("AI_IMPORT_PROVIDER_")
                        ? "PencilProof's vision importer could not process this file. Please try again or enter the figures manually."
          : "PencilProof could not read this file. It may be password-protected, blurry, or use an unsupported format. Check the original quote and enter the figures manually.",
        fields: [],
        progress: 0,
      });
    }
  };

  const handleDealFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await importDealFile(file);
  };

  const chooseOffer = (option: DealOfferOption) => {
    setSelectedOfferId(option.id);
    setSelectedOfferType(option.type);
    if (option.type === "finance") {
      setPendingImport((current) => ({
        fields: {
          ...(current?.fields ?? {}),
          cashDown: option.cashDown,
          term: option.term,
          quotedPayment: option.payment,
          ...(option.apr !== undefined ? { apr: option.apr } : {}),
        },
        confidence: {
          ...(current?.confidence ?? {}),
          cashDown: "review",
          term: "review",
          quotedPayment: "review",
          ...(option.apr !== undefined ? { apr: "review" as const } : {}),
        },
        fileName: current?.fileName ?? "payment menu",
        sourceUrl: current?.sourceUrl,
        sourceType: current?.sourceType,
      }));
    }
    setDealImport({
      status: "warning",
      message: option.type === "finance"
        ? `Selected finance option: $${option.cashDown.toLocaleString()} down, ${option.term} months, $${option.payment.toFixed(2)} per month. The worksheet may omit taxes, fees, products, or final lender terms—verify the itemized buyer's order before relying on the audit.`
        : `Selected lease estimate: $${option.cashDown.toLocaleString()} down, ${option.term} months, $${option.payment.toFixed(2)} per month. A complete lease audit still requires the residual or purchase option, mileage allowance, acquisition and disposition fees, taxes, and exact due-at-signing amount.`,
      fields: option.type === "finance" ? ["Cash down", "Loan term", "Quoted monthly payment"] : [],
    });
  };

  const updatePendingField = (field: keyof ImportedDealFields, rawValue: string) => {
    setPendingImport((current) => {
      if (!current) return current;
      const value = field === "vehicle" || field === "vin" ? rawValue : rawValue === "" ? undefined : Number(rawValue);
      return {
        ...current,
        fields: { ...current.fields, [field]: value },
        confidence: { ...current.confidence, [field]: "review" },
      };
    });
  };

  const pendingPreview = useMemo(() => {
    if (!pendingImport) return null;
    const fields = pendingImport.fields;
    const products =
      (fields.serviceContract ?? 0) +
      (fields.gap ?? 0) +
      (fields.prepaidMaintenance ?? 0) +
      (fields.tireWheel ?? 0) +
      (fields.accessories ?? 0);
    const amountFinanced = fields.sellingPrice
      ? Math.max(
          0,
          fields.sellingPrice +
            (fields.tax ?? 0) +
            (fields.govFees ?? 0) +
            (fields.docFee ?? 0) +
            products +
            (fields.tradePayoff ?? 0) -
            (fields.tradeValue ?? 0) -
            (fields.cashDown ?? 0) -
            (fields.rebate ?? 0),
        )
      : 0;
    const calculatedPayment =
      amountFinanced && fields.apr && fields.term
        ? paymentFor(amountFinanced, fields.apr, fields.term)
        : 0;
    const paymentDifference =
      calculatedPayment && fields.quotedPayment
        ? Math.abs(fields.quotedPayment - calculatedPayment)
        : 0;
    const criticalFields: (keyof ImportedDealFields)[] = [
      "sellingPrice",
      "tax",
      "apr",
      "term",
      "quotedPayment",
    ];

    return {
      products,
      pricedProductCount: [
        fields.serviceContract,
        fields.gap,
        fields.prepaidMaintenance,
        fields.tireWheel,
        fields.accessories,
      ].filter((value) => typeof value === "number" && value > 0).length,
      amountFinanced,
      calculatedPayment,
      paymentDifference,
      hasPaymentMismatch: paymentDifference > PAYMENT_MATCH_TOLERANCE,
      missingCritical: criticalFields.filter((field) => fields[field] === undefined),
    };
  }, [pendingImport]);

  const confirmPendingImport = () => {
    if (!pendingImport) return;
    if (!isPaidAuditHost) {
      openCheckout({
        fields: pendingImport.fields,
        confidence: pendingImport.confidence,
        fileName: pendingImport.fileName,
        offerMatrix,
        selectedOfferId: selectedOfferId || null,
        preCheckoutFeedbackCompleted: preCheckoutFeedbackCompleted === true,
      });
      return;
    }
    setSampleLoaded(false);
    setDeal((current) => ({ ...current, ...pendingImport.fields }));
    setPendingImport(null);
    setDealImport((current) => ({
      ...current,
      status: current.status === "error" ? "error" : "success",
      message: `Confirmed the imported values from ${pendingImport.fileName}. The audit now uses the figures you reviewed.`,
    }));
  };

  const clearImport = () => {
    setPendingImport(null);
    setImportSource((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
    setOfferMatrix(null);
    setSelectedOfferId("");
    setSelectedOfferType(null);
    setDealImport({ status: "idle", message: "", fields: [] });
  };

  const analysis = useMemo(() => {
    const addons =
      deal.serviceContract +
      deal.gap +
      deal.prepaidMaintenance +
      deal.tireWheel +
      deal.accessories;
    const totalFees = deal.govFees + deal.docFee;
    const tradeEquity = deal.tradeValue - deal.tradePayoff;
    const amountFinanced = Math.max(
      0,
      deal.sellingPrice +
        deal.tax +
        totalFees +
        addons +
        deal.tradePayoff -
        deal.tradeValue -
        deal.cashDown -
        deal.rebate,
    );
    const amountWithoutProducts = Math.max(0, amountFinanced - addons);
    const calculatedPayment = paymentFor(amountFinanced, deal.apr, deal.term);
    const paymentWithoutProducts = paymentFor(amountWithoutProducts, deal.apr, deal.term);
    const productPaymentImpact = Math.max(0, calculatedPayment - paymentWithoutProducts);
    const productCostOverTerm = productPaymentImpact * deal.term;
    const productFinancingCost = Math.max(0, productCostOverTerm - addons);
    const paymentGap = deal.quotedPayment > 0 ? deal.quotedPayment - calculatedPayment : 0;
    const financeCharge = Math.max(0, calculatedPayment * deal.term - amountFinanced);
    const totalPayments = calculatedPayment * deal.term;
    const isCashDeal = deal.term === 1 && deal.apr === 0;

    const missingInformation = [
      !deal.sellingPrice ? "selling price" : "",
      !deal.tax ? "sales-tax amount" : "",
      !deal.apr && !isCashDeal ? "dealer APR" : "",
      !deal.term ? "loan term" : "",
      !deal.quotedPayment ? "dealer's printed payment" : "",
    ].filter(Boolean);
    const hasMinimumData = Boolean(deal.sellingPrice && deal.term && (deal.apr || isCashDeal));
    const paymentStatus = !deal.quotedPayment
      ? { label: "Not checked", tone: "note" as const, detail: "Enter the payment printed on the quote." }
      : Math.abs(paymentGap) <= PAYMENT_MATCH_TOLERANCE
        ? { label: "Matches", tone: "good" as const, detail: `Within ${dollars(PAYMENT_MATCH_TOLERANCE)} per month.` }
        : { label: "Needs review", tone: "warn" as const, detail: `${dollars(Math.abs(paymentGap))} monthly difference.` };
    const productBreakdown = [
      { label: "VSC", amount: deal.serviceContract },
      { label: "GAP", amount: deal.gap },
      { label: "PPM", amount: deal.prepaidMaintenance },
      { label: "T&W", amount: deal.tireWheel },
      { label: "Accessories", amount: deal.accessories },
    ].filter((product) => product.amount > 0);
    const productSummary = productBreakdown.map((product) => `${product.label} ${dollarsAndCents(product.amount)}`).join(" · ");
    const productStatus = addons > 0
      ? { label: `${productBreakdown.length} product${productBreakdown.length === 1 ? "" : "s"} entered`, tone: "note" as const, detail: `${productSummary} · ${dollarsAndCents(addons)} total.` }
      : { label: "None entered", tone: "note" as const, detail: "No named products entered. Verify the quote does not bundle add-ons." };
    const counterProposalStatus = !savedRevision
      ? { label: "Ready to build", tone: "note" as const, detail: "Save the dealer original to compare revisions." }
      : !revisionComparison.sameVehicle
        ? { label: "Different vehicle", tone: "warn" as const, detail: "Use the same vehicle to compare revisions." }
        : revisionComparison.changes.length
          ? { label: `${revisionComparison.changes.length} change${revisionComparison.changes.length === 1 ? "" : "s"} detected`, tone: "good" as const, detail: "Counter proposal updates below." }
          : { label: "No changes yet", tone: "note" as const, detail: "Edit or import revised figures to build a proposal." };
    const tradeStatus = !deal.tradeValue && !deal.tradePayoff
      ? { label: "Unknown", tone: "note" as const, detail: "No trade figures entered." }
      : tradeEquity < 0
        ? { label: "Negative equity", tone: "warn" as const, detail: `${dollars(Math.abs(tradeEquity))} rolled into the loan.` }
        : { label: "Positive equity", tone: "good" as const, detail: `${dollars(tradeEquity)} reduces the deal balance.` };

    const flags: { tone: "warn" | "good" | "note"; title: string; detail: string }[] = [];
    if (addons > 0) {
      flags.push({
        tone: "warn",
        title: `${dollars(addons)} in entered optional products`,
        detail: `${dollars(productPaymentImpact)}/month and about ${dollars(productCostOverTerm)} over the entered term when financed at the entered APR.`,
      });
    } else {
      flags.push({
        tone: "good",
        title: "No optional products entered",
        detail: "Check the worksheet carefully for service contracts, GAP, maintenance, tire-and-wheel coverage, and other dealer add-ons.",
      });
    }
    if (deal.quotedPayment > 0 && Math.abs(paymentGap) > PAYMENT_MATCH_TOLERANCE) {
      flags.push({
        tone: "warn",
        title: `Quoted payment is ${dollars(Math.abs(paymentGap))}/month ${paymentGap > 0 ? "higher" : "lower"} than the live calculation`,
        detail: `The entered figures calculate to about ${dollars(calculatedPayment)}/month. Review the amount financed, APR, term, and first-payment due date. An unshown amount, deferred first payment, or packed payment may explain the gap.`,
      });
    } else if (deal.quotedPayment > 0) {
      flags.push({
        tone: "good",
        title: "Payment math is close",
        detail: `The entered figures calculate to about ${dollars(calculatedPayment)}/month.`,
      });
    }
    if (tradeEquity < 0) {
      flags.push({
        tone: "warn",
        title: `${dollars(Math.abs(tradeEquity))} of negative trade equity`,
        detail: "That old loan balance is being added to the new loan and can leave you upside-down longer.",
      });
    }
    if (deal.term >= 84) {
      flags.push({
        tone: "warn",
        title: `${deal.term}-month term`,
        detail: "A very long term lowers the payment but increases total interest and slows equity growth.",
      });
    } else if (deal.term > 60) {
      flags.push({
        tone: "note",
        title: `${deal.term}-month term`,
        detail: `Estimated finance charge is ${dollars(financeCharge)} if the loan is kept for the full term.`,
      });
    }
    if (!deal.sellingPrice) {
      flags.unshift({
        tone: "note",
        title: "Start with the dealer worksheet",
        detail: "Enter the written figures or load the sample to see how the Full Quote Audit works.",
      });
    }

    const productInsight = (name: string, amount: number, explanation: string, question: string): ProductInsight => {
      const monthlyImpact = paymentFor(amount, deal.apr, deal.term);
      const financedTotal = monthlyImpact * deal.term;
      return {
        name,
        amount,
        monthlyImpact,
        financedTotal,
        financingCost: Math.max(0, financedTotal - amount),
        explanation,
        question,
      };
    };
    const productInsights: ProductInsight[] = [];
    if (deal.serviceContract > 0) {
      productInsights.push(productInsight("Vehicle service contract (VSC)", deal.serviceContract, "May cover certain mechanical or electrical repairs under a separate contract. Coverage, exclusions, deductible, term, provider, and cancellation rules determine its value.", "Can I see the full contract, cash price, deductible, covered systems, exclusions, expiration mileage, and cancellation terms before deciding?"));
    }
    if (deal.gap > 0) {
      productInsights.push(productInsight("GAP protection", deal.gap, "May cover some or all of the difference between an insurance settlement and the loan balance after a covered total loss. Benefit limits and exclusions vary.", "What is the benefit limit, what is excluded, when does coverage end, and how does this price compare with my insurer or lender?"));
    }
    if (deal.prepaidMaintenance > 0) {
      productInsights.push(productInsight("Prepaid maintenance (PPM)", deal.prepaidMaintenance, "Prepays listed scheduled-maintenance services. It is not a repair warranty and may be limited by time, mileage, service locations, or included operations.", "Which exact services and intervals are included, where can I use it, and what would those services cost if I paid as I went?"));
    }
    if (deal.tireWheel > 0) {
      productInsights.push(productInsight("Tire & wheel protection (T&W)", deal.tireWheel, "May cover eligible tire and wheel damage from road hazards. Cosmetic damage, replacement limits, deductibles, exclusions, and claim procedures vary.", "What tire and wheel damage is covered, are cosmetic repairs included, what are the limits and deductible, and can I decline the coverage?"));
    }
    if (deal.accessories > 0) {
      productInsights.push(productInsight("Accessories and other add-ons", deal.accessories, "Includes appearance, paint/fabric, GPS/theft, etch, nitrogen, physical accessories, and other dealer add-ons. These items increase the amount financed and should be individually priced.", "Please itemize every add-on, its installed price, what has already been applied or installed, and whether the vehicle can be purchased without it."));
    }

    const reviewItems = [
      ...flags
        .filter((flag) => flag.tone === "warn")
        .map((flag) => ({ title: flag.title, detail: flag.detail })),
      ...missingInformation.map((item) => ({
        title: `Missing ${item}`,
        detail: "Add this figure from the dealer worksheet so the comparison is complete.",
      })),
    ];
    const warningCount = flags.filter((flag) => flag.tone === "warn").length;
    const reviewCount = reviewItems.length;
    const verdict = reviewCount === 0
      ? { label: "No immediate red flags", detail: "The entered figures are internally consistent. Verify the contracts and buyer's order before signing." }
      : { label: `${reviewCount} area${reviewCount === 1 ? "" : "s"} worth reviewing`, detail: warningCount > 0
        ? `${warningCount} calculation or deal-structure warning${warningCount === 1 ? "" : "s"} found${missingInformation.length ? `, plus ${missingInformation.length} missing item${missingInformation.length === 1 ? "" : "s"}` : ""}.`
        : `${missingInformation.length} important item${missingInformation.length === 1 ? " is" : "s are"} missing from the entered figures.` };

    return {
      addons,
      tradeEquity,
      amountFinanced,
      calculatedPayment,
      paymentWithoutProducts,
      productPaymentImpact,
      productCostOverTerm,
      productFinancingCost,
      financeCharge,
      totalPayments,
      hasMinimumData,
      missingInformation,
      checks: [
        { name: "Payment math", ...paymentStatus },
        { name: "Products", ...productStatus },
        { name: "Counter proposal", ...counterProposalStatus },
        { name: "Trade equity", ...tradeStatus },
      ],
      paymentGap,
      flags,
      productInsights,
      reviewItems,
      reviewCount,
      verdict,
    };
  }, [deal, revisionComparison, savedRevision]);

  const isCashDeal = deal.term === 1 && deal.apr === 0 && deal.quotedPayment > 0;
  const selectedCreditTier = creditTierEstimates[creditTier];
  const creditScoreEstimatedApr = creditVehicleType === "new" ? selectedCreditTier.newRate : selectedCreditTier.usedRate;

  useEffect(() => {
    if (auditSaveRequest === 0 || sampleLoaded || !isPaidAuditHost || !accountRoleKnown || !analysis.hasMinimumData) return;
    const key = JSON.stringify(deal);
    if (key === savedAuditKey.current) return;
    void fetch("/api/audits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ data: {
        ...deal,
        amountFinanced: analysis.amountFinanced,
        calculatedPayment: analysis.calculatedPayment,
        verdict: analysis.verdict,
        flags: analysis.flags.map((flag) => ({ name: flag.title, tone: flag.tone, detail: flag.detail })),
      } }),
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as { id?: unknown };
      if (response.ok && typeof payload.id === "string") {
        savedAuditKey.current = key;
        setAuditSaveMessage(accountRole === "salesperson" ? "Saved to your salesperson dashboard." : "Saved to My Audits.");
        if (printAfterSaveRef.current) {
          printAfterSaveRef.current = false;
          window.setTimeout(() => window.print(), 150);
        }
      } else {
        printAfterSaveRef.current = false;
        setAuditSaveMessage("This audit could not be saved yet. Try Save this audit again.");
      }
    }).catch(() => {
      printAfterSaveRef.current = false;
      setAuditSaveMessage("This audit could not be saved yet. Try Save this audit again.");
    });
  }, [auditSaveRequest]);

  const showConsumerOnlyAuditSections = !isPaidAuditHost || (accountRoleKnown && accountRole !== "salesperson");

  const submitAuditFeedback = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !auditFeedback.ui
      || !auditFeedback.service
      || !auditFeedback.scanQuality
      || !auditFeedback.worth
    ) return;
    track({
      category: "paid-audit-questionnaire",
      comment: JSON.stringify({
        ui: auditFeedback.ui,
        service: auditFeedback.service,
        scanQuality: auditFeedback.scanQuality,
        worth: Number(auditFeedback.worth),
      }),
      event: "feedback_submitted",
      value: auditFeedback.scanQuality,
    });
    sessionStorage.setItem(PAID_AUDIT_FEEDBACK_KEY, "true");
    setAuditFeedbackSent(true);
  };

  const productLines = [
    ["VSC / service contract", deal.serviceContract],
    ["GAP protection", deal.gap],
    ["Prepaid maintenance", deal.prepaidMaintenance],
    ["Tire & wheel protection", deal.tireWheel],
    ["Accessories / other add-ons", deal.accessories],
  ].filter(([, amount]) => Number(amount) > 0).map(([label, amount]) => `${label}: ${dollarsAndCents(Number(amount))}`);
  const productRequest = productLines.length
    ? `Please itemize and confirm each optional product currently shown (${productLines.join(", ")}), then show the revised payment with any product I decline removed.`
    : "Please confirm in writing that no optional products or add-ons are included unless I approve them individually.";
  const tradeRequest = deal.tradeValue > 0 || deal.tradePayoff > 0 || deal.cashDown > 0
    ? `Show the trade allowance of ${dollarsAndCents(deal.tradeValue)}, trade payoff of ${dollarsAndCents(deal.tradePayoff)}, resulting trade equity of ${dollarsAndCents(analysis.tradeEquity)}, and cash down of ${dollarsAndCents(deal.cashDown)} as separate lines.`
    : "Show any trade allowance, trade payoff, trade equity, and cash down as separate lines if they apply.";
  const dealerApr = deal.apr > 0 ? `${deal.apr.toFixed(2)}%` : "not entered";
  const rateRequest = isCashDeal
    ? "Confirm this is a cash purchase with one payment and no APR or financing charge."
    : `Confirm the final APR of ${dealerApr} and ${deal.term}-month term, subject to lender approval. If other lender-approved rate options are available, show them separately with their payment impact.`;
  const counterProposalLines = revisionComparison.sameVehicle
    ? revisionComparison.changes.map((change) => {
      const label = counterProposalLabel(change.field);
      const delta = change.afterValue - change.beforeValue;
      if (change.beforeValue === 0 && change.afterValue > 0) return `   - Add ${label} at ${change.after}. It was not included in the dealer-given original.`;
      if (change.afterValue === 0 && change.beforeValue > 0) return `   - Remove ${label}. The original showed ${change.before}; the counter proposal shows ${change.after}.`;
      if (delta < 0) return `   - Change ${label} from ${change.before} to ${change.after} (down ${counterProposalDelta(change.field, delta)}).`;
      if (delta > 0) return `   - Change ${label} from ${change.before} to ${change.after} (up ${counterProposalDelta(change.field, delta)}).`;
      return `   - Confirm ${label} at ${change.after}.`;
    })
    : [];
  const hasCounterProposal = revisionComparison.sameVehicle && counterProposalLines.length > 0;
  const counterProposalPaymentDelta = hasCounterProposal
    ? analysis.calculatedPayment - (revisionComparison.originalMath?.calculatedPayment ?? 0)
    : 0;
  const counterProposalPaymentLabel = hasCounterProposal
    ? dollarsAndCents(analysis.calculatedPayment)
    : analysis.hasMinimumData ? dollarsAndCents(analysis.calculatedPayment) : "—";
  const counterProposalPaymentDetail = hasCounterProposal
    ? `${counterProposalPaymentDelta === 0 ? "No payment change" : `${counterProposalPaymentDelta > 0 ? "+" : "−"}${dollarsAndCents(Math.abs(counterProposalPaymentDelta))}`} vs dealer original`
    : analysis.hasMinimumData ? "Matches current live calculation" : savedRevision ? "No changed figures yet" : "Edit figures to model a counter proposal";
  const message = hasCounterProposal
    ? `Thanks for working through the ${deal.vehicle || "vehicle"} quote with me. Based on the dealer-given original and the revised figures I entered, please review the following counter proposal:\n\n1. Requested changes\n${counterProposalLines.join("\n")}\n\n2. Revised live calculation to confirm\n   - Amount financed: ${dollarsAndCents(revisionComparison.originalMath?.amountFinanced ?? 0)} → ${dollarsAndCents(analysis.amountFinanced)}\n   - Live calculated payment: ${dollarsAndCents(revisionComparison.originalMath?.calculatedPayment ?? 0)} → ${dollarsAndCents(analysis.calculatedPayment)} per month\n   - APR: ${dealerApr}\n   - Term: ${deal.term} months\n   - Dealer-quoted payment on the revised worksheet: ${dollarsAndCents(deal.quotedPayment)}\n\nPlease send a revised buyer's order showing each requested change, all mandatory charges, the complete out-the-door total, amount financed, APR, term, and payment. Please confirm whether any difference between the printed payment and the live calculation comes from an omitted amount, deferred first payment, or another documented term.`
    : `Thanks for working through the ${deal.vehicle || "vehicle"} quote with me. I would like a revised buyer's order that reflects these numbers so I can make a clear decision:\n\n1. Vehicle and price\n   - Selling price: ${dollarsAndCents(deal.sellingPrice)}\n   - Rebate: ${dollarsAndCents(deal.rebate)}\n   - Sales tax: ${dollarsAndCents(deal.tax)}\n   - Government / registration: ${dollarsAndCents(deal.govFees)}\n   - Documentation fee: ${dollarsAndCents(deal.docFee)}\n\n2. Trade and cash\n   - ${tradeRequest}\n\n3. Optional products\n   - ${productRequest}\n\n4. Financing\n   - ${rateRequest}\n   - Show the current estimated amount financed of ${dollarsAndCents(analysis.amountFinanced)}, estimated payment of ${dollarsAndCents(analysis.calculatedPayment)}, quoted payment of ${dollarsAndCents(deal.quotedPayment)}, and total payment over ${deal.term} months.\n\nPlease confirm that there are no other mandatory charges and send the complete out-the-door total, amount financed, APR, term, and payment—not only the monthly payment.`;

  const copyMessage = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const requestAuditSave = (printAfterSave = false) => {
    if (sampleLoaded) {
      setAuditSaveMessage("The built-in sample is for demonstration and cannot be saved.");
      return;
    }
    printAfterSaveRef.current = printAfterSave;
    savedAuditKey.current = "";
    setAuditSaveMessage("Saving this audit…");
    setAuditSaveRequest((current) => current + 1);
  };

  return (
    <main className="analyzer-page">
      <nav className="site-nav analyzer-nav" aria-label="Main navigation">
        <Link className="brand" href="/" aria-label="PencilProof home"><img className="brand-logo" src="/pencilproof-profile-mark.png" alt="" width="40" height="40" /><span>PencilProof</span></Link>
        <div className="nav-links">
          <Link href="/who-it-helps">Who it helps</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/what-it-checks">What it checks</Link>
          <Link href="/pricing">Pricing</Link>
          <AccountNav />
        </div>
        <span className="privacy-chip">Your deal inputs stay in this browser · <a href="mailto:support@pencilproof.com">Contact support</a></span>
      </nav>

      <header className="analyzer-header shell">
        <div>
          <p className="kicker">{isPaidAuditHost ? "PRIVACY-FIRST FULL QUOTE AUDIT FOR CAR BUYERS" : "FREE QUOTE SCAN FOR CAR BUYERS"}</p>
          <h1>Review the quote before you sign.</h1>
          <p>{isPaidAuditHost
            ? "Upload the dealer's quote or enter the figures yourself. Then test the down payment, term, trade, and optional products while the dealership works on its official revision."
            : "Upload the dealer's quote or enter the figures yourself. Confirm what PencilProof found, choose an optional account or continue as a guest, then continue to secure checkout. The complete audit opens only after payment."}</p>
          <p className="analyzer-founder">Built by an automotive professional with experience as a salesperson, sales manager, and finance manager.</p>
          {hasReferralAttribution ? <p className="referral-disclosure">You arrived through a PencilProof salesperson link. If you purchase the Full Quote Audit, the person who shared this link may receive subscription credit.</p> : null}
        </div>
        {isPaidAuditHost ? (
          <div className="analyzer-actions">
            <button type="button" onClick={() => { setSampleLoaded(true); setDeal(sample); setPendingImport(null); setOfferMatrix(null); setSelectedOfferId(""); setSelectedOfferType(null); setDealImport({ status: "idle", message: "", fields: [] }); }}>Load sample</button>
            <button type="button" onClick={() => { setSampleLoaded(false); setDeal(blank); setPendingImport(null); setOfferMatrix(null); setSelectedOfferId(""); setSelectedOfferType(null); setDealImport({ status: "idle", message: "", fields: [] }); }}>Clear all</button>
          </div>
        ) : null}
      </header>

      <section className="pdf-import shell" aria-labelledby="pdf-import-title">
        <div className="pdf-import-main">
          <div className="pdf-badge" aria-hidden="true">SCAN</div>
          <div>
            <p className="pdf-kicker">START WITH THE WRITTEN NUMBERS</p>
            <h2 id="pdf-import-title">Upload what the dealer gave you</h2>
            <p>Choose a digital or scanned PDF, or any image format your device can open. PencilProof reads it locally first. Small or unclear images may be enlarged and sent through PencilProof&apos;s secured vision importer for better label and number matching.</p>
          </div>
          <div className="pdf-upload-actions">
            <PhoneCameraBridge buttonLabel="Phone scan" disabled={dealImport.status === "loading"} onFile={importDealFile} />
            <label className={`pdf-upload-button pdf-camera-button ${dealImport.status === "loading" ? "pdf-upload-loading" : ""}`}>
              <input type="file" accept={DEAL_CAMERA_ACCEPT} capture="environment" disabled={dealImport.status === "loading"} onChange={handleDealFileChange} />
              {dealImport.status === "loading" ? "Processing…" : "Take photo"}
            </label>
            <label className={`pdf-upload-button ${dealImport.status === "loading" ? "pdf-upload-loading" : ""}`}>
              <input type="file" accept={DEAL_IMPORT_ACCEPT} disabled={dealImport.status === "loading"} onChange={handleDealFileChange} />
              Choose PDF or image
            </label>
          </div>
        </div>
        {!isPaidAuditHost ? <div className="scan-benefits" aria-label="What you get from the free scan">
          <p className="scan-benefits-kicker">WHAT YOU&apos;LL GET BEFORE CHECKOUT</p>
          <div className="scan-benefits-grid">
            <div><strong>01</strong><span><b>Detected values</b> vehicle, payment, APR, fees, products, and trade details.</span></div>
            <div><strong>02</strong><span><b>Value check</b> compare what the document says with the math PencilProof can calculate.</span></div>
            <div><strong>03</strong><span><b>Clear next step</b> decide whether the complete $39 audit is useful before paying.</span></div>
          </div>
        </div> : null}
        {dealImport.status === "loading" ? (
          <div className="pdf-import-progress" role="status" aria-live="polite">
            <div className="pdf-import-progress-heading">
              <strong>Working on your quote</strong>
              <span>{Math.round((dealImport.progress ?? 0) * 100)}%</span>
            </div>
            <div className="pdf-import-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((dealImport.progress ?? 0) * 100)}>
              <span style={{ width: `${Math.max(3, Math.round((dealImport.progress ?? 0) * 100))}%` }} />
            </div>
            <p>{dealImport.message}</p>
            <small>Keep this screen open while PencilProof checks the document.</small>
          </div>
        ) : null}
        {dealImport.status === "error" ? (
          <div className={`pdf-import-status pdf-status-${dealImport.status}`} role="status" aria-live="polite">
            <span aria-hidden="true">!</span>
            <div>
              <p>{dealImport.message}</p>
              {dealImport.fields.length ? <div className="pdf-field-list">{dealImport.fields.map((field) => <small key={field}>{field}</small>)}</div> : null}
            </div>
          </div>
        ) : null}
        {offerMatrix ? (
          <div className="offer-matrix" aria-labelledby="offer-matrix-title">
            <div className="offer-matrix-heading">
              <div>
                <p className="eyebrow">MULTIPLE OPTIONS DETECTED</p>
                <h3 id="offer-matrix-title">Choose the offer you are considering</h3>
              </div>
              <span>{offerMatrix.options.length} choices</span>
            </div>
            {(["finance", "lease"] as const).map((type) => {
              const options = offerMatrix.options.filter((option) => option.type === type);
              if (!options.length) return null;
              return (
                <section className="offer-group" key={type} aria-label={`${type} options`}>
                  <div className="offer-group-title">
                    <h4>{type === "finance" ? "Finance alternatives" : "Lease estimates"}</h4>
                    <p>{type === "finance" ? "Select one row to fill the Full Quote Audit." : "Lease figures need additional contract details for a Full Quote Audit."}</p>
                  </div>
                  <div className="offer-options-grid">
                    {options.map((option) => (
                      <button
                        type="button"
                        key={option.id}
                        className={`offer-card ${selectedOfferId === option.id ? "offer-card-selected" : ""}`}
                        onClick={() => chooseOffer(option)}
                        aria-pressed={selectedOfferId === option.id}
                      >
                        <strong>${option.payment.toFixed(2)}<small>/mo</small></strong>
                        <span>{option.term} months</span>
                        <span>${option.cashDown.toLocaleString()} down</span>
                        {option.rebate !== undefined ? <em>${option.rebate.toLocaleString()} rebate shown</em> : null}
                        <b>{selectedOfferId === option.id ? "Selected" : "Choose"}</b>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            <p className="offer-matrix-warning">{offerMatrix.warnings.join(" ")} A displayed rebate is not automatically deducted because many menus already show a net vehicle price.</p>
          </div>
        ) : null}
        {pendingImport && selectedOfferType !== "lease" ? (
          <section className="import-verification" aria-labelledby="import-verification-title">
            <div className="verification-heading">
              <div>
                <p className="eyebrow">REQUIRED CHECK</p>
                <h3 id="import-verification-title">Confirm the imported values</h3>
                <p>PencilProof found a draft, not a guaranteed transcription. Compare each value with the document and correct anything marked “Needs review.” {isPaidAuditHost ? "After confirmation, the audit will use these figures." : "After confirmation, you can create an account or continue as a guest before secure checkout; the full audit remains locked until payment."}</p>
              </div>
              <div className="verification-legend" aria-label="Confidence legend">
                <span className="confidence-high">High confidence</span>
                <span className="confidence-review">Needs review</span>
                <span className="confidence-missing">Not found</span>
              </div>
            </div>
            {pendingVerificationSummary ? (
              <div className="verification-summary" aria-label="Import verification summary">
                <div><span>DETECTED</span><strong>{pendingVerificationSummary.detected}</strong></div>
                <div><span>NEEDS REVIEW</span><strong>{pendingVerificationSummary.needsReview}</strong></div>
                <div><span>NOT FOUND</span><strong>{pendingVerificationSummary.missing}</strong></div>
                <p><b>Next:</b> compare the document, correct the fields marked Needs review, then continue.</p>
              </div>
            ) : null}
            <VehiclePhoto
              vehicle={String(pendingImport.fields.vehicle ?? "")}
              vin={pendingImport.fields.vin}
              compact
            />
            <label className="vin-verification-field verification-field confidence-review">
              <span>VIN for exact trim matching <small>OPTIONAL</small></span>
              <input
                aria-label="VIN for exact trim matching"
                type="text"
                autoCapitalize="characters"
                maxLength={17}
                value={pendingImport.fields.vin ?? ""}
                placeholder="17-character VIN"
                onChange={(event) => updatePendingField("vin", event.target.value.toUpperCase())}
              />
              <small>When available, PencilProof uses the VIN to identify the trim, engine, drivetrain, and EPA configuration.</small>
            </label>
            <div className="evidence-layout">
              <div className="document-evidence">
                <div className="evidence-title"><span>ORIGINAL DOCUMENT</span><small>{pendingImport.fileName}</small></div>
                {importSource?.url ? (
                  importSource.type === "pdf" ? (
                    <iframe title={`Original ${pendingImport.fileName}`} src={importSource.url} />
                  ) : (
                    <img src={importSource.url} alt={`Original ${pendingImport.fileName}`} />
                  )
                ) : (
                  <div className="evidence-unavailable">The original file is not available in this session. Verify each value against your copy.</div>
                )}
                <p>Keep this document open while checking every imported number. Clear, complete copies stay local unless the local result needs the optional vision fallback.</p>
              </div>
              <div className="verification-grid">
                {verificationFields.map((field) => {
                  const value = pendingImport.fields[field];
                  const found = value !== undefined;
                  const confidence = found ? pendingImport.confidence[field] ?? "review" : "missing";
                  const reason = confidence === "high"
                    ? "Matched to labeled document text"
                    : confidence === "review"
                      ? "OCR or payment math requires visual confirmation"
                      : "No reliable labeled value found";
                  return (
                    <label className={`verification-field confidence-${confidence}`} key={field}>
                      <span>{DEAL_FIELD_LABELS[field]}</span>
                      <input
                        aria-label={`Verify ${DEAL_FIELD_LABELS[field]}`}
                        type={field === "vehicle" ? "text" : "number"}
                        inputMode={field === "vehicle" ? undefined : "decimal"}
                        step={field === "term" ? "1" : "0.01"}
                        value={value ?? ""}
                        placeholder="Not found"
                        onChange={(event) => updatePendingField(field, event.target.value)}
                      />
                      <small>{confidence === "high" ? "High confidence" : confidence === "review" ? "Needs review" : "Not found"}</small>
                      <em>{reason}</em>
                    </label>
                  );
                })}
              </div>
            </div>
            {pendingPreview ? (
              <div className="free-math-preview import-math-preview">
                <div>
                  <span>ESTIMATED AMOUNT FINANCED</span>
                  <strong>{pendingPreview.amountFinanced ? dollarsAndCents(pendingPreview.amountFinanced) : "Not enough data"}</strong>
                  <small>Rebuilt from the editable imported figures</small>
                </div>
                <div className="free-preview-statuses">
                  <p className={pendingPreview.calculatedPayment && pendingImport.fields.quotedPayment ? pendingPreview.hasPaymentMismatch ? "preview-warn" : "preview-good" : "preview-note"}>
                    <b>Payment math</b>
                    <span>
                      {!pendingPreview.calculatedPayment || !pendingImport.fields.quotedPayment
                        ? "Enter the printed payment to compare"
                        : pendingPreview.hasPaymentMismatch
                          ? `${dollarsAndCents(pendingPreview.paymentDifference)} mismatch · quote ${dollarsAndCents(pendingImport.fields.quotedPayment)} vs calculated ${dollarsAndCents(pendingPreview.calculatedPayment)}`
                          : "Quoted payment is within $5"
                      }
                    </span>
                  </p>
                  <p className={pendingPreview.amountFinanced ? "preview-good" : "preview-note"}>
                    <b>Amount financed</b>
                    <span>{pendingPreview.amountFinanced ? "Rebuilt from price, fees, products, trade, cash down, and rebate" : "Not enough figures to rebuild"}</span>
                  </p>
                  <p className={pendingPreview.products > 0 ? "preview-warn" : "preview-note"}>
                    <b>Products and add-ons</b>
                    <span>{pendingPreview.pricedProductCount > 0 ? `${pendingPreview.pricedProductCount} priced item${pendingPreview.pricedProductCount === 1 ? "" : "s"} detected` : "No priced items detected"}</span>
                  </p>
                  <p className={pendingPreview.missingCritical.length ? "preview-warn" : "preview-good"}>
                    <b>Required information</b>
                    <span>{pendingPreview.missingCritical.length ? `${pendingPreview.missingCritical.length} key item${pendingPreview.missingCritical.length === 1 ? "" : "s"} not found` : "Key fields found"}</span>
                  </p>
                </div>
              </div>
            ) : null}
            <div className="verification-actions">
              <button className="button button-primary" type="button" onClick={confirmPendingImport}>{isPaidAuditHost ? "Confirm values and see audits" : "Confirm values and continue to checkout"} <Arrow /></button>
            </div>
            {!isPaidAuditHost && auditHostResolved && preCheckoutFeedbackCompleted === false ? <PreCheckoutFeedback onCompleted={completePreCheckoutFeedback} /> : null}
            {pendingCheckout !== null ? <div ref={checkoutGateRef} className="checkout-gate-anchor"><PreCheckoutAccountGate onContinue={continueCheckout} /></div> : null}
          </section>
        ) : null}
        {selectedOfferType === "lease" ? (
          <section className="lease-only-panel" role="status">
            <p className="kicker">LEASE PAYMENT MENU ONLY</p>
            <h3>This lease row will not be sent into the finance calculator.</h3>
            <p>The printed payment can be compared with the other menu rows, but a real lease audit requires the residual value or purchase option, money factor, mileage allowance, acquisition and disposition fees, taxes, capitalized-cost reduction, and exact amount due at signing.</p>
            <button type="button" onClick={() => { setSelectedOfferId(""); setSelectedOfferType(null); }}>Choose a finance option instead</button>
          </section>
        ) : null}
        <p className="pdf-import-note">Best results: use a dealer-generated PDF or a bright, sharp, straight-on image with the full figures visible. PencilProof reads images locally first and uses the secured vision importer only when local extraction is incomplete or ambiguous. OCR and vision can make mistakes, so compare every imported value with the original.</p>
      </section>

      {!pendingImport && selectedOfferType !== "lease" && isPaidAuditHost ? <div className="analyzer-layout shell">
        <form className="deal-form" onSubmit={(event) => event.preventDefault()}>
          <section className="form-section">
            <div className="form-section-title"><span>01</span><div><h2>Vehicle & price</h2><p>Start with the top of the buyer&apos;s order or dealer worksheet.</p></div></div>
            <label className="input-field full-field"><span>Vehicle description</span><input aria-label="Vehicle description" type="text" placeholder="e.g. 2026 Honda CR-V EX-L" value={deal.vehicle} onChange={(event) => { setSampleLoaded(false); setDeal((current) => ({ ...current, vehicle: event.target.value })); }} /></label>
            <div className="field-grid">
              <MoneyField label="Selling price" field="sellingPrice" value={deal.sellingPrice} onChange={setNumber} />
              <MoneyField label="Rebate" field="rebate" value={deal.rebate} onChange={setNumber} hint="Only a true manufacturer or cash rebate" />
              <MoneyField label="Sales tax" field="tax" value={deal.tax} onChange={setNumber} />
              <MoneyField label="Cash down" field="cashDown" value={deal.cashDown} onChange={setNumber} />
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-title"><span>02</span><div><h2>Fees & finance products</h2><p>Use the individual prices shown on the worksheet or product menu.</p></div></div>
            <div className="field-grid">
              <MoneyField label="Government / registration" field="govFees" value={deal.govFees} onChange={setNumber} />
              <MoneyField label="Dealer documentation fee" field="docFee" value={deal.docFee} onChange={setNumber} />
              <MoneyField label="VSC / service contract" field="serviceContract" value={deal.serviceContract} onChange={setNumber} hint="Sometimes called an extended warranty" />
              <MoneyField label="GAP protection" field="gap" value={deal.gap} onChange={setNumber} />
              <MoneyField label="Prepaid maintenance (PPM)" field="prepaidMaintenance" value={deal.prepaidMaintenance} onChange={setNumber} />
              <MoneyField label="Tire & wheel protection (T&W)" field="tireWheel" value={deal.tireWheel} onChange={setNumber} />
              <MoneyField label="Accessories / other add-ons" field="accessories" value={deal.accessories} onChange={setNumber} />
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-title"><span>03</span><div><h2>Trade & financing</h2><p>Use the actual trade payoff and the APR—not only the monthly payment.</p></div></div>
            <div className="field-grid">
              <MoneyField label="Trade allowance" field="tradeValue" value={deal.tradeValue} onChange={setNumber} />
              <MoneyField label="Trade loan payoff" field="tradePayoff" value={deal.tradePayoff} onChange={setNumber} />
            </div>
            <div className="field-grid field-grid-four">
              <label className="input-field"><span>Dealer APR</span><div className="input-money input-percent"><input aria-label="Dealer APR" inputMode="decimal" type="number" min="0" step="0.01" value={deal.apr || ""} onChange={(event) => setNumber("apr", event.target.value)} /><i>%</i></div><small>{isCashDeal ? "Cash purchase: one payment at 0%" : "Use the rate printed on the quote"}</small></label>
              <div className="input-field credit-score-field" aria-live="polite">
                <span>Credit score estimate</span>
                <div className="credit-score-estimator">
                  <div className="credit-score-heading"><div><small className="credit-score-kicker">MARKET PLANNING GUIDE</small><strong>Choose a credit tier</strong></div><span>{selectedCreditTier.basis}</span></div>
                  <div className="credit-score-tier-grid" role="group" aria-label="Credit score estimate">
                    {(Object.entries(creditTierEstimates) as [CreditTier, (typeof creditTierEstimates)[CreditTier]][]).map(([value, profile]) => <button className={creditTier === value ? "is-selected" : ""} type="button" key={value} onClick={() => setCreditTier(value)} aria-pressed={creditTier === value}>{profile.label}</button>)}
                  </div>
                  <label className="credit-score-vehicle-type"><span>Vehicle type</span><select aria-label="Vehicle type for rate estimate" value={creditVehicleType} onChange={(event) => setCreditVehicleType(event.target.value as CreditVehicleType)}><option value="new">New vehicle</option><option value="used">Used vehicle</option></select></label>
                  <div className="credit-score-rate">
                    <div><span>Dealer APR</span><strong>{isCashDeal ? "Cash" : deal.apr > 0 ? `${deal.apr.toFixed(2)}%` : "Not entered"}</strong></div>
                    <div><span>Market estimate</span><strong>{isCashDeal ? "—" : `${creditScoreEstimatedApr.toFixed(2)}%`}</strong></div>
                  </div>
                  <small className="credit-score-note">{isCashDeal ? "Cash purchase: no financing rate estimate." : "Based on Experian Q1 2026 national averages; actual lender terms vary by credit history, term, vehicle, down payment, and lender."}</small>
                </div>
              </div>
              <label className="input-field"><span>Loan term</span><select aria-label="Loan term" value={deal.term} onChange={(event) => setNumber("term", event.target.value)}>{[1, 24, 30, 36, 39, 42, 48, 54, 60, 63, 66, 72, 75, 78, 83, 84, 96].map((term) => <option key={term} value={term}>{term === 1 ? "1 payment (cash)" : `${term} months`}</option>)}</select></label>
              <MoneyField label={isCashDeal ? "Cash due / finance amount" : "Dealer's quoted monthly payment"} field="quotedPayment" value={deal.quotedPayment} onChange={setNumber} hint={isCashDeal ? "The one payment shown on the quote" : "Keeps the amount printed on the quote for comparison"} />
            </div>
            <div className="live-payment" aria-live="polite">
              <div><span>{isCashDeal ? "LIVE CALCULATED CASH DUE" : "LIVE CALCULATED PAYMENT"}</span><strong>{dollarsAndCents(analysis.calculatedPayment)}{isCashDeal ? null : <small>/month</small>}</strong></div>
              <p>{isCashDeal ? "This one-payment cash total updates immediately when you change the price, tax, fees, products, trade, cash down, or rebate." : "This amount updates immediately when you change the price, tax, fees, products, trade, cash down, APR, or term. The dealer's quoted payment above stays unchanged so PencilProof can compare the two."}</p>
            </div>
          </section>
          {!isPaidAuditHost ? (
            <div className="public-manual-checkout">
              <div>
                <span>FREE SCAN COMPLETE</span>
                <strong>Ready to continue?</strong>
                <p>Your entered figures stay in this browser. Continue to secure checkout to unlock the complete Full Quote Audit after payment.</p>
              </div>
              <button
                className="button button-primary"
                type="button"
                disabled={!manualCheckoutFields.ready}
                onClick={() => openCheckout({
                  fields: manualCheckoutFields.fields,
                  confidence: Object.fromEntries(Object.keys(manualCheckoutFields.fields).map((field) => [field, "review"])),
                  fileName: "Manual quote entry",
                  offerMatrix: null,
                  selectedOfferId: null,
                })}
              >
                Continue to secure checkout <Arrow />
              </button>
              {pendingCheckout !== null ? <div ref={checkoutGateRef} className="checkout-gate-anchor"><PreCheckoutAccountGate onContinue={continueCheckout} /></div> : null}
            </div>
          ) : null}
        </form>

        {isPaidAuditHost ? <aside className="results-panel" aria-live="polite">
          <div className="results-sticky">
            <div className="result-top">
              <div><p>DEAL CHECKS</p><h2>{deal.vehicle || "Your finance deal"}</h2></div>
              <div className={`audit-status ${analysis.hasMinimumData ? "audit-ready" : "audit-incomplete"}`}>
                {analysis.hasMinimumData ? "Ready to review" : "Incomplete"}
              </div>
            </div>
            <p className="score-note">
              {analysis.hasMinimumData
                ? `${analysis.missingInformation.length} important item${analysis.missingInformation.length === 1 ? "" : "s"} still missing: ${analysis.missingInformation.join(", ") || "none"}.`
                : "Not enough information to evaluate this deal. Enter the selling price, dealer APR, and term or confirm an imported quote."}
            </p>
            {isPaidAuditHost && analysis.hasMinimumData ? <div className="sales-audit-save-action sales-audit-save-action-top">
              <div><strong>Save this audit</strong><span>Keep the reviewed numbers in {accountRole === "salesperson" ? "your salesperson dashboard" : "My Audits"}.</span></div>
              <button type="button" onClick={() => requestAuditSave()}>Save audit</button>
              {auditSaveMessage ? <span role="status">{auditSaveMessage}</span> : null}
            </div> : null}

            {analysis.hasMinimumData ? <>
              <VehiclePhoto vehicle={deal.vehicle} vin={deal.vin} tone="dark" compact />

              <div className="deal-check-grid">
                {analysis.checks.map((check) => (
                  <div className={`deal-check check-${check.tone}`} key={check.name}>
                    <span>{check.name}</span>
                    <strong>{check.label}</strong>
                    <small>{check.detail}</small>
                  </div>
                ))}
              </div>

              <div className={`instant-verdict ${analysis.reviewCount ? "instant-verdict-review" : "instant-verdict-good"}`}>
                <div className="instant-verdict-heading"><span>INSTANT VERDICT</span><strong>{analysis.verdict.label}</strong></div>
                <p>{analysis.verdict.detail}</p>
                {analysis.reviewItems.length ? <div className="instant-verdict-review-list">
                  <span>REVIEW NEXT</span>
                  <ul>
                    {analysis.reviewItems.map((item) => <li key={item.title}><strong>{item.title}</strong><small>{item.detail}</small></li>)}
                  </ul>
                </div> : null}
              </div>

              <div className="payment-compare">
                <div className="payment-compare-dealer"><span>DEALER QUOTED PAYMENT</span><strong>{deal.quotedPayment > 0 ? dollars(deal.quotedPayment) : "Not entered"}</strong><small>Printed on quote · stays fixed</small></div>
                <div><span>WITH PRODUCTS</span><strong>{dollars(analysis.calculatedPayment)}<small>/mo</small></strong><small>Current live calculation</small></div>
                <div><span>WITHOUT PRODUCTS</span><strong>{dollars(analysis.paymentWithoutProducts)}<small>/mo</small></strong><small>Live calculation without products</small></div>
                <div><span>COUNTER-PROPOSAL / LIVE</span><strong>{counterProposalPaymentLabel}{counterProposalPaymentLabel !== "—" && !isCashDeal ? <small>/mo</small> : null}</strong><small>{counterProposalPaymentDetail}</small></div>
              </div>

              <div className={`payment-truth ${deal.quotedPayment > 0 && Math.abs(analysis.paymentGap) > PAYMENT_MATCH_TOLERANCE ? "payment-truth-warning" : ""}`}>
                <div><span>DEALER'S PRINTED PAYMENT</span><strong>{deal.quotedPayment > 0 ? dollarsAndCents(deal.quotedPayment) : "Not entered"}</strong></div>
                <div><span>PENCILPROOF CALCULATION</span><strong>{dollarsAndCents(analysis.calculatedPayment)}</strong></div>
                <div><span>DIFFERENCE</span><strong>{deal.quotedPayment > 0 ? dollarsAndCents(Math.abs(analysis.paymentGap)) : "—"}</strong></div>
              </div>

              <div className="result-numbers">
                <div><span>Estimated amount financed</span><strong>{dollars(analysis.amountFinanced)}</strong></div>
                <div><span>Entered optional products</span><strong>{dollars(analysis.addons)}</strong></div>
                <div><span>Total of payments</span><strong>{dollars(analysis.totalPayments)}</strong></div>
                <div><span>Total finance charge</span><strong>{dollars(analysis.financeCharge)}</strong></div>
              </div>

              <div className="deal-equation">
                <div className="result-section-title"><span>HOW THE DEAL ADDS UP</span></div>
                {[
                  ["Vehicle selling price", deal.sellingPrice, "+"],
                  ["Sales tax", deal.tax, "+"],
                  ["Government / registration", deal.govFees, "+"],
                  ["Documentation fee", deal.docFee, "+"],
                  ["Optional products", analysis.addons, "+"],
                  ["Trade loan payoff", deal.tradePayoff, "+"],
                  ["Trade allowance", deal.tradeValue, "−"],
                  ["Cash down", deal.cashDown, "−"],
                  ["Rebate", deal.rebate, "−"],
                ].map(([label, amount, sign]) => (
                  <div key={String(label)}>
                    <span>{sign} {label}</span>
                    <strong>{dollarsAndCents(Number(amount))}</strong>
                  </div>
                ))}
                <div className="deal-equation-total"><span>= Estimated amount financed</span><strong>{dollarsAndCents(analysis.amountFinanced)}</strong></div>
              </div>

              <div className="result-section-title"><span>PRIORITY FINDINGS</span></div>
              <div className="result-flags">
                {analysis.flags.map((flag, index) => (
                  <div className={`result-flag result-${flag.tone}`} key={`${flag.title}-${index}`}>
                    <span>{flag.tone === "good" ? "✓" : flag.tone === "warn" ? "!" : "i"}</span>
                    <p><b>{flag.title}</b><small>{flag.detail}</small></p>
                  </div>
                ))}
              </div>

              {showConsumerOnlyAuditSections ? <div className="product-breakdown">
                <div className="result-section-title"><span>WHAT THE PRODUCTS DO</span></div>
                {analysis.productInsights.length ? analysis.productInsights.map((product) => (
                  <article className="product-insight" key={product.name}>
                    <div><h3>{product.name}</h3><strong>{dollars(product.amount)}</strong></div>
                    <div className="product-cost-grid">
                      <span>Payment impact <b>{dollarsAndCents(product.monthlyImpact)}/mo</b></span>
                      <span>Over {deal.term} months <b>{dollarsAndCents(product.financedTotal)}</b></span>
                      <span>Financing cost <b>{dollarsAndCents(product.financingCost)}</b></span>
                    </div>
                    <p>{product.explanation}</p>
                    <small><b>Ask:</b> {product.question}</small>
                  </article>
                )) : (
                  <p className="empty-products">Enter any VSC, GAP, PPM, T&W, or accessory/add-on prices shown on the quote to receive product-specific guidance.</p>
                )}
              </div> : null}

              {showConsumerOnlyAuditSections ? <div className="dealer-message">
                <div><p>{hasCounterProposal ? "COUNTER PROPOSAL TO THE DEALER" : "MESSAGE TO THE DEALER"}</p><button type="button" onClick={copyMessage}>{copied ? "Copied" : "Copy message"}</button></div>
                {hasCounterProposal ? <small className="dealer-message-context">Detected {revisionComparison.changes.length} change{revisionComparison.changes.length === 1 ? "" : "s"} from the dealer-given original. This proposal updates automatically as you edit the numbers.</small> : null}
                <pre>{message}</pre>
              </div> : null}
              <div className="audit-output-actions">
                <button className="print-button" type="button" onClick={() => window.print()}>Print this Full Quote Audit</button>
                {isPaidAuditHost ? <button className="audit-save-print-button" type="button" onClick={() => requestAuditSave(true)}>Save &amp; print audit</button> : null}
              </div>
              {!isPaidAuditHost && showConsumerOnlyAuditSections && !accountPromptDismissed ? <section className="account-save-prompt" aria-labelledby="account-save-title">
                <div>
                  <p className="paid-feedback-kicker">OPTIONAL ACCOUNT</p>
                  <h3 id="account-save-title">Save your PencilProof access</h3>
                  <p>Create a free account to access your Pass from other devices, retrieve saved audits, and manage your audit history for 30 days.</p>
                </div>
                <div className="account-save-actions">
                  <Link className="button button-primary" href="/account">Create Account</Link>
                  <button className="button button-quiet" type="button" onClick={() => setAccountPromptDismissed(true)}>Continue Without Account</button>
                </div>
              </section> : null}
              {/* Paid users should move directly from their audit to their saved history; no survey interrupts this flow. */}
              {false ? <section className="paid-feedback-card" aria-labelledby="paid-feedback-title">
                <p className="paid-feedback-kicker">ONE-MINUTE BETA CHECK-IN</p>
                <h3 id="paid-feedback-title">How did you like your Full Quote Audit?</h3>
                <p className="paid-feedback-intro">Your answers help us improve the experience. This is anonymous—please do not include your name, VIN, or quote details.</p>
                {auditFeedbackSent ? (
                  <p className="paid-feedback-thanks" role="status">Thank you. Your feedback was recorded.</p>
                ) : (
                  <form className="paid-feedback-form" onSubmit={submitAuditFeedback}>
                    <fieldset>
                      <legend>How was the user interface?</legend>
                      <div className="paid-feedback-rating-grid">
                        {auditFeedbackRatings.map((rating) => (
                          <label className="paid-feedback-rating" key={`ui-${rating.value}`}>
                            <input
                              type="radio"
                              name="audit-feedback-ui"
                              value={rating.value}
                              checked={auditFeedback.ui === rating.value}
                              onChange={() => setAuditFeedback((current) => ({ ...current, ui: rating.value }))}
                            />
                            <span><b>{rating.value}</b><small>{rating.label}</small></span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend>How was the overall service?</legend>
                      <div className="paid-feedback-rating-grid">
                        {auditFeedbackRatings.map((rating) => (
                          <label className="paid-feedback-rating" key={`service-${rating.value}`}>
                            <input
                              type="radio"
                              name="audit-feedback-service"
                              value={rating.value}
                              checked={auditFeedback.service === rating.value}
                              onChange={() => setAuditFeedback((current) => ({ ...current, service: rating.value }))}
                            />
                            <span><b>{rating.value}</b><small>{rating.label}</small></span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend>How was the scan quality?</legend>
                      <div className="paid-feedback-rating-grid">
                        {auditFeedbackRatings.map((rating) => (
                          <label className="paid-feedback-rating" key={`scan-${rating.value}`}>
                            <input
                              type="radio"
                              name="audit-feedback-scan"
                              value={rating.value}
                              checked={auditFeedback.scanQuality === rating.value}
                              onChange={() => setAuditFeedback((current) => ({ ...current, scanQuality: rating.value }))}
                            />
                            <span><b>{rating.value}</b><small>{rating.label}</small></span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend>How much would this service be worth to you?</legend>
                      <div className="paid-feedback-worth-grid">
                        {auditFeedbackWorth.map((worth) => (
                          <label className="paid-feedback-worth" key={worth}>
                            <input
                              type="radio"
                              name="audit-feedback-worth"
                              value={worth}
                              checked={auditFeedback.worth === worth}
                              onChange={() => setAuditFeedback((current) => ({ ...current, worth }))}
                            />
                            <span>${worth === "0" ? "0" : worth}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <button
                      className="paid-feedback-submit"
                      type="submit"
                      disabled={!auditFeedback.ui || !auditFeedback.service || !auditFeedback.scanQuality || !auditFeedback.worth}
                    >
                      Send feedback
                    </button>
                  </form>
                )}
              </section> : null}
            </> : (
              <div className="empty-audit">
                <strong>Your audit will appear here.</strong>
                <p>Upload a quote, enter the figures manually, or load the sample. PencilProof will not grade an empty deal.</p>
              </div>
            )}
            <p className="result-disclaimer">Educational estimate only. Coverage, taxes, fees, trade credits, lender rules, and product terms vary. Verify every figure and contract before signing. No savings are guaranteed.</p>
          </div>
        </aside> : null}
      </div> : null}
    </main>
  );
}
