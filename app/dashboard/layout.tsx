"use client";

// KaTeX styles are only needed where maths is rendered (cards, notebooks, and
// the AI drawers), so they load with the dashboard rather than with every
// marketing and auth route.
import "katex/dist/katex.min.css";
import RouteAnalytics from "@/components/analytics/RouteAnalytics";
import DashboardAccessGate from "@/components/layout/DashboardAccessGate";
import EmailVerificationBanner from "@/components/layout/EmailVerificationBanner";
import PracticePaperReadyNotice from "@/components/practice/PracticePaperReadyNotice";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardAccessGate>
      <RouteAnalytics />
      <EmailVerificationBanner />
      <PracticePaperReadyNotice />
      {children}
    </DashboardAccessGate>
  );
}

