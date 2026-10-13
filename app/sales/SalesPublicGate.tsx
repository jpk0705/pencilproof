"use client";

import { useEffect, useState } from "react";
import { authRedirectOptions, createLoadedClerk } from "@/lib/clerk-client";

export function SalesPublicGate({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!key) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void createLoadedClerk(key).then((clerk) => {
      if (cancelled) return;
      const update = () => setVisible(!clerk.user);
      update();
      unsubscribe = clerk.addListener(update);
    }).catch(() => {});
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);

  return visible ? <>{children}</> : null;
}

export function SalesSignInButton({ children }: { children: React.ReactNode }) {
  const signIn = async () => {
    const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!key) return;
    try {
      const clerk = await createLoadedClerk(key);
      clerk.openSignIn(authRedirectOptions("salesperson"));
    } catch {
      window.location.assign("/account");
    }
  };

  return <button className="button button-primary" type="button" onClick={() => void signIn()}>{children}</button>;
}
