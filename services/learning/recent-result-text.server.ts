import "server-only";

import { mapPracticePaperData } from "@/lib/practice/practice-papers";
import type { LearningRecentResult } from "@/lib/learning/types";
import { getAdminDb } from "@/services/firebase/admin";

/**
 * The words of the items in a student's recent results, for Tutor.
 *
 * Only material the student may see in a prompt: the front of their own
 * flashcards (never the back, which could be the answer to a card they are
 * being asked right now), and the questions of practice papers Jami wrote for
 * them or they uploaded themselves. Licensed past-paper questions are never
 * read here -- Tutor hears their topic and marks, not their text.
 */

const MAX_CARD_READS = 8;
const MAX_PAPER_READS = 4;
const MAX_TEXT_LENGTH = 200;

function tidy(value: unknown) {
  return typeof value === "string"
    ? value.replace(/!\[[^\]]*\]\([^)]*\)/g, "[image]").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH)
    : "";
}

export async function loadRecentResultText(
  uid: string,
  results: readonly LearningRecentResult[]
): Promise<Map<string, string>> {
  const text = new Map<string, string>();
  const cardIds = Array.from(
    new Set(
      results
        .filter((result) => result.kind === "flashcards" && result.itemId.startsWith("card:"))
        .map((result) => result.itemId.slice("card:".length))
        .filter(Boolean)
    )
  ).slice(0, MAX_CARD_READS);
  const paperQuestions = results.flatMap((result) => {
    if (result.kind !== "practice") return [];
    const [prefix, paperId, questionId] = result.itemId.split(":");
    return prefix === "paper" && paperId && questionId ? [{ itemId: result.itemId, paperId, questionId }] : [];
  });
  const paperIds = Array.from(new Set(paperQuestions.map((entry) => entry.paperId))).slice(0, MAX_PAPER_READS);
  if (cardIds.length === 0 && paperIds.length === 0) return text;

  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const [cards, papers] = await Promise.all([
    cardIds.length > 0 ? db.getAll(...cardIds.map((id) => db.collection("cards").doc(id))) : Promise.resolve([]),
    paperIds.length > 0
      ? db.getAll(...paperIds.map((id) => userRef.collection("pastPapers").doc(id)))
      : Promise.resolve([]),
  ]);

  for (const snapshot of cards) {
    const data = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null;
    // Another student's card is not this student's evidence, whatever id it has.
    if (!data || (data.userId !== uid && data.uid !== uid)) continue;
    const front = tidy(data.front);
    if (front) text.set(`card:${snapshot.id}`, front);
  }
  for (const snapshot of papers) {
    if (!snapshot.exists) continue;
    const paper = mapPracticePaperData(snapshot.id, snapshot.data() as Record<string, unknown>);
    for (const entry of paperQuestions) {
      if (entry.paperId !== paper.id) continue;
      const question = paper.questions.find((candidate) => candidate.id === entry.questionId);
      const prompt = tidy(question?.prompt);
      if (prompt) text.set(entry.itemId, prompt);
    }
  }
  return text;
}
