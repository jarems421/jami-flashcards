export async function runPaperGenerationBenchmarkWorkflow(runId: string) {
  "use workflow";

  const caseIds = await listCases(runId);
  for (const caseId of caseIds) {
    const status = await runCase(runId, caseId);
    if (status === "cancelled" || status === "paused") {
      await finishRun(runId);
      return { status };
    }
  }
  await finishRun(runId);
  return { status: "awaiting_review" as const };
}

async function listCases(runId: string) {
  "use step";
  const { listPaperGenerationBenchmarkCaseIds } = await import(
    "@/services/ai/paper-generation-benchmark.server"
  );
  return listPaperGenerationBenchmarkCaseIds(runId);
}

async function runCase(runId: string, caseId: string) {
  "use step";
  const { runPaperGenerationBenchmarkCase } = await import(
    "@/services/ai/paper-generation-benchmark.server"
  );
  return runPaperGenerationBenchmarkCase(runId, caseId);
}

async function finishRun(runId: string) {
  "use step";
  const { finishPaperGenerationBenchmarkRun } = await import(
    "@/services/ai/paper-generation-benchmark.server"
  );
  await finishPaperGenerationBenchmarkRun(runId);
}
