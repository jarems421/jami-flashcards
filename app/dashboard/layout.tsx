"use client";

import DashboardAccessGate from "@/components/layout/DashboardAccessGate";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardAccessGate>{children}</DashboardAccessGate>
  );
}

