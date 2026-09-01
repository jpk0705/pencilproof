import type { Metadata } from "next";
export const metadata: Metadata = { title: "My Audits | PencilProof", robots: { index: false, follow: false } };
export default function AccountLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }
