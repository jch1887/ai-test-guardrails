import type {
  ValidationMode,
  EnforcementAction,
  EnforcementPolicy,
  EnforcementThresholds,
} from "../types/guardrail.types.js";

export const DEFAULT_THRESHOLDS: EnforcementThresholds = {
  architectureThreshold: 3,
  flakeRiskThreshold: 0.7,
  determinismThreshold: 0,
};

interface DetectedCounts {
  architectureViolations: number;
  flakeRiskScore: number;
  determinismViolations: number;
}

export function resolveEnforcement(
  mode: ValidationMode,
  detected: DetectedCounts,
  thresholds: EnforcementThresholds,
): EnforcementPolicy {
  const reasons: string[] = [];
  let action: EnforcementAction;

  const hasAnyViolation =
    detected.architectureViolations > 0 ||
    detected.determinismViolations > 0 ||
    detected.flakeRiskScore > 0;

  if (mode === "advisory") {
    action = hasAnyViolation ? "ADVISED" : "PASSED";
  } else if (mode === "warn") {
    const exceedances = getThresholdExceedances(detected, thresholds, reasons);
    action = exceedances > 0 ? "REJECTED" : hasAnyViolation ? "WARNED" : "PASSED";
  } else {
    if (detected.architectureViolations > 0) {
      reasons.push(
        `${detected.architectureViolations} architecture violation${detected.architectureViolations === 1 ? "" : "s"} (threshold: 0 in block mode)`,
      );
    }
    if (detected.determinismViolations > 0) {
      reasons.push(
        `${detected.determinismViolations} determinism violation${detected.determinismViolations === 1 ? "" : "s"} (threshold: 0 in block mode)`,
      );
    }
    if (detected.flakeRiskScore > 0) {
      reasons.push(
        `flake risk score ${detected.flakeRiskScore.toFixed(2)} exceeds 0 (threshold: 0 in block mode)`,
      );
    }
    action = reasons.length > 0 ? "REJECTED" : "PASSED";
  }

  return {
    mode,
    thresholds,
    detected,
    action,
    reasons,
  };
}

function getThresholdExceedances(
  detected: DetectedCounts,
  thresholds: EnforcementThresholds,
  reasons: string[],
): number {
  let count = 0;

  if (detected.architectureViolations > thresholds.architectureThreshold) {
    count++;
    reasons.push(
      `${detected.architectureViolations} architecture violations exceeded threshold of ${thresholds.architectureThreshold}`,
    );
  }

  if (detected.determinismViolations > thresholds.determinismThreshold) {
    count++;
    reasons.push(
      `${detected.determinismViolations} determinism violations exceeded threshold of ${thresholds.determinismThreshold}`,
    );
  }

  if (detected.flakeRiskScore > thresholds.flakeRiskThreshold) {
    count++;
    reasons.push(
      `flake risk score ${detected.flakeRiskScore.toFixed(2)} exceeded threshold of ${thresholds.flakeRiskThreshold}`,
    );
  }

  return count;
}

export function isValid(action: EnforcementAction): boolean {
  return action === "PASSED" || action === "ADVISED" || action === "WARNED";
}
