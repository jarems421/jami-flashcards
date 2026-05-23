"use client";

import UserProvider from "@/lib/auth/user-context";
import InAppNotice from "@/components/layout/InAppNotice";
import DemoAccountNotice from "@/components/layout/DemoAccountNotice";
import TabBar from "@/components/layout/TabBar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <UserProvider>
      <DemoAccountNotice />
      <div className="pb-32 md:pb-0 md:pl-[6.75rem] lg:pl-80">{children}</div>
      <InAppNotice />
      <TabBar />
    </UserProvider>
  );
}

