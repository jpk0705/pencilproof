const API_BASE_URL = "https://audit.pencilproof.com";

export type QuoteFields = Record<string, string | number>;

export type Audit = {
  id: string;
  createdAt: number;
  expiresAt: number;
  data: {
    amountFinanced?: number;
    apr?: number;
    cashDown?: number;
    dealerApr?: number;
    loanTerm?: number;
    payment?: number;
    price?: number;
    sellingPrice?: number;
    calculatedPayment?: number;
    quotedPayment?: number;
    term?: number;
    vehicle?: string;
    vin?: string;
    verdict?: string | { label?: string; detail?: string };
    flags?: Array<{ name?: string; detail?: string }>;
  };
};

export type ImportResult = {
  fields: QuoteFields;
  productItems?: Array<{
    name: string;
    amount: number;
    category: "serviceContract" | "gap" | "prepaidMaintenance" | "tireWheel" | "accessories";
  }>;
  offerMatrix?: {
    options: Array<{
      id: string;
      type: "finance" | "lease";
      cashDown: number;
      term: number;
      payment: number;
      apr?: number;
      rebate?: number;
      purchaseOption?: number;
    }>;
    warnings?: string[];
  } | null;
  warnings: string[];
  fieldConfidence?: Record<string, string>;
  sourceType?: string;
};

export type AccountMe = {
  userId: string;
  email?: string | null;
  role?: "consumer" | "salesperson";
  expiresAt: number | null;
  audits: Audit[];
  marketingOptedIn: boolean;
};

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const jsonHeaders = { "Content-Type": "application/json" };

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers = new Headers(options.headers);
  Object.entries(jsonHeaders).forEach(([key, value]) => headers.set(key, value));
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    try {
      const body = await response.json() as { error?: string; code?: string };
      code = body.code ?? body.error ?? code;
    } catch {
      // Keep the stable HTTP code when the response is not JSON.
    }
    throw new ApiError(response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const randomSessionId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`;

export async function importQuote(uri: string, mimeType: string, token?: string | null) {
  // Expo 57 keeps readAsStringAsync in the legacy namespace. Importing it
  // explicitly prevents the deprecation LogBox from covering the scan result.
  const FileSystem = await import("expo-file-system/legacy");
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return apiRequest<ImportResult>(
    "/api/ai-import",
    { method: "POST", body: JSON.stringify({ base64, mimeType }) },
    token,
  );
}

export async function sendFeedback(
  value: number,
  comment: string,
  category = "mobile-precheckout",
  token?: string | null,
) {
  return apiRequest<{ recorded: boolean }>("/api/analytics/event", {
    method: "POST",
    body: JSON.stringify({
      category,
      comment,
      event: "feedback_submitted",
      eventId: randomSessionId(),
      occurredAt: new Date().toISOString(),
      path: "/mobile",
      sessionId: randomSessionId(),
      source: "mobile-app",
      value,
    }),
  }, token);
}

export { API_BASE_URL };
