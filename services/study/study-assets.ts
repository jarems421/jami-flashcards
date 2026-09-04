import {
  collection,
  documentId,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import type { StudyAsset } from "@/lib/ai/study-assets";
import type { CardStudySettings } from "@/lib/study/study-modes";

const LOAD_MS = 20_000;
/** Firestore's `in` filter takes at most thirty values per query. */
const ID_QUERY_CHUNK = 30;

export type StudyAssetPreparation = {
  jobId: string;
  status: "completed" | "failed" | "running";
  requested: number;
  prepared: number;
  reused: number;
  failed: number;
};

async function authHeaders() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await user.getIdToken()}`,
  };
}

/**
 * Ask the server to prepare study material for a deck.
 *
 * Only ever called from an explicit Prepare action. Nothing about editing or
 * creating a card reaches this.
 */
export async function prepareStudyAssets(input: {
  deckId: string;
  cardIds: string[];
}): Promise<StudyAssetPreparation> {
  const response = await fetch("/api/ai/study-assets/jobs", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });

  const data = (await response.json().catch(() => null)) as
    | (StudyAssetPreparation & { error?: string })
    | null;
  if (!response.ok || !data) {
    throw new Error(data?.error ?? "Jami could not prepare these cards.");
  }
  return data;
}

export async function getStudyAssetJob(jobId: string) {
  const response = await fetch(`/api/ai/study-assets/jobs/${jobId}`, {
    headers: await authHeaders(),
  });
  if (!response.ok) return null;
  return (await response.json()) as StudyAssetPreparation;
}

/**
 * Read the prepared assets for a set of cards.
 *
 * Failure is not an error worth surfacing: without assets the modes fall back
 * to what can be built deterministically, which is most of them.
 */
export async function loadStudyAssets(
  cardIds: string[]
): Promise<Record<string, StudyAsset>> {
  const unique = Array.from(new Set(cardIds.filter(Boolean)));
  if (unique.length === 0) return {};

  const assets: Record<string, StudyAsset> = {};
  for (let start = 0; start < unique.length; start += ID_QUERY_CHUNK) {
    const chunk = unique.slice(start, start + ID_QUERY_CHUNK);
    try {
      const snapshot = await withTimeout(
        getDocs(
          query(
            collection(db, "cardStudyAssets"),
            where(documentId(), "in", chunk)
          )
        ),
        LOAD_MS,
        "Load study assets"
      );
      snapshot.forEach((entry) => {
        const data = entry.data();
        if (data?.asset) assets[entry.id] = data.asset as StudyAsset;
      });
    } catch (error) {
      console.warn("Failed to load prepared study assets.", error);
    }
  }
  return assets;
}

/**
 * Ask a marker to judge prose that local marking could not decide.
 *
 * Returns null on every kind of failure, which the caller reads as
 * "needs-self-grade". The student's response is sent and not kept: nothing
 * here writes, logs or caches it.
 */
export async function checkTypedAnswer(input: {
  cardId: string;
  response: string;
}) {
  try {
    const response = await fetch("/api/ai/study-answer/check", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(input),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      verdict: "correct" | "partial" | "incorrect" | "needs-self-grade";
      feedback?: string;
      missingConcepts?: string[];
    };
    return data.verdict === "needs-self-grade" ? null : data;
  } catch (error) {
    console.warn("Semantic answer check was unavailable.", error);
    return null;
  }
}

/** Fold a prepared asset into the settings the deterministic markers read. */
export function mergeAssetIntoSettings(
  asset: StudyAsset | undefined,
  settings: CardStudySettings | undefined
): CardStudySettings | undefined {
  if (!asset) return settings;
  return {
    ...settings,
    acceptedAnswers:
      settings?.acceptedAnswers?.length
        ? settings.acceptedAnswers
        : asset.acceptedAliases,
    requiredConcepts:
      settings?.requiredConcepts?.length
        ? settings.requiredConcepts
        : asset.requiredConcepts,
    pinnedGaps: settings?.pinnedGaps?.length
      ? settings.pinnedGaps
      : asset.clozeCandidates,
    mcqDistractors: settings?.mcqDistractors?.length
      ? settings.mcqDistractors
      : asset.distractors,
  };
}
