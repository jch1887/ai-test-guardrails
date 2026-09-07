import ts from "typescript";
import type { Framework, FlakeRiskFactor, FlakeRiskResult } from "../types/guardrail.types.js";
import type { FlakeRiskWeightConfig } from "../config/defaultRules.js";
import {
  countAwaitExpressions,
  countNavigationCalls,
  findCallsByMethodName,
  findModuleLevelMutableDeclarations,
  isTimeoutConfigurationCall,
  walkAst,
} from "../utils/astParser.js";

const ASYNC_HEAVY_THRESHOLD = 5;

export function scoreFlakeRisk(
  sourceFile: ts.SourceFile,
  framework: Framework,
  config: FlakeRiskWeightConfig,
): FlakeRiskResult {
  const remediation = remediationFor(framework);

  const factors: FlakeRiskFactor[] = [
    {
      name: "async-heavy",
      weight: config.asyncHeavyWeight,
      detected: isAsyncHeavy(sourceFile),
      description: "High number of async operations increases timing sensitivity",
      remediation: remediation.asyncHeavy,
    },
    {
      name: "network-dependency",
      weight: config.networkDependencyWeight,
      detected: hasNetworkDependency(sourceFile),
      description: "Network calls without mocking create external dependencies",
      remediation: remediation.networkDependency,
    },
    {
      name: "multiple-navigations",
      weight: config.multipleNavigationsWeight,
      detected: hasMultipleNavigations(sourceFile, framework),
      description: "Multiple navigation steps increase page load timing variability",
      remediation: remediation.multipleNavigations,
    },
    {
      name: "shared-state",
      weight: config.sharedStateWeight,
      detected: hasSharedState(sourceFile),
      description: "Module-level mutable state can leak between tests",
      remediation: remediation.sharedState,
    },
    {
      name: "timing-assertions",
      weight: config.timingAssertionsWeight,
      detected: hasTimingAssertions(sourceFile),
      description: "Timing-dependent assertions are sensitive to execution speed",
      remediation: remediation.timingAssertions,
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

interface FactorRemediation {
  asyncHeavy: string;
  networkDependency: string;
  multipleNavigations: string;
  sharedState: string;
  timingAssertions: string;
}

function remediationFor(framework: Framework): FactorRemediation {
  if (framework === "playwright") {
    return {
      asyncHeavy: `Split the test so each case covers one flow with at most ${String(ASYNC_HEAVY_THRESHOLD)} awaits, and move shared setup into test.beforeEach or a fixture.`,
      networkDependency:
        "Mock the request with page.route('**/api/**', (route) => route.fulfill({ json: mockResponse })) or use a request fixture so the test does not depend on a live service.",
      multipleNavigations:
        "Start each test at the page under test using baseURL and a single page.goto(); cover the other pages in their own tests.",
      sharedState:
        "Replace module-level let/var with const, or create the value inside test.beforeEach so every test starts from a fresh state.",
      timingAssertions:
        "Remove waitForTimeout and explicit timeout options; rely on auto-retrying assertions such as await expect(locator).toBeVisible().",
    };
  }
  return {
    asyncHeavy: `Split the test so each case covers one flow with at most ${String(ASYNC_HEAVY_THRESHOLD)} awaits, and move shared setup into beforeEach.`,
    networkDependency:
      "Stub the request with cy.intercept('GET', '/api/**', { fixture: 'response.json' }).as('api') and wait on the alias instead of calling the live service.",
    multipleNavigations:
      "Start each test at the page under test with a single cy.visit(); cover the other pages in their own tests.",
    sharedState:
      "Replace module-level let/var with const, or create the value inside beforeEach so every test starts from a fresh state.",
    timingAssertions:
      "Remove cy.wait(ms) and explicit timeout options; rely on retrying assertions such as cy.get('[data-cy=result]').should('be.visible').",
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

    if (method === "setTimeout" && !isTimeoutConfigurationCall(node)) {
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
