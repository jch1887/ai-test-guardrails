import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { scanProject } from "../src/utils/projectScanner.js";
import {
  MAX_HISTORY_ENTRIES,
  readHistory,
  recordScan,
  summarizeHistory,
  toHistoryEntry,
} from "../src/utils/scanHistory.js";
import { DEFAULT_THRESHOLDS } from "../src/utils/enforcement.js";
import type { ProjectScanSummary } from "../src/types/guardrail.types.js";

const CLEAN = `
import { test, expect } from '@playwright/test';
test('a', async ({ page }) => { await expect(page.getByTestId('x')).toBeVisible(); });
`;
const FLAKY = `
import { test } from '@playwright/test';
test('a', async ({ page }) => {
  await page.goto('/a');
  await page.goto('/b');
  await fetch('/api');
});
`;

let tmpDir: string;
let projectDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardrails-history-"));
  projectDir = path.join(tmpDir, "project");
  fs.mkdirSync(projectDir);
  fs.writeFileSync(path.join(projectDir, "a.spec.ts"), CLEAN);
  fs.writeFileSync(path.join(projectDir, "b.spec.ts"), CLEAN);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("CI artefact export", () => {
  it("writes the full summary to outputPath and reports the absolute path", () => {
    const outputPath = path.join(tmpDir, "reports", "nested", "scan.json");
    const result = scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS, {
      outputPath,
    });
    expect(result.outputPath).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(outputPath, "utf8")) as ProjectScanSummary;
    expect(written.totals.files).toBe(2);
    expect(written.outputPath).toBe(outputPath);
    expect(written.scannedAt).toBe(result.scannedAt);
  });

  it("does not write anything when outputPath is omitted", () => {
    const result = scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    expect(result.outputPath).toBeUndefined();
    expect(fs.readdirSync(tmpDir)).toEqual(["project"]);
  });
});

describe("scan history", () => {
  it("readHistory returns an empty history for a missing file", () => {
    expect(readHistory(path.join(tmpDir, "none.json"))).toEqual({ version: 1, entries: [] });
  });

  it("readHistory rejects malformed files", () => {
    const p = path.join(tmpDir, "bad.json");
    fs.writeFileSync(p, "nope");
    expect(() => readHistory(p)).toThrow(/not valid JSON/);
    fs.writeFileSync(p, JSON.stringify({ version: 2 }));
    expect(() => readHistory(p)).toThrow(/unrecognised format/);
  });

  it("first scan records an entry with no deltas", () => {
    const historyPath = path.join(tmpDir, "history.json");
    const result = scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS, {
      historyPath,
    });
    expect(result.history?.historyPath).toBe(historyPath);
    expect(result.history?.entriesRecorded).toBe(1);
    expect(result.history?.previousScannedAt).toBeNull();
    expect(result.history?.deltas).toBeNull();
    expect(readHistory(historyPath).entries).toHaveLength(1);
  });

  it("second scan reports deltas and per-file flake regressions", () => {
    const historyPath = path.join(tmpDir, "history.json");
    const first = scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS, {
      historyPath,
    });

    fs.writeFileSync(path.join(projectDir, "b.spec.ts"), FLAKY);
    const second = scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS, {
      historyPath,
    });

    expect(second.history?.entriesRecorded).toBe(2);
    expect(second.history?.previousScannedAt).toBe(first.scannedAt);
    expect(second.history?.deltas?.averageFlakeRisk).toBeGreaterThan(0);
    expect(second.history?.deltas?.totalViolations).toBeGreaterThan(0);
    expect(second.history?.regressions).toHaveLength(1);
    expect(second.history?.regressions[0]?.file).toBe("b.spec.ts");
    expect(second.history?.regressions[0]?.delta).toBeGreaterThan(0);
    expect(second.history?.improvements).toHaveLength(0);

    fs.writeFileSync(path.join(projectDir, "b.spec.ts"), CLEAN);
    const third = scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS, {
      historyPath,
    });
    expect(third.history?.improvements[0]?.file).toBe("b.spec.ts");
    expect(third.history?.regressions).toHaveLength(0);
  });

  it("history entries store per-file scores but not full violation payloads", () => {
    const summary = scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    const entry = toHistoryEntry(summary);
    expect(entry.files).toHaveLength(2);
    expect(entry.files[0]).toEqual({
      file: "a.spec.ts",
      flakeRiskScore: 0,
      determinismScore: 1,
      architectureScore: 1,
      violations: 0,
    });
    expect(JSON.stringify(entry)).not.toContain("suggestion");
  });

  it("caps the file at MAX_HISTORY_ENTRIES", () => {
    const historyPath = path.join(tmpDir, "history.json");
    const summary = scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i++) {
      recordScan(historyPath, { ...summary, scannedAt: new Date(i * 1000).toISOString() });
    }
    const history = readHistory(historyPath);
    expect(history.entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(history.entries[0]?.scannedAt).toBe(new Date(5 * 1000).toISOString());
  });

  it("history written alongside outputPath is included in the artefact", () => {
    const historyPath = path.join(tmpDir, "history.json");
    const outputPath = path.join(tmpDir, "scan.json");
    scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS, { historyPath, outputPath });
    const written = JSON.parse(fs.readFileSync(outputPath, "utf8")) as ProjectScanSummary;
    expect(written.history?.entriesRecorded).toBe(1);
  });
});

describe("summarizeHistory", () => {
  it("returns an empty series for a missing file", () => {
    const report = summarizeHistory(path.join(tmpDir, "none.json"));
    expect(report.entries).toBe(0);
    expect(report.series).toEqual([]);
    expect(report.file).toBeUndefined();
  });

  it("returns a project series and a per-file series", () => {
    const historyPath = path.join(tmpDir, "history.json");
    scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS, { historyPath });
    fs.writeFileSync(path.join(projectDir, "b.spec.ts"), FLAKY);
    scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS, { historyPath });

    const report = summarizeHistory(historyPath, { file: "b.spec.ts" });
    expect(report.entries).toBe(2);
    expect(report.series).toHaveLength(2);
    expect(report.series[1]?.averageFlakeRisk).toBeGreaterThan(
      report.series[0]?.averageFlakeRisk ?? 0,
    );
    expect(report.file?.file).toBe("b.spec.ts");
    expect(report.file?.series).toHaveLength(2);
    expect(report.file?.series[1]?.flakeRiskScore).toBeGreaterThan(0);
  });

  it("respects the limit option", () => {
    const historyPath = path.join(tmpDir, "history.json");
    const summary = scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS);
    for (let i = 0; i < 5; i++) recordScan(historyPath, summary);
    const report = summarizeHistory(historyPath, { limit: 2 });
    expect(report.entries).toBe(5);
    expect(report.series).toHaveLength(2);
  });

  it("omits files that were not present in a scan from the per-file series", () => {
    const historyPath = path.join(tmpDir, "history.json");
    scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS, { historyPath });
    fs.writeFileSync(path.join(projectDir, "c.spec.ts"), CLEAN);
    scanProject(projectDir, "playwright", "warn", DEFAULT_THRESHOLDS, { historyPath });
    const report = summarizeHistory(historyPath, { file: "c.spec.ts" });
    expect(report.file?.series).toHaveLength(1);
  });
});
