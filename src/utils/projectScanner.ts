import fs from "fs";
import path from "path";
import { parseSourceCode } from "./astParser.js";
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
} from "../types/guardrail.types.js";

const PLAYWRIGHT_PATTERNS = [/\.spec\.ts$/, /\.spec\.js$/, /\.test\.ts$/, /\.test\.js$/];
const CYPRESS_PATTERNS = [/\.cy\.ts$/, /\.cy\.js$/, /\.spec\.ts$/, /\.spec\.js$/];
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".cache"]);

const TOP_OFFENDERS_COUNT = 5;

export function findTestFiles(dirPath: string, framework: Framework): string[] {
  const patterns = framework === "playwright" ? PLAYWRIGHT_PATTERNS : CYPRESS_PATTERNS;
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
      } else if (entry.isFile() && patterns.some((p) => p.test(entry.name))) {
        results.push(fullPath);
      }
    }
  }

  walk(dirPath);
  return results.sort();
}

export function scanProject(
  projectPath: string,
  framework: Framework,
  mode: ValidationMode,
  thresholds: EnforcementThresholds,
): ProjectScanSummary {
  const resolvedPath = path.resolve(projectPath);
  const testFiles = findTestFiles(resolvedPath, framework);

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

  const totals = {
    files: fileResults.length,
    passed: fileResults.filter((r) => r.policy.action === "PASSED").length,
    warned: fileResults.filter((r) => r.policy.action === "WARNED").length,
    rejected: fileResults.filter((r) => r.policy.action === "REJECTED").length,
    totalViolations: fileResults.reduce((sum, r) => sum + r.violations.length, 0),
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
  };
}
