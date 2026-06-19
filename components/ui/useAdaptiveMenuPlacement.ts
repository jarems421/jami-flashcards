"use client";

import { useCallback, useState, type SyntheticEvent } from "react";

export function useAdaptiveMenuPlacement(menuHeight = 160) {
  const [openUpward, setOpenUpward] = useState(false);

  const handleToggle = useCallback(
    (event: SyntheticEvent<HTMLDetailsElement>) => {
      const details = event.currentTarget;
      if (!details.open) return;

      const triggerBounds = details.getBoundingClientRect();
      const spaceBelow = window.innerHeight - triggerBounds.bottom;
      const spaceAbove = triggerBounds.top;
      setOpenUpward(
        spaceBelow < menuHeight + 12 && spaceAbove > spaceBelow
      );
    },
    [menuHeight]
  );

  return {
    handleToggle,
    menuPositionClass: openUpward ? "bottom-12" : "top-12",
  };
}
