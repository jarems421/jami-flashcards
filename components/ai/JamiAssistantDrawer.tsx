"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ElementType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  formatJamiAssistantUsedContext,
  isExplicitTutorIllustrationRequest,
  JAMI_ASSISTANT_MAX_HISTORY_MESSAGES,
  type AssistantIllustration,
  type JamiAssistantCitation,
  type JamiAssistantContext,
  type JamiAssistantFollowUp,
  type JamiAssistantUsedContext,
} from "@/lib/ai/jami-assistant";
import {
  getJamiAssistantContextKey,
  getJamiAssistantSavedContext,
  type JamiAssistantThread,
} from "@/lib/ai/jami-assistant-history";
import { sendJamiAssistantMessage } from "@/services/ai/jami-assistant";
import { reportTutorialAction } from "@/lib/onboarding/tutorial";
import {
  createAssistantIllustration,
  insertAssistantIllustration,
} from "@/services/ai/assistant-illustrations";
import { useAssistantThreadList } from "@/hooks/useAssistantThreadList";
import { useVoiceDictation } from "@/hooks/useVoiceDictation";
import {
  getJamiAssistantThreadMessages,
  toDrawerMessages,
} from "@/services/ai/jami-assistant-history";
import { auth } from "@/services/firebase/client";
import {
  acknowledgeAiPrivacyNotice,
  hasAcknowledgedAiPrivacyNotice,
} from "@/services/ai/ai-privacy-notice";
import AllowanceHint from "@/components/billing/AllowanceHint";
import JamiAssistantHistory from "@/components/ai/JamiAssistantHistory";
import {
  TutorAttachButton,
  TutorMessageAttachments,
  TutorPendingAttachments,
  TutorSourceSaveCard,
} from "@/components/ai/TutorAttachments";
import { useTutorAttachments } from "@/hooks/useTutorAttachments";
import {
  selectTutorRequestAttachments,
  type TutorAttachment,
  type TutorSourceSaveOffer,
} from "@/lib/ai/tutor-attachments";
import AssistantIllustrationCard from "@/components/ai/AssistantIllustrationCard";
import TutorCardSuggestions from "@/components/ai/TutorCardSuggestions";
import TutorPracticeOffer from "@/components/ai/TutorPracticeOffer";
import type { JamiAssistantSuggestedCard } from "@/lib/ai/tutor-card-suggestions";
import type { TutorPracticeOffer as TutorPracticeOfferData } from "@/lib/ai/tutor-practice-offer";
import { drawnFigureToPng } from "@/components/ai/drawn-figure-image";
import TutorReasoningMenu from "@/components/ai/TutorReasoningMenu";
import AddAnswerToPageButton, { AddToPageIcon } from "@/components/ai/AddAnswerToPageButton";
import AssistantAnswerHold, {
  type AssistantAnswerHoldAction,
} from "@/components/ai/AssistantAnswerHold";
import AssistantAnswerBody from "@/components/ai/AssistantAnswerBody";
import { splitAssistantAnswerAtDiagram } from "@/lib/ai/assistant-answer-layout";
import {
  AssistantGraphActionsContext,
  type AssistantGraphActions,
} from "@/components/ai/AssistantGraphActions";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  JamiTutorIcon,
  StudyText,
  SymbolKeyboard,
} from "@/components/ui";
import type { NotebookImageRef } from "@/lib/workspace/notebooks";
import type { NotebookGraphDraft } from "@/lib/workspace/notebook-graphs";
import {
  CloseIcon,
  HistoryIcon,
  MicrophoneIcon,
  NewChatIcon,
  SendIcon,
  SettingsIcon,
  StopDictationIcon,
} from "@/components/ai/JamiAssistantIcons";
import TutorSettingsPanel from "@/components/ai/TutorSettingsPanel";
import TutorStudyMaterialPanel from "@/components/ai/TutorStudyMaterialPanel";
import TutorStudyMaterialSetupCard from "@/components/ai/TutorStudyMaterialSetupCard";
import FloatingTutorHeader from "@/components/ai/JamiFloatingTutorHeader";
import {
  FloatingTutorPill,
  FloatingTutorPinButton,
  FloatingTutorPinnedAnswer,
  FloatingTutorResizeFrame,
  PinIcon,
  floatingRectStyle,
  floatingTutorPanelClass,
  isCompactFloatingCard,
  MAX_PINNED_ANSWERS,
  onScreenFloatingRects,
  useFloatingTutorFrames,
} from "@/components/ai/JamiFloatingTutor";
import { featureFlags } from "@/lib/app/feature-flags";
import {
  TUTOR_STUDY_MATERIAL_KINDS,
  type TutorStudyMaterialChoice,
  type TutorStudyMaterialKind,
  type TutorStudyMaterialRequest,
  type TutorStudyMaterialResult,
  type TutorStudyMaterialSetup,
} from "@/lib/ai/tutor-study-material";

/**
 * A chip offered before the conversation starts. Most send a prompt, but a
 * surface can also offer an action that does something else entirely, such as
 * drafting flashcards from the source being discussed.
 */
/**
 * What Jami says while the student waits.
 *
 * Escalating by elapsed time rather than cycling at random, so a long wait
 * reads as progress instead of noise, and nothing claims to be nearly done
 * before it plausibly is. The last one lands well inside the 45s timeout.
 */
const WAITING_LABELS: Array<{ text: string; after: number }> = [
  { text: "Jami is locking in", after: 0 },
  { text: "Cooking", after: 4_000 },
  { text: "Ok this one is actually hard", after: 9_000 },
  { text: "Reading it again, properly this time", after: 18_000 },
  { text: "Nearly there, promise", after: 28_000 },
];

export type JamiAssistantQuickAction =
  | string
  | {
      label: string;
      prompt: string;
    }
  | {
      label: string;
      run: () => void | Promise<void>;
    };

type JamiAssistantDrawerProps = {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resetKey: string;
  contextKey: string;
  contextLabel: string;
  historyContextLabel: string;
  getContext: () => JamiAssistantContext | Promise<JamiAssistantContext>;
  quickActions?: readonly JamiAssistantQuickAction[];
  /**
   * Short note shown above the starting points, for surfaces where Jami works
   * differently from what a student would assume. Only rendered before the
   * conversation begins.
   */
  emptyStateNote?: ReactNode;
  onIllustrationInserted?: (input: {
    imageRef: NotebookImageRef;
    contentRevision: number;
  }) => void;
  onBeforeIllustrationInsert?: () => boolean | Promise<boolean>;
  /**
   * Adds a graph from an answer to the open notebook page. Resolves true once
   * it is on the page; the notebook reports its own failures.
   */
  onGraphInsert?: (graph: NotebookGraphDraft) => Promise<boolean>;
  /**
   * Adds a drawn figure from an answer to the open notebook page, as an image.
   * Resolves true once it is on the page; the notebook reports its own failures.
   */
  onDrawingInsert?: (file: File) => Promise<boolean>;
  /**
   * Adds a whole answer to the open notebook page, shown there exactly as it
   * is here: tables, headings and typeset maths. True once it is on the page;
   * the notebook reports its own failures.
   */
  onAnswerInsert?: (text: string) => boolean;
  /** Keeps a PDF or picture sent in this chat open beside the notebook page. */
  onKeepAttachmentBeside?: (attachment: TutorAttachment) => void;
  /**
   * The folders this conversation's material belongs to, when the surface
   * knows.
   *
   * Only used to tell the settings panel which folder's instructions are in
   * force. Left undefined by a surface that cannot say, and the panel then
   * explains the rule rather than asserting an answer it does not have.
   */
  settingsFolderIds?: readonly string[];
  /**
   * Controls for what this conversation reads, drawn under the header -- the
   * material picker, on surfaces that let a student choose several sources.
   * Told whether the conversation has begun, because changing the material
   * after that starts a new chat and the control should say so.
   */
  contextControls?: (state: { conversationStarted: boolean }) => ReactNode;
  /**
   * A message to send as soon as the drawer first opens: what the student
   * already typed somewhere else, such as the Tutor page's ask box. Sent once
   * per mount, so a surface that wants to send another remounts the drawer.
   */
  initialMessage?: string;
  /** Open on the list of saved chats, for a surface whose way in is "pick a chat". */
  startInHistory?: boolean;
  /**
   * How Jami sits over the work.
   *
   * `sidebar` is a full-height panel down the right. `floating` is a card the
   * student moves and resizes over a surface they are writing on, which can
   * also shrink to a pill or leave one answer pinned beside the page. Phones
   * get the full-screen sheet either way: there is no room to float.
   *
   * `page` is the whole screen at every size.
   *
   * `inline` is a card in the page itself, for a page whose point is the chat
   * -- the Tutor page. The question is typed into the page and the
   * conversation carries on in the same place, instead of the page handing
   * off to a panel or a full-screen chat the moment you send.
   */
  layout?: "sidebar" | "floating" | "page" | "inline";
};

/**
 * The frame the chat sits in: a dialog over the work, or -- inline -- a card
 * in the page. Everything inside is the same either way.
 */
const THREAD_PLACES: Record<JamiAssistantThread["surface"], string> = {
  learn: "on your flashcards",
  sources: "in your material",
  practice: "in practice",
  notebook: "in a notebook",
};

/** Where a saved chat began, in a few words: "in a notebook (Biology notes)". */
function describeThreadPlace(thread: JamiAssistantThread) {
  return `${THREAD_PLACES[thread.surface]} (${thread.contextLabel})`;
}

function TutorChatShell({
  inline,
  open,
  dialogProps,
  backdropClassName,
  panelProps,
  afterPanel,
  children,
}: {
  inline: boolean;
  open: boolean;
  dialogProps: Omit<ComponentProps<typeof Dialog>, "children" | "open">;
  backdropClassName: string;
  panelProps: ComponentProps<typeof DialogPanel>;
  afterPanel?: ReactNode;
  children: ReactNode;
}) {
  if (inline) {
    return open ? (
      <section
        aria-label="Jami chat"
        data-notebook-text-editor="true"
        className="app-panel relative flex h-[min(82dvh,58rem)] min-h-[30rem] w-full flex-col overflow-hidden rounded-3xl"
      >
        {children}
      </section>
    ) : null;
  }
  return (
    <Dialog {...dialogProps} open={open}>
      <DialogBackdrop className={backdropClassName} />
      <DialogPanel {...panelProps}>{children}</DialogPanel>
      {afterPanel}
    </Dialog>
  );
}

type DrawerMessage = {
  id?: string;
  role: "user" | "assistant";
  text: string;
  used?: JamiAssistantUsedContext[];
  followUps?: JamiAssistantFollowUp[];
  citations?: JamiAssistantCitation[];
  suggestedCards?: JamiAssistantSuggestedCard[];
  /** Live advice from the engine; shown with this answer, never saved with the chat. */
  practiceOffer?: TutorPracticeOfferData;
  illustrations?: AssistantIllustration[];
  canIllustrate?: boolean;
  studyMaterialRequest?: TutorStudyMaterialRequest;
  studyMaterialOffers?: TutorStudyMaterialKind[];
  studyMaterialResults?: Partial<Record<TutorStudyMaterialKind, TutorStudyMaterialResult>>;
  /** Tutor asked what to make first; the card under the answer is filled in here. */
  studyMaterialSetup?: TutorStudyMaterialSetup;
  /** Answered in this sitting, so material Tutor agreed to is made straight away. */
  fresh?: boolean;
  /** Files the student sent with this message. */
  attachments?: TutorAttachment[];
  /** Its files are not on a saved message yet, because the answer failed; the next one carries them. */
  attachmentsUnsaved?: boolean;
  /** Tutor's suggestion to save an attached file as a source, shown only in this sitting. */
  sourceSaveOffer?: TutorSourceSaveOffer;
};

const STUDY_MATERIAL_OFFER_LABELS: Record<TutorStudyMaterialKind, string> = {
  flashcards: "Make flashcards",
  practice: "Practice questions",
};

/** The material an answer carries: asked for, started from an offer, or already made. */
function studyMaterialKindsFor(message: DrawerMessage, started: readonly TutorStudyMaterialKind[]) {
  return TUTOR_STUDY_MATERIAL_KINDS.filter(
    (kind) =>
      message.studyMaterialRequest?.kind === kind ||
      started.includes(kind) ||
      Boolean(message.studyMaterialResults?.[kind])
  );
}

export default function JamiAssistantDrawer({
  userId,
  open,
  onOpenChange,
  resetKey,
  contextKey,
  contextLabel,
  historyContextLabel,
  getContext,
  quickActions = [],
  emptyStateNote,
  onIllustrationInserted,
  onBeforeIllustrationInsert,
  onGraphInsert,
  onDrawingInsert,
  onAnswerInsert,
  onKeepAttachmentBeside,
  settingsFolderIds,
  contextControls,
  initialMessage,
  startInHistory = false,
  layout = "sidebar",
}: JamiAssistantDrawerProps) {
  const [messages, setMessages] = useState<DrawerMessage[]>([]);
  const [input, setInput] = useState("");
  const files = useTutorAttachments(userId);
  const clearFiles = files.clear;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(startInHistory);
  const [threadLoading, setThreadLoading] = useState(false);
  const [activeThread, setActiveThread] = useState<JamiAssistantThread | null>(null);
  const [useRelatedSources, setUseRelatedSources] = useState(true);
  const [showAiNotice, setShowAiNotice] = useState(false);
  const [generatingIllustrationId, setGeneratingIllustrationId] = useState<string | null>(null);
  const [insertingIllustrationId, setInsertingIllustrationId] = useState<string | null>(null);
  const [insertedIllustrationIds, setInsertedIllustrationIds] = useState<Set<string>>(
    () => new Set()
  );
  /** Graphs already added from this conversation, keyed by their source. */
  const [insertedGraphKeys, setInsertedGraphKeys] = useState<Set<string>>(() => new Set());
  const [insertingGraphKey, setInsertingGraphKey] = useState<string | null>(null);
  /** Material the student asked for from an offer under an answer, by answer. */
  const [startedMaterial, setStartedMaterial] = useState<
    Record<string, TutorStudyMaterialKind[]>
  >({});
  /** What the student chose on a setup card, by answer: made with that, not Tutor's guess. */
  const [materialChoices, setMaterialChoices] = useState<
    Record<string, { kind: TutorStudyMaterialKind; choice: TutorStudyMaterialChoice }>
  >({});
  /** The answer just added to the page, confirmed beside it for a moment. */
  const [addedAnswerKey, setAddedAnswerKey] = useState<string | null>(null);
  /*
   * Wide screens have room for the drawer to sit beside the work rather than
   * over it. Jami is meant to nudge you towards an answer you are looking at,
   * which does not work if opening it hides the card. Below this the page is
   * too narrow to show both, so it stays a modal sheet.
   *
   * A floating card is small enough to share a tablet in portrait too, so it
   * stops being modal from there; only a phone still gets the sheet.
  */
  const [sidePanel, setSidePanel] = useState(false);
  const floating = layout === "floating" && sidePanel;
  const fullPage = layout === "page";
  const inline = layout === "inline";
  // A dialog's title names the dialog; a card in the page has none to name.
  const ChatTitle: ElementType = inline ? "h2" : DialogTitle;
  // Shrunk to a pill rather than closed, so the pill stays to bring it back.
  const [minimised, setMinimised] = useState(false);
  /*
   * The answer pinned beside the page, if any.
   *
   * Its own thing, not a state of the card. Pinning used to put the card away
   * and leave only the answer, so asking the next question meant opening the
   * chat on top of the answer it was about. The pin now stays whether the card
   * is open, shrunk or closed, until it is unpinned.
   */
  // Up to three, oldest first; each sits in its own frame slot.
  const [pinnedAnswers, setPinnedAnswers] = useState<{ slot: number; text: string }[]>([]);
  const pinned = pinnedAnswers.length > 0;
  const occupiedSlots = Array.from({ length: MAX_PINNED_ANSWERS }, (_, slot) =>
    pinnedAnswers.some((answer) => answer.slot === slot)
  );
  const { card, pins } = useFloatingTutorFrames(floating, occupiedSlots);
  const compact = floating && isCompactFloatingCard(card.rect);
  const minimise = () => {
    setMinimised(true);
    onOpenChange(false);
  };
  const pinAnswer = (text: string) => {
    if (pinnedAnswers.some((answer) => answer.text === text)) return;
    // With every slot taken, the oldest pin makes way for the new one.
    const kept =
      pinnedAnswers.length >= MAX_PINNED_ANSWERS ? pinnedAnswers.slice(1) : pinnedAnswers;
    const slot = occupiedSlots.findIndex((taken) => !taken);
    const nextSlot = slot === -1 ? pinnedAnswers[0].slot : slot;
    setPinnedAnswers([...kept, { slot: nextSlot, text }]);
    // Placed clear of the card, of every pin still on screen and of any sheet beside the page, never over one.
    const obstacles = [
      ...(open && card.rect ? [card.rect] : []),
      ...kept.flatMap((answer) => {
        const rect = pins[answer.slot].rect;
        return rect ? [rect] : [];
      }),
      ...onScreenFloatingRects("sheet"),
    ];
    if (obstacles.length > 0) pins[nextSlot].moveClearOf(obstacles);
  };
  const unpinAnswer = (slot: number) => {
    const remaining = pinnedAnswers.filter((answer) => answer.slot !== slot);
    setPinnedAnswers(remaining);
    // With the card put away, unpinning the last pin leaves the pill to bring it back.
    if (!open && remaining.length === 0) setMinimised(true);
  };
  /**
   * Settings, shown over the conversation rather than beside it.
   *
   * The drawer is already the narrowest surface in the app, so a second column
   * is not available; and settings are read and changed deliberately, not
   * glanced at mid-question. It carries its own header with a way back, so the
   * conversation is one tap away and still there when you return.
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousResetKeyRef = useRef(resetKey);
  const requestIdRef = useRef(0);
  const requestPendingRef = useRef(false);
  /**
   * The in-flight answer, so leaving can stop it.
   *
   * Bumping `requestIdRef` only made the drawer ignore what came back; the
   * route carried on generating and the request stayed charged. Dropping the
   * fetch is what actually tells the server to stop.
   */
  const requestAbortRef = useRef<AbortController | null>(null);
  const reasoningSaveRef = useRef<Promise<void>>(Promise.resolve());
  const handleReasoningSaveStarted = useCallback((save: Promise<void>) => {
    reasoningSaveRef.current = save;
  }, []);
  const abandonActiveRequest = useCallback(() => {
    requestIdRef.current += 1;
    requestPendingRef.current = false;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
  }, []);
  const normalizedQuickActions = quickActions.map((action) =>
    typeof action === "string" ? { label: action, prompt: action } : action
  );

  /*
   * Once the first words arrive there is a streamed assistant message on the
   * end of the list, so the waiting state has served its purpose.
   */
  const answerHasStarted =
    loading && messages[messages.length - 1]?.role === "assistant";

  const [waitingStage, setWaitingStage] = useState(0);

  useEffect(() => {
    if (!loading || answerHasStarted) {
      setWaitingStage(0);
      return;
    }

    // Escalates rather than cycling, so the wait reads as progress. Nothing
    // here claims to be nearly finished before it plausibly is.
    const timers = WAITING_LABELS.slice(1).map((_, index) =>
      setTimeout(() => setWaitingStage(index + 1), WAITING_LABELS[index + 1].after)
    );

    return () => timers.forEach(clearTimeout);
  }, [answerHasStarted, loading]);

  const waitingLabel = WAITING_LABELS[waitingStage].text;

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

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) return;
    previousResetKeyRef.current = resetKey;
    abandonActiveRequest();
    setMessages([]);
    setInput("");
    setLoading(false);
    setError(null);
    setHistoryNotice(null);
    setHistoryOpen(false);
    setThreadLoading(false);
    setActiveThread(null);
    setInsertedIllustrationIds(new Set());
    setInsertedGraphKeys(new Set());
    setStartedMaterial({});
    setMaterialChoices({});
    setGeneratingIllustrationId(null);
    setInsertingIllustrationId(null);
    setMinimised(false);
    setPinnedAnswers([]);
    clearFiles();
    onOpenChange(false);
  }, [abandonActiveRequest, clearFiles, onOpenChange, resetKey]);

  useEffect(() => {
    const query = window.matchMedia(
      layout === "floating" ? "(min-width: 640px)" : "(min-width: 1024px)"
    );
    const sync = () => setSidePanel(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [layout]);

  // Opening the card, from anywhere, replaces the pill it left behind.
  useEffect(() => {
    if (open) setMinimised(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [abandonActiveRequest, historyOpen, loading, messages, open, threadLoading]);

  const startNewChat = useCallback(() => {
    abandonActiveRequest();
    setMessages([]);
    setInput("");
    setLoading(false);
    setError(null);
    setHistoryNotice(null);
    setHistoryOpen(false);
    setThreadLoading(false);
    setActiveThread(null);
    setInsertedIllustrationIds(new Set());
    setInsertedGraphKeys(new Set());
    setStartedMaterial({});
    setMaterialChoices({});
    clearFiles();
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [abandonActiveRequest, clearFiles]);

  const {
    threads,
    loading: historyLoading,
    error: historyError,
    setError: setHistoryError,
    refresh: refreshThreads,
    promote: promoteThread,
    rename: renameThread,
    remove: removeThread,
  } = useAssistantThreadList({
    activeThreadId: activeThread?.id ?? null,
    onActiveThreadRemoved: startNewChat,
  });

  useEffect(() => {
    if (!open) return;
    void refreshThreads();
  }, [open, refreshThreads]);

  /**
   * Renaming the open chat has to rename it in the header too, not just in the
   * saved list the hook owns.
   */
  const handleRenameThread = useCallback(
    async (thread: JamiAssistantThread, title: string) => {
      const renamedTitle = await renameThread(thread, title);
      setActiveThread((current) =>
        current?.id === thread.id ? { ...current, title: renamedTitle } : current
      );
    },
    [renameThread]
  );

  const openThread = useCallback(async (thread: JamiAssistantThread) => {
    const user = auth.currentUser;
    if (!user) {
      setHistoryError("Sign in again to open your saved chats.");
      return;
    }
    abandonActiveRequest();
    setThreadLoading(true);
    setHistoryError(null);
    setError(null);
    setHistoryNotice(null);
    try {
      const storedMessages = await getJamiAssistantThreadMessages(user.uid, thread.id);
      setMessages(toDrawerMessages(storedMessages));
      setActiveThread(thread);
      setHistoryOpen(false);
    } catch (loadError) {
      setHistoryError(
        loadError instanceof Error
          ? loadError.message
          : "That chat could not be opened."
      );
    } finally {
      setThreadLoading(false);
    }
  }, [abandonActiveRequest, setHistoryError]);

  const viewingForeignThread =
    activeThread !== null && activeThread.contextKey !== contextKey;
  const latestCurrentThread = threads.find(
    (thread) => thread.contextKey === contextKey && thread.id !== activeThread?.id
  );

  const requestIllustration = useCallback(
    async (input: {
      threadId: string;
      messageId: string;
      context?: JamiAssistantContext;
    }) => {
      if (generatingIllustrationId) return;
      setGeneratingIllustrationId(input.messageId);
      setError(null);
      try {
        const context = input.context ?? (await getContext());
        if (getJamiAssistantContextKey(getJamiAssistantSavedContext(context)) !== contextKey) {
          throw new Error("The study context changed. Open Jami again and retry.");
        }
        const illustration = await createAssistantIllustration({
          ...input,
          context,
        });
        setMessages((current) =>
          current.map((message) =>
            message.id === input.messageId
              ? {
                  ...message,
                  illustrations: [...(message.illustrations ?? []), illustration],
                }
              : message
          )
        );
      } catch (illustrationError) {
        setError(
          illustrationError instanceof Error
            ? illustrationError.message
            : "Jami could not create that visual just now."
        );
      } finally {
        setGeneratingIllustrationId(null);
      }
    },
    [contextKey, generatingIllustrationId, getContext]
  );

  const addIllustrationToPage = useCallback(
    async (message: DrawerMessage, illustration: AssistantIllustration) => {
      if (!message.id || insertingIllustrationId) return;
      setInsertingIllustrationId(illustration.id);
      setError(null);
      try {
        const context = await getContext();
        if (context.surface !== "notebook") {
          throw new Error("Open a notebook page before adding this visual.");
        }
        if (getJamiAssistantContextKey(getJamiAssistantSavedContext(context)) !== contextKey) {
          throw new Error("The notebook page changed. Add the visual from the page you want it on.");
        }
        const ready = await onBeforeIllustrationInsert?.();
        if (ready === false) {
          throw new Error("Save this page before adding the visual.");
        }
        const inserted = await insertAssistantIllustration({
          illustration,
          messageId: message.id,
          notebookId: context.notebookId,
          pageId: context.pageId,
        });
        setInsertedIllustrationIds((current) => {
          const next = new Set(current);
          next.add(illustration.id);
          return next;
        });
        onIllustrationInserted?.(inserted);
      } catch (insertError) {
        setError(
          insertError instanceof Error
            ? insertError.message
            : "That visual could not be added to this page."
        );
      } finally {
        setInsertingIllustrationId(null);
      }
    },
    [
      contextKey,
      getContext,
      insertingIllustrationId,
      onBeforeIllustrationInsert,
      onIllustrationInserted,
    ]
  );

  /**
   * The context material is made from, checked against the chat it belongs
   * to: a student who has turned the page since must not have flashcards for
   * the new page filed against the old conversation.
   */
  const getStudyMaterialContext = useCallback(async () => {
    const context = await getContext();
    if (getJamiAssistantContextKey(getJamiAssistantSavedContext(context)) !== contextKey) {
      throw new Error("The study context changed. Open Jami again and retry.");
    }
    return context;
  }, [contextKey, getContext]);

  const recordStudyMaterialResult = useCallback(
    (messageId: string, result: TutorStudyMaterialResult) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                studyMaterialResults: {
                  ...message.studyMaterialResults,
                  [result.kind]: result,
                },
              }
            : message
        )
      );
    },
    []
  );

  const startStudyMaterial = (messageId: string, kind: TutorStudyMaterialKind) =>
    setStartedMaterial((current) => ({
      ...current,
      [messageId]: Array.from(new Set([...(current[messageId] ?? []), kind])),
    }));

  const makeFromSetup = (
    messageId: string,
    kind: TutorStudyMaterialKind,
    choice: TutorStudyMaterialChoice
  ) => {
    setMaterialChoices((current) => ({ ...current, [messageId]: { kind, choice } }));
    startStudyMaterial(messageId, kind);
  };

  const graphActions: AssistantGraphActions = {
    canInsert: Boolean(onGraphInsert) && contextKey.startsWith("notebook:") && !viewingForeignThread,
    insertingKey: insertingGraphKey,
    isInserted: (key) => insertedGraphKeys.has(key),
    insert: (key, graph) => {
      if (!onGraphInsert || insertingGraphKey) return;
      setInsertingGraphKey(key);
      void onGraphInsert(graph)
        .then((added) => {
          if (added) setInsertedGraphKeys((current) => new Set(current).add(key));
        })
        .finally(() => setInsertingGraphKey(null));
    },
    canInsertDrawing:
      Boolean(onDrawingInsert) && contextKey.startsWith("notebook:") && !viewingForeignThread,
    insertDrawing: (key, svg) => {
      if (!onDrawingInsert || insertingGraphKey) return;
      setInsertingGraphKey(key);
      setError(null);
      void drawnFigureToPng(svg)
        .then((file) => onDrawingInsert(file))
        .then((added) => {
          if (added) setInsertedGraphKeys((current) => new Set(current).add(key));
        })
        .catch((drawError: unknown) =>
          setError(
            drawError instanceof Error
              ? drawError.message
              : "That figure could not be added to this page."
          )
        )
        .finally(() => setInsertingGraphKey(null));
    },
  };

  const canInsertAnswer =
    Boolean(onAnswerInsert) && contextKey.startsWith("notebook:") && !viewingForeignThread;

  useEffect(() => {
    if (!addedAnswerKey) return;
    const timer = window.setTimeout(() => setAddedAnswerKey(null), 2400);
    return () => window.clearTimeout(timer);
  }, [addedAnswerKey]);

  const addAnswerToPage = useCallback(
    (message: DrawerMessage, key: string) => {
      if (!onAnswerInsert) return;
      setError(null);
      // An answer with an illustration shows the picture in place of its own
      // sketch, which has its own button; the page gets the words around it.
      const text = message.illustrations?.length
        ? (() => {
            const layout = splitAssistantAnswerAtDiagram(message.text);
            return [layout.before, layout.after].filter(Boolean).join("\n\n");
          })()
        : message.text;
      if (onAnswerInsert(text)) setAddedAnswerKey(key);
    },
    [onAnswerInsert]
  );

  /** What pressing and holding an answer offers: the buttons under it, larger. */
  const answerHoldActions = (message: DrawerMessage, key: string) => {
    const actions: AssistantAnswerHoldAction[] = [];
    if (canInsertAnswer) {
      actions.push({
        id: "add-to-page",
        label: "Add to page",
        icon: <AddToPageIcon />,
        onSelect: () => addAnswerToPage(message, key),
      });
    }
    if (floating) {
      actions.push({
        id: "pin",
        label: "Keep beside page",
        icon: <PinIcon className="h-4 w-4" />,
        onSelect: () => pinAnswer(message.text),
      });
    }
    return actions;
  };

  const sendMessage = useCallback(
    async (rawMessage: string) => {
      const typed = rawMessage.trim();
      if ((!typed && !files.ready) || files.uploading || requestPendingRef.current) return;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      requestPendingRef.current = true;
      const abortController = new AbortController();
      requestAbortRef.current = abortController;
      const sentFiles = files.take();
      const message = typed || "Take a look at what I've attached.";
      const { files: requestFiles, newCount: newAttachmentCount } = selectTutorRequestAttachments({
        messages,
        sentFiles,
        message,
      });
      setMessages((current) => [
        ...current,
        {
          role: "user",
          text: message,
          ...(sentFiles.length > 0 ? { attachments: sentFiles, attachmentsUnsaved: true } : {}),
        },
      ]);
      setInput("");
      setLoading(true);
      setError(null);
      setHistoryNotice(null);

      // Tracks whether a streamed placeholder message is on screen, so it can
      // be settled on success or cleared if generation fails part-way through.
      let streaming = false;

      try {
        // A student can change this immediately before sending. Wait for that
        // small preference write so this message uses the level shown in the
        // composer rather than the previous one from their account.
        await reasoningSaveRef.current;
        const context = await getContext();
        const savedContext = getJamiAssistantSavedContext(context);
        const resolvedContextKey = getJamiAssistantContextKey(savedContext);
        if (resolvedContextKey !== contextKey) {
          throw new Error("The study context changed. Open Jami again and retry.");
        }
        // The answer streams in, so a placeholder is appended on the first
        // chunk and then updated in place. The receipt and follow-ups only
        // arrive once the whole response has been validated.
        const response = await sendJamiAssistantMessage(
          {
            message,
            history: messages
              .slice(-JAMI_ASSISTANT_MAX_HISTORY_MESSAGES)
              .map((historyMessage) => ({
                role:
                  historyMessage.role === "assistant"
                    ? ("model" as const)
                    : ("user" as const),
                text: historyMessage.text,
              })),
            context,
            useRelatedSources,
            threadId: activeThread?.id,
            contextLabel: historyContextLabel,
            ...(requestFiles.length > 0
              ? {
                  attachments: requestFiles,
                  newAttachmentCount,
                }
              : {}),
          },
          (textSoFar) => {
            if (requestIdRef.current !== requestId) return;
            setMessages((current) => {
              if (!streaming) {
                streaming = true;
                return [...current, { role: "assistant", text: textSoFar }];
              }
              const next = [...current];
              next[next.length - 1] = { ...next[next.length - 1], text: textSoFar };
              return next;
            });
          },
          abortController.signal
        );

        if (requestIdRef.current !== requestId) return;
        const assistantMessage: DrawerMessage = {
          role: "assistant",
          text: response.reply,
          used: response.used,
          followUps: response.followUps,
          citations: response.citations,
          suggestedCards: response.suggestedCards,
          practiceOffer: response.practiceOffer,
          canIllustrate: response.canIllustrate,
          studyMaterialRequest: response.studyMaterialRequest,
          studyMaterialOffers: response.studyMaterialOffers,
          studyMaterialSetup: response.studyMaterialSetup,
          sourceSaveOffer: response.sourceSaveOffer,
          fresh: true,
        };
        // Settle on the validated reply, replacing the streamed placeholder
        // rather than trusting the deltas that produced it. Every file sent so
        // far is now on a saved message.
        setMessages((current) =>
          (streaming ? [...current.slice(0, -1), assistantMessage] : [...current, assistantMessage]).map(
            (entry) => (entry.attachmentsUnsaved ? { ...entry, attachmentsUnsaved: false } : entry)
          )
        );
        if (context.surface === "notebook") {
          reportTutorialAction("ask-tutor", {
            notebookId: context.notebookId,
          });
        }

        const savedThread = response.savedThread;
        if (savedThread) {
          try {
            if (requestIdRef.current !== requestId) return;
            const savedMessageId = savedThread.lastAssistantMessageId;
            setActiveThread(savedThread);
            promoteThread(savedThread);
            if (savedMessageId) {
              setMessages((current) => {
                const next = [...current];
                const finalIndex = next.length - 1;
                if (next[finalIndex]?.role === "assistant") {
                  next[finalIndex] = { ...next[finalIndex], id: savedMessageId };
                }
                return next;
              });
              if (
                response.canIllustrate &&
                isExplicitTutorIllustrationRequest(message)
              ) {
                void requestIllustration({
                  threadId: savedThread.id,
                  messageId: savedMessageId,
                  context,
                });
              }
            }
          } catch {
            // The answer already reached the student; only persisting it to
            // history failed. That is reported in the drawer rather than
            // thrown, so a history outage cannot discard a good reply.
            if (requestIdRef.current === requestId) {
              setHistoryNotice(
                "Jami answered, but this turn could not be added to chat history."
              );
            }
          }
        }
      } catch (requestError) {
        if (requestIdRef.current !== requestId) return;
        // Abandoning the answer is something the student did; it is not a
        // failure to report back to them.
        if (abortController.signal.aborted) return;
        // Drop any partially streamed answer so an incomplete reply is not
        // left sitting above the error.
        if (streaming) setMessages((current) => current.slice(0, -1));
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Jami could not answer that just now. Please try again."
        );
      } finally {
        if (requestAbortRef.current === abortController) {
          requestAbortRef.current = null;
        }
        if (requestIdRef.current === requestId) {
          requestPendingRef.current = false;
          setLoading(false);
        }
      }
    },
    [
      activeThread,
      contextKey,
      getContext,
      promoteThread,
      historyContextLabel,
      messages,
      useRelatedSources,
      requestIllustration,
      files,
    ]
  );

  /*
   * What the student already asked somewhere else, sent once the drawer is
   * open to hold the answer. After the render, not during it: sending starts
   * a request and sets state, which a render must not do.
   */
  const sentInitialRef = useRef(false);
  // Inline there is no dialog to move focus, so the reply box takes it when
  // the chat opens, ready for the next question, without scrolling the page.
  useEffect(() => {
    if (inline && open) inputRef.current?.focus({ preventScroll: true });
  }, [inline, open]);
  useEffect(() => {
    if (!open || !initialMessage || sentInitialRef.current) return;
    sentInitialRef.current = true;
    void Promise.resolve().then(() => sendMessage(initialMessage));
  }, [initialMessage, open, sendMessage]);

  const dictation = useVoiceDictation({ onText: setInput, onError: setError });

  /**
   * Sends what is in the box, whether it was typed or spoken.
   *
   * Dictation is stopped first and its own reading of the box is used, because
   * words the recogniser settles in the same tick as the send would otherwise
   * be lost: `input` is a render behind at that moment.
   */
  const submitComposer = useCallback(() => {
    const text = dictation.listening ? dictation.stop() : input;
    void sendMessage(text);
  }, [dictation, input, sendMessage]);

  const toggleDictation = useCallback(() => {
    if (dictation.listening) {
      dictation.stop();
      inputRef.current?.focus();
      return;
    }
    setError(null);
    dictation.start(input);
  }, [dictation, input]);

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitComposer();
    }
  };

  return (
    <>
    <TutorChatShell
      inline={inline}
      open={open && (!floating || card.rect !== null)}
      dialogProps={{
        modal: fullPage || !sidePanel,
        initialFocusRef: inputRef,
        className: `fixed inset-0 flex ${fullPage ? "justify-center" : "justify-end"} ${
          sidePanel && !fullPage ? "pointer-events-none" : ""
        }`,
        onDismiss: () => onOpenChange(false),
      }}
      backdropClassName={
        fullPage ? "absolute inset-0 bg-[var(--color-surface-base)]" : "absolute inset-0 bg-black/55 backdrop-blur-[1px]"
      }
      panelProps={{
        "data-notebook-text-editor": "true",
        ...(floating ? { "data-floating-panel": "tutor" } : {}),
        className: floating
          ? floatingTutorPanelClass(card)
          : fullPage
            ? "pointer-events-auto relative flex h-[100dvh] max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden bg-[var(--color-surface-panel-strong)] md:border-x md:border-[var(--color-border)]"
            : "pointer-events-auto relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[32rem] flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] shadow-shell",
        /*
          The panel colour is a few percent translucent, which reads as depth
          over the scrim but lets the card show through once the scrim is gone.
          As a side panel it sits on an opaque base so the same colour stays,
          and the work behind it does not bleed into the conversation.
        */
        style:
          sidePanel || fullPage
            ? {
                ...(floating && card.rect ? floatingRectStyle(card.rect) : null),
                backgroundColor: "var(--color-surface-base)",
                backgroundImage:
                  "linear-gradient(var(--color-surface-panel-strong), var(--color-surface-panel-strong))",
              }
            : undefined,
        ...(floating ? card.bodyDragProps : {}),
      } as ComponentProps<typeof DialogPanel>}
      afterPanel={floating ? <FloatingTutorResizeFrame frame={card} /> : null}
    >
        {floating ? (
          <FloatingTutorHeader
            frame={card}
            subtitle={
              historyOpen ? "Chat history" : viewingForeignThread ? "Carrying on a saved chat" : contextLabel
            }
            compact={compact}
            historyOpen={historyOpen}
            onToggleHistory={() => setHistoryOpen((current) => !current)}
            onNewChat={startNewChat}
            onOpenSettings={
              featureFlags.enableTutorPersonalisation ? () => setSettingsOpen(true) : undefined
            }
            folderSources={{
              on: useRelatedSources,
              onToggle: () => setUseRelatedSources((current) => !current),
            }}
            onMinimise={minimise}
            onClose={() => onOpenChange(false)}
          />
        ) : (
        <header className="border-b border-[var(--color-border)] px-4 py-3.5 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
                <JamiTutorIcon className="h-[1.35rem] w-[1.35rem]" />
              </div>
              <div className="min-w-0">
                <ChatTitle className="text-base font-semibold leading-tight text-text-primary">
                  Jami
                </ChatTitle>
                <p className="mt-0.5 truncate text-xs text-text-muted">
                  {historyOpen
                    ? "Chat history"
                    : viewingForeignThread
                      ? "Carrying on a saved chat"
                      : contextLabel}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {featureFlags.enableTutorPersonalisation ? (
                <button
                  type="button"
                  aria-label="Open Jami settings"
                  title="Jami settings"
                  className="inline-grid h-10 w-10 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                  onClick={() => setSettingsOpen(true)}
                >
                  <SettingsIcon />
                </button>
              ) : null}
              <button
                type="button"
                aria-label={historyOpen ? "Return to current Jami chat" : "Open Jami chat history"}
                title={historyOpen ? "Current chat" : "Chat history"}
                className={`inline-grid h-10 w-10 place-items-center rounded-full transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                  historyOpen
                    ? "bg-accent/12 text-accent"
                    : "text-text-muted hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                }`}
                onClick={() => setHistoryOpen((current) => !current)}
              >
                <HistoryIcon />
              </button>
              <button
                type="button"
                aria-label="Start a new Jami chat"
                title="New chat"
                className="inline-grid h-10 w-10 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                onClick={startNewChat}
              >
                <NewChatIcon />
              </button>
              <button
                type="button"
                aria-label="Close Jami assistant"
                title="Close"
                className="inline-grid h-10 w-10 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                onClick={() => onOpenChange(false)}
              >
                <CloseIcon />
              </button>
            </div>
          </div>
        </header>
        )}

        {contextControls && !historyOpen && !viewingForeignThread ? (
          <div className={`border-b border-[var(--color-border)] ${compact ? "px-4 py-2.5" : "px-5 py-3 sm:px-7"}`}>
            {contextControls({ conversationStarted: messages.length > 0 })}
          </div>
        ) : null}

        <div
          ref={scrollRef}
          className={`min-h-0 flex-1 overflow-y-auto ${compact ? "px-4 py-4" : "px-5 py-5 sm:px-7 sm:py-6"}`}
        >
          {historyOpen ? (
            <JamiAssistantHistory
              threads={threads}
              loading={historyLoading}
              error={historyError}
              onOpen={(thread) => void openThread(thread)}
              onNew={startNewChat}
              onRename={handleRenameThread}
              onDelete={removeThread}
            />
          ) : threadLoading ? (
            <div className="flex min-h-full items-center justify-center gap-2 text-sm text-text-muted" role="status">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
              Opening chat
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-full flex-col justify-center py-5">
              <div className="mx-auto max-w-sm text-center">
                <h3 className="text-lg font-semibold text-text-primary">
                  How can I help?
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  Ask about what you are studying, or choose a useful starting point.
                </p>
                {emptyStateNote ? (
                  <p className="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-2 text-xs leading-5 text-text-muted">
                    {emptyStateNote}
                  </p>
                ) : null}
              </div>
              {latestCurrentThread ? (
                <button
                  type="button"
                  className="mx-auto mt-5 flex max-w-full items-center gap-2 rounded-full border border-accent/25 bg-accent/8 px-3.5 py-2 text-xs font-medium text-accent transition duration-fast hover:border-accent/40 hover:bg-accent/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                  onClick={() => void openThread(latestCurrentThread)}
                >
                  <HistoryIcon />
                  <span className="truncate">Continue {latestCurrentThread.title}</span>
                </button>
              ) : null}
              {normalizedQuickActions.length > 0 ? (
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {normalizedQuickActions.map((action) => (
                    <button
                      key={"prompt" in action ? `${action.label}:${action.prompt}` : action.label}
                      type="button"
                      disabled={loading}
                      className="app-chip rounded-full px-3.5 py-2 text-xs font-medium text-text-secondary transition duration-fast hover:border-border-strong hover:bg-[var(--color-glass-medium)] hover:text-text-primary disabled:cursor-not-allowed disabled:saturate-[0.82]"
                      onClick={() =>
                        "prompt" in action ? void sendMessage(action.prompt) : void action.run()
                      }
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            // Selectable even over a notebook, which otherwise cancels native
            // selection, so an answer can be copied into a text box on the page.
            <div className="space-y-4" aria-live="polite" data-notebook-selectable-text="true">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className="max-w-[90%]">
                    {message.role === "user" && message.attachments?.length ? (
                      <TutorMessageAttachments
                        attachments={message.attachments}
                        previewUrlFor={files.sentPreviewUrl}
                        onKeepBeside={onKeepAttachmentBeside}
                      />
                    ) : null}
                      {message.role === "assistant" ? (
                        <AssistantAnswerHold
                          enabled={!(loading && index === messages.length - 1)}
                          actions={answerHoldActions(message, message.id ?? `index-${index}`)}
                          className="rounded-xl rounded-bl-md border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3 text-sm leading-relaxed text-text-primary"
                        >
                        <AssistantGraphActionsContext.Provider value={graphActions}>
                        <AssistantAnswerBody
                          text={message.text}
                          illustrations={message.illustrations ?? []}
                          renderIllustration={(illustration) => (
                            <AssistantIllustrationCard
                              key={illustration.id}
                              illustration={illustration}
                              canInsert={
                                Boolean(onIllustrationInserted) &&
                                contextKey.startsWith("notebook:") &&
                                !viewingForeignThread
                              }
                              inserted={insertedIllustrationIds.has(illustration.id)}
                              inserting={insertingIllustrationId === illustration.id}
                              onInsert={() =>
                                void addIllustrationToPage(message, illustration)
                              }
                            />
                          )}
                        />
                        </AssistantGraphActionsContext.Provider>
                        </AssistantAnswerHold>
                      ) : (
                        <div className="rounded-xl rounded-br-md bg-accent px-4 py-3 text-sm leading-relaxed text-accent-on">
                          <StudyText
                            text={message.text}
                            className="select-text whitespace-pre-wrap"
                          />
                        </div>
                      )}
                    {message.role === "assistant" && message.sourceSaveOffer && !viewingForeignThread ? (
                      <TutorSourceSaveCard
                        userId={userId}
                        offer={message.sourceSaveOffer}
                        fileFor={files.sentFile}
                        defaultFolderId={settingsFolderIds?.[0]}
                      />
                    ) : null}
                    {message.role === "assistant" ? (
                      <>
                        {/* The pin shares the sources line rather than taking a row of its own. */}
                        <div className="mt-1.5 flex items-start gap-2 px-1">
                          <div className="min-w-0 flex-1 text-2xs leading-relaxed text-text-muted">
                            {message.used && message.used.length > 0
                              ? formatJamiAssistantUsedContext(message.used)
                              : "Used: General knowledge"}
                          </div>
                          {canInsertAnswer && !(loading && index === messages.length - 1) ? (
                            <AddAnswerToPageButton
                              added={addedAnswerKey === (message.id ?? `index-${index}`)}
                              onAdd={() =>
                                addAnswerToPage(message, message.id ?? `index-${index}`)
                              }
                            />
                          ) : null}
                          {floating && !(loading && index === messages.length - 1) ? (
                            <FloatingTutorPinButton onPin={() => pinAnswer(message.text)} />
                          ) : null}
                        </div>
                        {message.citations?.length ? (
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1" aria-label="Web sources">
                            {message.citations.map((citation) => (
                              <a
                                key={citation.url}
                                href={citation.url}
                                target="_blank"
                                rel="noreferrer"
                                className="max-w-full truncate text-2xs font-medium text-accent underline-offset-2 hover:underline"
                              >
                                {citation.title}
                              </a>
                            ))}
                          </div>
                        ) : null}
                        {message.suggestedCards?.length ? (
                          <TutorCardSuggestions
                            userId={userId}
                            cards={message.suggestedCards}
                          />
                        ) : null}
                        {/* Once per conversation: the first answer that carries this advice. */}
                        {message.practiceOffer &&
                        messages.findIndex(
                          (candidate) =>
                            candidate.practiceOffer?.actionId === message.practiceOffer?.actionId
                        ) === index ? (
                          <TutorPracticeOffer userId={userId} offer={message.practiceOffer} />
                        ) : null}
                        {message.canIllustrate &&
                        !message.illustrations?.length &&
                        message.id &&
                        activeThread &&
                        !viewingForeignThread ? (
                          <div className="mt-2 px-1">
                            <button
                              type="button"
                              disabled={generatingIllustrationId !== null}
                              className="rounded-full border border-accent/25 bg-accent/8 px-2.5 py-1 text-2xs font-semibold text-accent transition hover:border-accent/40 hover:bg-accent/12 disabled:cursor-wait disabled:opacity-60"
                              onClick={() => {
                                void requestIllustration({
                                  threadId: activeThread.id,
                                  messageId: message.id!,
                                });
                              }}
                            >
                              {generatingIllustrationId === message.id
                                ? "Creating visual..."
                                : "Show visually"}
                            </button>
                          </div>
                        ) : null}
                        {message.studyMaterialSetup &&
                        message.id &&
                        activeThread &&
                        !viewingForeignThread &&
                        studyMaterialKindsFor(message, startedMaterial[message.id] ?? []).length === 0 ? (
                          <TutorStudyMaterialSetupCard
                            setup={message.studyMaterialSetup}
                            onMake={(kind, choice) => makeFromSetup(message.id!, kind, choice)}
                          />
                        ) : null}
                        {message.id && activeThread
                          ? studyMaterialKindsFor(message, startedMaterial[message.id] ?? []).map((kind) => (
                              <TutorStudyMaterialPanel
                                key={`${message.id}:${kind}`}
                                userId={userId}
                                kind={kind}
                                threadId={activeThread.id}
                                messageId={message.id!}
                                focus={
                                  materialChoices[message.id!]?.kind === kind
                                    ? materialChoices[message.id!]!.choice.focus
                                    : message.studyMaterialRequest?.kind === kind
                                      ? message.studyMaterialRequest.focus
                                      : undefined
                                }
                                {...(materialChoices[message.id!]?.kind === kind
                                  ? { choice: materialChoices[message.id!]!.choice }
                                  : {})}
                                result={message.studyMaterialResults?.[kind]}
                                readOnly={viewingForeignThread}
                                // Offers always start on the press; a request only in the sitting it was made.
                                autoStart={Boolean(message.fresh) || (startedMaterial[message.id!] ?? []).includes(kind)}
                                getContext={getStudyMaterialContext}
                                onResult={(result) => recordStudyMaterialResult(message.id!, result)}
                              />
                            ))
                          : null}
                        {index === messages.length - 1 && !loading
                          ? (() => {
                              const offers =
                                message.id && activeThread && !viewingForeignThread
                                  ? (message.studyMaterialOffers ?? []).filter(
                                      (kind) =>
                                        !studyMaterialKindsFor(
                                          message,
                                          startedMaterial[message.id!] ?? []
                                        ).includes(kind)
                                    )
                                  : [];
                              if (!message.followUps?.length && offers.length === 0) return null;
                              return (
                                <div className="mt-2 flex flex-wrap gap-1.5 px-1">
                                  {message.followUps?.map((followUp) => (
                                    <button
                                      key={`${followUp.label}:${followUp.prompt}`}
                                      type="button"
                                      className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-2xs font-medium text-text-muted transition duration-fast hover:border-border-strong hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                                      onClick={() => void sendMessage(followUp.prompt)}
                                    >
                                      {followUp.label}
                                    </button>
                                  ))}
                                  {/*
                                    Offers to make something, set apart from the
                                    prompts beside them: those ask Tutor a
                                    question, these make material to keep.
                                  */}
                                  {offers.map((kind) => (
                                    <button
                                      key={`offer:${kind}`}
                                      type="button"
                                      className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/8 px-2.5 py-1 text-2xs font-semibold text-accent transition duration-fast hover:border-accent/40 hover:bg-accent/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                                      onClick={() => startStudyMaterial(message.id!, kind)}
                                    >
                                      <JamiTutorIcon className="h-3 w-3" />
                                      {STUDY_MATERIAL_OFFER_LABELS[kind]}
                                    </button>
                                  ))}
                                </div>
                              );
                            })()
                          : null}
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
              {/*
                Only shown until the first words arrive. These models think
                before they write, so there is a silent gap that streaming
                cannot fill, and once text is streaming the dots would be
                competing with it.
              */}
              {loading && !answerHasStarted ? (
                <div className="flex justify-start">
                  <div className="app-chip rounded-xl rounded-bl-md px-4 py-3 text-sm text-text-muted" role="status">
                    <span className="inline-flex items-center gap-2">
                      <span key={waitingLabel} className="ai-waiting-label inline-block">
                        {waitingLabel}
                      </span>
                      <span className="ai-thinking-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {showAiNotice && !historyOpen ? (
          // Floating, the notice scrolls and gives way first, so the composer always fits the card.
          <div className={`mx-5 mb-0 rounded-xl border border-accent/20 bg-accent/8 px-3.5 py-3 text-xs leading-5 text-text-secondary sm:mx-7 ${floating ? "max-h-32 min-h-[4.5rem] overflow-y-auto" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <p>
                When you use Jami, relevant work may be processed through OpenRouter
                by Xiaomi, MiniMax or Moonshot under no-retention controls. Google
                handles source documents, optional web checks and visuals. Web search
                is used only when current or course-specific information needs
                checking, and private student work is never put into a search query.
                When you submit a formal paper, Jami keeps a private frozen copy of
                the paper, marking guide and your answers until that attempt is deleted
                so marking and later rechecks use the same evidence.
                This notice explains how Jami processes a request. Avoid personal details
                and check important answers because AI can make mistakes.
              </p>
              <button
                type="button"
                className="shrink-0 font-semibold text-accent hover:underline"
                onClick={dismissAiNotice}
              >
                I understand
              </button>
            </div>
          </div>
        ) : null}

        <footer
          className={`shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] ${
            compact
              ? "px-3 pb-3 pt-3"
              : "px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-7 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]"
          }`}
        >
          {historyOpen ? (
            <div className="text-center text-2xs text-text-muted">
              Saved chats keep their messages and the files you attached, not notebook snapshots.
            </div>
          ) : (
            <>
          {viewingForeignThread ? (
            <p className="mb-3 rounded-lg border border-accent/20 bg-accent/8 px-3.5 py-2.5 text-2xs leading-relaxed text-text-secondary">
              This chat started {activeThread ? describeThreadPlace(activeThread) : "somewhere else"}. Carry on here and Jami picks it up, now with {historyContextLabel} in front of it.
            </p>
          ) : null}
          {error ? (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-error/35 bg-error-muted px-3.5 py-3 text-xs text-[var(--color-error-text)]" role="alert">
              <span className="leading-relaxed">{error}</span>
              <button
                type="button"
                className="shrink-0 font-semibold underline decoration-current/40 underline-offset-2"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {historyNotice ? (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-warning/30 bg-warning-muted px-3.5 py-3 text-xs text-text-secondary" role="status">
              <span className="leading-relaxed">{historyNotice}</span>
              <button
                type="button"
                className="shrink-0 font-semibold underline decoration-current/40 underline-offset-2"
                onClick={() => setHistoryNotice(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {files.notice ? (
            <p className="mb-2 px-1 text-2xs text-text-muted" role="status">
              {files.notice}
            </p>
          ) : null}
          <div
            className="relative rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-panel)] shadow-e1 transition duration-fast focus-within:border-accent/55 focus-within:ring-2 focus-within:ring-accent/15"
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("Files")) event.preventDefault();
            }}
            onDrop={(event) => {
              const dropped = Array.from(event.dataTransfer.files);
              if (dropped.length === 0) return;
              event.preventDefault();
              if (!loading) files.add(dropped);
            }}
          >
            <TutorPendingAttachments items={files.pending} onRemove={files.remove} />
            <label htmlFor="jami-assistant-message" className="sr-only">
              Message Jami
            </label>
            <textarea
              ref={inputRef}
              id="jami-assistant-message"
              data-notebook-text-editor="true"
              rows={compact ? 1 : 2}
              value={input}
              disabled={loading}
              placeholder="Ask Jami..."
              className={`${compact ? "min-h-[3rem]" : "min-h-[5.75rem]"} w-full resize-none bg-transparent pb-2 pl-4 pr-4 pt-3 text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted focus-visible:outline-none focus-visible:shadow-none disabled:cursor-not-allowed disabled:saturate-[0.82]`}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              onPaste={(event) => {
                // A pasted screenshot is attached; pasted text is typed as usual.
                const pasted = Array.from(event.clipboardData.files);
                if (pasted.length === 0) return;
                event.preventDefault();
                files.add(pasted);
              }}
            />
            <div className="flex items-center justify-between gap-3 px-2 pb-2">
              <TutorReasoningMenu
                userId={userId}
                disabled={loading}
                onSaveStarted={handleReasoningSaveStarted}
                onError={setError}
              />
              <div className="flex items-center gap-1.5">
                {/*
                  In the composer's own toolbar rather than floating over the
                  text: this row already holds the other things you do to a
                  message before sending it.
                */}
                <TutorAttachButton disabled={loading} onFiles={files.add} />
                <SymbolKeyboard targetRef={inputRef} />
                {dictation.supported ? (
                  <button
                    type="button"
                    aria-label={dictation.listening ? "Stop dictating" : "Dictate your message"}
                    aria-pressed={dictation.listening}
                    disabled={loading}
                    className={`inline-grid h-9 w-9 place-items-center rounded-full transition duration-fast active:scale-95 disabled:cursor-not-allowed disabled:text-text-muted disabled:shadow-none ${
                      dictation.listening
                        ? "bg-error text-white shadow-e1 hover:brightness-110"
                        : "text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                    }`}
                    onClick={toggleDictation}
                  >
                    {dictation.listening ? <StopDictationIcon /> : <MicrophoneIcon />}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Send message to Jami"
                  disabled={
                    loading ||
                    files.uploading ||
                    (!input.trim() && !dictation.listening && !files.ready)
                  }
                  className="inline-grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-on shadow-accent transition duration-fast hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:bg-[var(--color-glass-medium)] disabled:text-text-muted disabled:shadow-none"
                  onClick={submitComposer}
                >
                  <SendIcon />
                </button>
              </div>
            </div>
          </div>
          {/* Silent until the month's questions are nearly gone, as ChatGPT does it. */}
          <AllowanceHint allowance="tutor" mode="low" className="mt-2 px-1" />
          {dictation.listening ? (
            <p
              className="mt-2 flex items-center gap-2 px-1 text-xs text-text-secondary"
              role="status"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-error"
              />
              <span>Listening. Stop to edit what you said, or send it straight away.</span>
            </p>
          ) : null}

          {compact ? (
            <p className="mt-1.5 px-1 text-2xs text-text-muted">
              Jami can make mistakes. Check important answers.
            </p>
          ) : (
          <div className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <details className="group min-w-0 flex-1 basis-[15rem] text-xs text-text-muted">
              <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 rounded-full px-1.5 font-medium transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 [&::-webkit-details-marker]:hidden">
                {/*
                  Two marks for one control: a dot separating "Context" from the
                  state, and a chevron saying it opens. Neither was carrying its
                  own weight -- the dot separated a label from the thing it
                  labelled, and the chevron said "expandable" next to a line that
                  could say it in a word. The state is the label now, and the
                  word changes when it opens.
                */}
                <span>
                  {useRelatedSources ? "Folder sources on" : "Folder sources off"}
                </span>
                <span className="font-semibold text-accent group-open:hidden">
                  Change
                </span>
                <span className="hidden font-semibold text-accent group-open:inline">
                  Hide
                </span>
              </summary>
              <div className="mt-2 flex w-full items-center justify-between gap-4 rounded-md border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3">
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-text-primary">
                    Use folder sources
                  </span>
                  <span className="mt-0.5 block text-2xs leading-relaxed text-text-muted">
                    Jami searches everything in this folder and reads the parts that fit your question.
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-label="Use folder sources"
                  aria-checked={useRelatedSources}
                  className={`relative h-6 w-11 shrink-0 rounded-full border transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                    useRelatedSources
                      ? "border-accent/40 bg-accent/65"
                      : "border-[var(--color-border-strong)] bg-[var(--color-glass-medium)]"
                  }`}
                  onClick={() => setUseRelatedSources((current) => !current)}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition duration-fast ${
                      useRelatedSources ? "left-5" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            </details>
            <div className="px-1.5 pt-1 text-2xs text-text-muted">
              Jami can make mistakes. Check important answers.
            </div>
          </div>
          )}
            </>
          )}
        </footer>

        {settingsOpen ? (
          <div className="absolute inset-0 z-10 flex flex-col bg-[var(--color-surface-panel-strong)]">
            <TutorSettingsPanel
              activeFolderIds={settingsFolderIds}
              onBack={() => setSettingsOpen(false)}
            />
          </div>
        ) : null}
    </TutorChatShell>
    {/* A pinned answer already says where Jami is, and opens it; the pill would repeat it. */}
    {floating && !open && minimised && !pinned ? (
      <FloatingTutorPill onOpen={() => onOpenChange(true)} />
    ) : null}
    {floating
      ? pinnedAnswers.map((answer, index) => (
          <FloatingTutorPinnedAnswer
            key={answer.slot}
            frame={pins[answer.slot]}
            // One way back to the chat is enough: only the newest pin carries it.
            onOpenChat={
              open || index !== pinnedAnswers.length - 1 ? undefined : () => onOpenChange(true)
            }
            onUnpin={() => unpinAnswer(answer.slot)}
          >
            <AssistantAnswerBody text={answer.text} illustrations={[]} renderIllustration={() => null} />
          </FloatingTutorPinnedAnswer>
        ))
      : null}
    </>
  );
}
