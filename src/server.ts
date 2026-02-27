#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseSourceCode } from "./utils/astParser.js";
import { validateDeterminism } from "./validators/determinism.js";
import { validateArchitecture } from "./validators/architecture.js";
import { scoreFlakeRisk } from "./validators/flakeRisk.js";
import { resolveEnforcement, isValid, DEFAULT_THRESHOLDS } from "./utils/enforcement.js";
import { scanProject } from "./utils/projectScanner.js";
import { DEFAULT_RULES } from "./config/defaultRules.js";
import type { ValidationResult, ArchitectureToolResult } from "./types/guardrail.types.js";

const server = new McpServer({
  name: "ai-test-guardrails",
  version: "0.1.0",
});

const baseInput = {
  testCode: z.string().describe("The test source code to validate"),
  framework: z.enum(["playwright", "cypress"]).describe("The test framework used"),
};

const thresholdInput = {
  mode: z
    .enum(["advisory", "warn", "block"])
    .default("warn")
    .describe(
      "advisory: always passes, reports issues. warn: fails only if thresholds exceeded. block: fails on any violation.",
    ),
  architectureThreshold: z
    .number()
    .int()
    .min(0)
    .default(DEFAULT_THRESHOLDS.architectureThreshold)
    .describe("Max architecture violations before warn mode escalates to REJECTED"),
  flakeRiskThreshold: z
    .number()
    .min(0)
    .max(1)
    .default(DEFAULT_THRESHOLDS.flakeRiskThreshold)
    .describe("Max flake risk score (0-1) before warn mode escalates to REJECTED"),
  determinismThreshold: z
    .number()
    .int()
    .min(0)
    .default(DEFAULT_THRESHOLDS.determinismThreshold)
    .describe("Max determinism violations before warn mode escalates to REJECTED"),
};

const validationInput = { ...baseInput, ...thresholdInput };

server.registerTool(
  "validate_test",
  {
    title: "Validate Test",
    description:
      "Validate an AI-generated test for determinism, flake risk, and architecture compliance. Supports three enforcement modes: advisory (never blocks), warn (threshold-based), block (zero-tolerance). Returns a structured policy report.",
    inputSchema: validationInput,
  },
  async ({
    testCode,
    framework,
    mode,
    architectureThreshold,
    flakeRiskThreshold,
    determinismThreshold,
  }) => {
    const sourceFile = parseSourceCode(testCode);

    const determinism = validateDeterminism(sourceFile, framework, DEFAULT_RULES.determinism);
    const flakeRisk = scoreFlakeRisk(sourceFile, framework, DEFAULT_RULES.flakeRisk);
    const architecture = validateArchitecture(sourceFile, framework, DEFAULT_RULES.architecture);

    const allViolations = [...determinism.violations, ...architecture.violations];

    const thresholds = { architectureThreshold, flakeRiskThreshold, determinismThreshold };
    const policy = resolveEnforcement(
      mode,
      {
        architectureViolations: architecture.violations.length,
        flakeRiskScore: flakeRisk.score,
        determinismViolations: determinism.violations.length,
      },
      thresholds,
    );

    const result: ValidationResult = {
      valid: isValid(policy.action),
      policy,
      determinismScore: determinism.score,
      flakeRiskScore: flakeRisk.score,
      architectureScore: architecture.score,
      violations: allViolations,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  "score_flake_risk",
  {
    title: "Score Flake Risk",
    description:
      "Analyse the flake risk of test code and return a numeric risk score (0-1) with contributing factors.",
    inputSchema: baseInput,
  },
  async ({ testCode, framework }) => {
    const sourceFile = parseSourceCode(testCode);
    const result = scoreFlakeRisk(sourceFile, framework, DEFAULT_RULES.flakeRisk);

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  "enforce_architecture",
  {
    title: "Enforce Architecture",
    description:
      "Check test code for architectural compliance. Supports three enforcement modes with configurable thresholds.",
    inputSchema: validationInput,
  },
  async ({
    testCode,
    framework,
    mode,
    architectureThreshold,
    flakeRiskThreshold,
    determinismThreshold,
  }) => {
    const sourceFile = parseSourceCode(testCode);
    const archResult = validateArchitecture(sourceFile, framework, DEFAULT_RULES.architecture);

    const thresholds = { architectureThreshold, flakeRiskThreshold, determinismThreshold };
    const policy = resolveEnforcement(
      mode,
      {
        architectureViolations: archResult.violations.length,
        flakeRiskScore: 0,
        determinismViolations: 0,
      },
      thresholds,
    );

    const result: ArchitectureToolResult = {
      valid: isValid(policy.action),
      policy,
      score: archResult.score,
      violations: archResult.violations,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  "scan_project",
  {
    title: "Scan Project",
    description:
      "Scan an entire project directory for test files and validate all of them in one pass. Returns an aggregate summary with per-file results, scores, top offenders, and project-wide totals. Supports all three enforcement modes with configurable thresholds.",
    inputSchema: {
      projectPath: z
        .string()
        .describe("Absolute or relative path to the project directory to scan"),
      framework: z.enum(["playwright", "cypress"]).describe("The test framework used"),
      mode: z
        .enum(["advisory", "warn", "block"])
        .default("warn")
        .describe(
          "advisory: always passes, reports issues. warn: fails only if thresholds exceeded. block: fails on any violation.",
        ),
      architectureThreshold: z
        .number()
        .int()
        .min(0)
        .default(DEFAULT_THRESHOLDS.architectureThreshold)
        .describe("Max architecture violations per file before warn mode escalates to REJECTED"),
      flakeRiskThreshold: z
        .number()
        .min(0)
        .max(1)
        .default(DEFAULT_THRESHOLDS.flakeRiskThreshold)
        .describe("Max flake risk score (0-1) per file before warn mode escalates to REJECTED"),
      determinismThreshold: z
        .number()
        .int()
        .min(0)
        .default(DEFAULT_THRESHOLDS.determinismThreshold)
        .describe("Max determinism violations per file before warn mode escalates to REJECTED"),
    },
  },
  async ({
    projectPath,
    framework,
    mode,
    architectureThreshold,
    flakeRiskThreshold,
    determinismThreshold,
  }) => {
    const thresholds = { architectureThreshold, flakeRiskThreshold, determinismThreshold };
    const result = scanProject(projectPath, framework, mode, thresholds);

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
