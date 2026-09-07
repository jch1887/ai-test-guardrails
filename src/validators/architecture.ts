import ts from "typescript";
import type {
  CustomRule,
  Framework,
  ArchitectureResult,
  Violation,
} from "../types/guardrail.types.js";
import type { ArchitectureRuleConfig } from "../config/defaultRules.js";
import {
  findCallsByMethodName,
  getDescribeDepth,
  getTestTitles,
  findModuleLevelMutableDeclarations,
  getLineNumber,
  getFirstArgumentText,
  walkAst,
} from "../utils/astParser.js";
import { runCustomRules } from "./customRules.js";

export function validateArchitecture(
  sourceFile: ts.SourceFile,
  framework: Framework,
  config: ArchitectureRuleConfig,
  customRules: CustomRule[] = [],
): ArchitectureResult {
  const violationGroups: Violation[][] = [];

  if (config.enforcePageObjects) {
    violationGroups.push(detectDirectSelectors(sourceFile, framework));
  }

  if (config.forbidGlobalState) {
    violationGroups.push(detectGlobalState(sourceFile, framework));
  }

  violationGroups.push(detectExcessiveNesting(sourceFile, config.maxDescribeDepth));

  if (config.forbidDuplicateTestTitles) {
    violationGroups.push(detectDuplicateTestTitles(sourceFile));
  }

  if (config.detectPositionalSelectors) {
    violationGroups.push(detectPositionalSelectors(sourceFile, framework));
  }

  if (config.detectForcedActions) {
    violationGroups.push(detectForcedActions(sourceFile, framework));
  }

  violationGroups.push(...runCustomRules(customRules, "architecture", sourceFile, framework));

  const violations = violationGroups.flat();
  const totalChecks = violationGroups.length;
  const passedChecks = violationGroups.filter((group) => group.length === 0).length;
  const score = totalChecks > 0 ? passedChecks / totalChecks : 1;

  return { valid: violations.length === 0, score, violations };
}

function stableSelectorSnippet(framework: Framework): string {
  return framework === "playwright"
    ? "page.getByTestId('submit-button') or page.getByRole('button', { name: 'Submit' })"
    : "cy.get('[data-cy=submit-button]') or cy.findByRole('button', { name: 'Submit' })";
}

function selectorMethodsFor(framework: Framework): string[] {
  return framework === "playwright" ? ["locator", "$", "$$"] : ["get", "find"];
}

function isBareSelector(selector: string): boolean {
  if (/\[data-test/.test(selector)) return false;
  if (/\[data-cy/.test(selector)) return false;
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

  for (const method of selectorMethodsFor(framework)) {
    const calls = findCallsByMethodName(sourceFile, method);
    for (const call of calls) {
      const selectorArg = getFirstArgumentText(call);
      if (selectorArg && isBareSelector(selectorArg)) {
        const line = getLineNumber(call, sourceFile);
        violations.push({
          severity: classifySelector(selectorArg),
          rule: "no-raw-selector",
          message: `[line ${String(line)}] Direct CSS selector "${selectorArg}" in test code. Extract selectors to page objects and use data-testid or role-based selectors.`,
          suggestion: `Add a test id to the element and select it with ${stableSelectorSnippet(framework)}. Keep the selector in a page object so it is defined once.`,
        });
      }
    }
  }

  return violations;
}

function detectGlobalState(sourceFile: ts.SourceFile, framework: Framework): Violation[] {
  const violations: Violation[] = [];
  const declarations = findModuleLevelMutableDeclarations(sourceFile);
  const hookSnippet =
    framework === "playwright"
      ? "test.beforeEach(async () => { state = createFreshState(); });"
      : "beforeEach(() => { state = createFreshState(); });";
  for (const decl of declarations) {
    const line = getLineNumber(decl, sourceFile);
    const name = ts.isIdentifier(decl.name) ? decl.name.text : "<destructured>";
    violations.push({
      severity: "critical",
      rule: "no-global-state",
      message: `[line ${String(line)}] Module-level mutable variable "${name}" can leak state between tests. Use const or move to test-scoped setup.`,
      suggestion: `Declare "${name}" with const, or reset it before every test: ${hookSnippet}`,
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
        suggestion: `Merge inner describe titles into their parent, for example describe('checkout > payment', () => { ... }), so nesting stays at or below ${String(maxDepth)} levels.`,
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
        suggestion: `Rename one of the tests to describe its scenario, for example it('${title} when the cart is empty', ...).`,
      });
    }
  }

  return violations;
}

const POSITIONAL_PSEUDO_CLASS = /:(nth-child|nth-of-type|nth-last-child|nth-last-of-type|eq)\(/;

function detectPositionalSelectors(sourceFile: ts.SourceFile, framework: Framework): Violation[] {
  const violations: Violation[] = [];
  const indexMethods = framework === "playwright" ? ["nth"] : ["eq"];
  const edgeMethods = ["first", "last"];
  const suggestion = `Select the element by what it is rather than where it sits: ${stableSelectorSnippet(framework)}. If you need a specific row, give it a unique test id.`;

  for (const method of indexMethods) {
    for (const call of findCallsByMethodName(sourceFile, method)) {
      if (!ts.isPropertyAccessExpression(call.expression)) continue;
      const line = getLineNumber(call, sourceFile);
      violations.push({
        severity: "major",
        rule: "no-positional-selector",
        message: `[line ${String(line)}] Positional selector .${method}() depends on DOM order and breaks when elements are reordered.`,
        suggestion,
      });
    }
  }

  for (const method of edgeMethods) {
    for (const call of findCallsByMethodName(sourceFile, method)) {
      if (!ts.isPropertyAccessExpression(call.expression)) continue;
      const line = getLineNumber(call, sourceFile);
      violations.push({
        severity: "minor",
        rule: "no-positional-selector",
        message: `[line ${String(line)}] Positional selector .${method}() depends on DOM order and breaks when elements are reordered.`,
        suggestion,
      });
    }
  }

  for (const method of selectorMethodsFor(framework)) {
    for (const call of findCallsByMethodName(sourceFile, method)) {
      const selectorArg = getFirstArgumentText(call);
      if (selectorArg && POSITIONAL_PSEUDO_CLASS.test(selectorArg)) {
        const line = getLineNumber(call, sourceFile);
        violations.push({
          severity: "major",
          rule: "no-positional-selector",
          message: `[line ${String(line)}] Selector "${selectorArg}" uses a positional pseudo-class and breaks when elements are reordered.`,
          suggestion,
        });
      }
    }
  }

  return violations;
}

function hasForceTrueArgument(call: ts.CallExpression): boolean {
  return call.arguments.some((arg) => {
    if (!ts.isObjectLiteralExpression(arg)) return false;
    return arg.properties.some(
      (prop) =>
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === "force" &&
        prop.initializer.kind === ts.SyntaxKind.TrueKeyword,
    );
  });
}

function detectForcedActions(sourceFile: ts.SourceFile, framework: Framework): Violation[] {
  const violations: Violation[] = [];
  const suggestion =
    framework === "playwright"
      ? "Wait for the element to become actionable instead: await expect(locator).toBeEnabled(); await locator.click();"
      : "Assert the element is ready instead: cy.get('[data-cy=submit]').should('be.visible').and('be.enabled').click();";

  walkAst(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (!hasForceTrueArgument(node)) return;
    const method = node.expression.name.text;
    const line = getLineNumber(node, sourceFile);
    violations.push({
      severity: "major",
      rule: "no-force-action",
      message: `[line ${String(line)}] .${method}() called with { force: true }. Forcing bypasses visibility and actionability checks and hides real UI problems.`,
      suggestion,
    });
  });

  return violations;
}
