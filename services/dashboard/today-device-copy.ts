import { APP_BUILD } from "@/lib/app/app-build";
import type { Card } from "@/lib/study/cards";
import type { Source } from "@/lib/material/sources";
import {
  readDeviceCopy,
  writeDeviceCopy,
} from "@/services/cache/device-store";
import type {
  DashboardSection,
  DashboardSectionState,
  DashboardSnapshot,
} from "@/services/dashboard/today";

/**
 * Today as it last loaded, kept on this device so the next launch can draw it
 * at once and load the real thing behind it.
 *
 * Today waits on about a dozen reads, every card the student owns and every
 * mastery event they have earned among them, and each round trip from a
 * student in Britain to the database in the central US is a tenth of a second
 * before any of it is downloaded. Each launch used to sit on skeletons for all
 * of that. A copy cuts the wait to reading this device.
 *
 * What it keeps is what Today draws from, and not what it never shows: no card
 * says what is written on it, and no source carries its text. It is shown only
 * to the student who loaded it, only on the study day it was loaded, only by
 * the build that wrote it -- so a deploy that changes the snapshot's shape can
 * never be handed an old one -- and it is cleared at sign-out.
 */

const COPY_VERSION = 1;
const KEY_PREFIX = "today:";
/** Beyond the study day check, a ceiling for a clock that has been moved. */
const MAX_AGE_MS = 20 * 60 * 60 * 1000;

type CardWithoutContent = Omit<Card, "front" | "back" | "frontImage" | "backImage" | "occlusion">;
type SourceWithoutContent = Omit<Source, "contentText">;

export type TodayDeviceCopy = {
  version: typeof COPY_VERSION;
  build: string;
  userId: string;
  dayKey: string;
  savedAt: number;
  snapshot: Omit<DashboardSnapshot, "cards" | "dueCards" | "sources"> & {
    cards: CardWithoutContent[];
    /** Due cards are some of `cards`; kept by id rather than twice over. */
    dueCardIds: string[];
    sources: SourceWithoutContent[];
  };
};

function withoutContent(card: Card): CardWithoutContent {
  const {
    front: _front,
    back: _back,
    frontImage: _frontImage,
    backImage: _backImage,
    occlusion: _occlusion,
    ...kept
  } = card;
  void [_front, _back, _frontImage, _backImage, _occlusion];
  return kept;
}

function sourceWithoutContent(source: Source): SourceWithoutContent {
  const { contentText: _contentText, ...kept } = source;
  void _contentText;
  return kept;
}

/**
 * The copy to keep of `snapshot`, or null if it should not be kept.
 *
 * Only a snapshot every section of which was actually read is kept: a copy of
 * one that came back degraded would carry its gaps into the next launch as
 * though they were the student's data.
 */
export function toTodayDeviceCopy(input: {
  snapshot: DashboardSnapshot;
  userId: string;
  dayKey: string;
  now: number;
  build?: string;
}): TodayDeviceCopy | null {
  const { snapshot } = input;
  if (Object.values(snapshot.sections).some((state) => state !== "ready")) return null;
  const { cards, dueCards, sources, ...rest } = snapshot;
  return {
    version: COPY_VERSION,
    build: input.build ?? APP_BUILD,
    userId: input.userId,
    dayKey: input.dayKey,
    savedAt: input.now,
    snapshot: {
      ...rest,
      cards: cards.map(withoutContent),
      dueCardIds: dueCards.map((card) => card.id),
      sources: sources.map(sourceWithoutContent),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const SNAPSHOT_LISTS = [
  "decks",
  "activeGoals",
  "studyActivity",
  "cards",
  "dueCardIds",
  "topics",
  "drafts",
  "sources",
  "studyFolders",
  "notebooks",
] as const;

/**
 * Today from a kept copy, or null if this copy is not one to show.
 *
 * Every section comes back `stale`: it is drawn like any other, and the page
 * knows a load is still owed. Card text was never kept, so cards come back
 * with empty sides; nothing on Today shows them.
 */
export function fromTodayDeviceCopy(
  value: unknown,
  expected: { userId: string; dayKey: string; now: number; build?: string }
): DashboardSnapshot | null {
  if (!isRecord(value)) return null;
  if (
    value.version !== COPY_VERSION ||
    value.build !== (expected.build ?? APP_BUILD) ||
    value.userId !== expected.userId ||
    value.dayKey !== expected.dayKey ||
    typeof value.savedAt !== "number" ||
    value.savedAt > expected.now ||
    expected.now - value.savedAt > MAX_AGE_MS
  ) {
    return null;
  }
  const kept = value.snapshot;
  if (!isRecord(kept) || !isRecord(kept.sections)) return null;
  if (SNAPSHOT_LISTS.some((list) => !Array.isArray(kept[list]))) return null;

  const copy = kept as TodayDeviceCopy["snapshot"];
  const cards: Card[] = copy.cards.map((card) => ({ ...card, front: "", back: "" }));
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const dueCards = copy.dueCardIds
    .map((cardId) => cardsById.get(cardId))
    .filter((card): card is Card => card !== undefined);
  const sections = Object.fromEntries(
    Object.keys(copy.sections).map((section) => [section, "stale"])
  ) as Record<DashboardSection, DashboardSectionState>;

  const { dueCardIds: _dueCardIds, ...rest } = copy;
  void _dueCardIds;
  return { ...rest, sections, cards, dueCards };
}

const keyFor = (userId: string) => `${KEY_PREFIX}${userId}`;

export async function readTodayDeviceCopy(expected: {
  userId: string;
  dayKey: string;
  now?: number;
}): Promise<DashboardSnapshot | null> {
  const value = await readDeviceCopy(keyFor(expected.userId));
  try {
    return fromTodayDeviceCopy(value, { ...expected, now: expected.now ?? Date.now() });
  } catch {
    // A copy this build cannot make sense of is no copy at all.
    return null;
  }
}

export function keepTodayDeviceCopy(input: {
  snapshot: DashboardSnapshot;
  userId: string;
  dayKey: string;
  now?: number;
}) {
  const copy = toTodayDeviceCopy({ ...input, now: input.now ?? Date.now() });
  if (!copy) return Promise.resolve();
  return writeDeviceCopy(keyFor(input.userId), copy);
}
