/**
 * The starting points for a conversation about the student's own material.
 *
 * Three ways in, the same wherever material is handed to Jami: understand it,
 * test yourself on it, keep it. The wording changes with how many sources are
 * in use -- "this source" to one, "across these sources" to several -- and
 * nothing else does, so the Library and the Tutor page offer exactly the same
 * things. A summary or a comparison is still one question away.
 */

export type TutorSourceAction = { label: string; prompt: string };

export function tutorSourceActions(sourceCount: number): TutorSourceAction[] {
  if (sourceCount > 1) {
    return [
      {
        label: "Connect the ideas",
        prompt: "How do the ideas in these sources fit together? Explain them as one picture.",
      },
      { label: "Quiz me", prompt: "Quiz me on the most important ideas across these sources." },
      { label: "Suggest flashcards", prompt: "Make flashcards on the key ideas across these sources." },
    ];
  }
  return [
    { label: "Explain key ideas", prompt: "Explain the key ideas in this source clearly." },
    { label: "Quiz me", prompt: "Quiz me on the most important ideas in this source." },
    { label: "Suggest flashcards", prompt: "Make flashcards on the key ideas in this source." },
  ];
}
