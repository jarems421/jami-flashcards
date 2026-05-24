"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type TouchEvent, useEffect, useRef, useState } from "react";

type TabGroup = "loop" | "support";

type Tab = {
  href: string;
  label: string;
  mobileLabel?: string;
  description: string;
  group: TabGroup;
  /** SVG path data for the icon (24x24 viewBox). */
  icon: string;
};

const tabs: Tab[] = [
  {
    href: "/dashboard",
    label: "Home",
    mobileLabel: "Home",
    description: "Start point",
    group: "loop",
    icon: "M11.47 3.841a.75.75 0 011.06 0l8.69 8.69a.75.75 0 01-.53 1.28h-1.44v7.44a.75.75 0 01-.75.75h-3a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-1.5a.75.75 0 00-.75.75v4.5a.75.75 0 01-.75.75h-3a.75.75 0 01-.75-.75v-7.44H5.31a.75.75 0 01-.53-1.28l8.69-8.69z",
  },
  {
    href: "/dashboard/study",
    label: "Learn",
    description: "Review flashcards",
    group: "loop",
    icon: "M3.75 5.25A2.25 2.25 0 016 3h8.25a2.25 2.25 0 011.591.659l3.5 3.5A2.25 2.25 0 0120 8.75V18A3 3 0 0117 21H7a3 3 0 01-3-3V5.25zm5.47 4.22a.75.75 0 00-1.06 1.06l2.09 2.09a.75.75 0 001.06 0l4.47-4.47a.75.75 0 10-1.06-1.06l-3.94 3.94-1.56-1.56z",
  },
  {
    href: "/dashboard/practise",
    label: "Practise",
    description: "Try questions",
    group: "loop",
    icon: "M4.5 4.75A2.75 2.75 0 017.25 2h9.5a2.75 2.75 0 012.75 2.75v14.5A2.75 2.75 0 0116.75 22h-9.5a2.75 2.75 0 01-2.75-2.75V4.75zm4 2a.75.75 0 000 1.5h7a.75.75 0 000-1.5h-7zm0 4a.75.75 0 000 1.5h4a.75.75 0 000-1.5h-4zm-.53 4.72a.75.75 0 011.06 0l1.22 1.22 3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0l-1.75-1.75a.75.75 0 010-1.06z",
  },
  {
    href: "/dashboard/progress",
    label: "Progress",
    description: "See weak topics",
    group: "loop",
    icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  },
  {
    href: "/dashboard/decks",
    label: "Decks",
    description: "Manage card sets",
    group: "support",
    icon: "M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026-.383-1.178-1.47-2.026-2.75-2.026h-11A2.75 2.75 0 003.75 9.776zM2.25 12.75a2.75 2.75 0 012.75-2.75h14a2.75 2.75 0 012.75 2.75v6.5a2.75 2.75 0 01-2.75 2.75H5a2.75 2.75 0 01-2.75-2.75v-6.5zM6.5 7.25V5.5A2.75 2.75 0 019.25 2.75h5.5A2.75 2.75 0 0117.5 5.5v1.75",
  },
  {
    href: "/dashboard/cards",
    label: "Cards",
    description: "Search all cards",
    group: "support",
    icon: "M4.5 4.75A2.75 2.75 0 017.25 2h7.25c.73 0 1.43.29 1.945.805l2.75 2.75c.516.516.805 1.215.805 1.945v11.75A2.75 2.75 0 0117.25 22h-10A2.75 2.75 0 014.5 19.25V4.75zm4 4a.75.75 0 000 1.5h7a.75.75 0 000-1.5h-7zm0 4a.75.75 0 000 1.5h7a.75.75 0 000-1.5h-7zm0 4a.75.75 0 000 1.5h4a.75.75 0 000-1.5h-4z",
  },
  {
    href: "/dashboard/library",
    label: "Library",
    description: "Study sources",
    group: "support",
    icon: "M4.5 4.75A2.75 2.75 0 017.25 2h9.5a2.75 2.75 0 012.75 2.75v14.5A2.75 2.75 0 0116.75 22h-9.5a2.75 2.75 0 01-2.75-2.75V4.75zm3.25 2.5a.75.75 0 000 1.5h8.5a.75.75 0 000-1.5h-8.5zm0 4a.75.75 0 000 1.5h8.5a.75.75 0 000-1.5h-8.5zm0 4a.75.75 0 000 1.5h5.5a.75.75 0 000-1.5h-5.5z",
  },
  {
    href: "/dashboard/goals",
    label: "Goals",
    description: "Study targets",
    group: "support",
    icon: "M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z",
  },
  {
    href: "/dashboard/constellation",
    label: "Stars",
    description: "Rewards",
    group: "support",
    icon: "M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005z",
  },
  {
    href: "/dashboard/profile",
    label: "Account",
    description: "Settings",
    group: "support",
    icon: "M7.5 6.5C7.5 4.015 9.515 2 12 2s4.5 2.015 4.5 4.5S14.485 11 12 11 7.5 8.985 7.5 6.5zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z",
  },
];

const navGroups: { id: TabGroup; label: string; helper: string }[] = [
  { id: "loop", label: "Learning loop", helper: "Memory, practice, repair, evidence" },
  { id: "support", label: "Workspace", helper: "Organise, goals, rewards" },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname.startsWith(href);
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
      className={`group relative flex min-h-[3.65rem] items-center justify-center gap-3 rounded-[1.2rem] px-2.5 py-2 text-left transition duration-fast ease-spring lg:justify-start lg:px-3.5 ${
        active
          ? "border border-[var(--nav-active-border)] bg-[var(--nav-active-bg)] text-[var(--nav-active-text)] shadow-[var(--nav-active-shadow)]"
          : "border border-transparent text-text-muted hover:border-[var(--color-border)] hover:bg-[var(--nav-hover-bg)] hover:text-text-primary"
      }`}
    >
      {active ? (
        <span className="absolute inset-y-2 left-0 hidden w-1 rounded-r-full bg-warm-accent lg:block" />
      ) : null}
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[1.05rem] border transition duration-fast ${
          active
            ? "border-warm-border bg-warm-glow text-warm-accent"
            : "border-white/8 bg-white/[0.035] text-text-muted group-hover:border-white/14 group-hover:text-white"
        }`}
      >
        <NavIcon tab={tab} active={active} />
      </span>
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
      className={`relative flex min-h-[3.25rem] min-w-[4.35rem] flex-shrink-0 snap-center flex-col items-center justify-center gap-1 rounded-[1.05rem] px-2 text-[10px] leading-tight transition duration-fast ease-spring ${
        active
          ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-text)] shadow-[var(--nav-active-shadow)]"
          : "text-text-muted active:text-text-primary"
      }`}
    >
      {active ? <span className="absolute inset-x-5 top-1 h-0.5 rounded-full bg-warm-accent" /> : null}
      <NavIcon tab={tab} active={active} />
      <span className={active ? "font-semibold" : "font-medium"}>
        {tab.mobileLabel ?? tab.label}
      </span>
    </Link>
  );
}

export default function TabBar() {
  const pathname = usePathname();
  const mobileNavRef = useRef<HTMLElement>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const swipeHandledRef = useRef(false);
  const [mobileHidden, setMobileHidden] = useState(false);

  useEffect(() => {
    const nav = mobileNavRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>("[aria-current='page']");
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [pathname]);

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

  return (
    <>
      <nav
        ref={mobileNavRef}
        aria-label="Primary"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`app-nav fixed left-3 right-3 z-30 mx-auto flex max-w-[31rem] snap-x snap-mandatory gap-1 overflow-x-auto rounded-[1.55rem] border-[1.5px] border-[var(--nav-shell-border)] bg-[var(--nav-shell-bg)] p-1.5 shadow-[var(--nav-shell-shadow)] backdrop-blur-xl scrollbar-hide transition-transform duration-300 md:hidden ${mobileHidden ? "translate-y-[115%]" : "translate-y-0"}`}
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        {tabs.map((tab) => {
          const active = isActive(pathname, tab.href);
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

      <nav
        aria-label="Primary"
        className="app-nav fixed inset-y-4 left-4 z-30 hidden w-[5.75rem] flex-col rounded-[1.8rem] border-[1.5px] border-[var(--nav-shell-border)] bg-[var(--nav-shell-bg)] p-2.5 shadow-[var(--nav-shell-shadow)] backdrop-blur-xl md:flex lg:w-72"
      >
        <div className="flex items-center justify-center gap-3 border-b border-white/[0.07] px-1 pb-4 pt-2 lg:justify-start lg:px-2">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.1rem] border border-warm-border bg-warm-glow text-sm font-semibold text-warm-accent shadow-[0_12px_24px_rgba(7,12,24,0.18)]">
            J
          </div>
          <div className="hidden min-w-0 lg:block">
            <div className="text-base font-semibold text-white">Jami</div>
            <div className="mt-0.5 truncate text-xs text-text-muted">
              Learning loop
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto scrollbar-hide px-0.5 py-4">
          {navGroups.map((group) => (
            <section key={group.id} className="space-y-2">
              <div className="hidden px-3 lg:block">
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-text-muted">
                  {group.label}
                </div>
                <div className="mt-1 text-[0.72rem] leading-4 text-text-muted">
                  {group.helper}
                </div>
              </div>
              <div className="space-y-1.5">
                {tabs
                  .filter((tab) => tab.group === group.id)
                  .map((tab) => {
                    const active = isActive(pathname, tab.href);
                    return (
                      <DesktopNavItem
                        key={tab.href}
                        tab={tab}
                        active={active}
                      />
                    );
                  })}
              </div>
            </section>
          ))}
        </div>
      </nav>
    </>
  );
}
