import type ts from "typescript";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { parseSourceCode } from "./utils/astParser.js";
import { validateArchitecture } from "./validators/architecture.js";
import { scoreFlakeRisk } from "./validators/flakeRisk.js";
import { validateSource } from "./validators/pipeline.js";
import { resolveEnforcement, isValid } from "./utils/enforcement.js";
import { detectFrameworkFromSource } from "./utils/frameworkDetector.js";
import { scanProject } from "./utils/projectScanner.js";
import { summarizeHistory } from "./utils/scanHistory.js";
import { assertWithinAllowedRoots } from "./utils/scanPolicy.js";
import { PACKAGE_VERSION } from "./version.js";
import type { RuntimeConfig } from "./config/loadConfig.js";
import type {
  Framework,
  ArchitectureToolResult,
  UnsupportedFrameworkResult,
} from "./types/guardrail.types.js";

export const SUPPORTED_FRAMEWORKS: Framework[] = ["playwright", "cypress"];

function jsonResponse(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

/**
 * Returns a graceful rejection payload when the source imports a framework this
 * server does not support (for example k6). Returns null when validation may proceed.
 */
export function checkUnsupportedFramework(
  sourceFile: ts.SourceFile,
): UnsupportedFrameworkResult | null {
  const detection = detectFrameworkFromSource(sourceFile);
  if (detection.isSupported || detection.detected === null) {
    return null;
  }
  return {
    supported: false,
    detectedFramework: detection.detected,
    message: `Framework "${detection.detected}" is not supported by ai-test-guardrails. Supported frameworks: ${SUPPORTED_FRAMEWORKS.join(", ")}.`,
    supportedFrameworks: SUPPORTED_FRAMEWORKS,
  };
}

const MODE_DESCRIPTION =
  "advisory: always passes, reports issues. warn: fails only if thresholds exceeded. block: fails on any violation.";

/**
 * Template whose static type describes the threshold input shape. Defaults and
 * descriptions are replaced per server, which does not change the zod types.
 */
const THRESHOLD_TEMPLATE = {
  mode: z.enum(["advisory", "warn", "block"]).default("warn"),
  architectureThreshold: z.number().int().min(0).default(0),
  flakeRiskThreshold: z.number().min(0).max(1).default(0),
  determinismThreshold: z.number().int().min(0).default(0),
};

type ThresholdInput = typeof THRESHOLD_TEMPLATE;

function buildThresholdInput(runtime: RuntimeConfig, scope: string): ThresholdInput {
  return {
    mode: THRESHOLD_TEMPLATE.mode.describe(MODE_DESCRIPTION),
    architectureThreshold: z
      .number()
      .int()
      .min(0)
      .default(runtime.thresholds.architectureThreshold)
      .describe(`Max architecture violations${scope} before warn mode escalates to REJECTED`),
    flakeRiskThreshold: z
      .number()
      .min(0)
      .max(1)
      .default(runtime.thresholds.flakeRiskThreshold)
      .describe(`Max flake risk score (0-1)${scope} before warn mode escalates to REJECTED`),
    determinismThreshold: z
      .number()
      .int()
      .min(0)
      .default(runtime.thresholds.determinismThreshold)
      .describe(`Max determinism violations${scope} before warn mode escalates to REJECTED`),
  };
}

/**
 * Build the MCP server with every tool registered against the given runtime config.
 * The caller is responsible for connecting a transport.
 */
export function createServer(runtime: RuntimeConfig): McpServer {
  const server = new McpServer({
    name: "ai-test-guardrails",
    version: PACKAGE_VERSION,
  });

  const validationOptions = { rules: runtime.rules, customRules: runtime.customRules };

  const baseInput = {
    testCode: z.string().describe("The test source code to validate"),
    framework: z.enum(["playwright", "cypress"]).describe("The test framework used"),
  };

  const validationInput = { ...baseInput, ...buildThresholdInput(runtime, "") };

  server.registerTool(
    "validate_test",
    {
      title: "Validate Test",
      description:
        "Validate an AI-generated test for determinism, flake risk, and architecture compliance. Supports three enforcement modes: advisory (never blocks), warn (threshold-based), block (zero-tolerance). Returns a structured policy report with severity-classified violations, each carrying a suggested fix.",
      inputSchema: validationInput,
    },
    ({
      testCode,
      framework,
      mode,
      architectureThreshold,
      flakeRiskThreshold,
      determinismThreshold,
    }) => {
      const sourceFile = parseSourceCode(testCode);

      const unsupported = checkUnsupportedFramework(sourceFile);
      if (unsupported) {
        return jsonResponse(unsupported);
      }

      const thresholds = { architectureThreshold, flakeRiskThreshold, determinismThreshold };
      const result = validateSource(sourceFile, framework, mode, thresholds, validationOptions);

      return jsonResponse(result);
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
    ({ testCode, framework }) => {
      const sourceFile = parseSourceCode(testCode);

      const unsupported = checkUnsupportedFramework(sourceFile);
      if (unsupported) {
        return jsonResponse(unsupported);
      }

      const result = scoreFlakeRisk(sourceFile, framework, runtime.rules.flakeRisk);

      return jsonResponse(result);
    },
  );

  server.registerTool(
    "enforce_architecture",
    {
      title: "Enforce Architecture",
      description:
        "Check test code for architectural compliance. Supports three enforcement modes with configurable thresholds. Violations are severity-classified (critical/major/minor) and carry a suggested fix.",
      inputSchema: validationInput,
    },
    ({
      testCode,
      framework,
      mode,
      architectureThreshold,
      flakeRiskThreshold,
      determinismThreshold,
    }) => {
      const sourceFile = parseSourceCode(testCode);

      const unsupported = checkUnsupportedFramework(sourceFile);
      if (unsupported) {
        return jsonResponse(unsupported);
      }

      const archResult = validateArchitecture(
        sourceFile,
        framework,
        runtime.rules.architecture,
        runtime.customRules,
      );

      const thresholds = { architectureThreshold, flakeRiskThreshold, determinismThreshold };
      const policy = resolveEnforcement(
        mode,
        {
          architectureViolations: archResult.violations.length,
          flakeRiskScore: 0,
          determinismViolations: 0,
        },
        thresholds,
        archResult.violations,
      );

      const result: ArchitectureToolResult = {
        valid: isValid(policy.action),
        policy,
        score: archResult.score,
        violations: archResult.violations,
      };

      return jsonResponse(result);
    },
  );

  server.registerTool(
    "scan_project",
    {
      title: "Scan Project",
      description:
        "Scan an entire project directory for test files and validate all of them in one pass. Returns an aggregate summary with per-file results, severity breakdown (critical/major/minor), top offenders, and project-wide totals. Optionally writes the summary to a JSON artefact and records the scan in a history file for trend tracking.",
      inputSchema: {
        projectPath: z
          .string()
          .describe("Absolute or relative path to the project directory to scan"),
        framework: z.enum(["playwright", "cypress"]).describe("The test framework used"),
        ...buildThresholdInput(runtime, " per file"),
        outputPath: z
          .string()
          .optional()
          .describe(
            "Optional path of a JSON file to write the full scan summary to (for CI artefacts). Parent directories are created.",
          ),
        historyPath: z
          .string()
          .optional()
          .describe(
            "Optional path of a JSON history file. The scan is appended and the response includes deltas and per-file flake regressions against the previous scan.",
          ),
        ignore: z
          .array(z.string().min(1))
          .optional()
          .describe(
            "Optional gitignore-style globs, relative to projectPath, to skip (for example fixtures/** or *.generated.ts). Combined with scan.ignore from the config file.",
          ),
      },
    },
    ({
      projectPath,
      framework,
      mode,
      architectureThreshold,
      flakeRiskThreshold,
      determinismThreshold,
      outputPath,
      historyPath,
      ignore,
    }) => {
      const roots = runtime.scan.allowedRoots;
      const resolvedProject = assertWithinAllowedRoots(projectPath, roots, "projectPath");
      const resolvedOutput =
        outputPath === undefined
          ? undefined
          : assertWithinAllowedRoots(outputPath, roots, "outputPath");
      const resolvedHistory =
        historyPath === undefined
          ? undefined
          : assertWithinAllowedRoots(historyPath, roots, "historyPath");

      const thresholds = { architectureThreshold, flakeRiskThreshold, determinismThreshold };
      const result = scanProject(resolvedProject, framework, mode, thresholds, {
        ...validationOptions,
        outputPath: resolvedOutput,
        historyPath: resolvedHistory,
        ignore: [...runtime.scan.ignore, ...(ignore ?? [])],
      });

      return jsonResponse(result);
    },
  );

  server.registerTool(
    "get_flake_history",
    {
      title: "Get Flake History",
      description:
        "Read a scan history file written by scan_project and return project-wide score trends over time, optionally with the per-file series for one test file.",
      inputSchema: {
        historyPath: z.string().describe("Path of the JSON history file written by scan_project"),
        file: z
          .string()
          .optional()
          .describe("Project-relative path of a test file to return the per-file series for"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of most recent scans to include (default 50)"),
      },
    },
    ({ historyPath, file, limit }) => {
      const resolved = assertWithinAllowedRoots(
        historyPath,
        runtime.scan.allowedRoots,
        "historyPath",
      );
      return jsonResponse(summarizeHistory(resolved, { file, limit }));
    },
  );

  server.registerTool(
    "get_config",
    {
      title: "Get Config",
      description:
        "Return the active configuration: server version, config file in use, rule settings, default thresholds, scan path policy, and loaded custom rules.",
      inputSchema: {},
    },
    () => {
      return jsonResponse({
        version: PACKAGE_VERSION,
        configPath: runtime.configPath,
        supportedFrameworks: SUPPORTED_FRAMEWORKS,
        rules: runtime.rules,
        thresholds: runtime.thresholds,
        plugins: runtime.plugins,
        scan: runtime.scan,
        customRules: runtime.customRules.map((rule) => ({
          name: rule.name,
          category: rule.category,
          severity: rule.severity,
          description: rule.description ?? null,
        })),
      });
    },
  );

  return server;
}
