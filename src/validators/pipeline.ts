import type ts from "typescript";
import type {
  CustomRule,
  EnforcementThresholds,
  Framework,
  ValidationMode,
  ValidationResult,
} from "../types/guardrail.types.js";
import type { RuleConfig } from "../config/defaultRules.js";
import { DEFAULT_RULES } from "../config/defaultRules.js";
import { validateDeterminism } from "./determinism.js";
import { validateArchitecture } from "./architecture.js";
import { scoreFlakeRisk } from "./flakeRisk.js";
import { resolveEnforcement, isValid } from "../utils/enforcement.js";

export interface ValidationOptions {
  rules?: RuleConfig;
  customRules?: CustomRule[];
}

/**
 * Run every validator against a parsed source file and resolve the enforcement policy.
 * This is the single pipeline shared by the MCP tools and the project scanner.
 */
export function validateSource(
  sourceFile: ts.SourceFile,
  framework: Framework,
  mode: ValidationMode,
  thresholds: EnforcementThresholds,
  options: ValidationOptions = {},
): ValidationResult {
  const rules = options.rules ?? DEFAULT_RULES;
  const customRules = options.customRules ?? [];

  const determinism = validateDeterminism(sourceFile, framework, rules.determinism, customRules);
  const flakeRisk = scoreFlakeRisk(sourceFile, framework, rules.flakeRisk);
  const architecture = validateArchitecture(sourceFile, framework, rules.architecture, customRules);

  const violations = [...determinism.violations, ...architecture.violations];

  const policy = resolveEnforcement(
    mode,
    {
      architectureViolations: architecture.violations.length,
      flakeRiskScore: flakeRisk.score,
      determinismViolations: determinism.violations.length,
    },
    thresholds,
    violations,
  );

  return {
    valid: isValid(policy.action),
    policy,
    determinismScore: determinism.score,
    flakeRiskScore: flakeRisk.score,
    architectureScore: architecture.score,
    violations,
  };
}
