import ts from "typescript";
import * as helpers from "../utils/astParser.js";
import type {
  CustomRule,
  Framework,
  RuleCategory,
  RuleContext,
  RuleFinding,
  Violation,
} from "../types/guardrail.types.js";

export function buildRuleContext(sourceFile: ts.SourceFile, framework: Framework): RuleContext {
  return { ts, sourceFile, framework, helpers };
}

/**
 * Run every custom rule in the given category against the source file.
 * Returns one violation group per rule so callers can score rules individually.
 */
export function runCustomRules(
  rules: CustomRule[],
  category: RuleCategory,
  sourceFile: ts.SourceFile,
  framework: Framework,
): Violation[][] {
  const applicable = rules.filter((rule) => rule.category === category);
  if (applicable.length === 0) return [];

  const context = buildRuleContext(sourceFile, framework);
  return applicable.map((rule) => runRule(rule, context));
}

function runRule(rule: CustomRule, context: RuleContext): Violation[] {
  let findings: RuleFinding[];
  try {
    findings = rule.check(context);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Custom rule "${rule.name}" threw an error: ${detail}`, { cause: error });
  }

  if (!Array.isArray(findings)) {
    throw new Error(`Custom rule "${rule.name}" must return an array of findings`);
  }

  return findings.map((finding) => toViolation(rule, finding));
}

function toViolation(rule: CustomRule, finding: RuleFinding): Violation {
  const message =
    finding.line !== undefined
      ? `[line ${String(finding.line)}] ${finding.message}`
      : finding.message;
  const violation: Violation = {
    severity: finding.severity ?? rule.severity,
    rule: rule.name,
    message,
  };
  if (finding.suggestion !== undefined) {
    violation.suggestion = finding.suggestion;
  }
  return violation;
}
