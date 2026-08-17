"use client";

import { Clerk } from "@clerk/clerk-js";

export type PencilProofAuthContext = "consumer" | "salesperson";

const AUTH_CONTEXT_STORAGE_KEY = "pencilproof-auth-context";

const isAuthContext = (value: string | null | undefined): value is PencilProofAuthContext =>
  value === "consumer" || value === "salesperson";

type ClerkWindow = Window & {
  __internal_ClerkUICtor?: unknown;
  __pencilProofClerkUiPromise?: Promise<void>;
  __pencilProofClerkPromise?: Promise<Clerk>;
};

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
  redirectUrl.searchParams.set("auth_context", context);
  const url = redirectUrl.toString();
  return {
    signInForceRedirectUrl: url,
    signUpForceRedirectUrl: url,
    signInFallbackRedirectUrl: url,
    signUpFallbackRedirectUrl: url,
  };
};
