"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { useRouter } from "next/navigation";
import InAppNotice from "@/components/layout/InAppNotice";
import TabBar from "@/components/layout/TabBar";
import TopicMigrationGate from "@/components/topics/TopicMigrationGate";
import { listenToAuth } from "@/lib/auth/auth-listener";
import UserProvider from "@/lib/auth/user-context";
import {
  readSidebarHiddenPreference,
  saveSidebarHiddenPreference,
} from "@/lib/app/sidebar-preference";

function DashboardSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[var(--color-border)] border-t-accent" />
    </div>
  );
}

function AuthenticatedDashboard({ children }: { children: ReactNode }) {
  const [sidebarHidden, setSidebarHidden] = useState(() => readSidebarHiddenPreference());

  const handleSidebarHiddenChange = (hidden: boolean) => {
    setSidebarHidden(hidden);
    saveSidebarHiddenPreference(hidden);
  };

  return (
    <UserProvider>
      <div
        data-dashboard-content
        className={`pb-32 transition-[padding] duration-300 md:pb-0 ${
          sidebarHidden ? "md:pl-0" : "md:pl-24 lg:pl-72"
        }`}
      >
        <TopicMigrationGate>{children}</TopicMigrationGate>
      </div>
      <InAppNotice />
      <TabBar
        desktopHidden={sidebarHidden}
        onDesktopHiddenChange={handleSidebarHiddenChange}
      />
    </UserProvider>
  );
}

export default function DashboardAccessGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [hasUser, setHasUser] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    try {
      unsubscribe = listenToAuth((nextUser: User | null) => {
        if (!active) return;
        setHasUser(Boolean(nextUser));
        setChecked(true);
      });
    } catch (error) {
      console.error("Dashboard auth gate failed; redirecting to sign in.", error);
      queueMicrotask(() => {
        if (!active) return;
        setHasUser(false);
        setChecked(true);
      });
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (checked && !hasUser) {
      router.replace("/");
    }
  }, [checked, hasUser, router]);

  if (!checked || !hasUser) {
    return <DashboardSpinner />;
  }

  return <AuthenticatedDashboard>{children}</AuthenticatedDashboard>;
}
