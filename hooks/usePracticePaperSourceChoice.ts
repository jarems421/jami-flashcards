"use client";

import { useMemo, useState } from "react";
import { rankPracticePaperSources } from "@/lib/ai/practice-paper-generation";
import type { Source } from "@/lib/material/sources";

/**
 * Which of a folder's sources a paper is given.
 *
 * Jami proposes the most useful sources for what the paper is about, and the
 * student confirms that proposal or picks their own. The choice is held
 * against the folder it was made in, as the builder's other choices are, so a
 * new folder starts with nothing picked.
 *
 * When sources are optional -- a picked school course already says what the
 * paper is -- only a manual pick is offered.
 */
export function usePracticePaperSourceChoice({
  folderId,
  sources,
  query,
  optional,
}: {
  folderId: string;
  sources: readonly Source[];
  /** What the paper is about, which Jami ranks the folder's sources against. */
  query: string;
  optional: boolean;
}) {
  const [automatic, setAutomaticState] = useState(true);
  const [choice, setChoice] = useState<{ folderId: string; selectedIds: string[]; confirmedIds: string[] }>({
    folderId: "",
    selectedIds: [],
    confirmedIds: [],
  });
  const current = choice.folderId === folderId ? choice : { folderId, selectedIds: [], confirmedIds: [] };

  const proposedSources = useMemo(() => rankPracticePaperSources(sources, query), [query, sources]);
  const proposedIds = proposedSources.map((source) => source.id);
  const automaticConfirmed =
    proposedIds.length === current.confirmedIds.length &&
    proposedIds.every((sourceId, index) => sourceId === current.confirmedIds[index]);

  return {
    automatic,
    proposedSources,
    automaticConfirmed,
    selectedIds: current.selectedIds,
    /** The sources the paper is given, whichever way they were chosen. */
    chosenIds: optional || !automatic ? current.selectedIds : current.confirmedIds,
    /** Jami's proposal is in use but the student has not confirmed it. */
    unconfirmed: !optional && automatic && !automaticConfirmed,
    setAutomatic: (value: boolean) => {
      setAutomaticState(value);
      // Turning the proposal back on asks for it to be confirmed again.
      if (value) setChoice({ ...current, confirmedIds: [] });
    },
    confirmProposal: () => setChoice({ ...current, confirmedIds: proposedIds }),
    setSelectedIds: (selectedIds: string[]) => setChoice({ ...current, selectedIds }),
  };
}
