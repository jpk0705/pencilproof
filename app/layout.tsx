import type { Metadata } from "next";
import "./globals.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import AnalyticsBoot from "@/app/components/AnalyticsBoot";
import OptionalClerkProvider from "@/app/components/OptionalClerkProvider";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const faviconPng = "/favicon.png?v=20260813";
const faviconSvg = "/favicon.svg?v=20260813";

export const metadata: Metadata = {
  metadataBase: new URL("https://pencilproof.com"),
  title: "PencilProof | Privacy-first Full Quote Audit for car buyers",
  description: "PencilProof is a privacy-first Full Quote Audit for car buyers. Review dealer quote math, APR, amount financed, payment, trade equity, and add-ons before signing.",
  alternates: { canonical: "/" },
  other: {
    "facebook-domain-verification": "7tqkudgd5w6zan0d720tkmluc3g0jc",
    ...(isGitHubPages ? {} : { "codex-preview": "development" }),
  },
  icons: {
    icon: [
      { url: faviconPng, type: "image/png", sizes: "64x64" },
      { url: faviconSvg, type: "image/svg+xml" },
    ],
    shortcut: faviconPng,
    apple: faviconPng,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <OptionalClerkProvider>
          <AnalyticsBoot />
          {children}
        </OptionalClerkProvider>
      </body>
    </html>
  );
}
