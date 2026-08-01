"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Source } from "@/lib/material/sources";
import { filterSources, resolveSelected } from "@/lib/material/source-selectors";
import {
  buildLibraryBrowserSearch,
  getLibraryBrowserStateFromSearch,
  type LibrarySourceStatusFilter,
  type LibrarySourceTypeFilter,
} from "@/lib/study/library-navigation";

export type LibraryMobileTab = "sources" | "source";

export type LibraryBrowserController = {
  sourceCount: number;
  filteredSources: Source[];
  selectedSource: Source | null;
  selectedSourceId: string | null;
  searchTerm: string;
  folderFilter: string;
  typeFilter: LibrarySourceTypeFilter;
  statusFilter: LibrarySourceStatusFilter;
  mobileTab: LibraryMobileTab;
  activeFilterCount: number;
  setSearchTerm: (value: string) => void;
  setFolderFilter: (value: string) => void;
  setTypeFilter: (value: LibrarySourceTypeFilter) => void;
  setStatusFilter: (value: LibrarySourceStatusFilter) => void;
  selectSource: (sourceId: string) => void;
  showSourceList: () => void;
  clearFilters: () => void;
};

/**
 * Owns Library navigation state: filtering, selected-source fallback, mobile
 * pane navigation, and URL synchronisation. The page only supplies the loaded
 * sources and composes the selected source into the surrounding workflows.
 */
export function useLibraryBrowser(
  sources: Source[],
  loading: boolean,
  onSelectionChange?: () => void
): LibraryBrowserController {
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<LibraryMobileTab>("sources");
  const [searchTerm, setSearchTerm] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [typeFilter, setTypeFilter] =
    useState<LibrarySourceTypeFilter>("all");
  const [statusFilter, setStatusFilter] =
    useState<LibrarySourceStatusFilter>("active");
  const [urlStateReady, setUrlStateReady] = useState(false);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const effectiveSelectionRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  const noteEffectiveSelection = useCallback((sourceId: string | null) => {
    if (effectiveSelectionRef.current === undefined) {
      effectiveSelectionRef.current = sourceId;
      return;
    }
    if (effectiveSelectionRef.current === sourceId) return;
    effectiveSelectionRef.current = sourceId;
    onSelectionChangeRef.current?.();
  }, []);

  useEffect(() => {
    const applyUrlState = () => {
      const state = getLibraryBrowserStateFromSearch(window.location.search);
      setSearchTerm(state.search);
      setFolderFilter(state.folderId);
      setTypeFilter(state.type);
      setStatusFilter(state.status);
      setSelectedSourceId(state.sourceId || null);
      setMobileTab(state.sourceId ? "source" : "sources");
      setUrlStateReady(true);
    };

    applyUrlState();
    window.addEventListener("popstate", applyUrlState);
    return () => window.removeEventListener("popstate", applyUrlState);
  }, []);

  useEffect(() => {
    if (!urlStateReady) return;
    const nextSearch = buildLibraryBrowserSearch(window.location.search, {
      search: searchTerm,
      folderId: folderFilter,
      type: typeFilter,
      recent: false,
      status: statusFilter,
      sourceId: selectedSourceId ?? "",
    });
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [
    folderFilter,
    searchTerm,
    selectedSourceId,
    statusFilter,
    typeFilter,
    urlStateReady,
  ]);

  const filteredSources = useMemo(
    () =>
      filterSources(sources, {
        search: searchTerm,
        folderId: folderFilter,
        type: typeFilter,
        status: statusFilter,
      }),
    [folderFilter, searchTerm, sources, statusFilter, typeFilter]
  );
  const selectedSource = useMemo(
    () => resolveSelected(filteredSources, selectedSourceId),
    [filteredSources, selectedSourceId]
  );

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      noteEffectiveSelection(selectedSource?.id ?? null);
      if (selectedSourceId && selectedSourceId !== selectedSource?.id) {
        setSelectedSourceId(selectedSource?.id ?? null);
      }
      if (!selectedSource) setMobileTab("sources");
    });
    return () => {
      cancelled = true;
    };
  }, [loading, noteEffectiveSelection, selectedSource, selectedSourceId]);

  const activeFilterCount =
    Number(Boolean(folderFilter)) +
    Number(typeFilter !== "all") +
    Number(statusFilter !== "active");

  return {
    sourceCount: sources.length,
    filteredSources,
    selectedSource,
    selectedSourceId,
    searchTerm,
    folderFilter,
    typeFilter,
    statusFilter,
    mobileTab,
    activeFilterCount,
    setSearchTerm,
    setFolderFilter,
    setTypeFilter,
    setStatusFilter,
    selectSource: (sourceId) => {
      noteEffectiveSelection(sourceId);
      setSelectedSourceId(sourceId);
      setMobileTab("source");
    },
    showSourceList: () => setMobileTab("sources"),
    clearFilters: () => {
      setSearchTerm("");
      setFolderFilter("");
      setTypeFilter("all");
      setStatusFilter("active");
    },
  };
}
