import type { ExamFormatProfile } from "@/lib/practice/exam-formats";
import type {
  PaperGenerationBenchmarkCase,
  PaperGenerationBenchmarkRun,
} from "@/lib/practice/paper-generation-benchmark";
import { auth } from "@/services/firebase/client";

async function request(path: string, init?: RequestInit) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to open paper quality tools.");
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(!(init?.body instanceof FormData) && init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Paper quality tools are unavailable.");
  return data ?? {};
}

export type PaperBenchmarkReadiness = {
  enabled: boolean;
  definitionVersion: string;
  expectedCases: number;
  caseCostEstimateUsd: number | null;
  projectedCostUsd: number | null;
  missingProfiles: string[];
  ready: boolean;
};

export async function getPaperQualityOverview() {
  const [profiles, runs] = await Promise.all([
    request("/api/internal/exam-formats"),
    request("/api/internal/paper-quality/runs"),
  ]);
  return {
    profiles: (Array.isArray(profiles.profiles) ? profiles.profiles : []) as ExamFormatProfile[],
    readiness: runs.readiness as PaperBenchmarkReadiness,
    runs: (Array.isArray(runs.runs) ? runs.runs : []) as PaperGenerationBenchmarkRun[],
  };
}

export async function refreshExamFormatProfile(profileId: string) {
  return request("/api/internal/exam-formats/refresh", {
    method: "POST",
    body: JSON.stringify({ profileId }),
  });
}

export async function importExamFormatUrl(url: string, title?: string) {
  return request("/api/internal/exam-formats/imports", {
    method: "POST",
    body: JSON.stringify({ url, title }),
  });
}

export async function importExamFormatFile(file: File) {
  const form = new FormData();
  form.set("file", file);
  return request("/api/internal/exam-formats/imports", { method: "POST", body: form });
}

export async function startPaperBenchmark(spendCeilingUsd: number) {
  return request("/api/internal/paper-quality/runs", {
    method: "POST",
    body: JSON.stringify({ spendCeilingUsd }),
  });
}

export async function getPaperBenchmarkRun(runId: string) {
  const data = await request(`/api/internal/paper-quality/runs/${encodeURIComponent(runId)}`);
  return {
    run: data.run as PaperGenerationBenchmarkRun,
    cases: (Array.isArray(data.cases) ? data.cases : []) as PaperGenerationBenchmarkCase[],
  };
}

export async function getPaperBenchmarkArtifact(runId: string, caseId: string) {
  const data = await request(`/api/internal/paper-quality/runs/${encodeURIComponent(runId)}/cases/${encodeURIComponent(caseId)}`);
  return data.artifact as Record<string, unknown>;
}

export async function getPaperBenchmarkAsset(previewUrl: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to open paper quality tools.");
  const token = await user.getIdToken();
  const response = await fetch(previewUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("That benchmark image is unavailable.");
  return response.blob();
}

export async function savePaperBenchmarkReview(
  runId: string,
  caseId: string,
  review: Record<string, unknown>
) {
  return request(`/api/internal/paper-quality/runs/${encodeURIComponent(runId)}/cases/${encodeURIComponent(caseId)}`, {
    method: "POST",
    body: JSON.stringify(review),
  });
}

export async function updatePaperBenchmarkRun(
  runId: string,
  action: "approve" | "resume",
  spendCeilingUsd?: number
) {
  const data = await request(`/api/internal/paper-quality/runs/${encodeURIComponent(runId)}`, {
    method: "PATCH",
    body: JSON.stringify({ action, spendCeilingUsd }),
  });
  return data;
}

export async function cancelPaperBenchmark(runId: string) {
  return request(`/api/internal/paper-quality/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
}
