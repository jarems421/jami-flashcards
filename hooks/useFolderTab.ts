"use client";

import { useEffect, useState } from "react";
import {
  buildFolderTabSearch,
  getFolderTabFromSearch,
  type FolderWorkspaceTab,
} from "@/lib/workspace/folder-navigation";

/**
 * The folder tab that is open, kept in the address so a reload or a shared
 * link opens the same one. Choosing a tab replaces the history entry rather
 * than adding one; back and forward still follow it.
 */
export function useFolderTab() {
  const [activeTab, setActiveTab] = useState<FolderWorkspaceTab>(() =>
    typeof window === "undefined" ? "notebooks" : getFolderTabFromSearch(window.location.search)
  );

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(getFolderTabFromSearch(window.location.search));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const selectTab = (tab: FolderWorkspaceTab) => {
    setActiveTab(tab);
    const nextSearch = buildFolderTabSearch(window.location.search, tab);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${nextSearch}${window.location.hash}`
    );
  };

  return { activeTab, selectTab };
}
