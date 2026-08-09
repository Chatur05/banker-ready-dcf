import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://banker-ready-dcf.sites.openai.com"),
  title: "Banker Ready DCF",
  description: "A filing-led, provenance-first public-equity DCF engine.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Banker Ready DCF",
    description: "Trace public-company filings through WACC, terminal value, dilution, and implied share price.",
    images: [{ url: "/og.png", width: 1734, height: 909, alt: "Financial statements traced through a DCF to an implied value output" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Banker Ready DCF",
    description: "A filing-led, provenance-first public-equity DCF engine.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geist.variable} ${mono.variable}`}>{children}</body></html>;
}
