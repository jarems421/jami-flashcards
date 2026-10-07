"use client";

import { useEffect, useState } from "react";
import {
  acknowledgeAiPrivacyNotice,
  hasAcknowledgedAiPrivacyNotice,
} from "@/services/ai/ai-privacy-notice";

/**
 * Whether to show how Jami processes a request, checked each time the chat
 * opens until the student has said they understand.
 *
 * Shown when the check fails too: a notice seen twice is better than one
 * never seen.
 */
export function useAiPrivacyNotice(open: boolean) {
  const [showAiNotice, setShowAiNotice] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void hasAcknowledgedAiPrivacyNotice(controller.signal)
      .then((acknowledged) => setShowAiNotice(!acknowledged))
      .catch(() => setShowAiNotice(true));
    return () => controller.abort();
  }, [open]);

  const dismissAiNotice = () => {
    setShowAiNotice(false);
    void acknowledgeAiPrivacyNotice().catch(() => setShowAiNotice(true));
  };

  return { showAiNotice, dismissAiNotice };
}
