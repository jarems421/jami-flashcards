export type WalkthroughDeck = {
  id: string;
  name: string;
  subject: string;
  cardCount: number;
  weakCount: number;
};

export type WalkthroughCard = {
  id: string;
  deckId: string;
  front: string;
  back: string;
  topicIds: string[];
  tags: string[];
  due: boolean;
  weak: boolean;
  status: "learning" | "review" | "relearning";
};

export type WalkthroughTopic = {
  id: string;
  name: string;
  subject: string;
};

export type WalkthroughStudyFolder = {
  id: string;
  name: string;
  subject: string;
  description: string;
  topicIds: string[];
};

export type WalkthroughQuestion = {
  id: string;
  questionText: string;
  answerText: string;
  solutionText: string;
  topicIds: string[];
  difficulty: "easy" | "medium" | "hard";
};

export type WalkthroughAttempt = {
  id: string;
  questionId: string;
  isCorrect: boolean;
  confidence: 1 | 2 | 3 | 4 | 5;
  hintsUsed: number;
  tutorUsed: boolean;
  mistakeLabels: string[];
  createdAt: number;
};

export type WalkthroughDraft = {
  id: string;
  front: string;
  back: string;
  topicIds: string[];
  sourceQuestionId: string;
  contentStatus: "draft" | "approved";
  addedDeckId?: string;
};

export type WalkthroughTutorMessage = {
  role: "user" | "model";
  text: string;
  intent?: WalkthroughTutorIntent;
};

export type WalkthroughSource = {
  id: string;
  title: string;
  type: "pasted_text" | "manual_note" | "link" | "file";
  subject?: string;
  topicIds: string[];
  contentText?: string;
  externalUrl?: string;
  fileName?: string;
  fileType?: string;
  status: "active" | "archived";
};

export type WalkthroughNotebook = {
  id: string;
  folderId: string;
  title: string;
  type:
    | "blank"
    | "uploaded_file"
    | "ai_questions"
    | "general_working"
    | "free_working"
    | "practice"
    | "past_paper"
    | "generated_drill"
    | "source_notes";
  topicIds: string[];
  sourceIds: string[];
  pageColor?: "white" | "black" | "grey";
  uploadedFileName?: string;
  updatedAt: number;
};

export type WalkthroughNotebookPage = {
  id: string;
  notebookId: string;
  folderId: string;
  pageNumber: number;
  pageType: "blank" | "question" | "past_paper_page" | "source_note" | "free_working";
  pageColor?: "white" | "black" | "grey";
  typedContent?: string;
  questionPrompt?: string;
};

export type WalkthroughPracticeSet = {
  id: string;
  folderId: string;
  title: string;
  type: "manual" | "ai_generated" | "imported" | "past_paper_section";
  topicIds: string[];
  questionIds: string[];
};

export type WalkthroughPastPaper = {
  id: string;
  folderId: string;
  title: string;
  year?: string;
  module?: string;
  pageCount?: number;
};

export type WalkthroughTutorIntent =
  | "hint"
  | "check-working"
  | "explain-concept"
  | "show-method"
  | "full-solution"
  | "make-flashcard"
  | "similar-question"
  | "stuck-here";

export const WALKTHROUGH_TOPICS: WalkthroughTopic[] = [
  { id: "topic-photosynthesis", name: "Photosynthesis", subject: "Biology" },
  { id: "topic-enzymes", name: "Enzyme activity", subject: "Biology" },
  { id: "topic-cold-war", name: "Cold War causes", subject: "History" },
  { id: "topic-spanish-preterite", name: "Spanish preterite verbs", subject: "Spanish" },
];

export const WALKTHROUGH_FOLDERS: WalkthroughStudyFolder[] = [
  {
    id: "folder-biology",
    name: "Biology",
    subject: "Science",
    description:
      "Flashcards, source notes, practice work, and notebook pages for cells, enzymes, and exam-style biology questions.",
    topicIds: ["topic-photosynthesis", "topic-enzymes"],
  },
  {
    id: "folder-history",
    name: "History",
    subject: "Humanities",
    description:
      "A study space for timelines, source analysis, essay plans, and retrieval practice.",
    topicIds: ["topic-cold-war"],
  },
  {
    id: "folder-spanish",
    name: "Spanish",
    subject: "Languages",
    description:
      "A home for vocabulary decks, grammar notebooks, speaking prompts, and short practice drills.",
    topicIds: ["topic-spanish-preterite"],
  },
];

export const WALKTHROUGH_DECKS: WalkthroughDeck[] = [
  { id: "deck-biology", name: "Biology key terms", subject: "Science", cardCount: 5, weakCount: 2 },
  { id: "deck-history", name: "Cold War timeline", subject: "Humanities", cardCount: 4, weakCount: 1 },
  { id: "deck-spanish", name: "Spanish verbs", subject: "Languages", cardCount: 3, weakCount: 1 },
];

export const WALKTHROUGH_CARDS: WalkthroughCard[] = [
  {
    id: "card-chlorophyll",
    deckId: "deck-biology",
    front: "What does chlorophyll do in photosynthesis?",
    back: "It absorbs light energy so the plant can make glucose from carbon dioxide and water.",
    topicIds: ["topic-photosynthesis"],
    tags: ["definition", "core"],
    due: true,
    weak: false,
    status: "review",
  },
  {
    id: "card-active-site",
    deckId: "deck-biology",
    front: "What is an enzyme active site?",
    back: "The region of an enzyme where a specific substrate binds and the reaction is catalysed.",
    topicIds: ["topic-enzymes"],
    tags: ["weak", "exam"],
    due: true,
    weak: true,
    status: "relearning",
  },
  {
    id: "card-containment",
    deckId: "deck-history",
    front: "What was containment?",
    back: "A US policy aiming to stop communism spreading into more countries after World War II.",
    topicIds: ["topic-cold-war"],
    tags: ["definition"],
    due: false,
    weak: true,
    status: "learning",
  },
  {
    id: "card-spanish-preterite",
    deckId: "deck-spanish",
    front: "What are the regular -ar preterite endings in Spanish?",
    back: "e, aste, o, amos, asteis, aron.",
    topicIds: ["topic-spanish-preterite"],
    tags: ["grammar", "definition"],
    due: true,
    weak: true,
    status: "relearning",
  },
  {
    id: "card-photosynthesis-equation",
    deckId: "deck-biology",
    front: "What is the word equation for photosynthesis?",
    back: "Carbon dioxide + water -> glucose + oxygen.",
    topicIds: ["topic-photosynthesis"],
    tags: ["method"],
    due: false,
    weak: false,
    status: "review",
  },
];

export const WALKTHROUGH_QUESTIONS: WalkthroughQuestion[] = [
  {
    id: "question-enzyme-temperature",
    questionText:
      "A student measures enzyme activity at different temperatures. The rate rises up to 37 C, then drops sharply above 45 C. Explain why.",
    answerText:
      "The enzyme works faster as temperature rises until its optimum, but high temperatures denature the enzyme and change the active site shape, so fewer substrates fit.",
    solutionText:
      "Explain the rise first: particles have more kinetic energy, so enzyme-substrate collisions increase. Then explain the drop: high temperature denatures the enzyme, changing the active site so the substrate no longer fits well.",
    topicIds: ["topic-enzymes"],
    difficulty: "medium",
  },
  {
    id: "question-cold-war",
    questionText:
      "Give two reasons why tension between the USA and USSR increased after 1945.",
    answerText:
      "Ideological differences between capitalism and communism, plus mistrust after World War II, including disagreements over Eastern Europe and nuclear weapons.",
    solutionText:
      "A strong answer names two causes and explains each one. For example: ideology made both sides suspicious of each other's aims, while Soviet control in Eastern Europe and the US atomic bomb increased mistrust.",
    topicIds: ["topic-cold-war"],
    difficulty: "medium",
  },
  {
    id: "question-spanish-preterite",
    questionText:
      "Translate into Spanish: Yesterday I spoke with my friend.",
    answerText:
      "Ayer hable con mi amigo/amiga.",
    solutionText:
      "Use ayer for yesterday, the preterite yo form hable for I spoke, and con mi amigo/amiga for with my friend.",
    topicIds: ["topic-spanish-preterite"],
    difficulty: "easy",
  },
];

export const WALKTHROUGH_ATTEMPTS: WalkthroughAttempt[] = [
  {
    id: "attempt-1",
    questionId: "question-enzyme-temperature",
    isCorrect: false,
    confidence: 2,
    hintsUsed: 2,
    tutorUsed: true,
    mistakeLabels: ["forgot denaturing", "active site explanation missing"],
    createdAt: Date.now() - 1000 * 60 * 60 * 8,
  },
  {
    id: "attempt-2",
    questionId: "question-cold-war",
    isCorrect: false,
    confidence: 2,
    hintsUsed: 1,
    tutorUsed: true,
    mistakeLabels: ["too vague", "needs explained cause"],
    createdAt: Date.now() - 1000 * 60 * 60 * 4,
  },
  {
    id: "attempt-3",
    questionId: "question-spanish-preterite",
    isCorrect: true,
    confidence: 4,
    hintsUsed: 0,
    tutorUsed: false,
    mistakeLabels: [],
    createdAt: Date.now() - 1000 * 60 * 50,
  },
];

export const WALKTHROUGH_INITIAL_DRAFTS: WalkthroughDraft[] = [
  {
    id: "draft-enzyme-denaturing",
    front: "What happens when an enzyme is denatured?",
    back: "Its active site changes shape, so the substrate no longer fits properly and the reaction rate falls.",
    topicIds: ["topic-enzymes"],
    sourceQuestionId: "question-enzyme-temperature",
    contentStatus: "draft",
  },
];

export const WALKTHROUGH_SOURCES: WalkthroughSource[] = [
  {
    id: "source-biology-notes",
    title: "Enzyme activity class notes",
    type: "pasted_text",
    subject: "Biology",
    topicIds: ["topic-enzymes"],
    contentText:
      "Enzyme activity increases with temperature up to an optimum because particles collide more often. Above the optimum, bonds in the enzyme structure break, the active site changes shape, and the substrate no longer fits well.",
    status: "active",
  },
  {
    id: "source-history-note",
    title: "Cold War causes summary",
    type: "manual_note",
    subject: "History",
    topicIds: ["topic-cold-war"],
    contentText:
      "After 1945, the USA and USSR disagreed over ideology, security, control of Eastern Europe, and the meaning of free elections. These disagreements created suspicion and competition.",
    status: "active",
  },
  {
    id: "source-file-ref",
    title: "Spanish speaking prompt reference",
    type: "file",
    subject: "Spanish",
    topicIds: ["topic-spanish-preterite"],
    fileName: "spanish-speaking-prompts.pdf",
    fileType: "PDF reference",
    status: "active",
  },
];

export const WALKTHROUGH_NOTEBOOKS: WalkthroughNotebook[] = [
  {
    id: "notebook-photosynthesis",
    folderId: "folder-biology",
    title: "Enzyme activity practice",
    type: "general_working",
    topicIds: ["topic-enzymes"],
    sourceIds: ["source-biology-notes"],
    pageColor: "white",
    updatedAt: Date.now() - 1000 * 60 * 45,
  },
  {
    id: "notebook-biology-paper",
    folderId: "folder-biology",
    title: "Biology mock paper working",
    type: "uploaded_file",
    topicIds: ["topic-photosynthesis", "topic-enzymes"],
    sourceIds: [],
    pageColor: "white",
    uploadedFileName: "biology-mock-paper.pdf",
    updatedAt: Date.now() - 1000 * 60 * 90,
  },
  {
    id: "notebook-history",
    folderId: "folder-history",
    title: "Cold War source notes",
    type: "source_notes",
    topicIds: ["topic-cold-war"],
    sourceIds: ["source-history-note"],
    pageColor: "grey",
    updatedAt: Date.now() - 1000 * 60 * 60 * 5,
  },
];

export const WALKTHROUGH_NOTEBOOK_PAGES: WalkthroughNotebookPage[] = [
  {
    id: "page-enzymes-1",
    notebookId: "notebook-photosynthesis",
    folderId: "folder-biology",
    pageNumber: 1,
    pageType: "question",
    pageColor: "white",
    questionPrompt:
      "A student measures enzyme activity at different temperatures. The rate rises up to 37 C, then drops sharply above 45 C. Explain why.",
    typedContent:
      "I need to explain both the collision increase before the optimum and denaturing after the optimum.",
  },
  {
    id: "page-biology-paper-1",
    notebookId: "notebook-biology-paper",
    folderId: "folder-biology",
    pageNumber: 1,
    pageType: "past_paper_page",
    pageColor: "white",
    questionPrompt:
      "Uploaded file reference: biology-mock-paper.pdf. Full PDF annotation and OCR come later; use this page for working notes.",
    typedContent:
      "Public walkthrough simulation: the file is represented as local notebook metadata only.",
  },
  {
    id: "page-history-1",
    notebookId: "notebook-history",
    folderId: "folder-history",
    pageNumber: 1,
    pageType: "source_note",
    pageColor: "grey",
    typedContent:
      "Useful causes to compare: ideological conflict, Eastern Europe, nuclear tension, and post-war mistrust.",
  },
];

export const WALKTHROUGH_PRACTICE_SETS: WalkthroughPracticeSet[] = [
  {
    id: "practice-set-enzymes",
    folderId: "folder-biology",
    title: "Enzyme activity drill",
    type: "manual",
    topicIds: ["topic-enzymes"],
    questionIds: ["question-enzyme-temperature"],
  },
  {
    id: "practice-set-history",
    folderId: "folder-history",
    title: "Cold War causes checks",
    type: "manual",
    topicIds: ["topic-cold-war"],
    questionIds: ["question-cold-war"],
  },
];

export const WALKTHROUGH_PAST_PAPERS: WalkthroughPastPaper[] = [
  {
    id: "past-paper-biology-2024",
    folderId: "folder-biology",
    title: "2024 Biology practice paper",
    year: "2024",
    module: "Biology",
    pageCount: 0,
  },
];

export const WALKTHROUGH_INITIAL_TUTOR_MESSAGES: WalkthroughTutorMessage[] = [
  {
    role: "user",
    text: "Give me one hint without revealing the answer.",
  },
  {
    role: "model",
    text: "Start by naming what happens to the enzyme above its optimum temperature. Then connect that change to the active site and substrate fit.",
  },
];

export function getWalkthroughQuestion(questionId: string) {
  return WALKTHROUGH_QUESTIONS.find((question) => question.id === questionId) ?? null;
}

export function getWalkthroughTopicNames(topicIds: string[]) {
  return topicIds
    .map((topicId) => WALKTHROUGH_TOPICS.find((topic) => topic.id === topicId)?.name)
    .filter((name): name is string => Boolean(name));
}
