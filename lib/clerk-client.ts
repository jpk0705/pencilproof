"use client";

import { Clerk } from "@clerk/clerk-js";

export type PencilProofAuthContext = "consumer" | "salesperson";

export type PencilProofAccountSession = {
  ok: boolean;
  role: PencilProofAuthContext;
  expiresAt: number | null;
  email: string;
  audits: unknown[];
  marketingOptedIn: boolean;
  salespersonProfile: unknown | null;
};

const ACCOUNT_API_URL = "https://audit.pencilproof.com";
const ACCOUNT_SESSION_CACHE_TTL_MS = 60_000;

const AUTH_CONTEXT_STORAGE_KEY = "pencilproof-auth-context";

const isAuthContext = (value: string | null | undefined): value is PencilProofAuthContext =>
  value === "consumer" || value === "salesperson";

type ClerkWindow = Window & {
  __internal_ClerkUICtor?: unknown;
  __pencilProofClerkUiPromise?: Promise<void>;
  __pencilProofClerkPromise?: Promise<Clerk>;
};

type AccountSessionResponse = {
  ok?: unknown;
  role?: unknown;
  expiresAt?: unknown;
  email?: unknown;
  audits?: unknown;
  marketingOptedIn?: unknown;
  salespersonProfile?: unknown;
};

type AccountSessionCacheEntry = {
  value: PencilProofAccountSession;
  cachedAt: number;
};

const accountSessionCache = new Map<string, AccountSessionCacheEntry>();
const accountSessionInFlight = new Map<string, Promise<PencilProofAccountSession>>();

const getClerkWindow = () => window as ClerkWindow;

const clerkDomainFromKey = (publishableKey: string) => {
  const encodedDomain = publishableKey.split("_")[2];
  if (!encodedDomain) throw new Error("CLERK_PUBLISHABLE_KEY_INVALID");
  return atob(encodedDomain).replace(/\$$/, "");
};

const loadClerkUi = async (publishableKey: string) => {
  const clerkWindow = getClerkWindow();
  if (clerkWindow.__internal_ClerkUICtor) return;

  if (!clerkWindow.__pencilProofClerkUiPromise) {
    clerkWindow.__pencilProofClerkUiPromise = new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>("script[data-pencilproof-clerk-ui]");
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(), { once: true });
        existingScript.addEventListener("error", () => reject(new Error("CLERK_UI_LOAD_FAILED")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.pencilproofClerkUi = "true";
      script.src = `https://${clerkDomainFromKey(publishableKey)}/npm/@clerk/ui@1/dist/ui.browser.js`;
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener("error", () => reject(new Error("CLERK_UI_LOAD_FAILED")), { once: true });
      document.head.appendChild(script);
    });
  }

  await clerkWindow.__pencilProofClerkUiPromise;
  if (!clerkWindow.__internal_ClerkUICtor) throw new Error("CLERK_UI_NOT_AVAILABLE");
};

export const createLoadedClerk = async (publishableKey: string) => {
  await loadClerkUi(publishableKey);
  const clerkWindow = getClerkWindow();
  if (!clerkWindow.__pencilProofClerkPromise) {
    const promise = (async () => {
      const instance = new Clerk(publishableKey);
      const loadOptions = {
        ui: { ClerkUI: clerkWindow.__internal_ClerkUICtor },
      } as Parameters<Clerk["load"]>[0];
      await instance.load(loadOptions);
      return instance;
    })();
    clerkWindow.__pencilProofClerkPromise = promise.catch((error) => {
      delete clerkWindow.__pencilProofClerkPromise;
      throw error;
    });
  }
  return clerkWindow.__pencilProofClerkPromise;
};

const accountSessionKey = (instance: Clerk, authContext: PencilProofAuthContext) =>
  `${instance.user?.id ?? "anonymous"}:${authContext}`;

const accountSessionFallback = (
  authContext: PencilProofAuthContext,
  email: string,
): PencilProofAccountSession => ({
  ok: false,
  role: authContext,
  expiresAt: null,
  email,
  audits: [],
  marketingOptedIn: false,
  salespersonProfile: null,
});

export const clearAccountSessionCache = () => {
  accountSessionCache.clear();
  accountSessionInFlight.clear();
};

export const syncAccountContact = async (
  instance: Clerk,
  authContext: PencilProofAuthContext,
  options: { force?: boolean } = {},
): Promise<PencilProofAccountSession> => {
  const token = await instance.session?.getToken().catch(() => null);
  const email = instance.user?.primaryEmailAddress?.emailAddress.trim() ?? "";
  if (!token) return accountSessionFallback(authContext, email);

  const key = accountSessionKey(instance, authContext);
  const cached = accountSessionCache.get(key);
  if (!options.force && cached && Date.now() - cached.cachedAt < ACCOUNT_SESSION_CACHE_TTL_MS) return cached.value;
  const pending = accountSessionInFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const response = await fetch(`${ACCOUNT_API_URL}/api/account/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email,
        token,
        role: authContext,
        ...(options.force ? { force: true } : {}),
      }),
    }).catch(() => null);
    const data = response
      ? await response.json().catch(() => ({})) as AccountSessionResponse
      : {};
    const resolvedRole: PencilProofAuthContext = data.role === "salesperson" ? "salesperson" : authContext;
    const value: PencilProofAccountSession = {
      ok: Boolean(response?.ok && data.ok === true),
      role: resolvedRole,
      expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
      email: typeof data.email === "string" && data.email.trim() ? data.email.trim() : email,
      audits: Array.isArray(data.audits) ? data.audits : [],
      marketingOptedIn: data.marketingOptedIn === true,
      salespersonProfile: data.salespersonProfile && typeof data.salespersonProfile === "object" ? data.salespersonProfile : null,
    };
    if (value.ok) accountSessionCache.set(key, { value, cachedAt: Date.now() });
    return value;
  })();
  accountSessionInFlight.set(key, request);
  try {
    return await request;
  } finally {
    if (accountSessionInFlight.get(key) === request) accountSessionInFlight.delete(key);
  }
};

export const setAuthContext = (context: PencilProofAuthContext) => {
  window.sessionStorage.setItem(AUTH_CONTEXT_STORAGE_KEY, context);
};

export const getAuthContext = (): PencilProofAuthContext => {
  const queryContext = new URL(window.location.href).searchParams.get("auth_context");
  if (isAuthContext(queryContext)) {
    setAuthContext(queryContext);
    return queryContext;
  }
  const storedContext = window.sessionStorage.getItem(AUTH_CONTEXT_STORAGE_KEY);
  return isAuthContext(storedContext) ? storedContext : "consumer";
};

export const clearServerAccountSession = async () => {
  clearAccountSessionCache();
  await fetch(`${ACCOUNT_API_URL}/api/account/logout`, {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    keepalive: true,
  }).catch(() => undefined);
};

export const authRedirectOptions = (context: PencilProofAuthContext = "consumer") => {
  setAuthContext(context);
  const redirectUrl = new URL(window.location.href);
  // The shared site navigation can open consumer sign-in while the visitor is
  // viewing the salesperson marketing page. Do not send that consumer back to
  // the salesperson route after authentication; their account home is My Audits.
  if (context === "consumer" && redirectUrl.pathname.startsWith("/sales")) {
    redirectUrl.pathname = "/account";
    redirectUrl.search = "";
  }
  if (context === "salesperson") {
    redirectUrl.pathname = "/sales";
    redirectUrl.search = "";
  }
  redirectUrl.searchParams.set("auth_context", context);
  const url = redirectUrl.toString();
  return {
    signInForceRedirectUrl: url,
    signUpForceRedirectUrl: url,
    signInFallbackRedirectUrl: url,
    signUpFallbackRedirectUrl: url,
  };
};
