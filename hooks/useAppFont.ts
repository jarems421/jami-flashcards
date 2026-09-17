"use client";

import { useCallback, useEffect, useState } from "react";
import {
  APP_FONT_EVENT,
  DEFAULT_APP_FONT,
  readAppFont,
  saveAppFont,
  type AppFontId,
} from "@/lib/app/app-font";

/** The face Jami is set in on this device, kept in step with other tabs. */
export function useAppFont() {
  const [font, setFontState] = useState<AppFontId>(DEFAULT_APP_FONT);

  useEffect(() => {
    const sync = () => setFontState(readAppFont());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(APP_FONT_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(APP_FONT_EVENT, sync);
    };
  }, []);

  const setFont = useCallback((value: AppFontId) => {
    setFontState(value);
    saveAppFont(value);
  }, []);

  return [font, setFont] as const;
}
