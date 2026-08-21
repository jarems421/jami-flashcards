import {
  PAPER_GENERATION_BENCHMARK_CASE_KINDS,
  PAPER_GENERATION_BENCHMARK_DEFINITIONS,
  PAPER_GENERATION_BENCHMARK_REPETITIONS,
  buildPaperGenerationBenchmarkCaseId,
} from "@/lib/practice/paper-generation-benchmark";

export async function runPaperGenerationBenchmarkWorkflow(runId: string) {
  "use workflow";

  for (const definition of PAPER_GENERATION_BENCHMARK_DEFINITIONS) {
    for (const kind of PAPER_GENERATION_BENCHMARK_CASE_KINDS) {
      for (let repetition = 1; repetition <= PAPER_GENERATION_BENCHMARK_REPETITIONS; repetition += 1) {
        const caseId = buildPaperGenerationBenchmarkCaseId(definition.id, kind, repetition);
        const status = await runCase(runId, caseId);
        if (status === "cancelled" || status === "paused") {
          await finishRun(runId);
          return { status };
        }
      }
    }
  }
  await finishRun(runId);
  return { status: "awaiting_review" as const };
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
