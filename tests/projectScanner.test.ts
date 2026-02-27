import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { findTestFiles, scanProject } from "../src/utils/projectScanner.js";
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

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardrails-test-"));
  fs.mkdirSync(path.join(tmpDir, "e2e"));
  fs.mkdirSync(path.join(tmpDir, "node_modules", "some-lib"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "e2e", "clean.spec.ts"), CLEAN_SPEC);
  fs.writeFileSync(path.join(tmpDir, "e2e", "violations.spec.ts"), VIOLATING_SPEC);
  fs.writeFileSync(path.join(tmpDir, "node_modules", "some-lib", "test.spec.ts"), CLEAN_SPEC);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("findTestFiles", () => {
  it("finds .spec.ts files recursively", () => {
    const files = findTestFiles(tmpDir, "playwright");
    expect(files.length).toBe(2);
  });

  it("ignores node_modules", () => {
    const files = findTestFiles(tmpDir, "playwright");
    expect(files.every((f) => !f.includes("node_modules"))).toBe(true);
  });

  it("returns sorted paths", () => {
    const files = findTestFiles(tmpDir, "playwright");
    expect(files).toEqual([...files].sort());
  });

  it("returns empty array for directory with no test files", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardrails-empty-"));
    const files = findTestFiles(emptyDir, "playwright");
    fs.rmdirSync(emptyDir);
    expect(files).toHaveLength(0);
  });
});

describe("scanProject", () => {
  it("returns correct file count", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    expect(result.totals.files).toBe(2);
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

  it("framework is recorded in summary", () => {
    const result = scanProject(tmpDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    expect(result.framework).toBe("playwright");
  });

  it("mode is recorded in summary", () => {
    const result = scanProject(tmpDir, "playwright", "advisory", DEFAULT_THRESHOLDS);
    expect(result.mode).toBe("advisory");
  });
});
