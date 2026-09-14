/**
 * How long something has been running, as a clock reads it.
 *
 * Every wait in the app used to show a bar and a percentage, and a percentage
 * says nothing about time: a paper job sat at 58% for eleven minutes looking
 * exactly as it had after one. A running clock beside the bar is the honest
 * half of that picture -- it cannot overstate progress, and it tells a student
 * whether "a few minutes" has become a problem.
 */
export function formatElapsed(milliseconds: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(milliseconds) ? milliseconds : 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
