"use client";

import { useCallback, useState } from "react";
import type { PracticePaperStatus } from "@/lib/practice/practice-papers";

export function usePracticePaperStatus(
  closeAssistant: (open: boolean) => void
) {
  const [status, setStatus] = useState<PracticePaperStatus | null>(null);
  const handleStatusChange = useCallback(
    (nextStatus: PracticePaperStatus | null) => {
      setStatus(nextStatus);
      if (nextStatus === "in_progress" || nextStatus === "submitted") {
        closeAssistant(false);
      }
    },
    [closeAssistant]
  );
  return { practicePaperStatus: status, handlePracticePaperStatusChange: handleStatusChange };
}
