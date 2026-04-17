import type { Metadata, Viewport } from "next";
import { Nunito_Sans } from "next/font/google";

const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-nunito-sans",
});
import ConstellationBackgroundShell from "@/components/constellation/ConstellationBackgroundShell";
import PwaBootstrap from "@/components/layout/PwaBootstrap";
import "./globals.css";

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
  themeColor: "#100719",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${nunitoSans.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-surface-base text-text-primary">
        <PwaBootstrap />
        <ConstellationBackgroundShell>{children}</ConstellationBackgroundShell>
      </body>
    </html>
  );
}

