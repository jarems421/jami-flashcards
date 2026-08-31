"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { usePathname, useRouter } from "next/navigation";
import InAppNotice from "@/components/layout/InAppNotice";
import TabBar from "@/components/layout/TabBar";
import TopicMigrationGate from "@/components/topics/TopicMigrationGate";
import { listenToAuth } from "@/services/auth/auth-listener";
import UserProvider from "@/components/providers/UserProvider";
import {
  readSidebarHiddenPreference,
  saveSidebarHiddenPreference,
} from "@/lib/app/sidebar-preference";
import { forgetLastRoute, rememberLastRoute } from "@/lib/app/last-route";
import TutorialProvider from "@/components/onboarding/TutorialProvider";

function DashboardSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[var(--color-border)] border-t-accent" />
    </div>
  );
}

function AuthenticatedDashboard({
  children,
  user,
}: {
  children: ReactNode;
  user: User;
}) {
  const [sidebarHidden, setSidebarHidden] = useState(() => readSidebarHiddenPreference());

  const handleSidebarHiddenChange = (hidden: boolean) => {
    setSidebarHidden(hidden);
    saveSidebarHiddenPreference(hidden);
  };

  return (
    <UserProvider user={user}>
      <TutorialProvider userId={user.uid}>
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
      </TutorialProvider>
    </UserProvider>
  );
}

export default function DashboardAccessGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  // Noted as they move, so relaunching the app can put them back rather than
  // always opening the home screen. Only once they are actually signed in --
  // a page they were bounced off is not a page they were on.
  useEffect(() => {
    if (!checked || !user || !pathname) return;
    rememberLastRoute(pathname);
  }, [checked, pathname, user]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    try {
      unsubscribe = listenToAuth((nextUser: User | null) => {
        if (!active) return;
        setUser(nextUser);
        setChecked(true);
      });
    } catch (error) {
      console.error("Dashboard auth gate failed; redirecting to sign in.", error);
      queueMicrotask(() => {
        if (!active) return;
        setUser(null);
        setChecked(true);
      });
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (checked && !user) {
      // Signed out: the page they were on is no longer theirs to return to.
      forgetLastRoute();
      router.replace("/");
    }
  }, [checked, router, user]);

  if (!checked || !user) {
    return <DashboardSpinner />;
  }

  return <AuthenticatedDashboard user={user}>{children}</AuthenticatedDashboard>;
}
