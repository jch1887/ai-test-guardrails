import fs from "fs";
import path from "path";
import type {
  FileFlakeTrend,
  FlakeHistoryReport,
  ProjectScanSummary,
  ScanHistoryEntry,
  ScanHistoryFile,
  ScanHistorySummary,
} from "../types/guardrail.types.js";

/** Oldest entries are dropped once the history file holds this many scans. */
export const MAX_HISTORY_ENTRIES = 100;

const DEFAULT_REPORT_LIMIT = 50;
const TREND_EPSILON = 1e-9;

function emptyHistory(): ScanHistoryFile {
  return { version: 1, entries: [] };
}

function isHistoryFile(value: unknown): value is ScanHistoryFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { version?: unknown; entries?: unknown };
  return candidate.version === 1 && Array.isArray(candidate.entries);
}

/** Read a history file. A missing file yields an empty history; a malformed one throws. */
export function readHistory(historyPath: string): ScanHistoryFile {
  const resolved = path.resolve(historyPath);
  if (!fs.existsSync(resolved)) return emptyHistory();

  const raw = fs.readFileSync(resolved, "utf8");
  if (raw.trim() === "") return emptyHistory();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    throw new Error(`History file ${resolved} is not valid JSON`, { cause: error });
  }

  if (!isHistoryFile(parsed)) {
    throw new Error(`History file ${resolved} has an unrecognised format (expected version 1)`);
  }
  return parsed;
}

export function toHistoryEntry(summary: ProjectScanSummary): ScanHistoryEntry {
  return {
    scannedAt: summary.scannedAt,
    projectPath: summary.projectPath,
    framework: summary.framework,
    mode: summary.mode,
    totals: { ...summary.totals },
    scores: { ...summary.scores },
    files: summary.files.map((file) => ({
      file: file.file,
      flakeRiskScore: file.flakeRiskScore,
      determinismScore: file.determinismScore,
      architectureScore: file.architectureScore,
      violations: file.violations.length,
    })),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildSummary(
  historyPath: string,
  entriesRecorded: number,
  previous: ScanHistoryEntry | undefined,
  current: ScanHistoryEntry,
): ScanHistorySummary {
  if (!previous) {
    return {
      historyPath,
      entriesRecorded,
      previousScannedAt: null,
      deltas: null,
      regressions: [],
      improvements: [],
    };
  }

  const previousByFile = new Map(previous.files.map((file) => [file.file, file]));
  const regressions: FileFlakeTrend[] = [];
  const improvements: FileFlakeTrend[] = [];

  for (const file of current.files) {
    const before = previousByFile.get(file.file);
    if (!before) continue;
    const delta = round(file.flakeRiskScore - before.flakeRiskScore);
    const trend: FileFlakeTrend = {
      file: file.file,
      previousFlakeRisk: before.flakeRiskScore,
      currentFlakeRisk: file.flakeRiskScore,
      delta,
    };
    if (delta > TREND_EPSILON) regressions.push(trend);
    else if (delta < -TREND_EPSILON) improvements.push(trend);
  }

  regressions.sort((a, b) => b.delta - a.delta);
  improvements.sort((a, b) => a.delta - b.delta);

  return {
    historyPath,
    entriesRecorded,
    previousScannedAt: previous.scannedAt,
    deltas: {
      averageFlakeRisk: round(current.scores.averageFlakeRisk - previous.scores.averageFlakeRisk),
      averageDeterminism: round(
        current.scores.averageDeterminism - previous.scores.averageDeterminism,
      ),
      averageArchitecture: round(
        current.scores.averageArchitecture - previous.scores.averageArchitecture,
      ),
      totalViolations: current.totals.totalViolations - previous.totals.totalViolations,
    },
    regressions,
    improvements,
  };
}

/**
 * Append a scan to the history file and return how it compares to the previous scan.
 * The file and its parent directories are created when missing.
 */
export function recordScan(historyPath: string, summary: ProjectScanSummary): ScanHistorySummary {
  const resolved = path.resolve(historyPath);
  const history = readHistory(resolved);
  const previous = history.entries[history.entries.length - 1];
  const entry = toHistoryEntry(summary);
  const entries = [...history.entries, entry].slice(-MAX_HISTORY_ENTRIES);

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const file: ScanHistoryFile = { version: 1, entries };
  fs.writeFileSync(resolved, JSON.stringify(file, null, 2) + "\n");

  return buildSummary(resolved, entries.length, previous, entry);
}

export interface HistoryReportOptions {
  /** Restrict the per-file series to this project-relative file path. */
  file?: string;
  /** Maximum number of most recent scans to include. */
  limit?: number;
}

/** Build a time series of project-wide scores, optionally with a per-file series. */
export function summarizeHistory(
  historyPath: string,
  options: HistoryReportOptions = {},
): FlakeHistoryReport {
  const resolved = path.resolve(historyPath);
  const history = readHistory(resolved);
  const limit = options.limit ?? DEFAULT_REPORT_LIMIT;
  const entries = history.entries.slice(-limit);

  const report: FlakeHistoryReport = {
    historyPath: resolved,
    entries: history.entries.length,
    series: entries.map((entry) => ({
      scannedAt: entry.scannedAt,
      averageFlakeRisk: entry.scores.averageFlakeRisk,
      averageDeterminism: entry.scores.averageDeterminism,
      averageArchitecture: entry.scores.averageArchitecture,
      totalViolations: entry.totals.totalViolations,
      files: entry.totals.files,
    })),
  };

  const target = options.file;
  if (target !== undefined) {
    report.file = {
      file: target,
      series: entries.flatMap((entry) => {
        const match = entry.files.find((file) => file.file === target);
        if (!match) return [];
        return [
          {
            scannedAt: entry.scannedAt,
            flakeRiskScore: match.flakeRiskScore,
            determinismScore: match.determinismScore,
            architectureScore: match.architectureScore,
            violations: match.violations,
          },
        ];
      }),
    };
  }

  return report;
}
