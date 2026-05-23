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
  contentStatus: "draft";
};

export type WalkthroughTutorMessage = {
  role: "user" | "model";
  text: string;
};

export type WalkthroughTutorIntent =
  | "hint"
  | "check-working"
  | "explain-concept"
  | "show-method"
  | "full-solution"
  | "make-flashcard"
  | "similar-question";

export const WALKTHROUGH_TOPICS: WalkthroughTopic[] = [
  { id: "topic-eigenvalues", name: "Eigenvalues", subject: "Linear Algebra" },
  { id: "topic-multiplicity", name: "Algebraic vs geometric multiplicity", subject: "Linear Algebra" },
  { id: "topic-uniform-convergence", name: "Uniform convergence", subject: "Analysis" },
  { id: "topic-integration-by-parts", name: "Integration by parts", subject: "Methods" },
];

export const WALKTHROUGH_DECKS: WalkthroughDeck[] = [
  { id: "deck-linear-algebra", name: "Linear Algebra", subject: "Maths", cardCount: 5, weakCount: 2 },
  { id: "deck-analysis", name: "Analysis 2", subject: "Maths", cardCount: 4, weakCount: 1 },
  { id: "deck-methods", name: "Methods", subject: "Maths", cardCount: 3, weakCount: 1 },
];

export const WALKTHROUGH_CARDS: WalkthroughCard[] = [
  {
    id: "card-eigenvector",
    deckId: "deck-linear-algebra",
    front: "What is an eigenvector?",
    back: "A non-zero vector whose direction is unchanged by a linear transformation.",
    topicIds: ["topic-eigenvalues"],
    tags: ["definition", "core"],
    due: true,
    weak: false,
    status: "review",
  },
  {
    id: "card-geometric-multiplicity",
    deckId: "deck-linear-algebra",
    front: "What does geometric multiplicity measure?",
    back: "The dimension of the eigenspace for an eigenvalue.",
    topicIds: ["topic-multiplicity"],
    tags: ["weak", "exam"],
    due: true,
    weak: true,
    status: "relearning",
  },
  {
    id: "card-algebraic-multiplicity",
    deckId: "deck-linear-algebra",
    front: "What does algebraic multiplicity measure?",
    back: "The power of an eigenvalue as a root of the characteristic polynomial.",
    topicIds: ["topic-multiplicity"],
    tags: ["definition"],
    due: false,
    weak: true,
    status: "learning",
  },
  {
    id: "card-uniform-convergence",
    deckId: "deck-analysis",
    front: "State the uniform convergence criterion using epsilon.",
    back: "For every epsilon > 0, there is N such that for all n >= N and all x in the domain, |f_n(x)-f(x)| < epsilon.",
    topicIds: ["topic-uniform-convergence"],
    tags: ["proof", "definition"],
    due: true,
    weak: true,
    status: "relearning",
  },
  {
    id: "card-integration-by-parts",
    deckId: "deck-methods",
    front: "When is integration by parts a good move?",
    back: "When the integrand is a product and one factor simplifies after differentiation.",
    topicIds: ["topic-integration-by-parts"],
    tags: ["method"],
    due: false,
    weak: false,
    status: "review",
  },
];

export const WALKTHROUGH_QUESTIONS: WalkthroughQuestion[] = [
  {
    id: "question-multiplicity",
    questionText:
      "A 3 by 3 matrix has characteristic polynomial (lambda - 2)^3. Its eigenspace for lambda = 2 is one-dimensional. Is the matrix diagonalizable? Explain why.",
    answerText:
      "No. The algebraic multiplicity is 3 but the geometric multiplicity is 1, so there are not enough independent eigenvectors to diagonalize the matrix.",
    solutionText:
      "A matrix is diagonalizable only if the sum of the eigenspace dimensions equals the matrix size. Here the only eigenvalue has algebraic multiplicity 3 but geometric multiplicity 1, so there is only one independent eigenvector.",
    topicIds: ["topic-eigenvalues", "topic-multiplicity"],
    difficulty: "medium",
  },
  {
    id: "question-uniform-convergence",
    questionText:
      "Suppose f_n(x) = x^n on [0, 1]. Does f_n converge uniformly on [0, 1]? Give the key reason.",
    answerText:
      "No. The pointwise limit is 0 for x < 1 and 1 at x = 1, which is discontinuous, while each f_n is continuous. A uniform limit of continuous functions is continuous.",
    solutionText:
      "Each f_n is continuous on [0,1]. If convergence were uniform, the limit would be continuous. The pointwise limit jumps at x=1, so convergence cannot be uniform.",
    topicIds: ["topic-uniform-convergence"],
    difficulty: "hard",
  },
  {
    id: "question-parts",
    questionText:
      "Use integration by parts to set up integral x e^x dx. Which factor should you differentiate, and why?",
    answerText:
      "Differentiate x and integrate e^x. Differentiating x simplifies it to 1 while e^x stays manageable when integrated.",
    solutionText:
      "Let u = x and dv = e^x dx. Then du = dx and v = e^x, so the integral becomes x e^x - integral e^x dx.",
    topicIds: ["topic-integration-by-parts"],
    difficulty: "easy",
  },
];

export const WALKTHROUGH_ATTEMPTS: WalkthroughAttempt[] = [
  {
    id: "attempt-1",
    questionId: "question-multiplicity",
    isCorrect: false,
    confidence: 2,
    hintsUsed: 2,
    tutorUsed: true,
    mistakeLabels: ["mixed up multiplicities", "not enough eigenvectors"],
    createdAt: Date.now() - 1000 * 60 * 60 * 8,
  },
  {
    id: "attempt-2",
    questionId: "question-uniform-convergence",
    isCorrect: false,
    confidence: 2,
    hintsUsed: 1,
    tutorUsed: true,
    mistakeLabels: ["missed discontinuous limit"],
    createdAt: Date.now() - 1000 * 60 * 60 * 4,
  },
  {
    id: "attempt-3",
    questionId: "question-parts",
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
    id: "draft-multiplicity",
    front: "What is the difference between algebraic and geometric multiplicity?",
    back: "Algebraic multiplicity is how often an eigenvalue appears as a root of the characteristic polynomial; geometric multiplicity is the dimension of its eigenspace.",
    topicIds: ["topic-multiplicity"],
    sourceQuestionId: "question-multiplicity",
    contentStatus: "draft",
  },
];

export const WALKTHROUGH_INITIAL_TUTOR_MESSAGES: WalkthroughTutorMessage[] = [
  {
    role: "user",
    text: "Give me one hint without revealing the answer.",
  },
  {
    role: "model",
    text: "Start by comparing the algebraic multiplicity with the dimension of the eigenspace. Diagonalizable matrices need enough independent eigenvectors. Try stating those two numbers first.",
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
