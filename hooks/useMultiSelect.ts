"use client";

import {
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  addIdsToSelection,
  selectIdRange,
  toggleIdSelection,
} from "@/lib/app/multi-select";

type UseMultiSelectOptions = {
  /** Ids in display order, so a shift-click can select the run between two. */
  visibleIds: string[];
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  disabled?: boolean;
};

export function useMultiSelect({
  visibleIds,
  selectedIds,
  setSelectedIds,
  disabled = false,
}: UseMultiSelectOptions) {
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rangeAnchorIdRef = useRef<string | null>(null);

  const selectVisible = useCallback(() => {
    setSelectedIds((prev) => addIdsToSelection(prev, visibleIds));
  }, [setSelectedIds, visibleIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    rangeAnchorIdRef.current = null;
  }, [setSelectedIds]);

  const handleCheckboxClick = useCallback(
    (id: string, event: MouseEvent<HTMLInputElement>) => {
      if (disabled) return;

      if (event.shiftKey) {
        setSelectedIds((prev) =>
          selectIdRange(prev, visibleIds, rangeAnchorIdRef.current, id)
        );
      } else {
        setSelectedIds((prev) => toggleIdSelection(prev, id));
      }

      rangeAnchorIdRef.current = id;
    },
    [disabled, setSelectedIds, visibleIds]
  );

  return {
    selectedIdSet,
    selectVisible,
    clearSelection,
    handleCheckboxClick,
  };
}
