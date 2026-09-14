import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/*
 * White text on a solid accent is unreadable wherever the accent is light: the
 * Grey and Black themes, the star sky, and a photo background over a dark
 * photo. `text-accent-on` follows each palette's own choice for that pairing.
 */
describe("text on a solid accent", () => {
  it("is never hard-coded white", () => {
    const solidAccent = /(?:^|[\s"'`])(?:bg-accent|bg-\[var\(--color-accent\)\])(?=[\s"'`]|$)/;
    const offenders = [...sourceFiles(join(root, "components")), ...sourceFiles(join(root, "app"))].flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          solidAccent.test(line) && /(?:^|[\s"'`])text-white(?=[\s"'`]|$)/.test(line)
            ? [`${relative(root, file)}:${index + 1}`]
            : []
        )
    );
    expect(offenders).toEqual([]);
  });
});
