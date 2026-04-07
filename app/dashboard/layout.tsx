"use client";

import UserProvider from "@/lib/auth/user-context";
import TabBar from "@/components/layout/TabBar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <UserProvider>
      <div className="pb-28 md:pb-0 md:pl-28">{children}</div>
      <TabBar />
    </UserProvider>
  );
}

