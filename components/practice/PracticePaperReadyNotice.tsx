"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { PracticePaperJob } from "@/lib/practice/practice-papers";
import {
  acknowledgePracticePaperJob,
  getRecentPracticePaperJobs,
} from "@/services/ai/practice-papers";

export default function PracticePaperReadyNotice() {
  const router = useRouter();
  const [job, setJob] = useState<PracticePaperJob | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const jobs = await getRecentPracticePaperJobs();
        if (!active) return;
        setJob(jobs.find((candidate) =>
          candidate.status === "ready" && candidate.readyUnread
        ) ?? null);
      } catch {
        // A status notice is helpful but should never interrupt navigation.
      }
      if (active) timer = setTimeout(() => void check(), 15_000);
    };
    void check();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!job) return null;
  const dismiss = async () => {
    setJob(null);
    await acknowledgePracticePaperJob(job.id).catch(() => undefined);
  };
  const open = async () => {
    await acknowledgePracticePaperJob(job.id).catch(() => undefined);
    setJob(null);
    router.push(`/dashboard/notebooks/${encodeURIComponent(job.paperId)}`);
  };
  return (
    <aside
      role="status"
      className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-accent/30 bg-[var(--color-surface-panel)] p-4 shadow-e3"
    >
      <p className="text-sm font-semibold text-text-primary">Your practice paper is ready</p>
      <p className="mt-1 truncate text-xs text-text-muted">{job.title}</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => void dismiss()}>
          Dismiss
        </Button>
        <Button type="button" size="sm" onClick={() => void open()}>
          Open paper
        </Button>
      </div>
    </aside>
  );
}
