import ts from "typescript";
import type { Framework, ArchitectureResult, Violation } from "../types/guardrail.types.js";
import type { ArchitectureRuleConfig } from "../config/defaultRules.js";
import {
  findCallsByMethodName,
  getDescribeDepth,
  getTestTitles,
  findModuleLevelMutableDeclarations,
  getLineNumber,
  getFirstArgumentText,
} from "../utils/astParser.js";

export function validateArchitecture(
  sourceFile: ts.SourceFile,
  framework: Framework,
  config: ArchitectureRuleConfig,
): ArchitectureResult {
  const violationGroups: Violation[][] = [];

  if (config.enforcePageObjects) {
    violationGroups.push(detectDirectSelectors(sourceFile, framework));
  }

  if (config.forbidGlobalState) {
    violationGroups.push(detectGlobalState(sourceFile));
  }

  violationGroups.push(detectExcessiveNesting(sourceFile, config.maxDescribeDepth));

  if (config.forbidDuplicateTestTitles) {
    violationGroups.push(detectDuplicateTestTitles(sourceFile));
  }

  const violations = violationGroups.flat();
  const totalChecks = violationGroups.length;
  const passedChecks = violationGroups.filter((group) => group.length === 0).length;
  const score = totalChecks > 0 ? passedChecks / totalChecks : 1;

  return { valid: violations.length === 0, score, violations };
}

function isBareSelector(selector: string): boolean {
  if (/\[data-test/.test(selector)) return false;
  if (/role=/.test(selector)) return false;
  if (selector.startsWith("text=") || selector.startsWith("has-text=")) return false;

  const isCssClassOrId = /^[.#]/.test(selector);
  const hasComplexCssPatterns = /\s*[>~+]\s*/.test(selector);
  const isTagWithQualifier = /^[a-z]+[.#[]/.test(selector);

  return isCssClassOrId || hasComplexCssPatterns || isTagWithQualifier;
}

function classifySelector(selector: string): "critical" | "major" {
  if (/^#[a-zA-Z0-9]{6,}/.test(selector)) return "critical";
  if (/^#bs-select/.test(selector)) return "critical";
  return "major";
}

function detectDirectSelectors(sourceFile: ts.SourceFile, framework: Framework): Violation[] {
  const violations: Violation[] = [];

  const selectorMethods =
    framework === "playwright" ? ["locator", "$", "$$"] : ["get", "find"];

  for (const method of selectorMethods) {
    const calls = findCallsByMethodName(sourceFile, method);
    for (const call of calls) {
      const selectorArg = getFirstArgumentText(call);
      if (selectorArg && isBareSelector(selectorArg)) {
        const line = getLineNumber(call, sourceFile);
        violations.push({
          severity: classifySelector(selectorArg),
          rule: "no-raw-selector",
          message: `[line ${String(line)}] Direct CSS selector "${selectorArg}" in test code. Extract selectors to page objects and use data-testid or role-based selectors.`,
        });
      }
    }
  }

  return violations;
}

function detectGlobalState(sourceFile: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  const declarations = findModuleLevelMutableDeclarations(sourceFile);
  for (const decl of declarations) {
    const line = getLineNumber(decl, sourceFile);
    const name = ts.isIdentifier(decl.name) ? decl.name.text : "<destructured>";
    violations.push({
      severity: "critical",
      rule: "no-global-state",
      message: `[line ${String(line)}] Module-level mutable variable "${name}" can leak state between tests. Use const or move to test-scoped setup.`,
    });
  }
  return violations;
}

function detectExcessiveNesting(sourceFile: ts.SourceFile, maxDepth: number): Violation[] {
  const depth = getDescribeDepth(sourceFile);
  if (depth > maxDepth) {
    return [
      {
        severity: "minor",
        rule: "no-deep-nesting",
        message: `Test nesting depth is ${String(depth)} (max allowed: ${String(maxDepth)}). Flatten describe blocks to improve readability.`,
      },
    ];
  }
  return [];
}

function detectDuplicateTestTitles(sourceFile: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  const titles = getTestTitles(sourceFile);
  const seen = new Map<string, number>();

  for (const title of titles) {
    const count = (seen.get(title) ?? 0) + 1;
    seen.set(title, count);
    if (count === 2) {
      violations.push({
        severity: "minor",
        rule: "no-duplicate-title",
        message: `Duplicate test title "${title}". Each test should have a unique title for clear reporting.`,
      });
    }
  }

  return violations;
}
