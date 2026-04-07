"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

type Tab = {
  href: string;
  label: string;
  /** SVG path data for the icon (24x24 viewBox). */
  icon: string;
};

const tabs: Tab[] = [
  {
    href: "/dashboard",
    label: "Home",
    icon: "M11.47 3.841a.75.75 0 011.06 0l8.69 8.69a.75.75 0 01-.53 1.28h-1.44v7.44a.75.75 0 01-.75.75h-3a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-1.5a.75.75 0 00-.75.75v4.5a.75.75 0 01-.75.75h-3a.75.75 0 01-.75-.75v-7.44H5.31a.75.75 0 01-.53-1.28l8.69-8.69z",
  },
  {
    href: "/dashboard/decks",
    label: "Decks",
    icon: "M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026-.383-1.178-1.47-2.026-2.75-2.026h-11A2.75 2.75 0 003.75 9.776zM2.25 12.75a2.75 2.75 0 012.75-2.75h14a2.75 2.75 0 012.75 2.75v6.5a2.75 2.75 0 01-2.75 2.75H5a2.75 2.75 0 01-2.75-2.75v-6.5zM6.5 7.25V5.5A2.75 2.75 0 019.25 2.75h5.5A2.75 2.75 0 0117.5 5.5v1.75",
  },
  {
    href: "/dashboard/cards",
    label: "Cards",
    icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z",
  },
  {
    href: "/dashboard/goals",
    label: "Goals",
    icon: "M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z",
  },
  {
    href: "/dashboard/stats",
    label: "Stats",
    icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  },
  {
    href: "/dashboard/constellation",
    label: "Cosmos",
    icon: "M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005z",
  },
  {
    href: "/dashboard/profile",
    label: "Profile",
    icon: "M7.5 6.5C7.5 4.015 9.515 2 12 2s4.5 2.015 4.5 4.5S14.485 11 12 11 7.5 8.985 7.5 6.5zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z",
  },
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
      className={`h-6 w-6 ${active ? "opacity-100" : "opacity-80"}`}
    >
      <path fillRule="evenodd" clipRule="evenodd" d={tab.icon} />
    </svg>
  );
}

export default function TabBar() {
  const pathname = usePathname();
  const mobileNavRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = mobileNavRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>("[aria-current='page']");
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [pathname]);

  return (
    <>
      {/* Bottom tab bar (phone) */}
      <nav
        ref={mobileNavRef}
        aria-label="Primary"
        className="app-nav fixed inset-x-3 z-30 flex snap-x snap-mandatory overflow-x-auto scrollbar-hide rounded-[2.6rem] border-[1.5px] border-white/[0.18] bg-[linear-gradient(180deg,rgba(28,18,48,0.94),rgba(18,11,34,0.94))] p-2.5 shadow-[0_18px_42px_rgba(7,2,22,0.3)] backdrop-blur-xl md:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        {tabs.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[56px] min-w-[4.2rem] flex-shrink-0 snap-center flex-col items-center justify-center gap-1 rounded-[1.5rem] px-2 text-[11px] transition duration-fast ease-spring ${
                active
                  ? "scale-[1.02] text-white"
                  : "text-text-muted active:text-white"
              }`}
            >
              <div
                className={`rounded-xl px-2.5 py-1.5 ${
                  active
                    ? "border border-white/14 bg-[linear-gradient(180deg,rgba(255,228,244,0.16),rgba(157,99,223,0.24))] shadow-[0_14px_24px_rgba(157,99,223,0.24)]"
                    : ""
                }`}
              >
                <NavIcon tab={tab} active={active} />
              </div>
              <span className={active ? "font-semibold" : "font-normal"}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Sidebar (iPad / md+) */}
      <nav
        aria-label="Primary"
        className="app-nav fixed inset-y-4 left-4 z-30 hidden w-24 flex-col rounded-[2.4rem] border-[1.5px] border-white/[0.16] bg-[linear-gradient(180deg,rgba(28,18,48,0.94),rgba(18,11,34,0.94))] shadow-[0_20px_42px_rgba(7,2,22,0.3)] backdrop-blur-xl md:flex"
      >
        <div className="flex items-center justify-center border-b border-white/[0.06] px-2 py-4">
          <span className="text-sm font-bold text-warm-accent">
            Jami
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-hide px-2 py-4">
          {tabs.map((tab) => {
            const active = isActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex w-full flex-col items-center gap-0.5 rounded-[1.5rem] px-1 py-3 text-[10px] transition duration-fast ease-spring ${
                  active
                    ? "bg-[linear-gradient(180deg,rgba(255,228,244,0.12),rgba(157,99,223,0.2))] text-white shadow-[0_14px_24px_rgba(157,99,223,0.16)]"
                    : "text-text-muted hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                {active ? (
                  <span className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-warm-accent" />
                ) : null}
                <NavIcon tab={tab} active={active} />
                <span className={active ? "font-semibold" : "font-normal"}>
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
