"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import PublicDashboardShell from "@/components/demo/PublicDashboardShell";
import DemoAccountNotice from "@/components/layout/DemoAccountNotice";
import InAppNotice from "@/components/layout/InAppNotice";
import TabBar from "@/components/layout/TabBar";
import { listenToAuth } from "@/lib/auth/auth-listener";
import UserProvider from "@/lib/auth/user-context";

function DashboardSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/10 border-t-accent" />
    </div>
  );
}

function AuthenticatedDashboard({ children }: { children: ReactNode }) {
  return (
    <UserProvider>
      <DemoAccountNotice />
      <div className="pb-32 md:pb-0 md:pl-[6.75rem] lg:pl-80">{children}</div>
      <InAppNotice />
      <TabBar />
    </UserProvider>
  );
}

export default function DashboardAccessGate({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [hasUser, setHasUser] = useState(false);

  useEffect(() => {
    const unsubscribe = listenToAuth((nextUser: User | null) => {
      setHasUser(Boolean(nextUser));
      setChecked(true);
    });
    return () => unsubscribe();
  }, []);

  if (!checked) {
    return <DashboardSpinner />;
  }

  if (!hasUser) {
    return <PublicDashboardShell />;
  }

  return <AuthenticatedDashboard>{children}</AuthenticatedDashboard>;
}
