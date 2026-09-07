import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  assertWithinAllowedRoots,
  createIgnoreMatcher,
  globToRegExp,
  isWithinRoots,
} from "../src/utils/scanPolicy.js";
import { classifyProjectFiles, scanProject } from "../src/utils/projectScanner.js";
import { loadRuntimeConfig } from "../src/config/loadConfig.js";
import { DEFAULT_THRESHOLDS } from "../src/utils/enforcement.js";

describe("globToRegExp", () => {
  it.each([
    ["fixtures", "fixtures", true],
    ["fixtures", "e2e/fixtures", true],
    ["fixtures", "e2e/fixtures/a.spec.ts", true],
    ["fixtures", "e2e/fixturesx/a.spec.ts", false],
    ["*.generated.ts", "e2e/api.generated.ts", true],
    ["*.generated.ts", "e2e/api.ts", false],
    ["legacy/e2e", "legacy/e2e/a.spec.ts", true],
    ["legacy/e2e", "src/legacy/e2e/a.spec.ts", false],
    ["tmp/**", "tmp/deep/a.spec.ts", true],
    ["tmp/**", "tmp", false],
    ["**/snapshots/*.ts", "a/b/snapshots/x.ts", true],
    ["**/snapshots/*.ts", "snapshots/x.ts", true],
    ["**/snapshots/*.ts", "snapshots/deeper/x.ts", false],
    ["./build/", "build/x.ts", true],
    ["a?c", "abc", true],
    ["a?c", "abbc", false],
    ["file.spec.ts", "file-spec.ts", false],
  ])("%s against %s is %s", (pattern, target, expected) => {
    expect(globToRegExp(pattern).test(target)).toBe(expected);
  });
});

describe("createIgnoreMatcher", () => {
  it("returns false for everything when there are no patterns", () => {
    expect(createIgnoreMatcher([])("anything")).toBe(false);
  });

  it("normalises platform separators", () => {
    const matcher = createIgnoreMatcher(["legacy/**"]);
    expect(matcher(["legacy", "a.ts"].join(path.sep))).toBe(true);
  });
});

describe("allowed roots", () => {
  const root = path.resolve("/tmp/guardrails-root");

  it("isWithinRoots accepts the root itself and descendants only", () => {
    expect(isWithinRoots(root, [root])).toBe(true);
    expect(isWithinRoots(path.join(root, "a", "b"), [root])).toBe(true);
    expect(isWithinRoots(path.resolve("/tmp/guardrails-root-other"), [root])).toBe(false);
    expect(isWithinRoots(path.join(root, "..", "elsewhere"), [root])).toBe(false);
  });

  it("assertWithinAllowedRoots allows everything when unrestricted", () => {
    expect(assertWithinAllowedRoots("/anywhere", [], "projectPath")).toBe(
      path.resolve("/anywhere"),
    );
  });

  it("assertWithinAllowedRoots throws a descriptive error", () => {
    expect(() => assertWithinAllowedRoots("/etc", [root], "projectPath")).toThrow(
      /projectPath "\/etc" is outside the allowed roots/,
    );
  });
});

describe("scanner ignore globs", () => {
  let tmpDir: string;
  const SPEC = `import { test } from '@playwright/test';\ntest('a', async () => {});\n`;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardrails-ignore-"));
    for (const rel of [
      "e2e/a.spec.ts",
      "e2e/fixtures/f.spec.ts",
      "legacy/old.spec.ts",
      "e2e/gen.generated.spec.ts",
    ]) {
      fs.mkdirSync(path.dirname(path.join(tmpDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, rel), SPEC);
    }
    fs.writeFileSync(
      path.join(tmpDir, "ai-test-guardrails.config.json"),
      JSON.stringify({ scan: { allowedRoots: ["."], ignore: ["legacy"] } }),
    );
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scans everything by default", () => {
    expect(classifyProjectFiles(tmpDir, tmpDir).supported).toHaveLength(4);
  });

  it("prunes ignored directories and files", () => {
    const { supported } = classifyProjectFiles(tmpDir, tmpDir, [
      "fixtures",
      "legacy/**",
      "*.generated.spec.ts",
    ]);
    expect(supported.map((f) => path.relative(tmpDir, f))).toEqual([path.join("e2e", "a.spec.ts")]);
  });

  it("scanProject honours the ignore option", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS, {
      ignore: ["legacy"],
    });
    expect(result.totals.files).toBe(3);
    expect(result.files.every((f) => !f.file.startsWith("legacy"))).toBe(true);
  });

  it("config file scan policy is resolved relative to the config", async () => {
    const runtime = await loadRuntimeConfig({ argv: [], env: {}, cwd: tmpDir });
    expect(runtime.scan.allowedRoots).toEqual([tmpDir]);
    expect(runtime.scan.ignore).toEqual(["legacy"]);
  });

  it("defaults to unrestricted roots and no ignores", async () => {
    const runtime = await loadRuntimeConfig({ argv: [], env: {}, cwd: os.tmpdir() });
    expect(runtime.scan).toEqual({ allowedRoots: [], ignore: [] });
  });
});
