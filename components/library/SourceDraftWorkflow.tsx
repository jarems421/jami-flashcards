"use client";

import { useEffect, useMemo, useState } from "react";
import type { Source } from "@/lib/material/sources";
import type { Topic } from "@/lib/material/topics";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import type {
  SourceDraftDepth,
  SourceDraftKind,
} from "@/lib/ai/source-draft-quality";
import type { Deck } from "@/lib/study/decks";
import type { Notebook } from "@/lib/workspace/notebooks";
import {
  getPendingSourceDrafts,
  getSourceMadeCounts,
  resolveSelected,
} from "@/lib/material/source-selectors";
import { useFeedback } from "@/hooks/useFeedback";
import { generateSourceDrafts } from "@/services/ai/source-drafts";
import {
  getJamiAssistantThreadMessages,
  getJamiAssistantThreads,
} from "@/services/ai/jami-assistant-history";
import {
  getGeneratedContentDrafts,
  updateGeneratedContentDraftStatus,
} from "@/services/study/generated-content";
import SourceDraftsDrawer from "./SourceDraftsDrawer";

type SourceDraftWorkflowProps = {
  open: boolean;
  source: Source | null;
  drafts: GeneratedContentDraft[];
  referenceData: {
    topics: Topic[];
    decks: Deck[];
    notebooks: Notebook[];
  };
  userId: string;
  onClose: () => void;
  onDraftsChange: (drafts: GeneratedContentDraft[]) => void;
  onReload: () => Promise<void>;
  onTopicsChange: (topics: Topic[]) => void;
};

type SourceThreadSelection = {
  sourceId: string;
  threadId: string;
};

/** Owns source-draft generation, review selection, destinations, and rejection. */
export default function SourceDraftWorkflow({
  open,
  source,
  drafts,
  referenceData,
  userId,
  onClose,
  onDraftsChange,
  onReload,
  onTopicsChange,
}: SourceDraftWorkflowProps) {
  const { topics, decks, notebooks } = referenceData;
  const { feedback, success, showError, showThrownError, clear } = useFeedback();
  const [draftingKind, setDraftingKind] =
    useState<SourceDraftKind | null>(null);
  const [useConversationFocus, setUseConversationFocus] = useState(false);
  const [sourceThread, setSourceThread] =
    useState<SourceThreadSelection | null>(null);
  const [rejectingAllDrafts, setRejectingAllDrafts] = useState(false);
  const [deckIdByDraft, setDeckIdByDraft] = useState<Record<string, string>>({});
  const [notebookIdByDraft, setNotebookIdByDraft] = useState<
    Record<string, string>
  >({});
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  const sourceDrafts = useMemo(
    () => getPendingSourceDrafts(drafts, source?.id ?? null),
    [drafts, source]
  );
  const sourceMadeCounts = useMemo(
    () => getSourceMadeCounts(drafts, source?.id ?? null),
    [drafts, source]
  );
  const selectedDraft = useMemo(
    () => resolveSelected(sourceDrafts, selectedDraftId),
    [selectedDraftId, sourceDrafts]
  );
  const sourceThreadId =
    sourceThread && source && sourceThread.sourceId === source.id
      ? sourceThread.threadId
      : null;

  useEffect(() => {
    if (decks[0]?.id) {
      setDeckIdByDraft((current) => {
        const next = { ...current };
        for (const draft of drafts) {
          if (draft.kind === "flashcard" && !next[draft.id]) {
            next[draft.id] = decks[0].id;
          }
        }
        return next;
      });
    }
  }, [decks, drafts]);

  useEffect(() => {
    if (notebooks[0]?.id) {
      setNotebookIdByDraft((current) => {
        const next = { ...current };
        for (const draft of drafts) {
          if (draft.kind === "practice-question" && !next[draft.id]) {
            next[draft.id] = notebooks[0].id;
          }
        }
        return next;
      });
    }
  }, [drafts, notebooks]);

  useEffect(() => {
    setSelectedDraftId((current) =>
      current && sourceDrafts.some((draft) => draft.id === current)
        ? current
        : sourceDrafts[0]?.id ?? null
    );
  }, [sourceDrafts]);

  const activeSourceId = source?.id ?? null;

  useEffect(() => {
    setSourceThread(null);
    if (!activeSourceId) {
      return;
    }

    let cancelled = false;
    const sourceId = activeSourceId;
    const contextKey = `sources:${sourceId}`;
    void getJamiAssistantThreads(userId)
      .then((threads) => {
        if (cancelled) return;
        const match = threads.find((thread) => thread.contextKey === contextKey);
        setSourceThread(
          match ? { sourceId, threadId: match.id } : null
        );
      })
      .catch(() => {
        // Conversation focus is optional; even source coverage remains usable.
        if (!cancelled) setSourceThread(null);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSourceId, userId]);

  const rejectAllSourceDrafts = async () => {
    if (sourceDrafts.length === 0 || rejectingAllDrafts) return;
    setRejectingAllDrafts(true);
    clear();
    try {
      await Promise.all(
        sourceDrafts.map((draft) =>
          updateGeneratedContentDraftStatus(userId, draft.id, "rejected")
        )
      );
      onDraftsChange(await getGeneratedContentDrafts(userId));
      setSelectedDraftId(null);
      success(
        `Cleared ${sourceDrafts.length} draft${
          sourceDrafts.length === 1 ? "" : "s"
        }.`
      );
    } catch (error) {
      console.error("Failed to reject pending source drafts.", error);
      showError("Could not clear these drafts just now.");
    } finally {
      setRejectingAllDrafts(false);
    }
  };

  const buildConversationFocus = async () => {
    if (!sourceThreadId) return "";
    try {
      const messages = await getJamiAssistantThreadMessages(
        userId,
        sourceThreadId
      );
      return messages
        .slice(-6)
        .map(
          (message) =>
            `${message.role === "user" ? "Student" : "Tutor"}: ${message.text}`
        )
        .join("\n")
        .slice(-1_500);
    } catch {
      // Conversation focus is best-effort; drafting can cover the source evenly.
      return "";
    }
  };

  const generateDraftsForSelectedSource = async (
    kind: SourceDraftKind,
    depth: SourceDraftDepth
  ) => {
    if (!source || draftingKind) return;
    setDraftingKind(kind);
    clear();
    try {
      const focus =
        useConversationFocus && sourceThreadId
          ? await buildConversationFocus()
          : "";
      const { drafts: created, removedDraftCount } = await generateSourceDrafts({
        sourceId: source.id,
        kind,
        depth,
        ...(focus ? { focus } : {}),
      });
      onDraftsChange(await getGeneratedContentDrafts(userId));
      setSelectedDraftId(created[0]?.id ?? null);
      success(
        removedDraftCount > 0
          ? `Drafted ${created.length} for review. ${removedDraftCount} weaker one${
              removedDraftCount === 1 ? " was" : "s were"
            } discarded.`
          : `Drafted ${created.length} for review.`
      );
    } catch (error) {
      showThrownError(error, "Jami could not generate drafts just now.");
    } finally {
      setDraftingKind(null);
    }
  };

  const handleDraftSaved = async (message: string) => {
    success(message);
    await onReload();
  };

  const closeDrafts = () => {
    clear();
    onClose();
  };

  return (
    <SourceDraftsDrawer
      open={open}
      sourceTitle={source?.title ?? null}
      userId={userId}
      feedback={feedback}
      generation={{
        made: sourceMadeCounts,
        drafting: draftingKind,
        conversationFocusAvailable: Boolean(sourceThreadId),
        useConversationFocus,
        onUseConversationFocusChange: setUseConversationFocus,
        onGenerate: (kind, depth) =>
          void generateDraftsForSelectedSource(kind, depth),
      }}
      review={{
        drafts: sourceDrafts,
        selectedDraft: selectedDraft ?? null,
        rejectingAll: rejectingAllDrafts,
        onRejectAll: () => void rejectAllSourceDrafts(),
        onSelectDraft: setSelectedDraftId,
      }}
      destinations={{
        topics,
        decks,
        notebooks,
        deckIdByDraft,
        notebookIdByDraft,
        onDeckChange: (draftId, deckId) =>
          setDeckIdByDraft((current) => ({ ...current, [draftId]: deckId })),
        onNotebookChange: (draftId, notebookId) =>
          setNotebookIdByDraft((current) => ({
            ...current,
            [draftId]: notebookId,
          })),
      }}
      lifecycle={{
        onClose: closeDrafts,
        onDismissFeedback: clear,
        onSaved: handleDraftSaved,
        onTopicsChange,
      }}
    />
  );
}
