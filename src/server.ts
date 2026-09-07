#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./createServer.js";
import { loadRuntimeConfig, CONFIG_ENV_VAR, CONFIG_FILE_NAMES } from "./config/loadConfig.js";
import { PACKAGE_VERSION } from "./version.js";

function printHelp(): void {
  const lines = [
    `ai-test-guardrails ${PACKAGE_VERSION}`,
    "",
    "MCP server providing deterministic guardrails for AI-generated test automation.",
    "Communicates over stdio; start it from your MCP client configuration.",
    "",
    "Usage: ai-test-guardrails [--config <path>]",
    "",
    "Options:",
    "  --config <path>   Path to a config file (.json, .js, .mjs, or .cjs)",
    "  --version, -v     Print the version and exit",
    "  --help, -h        Print this help and exit",
    "",
    `Config discovery: --config, then $${CONFIG_ENV_VAR}, then the first of`,
    ...CONFIG_FILE_NAMES.map((name) => `  ${name}`),
    "in the working directory.",
  ];
  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(PACKAGE_VERSION);
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const runtime = await loadRuntimeConfig({ argv, env: process.env, cwd: process.cwd() });
  if (runtime.configPath !== null) {
    console.error(`ai-test-guardrails: using config ${runtime.configPath}`);
  }

  const server = createServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
