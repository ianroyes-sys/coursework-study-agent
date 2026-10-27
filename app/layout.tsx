import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Coursework",
  description: "Your semester as a priority queue, with a study-prep workbench that never submits anything.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-screen">
        <a className="skip-link" href="#content">Skip to content</a>
        <main id="content" tabIndex={-1} className="min-h-screen outline-none">{children}</main>
      </body>
    </html>
  );
}
