import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/NavBar";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RE Intelligence — Real Estate AI Scraper",
  description: "AI-powered real estate intelligence platform. Discover agencies, extract property data, and analyse pricing in any city.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <NavBar />
        <main>{children}</main>
      </body>
    </html>
  );
}
