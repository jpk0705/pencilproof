import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "pencilproof";
const iconPath = isGitHubPages ? `/${repositoryName}/favicon.svg` : "/favicon.svg";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PencilProof | Structure Your Car Deal Before You Sign",
  description: "Stop waiting for the next dealership pencil. Rebuild the payment, compare options, test your desired APR, separate products, and prepare a specific revised-deal request.",
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
