import ts from "typescript";
import type { Framework, FlakeRiskResult } from "../types/guardrail.types.js";
import type { FlakeRiskWeightConfig } from "../config/defaultRules.js";
import {
  countAwaitExpressions,
  countNavigationCalls,
  findCallsByMethodName,
  findModuleLevelMutableDeclarations,
  walkAst,
} from "../utils/astParser.js";

const ASYNC_HEAVY_THRESHOLD = 5;

export function scoreFlakeRisk(
  sourceFile: ts.SourceFile,
  framework: Framework,
  config: FlakeRiskWeightConfig,
): FlakeRiskResult {
  const factors = [
    {
      name: "async-heavy",
      weight: config.asyncHeavyWeight,
      detected: isAsyncHeavy(sourceFile),
      description: "High number of async operations increases timing sensitivity",
    },
    {
      name: "network-dependency",
      weight: config.networkDependencyWeight,
      detected: hasNetworkDependency(sourceFile),
      description: "Network calls without mocking create external dependencies",
    },
    {
      name: "multiple-navigations",
      weight: config.multipleNavigationsWeight,
      detected: hasMultipleNavigations(sourceFile, framework),
      description: "Multiple navigation steps increase page load timing variability",
    },
    {
      name: "shared-state",
      weight: config.sharedStateWeight,
      detected: hasSharedState(sourceFile),
      description: "Module-level mutable state can leak between tests",
    },
    {
      name: "timing-assertions",
      weight: config.timingAssertionsWeight,
      detected: hasTimingAssertions(sourceFile),
      description: "Timing-dependent assertions are sensitive to execution speed",
    },
  ];

  const score = factors.reduce((total, factor) => {
    return total + (factor.detected ? factor.weight : 0);
  }, 0);

  return {
    score: Math.min(score, 1),
    factors,
  };
}

function isAsyncHeavy(sourceFile: ts.SourceFile): boolean {
  return countAwaitExpressions(sourceFile) > ASYNC_HEAVY_THRESHOLD;
}

function hasNetworkDependency(sourceFile: ts.SourceFile): boolean {
  const fetchCalls = findCallsByMethodName(sourceFile, "fetch");
  const requestCalls = findCallsByMethodName(sourceFile, "request");
  return fetchCalls.length + requestCalls.length > 0;
}

function hasMultipleNavigations(sourceFile: ts.SourceFile, framework: Framework): boolean {
  return countNavigationCalls(sourceFile, framework) > 1;
}

function hasSharedState(sourceFile: ts.SourceFile): boolean {
  return findModuleLevelMutableDeclarations(sourceFile).length > 0;
}

function hasTimingAssertions(sourceFile: ts.SourceFile): boolean {
  let found = false;
  walkAst(sourceFile, (node) => {
    if (found) return;
    if (!ts.isCallExpression(node)) return;

    const expr = node.expression;
    if (!ts.isPropertyAccessExpression(expr)) return;

    const method = expr.name.text;

    if (method === "waitForTimeout") {
      found = true;
      return;
    }

    if (method === "setTimeout") {
      found = true;
      return;
    }

    const timingMethods = ["toBeVisible", "toBeHidden", "waitForFunction", "waitForSelector"];
    if (timingMethods.includes(method)) {
      const lastArg = node.arguments[node.arguments.length - 1];
      if (lastArg && ts.isObjectLiteralExpression(lastArg)) {
        for (const prop of lastArg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === "timeout"
          ) {
            found = true;
          }
        }
      }
    }
  });
  return found;
}
