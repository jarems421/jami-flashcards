export const NOTEBOOK_ASSISTANT_QUICK_ACTIONS = [
  {
    label: "Check my work",
    prompt:
      "Check the work on this page. Point out any mistakes and explain how to improve them without rewriting everything for me.",
  },
  {
    label: "Give me a hint",
    prompt:
      "Give me one useful hint for the work on this page without revealing the full answer.",
  },
  {
    label: "Explain this page",
    prompt:
      "Explain the ideas and working on this page clearly, including anything important I may have missed.",
  },
  {
    label: "Quiz me",
    prompt:
      "Quiz me on the main idea from this page. Ask one question at a time and do not reveal the answer yet.",
  },
] as const;
