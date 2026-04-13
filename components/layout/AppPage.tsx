"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import AppTopBar from "@/components/layout/AppTopBar";

type AppPageWidth = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "study";

type AppPageProps = {
  title: string;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
  children: ReactNode;
  width?: AppPageWidth;
  className?: string;
  contentClassName?: string;
  topBarClassName?: string;
};

const widthClasses: Record<AppPageWidth, string> = {
  sm: "max-w-2xl",
  md: "max-w-3xl",
  lg: "max-w-4xl",
  xl: "max-w-5xl",
  "2xl": "max-w-6xl",
  "3xl": "max-w-7xl",
  study: "max-w-[88rem]",
};

const TOP_BAR_HIDE_OFFSET = 12;

export default function AppPage({
  title,
  backHref,
  backLabel,
  action,
  children,
  width = "xl",
  className = "",
  contentClassName = "",
  topBarClassName = "",
}: AppPageProps) {
  const [hidden, setHidden] = useState(false);

  const handleScroll = useCallback(() => {
    setHidden(window.scrollY > TOP_BAR_HIDE_OFFSET);
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  return (
    <main
      data-app-surface="true"
      className={`min-h-screen px-5 pb-10 pt-3 text-white sm:px-6 lg:px-8 ${className}`}
    >
      <div className={`mx-auto ${widthClasses[width]}`}>
        <div
          className={`sticky top-0 z-40 mb-6 transition-transform duration-150 ease-out ${hidden ? "-translate-y-full" : "translate-y-0"} ${topBarClassName}`}
        >
          <AppTopBar
            title={title}
            backHref={backHref}
            backLabel={backLabel}
            action={action}
          />
        </div>
        <div className={contentClassName}>{children}</div>
      </div>
    </main>
  );
}
