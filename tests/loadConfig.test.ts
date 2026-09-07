import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  CONFIG_ENV_VAR,
  defineConfig,
  loadConfigFile,
  loadPlugins,
  loadRuntimeConfig,
  mergeRules,
  mergeThresholds,
  parseConfig,
  readArgvOption,
  resolveConfigPath,
} from "../src/config/loadConfig.js";
import { DEFAULT_RULES } from "../src/config/defaultRules.js";
import { DEFAULT_THRESHOLDS } from "../src/utils/enforcement.js";

let tmpDir: string;

const PLUGIN_SOURCE = `
export default {
  name: "example-plugin",
  rules: [
    {
      name: "no-console-log",
      category: "architecture",
      severity: "minor",
      check: ({ sourceFile, helpers }) =>
        helpers.findPropertyAccessCalls(sourceFile, "console", "log").map((call) => ({
          message: "console.log() in test code",
          line: helpers.getLineNumber(call, sourceFile),
        })),
    },
  ],
};
`;

const RULES_ONLY_PLUGIN_SOURCE = `
export const rules = [
  { name: "rules-only", category: "determinism", severity: "major", check: () => [] },
];
`;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardrails-config-"));
  fs.writeFileSync(path.join(tmpDir, "plugin.mjs"), PLUGIN_SOURCE);
  fs.writeFileSync(path.join(tmpDir, "rules-only.mjs"), RULES_ONLY_PLUGIN_SOURCE);
  fs.writeFileSync(
    path.join(tmpDir, "guardrails.json"),
    JSON.stringify({
      thresholds: { architectureThreshold: 5 },
      rules: { architecture: { maxDescribeDepth: 3 }, determinism: { detectHardSleeps: false } },
      plugins: ["./plugin.mjs"],
    }),
  );
  fs.writeFileSync(
    path.join(tmpDir, "guardrails.mjs"),
    `export default { thresholds: { flakeRiskThreshold: 0.5 }, plugins: ["./rules-only.mjs"] };`,
  );
  fs.writeFileSync(path.join(tmpDir, "broken.json"), "{ not json");
  fs.writeFileSync(path.join(tmpDir, "invalid.json"), JSON.stringify({ rules: { nope: true } }));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("readArgvOption", () => {
  it("reads --name value form", () => {
    expect(readArgvOption(["--config", "a.json"], "--config")).toBe("a.json");
  });
  it("reads --name=value form", () => {
    expect(readArgvOption(["--config=b.json"], "--config")).toBe("b.json");
  });
  it("returns undefined when absent", () => {
    expect(readArgvOption(["--other"], "--config")).toBeUndefined();
  });
});

describe("resolveConfigPath", () => {
  it("prefers --config over the environment", () => {
    const result = resolveConfigPath(
      ["--config", "cli.json"],
      { [CONFIG_ENV_VAR]: "env.json" },
      tmpDir,
    );
    expect(result).toBe(path.join(tmpDir, "cli.json"));
  });

  it("falls back to the environment variable", () => {
    const result = resolveConfigPath([], { [CONFIG_ENV_VAR]: "env.json" }, tmpDir);
    expect(result).toBe(path.join(tmpDir, "env.json"));
  });

  it("discovers a conventional file name in cwd", () => {
    const discovered = path.join(tmpDir, "ai-test-guardrails.config.json");
    fs.writeFileSync(discovered, "{}");
    try {
      expect(resolveConfigPath([], {}, tmpDir)).toBe(discovered);
    } finally {
      fs.rmSync(discovered);
    }
  });

  it("returns null when nothing is configured", () => {
    expect(resolveConfigPath([], {}, tmpDir)).toBeNull();
  });
});

describe("parseConfig", () => {
  it("accepts an empty object", () => {
    expect(parseConfig({}, "test")).toEqual({});
  });

  it("rejects unknown keys with a readable message", () => {
    expect(() => parseConfig({ rules: { nope: true } }, "test.json")).toThrow(/test\.json/);
    expect(() => parseConfig({ rules: { nope: true } }, "test.json")).toThrow(/rules/);
  });

  it("rejects out-of-range thresholds", () => {
    expect(() => parseConfig({ thresholds: { flakeRiskThreshold: 2 } }, "x")).toThrow(
      /thresholds\.flakeRiskThreshold/,
    );
  });

  it("rejects plugin objects whose check is not a function", () => {
    const bad = {
      plugins: [
        { name: "p", rules: [{ name: "r", category: "determinism", severity: "major", check: 1 }] },
      ],
    };
    expect(() => parseConfig(bad, "x")).toThrow(/check must be a function/);
  });

  it("defineConfig returns its input unchanged", () => {
    const cfg = defineConfig({ thresholds: { determinismThreshold: 1 } });
    expect(cfg).toEqual({ thresholds: { determinismThreshold: 1 } });
  });
});

describe("mergeRules / mergeThresholds", () => {
  it("overlays partial values onto defaults", () => {
    const rules = mergeRules({
      architecture: { maxDescribeDepth: 4 },
      determinism: { detectHardSleeps: false },
    });
    expect(rules.architecture.maxDescribeDepth).toBe(4);
    expect(rules.architecture.enforcePageObjects).toBe(
      DEFAULT_RULES.architecture.enforcePageObjects,
    );
    expect(rules.determinism.detectHardSleeps).toBe(false);
    expect(rules.flakeRisk).toEqual(DEFAULT_RULES.flakeRisk);
  });

  it("returns defaults when nothing is overridden", () => {
    expect(mergeRules(undefined)).toEqual(DEFAULT_RULES);
    expect(mergeThresholds(undefined)).toEqual(DEFAULT_THRESHOLDS);
  });

  it("ignores explicit undefined values", () => {
    expect(mergeThresholds({ architectureThreshold: undefined })).toEqual(DEFAULT_THRESHOLDS);
  });
});

describe("loadConfigFile", () => {
  it("loads and validates a JSON config", async () => {
    const cfg = await loadConfigFile(path.join(tmpDir, "guardrails.json"));
    expect(cfg.thresholds?.architectureThreshold).toBe(5);
    expect(cfg.plugins).toEqual(["./plugin.mjs"]);
  });

  it("loads an ES module config", async () => {
    const cfg = await loadConfigFile(path.join(tmpDir, "guardrails.mjs"));
    expect(cfg.thresholds?.flakeRiskThreshold).toBe(0.5);
  });

  it("throws for a missing file", async () => {
    await expect(loadConfigFile(path.join(tmpDir, "missing.json"))).rejects.toThrow(/not found/);
  });

  it("throws for malformed JSON", async () => {
    await expect(loadConfigFile(path.join(tmpDir, "broken.json"))).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("throws for schema violations", async () => {
    await expect(loadConfigFile(path.join(tmpDir, "invalid.json"))).rejects.toThrow(
      /Invalid ai-test-guardrails config/,
    );
  });
});

describe("loadPlugins", () => {
  it("loads a default-export plugin from a relative path", async () => {
    const { plugins, customRules } = await loadPlugins(["./plugin.mjs"], tmpDir);
    expect(plugins).toEqual(["example-plugin"]);
    expect(customRules.map((r) => r.name)).toEqual(["no-console-log"]);
  });

  it("accepts a module that only exports rules, naming it after the specifier", async () => {
    const { plugins, customRules } = await loadPlugins(["./rules-only.mjs"], tmpDir);
    expect(plugins).toEqual(["./rules-only.mjs"]);
    expect(customRules[0]?.name).toBe("rules-only");
  });

  it("accepts inline plugin objects", async () => {
    const inline = {
      name: "inline",
      rules: [
        {
          name: "r1",
          category: "determinism" as const,
          severity: "minor" as const,
          check: () => [],
        },
      ],
    };
    const { plugins, customRules } = await loadPlugins([inline], tmpDir);
    expect(plugins).toEqual(["inline"]);
    expect(customRules).toHaveLength(1);
  });

  it("rejects duplicate rule names across plugins", async () => {
    const a = {
      name: "a",
      rules: [
        {
          name: "dup",
          category: "determinism" as const,
          severity: "minor" as const,
          check: () => [],
        },
      ],
    };
    const b = {
      name: "b",
      rules: [
        {
          name: "dup",
          category: "architecture" as const,
          severity: "minor" as const,
          check: () => [],
        },
      ],
    };
    await expect(loadPlugins([a, b], tmpDir)).rejects.toThrow(/Duplicate custom rule name "dup"/);
  });

  it("reports a clear error when a plugin cannot be imported", async () => {
    await expect(loadPlugins(["./does-not-exist.mjs"], tmpDir)).rejects.toThrow(
      /Failed to load plugin/,
    );
  });
});

describe("loadRuntimeConfig", () => {
  it("returns defaults when no config is present", async () => {
    const runtime = await loadRuntimeConfig({ argv: [], env: {}, cwd: tmpDir });
    expect(runtime.configPath).toBeNull();
    expect(runtime.rules).toEqual(DEFAULT_RULES);
    expect(runtime.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(runtime.customRules).toEqual([]);
    expect(runtime.plugins).toEqual([]);
  });

  it("merges a config file and loads its plugins relative to the file", async () => {
    const runtime = await loadRuntimeConfig({
      argv: ["--config", "guardrails.json"],
      env: {},
      cwd: tmpDir,
    });
    expect(runtime.configPath).toBe(path.join(tmpDir, "guardrails.json"));
    expect(runtime.thresholds.architectureThreshold).toBe(5);
    expect(runtime.thresholds.flakeRiskThreshold).toBe(DEFAULT_THRESHOLDS.flakeRiskThreshold);
    expect(runtime.rules.architecture.maxDescribeDepth).toBe(3);
    expect(runtime.rules.determinism.detectHardSleeps).toBe(false);
    expect(runtime.plugins).toEqual(["example-plugin"]);
    expect(runtime.customRules.map((r) => r.name)).toEqual(["no-console-log"]);
  });

  it("honours the environment variable", async () => {
    const runtime = await loadRuntimeConfig({
      argv: [],
      env: { [CONFIG_ENV_VAR]: "guardrails.mjs" },
      cwd: tmpDir,
    });
    expect(runtime.thresholds.flakeRiskThreshold).toBe(0.5);
    expect(runtime.customRules[0]?.name).toBe("rules-only");
  });
});
