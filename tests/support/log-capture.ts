import { expect, vi } from "vitest";

/**
 * Captures what the structured logger actually wrote while a route ran.
 *
 * The logger redacts by field name, which is a denylist: a field nobody
 * thought of is logged in full. That makes "does this route leak student
 * work" a property of the route, not of the logger, so each route that logs
 * needs its own check against real student text.
 */
export async function captureStructuredLogs<T>(run: () => Promise<T>) {
  const lines: string[] = [];
  const capture = (line: unknown) => {
    lines.push(String(line));
  };
  const spies = [
    vi.spyOn(console, "log").mockImplementation(capture),
    vi.spyOn(console, "warn").mockImplementation(capture),
    vi.spyOn(console, "error").mockImplementation(capture),
  ];

  let result: T;
  try {
    result = await run();
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }

  return {
    result,
    lines,
    // Parsing here doubles as the check that each record is one whole JSON
    // line, which is what a log search depends on.
    records: lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

/**
 * Asserts the run logged something recognisable and none of it was the
 * student's own words.
 *
 * The `events` expectation is what stops this passing vacuously: a route that
 * logged nothing at all would otherwise satisfy "no student work appears".
 */
export function expectRedactedLogs(input: {
  records: Record<string, unknown>[];
  lines: string[];
  route: string;
  events: string[];
  studentText: string[];
}) {
  expect(input.records.map((record) => record.event)).toEqual(
    expect.arrayContaining(input.events)
  );
  expect(
    input.records.every((record) => record.route === input.route)
  ).toBe(true);

  // One request is one story, however many failures it passed through.
  const requestIds = new Set(input.records.map((record) => record.requestId));
  expect(requestIds.size).toBe(1);
  expect([...requestIds][0]).toBeTruthy();

  const everything = input.lines.join("\n");
  for (const studentText of input.studentText) {
    expect(everything).not.toContain(studentText);
  }
}
