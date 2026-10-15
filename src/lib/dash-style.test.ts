import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// House style: dashes never have spaces around them ("busy or free—never
// what", "7:00–8:30 PM"), anywhere in Coucal: the website, the server's
// text and the iPhone app. This catches an em dash, en dash or double
// hyphen with a space on each side.

const ROOT = join(__dirname, "..", "..");
const FOLDERS = ["src", "ios/GroupCal", "ios/GroupCalMessages", "ios/Shared", "docs"];
const EXTENSIONS = [".ts", ".tsx", ".swift", ".md"];
const SPACED_DASH = / (—|–|--) /;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "generated" || name === "node_modules" || name === "build") return [];
    if (statSync(path).isDirectory()) return files(path);
    return EXTENSIONS.some((ext) => name.endsWith(ext)) ? [path] : [];
  });
}

describe("dash style", () => {
  it("never puts spaces around dashes", () => {
    const offenders = FOLDERS.flatMap((folder) => files(join(ROOT, folder))).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .map((line, i) => ({ line, where: `${relative(ROOT, path)}:${i + 1}` }))
        .filter(({ line }) => SPACED_DASH.test(line))
        .map(({ line, where }) => `${where}  ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
