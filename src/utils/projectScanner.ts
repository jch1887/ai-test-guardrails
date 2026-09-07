import fs from "fs";
import path from "path";
import { parseSourceCode } from "./astParser.js";
import { detectFrameworkFromSource } from "./frameworkDetector.js";
import { validateSource } from "../validators/pipeline.js";
import { recordScan } from "./scanHistory.js";
import { createIgnoreMatcher } from "./scanPolicy.js";
import type { RuleConfig } from "../config/defaultRules.js";
import type {
  CustomRule,
  Framework,
  ValidationMode,
  EnforcementThresholds,
  FileValidationResult,
  ProjectScanSummary,
  UnsupportedFileEntry,
} from "../types/guardrail.types.js";

/**
 * Conventional patterns that are unconditionally included without needing to
 * inspect their imports. Covers .spec.ts/js, .test.ts/js, .cy.ts/js.
 */
const CONVENTIONAL_PATTERNS = [
  /\.spec\.ts$/,
  /\.spec\.js$/,
  /\.test\.ts$/,
  /\.test\.js$/,
  /\.cy\.ts$/,
  /\.cy\.js$/,
];

/** All .ts/.js files are candidates for the framework-detection pass. */
const ALL_SOURCE_PATTERN = /\.(ts|js)$/;

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".cache"]);

const TOP_OFFENDERS_COUNT = 5;

export interface ScanOptions {
  /** Rule configuration. Defaults to `DEFAULT_RULES`. */
  rules?: RuleConfig;
  /** Custom rules loaded from plugins. */
  customRules?: CustomRule[];
  /** When set, the full scan summary is written to this JSON file (CI artefact). */
  outputPath?: string;
  /** When set, the scan is appended to this JSON history file and trend data is returned. */
  historyPath?: string;
  /** gitignore-style globs (relative to the project) to skip, on top of the built-in directory list. */
  ignore?: string[];
}

interface ClassifiedFiles {
  supported: string[];
  unsupported: UnsupportedFileEntry[];
}

/**
 * Walk a directory and return every .ts/.js file, respecting the built-in ignore list
 * and any user-supplied ignore globs.
 */
function walkForSourceFiles(dirPath: string, ignore: string[]): string[] {
  const results: string[] = [];
  const isIgnored = createIgnoreMatcher(ignore);

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (isIgnored(path.relative(dirPath, fullPath))) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && ALL_SOURCE_PATTERN.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  walk(dirPath);
  return results.sort();
}

/**
 * Classify all .ts/.js files in a directory into:
 *  - supported: files to validate (conventional patterns OR framework-detected as Playwright/Cypress)
 *  - unsupported: files detected as an unsupported framework (e.g. k6)
 *
 * Files with no recognised test framework imports and no conventional naming are skipped
 * to avoid false positives on config/helper files.
 */
export function classifyProjectFiles(
  dirPath: string,
  resolvedBase: string,
  ignore: string[] = [],
): ClassifiedFiles {
  const allFiles = walkForSourceFiles(dirPath, ignore);
  const supported: string[] = [];
  const unsupported: UnsupportedFileEntry[] = [];

  for (const filePath of allFiles) {
    const isConventional = CONVENTIONAL_PATTERNS.some((p) => p.test(filePath));

    if (isConventional) {
      supported.push(filePath);
      continue;
    }

    // For non-conventional files, read and detect the framework from imports.
    let code: string;
    try {
      code = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const detection = detectFrameworkFromSource(parseSourceCode(code));

    if (!detection.isSupported && detection.detected !== null) {
      unsupported.push({
        file: path.relative(resolvedBase, filePath),
        detectedFramework: detection.detected,
      });
    } else if (detection.detected !== null) {
      // Recognised as Playwright or Cypress via imports, include for validation.
      supported.push(filePath);
    }
    // detection.detected === null means no framework imports were found; skip (config/helper file).
  }

  return { supported, unsupported };
}

function writeArtefact(outputPath: string, summary: ProjectScanSummary): string {
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(summary, null, 2) + "\n");
  return resolved;
}

export function scanProject(
  projectPath: string,
  framework: Framework,
  mode: ValidationMode,
  thresholds: EnforcementThresholds,
  options: ScanOptions = {},
): ProjectScanSummary {
  const resolvedPath = path.resolve(projectPath);
  const { supported: testFiles, unsupported: unsupportedFiles } = classifyProjectFiles(
    resolvedPath,
    resolvedPath,
    options.ignore ?? [],
  );

  const validationOptions = { rules: options.rules, customRules: options.customRules };
  const fileResults: FileValidationResult[] = [];

  for (const filePath of testFiles) {
    let code: string;
    try {
      code = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const result = validateSource(
      parseSourceCode(code),
      framework,
      mode,
      thresholds,
      validationOptions,
    );

    fileResults.push({
      file: path.relative(resolvedPath, filePath),
      ...result,
    });
  }

  const allProjectViolations = fileResults.flatMap((r) => r.violations);

  const totals = {
    files: fileResults.length,
    passed: fileResults.filter((r) => r.policy.action === "PASSED").length,
    warned: fileResults.filter((r) => r.policy.action === "WARNED").length,
    rejected: fileResults.filter((r) => r.policy.action === "REJECTED").length,
    totalViolations: allProjectViolations.length,
    criticalViolations: allProjectViolations.filter((v) => v.severity === "critical").length,
    majorViolations: allProjectViolations.filter((v) => v.severity === "major").length,
    minorViolations: allProjectViolations.filter((v) => v.severity === "minor").length,
  };

  const scores =
    fileResults.length > 0
      ? {
          averageDeterminism:
            fileResults.reduce((s, r) => s + r.determinismScore, 0) / fileResults.length,
          averageFlakeRisk:
            fileResults.reduce((s, r) => s + r.flakeRiskScore, 0) / fileResults.length,
          averageArchitecture:
            fileResults.reduce((s, r) => s + r.architectureScore, 0) / fileResults.length,
        }
      : { averageDeterminism: 1, averageFlakeRisk: 0, averageArchitecture: 1 };

  const topOffenders = [...fileResults]
    .filter((r) => r.violations.length > 0)
    .sort((a, b) => b.violations.length - a.violations.length)
    .slice(0, TOP_OFFENDERS_COUNT);

  const summary: ProjectScanSummary = {
    scannedAt: new Date().toISOString(),
    projectPath: resolvedPath,
    framework,
    mode,
    thresholds,
    totals,
    scores,
    files: fileResults,
    topOffenders,
    unsupportedFiles,
  };

  if (options.historyPath !== undefined) {
    summary.history = recordScan(options.historyPath, summary);
  }

  if (options.outputPath !== undefined) {
    summary.outputPath = path.resolve(options.outputPath);
    writeArtefact(summary.outputPath, summary);
  }

  return summary;
}
