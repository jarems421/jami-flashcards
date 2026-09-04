"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { trackRouteView } from "@/services/analytics/client";

/**
 * Records which part of the app somebody opened.
 *
 * Mounted once in the dashboard layout rather than added to each page, so all
 * eleven destinations are covered by one component and a page added later is
 * measured without anyone remembering to instrument it.
 *
 * Renders nothing and never blocks navigation.
 */
export default function RouteAnalytics() {
  const pathname = usePathname();
  const lastRecorded = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastRecorded.current === pathname) return;
    lastRecorded.current = pathname;
    trackRouteView(pathname);
  }, [pathname]);

  return null;
}
