import type { Metadata } from "next";
import { Instrument_Serif, Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Provenance — Portfolio that updates from evidence",
  description:
    "Connect GitHub, package registries, publications, and writing. AI curates what belongs on your professional portfolio.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${outfit.variable} ${instrument.variable} h-full antialiased`}>
      <body className="min-h-full grain">{children}</body>
    </html>
  );
}
