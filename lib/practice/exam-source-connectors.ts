import type { ExamBoardId } from "@/lib/practice/exam-formats";

export type ExamSourceConnector = {
  board: ExamBoardId;
  label: string;
  priority: number;
  catalogueUrls: string[];
};

/** Ordered exactly as the corpus rollout. URLs are discovery roots only. */
export const EXAM_SOURCE_CONNECTORS: readonly ExamSourceConnector[] = [
  { board: "aqa", label: "AQA", priority: 1, catalogueUrls: ["https://www.aqa.org.uk/find-past-papers-and-mark-schemes"] },
  { board: "pearson_edexcel", label: "Pearson Edexcel", priority: 2, catalogueUrls: ["https://qualifications.pearson.com/en/support/support-topics/exams/past-papers.html"] },
  { board: "ocr", label: "OCR", priority: 3, catalogueUrls: ["https://www.ocr.org.uk/qualifications/past-paper-finder/"] },
  { board: "wjec", label: "WJEC", priority: 4, catalogueUrls: ["https://www.wjec.co.uk/home/past-papers/"] },
  { board: "eduqas", label: "Eduqas", priority: 4, catalogueUrls: ["https://www.eduqas.co.uk/home/past-papers/"] },
  { board: "ccea", label: "CCEA", priority: 4, catalogueUrls: ["https://ccea.org.uk/post-16/gce/past-papers-mark-schemes"] },
  { board: "qualifications_scotland", label: "Qualifications Scotland", priority: 5, catalogueUrls: ["https://www.sqa.org.uk/pastpapers/findpastpaper.htm"] },
  { board: "cambridge_international", label: "Cambridge International", priority: 6, catalogueUrls: ["https://www.cambridgeinternational.org/programmes-and-qualifications/"] },
  { board: "pearson_international", label: "Pearson International", priority: 6, catalogueUrls: ["https://qualifications.pearson.com/en/support/support-topics/exams/past-papers.html"] },
  { board: "oxford_aqa", label: "OxfordAQA", priority: 6, catalogueUrls: ["https://www.oxfordaqa.com/qualifications/"] },
  { board: "ib", label: "IB", priority: 7, catalogueUrls: ["https://www.ibo.org/programmes/assessment-and-exams/"] },
];

export function getExamSourceConnector(board: ExamBoardId) {
  return EXAM_SOURCE_CONNECTORS.find((connector) => connector.board === board);
}
