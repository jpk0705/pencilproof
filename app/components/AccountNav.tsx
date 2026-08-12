"use client";

import Link from "next/link";
import { Clerk } from "@clerk/clerk-js";
import { useEffect, useState } from "react";

const ACCOUNT_URL = "https://audit.pencilproof.com/account";

export default function AccountNav() {
  const [clerk, setClerk] = useState<Clerk | null>(null);
  useEffect(() => { const instance = new Clerk(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!); void instance.load().then(() => setClerk(instance)); }, []);
  if (!clerk) return null;
  return clerk.user ? <Link href={ACCOUNT_URL}>My Audits</Link> : <button className="nav-account-button" type="button" onClick={() => clerk.openSignIn({})}>Sign in</button>;
}
