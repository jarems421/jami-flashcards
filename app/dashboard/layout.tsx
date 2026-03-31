"use client";

import UserProvider from "@/lib/user-context";
import TabBar from "@/components/TabBar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <UserProvider>
      <div className="pb-20 md:pb-0 md:pl-20">{children}</div>
      <TabBar />
    </UserProvider>
  );
}
