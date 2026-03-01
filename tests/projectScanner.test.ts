import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { classifyProjectFiles, scanProject } from "../src/utils/projectScanner.js";
import { DEFAULT_THRESHOLDS } from "../src/utils/enforcement.js";

const CLEAN_SPEC = `
import { test, expect } from '@playwright/test';
test('loads homepage', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="header"]')).toBeVisible();
});
`;

const VIOLATING_SPEC = `
import { test } from '@playwright/test';
let shared = 0;
test('login', async ({ page }) => {
  await page.waitForTimeout(1000);
  await page.locator('.bad-class').click();
  await page.locator('#bad-id').click();
  await page.locator('div > span').click();
  shared++;
});
`;

const K6_SCRIPT = `
import http from 'k6/http';
import { sleep } from 'k6';
export default function() {
  http.get('https://test.example.com');
  sleep(1);
}
`;

const PLAYWRIGHT_NON_CONVENTIONAL = `
import { test, expect } from '@playwright/test';
test('non-conventional filename', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="header"]')).toBeVisible();
});
`;

const HELPER_FILE = `
export function formatDate(d) {
  return d.toISOString();
}
`;

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardrails-test-"));
  fs.mkdirSync(path.join(tmpDir, "e2e"));
  fs.mkdirSync(path.join(tmpDir, "perf"));
  fs.mkdirSync(path.join(tmpDir, "utils"));
  fs.mkdirSync(path.join(tmpDir, "node_modules", "some-lib"), { recursive: true });

  // Conventional spec files
  fs.writeFileSync(path.join(tmpDir, "e2e", "clean.spec.ts"), CLEAN_SPEC);
  fs.writeFileSync(path.join(tmpDir, "e2e", "violations.spec.ts"), VIOLATING_SPEC);

  // Non-conventional: Playwright with imports but no .spec. in name
  fs.writeFileSync(path.join(tmpDir, "e2e", "homePage.ts"), PLAYWRIGHT_NON_CONVENTIONAL);

  // k6 performance script (no conventional test suffix)
  fs.writeFileSync(path.join(tmpDir, "perf", "loadTest.js"), K6_SCRIPT);
  fs.writeFileSync(path.join(tmpDir, "perf", "soakTest.js"), K6_SCRIPT);

  // Helper file — no test framework imports, should be skipped
  fs.writeFileSync(path.join(tmpDir, "utils", "helpers.js"), HELPER_FILE);

  // node_modules should always be ignored
  fs.writeFileSync(path.join(tmpDir, "node_modules", "some-lib", "test.spec.ts"), CLEAN_SPEC);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("classifyProjectFiles", () => {
  it("includes conventional .spec.ts files in supported list", () => {
    const { supported } = classifyProjectFiles(tmpDir, tmpDir);
    expect(supported.some((f) => f.includes("clean.spec.ts"))).toBe(true);
  });

  it("includes non-conventional .ts files with Playwright imports in supported list", () => {
    const { supported } = classifyProjectFiles(tmpDir, tmpDir);
    expect(supported.some((f) => f.includes("homePage.ts"))).toBe(true);
  });

  it("classifies k6 .js files as unsupported", () => {
    const { unsupported } = classifyProjectFiles(tmpDir, tmpDir);
    expect(unsupported.some((f) => f.file.includes("loadTest.js"))).toBe(true);
    expect(unsupported.some((f) => f.file.includes("soakTest.js"))).toBe(true);
  });

  it("unsupported entries record the detected framework", () => {
    const { unsupported } = classifyProjectFiles(tmpDir, tmpDir);
    const k6 = unsupported.find((f) => f.file.includes("loadTest.js"));
    expect(k6?.detectedFramework).toBe("k6");
  });

  it("skips helper files with no test framework imports", () => {
    const { supported, unsupported } = classifyProjectFiles(tmpDir, tmpDir);
    const allFiles = [...supported, ...unsupported.map((u) => u.file)];
    expect(allFiles.every((f) => !f.includes("helpers.js"))).toBe(true);
  });

  it("ignores node_modules", () => {
    const { supported, unsupported } = classifyProjectFiles(tmpDir, tmpDir);
    const allFiles = [...supported, ...unsupported.map((u) => u.file)];
    expect(allFiles.every((f) => !f.includes("node_modules"))).toBe(true);
  });

  it("returns empty lists for a directory with no source files", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardrails-empty-"));
    const result = classifyProjectFiles(emptyDir, emptyDir);
    fs.rmdirSync(emptyDir);
    expect(result.supported).toHaveLength(0);
    expect(result.unsupported).toHaveLength(0);
  });
});

describe("scanProject", () => {
  it("returns correct file count (supported files only)", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    // clean.spec.ts + violations.spec.ts + homePage.ts = 3
    expect(result.totals.files).toBe(3);
  });

  it("includes scannedAt timestamp", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    expect(() => new Date(result.scannedAt)).not.toThrow();
  });

  it("reports correct pass/warn/reject counts", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    const actions = result.files.map((f) => f.policy.action);
    expect(actions).toContain("PASSED");
    expect(actions.some((a) => a === "WARNED" || a === "REJECTED")).toBe(true);
  });

  it("clean file has no violations", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    const clean = result.files.find((f) => f.file.includes("clean"));
    expect(clean).toBeDefined();
    expect(clean?.violations).toHaveLength(0);
  });

  it("violating file has violations", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    const bad = result.files.find((f) => f.file.includes("violations"));
    expect(bad).toBeDefined();
    expect(bad?.violations.length).toBeGreaterThan(0);
  });

  it("exposes unsupportedFiles with k6 entries", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    expect(result.unsupportedFiles.length).toBeGreaterThanOrEqual(2);
    expect(result.unsupportedFiles.every((f) => f.detectedFramework === "k6")).toBe(true);
  });

  it("unsupportedFiles paths are relative to project root", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    expect(result.unsupportedFiles.every((f) => !path.isAbsolute(f.file))).toBe(true);
  });

  it("topOffenders lists files with most violations first", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    const counts = result.topOffenders.map((f) => f.violations.length);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i - 1]!).toBeGreaterThanOrEqual(counts[i]!);
    }
  });

  it("advisory mode never produces REJECTED", () => {
    const result = scanProject(tmpDir, "playwright", "advisory", DEFAULT_THRESHOLDS);
    expect(result.files.every((f) => f.policy.action !== "REJECTED")).toBe(true);
  });

  it("block mode rejects file with any violation", () => {
    const result = scanProject(tmpDir, "playwright", "block", DEFAULT_THRESHOLDS);
    const bad = result.files.find((f) => f.file.includes("violations"));
    expect(bad?.policy.action).toBe("REJECTED");
  });

  it("scores are averaged across files", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    expect(result.scores.averageDeterminism).toBeGreaterThanOrEqual(0);
    expect(result.scores.averageDeterminism).toBeLessThanOrEqual(1);
    expect(result.scores.averageFlakeRisk).toBeGreaterThanOrEqual(0);
    expect(result.scores.averageArchitecture).toBeGreaterThanOrEqual(0);
    expect(result.scores.averageArchitecture).toBeLessThanOrEqual(1);
  });

  it("totals.totalViolations equals sum of per-file violations", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    const sum = result.files.reduce((s, f) => s + f.violations.length, 0);
    expect(result.totals.totalViolations).toBe(sum);
  });

  it("totals include severity breakdown", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    expect(result.totals).toHaveProperty("criticalViolations");
    expect(result.totals).toHaveProperty("majorViolations");
    expect(result.totals).toHaveProperty("minorViolations");
    const severitySum =
      result.totals.criticalViolations +
      result.totals.majorViolations +
      result.totals.minorViolations;
    expect(severitySum).toBe(result.totals.totalViolations);
  });

  it("framework is recorded in summary", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    expect(result.framework).toBe("playwright");
  });

  it("mode is recorded in summary", () => {
    const result = scanProject(tmpDir, "playwright", "advisory", DEFAULT_THRESHOLDS);
    expect(result.mode).toBe("advisory");
  });
});
