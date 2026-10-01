"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppPage from "@/components/layout/AppPage";
import AllowanceHint from "@/components/billing/AllowanceHint";
import { notifyAllowanceSpent } from "@/services/billing/plan-summary-store";
import { useUser } from "@/components/providers/UserProvider";
import {
  Button,
  Card,
  EmptyState,
  FeedbackBanner,
  FileField,
  FormDisclosure,
  Input,
  JamiTutorIcon,
  OptionSwitch,
  ElapsedTime,
  ProgressBar,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";
import PracticePaperSourcePicker from "@/components/practice/PracticePaperSourcePicker";
import PracticePaperFormatConfirmation from "@/components/practice/PracticePaperFormatConfirmation";
import PracticeStep from "@/components/practice/PracticeStep";
import PaperMaterialPicker, { defaultPaperMaterial } from "@/components/practice/PaperMaterialPicker";
import ExamCourseFields from "@/components/practice/ExamCourseFields";
import PaperTopicPicker, {
  wholeCourseSelection,
  type PaperTopicSelection,
} from "@/components/practice/PaperTopicPicker";
import { useExamCourseOptions } from "@/hooks/useExamCourseOptions";
import {
  examCourseDraftFrom,
  resolveExamCourseDraft,
  type ExamCourseDraft,
} from "@/lib/practice/exam-course-form";
import { sameExamTier } from "@/lib/practice/exam-course-tiers";
import { examBoardAppliesTo } from "@/lib/practice/exam-questions";
import { servableExamSpecificationTopics } from "@/lib/practice/exam-specification-topics";
import { useFeedback } from "@/hooks/useFeedback";
import { MAX_SOURCE_FOLDER_IDS, type Source } from "@/lib/material/sources";
import { practicePaperSourceRole, rankPracticePaperSources } from "@/lib/ai/practice-paper-generation";
import {
  type PracticePaperJob,
  MAX_PRACTICE_PAPER_SOURCE_IDS,
  type PracticePaperTimingMode,
} from "@/lib/practice/practice-papers";
import {
  PRACTICE_PAPER_JOB_STAGE_LABELS,
  canCancelPracticePaperJob,
} from "@/lib/practice/practice-paper-jobs";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import {
  acknowledgePracticePaperJob,
  cancelPracticePaperJob,
  clarifyPracticePaperJob,
  confirmPracticePaperFormat,
  createPracticePaperJob,
  getPracticePaperJob,
  retryPracticePaperJob,
} from "@/services/ai/practice-papers";
import { getActiveStudyFolders, updateStudyFolder } from "@/services/study/folders";
import { examStudyLevelForQualification } from "@/lib/practice/exam-ingestion-manifest";
import SettingSwitch from "@/components/ui/SettingSwitch";
import { importUploadedNotebook } from "@/services/study/notebook-import";
import { deleteNotebookFile } from "@/services/study/notebook-files";
import { deleteNotebookImportRecords } from "@/services/study/notebooks";
import {
  createUploadedPracticePaper,
} from "@/services/study/practice-papers";
import { createUploadedSource } from "@/services/study/source-upload";
import { deleteSource, getActiveSources, updateSource } from "@/services/study/sources";
import { deleteSourceFile } from "@/services/study/source-files";
import { getActiveSourcesForFolderPage } from "@/services/study/sources";

type CreationPath = "generate" | "upload";

const TIMING_OPTIONS: Array<{
  value: PracticePaperTimingMode;
  label: string;
  detail: string;
}> = [
  { value: "timed", label: "Timed", detail: "Use the real paper duration, with optional overtime" },
  { value: "untimed", label: "Untimed", detail: "Work without a countdown or pacing comparison" },
];

type ExamKind = "final" | "midterm" | "test" | "resit";

const EXAM_KIND_OPTIONS: Array<{ value: ExamKind; label: string; phrase: string }> = [
  { value: "final", label: "Final exam", phrase: "final exam" },
  { value: "midterm", label: "Mid-term", phrase: "mid-term exam" },
  { value: "test", label: "Class test", phrase: "class test" },
  { value: "resit", label: "Resit", phrase: "resit exam" },
];

type ExamLength = "unsure" | "60" | "90" | "120" | "180";

const EXAM_LENGTH_OPTIONS: Array<{ value: ExamLength; label: string }> = [
  { value: "unsure", label: "Not sure" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1½ hours" },
  { value: "120", label: "2 hours" },
  { value: "180", label: "3 hours" },
];

/**
 * What a student describing their own exam is asked, in their terms: which
 * module, what kind of exam, how long, and what it covers. Jami's request is
 * written from those answers rather than asked for as a paragraph.
 */
function describedExamRequest(input: { module: string; kind: ExamKind; length: ExamLength; withPastPapers: boolean }) {
  const kind = EXAM_KIND_OPTIONS.find((option) => option.value === input.kind)?.phrase ?? "exam";
  const length = input.length === "unsure" ? "" : `, ${EXAM_LENGTH_OPTIONS.find((option) => option.value === input.length)?.label}`;
  return input.withPastPapers
    ? `A new practice ${kind} for ${input.module}${length}, modelled closely on my past papers: the same structure, sections, number of questions, marks and kinds of question, with new questions throughout that stay within what my notes cover.`
    : `A complete practice ${kind} for ${input.module}${length}, in the format that exam uses.`;
}

const TUTOR_OPTIONS: Array<{
  value: "off" | "on";
  label: string;
  detail: string;
}> = [
  { value: "off", label: "Exam conditions", detail: "Jami stays hidden during the sitting" },
  { value: "on", label: "Jami assisted", detail: "Jami helps as normal and the result is labelled assisted" },
];

function ChoiceCards<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; detail: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-text-secondary">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`min-h-20 rounded-xl border p-3 text-left transition ${
                selected
                  ? "border-accent/50 bg-accent/10 shadow-e1"
                  : "border-[var(--color-border)] bg-[var(--color-surface-panel)] hover:border-[var(--color-border-strong)]"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <span className="block text-sm font-semibold text-text-primary">
                {option.label}
              </span>
              <span className="mt-1 block text-xs leading-5 text-text-muted">
                {option.detail}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function PracticePaperCreator() {
  const { user } = useUser();
  const router = useRouter();
  const { feedback, showError, showThrownError, clear } = useFeedback();
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSources, setLoadingSources] = useState(false);
  const [path, setPath] = useState<CreationPath>("generate");
  /*
   * The course, paper and topics, each held against what it was chosen for so
   * that changing folder or course starts from that folder's or course's own
   * defaults rather than carrying over a choice that no longer applies.
   */
  const [courseState, setCourseState] = useState<{ folderId: string; draft: ExamCourseDraft } | null>(null);
  const [paperState, setPaperState] = useState<{ specificationId: string; code: string } | null>(null);
  const [topicState, setTopicState] = useState<{ specificationId: string; selection: PaperTopicSelection } | null>(null);
  /** The described exam, for a module or a course the catalogue does not hold. */
  const [moduleState, setModuleState] = useState<{ folderId: string; name: string } | null>(null);
  const [examKind, setExamKind] = useState<ExamKind>("final");
  const [examLength, setExamLength] = useState<ExamLength>("unsure");
  const [examined, setExamined] = useState("");
  /** The past papers and notes a described exam is built from, held against the folder they were chosen in. */
  const [materialState, setMaterialState] = useState<{ folderId: string; ids: string[] } | null>(null);
  const [uploadingMaterial, setUploadingMaterial] = useState<"paper" | "notes" | null>(null);
  /** The student's material in other folders, which can be brought into this one. */
  const [allSources, setAllSources] = useState<Source[]>([]);
  const [addingFromLibrary, setAddingFromLibrary] = useState(false);
  /** Whether a course picked for a folder without one is saved on the folder. */
  const [rememberCourse, setRememberCourse] = useState(true);
  const [timingMode, setTimingMode] = useState<PracticePaperTimingMode>("timed");
  const [tutorChoice, setTutorChoice] = useState<"off" | "on">("off");
  const [automaticSources, setAutomaticSources] = useState(true);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [confirmedAutomaticSourceIds, setConfirmedAutomaticSourceIds] = useState<string[]>([]);
  const [clarificationQuestion, setClarificationQuestion] = useState("");
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [markSchemeFile, setMarkSchemeFile] = useState<File | null>(null);
  const [supportingFiles, setSupportingFiles] = useState<File[]>([]);
  const [uploadedDuration, setUploadedDuration] = useState("");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [activeJob, setActiveJob] = useState<PracticePaperJob | null>(null);
  const requestedFolderApplied = useRef(false);

  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job")?.trim();
    if (!jobId) return;
    let active = true;
    void getPracticePaperJob(jobId)
      .then((job) => {
        if (!active) return;
        setActiveJob(job);
        setPath("generate");
        if (job.status === "needs_clarification") {
          setClarificationQuestion(
            job.clarificationQuestion ?? "What assessment format should this follow?"
          );
        } else if (job.status === "ready") {
          router.push(`/dashboard/notebooks/${encodeURIComponent(job.paperId)}`);
        }
      })
      .catch((error) => {
        if (active) showThrownError(error, "Could not reopen that paper request.");
      });
    return () => { active = false; };
  }, [router, showThrownError]);

  useEffect(() => {
    let active = true;
    void getActiveStudyFolders(user.uid)
      .then((items) => {
        if (!active) return;
        setFolders(items);
        const requestedFolder = new URLSearchParams(window.location.search).get("folder") ?? "";
        const initial = items.find((folder) => folder.id === requestedFolder)?.id ?? items[0]?.id ?? "";
        requestedFolderApplied.current = true;
        setFolderId(initial);
      })
      .catch((error) => {
        if (active) showThrownError(error, "Could not load your folders.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [showThrownError, user.uid]);

  useEffect(() => {
    if (!folderId || !requestedFolderApplied.current) {
      setSources([]);
      return;
    }
    let active = true;
    setLoadingSources(true);
    setSelectedSourceIds([]);
    setConfirmedAutomaticSourceIds([]);
    void getActiveSourcesForFolderPage(user.uid, folderId, { pageSize: 100 })
      .then((page) => {
        if (active) setSources(page.items);
      })
      .catch((error) => {
        if (active) showThrownError(error, "Could not load this folder's sources.");
      })
      .finally(() => {
        if (active) setLoadingSources(false);
      });
    return () => {
      active = false;
    };
  }, [folderId, showThrownError, user.uid]);

  // Everything the student has added anywhere, for bringing into this folder.
  useEffect(() => {
    let active = true;
    void getActiveSources(user.uid)
      .then((items) => {
        if (active) setAllSources(items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user.uid]);

  useEffect(() => {
    if (!activeJob || !canCancelPracticePaperJob(activeJob.status)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const job = await getPracticePaperJob(activeJob.id);
        if (!active) return;
        setActiveJob(job);
        if (job.status === "ready") {
          setWorking(false);
          router.push(`/dashboard/notebooks/${encodeURIComponent(job.paperId)}`);
          return;
        }
        if (job.status === "needs_clarification") {
          setWorking(false);
          setClarificationQuestion(job.clarificationQuestion ?? "What exam format should this follow?");
          setClarificationAnswer("");
          return;
        }
        if (job.status === "needs_confirmation") {
          setWorking(false);
          setClarificationQuestion("");
          return;
        }
        // A failure is shown by the job panel at the top, with its retry.
        if (job.status === "failed" || job.status === "cancelled") {
          setWorking(false);
          return;
        }
        timer = setTimeout(() => void poll(), 2_500);
      } catch (error) {
        if (!active) return;
        timer = setTimeout(() => void poll(), 5_000);
        console.warn("Could not refresh practice-paper progress.", error);
      }
    };
    timer = setTimeout(() => void poll(), 1_000);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [activeJob, router]);

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === folderId) ?? null,
    [folderId, folders]
  );
  /*
   * A school course is picked, not described. That is every folder except one
   * marked university or professional: most folders were made before a level
   * was asked for and have none, and asking them for a course is right.
   */
  const schoolFolder = Boolean(
    selectedFolder && (!selectedFolder.studyLevel || examBoardAppliesTo(selectedFolder.studyLevel))
  );
  const courseDraft =
    courseState?.folderId === folderId ? courseState.draft : examCourseDraftFrom(selectedFolder?.examCourse);
  const courseOptions = useExamCourseOptions(schoolFolder ? courseDraft.board : "");
  const resolvedCourse = resolveExamCourseDraft(courseDraft, courseOptions.courses, selectedFolder?.examCourse);
  /** The picked school course, which is the request when there is one. */
  const course = path === "generate" && schoolFolder ? resolvedCourse.course : null;
  const courseOption = courseOptions.courses.find((option) => option.specificationId === courseDraft.specificationId);
  const paperChoices = (courseOption?.papers ?? []).filter(
    (paper) => !course?.tier || !paper.tier || sameExamTier(paper.tier, course.tier)
  );
  const paperCode = paperState && paperState.specificationId === course?.specificationId ? paperState.code : "";
  const chosenPaper = paperChoices.find((paper) => paper.code === paperCode) ?? paperChoices[0];
  const topicSelection: PaperTopicSelection = course
    ? topicState?.specificationId === course.specificationId
      ? topicState.selection
      : wholeCourseSelection(course.specificationId)
    : { topicIds: [], conceptIds: [] };
  // Filled in from the folder, which is usually named after the module.
  const moduleName =
    moduleState?.folderId === folderId ? moduleState.name : selectedFolder?.subject || selectedFolder?.name || "";
  /**
   * A paper for a course with no board catalogue -- a university module or
   * professional exam -- described by the student. It is built
   * the way a student would build it by hand -- from their past papers and notes.
   */
  const describedPath = path === "generate" && !schoolFolder;
  const materialIds =
    materialState?.folderId === folderId ? materialState.ids : defaultPaperMaterial(sources);
  const library = useMemo(
    () => allSources.filter((source) => !source.folderIds.includes(folderId)),
    [allSources, folderId]
  );
  const withPastPapers = sources.some(
    (source) => materialIds.includes(source.id) && practicePaperSourceRole(source) === "paper"
  );
  const courseHasTopics = Boolean(course && servableExamSpecificationTopics(course.specificationId)?.topics.length);
  /**
   * For a school course, sources are an optional extra. The course's format,
   * checked topics and real questions already say what the paper is; a
   * university module still leans on its own handbook and lectures.
   */
  const sourcesOptional = Boolean(course);

  const proposedSources = useMemo(
    () => rankPracticePaperSources(
      sources,
      path === "generate"
        ? `${moduleName} ${examined}`
        : `${uploadTitle} uploaded complete assessment`
    ),
    [examined, moduleName, path, sources, uploadTitle]
  );
  const proposedSourceIds = proposedSources.map((source) => source.id);
  const automaticSourcesConfirmed =
    proposedSourceIds.length === confirmedAutomaticSourceIds.length &&
    proposedSourceIds.every((sourceId, index) =>
      sourceId === confirmedAutomaticSourceIds[index]
    );

  /** Files added here join the folder, so the next paper starts from them too. */
  const uploadMaterial = async (files: File[], kind: "paper" | "notes") => {
    if (!folderId || uploadingMaterial) return;
    setUploadingMaterial(kind);
    clear();
    const startingIds = materialIds;
    const added: string[] = [];
    try {
      for (const file of files) {
        const name = file.name.replace(/\.[^.]+$/, "");
        // Named so it is sorted where it was added, whatever the file was called.
        const title =
          kind === "paper" && practicePaperSourceRole({ title: name, fileName: file.name }) === "notes"
            ? `Past paper: ${name}`
            : name;
        const uploaded = await createUploadedSource({ userId: user.uid, folderId, title, file });
        added.push(uploaded.id);
      }
    } catch (error) {
      showThrownError(error, "Could not add that file.");
    } finally {
      const page = await getActiveSourcesForFolderPage(user.uid, folderId, { pageSize: 100 }).catch(() => null);
      if (page) setSources(page.items);
      setMaterialState({ folderId, ids: [...startingIds, ...added].slice(0, MAX_PRACTICE_PAPER_SOURCE_IDS) });
      setUploadingMaterial(null);
    }
  };

  /**
   * Material from the student's library joins this folder rather than being
   * uploaded again. A paper only reads material in its folder, so the link is
   * what makes it usable, and it stays for the next paper.
   */
  const addFromLibrary = async (ids: string[]) => {
    if (!folderId || addingFromLibrary) return;
    setAddingFromLibrary(true);
    clear();
    const startingIds = materialIds;
    const added: string[] = [];
    try {
      for (const id of ids) {
        const source = library.find((item) => item.id === id);
        if (!source) continue;
        if (source.folderIds.length >= MAX_SOURCE_FOLDER_IDS) {
          showError(`"${source.title}" is already in ${MAX_SOURCE_FOLDER_IDS} folders, so it couldn't be added here.`);
          continue;
        }
        await updateSource(user.uid, id, { folderIds: [...source.folderIds, folderId] });
        added.push(id);
      }
    } catch (error) {
      showThrownError(error, "Could not add that from your library.");
    } finally {
      const page = await getActiveSourcesForFolderPage(user.uid, folderId, { pageSize: 100 }).catch(() => null);
      if (page) setSources(page.items);
      setAllSources((current) =>
        current.map((item) => (added.includes(item.id) ? { ...item, folderIds: [...item.folderIds, folderId] } : item))
      );
      setMaterialState({ folderId, ids: [...startingIds, ...added].slice(0, MAX_PRACTICE_PAPER_SOURCE_IDS) });
      setAddingFromLibrary(false);
    }
  };

  const createGenerated = async () => {
    if (activeJob?.status === "needs_confirmation") {
      showError("Confirm or correct the paper format before continuing.");
      return;
    }
    if (activeJob?.status === "needs_clarification") {
      if (!clarificationAnswer.trim()) {
        showError("Answer Jami's question before continuing.");
        return;
      }
      setWorking(true);
      clear();
      try {
        const resumed = await clarifyPracticePaperJob(
          activeJob.id,
          clarificationAnswer.trim()
        );
        setActiveJob(resumed);
        setClarificationQuestion("");
        setClarificationAnswer("");
      } catch (error) {
        showThrownError(error, "Could not resume this practice paper.");
        setWorking(false);
      }
      return;
    }
    if (!folderId) {
      showError("Choose a folder for this paper.");
      return;
    }
    if (!course && !moduleName.trim()) {
      showError(schoolFolder ? "Choose your board and course, or name the course." : "Add the module this exam is for.");
      return;
    }
    if (course && courseHasTopics && topicSelection.topicIds.length === 0 && topicSelection.conceptIds.length === 0) {
      showError("Choose at least one topic for this paper.");
      return;
    }
    if (!describedPath && !sourcesOptional && automaticSources && !automaticSourcesConfirmed) {
      showError("Review and confirm the sources Jami proposes for this paper.");
      return;
    }
    if (clarificationQuestion && !clarificationAnswer.trim()) {
      showError("Answer Jami's question before continuing.");
      return;
    }
    const baseSourceIds = describedPath
      ? materialIds
      : sourcesOptional
      ? selectedSourceIds
      : automaticSources
        ? confirmedAutomaticSourceIds
        : selectedSourceIds;
    if (baseSourceIds.length + supportingFiles.length > MAX_PRACTICE_PAPER_SOURCE_IDS) {
      showError("That's more material than one paper can use. Untick some and try again.");
      return;
    }
    setWorking(true);
    clear();
    if (course && selectedFolder && !selectedFolder.examCourse && rememberCourse) {
      // A course is only kept on a folder that has a school level, so one is set with it where missing.
      const studyLevel = selectedFolder.studyLevel ?? examStudyLevelForQualification(course.qualification);
      await updateStudyFolder(user.uid, folderId, { examCourse: course, studyLevel })
        .then(() =>
          setFolders((current) =>
            current.map((folder) => (folder.id === folderId ? { ...folder, examCourse: course, studyLevel } : folder))
          )
        )
        // Remembering is a convenience; the paper does not wait on it.
        .catch((error) => console.warn("Could not save the folder's course.", error));
    }
    let queued = false;
    const temporarySources: Array<{ id: string; storagePath: string }> = [];
    try {
      for (const file of supportingFiles) {
        const uploaded = await createUploadedSource({
          userId: user.uid,
          folderId,
          title: `Temporary paper context: ${file.name}`,
          file,
        });
        temporarySources.push({ id: uploaded.id, storagePath: uploaded.storagePath });
      }
      const job = await createPracticePaperJob({
        folderId,
        request: describedExamRequest({ module: moduleName.trim(), kind: examKind, length: examLength, withPastPapers: describedPath && withPastPapers }),
        coverage: examined.trim() || "Everything taught in the module",
        ...(course
          ? {
              scope: {
                course,
                ...(chosenPaper ? { paper: { code: chosenPaper.code, title: chosenPaper.title } } : {}),
                topicIds: topicSelection.topicIds,
                conceptIds: topicSelection.conceptIds,
              },
            }
          : {}),
        length: "full",
        focus: "balanced",
        focusDetail: "",
        timingMode,
        tutorEnabled: tutorChoice === "on",
        sourceIds: [...baseSourceIds, ...temporarySources.map((source) => source.id)],
      }, crypto.randomUUID(), temporarySources.map((source) => source.id));
      queued = true;
      setActiveJob(job);
      notifyAllowanceSpent();
    } catch (error) {
      await Promise.all(temporarySources.flatMap((source) => [
        deleteSourceFile(source.storagePath).catch(() => undefined),
        deleteSource(user.uid, source.id).catch(() => undefined),
      ]));
      showThrownError(error, "Could not create this practice paper.");
    } finally {
      if (!queued) setWorking(false);
    }
  };

  const cancelGeneratedJob = async () => {
    if (!activeJob || !canCancelPracticePaperJob(activeJob.status)) return;
    try {
      const cancelled = await cancelPracticePaperJob(activeJob.id);
      setActiveJob(cancelled);
      setWorking(false);
    } catch (error) {
      showThrownError(error, "Could not cancel this paper.");
    }
  };

  const retryFailedJob = async () => {
    if (!activeJob || activeJob.status !== "failed") return;
    setWorking(true);
    clear();
    try {
      setActiveJob(await retryPracticePaperJob(activeJob.id));
    } catch (error) {
      showThrownError(error, "Could not try this paper again.");
      setWorking(false);
    }
  };

  const dismissFailedJob = async () => {
    if (!activeJob || activeJob.status !== "failed") return;
    try {
      await acknowledgePracticePaperJob(activeJob.id);
      router.push("/dashboard/practice");
    } catch (error) {
      showThrownError(error, "Could not dismiss this paper.");
    }
  };

  const decidePaperFormat = async (
    action: "confirm" | "correct" | "use_custom",
    correction?: string
  ) => {
    if (!activeJob || activeJob.status !== "needs_confirmation") return;
    setWorking(true);
    clear();
    try {
      const resumed = await confirmPracticePaperFormat(activeJob.id, action, correction);
      setActiveJob(resumed);
    } catch (error) {
      showThrownError(error, "Could not resume this practice paper.");
      setWorking(false);
    }
  };

  const createUploaded = async () => {
    if (!folderId || !paperFile || !uploadTitle.trim()) {
      showError("Choose a folder, name the paper, and add the paper file.");
      return;
    }
    /*
     * No waiting on the proposed sources here. An uploaded paper is already
     * written, so sources are only extra context for marking it -- and the
     * proposal is re-ranked from the title on every keystroke, so demanding a
     * confirmation refused the upload of anyone who had not found that step,
     * or who had confirmed and then touched the title. What the student
     * confirmed or picked is attached; otherwise nothing is.
     */
    setWorking(true);
    setProgress(null);
    clear();
    let imported: Awaited<ReturnType<typeof importUploadedNotebook>> | null = null;
    let uploadedScheme: Awaited<ReturnType<typeof createUploadedSource>> | null = null;
    try {
      imported = await importUploadedNotebook({
        userId: user.uid,
        folderId,
        title: uploadTitle.trim(),
        file: paperFile,
        color: "indigo",
        icon: "notebook",
        onProgress: setProgress,
      });
      if (markSchemeFile) {
        uploadedScheme = await createUploadedSource({
          userId: user.uid,
          folderId,
          title: `${uploadTitle.trim()} mark scheme`,
          file: markSchemeFile,
          onProgress: setProgress,
        });
      }
      let sourceIds = automaticSources
        ? confirmedAutomaticSourceIds
        : selectedSourceIds;
      let sourceLabels = sourceIds.flatMap((sourceId) => {
        const source = sources.find((candidate) => candidate.id === sourceId);
        return source ? [source.title] : [];
      });
      if (uploadedScheme && !sourceIds.includes(uploadedScheme.id)) {
        sourceIds = [uploadedScheme.id, ...sourceIds].slice(0, MAX_PRACTICE_PAPER_SOURCE_IDS);
        sourceLabels = [uploadedScheme.title, ...sourceLabels].slice(0, MAX_PRACTICE_PAPER_SOURCE_IDS);
      }
      await createUploadedPracticePaper({
        userId: user.uid,
        notebook: imported.notebook,
        sourceIds,
        sourceLabels,
        markSchemeSourceId: uploadedScheme?.id,
        durationMinutes: Number.parseInt(uploadedDuration, 10) || 0,
        timingMode,
        tutorEnabled: tutorChoice === "on",
      });
      router.push(`/dashboard/notebooks/${encodeURIComponent(imported.notebook.id)}`);
    } catch (error) {
      if (uploadedScheme) {
        await Promise.all([
          deleteSourceFile(uploadedScheme.storagePath).catch(() => undefined),
          deleteSource(user.uid, uploadedScheme.id).catch(() => undefined),
        ]);
      }
      if (imported) {
        await Promise.all([
          deleteNotebookImportRecords(user.uid, imported.notebook.id).catch(() => undefined),
          deleteNotebookFile(imported.file.storagePath).catch(() => undefined),
        ]);
      }
      showThrownError(error, "Could not create this uploaded paper.");
    } finally {
      setWorking(false);
      setProgress(null);
    }
  };

  if (loading) {
    return (
      <AppPage title="New paper" backHref="/dashboard/practice" backLabel="Practice" width="lg">
        <div className="space-y-4">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </AppPage>
    );
  }

  if (folders.length === 0) {
    return (
      <AppPage title="New paper" backHref="/dashboard/practice" backLabel="Practice" width="lg">
        <EmptyState
          emoji="Folder"
          title="Create a study folder first"
          description="A practice paper uses the course level, sources, and notes from one folder."
          action={<Button type="button" onClick={() => router.push("/dashboard/practice")}>Back to Practice</Button>}
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title="New paper"
      backHref={folderId ? `/dashboard/folders/${folderId}` : "/dashboard/practice"}
      backLabel={selectedFolder?.name ?? "Practice"}
      width="lg"
      contentClassName="space-y-6"
    >
      {feedback ? (
        <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={clear} />
      ) : null}

      <div className="flex items-start gap-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent">
          <JamiTutorIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">
            Build a practice paper
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-text-secondary">
            Choose the exam and what it covers. Jami writes a full paper in that exam&apos;s
            format, with a marking guide, ready to sit in a notebook.
          </p>
        </div>
      </div>

      {/*
       * Opened from the Practice paper builder, the job is why the student is
       * here, so its state leads the page instead of waiting below the form.
       */}
      {activeJob?.status === "failed" ? (
        <div
          role="alert"
          className="rounded-2xl border border-[color-mix(in_srgb,var(--color-warning-text)_32%,transparent)] bg-[color-mix(in_srgb,var(--color-warning-text)_7%,transparent)] p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">
                This paper could not be built
              </p>
              <p className="mt-0.5 truncate text-xs text-text-secondary">
                {activeJob.title}
              </p>
              <p className="mt-2 text-xs leading-5 text-[var(--color-warning-text)]">
                {activeJob.failureMessage ?? "Jami could not finish that paper just now."}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={working}
                onClick={() => void retryFailedJob()}
              >
                Try again
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={working}
                onClick={() => void dismissFailedJob()}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      ) : activeJob && canCancelPracticePaperJob(activeJob.status) && activeJob.status !== "needs_confirmation" ? (
        <div className="rounded-2xl border border-accent/25 bg-accent/8 p-4" role="status">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">
                {PRACTICE_PAPER_JOB_STAGE_LABELS[activeJob.stage]}
              </p>
              <p className="mt-0.5 truncate text-xs text-text-secondary">
                {activeJob.title}
              </p>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                You can leave this page. The paper will appear in Practice when it is ready.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void cancelGeneratedJob()}
            >
              Cancel
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <ProgressBar progress={activeJob.progress} size="sm" className="flex-1" />
            <ElapsedTime startedAt={activeJob.createdAt} label="Building for" className="shrink-0 text-xs text-text-muted" />
          </div>
        </div>
      ) : null}

      <Card padding="lg" className="space-y-8">
        <PracticeStep
          step={1}
          title="Which folder is this for?"
          description="Your paper is kept in the folder for that subject."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Study folder"
              value={folderId}
              disabled={working}
              onChange={(event) => setFolderId(event.target.value)}
            >
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </Select>
          </div>
          <OptionSwitch
            label="Start from"
            value={path}
            disabled={working}
            options={[
              {
                value: "generate" as const,
                label: "Generate with Jami",
                detail: "An original paper in your exam's format",
              },
              {
                value: "upload" as const,
                label: "Upload a paper",
                detail: "A real paper you already have as a file",
              },
            ]}
            onChange={(value) => {
              setPath(value);
              setClarificationQuestion("");
              clear();
            }}
          />
        </PracticeStep>

        <div className="h-px bg-[var(--color-border)]" />

        {describedPath ? (
          <>
            <PracticeStep
              step={2}
              title="Your past papers and notes"
              description="Everything Jami builds the paper from. The more past papers you add, the closer the new paper matches your real exam."
            >
              {loadingSources ? (
                <Skeleton className="h-32 rounded-2xl" />
              ) : (
                <PaperMaterialPicker
                  sources={sources}
                  selectedIds={materialIds}
                  onChange={(ids) => setMaterialState({ folderId, ids })}
                  onUpload={(files, kind) => void uploadMaterial(files, kind)}
                  library={library}
                  onAddFromLibrary={(ids) => void addFromLibrary(ids)}
                  addingFromLibrary={addingFromLibrary}
                  uploading={uploadingMaterial}
                  disabled={working}
                />
              )}
            </PracticeStep>
            <div className="h-px bg-[var(--color-border)]" />
          </>
        ) : null}

        {path === "generate" ? (
          <PracticeStep
            step={describedPath ? 3 : 2}
            title={schoolFolder ? "Which paper?" : "About the exam"}
            description={
              schoolFolder
                ? selectedFolder?.examCourse
                  ? "Filled in from your folder. Change the board or course if this paper is for something else."
                  : "Pick your exam board, course and paper. Jami writes it in that paper's real format."
                : "Tell us about the exam you're preparing for, and Jami writes a paper like it."
            }
          >
            {schoolFolder ? (
              <div className="space-y-5">
                {selectedFolder?.examCourse ? (
                  <ExamCourseFields
                    value={courseDraft}
                    onChange={(draft) => setCourseState({ folderId, draft })}
                    options={courseOptions}
                    studyLevel={selectedFolder?.studyLevel}
                    subjectHint={`${selectedFolder?.name ?? ""} ${selectedFolder?.subject ?? ""}`}
                    savedCourse={selectedFolder?.examCourse}
                    disabled={working}
                  />
                ) : (
                  /*
                   * A folder with no course yet is asked for one here, once:
                   * the choice can be kept on the folder, so the next paper,
                   * and Practice questions, start from it.
                   */
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 sm:p-5">
                    <p className="text-sm font-semibold text-text-primary">
                      {selectedFolder?.name ?? "This folder"} doesn&apos;t have a course yet
                    </p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">
                      Choose the board and course this paper is for.
                    </p>
                    <div className="mt-4">
                      <ExamCourseFields
                        value={courseDraft}
                        onChange={(draft) => setCourseState({ folderId, draft })}
                        options={courseOptions}
                        studyLevel={selectedFolder?.studyLevel}
                        subjectHint={`${selectedFolder?.name ?? ""} ${selectedFolder?.subject ?? ""}`}
                        disabled={working}
                      />
                    </div>
                    {course ? (
                      <SettingSwitch
                        className="mt-4 border-t border-[var(--color-border)] pt-4"
                        label={`Remember this course for ${selectedFolder?.name ?? "this folder"}`}
                        description="Next time it's filled in for you, here and in Practice questions."
                        checked={rememberCourse}
                        disabled={working}
                        onChange={setRememberCourse}
                      />
                    ) : null}
                  </div>
                )}
                {course && paperChoices.length > 0 ? (
                  paperChoices.length <= 4 ? (
                    <OptionSwitch
                      label="Paper"
                      value={chosenPaper?.code ?? ""}
                      columns={paperChoices.length === 4 ? 4 : paperChoices.length === 3 ? 3 : 2}
                      options={paperChoices.map((paper) => ({ value: paper.code, label: paper.title }))}
                      disabled={working}
                      onChange={(code) => setPaperState({ specificationId: course.specificationId, code })}
                    />
                  ) : (
                    <Select
                      label="Paper"
                      value={chosenPaper?.code ?? ""}
                      disabled={working}
                      onChange={(event) => setPaperState({ specificationId: course.specificationId, code: event.target.value })}
                    >
                      {paperChoices.map((paper) => (
                        <option key={paper.code} value={paper.code}>
                          {paper.title}
                        </option>
                      ))}
                    </Select>
                  )
                ) : null}
                {course ? null : (
                  <FormDisclosure title="My course isn't listed" summary="Type it in instead">
                    <div className="space-y-3">
                      <Input
                        label="Course and paper"
                        value={moduleName}
                        disabled={working}
                        placeholder="For example: OCR GCSE Computer Science, Paper 1"
                        onChange={(event) => setModuleState({ folderId, name: event.target.value })}
                      />
                      <Textarea
                        label="What it covers (optional)"
                        rows={2}
                        value={examined}
                        disabled={working}
                        placeholder="Leave empty for the whole course"
                        onChange={(event) => setExamined(event.target.value)}
                      />
                    </div>
                  </FormDisclosure>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                <Input
                  label="Module"
                  value={moduleName}
                  disabled={working}
                  placeholder="For example: Analysis 3"
                  onChange={(event) => setModuleState({ folderId, name: event.target.value })}
                />
                <OptionSwitch
                  label="Kind of exam"
                  value={examKind}
                  columns={4}
                  options={EXAM_KIND_OPTIONS.map(({ value, label }) => ({ value, label }))}
                  disabled={working}
                  onChange={setExamKind}
                />
                <OptionSwitch
                  label="How long is it?"
                  value={examLength}
                  columns={5}
                  options={EXAM_LENGTH_OPTIONS.map((option) =>
                    option.value === "unsure" && withPastPapers ? { ...option, label: "Like my past papers" } : option
                  )}
                  disabled={working}
                  onChange={setExamLength}
                />
                <Textarea
                  label="What's on it? (optional)"
                  rows={3}
                  value={examined}
                  disabled={working}
                  placeholder="Topics or weeks, in your own words. For example: weeks 1–8, metric spaces, continuity and compactness."
                  onChange={(event) => setExamined(event.target.value)}
                />
              </div>
            )}

            {activeJob?.status === "needs_confirmation" && activeJob.paperBrief ? (
              <PracticePaperFormatConfirmation
                brief={activeJob.paperBrief}
                disabled={working}
                onConfirm={() => void decidePaperFormat("confirm")}
                onUseCustom={() => void decidePaperFormat("use_custom")}
                onCorrect={(value) => void decidePaperFormat("correct", value)}
                onCancel={() => void cancelGeneratedJob()}
              />
            ) : null}

            {clarificationQuestion ? (
              <div className="rounded-2xl border border-accent/30 bg-accent/8 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent">
                  Jami needs one detail
                </p>
                <p className="mt-2 text-sm leading-6 text-text-primary">
                  {clarificationQuestion}
                </p>
                <Input
                  containerClassName="mt-3"
                  label="Your answer"
                  value={clarificationAnswer}
                  disabled={working}
                  onChange={(event) => setClarificationAnswer(event.target.value)}
                />
              </div>
            ) : null}

          </PracticeStep>
        ) : (
          <PracticeStep
            step={2}
            title="Add the paper"
            description="Your paper stays exactly as it is underneath your ink. With no official mark scheme, Jami labels its marking as estimated."
          >
            <Input
              label="Paper title"
              value={uploadTitle}
              disabled={working}
              onChange={(event) => setUploadTitle(event.target.value)}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <FileField
                label="Paper file"
                hint="PDF, JPG, PNG or WebP"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                file={paperFile}
                disabled={working}
                onChange={setPaperFile}
              />
              <FileField
                label="Official mark scheme"
                hint="Optional — but it makes the marking far more reliable"
                accept="application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,.pdf,.docx,.pptx,.txt"
                file={markSchemeFile}
                disabled={working}
                onChange={setMarkSchemeFile}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Duration in minutes"
                type="number"
                min={0}
                max={360}
                value={uploadedDuration}
                disabled={working}
                placeholder="Optional"
                onChange={(event) => setUploadedDuration(event.target.value)}
              />
            </div>
          </PracticeStep>
        )}

        <div className="h-px bg-[var(--color-border)]" />

        {course ? (
          <>
            <PracticeStep
              step={3}
              title="Which topics should it cover?"
              description="Every topic is in by default. Take out anything you're already strong on, or open a topic to keep only some of it."
            >
              <PaperTopicPicker
                specificationId={course.specificationId}
                value={topicSelection}
                disabled={working}
                onChange={(selection) => setTopicState({ specificationId: course.specificationId, selection })}
              />
            </PracticeStep>
            <div className="h-px bg-[var(--color-border)]" />
          </>
        ) : null}

        {describedPath ? null : (
          <>
        <PracticeStep
          step={course ? 4 : 3}
          title={sourcesOptional ? "Add your own material?" : "Add your module material"}
          description={
            sourcesOptional
              ? "Optional. Jami already writes to your course's format and topics, modelled on its real past papers. Add notes or a teacher's paper only if you want the questions to follow them."
              : "Past papers, the module handbook and lecture notes make the paper match your exam. Jami suggests the most useful ones in this folder."
          }
        >
          {sourcesOptional ? null : loadingSources ? (
            <Skeleton className="h-16 rounded-2xl" />
          ) : (
            <PracticePaperSourcePicker
              sources={sources}
              proposedSources={proposedSources}
              automaticConfirmed={automaticSourcesConfirmed}
              selectedIds={selectedSourceIds}
              automatic={automaticSources}
              disabled={working}
              onAutomaticChange={(value) => {
                setAutomaticSources(value);
                if (value) setConfirmedAutomaticSourceIds([]);
              }}
              onConfirmAutomatic={() =>
                setConfirmedAutomaticSourceIds(proposedSourceIds)
              }
              onChange={setSelectedSourceIds}
            />
          )}
          {sourcesOptional ? (
            loadingSources ? (
              <Skeleton className="h-16 rounded-2xl" />
            ) : (
              <PracticePaperSourcePicker
                sources={sources}
                proposedSources={proposedSources}
                automaticConfirmed={false}
                selectedIds={selectedSourceIds}
                automatic={false}
                manualOnly
                disabled={working}
                onAutomaticChange={() => undefined}
                onConfirmAutomatic={() => undefined}
                onChange={setSelectedSourceIds}
              />
            )
          ) : null}
          {path === "generate" && course ? (
            <div className="rounded-2xl border border-dashed border-[var(--color-border-strong)] p-4">
              <label className="text-sm font-semibold text-text-primary" htmlFor="paper-supporting-files">
                Temporary supporting files
              </label>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                Optional PDFs, documents or images for this build only. They are removed after the paper is built.
              </p>
              <input
                id="paper-supporting-files"
                className="mt-3 block w-full text-xs text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-accent/10 file:px-3 file:py-2 file:font-semibold file:text-accent"
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,.pdf,.docx,.pptx,.txt"
                disabled={working}
                onChange={(event) => setSupportingFiles(
                  Array.from(event.target.files ?? []).slice(0, Math.max(0, MAX_PRACTICE_PAPER_SOURCE_IDS - (automaticSources ? confirmedAutomaticSourceIds.length : selectedSourceIds.length)))
                )}
              />
              {supportingFiles.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-text-muted">
                  {supportingFiles.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}
        </PracticeStep>

        <div className="h-px bg-[var(--color-border)]" />
          </>
        )}

        <PracticeStep
          step={path === "generate" && course ? 5 : 4}
          title="How do you want to sit it?"
          description="You can also switch between timed and untimed when you start the attempt."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <ChoiceCards
              label="Attempt timing"
              value={timingMode}
              options={TIMING_OPTIONS}
              disabled={working}
              onChange={setTimingMode}
            />
            <ChoiceCards
              label="Jami during the sitting"
              value={tutorChoice}
              options={TUTOR_OPTIONS}
              disabled={working}
              onChange={setTutorChoice}
            />
          </div>
        </PracticeStep>

        {working && progress !== null ? (
          <div>
            <div className="mb-2 flex justify-between text-xs font-medium text-text-muted">
              <span>Adding files</span>
              <span className="flex gap-2 tabular-nums">
                <ElapsedTime />
                <span>{progress}%</span>
              </span>
            </div>
            <ProgressBar progress={progress} size="sm" />
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t border-[var(--color-border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-sm text-xs leading-5 text-text-muted">
            Your paper opens in a notebook when it&apos;s ready, and you can leave this page while it&apos;s built. The marking guide is fixed
            before your attempt begins.
          </p>
          <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
          <Button
            type="button"
            size="lg"
            className="sm:min-w-[14rem] sm:justify-center"
            disabled={working || activeJob?.status === "needs_confirmation"}
            onClick={() =>
              void (path === "generate" ? createGenerated() : createUploaded())
            }
          >
            {working
              ? path === "generate"
                ? "Jami is building the paper..."
                : "Creating paper..."
              : clarificationQuestion
                ? "Answer and continue"
                : activeJob?.status === "needs_confirmation"
                  ? "Confirm the paper format above"
                : path === "generate"
                  ? "Generate practice paper"
                  : "Create uploaded paper"}
          </Button>
          {/* A paper is the scarcest thing a plan includes, so its count is always beside the button. */}
          {path === "generate" ? (
            <AllowanceHint allowance="papers" mode="always" className="text-center sm:text-right" />
          ) : (
            <AllowanceHint allowance="paperMarkings" mode="low" className="text-center sm:text-right" />
          )}
          </div>
        </div>
      </Card>
    </AppPage>
  );
}
