import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { z } from "zod";
import { DEFAULT_RULES } from "./defaultRules.js";
import type { RuleConfig } from "./defaultRules.js";
import { DEFAULT_THRESHOLDS } from "../utils/enforcement.js";
import type {
  CustomRule,
  EnforcementThresholds,
  GuardrailsPlugin,
} from "../types/guardrail.types.js";

/** Config files discovered in the working directory, in priority order. */
export const CONFIG_FILE_NAMES = [
  "ai-test-guardrails.config.mjs",
  "ai-test-guardrails.config.js",
  "ai-test-guardrails.config.cjs",
  "ai-test-guardrails.config.json",
];

/** Environment variable that points at a config file. Overridden by `--config`. */
export const CONFIG_ENV_VAR = "AI_TEST_GUARDRAILS_CONFIG";

const booleanFlag = z.boolean().optional();
const weight = z.number().min(0).max(1).optional();

const customRuleSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["determinism", "architecture"]),
  severity: z.enum(["critical", "major", "minor"]),
  description: z.string().optional(),
  check: z.custom<CustomRule["check"]>((value) => typeof value === "function", {
    message: "check must be a function",
  }),
});

const pluginSchema = z.object({
  name: z.string().min(1),
  rules: z.array(customRuleSchema),
});

const rulesOnlyPluginSchema = z.object({
  rules: z.array(customRuleSchema),
});

export const configSchema = z
  .object({
    rules: z
      .object({
        determinism: z
          .object({
            detectWaitForTimeout: booleanFlag,
            detectHardSleeps: booleanFlag,
            detectRandomWithoutSeed: booleanFlag,
            detectUnboundedRetries: booleanFlag,
            detectUnmockedNetworkCalls: booleanFlag,
            detectDynamicSelectors: booleanFlag,
          })
          .strict()
          .optional(),
        architecture: z
          .object({
            enforcePageObjects: booleanFlag,
            forbidGlobalState: booleanFlag,
            maxDescribeDepth: z.number().int().min(1).optional(),
            forbidDuplicateTestTitles: booleanFlag,
            detectPositionalSelectors: booleanFlag,
            detectForcedActions: booleanFlag,
          })
          .strict()
          .optional(),
        flakeRisk: z
          .object({
            asyncHeavyWeight: weight,
            networkDependencyWeight: weight,
            multipleNavigationsWeight: weight,
            sharedStateWeight: weight,
            timingAssertionsWeight: weight,
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    thresholds: z
      .object({
        architectureThreshold: z.number().int().min(0).optional(),
        flakeRiskThreshold: z.number().min(0).max(1).optional(),
        determinismThreshold: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    plugins: z.array(z.union([z.string(), pluginSchema])).optional(),
    scan: z
      .object({
        /** Directories scan_project may read from and write artefacts to. Empty means unrestricted. */
        allowedRoots: z.array(z.string().min(1)).optional(),
        /** gitignore-style globs, relative to the scanned project, to skip. */
        ignore: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Shape of an `ai-test-guardrails.config.*` file. */
export type GuardrailsConfig = z.infer<typeof configSchema>;

/** Identity helper that gives JS config files type checking and editor completion. */
export function defineConfig(config: GuardrailsConfig): GuardrailsConfig {
  return config;
}

/** Fully resolved configuration used by the server and scanner. */
export interface RuntimeConfig {
  /** Absolute path of the loaded config file, or null when defaults are in use. */
  configPath: string | null;
  rules: RuleConfig;
  thresholds: EnforcementThresholds;
  /** Names of the loaded plugins, in load order. */
  plugins: string[];
  customRules: CustomRule[];
  scan: ScanPolicy;
}

export interface ScanPolicy {
  /** Absolute directories that scan_project paths must fall within. Empty means unrestricted. */
  allowedRoots: string[];
  /** Ignore globs applied to every scan, in addition to the built-in directory list. */
  ignore: string[];
}

export interface LoadRuntimeConfigOptions {
  argv?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
}

function collectIssues(issues: z.core.$ZodIssue[], into: Set<string>): void {
  for (const issue of issues) {
    if (issue.code === "invalid_union" && "errors" in issue) {
      // Surface the nested reasons rather than zod's generic "Invalid input".
      for (const branch of issue.errors) {
        collectIssues(branch, into);
      }
      continue;
    }
    const location = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    into.add(`${location}: ${issue.message}`);
  }
}

function formatIssues(error: z.ZodError): string {
  const messages = new Set<string>();
  collectIssues(error.issues, messages);
  return [...messages].join("; ");
}

/** Read a `--name value` or `--name=value` option from an argv array. */
export function readArgvOption(argv: string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === name) return argv[i + 1];
    if (arg?.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

/**
 * Locate the config file: `--config` wins, then the environment variable,
 * then the first conventional file name found in `cwd`.
 */
export function resolveConfigPath(
  argv: string[],
  env: Record<string, string | undefined>,
  cwd: string,
): string | null {
  const fromArgv = readArgvOption(argv, "--config");
  if (fromArgv !== undefined) return path.resolve(cwd, fromArgv);

  const fromEnv = env[CONFIG_ENV_VAR];
  if (fromEnv) return path.resolve(cwd, fromEnv);

  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(cwd, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Validate an already-loaded config object. Throws with a readable message on failure. */
export function parseConfig(value: unknown, source: string): GuardrailsConfig {
  const result = configSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid ai-test-guardrails config at ${source}: ${formatIssues(result.error)}`,
    );
  }
  return result.data;
}

async function importModule(specifier: string): Promise<unknown> {
  const mod = (await import(specifier)) as { default?: unknown };
  return mod.default ?? mod;
}

/** Load and validate a config file (`.json`, `.js`, `.mjs`, or `.cjs`). */
export async function loadConfigFile(configPath: string): Promise<GuardrailsConfig> {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  let raw: unknown;
  if (resolved.endsWith(".json")) {
    try {
      raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
    } catch (error: unknown) {
      throw new Error(`Config file ${resolved} is not valid JSON`, { cause: error });
    }
  } else {
    raw = await importModule(pathToFileURL(resolved).href);
  }

  return parseConfig(raw, resolved);
}

function resolvePluginSpecifier(spec: string, baseDir: string): string {
  if (spec.startsWith(".") || path.isAbsolute(spec)) {
    return pathToFileURL(path.resolve(baseDir, spec)).href;
  }
  // Bare package name: resolve from the config file's directory so the user's
  // node_modules is used rather than this package's.
  try {
    const require = createRequire(path.join(baseDir, "package.json"));
    return pathToFileURL(require.resolve(spec)).href;
  } catch {
    return spec;
  }
}

async function importPlugin(spec: string, baseDir: string): Promise<GuardrailsPlugin> {
  let candidate: unknown;
  try {
    candidate = await importModule(resolvePluginSpecifier(spec, baseDir));
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load plugin "${spec}": ${detail}`, { cause: error });
  }

  const named = pluginSchema.safeParse(candidate);
  if (named.success) return named.data;

  const rulesOnly = rulesOnlyPluginSchema.safeParse(candidate);
  if (rulesOnly.success) return { name: spec, rules: rulesOnly.data.rules };

  throw new Error(
    `Plugin "${spec}" must export { name, rules } or { rules }: ${formatIssues(named.error)}`,
  );
}

/** Resolve plugin entries (module specifiers or inline objects) into a flat rule list. */
export async function loadPlugins(
  entries: NonNullable<GuardrailsConfig["plugins"]>,
  baseDir: string,
): Promise<{ plugins: string[]; customRules: CustomRule[] }> {
  const plugins: string[] = [];
  const customRules: CustomRule[] = [];
  const seenRules = new Set<string>();

  for (const entry of entries) {
    const plugin = typeof entry === "string" ? await importPlugin(entry, baseDir) : entry;
    plugins.push(plugin.name);
    for (const rule of plugin.rules) {
      if (seenRules.has(rule.name)) {
        throw new Error(
          `Duplicate custom rule name "${rule.name}" (from plugin "${plugin.name}"). Rule names must be unique.`,
        );
      }
      seenRules.add(rule.name);
      customRules.push(rule);
    }
  }

  return { plugins, customRules };
}

/** Overlay partial rule settings from a config file onto the defaults. */
export function mergeRules(overrides: GuardrailsConfig["rules"]): RuleConfig {
  return {
    determinism: { ...DEFAULT_RULES.determinism, ...stripUndefined(overrides?.determinism) },
    architecture: { ...DEFAULT_RULES.architecture, ...stripUndefined(overrides?.architecture) },
    flakeRisk: { ...DEFAULT_RULES.flakeRisk, ...stripUndefined(overrides?.flakeRisk) },
  };
}

export function mergeThresholds(overrides: GuardrailsConfig["thresholds"]): EnforcementThresholds {
  return { ...DEFAULT_THRESHOLDS, ...stripUndefined(overrides) };
}

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  const result: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      (result as Record<string, unknown>)[key] = entry;
    }
  }
  return result;
}

/** Build the runtime config from defaults plus a resolved config file, if any. */
export async function resolveRuntimeConfig(
  config: GuardrailsConfig,
  configPath: string | null,
): Promise<RuntimeConfig> {
  const baseDir = configPath !== null ? path.dirname(configPath) : process.cwd();
  const { plugins, customRules } = await loadPlugins(config.plugins ?? [], baseDir);
  return {
    configPath,
    rules: mergeRules(config.rules),
    thresholds: mergeThresholds(config.thresholds),
    plugins,
    customRules,
    scan: {
      allowedRoots: (config.scan?.allowedRoots ?? []).map((root) => path.resolve(baseDir, root)),
      ignore: config.scan?.ignore ?? [],
    },
  };
}

/** Locate, load, validate, and merge the config for this process. */
export async function loadRuntimeConfig(
  options: LoadRuntimeConfigOptions = {},
): Promise<RuntimeConfig> {
  const argv = options.argv ?? [];
  const env = options.env ?? {};
  const cwd = options.cwd ?? process.cwd();

  const configPath = resolveConfigPath(argv, env, cwd);
  const config = configPath !== null ? await loadConfigFile(configPath) : {};
  return resolveRuntimeConfig(config, configPath);
}
