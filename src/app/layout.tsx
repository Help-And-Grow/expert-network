import localFont from "next/font/local";
import Script from "next/script";

import { Providers } from "@/components/providers";
import { TelegramStartParamRouter } from "@/components/telegram-start-param-router";
import { env } from "@/lib/env";

import "./globals.css";

import type { Metadata, Viewport } from "next";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const APP_URL = env.NEXTAUTH_URL || "https://www.help-and-grow.com";
const TITLE = "Help & Grow — Expert Network";
const DESCRIPTION =
  "A network for real expertise across Singapore and Southeast Asia: be both coach and player, schedule meetups, share what you know, and grow together — learn by doing, grow by helping.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "Help and Grow",
    "expert network",
    "Singapore",
    "Southeast Asia",
    "peer learning",
    "advisory",
    "founders",
    "experts",
    "learning by doing",
  ],
  metadataBase: new URL(APP_URL),
  openGraph: {
    type: "website",
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
    url: APP_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#090d18",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} app-shell font-sans antialiased`}
      >
        <Providers>
          <TelegramStartParamRouter />
          <main className="min-h-screen">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
