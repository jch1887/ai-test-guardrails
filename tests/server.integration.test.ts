import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PACKAGE_VERSION } from "../src/version.js";
import type { ProjectScanSummary, ValidationResult } from "../src/types/guardrail.types.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

interface TextResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
}

// A typed JSON helper: the caller names the payload shape it expects to assert on.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function parseText<T>(result: unknown): T {
  const { content } = result as TextResult;
  const text = content[0]?.text;
  if (text === undefined) throw new Error("tool returned no text content");
  return JSON.parse(text) as T;
}

const PLUGIN = `
export default {
  name: "integration-plugin",
  rules: [{
    name: "no-console-log",
    category: "architecture",
    severity: "minor",
    check: ({ sourceFile, helpers }) =>
      helpers.findPropertyAccessCalls(sourceFile, "console", "log").map((call) => ({
        message: "console.log() in test code",
        line: helpers.getLineNumber(call, sourceFile),
        suggestion: "Remove it",
      })),
  }],
};
`;

let tmpDir: string;
let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  // realpath so comparisons work on macOS, where the temp dir lives behind a /private symlink.
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guardrails-integration-")));
  fs.writeFileSync(path.join(tmpDir, "plugin.mjs"), PLUGIN);
  fs.writeFileSync(
    path.join(tmpDir, "ai-test-guardrails.config.json"),
    JSON.stringify({
      thresholds: { architectureThreshold: 9 },
      plugins: ["./plugin.mjs"],
      scan: { allowedRoots: ["."], ignore: ["ignored"] },
    }),
  );
  fs.mkdirSync(path.join(tmpDir, "e2e"));
  fs.mkdirSync(path.join(tmpDir, "ignored"));
  fs.writeFileSync(
    path.join(tmpDir, "ignored", "skip.spec.ts"),
    `import { test } from '@playwright/test';\ntest('skip', async () => {});\n`,
  );
  fs.writeFileSync(
    path.join(tmpDir, "e2e", "a.spec.ts"),
    `import { test } from '@playwright/test';\ntest('a', async ({ page }) => { await page.waitForTimeout(5); });\n`,
  );

  // The child runs from tmpDir, so "tsx" must be an absolute path rather than a bare specifier.
  const tsxLoader = pathToFileURL(
    path.join(ROOT, "node_modules", "tsx", "dist", "loader.mjs"),
  ).href;
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", tsxLoader, path.join(ROOT, "src", "server.ts")],
    cwd: tmpDir,
    stderr: "pipe",
  });
  client = new Client({ name: "integration-test", version: "0.0.0" });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("MCP server over stdio", () => {
  it("reports the package version", () => {
    expect(client.getServerVersion()?.name).toBe("ai-test-guardrails");
    expect(client.getServerVersion()?.version).toBe(PACKAGE_VERSION);
  });

  it("exposes the six public tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "enforce_architecture",
      "get_config",
      "get_flake_history",
      "scan_project",
      "score_flake_risk",
      "validate_test",
    ]);
  });

  it("get_config shows the discovered config file and plugin", async () => {
    const config = parseText<{
      configPath: string;
      plugins: string[];
      thresholds: { architectureThreshold: number };
      customRules: { name: string }[];
    }>(await client.callTool({ name: "get_config", arguments: {} }));
    expect(config.configPath).toBe(path.join(tmpDir, "ai-test-guardrails.config.json"));
    expect(config.plugins).toEqual(["integration-plugin"]);
    expect(config.thresholds.architectureThreshold).toBe(9);
    expect(config.customRules.map((r) => r.name)).toEqual(["no-console-log"]);
  });

  it("validate_test returns violations with suggestions and runs custom rules", async () => {
    const result = parseText<ValidationResult>(
      await client.callTool({
        name: "validate_test",
        arguments: {
          testCode:
            "test('x', async ({ page }) => { console.log('hi'); await page.waitForTimeout(1); });",
          framework: "playwright",
          mode: "advisory",
        },
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.policy.action).toBe("ADVISED");
    expect(result.policy.thresholds.architectureThreshold).toBe(9);
    const rules = result.violations.map((v) => v.rule);
    expect(rules).toContain("no-wait-for-timeout");
    expect(rules).toContain("no-console-log");
    expect(result.violations.every((v) => typeof v.suggestion === "string")).toBe(true);
  });

  it("validate_test rejects unsupported frameworks gracefully", async () => {
    const result = parseText<{ supported: boolean; detectedFramework: string; message: string }>(
      await client.callTool({
        name: "validate_test",
        arguments: { testCode: "import http from 'k6/http';", framework: "playwright" },
      }),
    );
    expect(result.supported).toBe(false);
    expect(result.detectedFramework).toBe("k6");
    expect(result.message).not.toMatch(/v\d/);
  });

  it("scan_project writes an artefact and records history, and get_flake_history reads it back", async () => {
    const outputPath = path.join(tmpDir, "out", "scan.json");
    const historyPath = path.join(tmpDir, "out", "history.json");
    const args = {
      projectPath: tmpDir,
      framework: "playwright",
      mode: "warn",
      outputPath,
      historyPath,
    };

    const first = parseText<ProjectScanSummary>(
      await client.callTool({ name: "scan_project", arguments: args }),
    );
    expect(first.totals.files).toBe(1);
    expect(first.outputPath).toBe(outputPath);
    expect(first.history?.entriesRecorded).toBe(1);
    expect(fs.existsSync(outputPath)).toBe(true);

    const second = parseText<ProjectScanSummary>(
      await client.callTool({ name: "scan_project", arguments: args }),
    );
    expect(second.history?.entriesRecorded).toBe(2);
    expect(second.history?.deltas?.totalViolations).toBe(0);

    const history = parseText<{ entries: number; series: unknown[]; file?: { series: unknown[] } }>(
      await client.callTool({
        name: "get_flake_history",
        arguments: { historyPath, file: path.join("e2e", "a.spec.ts") },
      }),
    );
    expect(history.entries).toBe(2);
    expect(history.series).toHaveLength(2);
    expect(history.file?.series).toHaveLength(2);
  });

  it("applies scan.ignore from the config and the ignore parameter", async () => {
    const base = { projectPath: tmpDir, framework: "playwright", mode: "advisory" };
    const withConfigIgnore = parseText<ProjectScanSummary>(
      await client.callTool({ name: "scan_project", arguments: base }),
    );
    expect(withConfigIgnore.files.map((f) => f.file)).toEqual([path.join("e2e", "a.spec.ts")]);

    const withParamIgnore = parseText<ProjectScanSummary>(
      await client.callTool({ name: "scan_project", arguments: { ...base, ignore: ["e2e/**"] } }),
    );
    expect(withParamIgnore.totals.files).toBe(0);
  });

  it("rejects paths outside scan.allowedRoots", async () => {
    const outside = path.dirname(tmpDir);
    const scan = (await client.callTool({
      name: "scan_project",
      arguments: { projectPath: outside, framework: "playwright" },
    })) as TextResult;
    expect(scan.isError).toBe(true);
    expect(scan.content[0]?.text).toMatch(/projectPath .* is outside the allowed roots/);

    const artefact = (await client.callTool({
      name: "scan_project",
      arguments: {
        projectPath: tmpDir,
        framework: "playwright",
        outputPath: path.join(outside, "x.json"),
      },
    })) as TextResult;
    expect(artefact.isError).toBe(true);
    expect(artefact.content[0]?.text).toMatch(/outputPath/);

    const history = (await client.callTool({
      name: "get_flake_history",
      arguments: { historyPath: path.join(outside, "h.json") },
    })) as TextResult;
    expect(history.isError).toBe(true);
  });

  it("get_config reports the scan policy", async () => {
    const config = parseText<{ scan: { allowedRoots: string[]; ignore: string[] } }>(
      await client.callTool({ name: "get_config", arguments: {} }),
    );
    expect(config.scan).toEqual({ allowedRoots: [tmpDir], ignore: ["ignored"] });
  });

  it("surfaces an error when a history file is malformed", async () => {
    const bad = path.join(tmpDir, "bad-history.json");
    fs.writeFileSync(bad, "not json");
    const result = (await client.callTool({
      name: "get_flake_history",
      arguments: { historyPath: bad },
    })) as TextResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not valid JSON/);
  });
});
