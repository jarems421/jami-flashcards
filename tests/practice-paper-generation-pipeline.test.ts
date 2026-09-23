import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PracticePaperGenerationRequest } from "@/lib/ai/practice-paper-generation";
import type { Source } from "@/lib/material/sources";

/**
 * The practice-paper generation pipeline, pinned from request to response.
 *
 * Every model call, store and validator the orchestration leans on is faked,
 * so what is under test is the orchestration itself: which passes run and in
 * what order, with which role, limits and evidence; which stages a job moves
 * through; what is checkpointed and what is forgotten; and which failure a
 * student sees, with or without a refund. The pipeline had no test of its own,
 * and these exist so it can be restructured against something.
 */

type RecordedCall = {
  kind: string;
  stream: boolean;
  role: string;
  taskClass: string;
  reasoningEffort?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  stallTimeoutMs?: number;
  system: string;
  parts: string[];
};

type RouterOptions = {
  role: string;
  taskClass: string;
  reasoningEffort?: string;
  timeoutMs?: number;
  stallTimeoutMs?: number;
  generationConfig?: { temperature?: number; maxOutputTokens?: number };
  request: { systemInstruction?: string; contents: { parts: { text?: string }[] }[] };
  onResponse?: (item: Record<string, unknown>) => void;
};

type Issue = { questionId?: string; code: string; detail: string };
type Question = { id: string; marks: number };

const mocks = vi.hoisted(() => {
  const paperText = (marks: number[]) =>
    JSON.stringify({
      status: "ready",
      title: "Paper",
      questions: marks.map((value, index) => ({ id: `q${index + 1}`, marks: value })),
    });
  const pass = JSON.stringify({ pass: true, issues: [] });
  const items = JSON.stringify({ items: [{ questionId: "q1" }] });
  return {
    paperText,
    defaults: {
      design: paperText([4, 3, 5]),
      scheme_batch: items,
      scheme_retry: items,
      scheme_repair: items,
      audit: pass,
      reaudit: pass,
      juror: pass,
      repair: JSON.stringify({ ok: true }),
      repair_retry: JSON.stringify({ ok: true }),
      vision: "Specification: three papers of 80 marks.",
    } as Record<string, string>,
    state: {
      configured: true,
      replies: {} as Record<string, (string | Error)[]>,
      unreadableBatches: 0,
      schemeIssues: [] as Issue[][],
      routingIssues: [] as Issue[],
      sectionWrong: [] as { section: string; actual: number; expected: number }[],
      /** Answers for successive section checks, before falling back to `sectionWrong`. */
      sectionWrongQueue: [] as { section: string; actual: number; expected: number }[][],
      incomplete: false,
      chunks: [] as Record<string, unknown>[],
      inputTokenCap: null as number | null,
      checkpoints: new Map<string, { text: string; modelName: string }>(),
      docs: new Map<string, Record<string, unknown>>(),
    },
    events: {
      calls: [] as RecordedCall[],
      captured: [] as string[],
      stages: [] as string[],
      logs: [] as { level: string; event: string; fields?: Record<string, unknown> }[],
      forgotten: [] as string[],
      written: [] as string[],
      parsed: [] as string[],
      refunds: 0,
      budgetChecks: 0,
    },
  };
});

vi.mock("@/lib/ai/provider-router", () => {
  const kindOf = (options: RouterOptions) => {
    if (options.role === "documentVision") return "vision";
    const system = options.request.systemInstruction ?? "";
    if (system.startsWith("You are Jami's assessment designer")) return "design";
    if (system.startsWith("You are Jami's senior mark-scheme designer")) {
      if (system.includes("truncated or structurally unreadable")) return "scheme_retry";
      if (system.includes("Correct every listed structural fault")) return "scheme_repair";
      return "scheme_batch";
    }
    if (system.startsWith("You are Jami's senior independent assessment supervisor. Check")) return "audit";
    if (system.startsWith("You are Jami's senior independent assessment supervisor. Verify")) return "reaudit";
    if (system.startsWith("You are Jami's assessment editor")) return "repair";
    if (system.startsWith("Correct the malformed assessment repair patch")) return "repair_retry";
    if (system.startsWith("You are the final independent assessment-quality juror")) return "juror";
    return "unknown";
  };
  const generate = (stream: boolean) => async (options: RouterOptions) => {
    const kind = kindOf(options);
    mocks.events.calls.push({
      kind,
      stream,
      role: options.role,
      taskClass: options.taskClass,
      reasoningEffort: options.reasoningEffort,
      temperature: options.generationConfig?.temperature,
      maxOutputTokens: options.generationConfig?.maxOutputTokens,
      timeoutMs: options.timeoutMs,
      stallTimeoutMs: options.stallTimeoutMs,
      system: options.request.systemInstruction ?? "",
      parts: options.request.contents.flatMap((content) => content.parts.map((part) => part.text ?? "[binary]")),
    });
    const reply = mocks.state.replies[kind]?.shift() ?? mocks.defaults[kind] ?? "";
    if (reply instanceof Error) throw reply;
    options.onResponse?.({ provider: "test", role: options.role, modelName: `model-${kind}` });
    return reply;
  };
  return {
    isAnyAiProviderConfigured: () => mocks.state.configured,
    generateAiText: generate(false),
    generateAiTextBufferedStream: generate(true),
    countAiInputTokens: async () => 1_000_000,
  };
});

vi.mock("@/lib/ai/practice-paper-generation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/practice-paper-generation")>()),
  parsePracticePaperGenerationRequest: (body: unknown) => {
    const value = body as { folderId?: string; sourceIds?: string[] } | null;
    return value?.folderId
      ? {
          folderId: value.folderId,
          sourceIds: value.sourceIds ?? [],
          request: "A full Paper 1",
          coverage: "The whole course",
          length: "full",
          focus: "balanced",
          focusDetail: "",
        }
      : null;
  },
  rankPracticePaperSources: <T>(sources: T[]) => sources,
  parsePracticePaperModelAnswer: (text: string) => {
    mocks.events.parsed.push(text);
    let payload: { status?: string; title?: string; questions?: Question[]; markScheme?: unknown };
    try {
      payload = JSON.parse(text);
    } catch {
      return null;
    }
    if (payload.status === "needs_clarification") {
      return { status: "needs_clarification", question: "Which tier?", sourceRefs: [] };
    }
    if (payload.status !== "ready" || !Array.isArray(payload.questions)) return null;
    return {
      status: "ready",
      assessmentProfile: { confidence: "high" },
      title: payload.title,
      instructions: [],
      durationMinutes: 90,
      questions: payload.questions,
      choiceGroups: [],
      totalMarks: payload.questions.reduce((total, question) => total + question.marks, 0),
      markScheme: payload.markScheme ?? { items: [] },
      sourceRefs: ["S1"],
      gradeGuidance: { kind: "none" },
      examinerInsights: [],
    };
  },
  partitionMarkSchemeQuestions: <T>(questions: T[]) =>
    Array.from({ length: Math.ceil(questions.length / 2) }, (_, index) => questions.slice(index * 2, index * 2 + 2)),
  normalizeGeneratedMarkSchemeBatch: (items: unknown, questions: Question[]) => {
    if (mocks.state.unreadableBatches > 0) {
      mocks.state.unreadableBatches -= 1;
      return null;
    }
    return Array.isArray(items) ? questions.map((question) => ({ questionId: question.id })) : null;
  },
  canonicalizeGeneratedMarkSchemeItems: (items: unknown[]) => items,
  applyPracticePaperAuditRepairPatch: (paper: Record<string, unknown>, payload: Record<string, unknown>) =>
    payload.ok === true ? { ...paper, title: "Repaired" } : null,
  buildPracticePaperGenerationResponse: (input: {
    parsed: { status: string; title?: string };
    sourcesByRef: Map<string, unknown>;
    generationAudit?: { issueCount: number; repaired: boolean };
  }) => ({
    status: input.parsed.status,
    title: input.parsed.title ?? null,
    sourceRefs: Array.from(input.sourcesByRef.keys()),
    ...(input.generationAudit
      ? { generationAudit: { issueCount: input.generationAudit.issueCount, repaired: input.generationAudit.repaired } }
      : {}),
  }),
}));

vi.mock("@/lib/ai/practice-paper-quality", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/practice-paper-quality")>()),
  isCompletePracticePaperCandidate: () => !mocks.state.incomplete,
  markSchemeIssues: () => mocks.state.schemeIssues.shift() ?? [],
  sameFixedPaper: () => true,
}));

vi.mock("@/lib/practice/asset-routing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/practice/asset-routing")>()),
  paperFigureIssues: () => mocks.state.routingIssues,
}));

vi.mock("@/lib/practice/exam-formats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/practice/exam-formats")>()),
  sectionMarkIssues: () => ({
    wrong: mocks.state.sectionWrongQueue.length ? mocks.state.sectionWrongQueue.shift()! : mocks.state.sectionWrong,
    built: new Set(["A"]),
  }),
}));

vi.mock("@/lib/practice/practice-papers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/practice/practice-papers")>()),
  getPracticePaperQuestionLimit: () => 24,
  getPracticePaperTargetMarks: () => 80,
  normalizePracticePaperMarkScheme: (scheme: Record<string, unknown>) => scheme,
}));

vi.mock("@/lib/ai/budgets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/budgets")>()),
  getAiInputTokenCap: () => mocks.state.inputTokenCap,
}));

vi.mock("@/lib/ai/jami-assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/jami-assistant")>()),
  buildJamiAssistantReferenceParts: (input: { reference: string; parts: readonly unknown[] }) => [
    { text: `BEGIN ${input.reference}` },
    ...input.parts,
    { text: `END ${input.reference}` },
  ],
}));

vi.mock("@/lib/ai/source-ingestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/source-ingestion")>()),
  prepareSourceForTutor: async (source: { id: string; title: string }) => ({
    sourceId: source.id,
    label: source.title,
    parts: [{ text: "Prepared source text" }],
    inputBytes: 20,
  }),
}));

vi.mock("@/lib/material/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/material/sources")>()),
  mapSourceData: (id: string, data: Record<string, unknown>) => ({ id, ...data }),
}));

vi.mock("@/lib/observability/logger", async (importOriginal) => {
  const record = (level: string) => (event: string, fields?: Record<string, unknown>) => {
    mocks.events.logs.push({ level, event, fields });
  };
  return {
    ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
    createLogger: () => ({ debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error") }),
  };
});

vi.mock("@/lib/ai/generation-capture", () => ({
  captureGenerationPass: (captured: { pass: string }) => {
    mocks.events.captured.push(captured.pass);
  },
}));

vi.mock("@/lib/ai/generation-checkpoint", () => ({
  readGenerationCheckpoint: (key: { pass: string }) => mocks.state.checkpoints.get(key.pass) ?? null,
  writeGenerationCheckpoint: (key: { pass: string }) => {
    mocks.events.written.push(key.pass);
  },
  forgetGenerationCheckpoint: (key: { pass: string }) => {
    mocks.events.forgotten.push(key.pass);
  },
  questionFingerprint: () => "fingerprint",
}));

vi.mock("@/services/ai/budgets", () => ({
  checkAiBudget: async () => {
    mocks.events.budgetChecks += 1;
    return { allowed: true, grant: { id: "grant-1" } };
  },
  createAiBudgetLimitResponse: () => Response.json({ code: "budget_limit" }, { status: 429 }),
  getAiTokenCap: () => 16_000,
  refundAiBudget: async () => {
    mocks.events.refunds += 1;
  },
}));

vi.mock("@/services/ai/source-index.server", () => ({
  retrieveSourceChunks: async () => mocks.state.chunks,
}));

vi.mock("@/services/firebase/admin", () => {
  const children = (path: string) =>
    Array.from(mocks.state.docs.entries())
      .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/"))
      .map(([key, data]) => ({ id: key.split("/").at(-1), data: () => data }));
  const query = (path: string): unknown => ({
    where: () => query(path),
    limit: () => query(path),
    get: async () => ({ docs: children(path) }),
  });
  const document = (path: string): unknown => ({
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => {
      const data = mocks.state.docs.get(path);
      return { id: path.split("/").at(-1), exists: data !== undefined, data: () => data };
    },
    update: async (value: Record<string, unknown>) => {
      mocks.events.stages.push(String(value.stage));
    },
  });
  const collection = (path: string) => ({
    doc: (id: string) => document(`${path}/${id}`),
    where: () => query(path),
  });
  return {
    getAdminAuth: () => ({
      verifyIdToken: async (token: string) => {
        if (token !== "valid-token") throw new Error("invalid token");
        return { uid: "user-1" };
      },
    }),
    getAdminDb: () => ({ collection }),
    getAdminStorageBucket: () => ({ file: () => ({ download: async () => [Buffer.from("%PDF")] }) }),
  };
});

const {
  runPracticePaperGenerationForBenchmark,
  runPracticePaperGenerationForWorkflow,
  runPracticePaperGenerationRequest,
} = await import("@/services/ai/practice-paper-generation.server");

const SOURCE = {
  id: "source-1",
  title: "Specification",
  type: "text",
  status: "active",
  folderIds: ["folder-1"],
  sizeBytes: 1_000,
};
const PAST_PAPER = {
  title: "Past paper",
  type: "file",
  status: "active",
  folderIds: ["folder-1"],
  storagePath: "users/user-1/past-paper.pdf",
  fileType: "application/pdf",
};
const CONTEXT = {
  sources: [SOURCE] as unknown as Source[],
  studyContext: { folderName: "Maths", subject: "Mathematics", studyLevel: "GCSE" },
};
const PAPER_REQUEST = { folderId: "folder-1" } as unknown as PracticePaperGenerationRequest;
const ENVIRONMENT = [
  "PRACTICE_PAPER_MODEL_TIMEOUT_MS",
  "PRACTICE_PAPER_DURABLE_DEADLINE_MS",
  "PRACTICE_PAPER_MARK_SCHEME_WORKER_ENABLED",
  "PRACTICE_PAPER_AUDIT_WORKER_ENABLED",
  "PRACTICE_PAPER_MARK_SCHEME_CONCURRENCY",
  "AI_PAPER_IMAGES_ENABLED",
];
const FAULT: Issue = { questionId: "q2", code: "points_do_not_sum", detail: "Points sum to 2 of 3." };
const OFF_TOPIC: Issue = { questionId: "q1", code: "scheme_off_topic", detail: "Little overlap with the question." };

function failingAudit(code: string, detail: string, questionId?: string) {
  return JSON.stringify({
    pass: false,
    issues: [{ code, severity: "error", detail, ...(questionId ? { questionId } : {}) }],
  });
}

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://jami.test/practice-papers/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function generate(
  options: {
    auth?: { uid: string; internalJobId?: string; skipBudget?: boolean };
    body?: unknown;
    context?: typeof CONTEXT | null;
    formatContext?: string;
    expectedTotalMarks?: number;
    expectedSections?: { id: string; marks: number }[];
  } = {}
) {
  const sunk: unknown[][] = [];
  const response = await runPracticePaperGenerationRequest(
    postRequest(options.body ?? { folderId: "folder-1" }),
    options.auth ?? { uid: "user-1" },
    "Board: AQA",
    options.formatContext,
    options.context === null ? undefined : (options.context ?? CONTEXT),
    (diagnostics) => sunk.push(diagnostics),
    options.expectedTotalMarks,
    options.expectedSections
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, sunk };
}

const callsOf = (kind: string) => mocks.events.calls.filter((call) => call.kind === kind);
const logged = (event: string) => mocks.events.logs.filter((entry) => entry.event === event);
const limits = (call: RecordedCall | undefined) =>
  call && {
    stream: call.stream,
    role: call.role,
    taskClass: call.taskClass,
    reasoningEffort: call.reasoningEffort,
    temperature: call.temperature,
    maxOutputTokens: call.maxOutputTokens,
    timeoutMs: call.timeoutMs,
    stallTimeoutMs: call.stallTimeoutMs,
  };

beforeEach(() => {
  const { state, events } = mocks;
  state.configured = true;
  state.replies = {};
  state.unreadableBatches = 0;
  state.schemeIssues = [];
  state.routingIssues = [];
  state.sectionWrong = [];
  state.sectionWrongQueue = [];
  state.incomplete = false;
  state.chunks = [{ sourceId: "source-1", text: "Specification extract", pageStart: 2, pageEnd: 3, heading: "Scope" }];
  state.inputTokenCap = null;
  state.checkpoints.clear();
  state.docs = new Map<string, Record<string, unknown>>([
    ["users/user-1", { defaultStudyLevel: "gcse" }],
    ["users/user-1/studyFolders/folder-1", { name: "Maths", subject: "Mathematics" }],
    ["users/user-1/sources/source-1", { ...SOURCE }],
    ["users/user-1/practicePaperJobs/job-1", { cancellationRequested: false }],
  ]);
  events.calls = [];
  events.captured = [];
  events.stages = [];
  events.logs = [];
  events.forgotten = [];
  events.written = [];
  events.parsed = [];
  events.refunds = 0;
  events.budgetChecks = 0;
  for (const name of ENVIRONMENT) vi.stubEnv(name, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("practice paper generation", () => {
  it("refuses before doing any work when AI is off, the caller is unknown or the request is unreadable", async () => {
    mocks.state.configured = false;
    expect(await generate()).toMatchObject({
      status: 503,
      body: { error: "AI features are not configured", code: "not_configured" },
    });
    mocks.state.configured = true;

    expect((await runPracticePaperGenerationRequest(postRequest({ folderId: "folder-1" }))).status).toBe(401);
    const forged = await runPracticePaperGenerationRequest(
      postRequest({ folderId: "folder-1" }, { Authorization: "Bearer forged" })
    );
    expect(await forged.json()).toEqual({ error: "Unauthorized", code: "unauthorized" });

    expect(await generate({ body: "{not json" })).toMatchObject({
      status: 400,
      body: { error: "Invalid request body", code: "invalid_request" },
    });
    expect(await generate({ body: { folderId: "" } })).toMatchObject({
      status: 400,
      body: { error: "Invalid practice paper request", code: "invalid_request" },
    });

    const huge = { ...CONTEXT, sources: [{ ...SOURCE, sizeBytes: 46 * 1024 * 1024 }] as unknown as Source[] };
    expect(await generate({ context: huge })).toMatchObject({ status: 413, body: { code: "sources_too_large" } });

    expect(mocks.events.calls).toEqual([]);
    expect(mocks.events.budgetChecks).toBe(0);
  });

  it("designs, marks and audits a paper through a fixed sequence of passes", async () => {
    const { status, body, sunk } = await generate();

    expect(status).toBe(200);
    expect(body).toEqual({
      status: "ready",
      title: "Paper",
      sourceRefs: ["S1"],
      generationAudit: { issueCount: 0, repaired: false },
    });
    expect(mocks.events.captured).toEqual([
      "paper_design",
      "mark_scheme_batch_1",
      "mark_scheme_batch_2",
      "paper_audit_input",
      "paper_audit",
    ]);
    const design = { stream: false, taskClass: "important", stallTimeoutMs: 45_000 };
    expect(mocks.events.calls.map(limits)).toEqual([
      { ...design, role: "supervisor", temperature: 0.25, maxOutputTokens: 16_000, timeoutMs: 60_000 },
      { ...design, role: "worker", reasoningEffort: "low", temperature: 0.1, maxOutputTokens: 8_000, timeoutMs: 45_000 },
      { ...design, role: "worker", reasoningEffort: "low", temperature: 0.1, maxOutputTokens: 8_000, timeoutMs: 45_000 },
      { ...design, role: "worker", reasoningEffort: "low", temperature: 0, maxOutputTokens: 4_000, timeoutMs: 60_000 },
    ]);

    // The designer sees the fenced sources, the research brief, then the request.
    expect(callsOf("design")[0]?.parts).toEqual([
      "BEGIN S1",
      expect.stringContaining("Scope\nSpecification extract"),
      "END S1",
      expect.stringMatching(/^--- GROUNDED WEB RESEARCH ---\nBoard: AQA\n/),
      expect.stringMatching(/^--- PAPER GENERATION REQUEST ---\nCreate one original/),
    ]);
    // Each batch gets the same evidence and only its own fixed questions.
    const [first, second] = callsOf("scheme_batch");
    expect(first?.parts.slice(0, 4)).toEqual(callsOf("design")[0]?.parts.slice(0, 4));
    expect(first?.parts.at(-1)).toContain('--- FIXED QUESTIONS ---\n[{"id":"q1","marks":4},{"id":"q2","marks":3}]');
    expect(second?.parts.at(-1)).toContain('--- FIXED QUESTIONS ---\n[{"id":"q3","marks":5}]');
    expect(callsOf("audit")[0]?.parts).toEqual([expect.stringMatching(/^\{"status":"ready"/)]);

    // A provisional scheme holds each question's marks until the real one is written.
    const designed = JSON.parse(mocks.events.parsed[0] ?? "{}") as {
      markScheme: { items: { questionId: string; maxMarks: number; points: { marks: number }[] }[] };
    };
    expect(designed.markScheme.items.map((item) => [item.questionId, item.maxMarks, item.points[0]?.marks])).toEqual([
      ["q1", 4, 4],
      ["q2", 3, 3],
      ["q3", 5, 5],
    ]);

    expect(mocks.events.written).toEqual(["paper_design", "mark_scheme_batch", "mark_scheme_batch"]);
    expect(mocks.events.budgetChecks).toBe(1);
    expect(mocks.events.refunds).toBe(0);
    expect(sunk).toHaveLength(1);
    expect((sunk[0] as { modelName: string }[]).map((item) => item.modelName)).toEqual([
      "model-design",
      "model-scheme_batch",
      "model-scheme_batch",
      "model-audit",
    ]);
    expect(logged("request.completed")[0]?.fields).toMatchObject({ sourceCount: 1, status: "ready" });
  });

  it("moves a durable job through its stages and streams every pass", async () => {
    const { status } = await generate({ auth: { uid: "user-1", internalJobId: "job-1" } });

    expect(status).toBe(200);
    expect(mocks.events.stages).toEqual([
      "reading_sources",
      "researching",
      "designing",
      "building_mark_scheme",
      "auditing",
      "creating_figures",
      "final_checks",
    ]);
    expect(mocks.events.calls.every((call) => call.stream)).toBe(true);
    expect(callsOf("design")[0]?.timeoutMs).toBe(150_000);
    expect(callsOf("scheme_batch")[0]?.timeoutMs).toBe(45_000);
    expect(mocks.events.budgetChecks).toBe(0);
  });

  it("stops a cancelled job before any model call", async () => {
    mocks.state.docs.set("users/user-1/practicePaperJobs/job-1", { cancellationRequested: true });
    expect(await generate({ auth: { uid: "user-1", internalJobId: "job-1" } })).toMatchObject({
      status: 409,
      body: { error: "Practice paper creation was cancelled.", code: "cancelled" },
    });
    expect(mocks.events.calls).toEqual([]);
    expect(mocks.events.stages).toEqual([]);
  });

  it("reuses a paper design an earlier attempt already paid for", async () => {
    mocks.state.checkpoints.set("paper_design", { text: mocks.paperText([4, 3, 5]), modelName: "earlier-model" });
    expect((await generate()).status).toBe(200);
    expect(callsOf("design")).toEqual([]);
    expect(mocks.events.captured[0]).toBe("mark_scheme_batch_1");
    expect(logged("generation.checkpoint_hit")).toHaveLength(1);
  });

  it("loads a signed-in student's folder sources and study context", async () => {
    const response = await runPracticePaperGenerationRequest(
      postRequest({ folderId: "folder-1" }, { Authorization: "Bearer valid-token" })
    );
    expect(response.status).toBe(200);
    const parts = callsOf("design")[0]?.parts ?? [];
    expect(parts).toHaveLength(4);
    expect(parts.at(-1)).toContain("Folder: Maths\nFolder subject: Mathematics\n");
    expect(mocks.events.budgetChecks).toBe(1);
  });

  it("refuses a missing folder or a chosen source that has left it", async () => {
    mocks.state.docs.delete("users/user-1/studyFolders/folder-1");
    expect(await generate({ context: null })).toMatchObject({
      status: 404,
      body: { error: "Folder not found", code: "folder_not_found" },
    });

    mocks.state.docs.set("users/user-1/studyFolders/folder-1", { name: "Maths" });
    expect(await generate({ context: null, body: { folderId: "folder-1", sourceIds: ["source-9"] } })).toMatchObject({
      status: 400,
      body: { error: "One or more selected sources are no longer in this folder.", code: "context_load_failed" },
    });
    expect(mocks.events.calls).toEqual([]);
  });

  it("refunds and stops when a source the student chose cannot be read", async () => {
    mocks.state.chunks = [];
    mocks.state.docs.set("users/user-1/sources/source-2", { ...PAST_PAPER });
    mocks.state.replies.vision = ["UNREADABLE"];

    expect(await generate({ context: null, body: { folderId: "folder-1", sourceIds: ["source-2"] } })).toMatchObject({
      status: 400,
      body: {
        error: "Jami could not read Past paper. Remove or replace that source and try again.",
        code: "selected_source_unreadable",
      },
    });
    expect(limits(callsOf("vision")[0])).toMatchObject({ role: "documentVision", taskClass: "visual", timeoutMs: 60_000 });
    expect(mocks.events.refunds).toBe(1);
  });

  it("skips an automatically chosen source it cannot read and carries on", async () => {
    mocks.state.chunks = [];
    mocks.state.docs.set("users/user-1/sources/source-2", { ...PAST_PAPER });
    mocks.state.replies.vision = ["UNREADABLE"];

    expect((await generate({ context: null })).status).toBe(200);
    expect(logged("context.automatic_sources_skipped")[0]?.fields).toEqual({ sourceIds: ["source-2"] });
    expect(callsOf("design")[0]?.parts.slice(0, 3)).toEqual(["BEGIN S1", "Prepared source text", "END S1"]);
  });

  it("refuses more material than the model can take in at once", async () => {
    mocks.state.inputTokenCap = 10;
    mocks.state.chunks = [{ sourceId: "source-1", text: "x".repeat(1_100_000) }];
    expect(await generate()).toMatchObject({ status: 413, body: { code: "input_too_large" } });
    expect(mocks.events.calls).toEqual([]);
    expect(mocks.events.refunds).toBe(1);
  });

  it("asks the student one question when the sources leave the paper ambiguous", async () => {
    mocks.state.replies.design = [JSON.stringify({ status: "needs_clarification" })];
    expect(await generate()).toMatchObject({
      status: 200,
      body: { status: "needs_clarification", title: null, sourceRefs: ["S1"] },
    });
    expect(mocks.events.captured).toEqual(["paper_design"]);
    expect(mocks.events.refunds).toBe(0);
  });

  it("retries an unreadable design once, then refunds and fails", async () => {
    mocks.state.replies.design = ["not a paper", "still not a paper"];
    expect(await generate()).toMatchObject({ status: 502, body: { code: "invalid_provider_response" } });
    expect(mocks.events.captured).toEqual(["paper_design", "paper_design_structured_retry"]);
    expect(limits(callsOf("design")[1])).toMatchObject({ reasoningEffort: "low", temperature: 0.1 });
    expect(callsOf("design")[1]?.system).toContain("The previous response was structurally invalid.");
    expect(mocks.events.written).toEqual(["paper_design"]);
    expect(mocks.events.refunds).toBe(1);
  });

  it("tells the designer its own arithmetic when the total is wrong, and keeps a corrected paper", async () => {
    mocks.state.replies.design = [mocks.paperText([4, 3, 4]), mocks.paperText([4, 4, 4])];
    expect((await generate({ expectedTotalMarks: 12 })).status).toBe(200);
    expect(mocks.events.captured.slice(0, 2)).toEqual(["paper_design", "paper_design_total_retry"]);
    expect(callsOf("design")[1]?.system).toContain(
      "Your previous paper was worth 11 marks across 3 questions (4 + 3 + 4), and this component is worth exactly 12."
    );
    expect(mocks.events.written.slice(0, 2)).toEqual(["paper_design", "paper_design_total_retry"]);
    expect(logged("paper_design.total_corrected")[0]?.fields).toEqual({ from: 11, to: 12, sectionsCorrected: 0 });
  });

  /**
   * A WJEC Chemistry draft built Section B at 52 marks against 70 and failed
   * with no second chance, because only a wrong total bought a retry.
   */
  it("gives a paper right overall but wrong in a section one repair, section by section", async () => {
    mocks.state.sectionWrongQueue = [[{ section: "B", actual: 5, expected: 6 }], [], []];
    mocks.state.replies.design = [mocks.paperText([4, 4, 4]), mocks.paperText([4, 4, 4])];
    expect((await generate({ expectedTotalMarks: 12, expectedSections: [{ id: "A", marks: 6 }, { id: "B", marks: 6 }] })).status).toBe(200);
    expect(mocks.events.captured.slice(0, 2)).toEqual(["paper_design", "paper_design_total_retry"]);
    expect(callsOf("design")[1]?.system).toContain("Section B came to 5 marks and must be 6 (1 short).");
    expect(callsOf("design")[1]?.system).toContain("Repair it rather than starting again");
    expect(logged("paper_design.total_corrected")[0]?.fields).toEqual({ from: 12, to: 12, sectionsCorrected: 1 });
  });

  it("refuses a paper still worth the wrong total and forgets both designs", async () => {
    mocks.state.replies.design = [mocks.paperText([4, 3, 4]), mocks.paperText([4, 3, 4])];
    expect(await generate({ expectedTotalMarks: 12 })).toMatchObject({
      status: 422,
      body: {
        error: "Jami built a paper worth 11 marks where this component is worth 12. Try again, or check the exam format profile.",
        code: "paper_total_mismatch",
      },
    });
    expect(mocks.events.forgotten).toEqual(["paper_design", "paper_design_total_retry"]);
    expect(callsOf("scheme_batch")).toEqual([]);
    expect(mocks.events.refunds).toBe(1);
  });

  it("refuses sections that do not match the component", async () => {
    mocks.state.sectionWrong = [
      { section: "A", actual: 7, expected: 6 },
      { section: "B", actual: 5, expected: 6 },
    ];
    expect(
      await generate({ expectedSections: [{ id: "A", marks: 6 }, { id: "B", marks: 6 }] })
    ).toMatchObject({
      status: 422,
      body: {
        error: "Jami built sections that do not match this component: A is 7 marks, not 6; B is 5 marks, not 6.",
        code: "paper_section_mismatch",
      },
    });
    expect(logged("paper_design.section_mismatch")[0]?.fields).toEqual({
      sections: mocks.state.sectionWrong,
      built: ["A"],
    });
    expect(mocks.events.forgotten).toEqual(["paper_design", "paper_design_total_retry"]);
    expect(mocks.events.refunds).toBe(1);
  });

  it("refuses a figure sent to the wrong generator before paying for it", async () => {
    mocks.state.routingIssues = [{ code: "measured_figure_as_image", detail: "Question 2 needs an exact diagram." }];
    expect(await generate()).toMatchObject({
      status: 422,
      body: { error: "Jami asked for the wrong kind of figure: Question 2 needs an exact diagram.", code: "asset_routing" },
    });
    expect(mocks.events.forgotten).toEqual(["paper_design", "paper_design_total_retry"]);
    expect(callsOf("scheme_batch")).toEqual([]);
    expect(mocks.events.refunds).toBe(1);
  });

  it("refuses a short practice set in place of a complete paper", async () => {
    mocks.state.incomplete = true;
    expect(await generate()).toMatchObject({
      status: 422,
      body: {
        error: "Jami produced a short practice set instead of a complete paper. Add a past paper or assessment brief and try again.",
        code: "incomplete_paper",
      },
    });
    expect(mocks.events.refunds).toBe(1);
  });

  it("retries an unreadable mark-scheme batch once on its own", async () => {
    mocks.state.unreadableBatches = 1;
    expect((await generate()).status).toBe(200);
    expect(mocks.events.captured).toEqual([
      "paper_design",
      "mark_scheme_batch_1",
      "mark_scheme_batch_2",
      "mark_scheme_batch_1_structured_retry",
      "paper_audit_input",
      "paper_audit",
    ]);
    expect(limits(callsOf("scheme_retry")[0])).toMatchObject({ role: "worker", reasoningEffort: "low", temperature: 0 });
    expect(callsOf("scheme_retry")[0]?.parts).toEqual(['[{"id":"q1","marks":4},{"id":"q2","marks":3}]']);
    expect(logged("mark_scheme.batch_unreadable").map((entry) => entry.fields)).toEqual([
      {
        batchNumber: 1,
        attempt: "initial",
        expectedItemCount: 2,
        returnedItemCount: 1,
        exactQuestionIdMatches: 1,
        stringMarkingFields: 0,
        acceptedMarkingFields: 0,
        // Keys and value kinds only, never the scheme's content.
        itemShapes: ["questionId:string"],
      },
    ]);
  });

  it("fails the paper, with a refund, when a batch is still unreadable after its retry", async () => {
    mocks.state.unreadableBatches = 2;
    expect(await generate()).toMatchObject({
      status: 502,
      body: { error: "Jami could not finish that paper just now. Try again in a moment.", code: "provider_failure" },
    });
    expect(logged("mark_scheme.batch_unreadable").map((entry) => entry.fields?.attempt)).toEqual([
      "initial",
      "structured_retry",
    ]);
    expect(logged("request.failed")).toHaveLength(1);
    expect(mocks.events.refunds).toBe(1);
  });

  it("repairs only the questions with structural faults", async () => {
    mocks.state.schemeIssues = [[FAULT], []];
    expect((await generate()).status).toBe(200);
    expect(mocks.events.captured).toContain("mark_scheme_targeted_repair_1_1");
    const repair = callsOf("scheme_repair")[0]?.parts.at(-1) ?? "";
    expect(repair).toContain('--- AFFECTED QUESTIONS ---\n[{"id":"q2","marks":3}]');
    expect(repair).toContain('--- PREVIOUS ITEMS ---\n[{"questionId":"q2"}]');
    expect(repair).toContain("--- FAULTS TO CORRECT ---\nq2: points_do_not_sum");
    expect(logged("mark_scheme.validation_failed")[0]?.fields).toEqual({
      repairRound: 1,
      readable: true,
      fixedPaperPreserved: true,
      issueCount: 1,
      issueCodes: ["points_do_not_sum"],
    });
  });

  it("fails when structural faults survive two repair rounds", async () => {
    mocks.state.schemeIssues = [[FAULT], [FAULT], [FAULT]];
    expect(await generate()).toMatchObject({
      status: 502,
      body: {
        error: "Jami could not lock a dependable mark scheme to that paper. Try again with a clearer assessment brief or mark scheme.",
        code: "invalid_mark_scheme_response",
      },
    });
    expect(callsOf("scheme_repair")).toHaveLength(2);
    expect(mocks.events.captured).toContain("mark_scheme_targeted_repair_2_1");
    expect(callsOf("audit")).toEqual([]);
    expect(mocks.events.refunds).toBe(1);
  });

  it("lets a scheme whose only remaining flags are off-topic guesses through to the audit", async () => {
    mocks.state.schemeIssues = [[OFF_TOPIC], [OFF_TOPIC], [OFF_TOPIC]];
    expect((await generate()).status).toBe(200);
    expect(logged("mark_scheme.topic_flags_deferred_to_audit")[0]?.fields).toEqual({
      issueCount: 1,
      questionIds: ["q1"],
    });
    expect(callsOf("audit")).toHaveLength(1);
  });

  it("refuses a paper whose audit cannot be read", async () => {
    mocks.state.replies.audit = ["no verdict here"];
    expect(await generate()).toMatchObject({
      status: 502,
      body: { error: "Jami could not complete the paper quality check. Try again in a moment.", code: "invalid_audit_response" },
    });
    expect(mocks.events.refunds).toBe(1);
  });

  it("repairs a paper the audit rejects, re-audits it and lets the juror weigh what remains", async () => {
    mocks.state.replies.audit = [failingAudit("ambiguous_prompt", "Question 1 has two readings.", "q1")];
    mocks.state.replies.reaudit = [failingAudit("still_ambiguous", "Question 1 still reads two ways.")];

    const { status, body } = await generate();

    expect(status).toBe(200);
    expect(body).toEqual({
      status: "ready",
      title: "Repaired",
      sourceRefs: ["S1"],
      generationAudit: { issueCount: 1, repaired: true },
    });
    expect(mocks.events.captured.slice(-4)).toEqual(["paper_audit", "paper_repair", "paper_reaudit", "paper_quality_juror"]);
    expect(limits(callsOf("repair")[0])).toMatchObject({ role: "supervisor", temperature: 0.1, maxOutputTokens: 16_000 });
    expect(limits(callsOf("reaudit")[0])).toMatchObject({ role: "worker", reasoningEffort: "low", temperature: 0, maxOutputTokens: 4_000 });
    expect(limits(callsOf("juror")[0])).toMatchObject({ role: "juror", temperature: 0, maxOutputTokens: 4_000 });
    expect(callsOf("repair")[0]?.parts.at(-1)).toContain('--- SUBSTANTIATED AUDIT ISSUES ---\n[{"code":"ambiguous_prompt"');
    expect(logged("paper_audit.issues_found")[0]?.fields).toEqual({
      issueCount: 1,
      issueCodes: ["ambiguous_prompt"],
      affectedQuestionCount: 1,
    });
  });

  it("falls back to a structured repair retry, and refuses when the juror upholds the findings", async () => {
    mocks.state.replies.audit = [failingAudit("ambiguous_prompt", "Question 1 has two readings.", "q1")];
    mocks.state.replies.repair = ["{}"];
    mocks.state.replies.reaudit = [failingAudit("still_ambiguous", "Question 1 still reads two ways.")];
    mocks.state.replies.juror = [failingAudit("still_ambiguous", "Question 1 still reads two ways.")];

    expect(await generate()).toMatchObject({
      status: 422,
      body: { error: "Jami found unresolved quality issues and did not release the paper.", code: "unresolved_quality_issues" },
    });
    expect(mocks.events.captured).toContain("paper_repair_structured_retry");
    expect(limits(callsOf("repair_retry")[0])).toMatchObject({ role: "worker", temperature: 0, maxOutputTokens: 16_000 });
    expect(callsOf("repair_retry")[0]?.parts.at(-1)).toContain("--- MALFORMED PATCH TO CORRECT ---\n{}");
    expect(logged("paper_repair.patch_unreadable")[0]?.fields).toEqual({ initialResponseBytes: 2 });
    expect(mocks.events.refunds).toBe(1);
  });

  it("refuses a paper it could not repair safely", async () => {
    mocks.state.replies.audit = [failingAudit("ambiguous_prompt", "Question 1 has two readings.", "q1")];
    mocks.state.replies.repair = ["{}"];
    mocks.state.replies.repair_retry = ["{}"];
    expect(await generate()).toMatchObject({ status: 502, body: { code: "invalid_repair_response" } });
    expect(callsOf("reaudit")).toEqual([]);
    expect(mocks.events.refunds).toBe(1);
  });

  it("turns a provider failure into a clean error with a refund", async () => {
    mocks.state.replies.design = [new Error("gateway timeout")];
    expect(await generate()).toMatchObject({ status: 502, body: { code: "provider_failure" } });
    expect(logged("request.failed")).toHaveLength(1);
    expect(mocks.events.refunds).toBe(1);
  });

  it("runs a workflow job as a durable request that loads its own folder", async () => {
    const response = await runPracticePaperGenerationForWorkflow({
      uid: "user-1",
      jobId: "job-1",
      request: PAPER_REQUEST,
      researchBrief: "Board: AQA",
      formatContext: "Paper 1: 80 marks",
    });
    expect(response.status).toBe(200);
    expect(mocks.events.stages[0]).toBe("reading_sources");
    expect(mocks.events.calls.every((call) => call.stream)).toBe(true);
    expect(mocks.events.budgetChecks).toBe(0);
    expect(callsOf("design")[0]?.parts.at(-1)).toContain("\nAUTHORITATIVE EXAM FORMAT\nPaper 1: 80 marks\n");
    expect(callsOf("audit")[0]?.parts[0]).toMatch(/^--- REQUIRED FORMAT ---\nPaper 1: 80 marks\n\n\{/);
  });

  it("runs a benchmark on supplied material without a budget, holding it to the expected total", async () => {
    const run = (expectedTotalMarks: number) =>
      runPracticePaperGenerationForBenchmark({
        reviewerUid: "user-1",
        request: PAPER_REQUEST,
        sources: CONTEXT.sources,
        studyContext: CONTEXT.studyContext,
        expectedTotalMarks,
      });

    const { response, diagnostics } = await run(12);
    expect(response.status).toBe(200);
    expect(diagnostics).toHaveLength(4);
    expect(mocks.events.calls.every((call) => call.stream)).toBe(true);
    expect(mocks.events.budgetChecks).toBe(0);
    expect(mocks.events.stages).toEqual([]);

    expect((await run(11)).response.status).toBe(422);
  });
});
