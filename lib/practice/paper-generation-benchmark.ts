import type { ExamBoardId, ExamQualification } from "@/lib/practice/exam-formats";

export type PaperGenerationBenchmarkDefinition = {
  id: string;
  profileId: string;
  board: ExamBoardId;
  qualification: ExamQualification;
  subject: string;
  componentLabel: string;
  officialQuery: string;
  officialUrls: string[];
  aliases: string[];
  /** Officially announced components for which the board has not released an assessment artifact yet. */
  assessmentArtifactUnavailable?: boolean;
};

export type PaperGenerationBenchmarkCaseKind =
  | "official_format"
  | "synthetic_folder"
  | "complete_with_emphasis";

export type PaperGenerationBenchmarkReviewScores = {
  authenticity: number;
  levelFit: number;
  schemeCorrectness: number;
  specificationCoverage: number;
  timing: number;
  visualQuality: number;
  accessibility: number;
  originality: number;
};

export type PaperGenerationBenchmarkBlocker =
  | "unanswerable_question"
  | "incorrect_scheme"
  | "invalid_total"
  | "answer_leak"
  | "missing_insert"
  | "broken_visual"
  | "confirmed_copying"
  | "privacy_failure"
  | "ownership_failure";

export type PaperGenerationBenchmarkReview = {
  reviewerUid: string;
  usable: boolean;
  scores: PaperGenerationBenchmarkReviewScores;
  blockers: PaperGenerationBenchmarkBlocker[];
  comments?: string;
  reviewedAt: number;
};

export type PaperGenerationBenchmarkRunStatus =
  | "draft"
  | "queued"
  | "running"
  | "paused"
  | "awaiting_review"
  | "approved"
  | "failed"
  | "cancelled";

export type PaperGenerationBenchmarkRun = {
  id: string;
  definitionVersion: string;
  status: PaperGenerationBenchmarkRunStatus;
  expectedCases: number;
  completedCases: number;
  reviewedCases: number;
  passedCases: number;
  projectedCostUsd: number;
  spendCeilingUsd: number;
  estimatedCostUsd: number;
  cancellationRequested: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
};

export type PaperGenerationBenchmarkCase = {
  id: string;
  runId: string;
  definitionId: string;
  profileId: string;
  profileVersion: string;
  kind: PaperGenerationBenchmarkCaseKind;
  repetition: 1 | 2 | 3;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  generationJobId?: string;
  paperStoragePath?: string;
  privateArtifactPath?: string;
  contentHash?: string;
  estimatedCostUsd: number;
  failureCode?: string;
  review?: PaperGenerationBenchmarkReview;
  createdAt: number;
  updatedAt: number;
};

export type PaperGenerationBenchmarkReport = {
  schemaVersion: 2;
  runId: string;
  definitionVersion: string;
  createdAt: number;
  expectedCases: number;
  completedCases: number;
  reviewedCases: number;
  hardBlockers: Record<PaperGenerationBenchmarkBlocker, number>;
  components: Record<string, {
    profileVersion: string;
    cases: number;
    usableCases: number;
    scoreDistributions: Record<keyof PaperGenerationBenchmarkReviewScores, number[]>;
  }>;
};

export const PAPER_GENERATION_BENCHMARK_VERSION = "2026-08-21.uk-written.v2";
export const PAPER_GENERATION_BENCHMARK_REPETITIONS = 3;
export const PAPER_GENERATION_BENCHMARK_CASE_KINDS: PaperGenerationBenchmarkCaseKind[] = [
  "official_format",
  "synthetic_folder",
  "complete_with_emphasis",
];

export const PAPER_GENERATION_BENCHMARK_DEFINITIONS: PaperGenerationBenchmarkDefinition[] = [
  {
    id: "aqa-gcse-mathematics-higher-paper-1",
    profileId: "aqa-gcse-mathematics-8300-1h",
    board: "aqa",
    qualification: "gcse",
    subject: "Mathematics",
    componentLabel: "Higher Paper 1",
    officialQuery: "AQA GCSE Mathematics 8300 1H Higher Paper 1 current specification sample paper mark scheme",
    officialUrls: [
      "https://www.aqa.org.uk/subjects/mathematics/gcse/mathematics-8300/specification/specification-at-a-glance",
      "https://filestore.aqa.org.uk/resources/mathematics/AQA-83001H-SQP.PDF",
    ],
    aliases: ["aqa maths higher paper 1", "aqa 8300/1h", "aqa gcse mathematics paper 1"],
  },
  {
    id: "aqa-a-level-psychology-paper-1",
    profileId: "aqa-a-level-psychology-7182-1",
    board: "aqa",
    qualification: "a_level",
    subject: "Psychology",
    componentLabel: "Paper 1",
    officialQuery: "AQA A-level Psychology 7182 Paper 1 current specification sample paper mark scheme",
    officialUrls: [
      "https://www.aqa.org.uk/subjects/psychology/a-level/psychology-7182/specification/specification-at-a-glance",
      "https://www.aqa.org.uk/files/sample-papers-and-mark-schemes.2024.June.AQA-71821-MS-JUN24_PDF",
    ],
    aliases: ["aqa psychology paper 1", "aqa 7182/1", "aqa a level psychology"],
  },
  {
    id: "pearson-gcse-english-language-2-paper-1",
    profileId: "pearson-gcse-english-language-1en2-01",
    board: "pearson_edexcel",
    qualification: "gcse",
    subject: "English Language",
    componentLabel: "English Language 2.0 Paper 1",
    officialQuery: "Pearson Edexcel GCSE English Language 2.0 1EN2/01 current specification sample assessment",
    officialUrls: [
      "https://qualifications.pearson.com/content/dam/pdf/GCSE/English%20Language/2021/specification-and-sample-assessment/9781446966709-gcse-2021-l12-eng-lang-2-0.pdf",
      "https://qualifications.pearson.com/content/dam/pdf/GCSE/English%20Language/2021/teaching-and-learning-materials/GCSE-Eng-Lang-2.0-EAMs-set-1.pdf",
    ],
    aliases: ["edexcel english language 2.0 paper 1", "pearson 1en2/01", "gcse english language paper 1"],
  },
  {
    id: "pearson-a-level-mathematics-pure-1",
    profileId: "pearson-a-level-mathematics-9ma0-01",
    board: "pearson_edexcel",
    qualification: "a_level",
    subject: "Mathematics",
    componentLabel: "Pure Mathematics 1",
    officialQuery: "Pearson Edexcel A level Mathematics 9MA0/01 Pure Mathematics 1 current specification sample assessment",
    officialUrls: [
      "https://qualifications.pearson.com/en/qualifications/edexcel-a-levels/mathematics-2017.html",
      "https://qualifications.pearson.com/content/dam/pdf/A%20Level/Mathematics/2017/specification-and-sample-assesment/a-level-l3-mathematics-specification-issue4.pdf",
      "https://qualifications.pearson.com/content/dam/pdf/A-Level/Mathematics/2017/Exam-materials/9ma0-01-que-20220608.pdf",
    ],
    aliases: ["edexcel a level maths pure 1", "pearson 9ma0/01", "pure mathematics 1"],
  },
  {
    id: "ocr-gcse-computer-science-component-02",
    profileId: "ocr-gcse-computer-science-j277-02",
    board: "ocr",
    qualification: "gcse",
    subject: "Computer Science",
    componentLabel: "Component 02",
    officialQuery: "OCR GCSE Computer Science J277/02 current specification sample paper mark scheme",
    officialUrls: [
      "https://www.ocr.org.uk/qualifications/gcse/computer-science-j277-from-2020/specification-at-a-glance/",
      "https://www.ocr.org.uk/Images/552502-computational-thinking-algorithms-and-programming.pdf#sample-paper",
    ],
    aliases: ["ocr computer science component 02", "ocr j277/02", "computational thinking algorithms programming"],
  },
  {
    id: "ocr-a-level-biology-unified-biology",
    profileId: "ocr-a-level-biology-h420-03",
    board: "ocr",
    qualification: "a_level",
    subject: "Biology",
    componentLabel: "Unified Biology",
    officialQuery: "OCR A Level Biology A H420/03 Unified Biology current specification sample paper mark scheme",
    officialUrls: [
      "https://www.ocr.org.uk/qualifications/as-and-alevel/biology-a-h020-h420-from-2015/specification-at-a-glance/",
      "https://www.ocr.org.uk/Images/171739-unit-h420-03-unified-biology-sample-assessment-materials.pdf",
    ],
    aliases: ["ocr unified biology", "ocr h420/03", "a level biology a component 03"],
  },
  {
    id: "eduqas-gcse-geography-b-component-1",
    profileId: "eduqas-gcse-geography-b-c112u10",
    board: "eduqas",
    qualification: "gcse",
    subject: "Geography B",
    componentLabel: "Component 1",
    officialQuery: "Eduqas GCSE Geography B C112U10 Component 1 current specification sample assessment",
    officialUrls: [
      "https://www.eduqas.co.uk/qualifications/geography-gcse-b/",
      "https://www.eduqas.co.uk/media/5ofdo23l/gcse-geog-b-spec.pdf",
      "https://www.eduqas.co.uk/media/k0ngosbf/gcse-geog-b-sams.pdf",
    ],
    aliases: ["eduqas geography b component 1", "eduqas c112u10", "gcse geography b"],
  },
  {
    id: "eduqas-a-level-english-literature-component-1",
    profileId: "eduqas-a-level-english-literature-a720u10",
    board: "eduqas",
    qualification: "a_level",
    subject: "English Literature",
    componentLabel: "Component 1",
    officialQuery: "Eduqas A level English Literature A720U10 Component 1 current specification sample assessment",
    officialUrls: [
      "https://www.eduqas.co.uk/qualifications/english-literature-asa-level/",
      "https://www.eduqas.co.uk/media/gkxh25ep/eduqas-a-level-english-lit-spec-from-2015-e.pdf",
      "https://oer.eduqas.co.uk/Pages/ProjectByArgs.aspx?lvlid=1&subid=23",
    ],
    aliases: ["eduqas a level english literature component 1", "eduqas a720u10", "english literature poetry component"],
  },
  {
    id: "wjec-gcse-history-2026-unit-1",
    profileId: "wjec-gcse-history-2026-unit-1",
    board: "wjec",
    qualification: "gcse",
    subject: "History",
    componentLabel: "2026 specification Unit 1",
    officialQuery: "WJEC GCSE History teaching from 2026 Unit 1 specification sample assessment materials",
    officialUrls: [
      "https://www.wjec.co.uk/qualifications/gcse-history-teaching-from-2026/",
      "https://www.eduqas.co.uk/media/vxehgxuj/wjec-gcse-history-specification-e.pdf",
    ],
    aliases: ["wjec gcse history 2026 unit 1", "made for wales history unit 1"],
    assessmentArtifactUnavailable: true,
  },
  {
    id: "wjec-a-level-chemistry-first-a2-written-unit",
    profileId: "wjec-a-level-chemistry-a2-first-written",
    board: "wjec",
    qualification: "a_level",
    subject: "Chemistry",
    componentLabel: "First A2 written unit",
    officialQuery: "WJEC GCE A level Chemistry first A2 written unit current specification sample assessment",
    officialUrls: [
      "https://www.wjec.co.uk/qualifications/chemistry-asa-level/",
      "https://www.eduqas.co.uk/media/akbbkvwh/wjec-gce-chemistry-spec-from-2015.pdf",
      "https://oer.wjec.co.uk/Pages/ProjectByArgs.aspx?lvlid=1&subid=11",
    ],
    aliases: ["wjec a level chemistry a2", "wjec chemistry first a2 written unit"],
  },
  {
    id: "ccea-gcse-english-language-unit-1",
    profileId: "ccea-gcse-english-language-5030-unit-1",
    board: "ccea",
    qualification: "gcse",
    subject: "English Language",
    componentLabel: "Unit 1",
    officialQuery: "CCEA GCSE English Language 5030 Unit 1 current specification sample paper mark scheme",
    officialUrls: [
      "https://ccea.org.uk/downloads/docs/Specifications/GCSE/GCSE%20English%20Language%20%282017%29/GCSE%20English%20Language%20%282017%29-specification-Standard_0.pdf",
      "https://ccea.org.uk/downloads/docs/Past-Papers/cleared/GCSE/GCSE%20English%20Language%20%282017%29/2024-November/Standard/0/GCSE-English%20Language-490-November2024-Unit%201%2C%20Writing%20for%20Purpose%20and%20Audience%20and%20Reading%20to%20Access%20Non-fiction%20and%20Media%20Texts-Paper.pdf",
    ],
    aliases: ["ccea gcse english language unit 1", "ccea 5030 unit 1"],
  },
  {
    id: "ccea-gce-history-a2-unit-1",
    profileId: "ccea-a-level-history-a2-unit-1",
    board: "ccea",
    qualification: "a_level",
    subject: "History",
    componentLabel: "A2 Unit 1",
    officialQuery: "CCEA GCE History A2 Unit 1 current specification sample paper mark scheme",
    officialUrls: [
      "https://ccea.org.uk/downloads/docs/Specifications/GCE/GCE%20History%20%282019%29/GCE%20History%20%282019%29-specification-Standard.pdf",
      "https://ccea.org.uk/downloads/docs/Past-Papers/cleared/GCE/GCE%20History%20%282019%29/2023-Summer/Standard/0/GCE-History-527-Summer2023-A2%201%2C%20Change%20Over%20Time-Paper.pdf",
    ],
    aliases: ["ccea history a2 unit 1", "ccea gce history change over time"],
  },
];

export function expectedPaperGenerationBenchmarkCases() {
  return PAPER_GENERATION_BENCHMARK_DEFINITIONS.length *
    PAPER_GENERATION_BENCHMARK_CASE_KINDS.length *
    PAPER_GENERATION_BENCHMARK_REPETITIONS;
}

export function buildPaperGenerationBenchmarkCaseId(
  definitionId: string,
  kind: PaperGenerationBenchmarkCaseKind,
  repetition: number
) {
  return `${definitionId}__${kind}__r${repetition}`;
}
