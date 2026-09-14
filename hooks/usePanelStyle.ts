"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PANEL_STYLE_EVENT,
  readPanelStyle,
  savePanelStyle,
  type PanelStyle,
} from "@/lib/app/panel-style";

/** The device's panel style, kept in step with other tabs and components. */
export function usePanelStyle() {
  const [panelStyle, setPanelStyleState] = useState<PanelStyle>("glass");

  useEffect(() => {
    const sync = () => setPanelStyleState(readPanelStyle());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(PANEL_STYLE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(PANEL_STYLE_EVENT, sync);
    };
  }, []);

  const setPanelStyle = useCallback((value: PanelStyle) => {
    setPanelStyleState(value);
    savePanelStyle(value);
  }, []);

  return [panelStyle, setPanelStyle] as const;
}
