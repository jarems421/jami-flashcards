export async function runExamFormatImportWorkflow(importId: string) {
  "use workflow";

  return processImport(importId);
}

async function processImport(importId: string) {
  "use step";
  const { processExamFormatImport } = await import(
    "@/services/ai/exam-format-library.server"
  );
  return processExamFormatImport(importId);
}
