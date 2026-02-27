import ts from "typescript";
import type { Framework, ArchitectureResult } from "../types/guardrail.types.js";
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
  const violationGroups: string[][] = [];

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

  return {
    valid: violations.length === 0,
    score,
    violations,
  };
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

function detectDirectSelectors(
  sourceFile: ts.SourceFile,
  framework: Framework,
): string[] {
  const violations: string[] = [];

  const selectorMethods =
    framework === "playwright" ? ["locator", "$", "$$"] : ["get", "find"];

  for (const method of selectorMethods) {
    const calls = findCallsByMethodName(sourceFile, method);
    for (const call of calls) {
      const selectorArg = getFirstArgumentText(call);
      if (selectorArg && isBareSelector(selectorArg)) {
        const line = getLineNumber(call, sourceFile);
        violations.push(
          `[line ${line}] Direct CSS selector "${selectorArg}" in test code. Extract selectors to page objects and use data-testid or role-based selectors.`,
        );
      }
    }
  }

  return violations;
}

function detectGlobalState(sourceFile: ts.SourceFile): string[] {
  const violations: string[] = [];
  const declarations = findModuleLevelMutableDeclarations(sourceFile);
  for (const decl of declarations) {
    const line = getLineNumber(decl, sourceFile);
    const name = ts.isIdentifier(decl.name) ? decl.name.text : "<destructured>";
    violations.push(
      `[line ${line}] Module-level mutable variable "${name}" can leak state between tests. Use const or move to test-scoped setup.`,
    );
  }
  return violations;
}

function detectExcessiveNesting(
  sourceFile: ts.SourceFile,
  maxDepth: number,
): string[] {
  const depth = getDescribeDepth(sourceFile);
  if (depth > maxDepth) {
    return [
      `Test nesting depth is ${depth} (max allowed: ${maxDepth}). Flatten describe blocks to improve readability.`,
    ];
  }
  return [];
}

function detectDuplicateTestTitles(sourceFile: ts.SourceFile): string[] {
  const violations: string[] = [];
  const titles = getTestTitles(sourceFile);
  const seen = new Map<string, number>();

  for (const title of titles) {
    const count = (seen.get(title) ?? 0) + 1;
    seen.set(title, count);
    if (count === 2) {
      violations.push(
        `Duplicate test title "${title}". Each test should have a unique title for clear reporting.`,
      );
    }
  }

  return violations;
}
