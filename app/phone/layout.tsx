import type { Metadata } from "next";
export const metadata: Metadata = { title: "Phone Camera | PencilProof", robots: { index: false, follow: false } };
export default function PhoneLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }
