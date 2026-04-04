import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import ConstellationBackgroundShell from "@/components/ConstellationBackgroundShell";
import PwaBootstrap from "@/components/PwaBootstrap";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  variable: "--font-nunito",
});

export const metadata: Metadata = {
  title: "Jami Flashcards",
  description: "Study smarter with spaced-repetition flashcards and constellation rewards.",
  applicationName: "Jami Flashcards",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Jami",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#081120",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${nunito.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body>
        <PwaBootstrap />
        <ConstellationBackgroundShell>{children}</ConstellationBackgroundShell>
      </body>
    </html>
  );
}
