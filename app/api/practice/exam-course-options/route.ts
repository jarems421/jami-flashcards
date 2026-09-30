import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { featureFlags } from "@/lib/app/feature-flags";
import { EXAM_QUALIFICATION_LABELS, isExamQualification } from "@/lib/practice/exam-formats";
import { examCourseTiers } from "@/lib/practice/exam-course-tiers";
import { getAdminDb } from "@/services/firebase/admin";

export const runtime = "nodejs";

type Draft = {
  specificationId: string;
  specificationTitle: string;
  qualification: string;
  qualificationLabel: string;
  components: Array<{ code: string; title: string; tier?: string }>;
  namedTiers: Set<string>;
};

/**
 * Each paper the course sets, once.
 *
 * The catalogue holds a row per time a component was researched, so Edexcel
 * maths listed "1MA1/1H" twice -- as "Paper 1 Higher" and as "Paper 1
 * (Non-Calculator) - Higher Tier". A paper is its code; of its names, the
 * fuller one is kept, since it says whether a calculator is allowed.
 */
function coursePapers(components: Draft["components"]) {
  const papers = new Map<string, { code: string; title: string; tier?: string }>();
  for (const component of components) {
    const title = (component.title || component.code).trim();
    const key = component.code.trim().toUpperCase();
    const existing = papers.get(key);
    if (!existing || title.length > existing.title.length) {
      papers.set(key, { code: component.code, title, ...(component.tier ? { tier: component.tier } : {}) });
    }
  }
  return [...papers.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
}

/**
 * Every course a board runs, as one list.
 *
 * Qualification used to be a separate question asked before this one, which
 * meant a student had to know that "GCSE" is a qualification and "8300" is a
 * specification before they could say they do GCSE maths. It is a property of
 * a course, so it is returned with the course and shown in its name.
 */
export async function GET(request: NextRequest) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const board = request.nextUrl.searchParams.get("board")?.trim() ?? "";
  const qualification = request.nextUrl.searchParams.get("qualification")?.trim() ?? "";
  const subject = request.nextUrl.searchParams.get("subject")?.trim().toLowerCase() ?? "";
  if (!board) return Response.json({ courses: [] });

  const snapshot = await getAdminDb().collection("examFormatCatalogue")
    .where("board", "==", board).limit(300).get();
  const grouped = new Map<string, Draft>();
  for (const document of snapshot.docs) {
    const data = document.data();
    if (data.status !== "current") continue;
    if (qualification && data.qualification !== qualification) continue;
    if (!isExamQualification(data.qualification)) continue;
    if (
      subject &&
      typeof data.subject === "string" &&
      !data.subject.toLowerCase().includes(subject) &&
      !subject.includes(data.subject.toLowerCase())
    ) continue;
    const specificationId = typeof data.specificationCode === "string" ? data.specificationCode.trim() : "";
    if (!specificationId) continue;
    const existing: Draft = grouped.get(specificationId) ?? {
      specificationId,
      specificationTitle:
        typeof data.specificationTitle === "string" ? data.specificationTitle : data.subject ?? specificationId,
      qualification: data.qualification,
      qualificationLabel: EXAM_QUALIFICATION_LABELS[data.qualification],
      components: [],
      namedTiers: new Set<string>(),
    };
    if (typeof data.tier === "string" && data.tier.trim()) existing.namedTiers.add(data.tier.trim());
    const code = typeof data.componentCode === "string" ? data.componentCode.trim() : "";
    if (code) {
      const tier = typeof data.tier === "string" ? data.tier.trim() : "";
      existing.components.push({
        code,
        title: typeof data.componentTitle === "string" ? data.componentTitle : "",
        ...(tier ? { tier } : {}),
      });
    }
    grouped.set(specificationId, existing);
  }

  const courses = [...grouped.values()]
    .map((course) => ({
      specificationId: course.specificationId,
      specificationTitle: course.specificationTitle,
      qualification: course.qualification,
      qualificationLabel: course.qualificationLabel,
      componentIds: [...new Set(course.components.map((component) => component.code))].sort(),
      tiers: examCourseTiers(course.components, [...course.namedTiers]),
      // Each paper the course sets, so a paper can be chosen by name.
      papers: coursePapers(course.components),
    }))
    .sort((a, b) => a.specificationTitle.localeCompare(b.specificationTitle));
  return Response.json({ courses });
}
