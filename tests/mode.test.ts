import { describe, it, expect } from "vitest";
import { resolveEnforcement, isValid, DEFAULT_THRESHOLDS } from "../src/utils/enforcement.js";
import type { EnforcementThresholds } from "../src/types/guardrail.types.js";

const CLEAN: Parameters<typeof resolveEnforcement>[1] = {
  architectureViolations: 0,
  flakeRiskScore: 0,
  determinismViolations: 0,
};

const MINOR: Parameters<typeof resolveEnforcement>[1] = {
  architectureViolations: 2,
  flakeRiskScore: 0.2,
  determinismViolations: 0,
};

const HEAVY: Parameters<typeof resolveEnforcement>[1] = {
  architectureViolations: 10,
  flakeRiskScore: 0.8,
  determinismViolations: 3,
};

const thresholds: EnforcementThresholds = {
  architectureThreshold: 3,
  flakeRiskThreshold: 0.7,
  determinismThreshold: 0,
};

describe("enforcement: advisory mode", () => {
  it("PASSED when no violations", () => {
    const policy = resolveEnforcement("advisory", CLEAN, thresholds);
    expect(policy.action).toBe("PASSED");
    expect(isValid(policy.action)).toBe(true);
  });

  it("ADVISED when violations exist — never REJECTED", () => {
    const policy = resolveEnforcement("advisory", HEAVY, thresholds);
    expect(policy.action).toBe("ADVISED");
    expect(isValid(policy.action)).toBe(true);
  });

  it("reasons list is empty in advisory mode", () => {
    const policy = resolveEnforcement("advisory", HEAVY, thresholds);
    expect(policy.reasons).toHaveLength(0);
  });
});

describe("enforcement: warn mode", () => {
  it("PASSED when no violations", () => {
    const policy = resolveEnforcement("warn", CLEAN, thresholds);
    expect(policy.action).toBe("PASSED");
    expect(isValid(policy.action)).toBe(true);
  });

  it("WARNED when violations exist but under thresholds", () => {
    const policy = resolveEnforcement("warn", MINOR, thresholds);
    expect(policy.action).toBe("WARNED");
    expect(isValid(policy.action)).toBe(true);
    expect(policy.reasons).toHaveLength(0);
  });

  it("REJECTED when architecture violations exceed threshold", () => {
    const detected = { architectureViolations: 10, flakeRiskScore: 0, determinismViolations: 0 };
    const policy = resolveEnforcement("warn", detected, thresholds);
    expect(policy.action).toBe("REJECTED");
    expect(isValid(policy.action)).toBe(false);
    expect(policy.reasons.some((r) => r.includes("architecture"))).toBe(true);
    expect(policy.reasons.some((r) => r.includes("10"))).toBe(true);
    expect(policy.reasons.some((r) => r.includes("threshold of 3"))).toBe(true);
  });

  it("REJECTED when flake risk exceeds threshold", () => {
    const detected = { architectureViolations: 0, flakeRiskScore: 0.9, determinismViolations: 0 };
    const policy = resolveEnforcement("warn", detected, thresholds);
    expect(policy.action).toBe("REJECTED");
    expect(policy.reasons.some((r) => r.includes("flake risk"))).toBe(true);
    expect(policy.reasons.some((r) => r.includes("0.7"))).toBe(true);
  });

  it("REJECTED when determinism violations exceed threshold", () => {
    const detected = { architectureViolations: 0, flakeRiskScore: 0, determinismViolations: 1 };
    const policy = resolveEnforcement("warn", detected, { ...thresholds, determinismThreshold: 0 });
    expect(policy.action).toBe("REJECTED");
    expect(policy.reasons.some((r) => r.includes("determinism"))).toBe(true);
  });

  it("REJECTED lists all exceeded thresholds", () => {
    const policy = resolveEnforcement("warn", HEAVY, thresholds);
    expect(policy.action).toBe("REJECTED");
    expect(policy.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("reasons list is empty when under threshold", () => {
    const policy = resolveEnforcement("warn", MINOR, thresholds);
    expect(policy.reasons).toHaveLength(0);
  });
});

describe("enforcement: block mode", () => {
  it("PASSED when no violations", () => {
    const policy = resolveEnforcement("block", CLEAN, thresholds);
    expect(policy.action).toBe("PASSED");
    expect(isValid(policy.action)).toBe(true);
  });

  it("REJECTED on any architecture violation", () => {
    const detected = { architectureViolations: 1, flakeRiskScore: 0, determinismViolations: 0 };
    const policy = resolveEnforcement("block", detected, thresholds);
    expect(policy.action).toBe("REJECTED");
    expect(isValid(policy.action)).toBe(false);
  });

  it("REJECTED on any determinism violation", () => {
    const detected = { architectureViolations: 0, flakeRiskScore: 0, determinismViolations: 1 };
    const policy = resolveEnforcement("block", detected, thresholds);
    expect(policy.action).toBe("REJECTED");
  });

  it("REJECTED on any flake risk", () => {
    const detected = { architectureViolations: 0, flakeRiskScore: 0.1, determinismViolations: 0 };
    const policy = resolveEnforcement("block", detected, thresholds);
    expect(policy.action).toBe("REJECTED");
  });

  it("reasons explain the block policy clearly", () => {
    const policy = resolveEnforcement("block", HEAVY, thresholds);
    expect(policy.reasons.length).toBeGreaterThan(0);
    expect(policy.reasons.some((r) => r.includes("block mode"))).toBe(true);
  });
});

describe("enforcement: policy output structure", () => {
  it("always includes mode, thresholds, detected, action, reasons", () => {
    const policy = resolveEnforcement("warn", MINOR, thresholds);
    expect(policy).toHaveProperty("mode", "warn");
    expect(policy).toHaveProperty("thresholds");
    expect(policy).toHaveProperty("detected");
    expect(policy).toHaveProperty("action");
    expect(policy).toHaveProperty("reasons");
  });

  it("detected reflects the passed-in counts", () => {
    const policy = resolveEnforcement("warn", HEAVY, thresholds);
    expect(policy.detected.architectureViolations).toBe(10);
    expect(policy.detected.flakeRiskScore).toBe(0.8);
    expect(policy.detected.determinismViolations).toBe(3);
  });

  it("thresholds reflect the passed-in config", () => {
    const custom: EnforcementThresholds = {
      architectureThreshold: 5,
      flakeRiskThreshold: 0.5,
      determinismThreshold: 2,
    };
    const policy = resolveEnforcement("warn", MINOR, custom);
    expect(policy.thresholds).toEqual(custom);
  });

  it("DEFAULT_THRESHOLDS are sensible values", () => {
    expect(DEFAULT_THRESHOLDS.architectureThreshold).toBe(3);
    expect(DEFAULT_THRESHOLDS.flakeRiskThreshold).toBe(0.7);
    expect(DEFAULT_THRESHOLDS.determinismThreshold).toBe(0);
  });
});

describe("isValid helper", () => {
  it("PASSED is valid", () => expect(isValid("PASSED")).toBe(true));
  it("ADVISED is valid", () => expect(isValid("ADVISED")).toBe(true));
  it("WARNED is valid", () => expect(isValid("WARNED")).toBe(true));
  it("REJECTED is not valid", () => expect(isValid("REJECTED")).toBe(false));
});
