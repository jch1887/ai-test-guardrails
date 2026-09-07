/**
 * Public programmatic API. The MCP server entry point lives in `server.ts`
 * and is exposed as the `ai-test-guardrails` binary.
 */
export * from "./types/guardrail.types.js";
export { DEFAULT_RULES } from "./config/defaultRules.js";
export type {
  RuleConfig,
  DeterminismRuleConfig,
  ArchitectureRuleConfig,
  FlakeRiskWeightConfig,
} from "./config/defaultRules.js";
export {
  CONFIG_ENV_VAR,
  CONFIG_FILE_NAMES,
  configSchema,
  defineConfig,
  loadConfigFile,
  loadPlugins,
  loadRuntimeConfig,
  mergeRules,
  mergeThresholds,
  parseConfig,
  resolveConfigPath,
  resolveRuntimeConfig,
} from "./config/loadConfig.js";
export type {
  GuardrailsConfig,
  RuntimeConfig,
  LoadRuntimeConfigOptions,
  ScanPolicy,
} from "./config/loadConfig.js";
export * from "./utils/astParser.js";
export {
  DEFAULT_THRESHOLDS,
  countBySeverity,
  isValid,
  resolveEnforcement,
} from "./utils/enforcement.js";
export { detectFrameworkFromSource } from "./utils/frameworkDetector.js";
export type { FrameworkDetectionResult } from "./utils/frameworkDetector.js";
export { classifyProjectFiles, scanProject } from "./utils/projectScanner.js";
export type { ScanOptions } from "./utils/projectScanner.js";
export {
  MAX_HISTORY_ENTRIES,
  readHistory,
  recordScan,
  summarizeHistory,
  toHistoryEntry,
} from "./utils/scanHistory.js";
export type { HistoryReportOptions } from "./utils/scanHistory.js";
export {
  assertWithinAllowedRoots,
  createIgnoreMatcher,
  globToRegExp,
  isWithinRoots,
} from "./utils/scanPolicy.js";
export { validateArchitecture } from "./validators/architecture.js";
export { buildRuleContext, runCustomRules } from "./validators/customRules.js";
export { validateDeterminism } from "./validators/determinism.js";
export { scoreFlakeRisk } from "./validators/flakeRisk.js";
export { validateSource } from "./validators/pipeline.js";
export type { ValidationOptions } from "./validators/pipeline.js";
export { PACKAGE_VERSION } from "./version.js";
export { SUPPORTED_FRAMEWORKS, checkUnsupportedFramework, createServer } from "./createServer.js";
