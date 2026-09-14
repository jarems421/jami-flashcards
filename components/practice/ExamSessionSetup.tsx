"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/providers/UserProvider";
import { Button, Card, EmptyState, FeedbackBanner, Select, Skeleton } from "@/components/ui";
import OptionSwitch from "@/components/ui/OptionSwitch";
import { examCalculatorChoiceOffered, type ExamCoursePaper } from "@/lib/practice/exam-papers";
import type { ExamCalculatorChoice, ExamDifficulty } from "@/lib/practice/exam-questions";
import { EXAM_SESSION_MAX_QUESTIONS, examBoardAppliesTo } from "@/lib/practice/exam-questions";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getActiveStudyFolders } from "@/services/study/folders";
import {
  createPastPaperPracticeSession,
  getExamAvailability,
  readCoverageShortage,
  type ExamCoverageShortage,
} from "@/services/study/exam-practice";
import ExamCourseSetup from "@/components/practice/ExamCourseSetup";
import ExamGenerationProgress from "@/components/practice/ExamGenerationProgress";
import CreateFolderDialog from "@/components/workspace/CreateFolderDialog";

const DIFFICULTIES: Array<{ id: ExamDifficulty; label: string; note: string }> = [
  { id: "easy", label: "Easy", note: "Things everyone on the course should know" },
  { id: "medium", label: "Medium", note: "Exam-standard, a few steps of reasoning" },
  { id: "hard", label: "Hard", note: "The ones that separate the top grades" },
];

const CALCULATOR_CHOICES: Array<{ value: ExamCalculatorChoice; label: string }> = [
  { value: "any", label: "Either" },
  { value: "non_calculator", label: "Non-calculator" },
  { value: "calculator", label: "Calculator" },
];

const ALL_PAPERS = "all";

const MAX_QUESTIONS = EXAM_SESSION_MAX_QUESTIONS;

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
  /*
   * Which paper, in the words every subject uses for it.
   *
   * Papers split a course by what they examine -- micro and macro economics,
   * different biology topics -- so "Paper 2" is how a student names the half
   * of the course they want. The calculator question is maths's version of
   * the same thing, and it is asked only on a course whose papers carry a
   * calculator rule; the folder that answered yes is remembered so narrowing
   * to one paper does not make the question vanish.
   */
  const [paperId, setPaperId] = useState(ALL_PAPERS);
  const [papers, setPapers] = useState<ExamCoursePaper[]>([]);
  const [calculator, setCalculator] = useState<ExamCalculatorChoice>("any");
  const [calculatorFolderId, setCalculatorFolderId] = useState("");
  const [topics, setTopics] = useState<Array<{ id: string; label: string }>>([]);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [shortage, setShortage] = useState<ExamCoverageShortage | null>(null);
  /** Jami-created questions being written: how many, and since when. */
  const [generating, setGenerating] = useState<{ count: number; startedAt: number } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [courseRevision, setCourseRevision] = useState(0);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);

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
    void getExamAvailability(folderId, topicIds, calculator, paperId === ALL_PAPERS ? [] : [paperId])
      .then((result) => {
        if (!active) return;
        setAvailability({ folderId, counts: result.counts, hasMore: result.hasMore });
        setTopics(result.topics);
        setPapers(result.papers ?? []);
        if (result.calculatorPolicyKnown) setCalculatorFolderId(folderId);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Question availability could not be loaded.");
        }
      });
    return () => {
      active = false;
    };
  }, [calculator, courseRevision, folderId, paperId, topicIds]);

  const counts = availability?.folderId === folderId ? availability.counts : null;
  const hasMore = availability?.folderId === folderId ? availability.hasMore : null;
  const total = totalOf(mix);
  const selectedFolder = folders.find((folder) => folder.id === folderId);
  const ready = Boolean(folderId && selectedFolder?.examCourse && total > 0);
  const showPapers = papers.length > 1;
  const showCalculator = examCalculatorChoiceOffered({
    paperChosen: paperId !== ALL_PAPERS,
    policyKnown: calculatorFolderId === folderId,
    calculatorChosen: calculator !== "any",
  });
  const paperDetails = papers.some((paper) => paper.detail);
  const paperOptions = [
    {
      value: ALL_PAPERS,
      label: "All papers",
      ...(paperDetails ? { detail: "Anything on the course" } : {}),
    },
    ...papers.map((paper) => ({ value: paper.id, label: paper.label, detail: paper.detail })),
  ];

  const selectFolder = (id: string) => {
    setFolderId(id);
    setTopicIds([]);
    setTopics([]);
    setPaperId(ALL_PAPERS);
    setPapers([]);
    setCalculator("any");
    setShortage(null);
  };

  /*
   * A folder made here is practised here. Its level and course are asked as
   * it is created, so a school folder arrives ready to pick; any other level
   * cannot draw exam questions, which is said rather than silently ignored.
   */
  const handleFolderCreated = (folder: StudyFolder) => {
    if (!examBoardAppliesTo(folder.studyLevel)) {
      setNotice(
        `“${folder.name}” was created. Set its level to School, GCSE or A level to practise it here.`
      );
      return;
    }
    setFolders((current) => [folder, ...current.filter((item) => item.id !== folder.id)]);
    selectFolder(folder.id);
  };

  const createFolderDialog = (
    <CreateFolderDialog
      open={createFolderOpen}
      userId={user.uid}
      onClose={() => setCreateFolderOpen(false)}
      onCreated={handleFolderCreated}
    />
  );

  const noticeBanner = notice ? (
    <FeedbackBanner type="success" message={notice} onDismiss={() => setNotice("")} />
  ) : null;

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
  const start = async (
    options: { allowGenerated?: boolean; useAvailableOnly?: boolean; generatedCount?: number } = {}
  ) => {
    const { generatedCount, ...requestOptions } = options;
    setStarting(true);
    setError("");
    if (requestOptions.allowGenerated) {
      setGenerating({ count: generatedCount ?? 0, startedAt: Date.now() });
    }
    try {
      const session = await createPastPaperPracticeSession({
        folderId,
        mix,
        topicIds,
        originNotebookId,
        calculator,
        paperIds: paperId === ALL_PAPERS ? [] : [paperId],
        ...requestOptions,
      });
      // The progress stays up until the session page replaces this one.
      router.push(`/dashboard/practice/questions/${session.id}`);
    } catch (reason) {
      const gap = readCoverageShortage(reason);
      if (gap) setShortage(gap);
      else setError(reason instanceof Error ? reason.message : "This session could not be started.");
      setGenerating(null);
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
      <div className="space-y-5">
        {createFolderDialog}
        {noticeBanner}
        <EmptyState
          title="No school folders yet"
          description="Past Paper Practice works inside a School, GCSE or A level folder. Create one and choose your exam board and course as you go."
          action={
            <Button type="button" onClick={() => setCreateFolderOpen(true)}>
              Create folder
            </Button>
          }
        />
      </div>
    );
  }

  const missingTotal = shortage
    ? Object.values(shortage.missingByDifficulty).reduce((sum, value) => sum + (value ?? 0), 0)
    : 0;
  const availableTotal = shortage ? totalOf(shortage.availableMix) : 0;

  return (
    <div className="space-y-5">
      {createFolderDialog}
      {error ? <FeedbackBanner type="error" message={error} onDismiss={() => setError("")} /> : null}
      {noticeBanner}

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
        <div className="mt-6 flex max-w-xl flex-col gap-2 sm:flex-row sm:items-end">
          <Select
            label="Study folder"
            value={folderId}
            containerClassName="min-w-0 flex-1"
            onChange={(event) => selectFolder(event.target.value)}
          >
            <option value="">Choose a folder</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
                {folder.subject ? ` · ${folder.subject}` : ""}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="secondary"
            className="sm:min-h-[3.25rem]"
            onClick={() => setCreateFolderOpen(true)}
          >
            New folder
          </Button>
        </div>
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

      {selectedFolder?.examCourse && (showPapers || showCalculator) ? (
        <Card padding="md">
          <h3 className="text-lg font-semibold text-text-primary">Which papers?</h3>
          <p className="mt-1 text-sm leading-5 text-text-muted">
            {showPapers
              ? calculatorFolderId === folderId
                ? "Each paper examines a different part of the course and sets whether a calculator is allowed. Practise one, or draw from them all."
                : "Each paper examines a different part of the course. Practise one, or draw from them all."
              : "Practise with or without a calculator."}
          </p>
          {showPapers ? (
            <OptionSwitch
              label="Paper"
              hideLabel
              className="mt-4"
              value={paperId}
              options={paperOptions}
              columns={Math.min(paperOptions.length, 5) as 3 | 4 | 5}
              // One line under the row for the paper chosen, so pressing a paper
              // says what it is without every tile carrying a description.
              detail="selected"
              onChange={(value) => {
                setPaperId(value);
                // A single paper carries its own calculator rule, so a choice
                // made across all papers would only contradict it.
                if (value !== ALL_PAPERS) setCalculator("any");
                setShortage(null);
              }}
            />
          ) : null}
          {showCalculator ? (
            <OptionSwitch
              label="Calculator"
              hideLabel={!showPapers}
              className="mt-4"
              value={calculator}
              options={CALCULATOR_CHOICES}
              onChange={(value) => {
                setCalculator(value);
                setShortage(null);
              }}
            />
          ) : null}
        </Card>
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

      {/*
        * A course with no checked topic list says so.
        *
        * This rendered nothing at all, which is indistinguishable from a
        * feature that does not exist -- and a student who had seen topics on
        * another course had no way to tell whether they were missing something
        * or whether Jami was. Topics are fail-closed by design: an unchecked
        * list is worse than none, because a wrong topic silently narrows
        * practice to the wrong questions.
        */}
      {topics.length === 0 ? (
        <p className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3 text-sm text-text-muted">
          Topics aren&apos;t available for this course yet, so this session draws on the whole
          specification. Nothing is missing from your practice.
        </p>
      ) : (
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
      )}

      {shortage ? (
        <Card tone="warm" padding="lg">
          {generating ? (
            <>
              <h3 className="text-lg font-semibold text-text-primary">
                Jami is writing your questions
              </h3>
              <p className="mt-1 max-w-xl text-sm leading-6 text-text-secondary">
                {generating.count} original Jami-created question{generating.count === 1 ? "" : "s"}
                {availableTotal > 0
                  ? `, alongside the ${availableTotal} real one${availableTotal === 1 ? "" : "s"}.`
                  : "."}
              </p>
              <ExamGenerationProgress count={generating.count} startedAt={generating.startedAt} />
            </>
          ) : (
            <>
          <h3 className="text-lg font-semibold text-text-primary">
            {availableTotal > 0
              ? `Only ${availableTotal} matching real question${availableTotal === 1 ? "" : "s"} so far`
              : "No matching real questions yet"}
          </h3>
          {/*
            * This used to say Jami was looking for more papers in the
            * background. Nothing was: the search it referred to has no caller,
            * and even if it ran, a past-paper question reaches students only
            * after the licence and the extraction have both been checked by a
            * person. So the card says what is actually true and offers the two
            * choices that actually exist, rather than implying a wait that
            * would never end.
            */}
          <p className="mt-2 max-w-xl text-sm leading-6 text-text-secondary">
            More real questions are added for this course as they are licensed and checked, which is
            not something you can wait for here. You can fill the gap with original Jami-created
            questions — clearly labelled, and not taken from a past paper — or start with the real
            ones there are.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              disabled={starting}
              onClick={() => void start({ allowGenerated: true, generatedCount: missingTotal })}
            >
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
            </>
          )}
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
