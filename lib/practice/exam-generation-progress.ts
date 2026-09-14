/**
 * What to show while Jami writes gap-filler questions.
 *
 * Writing them is one model call -- the questions and their mark schemes come
 * back together -- followed by structural checks and a save, all inside the
 * request that starts the session. There is no job to poll, so nothing on the
 * server can say how far along it is. The page used to show a disabled button
 * and nothing else for up to a minute, which read as a page that had hung.
 *
 * So progress is paced by time: quick at first, slowing as it goes, and held
 * short of full until the session actually opens -- a bar that reaches the end
 * and then sits there is worse than one that is still moving.
 */

/** Roughly how long one round of gap-fill writing takes end to end. */
export const EXAM_GENERATION_TYPICAL_MS = 25_000;

/**
 * Questions one round writes: the server asks for five per call, five calls at
 * a time, so a round is twenty-five questions and a fifty-question shortfall
 * takes two. Pacing every shortfall as one round had the bar reach its ceiling
 * and sit there on exactly the largest requests.
 */
const QUESTIONS_PER_ROUND = 25;

/** How long writing this many questions should take, in whole rounds. */
export function examGenerationTypicalMs(count = 1) {
  return EXAM_GENERATION_TYPICAL_MS * Math.max(1, Math.ceil(count / QUESTIONS_PER_ROUND));
}

const START_PERCENT = 3;
const CEILING_PERCENT = 94;

export function examGenerationProgress(elapsedMs: number, count = 1) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return START_PERCENT;
  const eased = 1 - Math.exp(-elapsedMs / (examGenerationTypicalMs(count) / 2));
  return Math.min(
    CEILING_PERCENT,
    START_PERCENT + eased * (CEILING_PERCENT - START_PERCENT)
  );
}

/**
 * The step to name, in the order the request actually does them.
 *
 * The boundaries are estimates, which is why the last one says so plainly
 * rather than claiming a step it cannot see.
 */
export function examGenerationStage(elapsedMs: number, count: number) {
  const questions = `${count} original question${count === 1 ? "" : "s"}`;
  // Reading the course takes the same time however many are written; the rest
  // stretches with the rounds the writing needs.
  const rounds = examGenerationTypicalMs(count) / EXAM_GENERATION_TYPICAL_MS;
  if (elapsedMs < 4_000) return "Reading your course";
  if (elapsedMs < 18_000 * rounds) return `Writing ${questions}`;
  if (elapsedMs < 32_000 * rounds) return count === 1 ? "Writing its mark scheme" : "Writing a mark scheme for each one";
  if (elapsedMs < 50_000 * rounds) return "Checking them and setting up your session";
  return "Nearly there — this is taking a little longer than usual";
}
