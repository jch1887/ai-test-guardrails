import ts from "typescript";
import type { Framework, DeterminismResult, Violation } from "../types/guardrail.types.js";
import type { DeterminismRuleConfig } from "../config/defaultRules.js";
import {
  findCallsByMethodName,
  findPropertyAccessCalls,
  walkAst,
  getLineNumber,
  hasTemplateLiteralArgument,
} from "../utils/astParser.js";

export function validateDeterminism(
  sourceFile: ts.SourceFile,
  framework: Framework,
  config: DeterminismRuleConfig,
): DeterminismResult {
  const violations: Violation[] = [];

  if (config.detectWaitForTimeout) {
    violations.push(...detectWaitForTimeout(sourceFile, framework));
  }
  if (config.detectHardSleeps) {
    violations.push(...detectHardSleeps(sourceFile));
  }
  if (config.detectRandomWithoutSeed) {
    violations.push(...detectRandomWithoutSeed(sourceFile));
  }
  if (config.detectUnboundedRetries) {
    violations.push(...detectUnboundedRetries(sourceFile));
  }
  if (config.detectUnmockedNetworkCalls) {
    violations.push(...detectUnmockedNetworkCalls(sourceFile, framework));
  }
  if (config.detectDynamicSelectors) {
    violations.push(...detectDynamicSelectors(sourceFile, framework));
  }

  const enabledRules = Object.values(config).filter((v) => v === true).length;
  const violatedRules = new Set(violations.map((v) => v.rule));
  const passedRules = enabledRules - Math.min(violatedRules.size, enabledRules);
  const score = enabledRules > 0 ? passedRules / enabledRules : 1;

  return { score, violations };
}

function detectWaitForTimeout(sourceFile: ts.SourceFile, framework: Framework): Violation[] {
  const violations: Violation[] = [];

  if (framework === "playwright") {
    const calls = findCallsByMethodName(sourceFile, "waitForTimeout");
    for (const call of calls) {
      const line = getLineNumber(call, sourceFile);
      violations.push({
        severity: "critical",
        rule: "no-wait-for-timeout",
        message: `[line ${String(line)}] waitForTimeout introduces non-deterministic timing. Use waitForSelector or expect assertions instead.`,
      });
    }
  }

  if (framework === "cypress") {
    const calls = findCallsByMethodName(sourceFile, "wait");
    for (const call of calls) {
      const firstArg = call.arguments[0];
      if (firstArg && ts.isNumericLiteral(firstArg)) {
        const line = getLineNumber(call, sourceFile);
        violations.push({
          severity: "critical",
          rule: "no-wait-for-timeout",
          message: `[line ${String(line)}] cy.wait(${firstArg.text}) with numeric argument introduces hard timing dependency. Use cy.intercept() aliases instead.`,
        });
      }
    }
  }

  return violations;
}

function detectHardSleeps(sourceFile: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];

  const setTimeoutCalls = findCallsByMethodName(sourceFile, "setTimeout");
  for (const call of setTimeoutCalls) {
    const line = getLineNumber(call, sourceFile);
    violations.push({
      severity: "critical",
      rule: "no-hard-sleep",
      message: `[line ${String(line)}] setTimeout used as a sleep mechanism. Replace with explicit wait conditions.`,
    });
  }

  const sleepCalls = findCallsByMethodName(sourceFile, "sleep");
  for (const call of sleepCalls) {
    const line = getLineNumber(call, sourceFile);
    violations.push({
      severity: "critical",
      rule: "no-hard-sleep",
      message: `[line ${String(line)}] sleep() introduces hard timing dependency. Use framework-specific wait mechanisms.`,
    });
  }

  return violations;
}

function detectRandomWithoutSeed(sourceFile: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  const calls = findPropertyAccessCalls(sourceFile, "Math", "random");
  for (const call of calls) {
    const line = getLineNumber(call, sourceFile);
    violations.push({
      severity: "major",
      rule: "no-random-without-seed",
      message: `[line ${String(line)}] Math.random() produces non-deterministic values. Use a seeded random generator for test data.`,
    });
  }
  return violations;
}

function detectUnboundedRetries(sourceFile: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];

  walkAst(sourceFile, (node) => {
    if (ts.isWhileStatement(node) && node.expression.kind === ts.SyntaxKind.TrueKeyword) {
      const line = getLineNumber(node, sourceFile);
      violations.push({
        severity: "critical",
        rule: "no-unbounded-retry",
        message: `[line ${String(line)}] while(true) loop detected. Unbounded retries can cause test hangs. Add a maximum retry count.`,
      });
    }

    if (ts.isForStatement(node) && !node.condition) {
      const line = getLineNumber(node, sourceFile);
      violations.push({
        severity: "critical",
        rule: "no-unbounded-retry",
        message: `[line ${String(line)}] Infinite for loop detected. Add a bounded condition to prevent test hangs.`,
      });
    }
  });

  return violations;
}

function detectUnmockedNetworkCalls(sourceFile: ts.SourceFile, framework: Framework): Violation[] {
  const violations: Violation[] = [];

  const hasMocking =
    framework === "playwright"
      ? findCallsByMethodName(sourceFile, "route").length > 0
      : findCallsByMethodName(sourceFile, "intercept").length > 0;

  if (hasMocking) return violations;

  const fetchCalls = findCallsByMethodName(sourceFile, "fetch");
  for (const call of fetchCalls) {
    const line = getLineNumber(call, sourceFile);
    const mockAdvice = framework === "playwright" ? "page.route()" : "cy.intercept()";
    violations.push({
      severity: "major",
      rule: "no-unmocked-network",
      message: `[line ${String(line)}] fetch() called without network mocking. Use ${mockAdvice} to mock network calls.`,
    });
  }

  const axiosMethods = ["get", "post", "put", "delete"] as const;
  for (const method of axiosMethods) {
    const calls = findPropertyAccessCalls(sourceFile, "axios", method);
    for (const call of calls) {
      const line = getLineNumber(call, sourceFile);
      violations.push({
        severity: "major",
        rule: "no-unmocked-network",
        message: `[line ${String(line)}] axios.${method}() called without network mocking. Mock network requests to ensure deterministic tests.`,
      });
    }
  }

  return violations;
}

function detectDynamicSelectors(sourceFile: ts.SourceFile, framework: Framework): Violation[] {
  const violations: Violation[] = [];

  const selectorMethods =
    framework === "playwright"
      ? ["locator", "$", "$$", "querySelector", "querySelectorAll"]
      : ["get", "find", "contains"];

  for (const method of selectorMethods) {
    const calls = findCallsByMethodName(sourceFile, method);
    for (const call of calls) {
      if (hasTemplateLiteralArgument(call)) {
        const line = getLineNumber(call, sourceFile);
        violations.push({
          severity: "major",
          rule: "no-dynamic-selector",
          message: `[line ${String(line)}] Dynamic selector using template literal in ${method}(). Use stable data-testid or role-based selectors.`,
        });
      }
    }
  }

  return violations;
}
