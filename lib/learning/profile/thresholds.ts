/**
 * Where a signal becomes a claim.
 *
 * One module, so the profile lists, topic states and recommendations can never
 * disagree about what "weak" or "strong" means.
 */

export const WEAKNESS_MASTERY_BELOW = 0.6;
/** A topic in decline needs attention even while its mastery still looks fine. */
export const DECLINING_ATTENTION_BELOW = 0.8;
export const STRENGTH_MASTERY_FROM = 0.8;
/**
 * No topic is called weak on less evidence than this -- roughly two answers.
 * One wrong answer is not a weakness, and saying so is the failure the
 * confidence number exists to prevent. Below it, a weak-looking topic is
 * something to check.
 */
export const MIN_SIGNAL_CONFIDENCE = 0.3;
/** Calling something a strength tells the tutor to skip it, so it needs more. */
export const MIN_STRENGTH_CONFIDENCE = 0.45;
/** Below this, a weak topic is something to diagnose, not something to teach. */
export const TOPIC_FOCUS_CONFIDENCE = 0.6;
