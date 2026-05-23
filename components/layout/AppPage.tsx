"use client";

import { type ReactNode } from "react";
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
  return (
    <main
      data-app-surface="true"
      className={`min-h-screen px-4 pb-32 pt-3 text-white sm:px-6 sm:pb-14 sm:pt-4 lg:px-10 ${className}`}
    >
      <div className={`mx-auto ${widthClasses[width]}`}>
        <div
          className={`sticky top-0 z-40 mb-5 sm:mb-7 ${topBarClassName}`}
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
