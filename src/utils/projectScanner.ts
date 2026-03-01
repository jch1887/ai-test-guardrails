import fs from "fs";
import path from "path";
import { parseSourceCode } from "./astParser.js";
import { detectFrameworkFromSource } from "./frameworkDetector.js";
import { validateDeterminism } from "../validators/determinism.js";
import { validateArchitecture } from "../validators/architecture.js";
import { scoreFlakeRisk } from "../validators/flakeRisk.js";
import { resolveEnforcement, isValid } from "./enforcement.js";
import { DEFAULT_RULES } from "../config/defaultRules.js";
import type {
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

interface ClassifiedFiles {
  supported: string[];
  unsupported: UnsupportedFileEntry[];
}

/**
 * Walk a directory and return every .ts/.js file, respecting the ignore list.
 */
function walkForSourceFiles(dirPath: string): string[] {
  const results: string[] = [];

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
export function classifyProjectFiles(dirPath: string, resolvedBase: string): ClassifiedFiles {
  const allFiles = walkForSourceFiles(dirPath);
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
      // Recognised as Playwright or Cypress via imports — include for validation.
      supported.push(filePath);
    }
    // detection.detected === null → no framework imports found, skip (config/helper file).
  }

  return { supported, unsupported };
}

export function scanProject(
  projectPath: string,
  framework: Framework,
  mode: ValidationMode,
  thresholds: EnforcementThresholds,
): ProjectScanSummary {
  const resolvedPath = path.resolve(projectPath);
  const { supported: testFiles, unsupported: unsupportedFiles } = classifyProjectFiles(
    resolvedPath,
    resolvedPath,
  );

  const fileResults: FileValidationResult[] = [];

  for (const filePath of testFiles) {
    let code: string;
    try {
      code = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const sourceFile = parseSourceCode(code);
    const determinism = validateDeterminism(sourceFile, framework, DEFAULT_RULES.determinism);
    const flakeRisk = scoreFlakeRisk(sourceFile, framework, DEFAULT_RULES.flakeRisk);
    const architecture = validateArchitecture(sourceFile, framework, DEFAULT_RULES.architecture);

    const allViolations = [...determinism.violations, ...architecture.violations];

    const policy = resolveEnforcement(
      mode,
      {
        architectureViolations: architecture.violations.length,
        flakeRiskScore: flakeRisk.score,
        determinismViolations: determinism.violations.length,
      },
      thresholds,
      allViolations,
    );

    fileResults.push({
      file: path.relative(resolvedPath, filePath),
      valid: isValid(policy.action),
      policy,
      determinismScore: determinism.score,
      flakeRiskScore: flakeRisk.score,
      architectureScore: architecture.score,
      violations: allViolations,
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

  return {
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
}
