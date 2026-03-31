"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = {
  href: string;
  label: string;
  /** SVG path data for the icon (24×24 viewBox). */
  icon: string;
};

const tabs: Tab[] = [
  {
    href: "/dashboard",
    label: "Home",
    icon: "M3 12l9-8 9 8M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10",
  },
  {
    href: "/dashboard/decks",
    label: "Decks",
    icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
  },
  {
    href: "/dashboard/goals",
    label: "Goals",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    href: "/dashboard/constellation",
    label: "Cosmos",
    icon: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z",
  },
  {
    href: "/dashboard/profile",
    label: "Profile",
    icon: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z",
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
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
    >
      <path d={tab.icon} />
    </svg>
  );
}

export default function TabBar() {
  const pathname = usePathname();

  return (
    <>
      {/* ── Bottom tab bar (phone) ── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface-base/80 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {tabs.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition duration-fast ${
                active
                  ? "text-accent"
                  : "text-text-muted active:text-white"
              }`}
            >
              <div className={`rounded-lg px-2.5 py-1 ${active ? "bg-accent-muted" : ""}`}>
                <NavIcon tab={tab} active={active} />
              </div>
              <span className={active ? "font-semibold" : "font-normal"}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* ── Sidebar (iPad / md+) ── */}
      <nav className="fixed inset-y-0 left-0 z-30 hidden w-20 flex-col border-r border-border bg-surface-base/80 backdrop-blur-md md:flex">
        <div className="flex flex-1 flex-col items-center gap-1 pt-6">
          {tabs.map((tab) => {
            const active = isActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`relative flex w-full flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] transition duration-fast ${
                  active
                    ? "text-accent"
                    : "text-text-muted hover:text-white"
                }`}
              >
                {active && (
                  <span className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-accent" />
                )}
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
