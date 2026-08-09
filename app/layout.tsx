import type { Metadata } from "next";
import "./globals.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import AnalyticsBoot from "@/app/components/AnalyticsBoot";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";

export const metadata: Metadata = {
  title: "PencilProof | Privacy-first Full Quote Audit for car buyers",
  description: "PencilProof is a privacy-first Full Quote Audit for car buyers. Review dealer quote math, APR, amount financed, payment, trade equity, and add-ons before signing.",
  other: isGitHubPages ? undefined : { "codex-preview": "development" },
  icons: { icon: "/pencilproof-profile-mark.png", shortcut: "/pencilproof-profile-mark.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AnalyticsBoot />
        {children}
      </body>
    </html>
  );
}
