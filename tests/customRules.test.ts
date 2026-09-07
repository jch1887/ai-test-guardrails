import { describe, it, expect } from "vitest";
import { parseSourceCode } from "../src/utils/astParser.js";
import { validateDeterminism } from "../src/validators/determinism.js";
import { validateArchitecture } from "../src/validators/architecture.js";
import { runCustomRules, buildRuleContext } from "../src/validators/customRules.js";
import { validateSource } from "../src/validators/pipeline.js";
import { DEFAULT_THRESHOLDS } from "../src/utils/enforcement.js";
import { DEFAULT_RULES } from "../src/config/defaultRules.js";
import type { CustomRule } from "../src/types/guardrail.types.js";

const noConsoleLog: CustomRule = {
  name: "no-console-log",
  category: "architecture",
  severity: "minor",
  description: "console.log leaves noise in CI output",
  check: ({ sourceFile, helpers }) =>
    helpers.findPropertyAccessCalls(sourceFile, "console", "log").map((call) => ({
      message: "console.log() in test code",
      line: helpers.getLineNumber(call, sourceFile),
      suggestion: "Remove the console.log or use the test reporter",
    })),
};

const noDateNow: CustomRule = {
  name: "no-date-now",
  category: "determinism",
  severity: "major",
  check: ({ ts, sourceFile, helpers }) => {
    const findings: { message: string; line: number }[] = [];
    helpers.walkAst(sourceFile, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Date" &&
        node.expression.name.text === "now"
      ) {
        findings.push({
          message: "Date.now() is non-deterministic",
          line: helpers.getLineNumber(node, sourceFile),
        });
      }
    });
    return findings;
  },
};

const CODE = `
test('x', async () => {
  console.log('hello');
  const t = Date.now();
});
`;

describe("custom rules", () => {
  it("buildRuleContext exposes ts, sourceFile, framework, and helpers", () => {
    const ctx = buildRuleContext(parseSourceCode(CODE), "playwright");
    expect(ctx.framework).toBe("playwright");
    expect(typeof ctx.ts.isCallExpression).toBe("function");
    expect(typeof ctx.helpers.findCallsByMethodName).toBe("function");
    expect(ctx.sourceFile.statements.length).toBeGreaterThan(0);
  });

  it("runCustomRules only runs rules for the requested category", () => {
    const sf = parseSourceCode(CODE);
    const arch = runCustomRules([noConsoleLog, noDateNow], "architecture", sf, "playwright");
    const det = runCustomRules([noConsoleLog, noDateNow], "determinism", sf, "playwright");
    expect(arch).toHaveLength(1);
    expect(arch[0]?.[0]?.rule).toBe("no-console-log");
    expect(det).toHaveLength(1);
    expect(det[0]?.[0]?.rule).toBe("no-date-now");
  });

  it("prefixes the line number and carries the suggestion and default severity", () => {
    const sf = parseSourceCode(CODE);
    const [group] = runCustomRules([noConsoleLog], "architecture", sf, "playwright");
    const v = group?.[0];
    expect(v?.message).toMatch(/^\[line 3\] console\.log/);
    expect(v?.severity).toBe("minor");
    expect(v?.suggestion).toContain("Remove the console.log");
  });

  it("allows a finding to override severity", () => {
    const rule: CustomRule = {
      ...noConsoleLog,
      check: () => [{ message: "x", severity: "critical" }],
    };
    const [group] = runCustomRules([rule], "architecture", parseSourceCode(CODE), "playwright");
    expect(group?.[0]?.severity).toBe("critical");
    expect(group?.[0]?.message).toBe("x");
  });

  it("wraps errors thrown by a rule with the rule name", () => {
    const broken: CustomRule = {
      name: "broken",
      category: "architecture",
      severity: "minor",
      check: () => {
        throw new Error("boom");
      },
    };
    expect(() =>
      runCustomRules([broken], "architecture", parseSourceCode(CODE), "playwright"),
    ).toThrow(/Custom rule "broken" threw an error: boom/);
  });

  it("rejects rules that do not return an array", () => {
    const bad = { ...noConsoleLog, check: () => undefined } as unknown as CustomRule;
    expect(() =>
      runCustomRules([bad], "architecture", parseSourceCode(CODE), "playwright"),
    ).toThrow(/must return an array/);
  });

  it("custom architecture rules count toward the architecture score", () => {
    const sf = parseSourceCode(CODE);
    const without = validateArchitecture(sf, "playwright", DEFAULT_RULES.architecture);
    const withRule = validateArchitecture(sf, "playwright", DEFAULT_RULES.architecture, [
      noConsoleLog,
    ]);
    expect(without.score).toBe(1);
    expect(withRule.score).toBeCloseTo(6 / 7);
    expect(withRule.violations.some((v) => v.rule === "no-console-log")).toBe(true);
  });

  it("custom determinism rules count toward the determinism score", () => {
    const sf = parseSourceCode(CODE);
    const without = validateDeterminism(sf, "playwright", DEFAULT_RULES.determinism);
    const withRule = validateDeterminism(sf, "playwright", DEFAULT_RULES.determinism, [noDateNow]);
    expect(without.score).toBe(1);
    expect(withRule.score).toBeCloseTo(6 / 7);
  });

  it("validateSource feeds custom violations into the enforcement policy", () => {
    const result = validateSource(parseSourceCode(CODE), "playwright", "warn", DEFAULT_THRESHOLDS, {
      customRules: [noConsoleLog, noDateNow],
    });
    expect(result.policy.detected.architectureViolations).toBe(1);
    expect(result.policy.detected.determinismViolations).toBe(1);
    expect(result.policy.action).toBe("REJECTED");
    expect(result.policy.reasons.some((r) => r.includes("determinism"))).toBe(true);
  });
});
