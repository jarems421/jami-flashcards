export type WalkthroughDeck = {
  id: string;
  name: string;
  subject: string;
  folderId: string;
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
  color: string;
  icon: string;
  topicIds: string[];
  updatedAt: number;
};

export type WalkthroughDraft = {
  id: string;
  kind: "flashcard" | "practice-question";
  front?: string;
  back?: string;
  questionText?: string;
  answerText?: string;
  solutionText?: string;
  topicIds: string[];
  sourceId?: string;
  contentStatus: "draft" | "approved";
  addedDeckId?: string;
  addedNotebookId?: string;
};

export type WalkthroughSource = {
  id: string;
  title: string;
  type: "pasted_text" | "manual_note" | "link" | "file";
  subject?: string;
  folderId: string;
  topicIds: string[];
  contentText?: string;
  externalUrl?: string;
  fileName?: string;
  fileType?: string;
  status: "active" | "archived";
};

export type WalkthroughNotebookType =
  | "blank"
  | "uploaded_file"
  | "ai_questions"
  | "general_working"
  | "free_working"
  | "practice"
  | "past_paper"
  | "generated_drill"
  | "source_notes";

export type WalkthroughNotebook = {
  id: string;
  folderId: string;
  title: string;
  type: WalkthroughNotebookType;
  topicIds: string[];
  sourceIds: string[];
  color?: string;
  icon?: string;
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
  updatedAt: number;
};

export const WALKTHROUGH_TOPICS: WalkthroughTopic[] = [
  { id: "topic-photosynthesis", name: "Photosynthesis", subject: "Biology" },
  { id: "topic-cold-war", name: "Cold War causes", subject: "History" },
  { id: "topic-spanish-preterite", name: "Spanish preterite verbs", subject: "Spanish" },
  { id: "topic-quadratics", name: "Quadratic graphs", subject: "Maths" },
];

export const WALKTHROUGH_FOLDERS: WalkthroughStudyFolder[] = [
  {
    id: "folder-biology",
    name: "Biology",
    subject: "Science",
    description: "Class notes, flashcards, and notebook pages for enzymes and plant biology.",
    color: "emerald",
    icon: "leaf",
    topicIds: ["topic-photosynthesis"],
    updatedAt: Date.now() - 1000 * 60 * 35,
  },
  {
    id: "folder-history",
    name: "History",
    subject: "Humanities",
    description: "A study space for timelines, source analysis, essay plans, and retrieval practice.",
    color: "amber",
    icon: "book",
    topicIds: ["topic-cold-war"],
    updatedAt: Date.now() - 1000 * 60 * 60 * 4,
  },
  {
    id: "folder-spanish",
    name: "Spanish",
    subject: "Languages",
    description: "Vocabulary decks, grammar notebooks, and speaking prompts.",
    color: "rose",
    icon: "message",
    topicIds: ["topic-spanish-preterite"],
    updatedAt: Date.now() - 1000 * 60 * 60 * 20,
  },
];

export const WALKTHROUGH_DECKS: WalkthroughDeck[] = [
  { id: "deck-biology", name: "Biology key terms", subject: "Science", folderId: "folder-biology", cardCount: 5, weakCount: 2 },
  { id: "deck-history", name: "Cold War timeline", subject: "Humanities", folderId: "folder-history", cardCount: 4, weakCount: 1 },
  { id: "deck-spanish", name: "Spanish verbs", subject: "Languages", folderId: "folder-spanish", cardCount: 3, weakCount: 1 },
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
    tags: ["grammar"],
    due: true,
    weak: true,
    status: "relearning",
  },
];

export const WALKTHROUGH_SOURCES: WalkthroughSource[] = [
  {
    id: "source-biology-notes",
    title: "Photosynthesis class notes",
    type: "pasted_text",
    subject: "Biology",
    folderId: "folder-biology",
    topicIds: ["topic-photosynthesis"],
    contentText:
      "Plants use light energy to convert carbon dioxide and water into glucose and oxygen. Chlorophyll absorbs the light energy.",
    status: "active",
  },
  {
    id: "source-history-note",
    title: "Cold War causes summary",
    type: "manual_note",
    subject: "History",
    folderId: "folder-history",
    topicIds: ["topic-cold-war"],
    contentText:
      "After 1945, ideological conflict, Eastern Europe, and nuclear weapons increased mistrust between the USA and USSR.",
    status: "active",
  },
  {
    id: "source-file-ref",
    title: "Spanish speaking prompt reference",
    type: "file",
    subject: "Spanish",
    folderId: "folder-spanish",
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
    title: "Photosynthesis practice book",
    type: "general_working",
    topicIds: ["topic-photosynthesis"],
    sourceIds: ["source-biology-notes"],
    color: "emerald",
    icon: "leaf",
    pageColor: "white",
    updatedAt: Date.now() - 1000 * 60 * 45,
  },
  {
    id: "notebook-biology-paper",
    folderId: "folder-biology",
    title: "Biology mock paper working",
    type: "uploaded_file",
    topicIds: ["topic-photosynthesis"],
    sourceIds: [],
    color: "sky",
    icon: "file",
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
    color: "amber",
    icon: "book",
    pageColor: "grey",
    updatedAt: Date.now() - 1000 * 60 * 60 * 5,
  },
];

export const WALKTHROUGH_NOTEBOOK_PAGES: WalkthroughNotebookPage[] = [
  {
    id: "page-photosynthesis-1",
    notebookId: "notebook-photosynthesis",
    folderId: "folder-biology",
    pageNumber: 1,
    pageType: "question",
    pageColor: "white",
    questionPrompt: "Explain why chlorophyll is important in photosynthesis.",
    typedContent: "Chlorophyll absorbs light energy. I need to connect that to making glucose.",
    updatedAt: Date.now() - 1000 * 60 * 45,
  },
  {
    id: "page-biology-paper-1",
    notebookId: "notebook-biology-paper",
    folderId: "folder-biology",
    pageNumber: 1,
    pageType: "past_paper_page",
    pageColor: "white",
    questionPrompt:
      "Uploaded file reference: biology-mock-paper.pdf. Full PDF annotation and OCR come later.",
    typedContent: "Public walkthrough simulation: file metadata is local-only.",
    updatedAt: Date.now() - 1000 * 60 * 90,
  },
  {
    id: "page-history-1",
    notebookId: "notebook-history",
    folderId: "folder-history",
    pageNumber: 1,
    pageType: "source_note",
    pageColor: "grey",
    typedContent: "Compare ideology, Eastern Europe, nuclear tension, and post-war mistrust.",
    updatedAt: Date.now() - 1000 * 60 * 60 * 5,
  },
];

export const WALKTHROUGH_INITIAL_DRAFTS: WalkthroughDraft[] = [
  {
    id: "draft-photosynthesis-card",
    kind: "flashcard",
    front: "What does chlorophyll do?",
    back: "It absorbs light energy for photosynthesis.",
    topicIds: ["topic-photosynthesis"],
    sourceId: "source-biology-notes",
    contentStatus: "draft",
  },
  {
    id: "draft-history-page",
    kind: "practice-question",
    questionText: "Explain one reason the Cold War became tense after 1945.",
    answerText: "Ideological conflict made both sides suspicious of each other's aims.",
    solutionText: "Name the cause, then explain how it increased mistrust.",
    topicIds: ["topic-cold-war"],
    sourceId: "source-history-note",
    contentStatus: "draft",
  },
];

export function getWalkthroughTopicNames(topicIds: string[]) {
  return topicIds
    .map((topicId) => WALKTHROUGH_TOPICS.find((topic) => topic.id === topicId)?.name)
    .filter((name): name is string => Boolean(name));
}
