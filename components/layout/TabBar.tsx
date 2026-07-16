"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type TouchEvent, useRef, useState } from "react";
import { BrandMark, IconBubble } from "@/components/ui";

type Tab = {
  href: string;
  label: string;
  description: string;
  activeRoutes: readonly string[];
  /** SVG path data for the icon (24x24 viewBox). */
  icon: string;
};

const tabs: Tab[] = [
  {
    href: "/dashboard",
    label: "Today",
    description: "Your next step",
    activeRoutes: ["/dashboard"],
    icon: "M11.47 3.841a.75.75 0 011.06 0l8.69 8.69a.75.75 0 01-.53 1.28h-1.44v7.44a.75.75 0 01-.75.75h-3a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-1.5a.75.75 0 00-.75.75v4.5a.75.75 0 01-.75.75h-3a.75.75 0 01-.75-.75v-7.44H5.31a.75.75 0 01-.53-1.28l8.69-8.69z",
  },
  {
    href: "/dashboard/study",
    label: "Learn",
    description: "Review flashcards",
    activeRoutes: [
      "/dashboard/study",
      "/dashboard/learn",
      "/dashboard/decks",
      "/dashboard/cards",
      "/dashboard/topics",
    ],
    icon: "M11.4 2.55a1 1 0 011.2 0l8.1 6.075a1 1 0 010 1.6l-3.2 2.4v3.05a1 1 0 01-.42.815C15.63 17.51 13.92 18.05 12 18.05s-3.63-.54-5.08-1.565a1 1 0 01-.42-.815v-3.045l-2-1.5v4.425a1 1 0 11-2 0V9.625a1 1 0 01.4-.8l8.5-6.275zm-3.15 11.4v1.16c1.1.62 2.35.94 3.75.94s2.65-.32 3.75-.94v-1.16l-3.15 2.363a1 1 0 01-1.2 0L8.25 13.95z",
  },
  {
    href: "/dashboard/practise",
    label: "Practice",
    description: "Notebook work",
    activeRoutes: [
      "/dashboard/practise",
      "/dashboard/practice",
      "/dashboard/folders",
      "/dashboard/notebooks",
    ],
    icon: "M4.5 4.75A2.75 2.75 0 017.25 2h9.5a2.75 2.75 0 012.75 2.75v14.5A2.75 2.75 0 0116.75 22h-9.5a2.75 2.75 0 01-2.75-2.75V4.75zm4 2a.75.75 0 000 1.5h7a.75.75 0 000-1.5h-7zm0 4a.75.75 0 000 1.5h4a.75.75 0 000-1.5h-4zm-.53 4.72a.75.75 0 011.06 0l1.22 1.22 3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0l-1.75-1.75a.75.75 0 010-1.06z",
  },
  {
    href: "/dashboard/library",
    label: "Library",
    description: "Saved references",
    activeRoutes: ["/dashboard/library"],
    icon: "M2 19h20v2H2v-2zM4 7a1 1 0 011-1h3a1 1 0 011 1v12H4V7zM10 4a1 1 0 011-1h3a1 1 0 011 1v15h-5V4zM16 9a1 1 0 011-1h3a1 1 0 011 1v10h-5V9z",
  },
  {
    href: "/dashboard/progress",
    label: "Progress",
    description: "See your growth",
    activeRoutes: [
      "/dashboard/progress",
      "/dashboard/goals",
      "/dashboard/constellation",
      "/dashboard/stats",
    ],
    icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  },
];

function routeMatches(pathname: string, route: string) {
  if (route === "/dashboard") return pathname === route;
  return pathname === route || pathname.startsWith(`${route}/`);
}

function isActive(pathname: string, tab: Tab) {
  return tab.activeRoutes.some((route) => routeMatches(pathname, route));
}

function NavIcon({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={`h-5 w-5 transition duration-fast ${active ? "opacity-100" : "opacity-75"}`}
    >
      <path fillRule="evenodd" clipRule="evenodd" d={tab.icon} />
    </svg>
  );
}

function DesktopNavItem({
  tab,
  active,
}: {
  tab: Tab;
  active: boolean;
}) {
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      data-agent-nav={tab.label}
      data-agent-route={tab.href}
      className={`group relative flex min-h-[3.35rem] items-center justify-center gap-3 rounded-[1.2rem] px-2.5 py-1.5 text-left transition duration-fast ease-spring lg:justify-start lg:px-3.5 ${
        active
          ? "border border-[var(--nav-active-border)] bg-[var(--nav-active-bg)] text-[var(--nav-active-text)] shadow-[var(--nav-active-shadow)]"
          : "border border-transparent text-text-muted hover:border-[var(--color-border)] hover:bg-[var(--nav-hover-bg)] hover:text-text-primary"
      }`}
    >
      {active ? (
        <span className="absolute inset-y-2 left-0 hidden w-1 rounded-r-full bg-warm-accent lg:block" />
      ) : null}
      <IconBubble
        size="sm"
        shape="rounded"
        className={`h-9 w-9 border transition duration-fast ${
          active
            ? "app-selected"
            : "app-chip text-text-muted group-hover:border-border-strong group-hover:text-text-primary"
        }`}
      >
        <NavIcon tab={tab} active={active} />
      </IconBubble>
      <span className="hidden min-w-0 lg:block">
        <span className="block truncate text-sm font-semibold">{tab.label}</span>
        <span className="mt-0.5 block truncate text-[0.72rem] text-text-muted">
          {tab.description}
        </span>
      </span>
    </Link>
  );
}

function MobileNavItem({
  tab,
  active,
}: {
  tab: Tab;
  active: boolean;
}) {
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      data-agent-nav={tab.label}
      data-agent-route={tab.href}
      className={`relative flex min-h-[3.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-[1.05rem] px-1 text-[10px] leading-tight transition duration-fast ease-spring ${
        active
          ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-text)] shadow-[var(--nav-active-shadow)]"
          : "text-text-muted active:text-text-primary"
      }`}
    >
      {active ? <span className="absolute inset-x-5 top-1 h-0.5 rounded-full bg-warm-accent" /> : null}
      <NavIcon tab={tab} active={active} />
      <span className={`truncate ${active ? "font-semibold" : "font-medium"}`}>
        {tab.label}
      </span>
    </Link>
  );
}

function SidebarToggleIcon({ direction }: { direction: "hide" | "show" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M4.75 5.75A2 2 0 016.75 3.75h10.5a2 2 0 012 2v12.5a2 2 0 01-2 2H6.75a2 2 0 01-2-2V5.75zM9 4.25v15.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={direction === "hide" ? "M15.5 9l-3 3 3 3" : "M12.5 9l3 3-3 3"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type TabBarProps = {
  desktopHidden?: boolean;
  onDesktopHiddenChange?: (hidden: boolean) => void;
};

export default function TabBar({
  desktopHidden = false,
  onDesktopHiddenChange,
}: TabBarProps) {
  const pathname = usePathname();
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const sidebarTouchStartXRef = useRef<number | null>(null);
  const sidebarTouchStartYRef = useRef<number | null>(null);
  const sidebarSwipeHandledRef = useRef(false);
  const swipeHandledRef = useRef(false);
  const [mobileHidden, setMobileHidden] = useState(false);

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
    touchStartYRef.current = event.touches[0]?.clientY ?? null;
    swipeHandledRef.current = false;
  };

  const handleTouchMove = (event: TouchEvent<HTMLElement>) => {
    if (mobileHidden || swipeHandledRef.current) {
      return;
    }

    const startX = touchStartXRef.current;
    const startY = touchStartYRef.current;
    const moveX = event.touches[0]?.clientX ?? null;
    const moveY = event.touches[0]?.clientY ?? null;

    if (startX === null || startY === null || moveX === null || moveY === null) {
      return;
    }

    const deltaX = moveX - startX;
    const deltaY = moveY - startY;
    const mostlyVertical = Math.abs(deltaY) > Math.abs(deltaX) + 10;

    if (deltaY > 26 && mostlyVertical) {
      swipeHandledRef.current = true;
      setMobileHidden(true);
    }
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const startX = touchStartXRef.current;
    const startY = touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    const endY = event.changedTouches[0]?.clientY ?? null;
    const endX = event.changedTouches[0]?.clientX ?? null;

    if (
      swipeHandledRef.current ||
      startX === null ||
      startY === null ||
      endX === null ||
      endY === null
    ) {
      return;
    }

    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const mostlyVertical = Math.abs(deltaY) > Math.abs(deltaX) + 10;

    if (deltaY > 36 && mostlyVertical) {
      setMobileHidden(true);
    }
  };

  const handleSidebarTouchStart = (event: TouchEvent<HTMLElement>) => {
    sidebarTouchStartXRef.current = event.touches[0]?.clientX ?? null;
    sidebarTouchStartYRef.current = event.touches[0]?.clientY ?? null;
    sidebarSwipeHandledRef.current = false;
  };

  const handleSidebarTouchMove = (
    event: TouchEvent<HTMLElement>,
    action: "hide" | "show"
  ) => {
    if (sidebarSwipeHandledRef.current) {
      return;
    }

    const startX = sidebarTouchStartXRef.current;
    const startY = sidebarTouchStartYRef.current;
    const moveX = event.touches[0]?.clientX ?? null;
    const moveY = event.touches[0]?.clientY ?? null;

    if (startX === null || startY === null || moveX === null || moveY === null) {
      return;
    }

    const deltaX = moveX - startX;
    const deltaY = moveY - startY;
    const mostlyHorizontal = Math.abs(deltaX) > Math.abs(deltaY) + 16;
    const passedThreshold = action === "hide" ? deltaX < -42 : deltaX > 42;

    if (mostlyHorizontal && passedThreshold) {
      sidebarSwipeHandledRef.current = true;
      onDesktopHiddenChange?.(action === "hide");
    }
  };

  const handleSidebarTouchEnd = (
    event: TouchEvent<HTMLElement>,
    action: "hide" | "show"
  ) => {
    const startX = sidebarTouchStartXRef.current;
    const startY = sidebarTouchStartYRef.current;
    sidebarTouchStartXRef.current = null;
    sidebarTouchStartYRef.current = null;

    if (sidebarSwipeHandledRef.current) {
      return;
    }

    const endX = event.changedTouches[0]?.clientX ?? null;
    const endY = event.changedTouches[0]?.clientY ?? null;

    if (startX === null || startY === null || endX === null || endY === null) {
      return;
    }

    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const mostlyHorizontal = Math.abs(deltaX) > Math.abs(deltaY) + 16;
    const passedThreshold = action === "hide" ? deltaX < -56 : deltaX > 56;

    if (mostlyHorizontal && passedThreshold) {
      onDesktopHiddenChange?.(action === "hide");
    }
  };

  return (
    <>
      <nav
        aria-label="Primary"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`app-nav fixed left-2 right-2 z-30 mx-auto grid max-w-[34rem] grid-cols-5 gap-0.5 rounded-[1.55rem] border-[1.5px] border-[var(--nav-shell-border)] bg-[var(--nav-shell-bg)] p-1.5 shadow-[var(--nav-shell-shadow)] backdrop-blur-xl transition-transform duration-300 md:hidden ${mobileHidden ? "translate-y-[115%]" : "translate-y-0"}`}
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        {tabs.map((tab) => {
          const active = isActive(pathname, tab);
          return <MobileNavItem key={tab.href} tab={tab} active={active} />;
        })}
      </nav>

      {mobileHidden ? (
        <button
          type="button"
          aria-label="Show navigation"
          onClick={() => setMobileHidden(false)}
          className="fixed inset-x-0 z-30 mx-auto flex h-8 w-28 items-center justify-center rounded-t-[1.4rem] border border-b-0 border-[var(--nav-shell-border)] bg-[var(--nav-shell-bg)] text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted shadow-[var(--nav-shell-shadow)] backdrop-blur-xl md:hidden"
          style={{ bottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          Show nav
        </button>
      ) : null}

      {desktopHidden ? (
        <>
          <div
            aria-hidden="true"
            onTouchStart={handleSidebarTouchStart}
            onTouchMove={(event) => handleSidebarTouchMove(event, "show")}
            onTouchEnd={(event) => handleSidebarTouchEnd(event, "show")}
            className="fixed inset-y-0 left-0 z-30 hidden w-8 touch-pan-y md:block"
          />
          <button
            type="button"
            aria-label="Show sidebar"
            title="Show sidebar"
            onClick={() => onDesktopHiddenChange?.(false)}
            className="app-nav fixed left-0 top-1/2 z-40 hidden h-14 w-9 -translate-y-1/2 items-center justify-center rounded-r-[1.15rem] border border-l-0 border-[var(--nav-shell-border)] bg-[var(--nav-shell-bg)] text-text-secondary shadow-[var(--nav-shell-shadow)] backdrop-blur-xl transition duration-fast hover:w-10 hover:text-text-primary md:flex"
          >
            <SidebarToggleIcon direction="show" />
          </button>
        </>
      ) : null}

      <nav
        aria-label="Primary"
        onTouchStart={handleSidebarTouchStart}
        onTouchMove={(event) => handleSidebarTouchMove(event, "hide")}
        onTouchEnd={(event) => handleSidebarTouchEnd(event, "hide")}
        className={`app-nav fixed inset-y-4 left-4 z-30 hidden w-[5rem] flex-col rounded-[1.7rem] border-[1.5px] border-[var(--nav-shell-border)] bg-[var(--nav-shell-bg)] p-2 shadow-[var(--nav-shell-shadow)] backdrop-blur-xl transition duration-300 md:flex lg:w-64 ${
          desktopHidden ? "pointer-events-none -translate-x-[calc(100%+1.5rem)] opacity-0" : "translate-x-0 opacity-100"
        }`}
      >
        <div className="flex flex-col items-center gap-2 border-b border-[var(--color-border)] px-1 pb-3 pt-2 lg:flex-row lg:justify-between lg:px-2">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark size="md" />
            <div className="hidden min-w-0 lg:block">
              <div className="text-base font-semibold text-text-primary">Jami</div>
              <div className="mt-0.5 truncate text-xs text-text-muted">
                Learning loop
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Hide sidebar"
            title="Hide sidebar"
            onClick={() => onDesktopHiddenChange?.(true)}
            className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-[0.95rem] border border-[var(--color-border)] bg-[var(--nav-hover-bg)] text-text-muted transition duration-fast hover:border-[var(--nav-active-border)] hover:text-text-primary [&>svg]:block"
          >
            <SidebarToggleIcon direction="hide" />
          </button>
        </div>

        <div className="app-sidebar-scroll flex flex-1 flex-col overflow-y-auto py-3 pl-0.5 pr-1.5">
          <div className="hidden px-3 pb-2 lg:block">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-text-muted">
              Study
            </div>
            <div className="mt-1 text-[0.72rem] leading-4 text-text-muted">
              Learn, practice, reflect
            </div>
          </div>
          <div className="space-y-1">
            {tabs.map((tab) => {
              const active = isActive(pathname, tab);
              return (
                <DesktopNavItem key={tab.href} tab={tab} active={active} />
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
