"use client";

import { Clerk } from "@clerk/clerk-js";

type ClerkWindow = Window & {
  __internal_ClerkUICtor?: unknown;
  __pencilProofClerkUiPromise?: Promise<void>;
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
  const instance = new Clerk(publishableKey);
  const loadOptions = {
    ui: { ClerkUI: getClerkWindow().__internal_ClerkUICtor },
  } as Parameters<Clerk["load"]>[0];
  await instance.load(loadOptions);
  return instance;
};
