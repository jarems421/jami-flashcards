"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import PublicDashboardShell from "@/components/demo/PublicDashboardShell";
import DemoAccountNotice from "@/components/layout/DemoAccountNotice";
import InAppNotice from "@/components/layout/InAppNotice";
import TabBar from "@/components/layout/TabBar";
import { listenToAuth } from "@/lib/auth/auth-listener";
import UserProvider from "@/lib/auth/user-context";
import {
  readSidebarHiddenPreference,
  saveSidebarHiddenPreference,
} from "@/lib/app/sidebar-preference";

const PUBLIC_WALKTHROUGH_FALLBACK_MS = 2500;

function DashboardSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/10 border-t-accent" />
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
      <DemoAccountNotice />
      <div
        className={`pb-32 transition-[padding] duration-300 md:pb-0 ${
          sidebarHidden ? "md:pl-0" : "md:pl-24 lg:pl-72"
        }`}
      >
        {children}
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
  const [checked, setChecked] = useState(false);
  const [hasUser, setHasUser] = useState(false);

  useEffect(() => {
    let resolved = false;
    let unsubscribe: (() => void) | undefined;
    let errorFallbackId: number | undefined;

    const fallbackId = window.setTimeout(() => {
      if (resolved) {
        return;
      }

      setHasUser(false);
      setChecked(true);
    }, PUBLIC_WALKTHROUGH_FALLBACK_MS);

    try {
      unsubscribe = listenToAuth((nextUser: User | null) => {
        resolved = true;
        window.clearTimeout(fallbackId);
        setHasUser(Boolean(nextUser));
        setChecked(true);
      });
    } catch (error) {
      resolved = true;
      window.clearTimeout(fallbackId);
      console.error("Dashboard auth gate failed; showing public walkthrough.", error);
      errorFallbackId = window.setTimeout(() => {
        setHasUser(false);
        setChecked(true);
      }, 0);
    }

    return () => {
      resolved = true;
      window.clearTimeout(fallbackId);
      if (errorFallbackId !== undefined) {
        window.clearTimeout(errorFallbackId);
      }
      unsubscribe?.();
    };
  }, []);

  if (!checked) {
    return <DashboardSpinner />;
  }

  if (!hasUser) {
    return <PublicDashboardShell />;
  }

  return <AuthenticatedDashboard>{children}</AuthenticatedDashboard>;
}
