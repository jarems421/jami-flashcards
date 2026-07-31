export type Feedback = {
  type: "success" | "error";
  message: string;
};

/**
 * Turns a thrown value into something worth showing a student.
 *
 * Pages wrote `error instanceof Error ? error.message : "…"` by hand in
 * sixteen places, which also let empty messages through: a service throwing
 * `new Error("")` rendered a banner with nothing in it. The fallback covers
 * that case as well as a non-Error throw.
 */
export function getFeedbackErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) return message;
  }
  return fallback;
}
