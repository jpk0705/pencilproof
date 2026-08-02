import type { Metadata } from "next";
import "./globals.css";
import AnalyticsBoot from "@/app/components/AnalyticsBoot";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const iconPath = "/favicon.svg";

export const metadata: Metadata = {
  title: "PencilProof | Stop Negotiating Blind",
  description: "Upload your dealer quote free. PencilProof separates the price, rate, fees, products, trade, and payment math so you can verify the deal before you sign.",
  other: isGitHubPages ? undefined : { "codex-preview": "development" },
  icons: {
    icon: iconPath,
    shortcut: iconPath,
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
        <AnalyticsBoot />
        {children}
      </body>
    </html>
  );
}
