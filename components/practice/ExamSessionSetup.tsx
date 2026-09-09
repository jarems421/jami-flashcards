"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/providers/UserProvider";
import { Button, Card, EmptyState, FeedbackBanner, Select, Skeleton } from "@/components/ui";
import type { ExamDifficulty } from "@/lib/practice/exam-questions";
import { examBoardAppliesTo } from "@/lib/practice/exam-questions";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getActiveStudyFolders } from "@/services/study/folders";
import {
  createPastPaperPracticeSession,
  getExamAvailability,
  readCoverageShortage,
  type ExamCoverageShortage,
} from "@/services/study/exam-practice";
import ExamCourseSetup from "@/components/practice/ExamCourseSetup";

const DIFFICULTIES: Array<{ id: ExamDifficulty; label: string; note: string }> = [
  { id: "easy", label: "Easy", note: "Things everyone on the course should know" },
  { id: "medium", label: "Medium", note: "Exam-standard, a few steps of reasoning" },
  { id: "hard", label: "Hard", note: "The ones that separate the top grades" },
];

const MAX_QUESTIONS = 20;

function totalOf(mix: Record<ExamDifficulty, number>) {
  return mix.easy + mix.medium + mix.hard;
}

export default function ExamSessionSetup({
  initialFolderId = "",
  originNotebookId,
}: {
  initialFolderId?: string;
  originNotebookId?: string;
}) {
  const { user } = useUser();
  const router = useRouter();
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [folderId, setFolderId] = useState(initialFolderId);
  const [mix, setMix] = useState<Record<ExamDifficulty, number>>({ easy: 2, medium: 3, hard: 0 });
  // Keyed by folder so switching folders shows "checking" without an effect
  // reaching back in to clear it.
  const [availability, setAvailability] = useState<{
    folderId: string;
    counts: Record<ExamDifficulty, number>;
    /** The count stopped at a session's worth; there are more behind it. */
    hasMore: Record<ExamDifficulty, boolean>;
  } | null>(null);
  const [topics, setTopics] = useState<Array<{ id: string; label: string }>>([]);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [shortage, setShortage] = useState<ExamCoverageShortage | null>(null);
  const [error, setError] = useState("");
  const [courseRevision, setCourseRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void getActiveStudyFolders(user.uid)
      .then((items) => {
        if (!active) return;
        const eligible = items.filter((folder) => examBoardAppliesTo(folder.studyLevel));
        setFolders(eligible);
        setFolderId((current) => current || eligible[0]?.id || "");
      })
      .catch(() => setError("Your folders could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [user.uid]);

  useEffect(() => {
    if (!folderId) return;
    let active = true;
    void getExamAvailability(folderId, topicIds)
      .then((result) => {
        if (!active) return;
        setAvailability({ folderId, counts: result.counts, hasMore: result.hasMore });
        setTopics(result.topics);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Question availability could not be loaded.");
        }
      });
    return () => {
      active = false;
    };
  }, [courseRevision, folderId, topicIds]);

  const counts = availability?.folderId === folderId ? availability.counts : null;
  const hasMore = availability?.folderId === folderId ? availability.hasMore : null;
  const total = totalOf(mix);
  const selectedFolder = folders.find((folder) => folder.id === folderId);
  const ready = Boolean(folderId && selectedFolder?.examCourse && total > 0);

  const change = (difficulty: ExamDifficulty, delta: number) => {
    setShortage(null);
    setMix((current) => {
      if (delta > 0 && totalOf(current) >= MAX_QUESTIONS) return current;
      return { ...current, [difficulty]: Math.max(0, current[difficulty] + delta) };
    });
  };

  /*
   * There is one button, and it starts.
   *
   * A shortage is not something to make a student hunt for in advance: the
   * counts are on screen, and if the bank still cannot fill the mix the server
   * says so in the same round trip, along with what it could supply. Looking
   * for more papers happens behind that answer, not in front of it.
   */
  const start = async (options: { allowGenerated?: boolean; useAvailableOnly?: boolean } = {}) => {
    setStarting(true);
    setError("");
    try {
      const session = await createPastPaperPracticeSession({
        folderId,
        mix,
        topicIds,
        originNotebookId,
        ...options,
      });
      router.push(`/dashboard/practice/questions/${session.id}`);
    } catch (reason) {
      const gap = readCoverageShortage(reason);
      if (gap) setShortage(gap);
      else setError(reason instanceof Error ? reason.message : "This session could not be started.");
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (folders.length === 0) {
    return (
      <EmptyState
        title="No school folders yet"
        description="Past Paper Practice works inside a folder set to GCSE, National 5, Higher or A level. Set a folder's study level and exam course, then come back."
      />
    );
  }

  const missingTotal = shortage
    ? Object.values(shortage.missingByDifficulty).reduce((sum, value) => sum + (value ?? 0), 0)
    : 0;
  const availableTotal = shortage ? totalOf(shortage.availableMix) : 0;

  return (
    <div className="space-y-5">
      {error ? <FeedbackBanner type="error" message={error} onDismiss={() => setError("")} /> : null}

      <Card tone="warm" padding="lg">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
          Past Paper Practice
        </p>
        <h2 className="mt-3 text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          Choose your questions
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-text-muted">
          A short set of real questions, marked one at a time with the official scheme.
        </p>
        <Select
          label="Study folder"
          value={folderId}
          containerClassName="mt-6 max-w-xl"
          onChange={(event) => {
            setFolderId(event.target.value);
            setTopicIds([]);
            setTopics([]);
            setShortage(null);
          }}
        >
          <option value="">Choose a folder</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
              {folder.subject ? ` · ${folder.subject}` : ""}
            </option>
          ))}
        </Select>
      </Card>

      {selectedFolder && !selectedFolder.examCourse ? (
        <ExamCourseSetup
          userId={user.uid}
          folder={selectedFolder}
          onSaved={(updated) => {
            setFolders((current) => current.map((item) => (item.id === updated.id ? updated : item)));
            setCourseRevision((value) => value + 1);
          }}
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        {DIFFICULTIES.map(({ id, label, note }) => (
          <Card key={id} padding="md" className="flex min-h-48 flex-col justify-between">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">{label}</h3>
                <p className="mt-1 text-sm leading-5 text-text-muted">{note}</p>
              </div>
              <span className="shrink-0 rounded-full bg-[var(--color-glass-subtle)] px-2.5 py-1 text-xs font-medium text-text-muted">
                {counts ? `${counts[id]}${hasMore?.[id] ? "+" : ""} ready` : "Checking…"}
              </span>
            </div>
            <div className="mt-6 flex items-center justify-between rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`One fewer ${label.toLowerCase()} question`}
                disabled={mix[id] === 0}
                onClick={() => change(id, -1)}
              >
                −
              </Button>
              <span className="min-w-12 text-center text-2xl font-semibold tabular-nums text-text-primary">
                {mix[id]}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`One more ${label.toLowerCase()} question`}
                disabled={total >= MAX_QUESTIONS}
                onClick={() => change(id, 1)}
              >
                +
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {topics.length > 0 ? (
        <details className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-text-primary">
            Narrow to topics{topicIds.length ? ` · ${topicIds.length} selected` : ""}
          </summary>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((topic) => (
              <label
                key={topic.id}
                className="flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-sm text-text-secondary transition hover:bg-[var(--color-glass-strong)]"
              >
                <input
                  type="checkbox"
                  checked={topicIds.includes(topic.id)}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                  onChange={() =>
                    setTopicIds((current) =>
                      current.includes(topic.id)
                        ? current.filter((id) => id !== topic.id)
                        : [...current, topic.id]
                    )
                  }
                />
                {topic.label}
              </label>
            ))}
          </div>
        </details>
      ) : null}

      {shortage ? (
        <Card tone="warm" padding="lg">
          <h3 className="text-lg font-semibold text-text-primary">
            {availableTotal > 0
              ? `Only ${availableTotal} matching real question${availableTotal === 1 ? "" : "s"} so far`
              : "No matching real questions yet"}
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-text-secondary">
            Jami is looking for more papers on this course in the background. In the meantime you can
            fill the gap with original Jami-created questions, which are clearly labelled and are not
            taken from a past paper.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button disabled={starting} onClick={() => void start({ allowGenerated: true })}>
              Add {missingTotal} Jami-created question{missingTotal === 1 ? "" : "s"}
            </Button>
            {availableTotal > 0 ? (
              <Button
                variant="secondary"
                disabled={starting}
                onClick={() => void start({ useAvailableOnly: true })}
              >
                Start with the {availableTotal} real one{availableTotal === 1 ? "" : "s"}
              </Button>
            ) : null}
            <Button variant="ghost" disabled={starting} onClick={() => setShortage(null)}>
              Change my mix
            </Button>
          </div>
        </Card>
      ) : null}

      <Card padding="md" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {total} question{total === 1 ? "" : "s"}
          </p>
          <p className="mt-1 max-w-md text-sm leading-5 text-text-muted">
            Your answer and your working are both saved and both sent to Jami for marking.
          </p>
        </div>
        <Button size="lg" disabled={!ready || starting} onClick={() => void start()}>
          {starting ? "Starting…" : "Start practice"}
        </Button>
      </Card>
    </div>
  );
}
