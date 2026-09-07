# ai-test-guardrails

[![npm version](https://img.shields.io/npm/v/ai-test-guardrails.svg)](https://www.npmjs.com/package/ai-test-guardrails)
[![licence](https://img.shields.io/npm/l/ai-test-guardrails.svg)](./LICENSE)

An MCP (Model Context Protocol) server that provides deterministic guardrails for AI-generated and existing test automation. It validates Playwright and Cypress test proposals using AST-based analysis: detecting flake-prone patterns, enforcing architecture rules, scoring risk, and scanning entire projects in a single call.

## What It Does

- **Validates** AI-generated test/ existing test code for determinism, flake risk, and architecture compliance
- **Classifies** violations as `critical`, `major`, or `minor` for prioritised remediation
- **Scans** entire project directories, validating every test file in one pass with severity breakdown
- **Detects** flake-prone constructs: hard sleeps, unbounded retries, unmocked network calls, dynamic selectors
- **Enforces** architectural rules: page object patterns, selector hygiene, nesting depth limits
- **Scores** flake risk on a 0-1 scale with detailed factor breakdown
- **Suggests** a concrete fix for every built-in violation via the `suggestion` field
- **Rejects gracefully** unsupported frameworks (e.g. k6) with a clear, actionable message
- **Extends** with custom rule plugins loaded from a config file
- **Exports** scan results to a JSON artefact for CI and tracks flake scores across scans
- **Returns** structured JSON results with transparent policy output via the MCP tool protocol

## What It Does Not Do

- Generate tests
- Run Playwright or Cypress
- Replace CI pipelines
- Modify your test code

It is a pure validation and scoring engine. The only files it ever writes are the optional `outputPath` artefact and `historyPath` history file you ask `scan_project` for.

## Installation

Requires Node.js >= 20.

Install from npm:

```bash
npm install -g ai-test-guardrails
```

Or run it without installing:

```bash
npx ai-test-guardrails
```

To build from source:

```bash
git clone https://github.com/jch1887/ai-test-guardrails.git
cd ai-test-guardrails
npm install
npm run build
```

## Usage

### As an MCP Server (stdio)

The server communicates over stdio. Start it with:

```bash
npx ai-test-guardrails
```

Or, from a source checkout:

```bash
node dist/server.js
```

Configure in your MCP client. For **Cursor**, add a `.cursor/mcp.json` file to your project root:

```json
{
  "mcpServers": {
    "ai-test-guardrails": {
      "command": "npx",
      "args": ["-y", "ai-test-guardrails"]
    }
  }
}
```

For **Claude Desktop**, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ai-test-guardrails": {
      "command": "npx",
      "args": ["-y", "ai-test-guardrails"]
    }
  }
}
```

If you built from source, point `command` at `node` and `args` at the absolute path to `dist/server.js` instead.

#### CLI flags

```text
ai-test-guardrails [--config <path>]

  --config <path>   Path to a config file (.json, .js, .mjs, or .cjs)
  --version, -v     Print the version and exit
  --help, -h        Print usage and exit
```

### Configuration File

All tools work with no configuration. To change defaults or add custom rules, create a config file. It is located in this order:

1. `--config <path>` on the command line
2. The `AI_TEST_GUARDRAILS_CONFIG` environment variable
3. The first of `ai-test-guardrails.config.mjs`, `.js`, `.cjs`, or `.json` in the working directory

Every key is optional. Values you set are overlaid on the defaults shown below.

```json
{
  "thresholds": {
    "architectureThreshold": 3,
    "flakeRiskThreshold": 0.7,
    "determinismThreshold": 0
  },
  "rules": {
    "determinism": {
      "detectWaitForTimeout": true,
      "detectHardSleeps": true,
      "detectRandomWithoutSeed": true,
      "detectUnboundedRetries": true,
      "detectUnmockedNetworkCalls": true,
      "detectDynamicSelectors": true
    },
    "architecture": {
      "enforcePageObjects": true,
      "forbidGlobalState": true,
      "maxDescribeDepth": 2,
      "forbidDuplicateTestTitles": true,
      "detectPositionalSelectors": true,
      "detectForcedActions": true
    },
    "flakeRisk": {
      "asyncHeavyWeight": 0.15,
      "networkDependencyWeight": 0.25,
      "multipleNavigationsWeight": 0.2,
      "sharedStateWeight": 0.2,
      "timingAssertionsWeight": 0.2
    }
  },
  "plugins": ["./guardrails/rules.mjs"],
  "scan": {
    "allowedRoots": ["."],
    "ignore": ["fixtures", "**/*.generated.ts"]
  }
}
```

`scan.allowedRoots` restricts where `scan_project` and `get_flake_history` may read from and write to. Paths are resolved relative to the config file. When the list is empty or absent, any path on disk is accepted, so set it whenever the server is exposed beyond your own machine. `scan.ignore` holds gitignore-style globs applied to every scan. A pattern without `/` matches a file or directory name at any depth; a pattern with `/` is anchored to the project root; `**` spans directories.

`thresholds` become the defaults for the tool parameters of the same name. Tool callers can still override them per call. Use the `get_config` tool to see what the running server loaded.

A JavaScript config gets type checking through `defineConfig`:

```js
// ai-test-guardrails.config.mjs
import { defineConfig } from "ai-test-guardrails";

export default defineConfig({
  thresholds: { architectureThreshold: 5 },
  rules: { architecture: { maxDescribeDepth: 3 } },
  plugins: ["./guardrails/rules.mjs", "@acme/guardrails-plugin"],
});
```

### Custom Rule Plugins

A plugin is a module that exports `{ name, rules }` (or just `{ rules }`). Each rule declares which validator it belongs to, a default severity, and a `check` function that receives the parsed file and returns findings. Relative plugin paths resolve from the config file. Bare package names resolve from the project's `node_modules`.

```js
// guardrails/rules.mjs
export default {
  name: "acme-rules",
  rules: [
    {
      name: "no-console-log",
      category: "architecture",   // "determinism" | "architecture"
      severity: "minor",          // "critical" | "major" | "minor"
      description: "console.log leaves noise in CI output",
      check({ ts, sourceFile, framework, helpers }) {
        return helpers
          .findPropertyAccessCalls(sourceFile, "console", "log")
          .map((call) => ({
            message: "console.log() in test code",
            line: helpers.getLineNumber(call, sourceFile),
            suggestion: "Remove the console.log or use the reporter",
          }));
      },
    },
  ],
};
```

The `check` context provides:

| Field | Description |
|-------|-------------|
| `ts` | The TypeScript compiler API instance that parsed the file. Use it instead of importing your own copy. |
| `sourceFile` | The parsed `ts.SourceFile` |
| `framework` | `"playwright"` or `"cypress"` |
| `helpers` | AST helpers: `walkAst`, `findCallsByMethodName`, `findPropertyAccessCalls`, `getLineNumber`, `getFirstArgumentText`, `getTestTitles`, and the rest of `utils/astParser` |

Findings are `{ message, line?, suggestion?, severity? }`. A `line` is prefixed to the message as `[line N]`; `severity` overrides the rule default for that finding. Custom violations count toward the threshold of their `category` and toward that validator's score, exactly like built-in rules. Rule names must be unique across all plugins. A rule that throws fails the tool call with the rule name in the error.

### Enforcement Modes

All tools support a three-tier enforcement model designed for organisational adoption.

| Mode | Action | Use case |
|------|--------|----------|
| `"advisory"` | Always `PASSED` or `ADVISED`. Never blocks. | Rollout phase: build trust without friction |
| `"warn"` *(default)* | `WARNED` if under threshold, `REJECTED` if exceeded | Balanced adoption: enforce policy gradually |
| `"block"` | `REJECTED` on any violation | Full enforcement once confidence is established |

All modes produce identical scores and violation lists. Only `valid` and the `policy.action` field change.

### Configurable Thresholds (warn mode)

In `warn` mode, enforcement only triggers when detected issues exceed your configured thresholds:

```json
{
  "mode": "warn",
  "architectureThreshold": 3,
  "flakeRiskThreshold": 0.7,
  "determinismThreshold": 0
}
```

| Threshold | Default | Meaning |
|-----------|---------|---------|
| `architectureThreshold` | `3` | Max architecture violations before REJECTED |
| `flakeRiskThreshold` | `0.7` | Max flake risk score (0-1) before REJECTED |
| `determinismThreshold` | `0` | Max determinism violations before REJECTED |

### Policy Output

Every result includes a `policy` block that makes enforcement transparent. `detected` also includes a severity breakdown:

```json
{
  "valid": false,
  "policy": {
    "mode": "warn",
    "thresholds": { "architectureThreshold": 3, "flakeRiskThreshold": 0.7, "determinismThreshold": 0 },
    "detected": {
      "architectureViolations": 10,
      "flakeRiskScore": 0,
      "determinismViolations": 0,
      "criticalCount": 0,
      "majorCount": 8,
      "minorCount": 2
    },
    "action": "REJECTED",
    "reasons": ["10 architecture violations exceeded threshold of 3"]
  }
}
```

This makes it clear the test was rejected because of **policy**, not arbitrary tool behaviour.

---

## MCP Tools

### `scan_project`

Scans an entire project directory, validates every test file in one pass, and returns an aggregate summary with per-file results, severity breakdown, project-wide scores, and a ranked list of top offenders.

**Input:**

```json
{
  "projectPath": "/path/to/your/tests",
  "framework": "playwright",
  "mode": "warn",
  "architectureThreshold": 3,
  "flakeRiskThreshold": 0.7,
  "determinismThreshold": 0,
  "outputPath": "reports/guardrails.json",
  "historyPath": ".guardrails/history.json",
  "ignore": ["legacy/**"]
}
```

`outputPath`, `historyPath`, and `ignore` are optional. Relative paths resolve from the server's working directory.

- **`outputPath`**: the full summary is written to this JSON file so CI can archive it as an artefact. Parent directories are created.
- **`historyPath`**: the scan is appended to this JSON history file (the last 100 scans are kept) and the response gains a `history` block comparing it to the previous scan.
- **`ignore`**: extra gitignore-style globs to skip for this call, combined with `scan.ignore` from the config file.

If `scan.allowedRoots` is configured, `projectPath`, `outputPath`, and `historyPath` must all fall inside one of the roots or the call fails with an error naming the offending path.

**Output:**

```json
{
  "scannedAt": "2026-02-26T22:12:36.742Z",
  "projectPath": "/path/to/your/tests",
  "framework": "playwright",
  "mode": "warn",
  "thresholds": { "architectureThreshold": 3, "flakeRiskThreshold": 0.7, "determinismThreshold": 0 },
  "totals": {
    "files": 19,
    "passed": 6,
    "warned": 8,
    "rejected": 5,
    "totalViolations": 59,
    "criticalViolations": 12,
    "majorViolations": 30,
    "minorViolations": 17
  },
  "scores": {
    "averageDeterminism": 0.99,
    "averageFlakeRisk": 0.17,
    "averageArchitecture": 0.93
  },
  "topOffenders": [
    {
      "file": "admin/email-sender-restrictor.spec.ts",
      "policy": { "action": "REJECTED", "reasons": ["20 architecture violations exceeded threshold of 3"] },
      "violations": ["..."]
    }
  ],
  "files": ["...per-file results..."],
  "unsupportedFiles": [
    { "file": "perf/loadTest.js",  "detectedFramework": "k6" },
    { "file": "perf/soakTest.js",  "detectedFramework": "k6" }
  ],
  "outputPath": "/path/to/your/tests/reports/guardrails.json",
  "history": {
    "historyPath": "/path/to/your/tests/.guardrails/history.json",
    "entriesRecorded": 4,
    "previousScannedAt": "2026-02-25T09:10:02.118Z",
    "deltas": { "averageFlakeRisk": 0.05, "averageDeterminism": 0, "averageArchitecture": -0.02, "totalViolations": 3 },
    "regressions": [
      { "file": "checkout/payment.spec.ts", "previousFlakeRisk": 0.2, "currentFlakeRisk": 0.45, "delta": 0.25 }
    ],
    "improvements": []
  }
}
```

**File discovery:** The scanner picks up files in two passes:
1. **Conventional names**: `*.spec.ts/js`, `*.test.ts/js`, `*.cy.ts/js` are always included.
2. **Framework-detected**: any other `.ts`/`.js` file whose imports identify it as Playwright, Cypress, or an unsupported framework (e.g. k6) is also picked up. Files with no recognised test-framework imports (config files, helpers, etc.) are silently skipped.

Directories `node_modules`, `.git`, `dist`, and `coverage` are always ignored.

---

### `get_flake_history`

Reads a history file written by `scan_project` and returns project-wide score trends, optionally with the per-file series for one test file.

**Input:**

```json
{
  "historyPath": ".guardrails/history.json",
  "file": "checkout/payment.spec.ts",
  "limit": 20
}
```

**Output:**

```json
{
  "historyPath": "/path/to/your/tests/.guardrails/history.json",
  "entries": 4,
  "series": [
    { "scannedAt": "2026-02-25T09:10:02.118Z", "averageFlakeRisk": 0.12, "averageDeterminism": 0.99, "averageArchitecture": 0.95, "totalViolations": 56, "files": 19 },
    { "scannedAt": "2026-02-26T22:12:36.742Z", "averageFlakeRisk": 0.17, "averageDeterminism": 0.99, "averageArchitecture": 0.93, "totalViolations": 59, "files": 19 }
  ],
  "file": {
    "file": "checkout/payment.spec.ts",
    "series": [
      { "scannedAt": "2026-02-25T09:10:02.118Z", "flakeRiskScore": 0.2, "determinismScore": 1, "architectureScore": 1, "violations": 0 },
      { "scannedAt": "2026-02-26T22:12:36.742Z", "flakeRiskScore": 0.45, "determinismScore": 1, "architectureScore": 0.83, "violations": 2 }
    ]
  }
}
```

---

### `get_config`

Takes no input. Returns the server version, the config file in use (or `null`), the effective rule settings and default thresholds, the loaded plugin names, and a summary of every custom rule. Use it to confirm that a config file was picked up.

---

### `validate_test`

Validates a single test file for determinism, flake risk, and architecture compliance. Each violation carries a `severity` (`critical`, `major`, or `minor`), a `rule` identifier, a `message`, and a `suggestion` with a concrete fix.

**Input (warn mode with custom thresholds):**

```json
{
  "testCode": "test('login', async ({ page }) => {\n  await page.waitForTimeout(1000);\n  await page.locator('.btn').click();\n});",
  "framework": "playwright",
  "mode": "warn",
  "architectureThreshold": 3,
  "flakeRiskThreshold": 0.7,
  "determinismThreshold": 0
}
```

**Output (REJECTED):**

```json
{
  "valid": false,
  "policy": {
    "mode": "warn",
    "thresholds": { "architectureThreshold": 3, "flakeRiskThreshold": 0.7, "determinismThreshold": 0 },
    "detected": {
      "architectureViolations": 1,
      "flakeRiskScore": 0,
      "determinismViolations": 1,
      "criticalCount": 1,
      "majorCount": 1,
      "minorCount": 0
    },
    "action": "REJECTED",
    "reasons": ["1 determinism violations exceeded threshold of 0"]
  },
  "determinismScore": 0.833,
  "flakeRiskScore": 0,
  "architectureScore": 0.75,
  "violations": [
    {
      "severity": "critical",
      "rule": "no-wait-for-timeout",
      "message": "[line 2] waitForTimeout introduces non-deterministic timing. Use waitForSelector or expect assertions instead.",
      "suggestion": "Wait for the condition you actually need: await expect(page.getByTestId('result')).toBeVisible();"
    },
    {
      "severity": "major",
      "rule": "no-raw-selector",
      "message": "[line 3] Direct CSS selector \".btn\" in test code. Extract selectors to page objects and use data-testid or role-based selectors.",
      "suggestion": "Add a test id to the element and select it with page.getByTestId('submit-button') or page.getByRole('button', { name: 'Submit' }). Keep the selector in a page object so it is defined once."
    }
  ]
}
```

**Input (advisory mode):**

```json
{
  "testCode": "test('login', async ({ page }) => {\n  await page.waitForTimeout(1000);\n});",
  "framework": "playwright",
  "mode": "advisory"
}
```

**Output (ADVISED, violations surfaced, CI not blocked):**

```json
{
  "valid": true,
  "policy": { "mode": "advisory", "action": "ADVISED", "reasons": [] },
  "violations": [
    { "severity": "critical", "rule": "no-wait-for-timeout", "message": "[line 2] waitForTimeout introduces non-deterministic timing..." }
  ]
}
```

---

### `score_flake_risk`

Analyses the flake risk of a single test file and returns a numeric risk score (0-1) with contributing factors. Each factor carries a framework-specific `remediation` describing what to change to remove it from the score.

**Input:**

```json
{
  "testCode": "test('checkout', async ({ page }) => {\n  await page.goto('/cart');\n  await page.goto('/checkout');\n  const res = await fetch('/api/order');\n});",
  "framework": "playwright"
}
```

**Output:**

```json
{
  "score": 0.45,
  "factors": [
    {
      "name": "network-dependency",
      "weight": 0.25,
      "detected": true,
      "description": "Network calls without mocking create external dependencies",
      "remediation": "Mock the request with page.route('**/api/**', (route) => route.fulfill({ json: mockResponse })) or use a request fixture so the test does not depend on a live service."
    },
    {
      "name": "multiple-navigations",
      "weight": 0.20,
      "detected": true,
      "description": "Multiple navigation steps increase page load timing variability",
      "remediation": "Start each test at the page under test using baseURL and a single page.goto(); cover the other pages in their own tests."
    },
    { "name": "async-heavy",       "weight": 0.15, "detected": false, "description": "...", "remediation": "..." },
    { "name": "shared-state",      "weight": 0.20, "detected": false, "description": "...", "remediation": "..." },
    { "name": "timing-assertions", "weight": 0.20, "detected": false, "description": "...", "remediation": "..." }
  ]
}
```

---

### `enforce_architecture`

Checks a single test file for architectural compliance: page object usage, selector patterns, nesting depth, and duplicate titles. Violations are severity-classified. Supports all three enforcement modes.

**Input:**

```json
{
  "testCode": "let count = 0;\ndescribe('a', () => {\n  describe('b', () => {\n    describe('c', () => {\n      it('test', () => { count++; });\n      it('test', () => {});\n    });\n  });\n});",
  "framework": "playwright"
}
```

**Output:**

```json
{
  "valid": false,
  "policy": {
    "mode": "warn",
    "detected": { "architectureViolations": 3, "criticalCount": 1, "majorCount": 0, "minorCount": 2 },
    "action": "REJECTED",
    "reasons": ["3 architecture violations exceeded threshold of 3"]
  },
  "score": 0,
  "violations": [
    { "severity": "critical", "rule": "no-global-state",      "message": "[line 1] Module-level mutable variable \"count\" can leak state between tests..." },
    { "severity": "minor",    "rule": "no-deep-nesting",      "message": "Test nesting depth is 3 (max allowed: 2). Flatten describe blocks..." },
    { "severity": "minor",    "rule": "no-duplicate-title",   "message": "Duplicate test title \"test\". Each test should have a unique title..." }
  ]
}
```

---

### Unsupported Framework Detection

Frameworks are detected from import and `require` specifiers on package boundaries: `playwright`, `playwright-core`, any `@playwright/*` package, `cypress` and its subpaths, `@cypress/*`, `@testing-library/cypress`, `k6` and its subpaths, and remote modules from `jslib.k6.io`. Relative imports such as `./playwright-helpers` are never treated as a framework.

If test code imports from an unsupported framework (e.g. k6), tools return a graceful rejection instead of attempting validation:

```json
{
  "supported": false,
  "detectedFramework": "k6",
  "message": "Framework \"k6\" is not supported by ai-test-guardrails. Supported frameworks: playwright, cypress.",
  "supportedFrameworks": ["playwright", "cypress"]
}
```

---

## Validation Rules

Every violation includes a `suggestion` string with a framework-specific replacement. Rules can be switched off individually in the [configuration file](#configuration-file).

### Determinism Rules

| Rule | Severity | Detects |
|------|----------|---------|
| `no-wait-for-timeout` | **critical** | `page.waitForTimeout()`, `cy.wait(number)` |
| `no-hard-sleep` | **critical** | `setTimeout`, `sleep()`. Runner timeout settings such as `test.setTimeout()`, `testInfo.setTimeout()`, and `jest.setTimeout()` are exempt |
| `no-unbounded-retry` | **critical** | `while(true)`, `for(;;)` |
| `no-random-without-seed` | **major** | `Math.random()` |
| `no-unmocked-network` | **major** | `fetch()`, `axios.*()` without `route()`/`intercept()` |
| `no-dynamic-selector` | **major** | Template literals in `locator()`, `cy.get()`, etc. |

### Architecture Rules

| Rule | Severity | Enforces |
|------|----------|----------|
| `no-global-state` | **critical** | No module-level `let`/`var` declarations |
| `no-raw-selector` | **major** | No direct CSS/ID selectors. Use `data-testid`, `data-cy`, or role-based |
| `no-positional-selector` | **major** / minor | No `.eq(n)`, `.nth(n)`, `:nth-child()`, `:eq()` (major) or `.first()`/`.last()` (minor) |
| `no-force-action` | **major** | No actions called with `{ force: true }` |
| `no-deep-nesting` | **minor** | Max 2 levels of `describe`/`context` nesting |
| `no-duplicate-title` | **minor** | No duplicate `it()`/`test()` titles |

### Flake Risk Factors

| Factor | Weight | Triggers |
|--------|--------|----------|
| Async-heavy | 0.15 | > 5 `await` expressions |
| Network dependency | 0.25 | `fetch()`, `request()` calls |
| Multiple navigations | 0.20 | > 1 `goto()`/`visit()` call |
| Shared state | 0.20 | Module-level `let`/`var` |
| Timing assertions | 0.20 | `waitForTimeout`, assertions with `timeout` option |

---

## Development

```bash
npm run dev          # Run server in dev mode (tsx); add -- --config path/to/config.json to test a config
npm run build        # Compile TypeScript
npm test             # Run tests
npm run test:watch   # Watch mode
npm run lint         # Lint src and tests with ESLint
npm run format       # Format with Prettier
npm run typecheck    # Type-check src and tests without emitting
```

## Project Structure

```
src/
├── server.ts              # Binary entry point: CLI flags, config loading, stdio transport
├── createServer.ts        # Builds the McpServer and registers every tool
├── index.ts               # Public programmatic API (package main)
├── version.ts             # Version read from package.json
├── validators/
│   ├── pipeline.ts        # Shared validate-and-enforce pipeline
│   ├── determinism.ts     # Determinism rule checks
│   ├── architecture.ts    # Architecture compliance checks
│   ├── flakeRisk.ts       # Flake risk scoring engine
│   └── customRules.ts     # Runs plugin rules and normalises their findings
├── types/
│   └── guardrail.types.ts # Shared TypeScript interfaces
├── utils/
│   ├── astParser.ts       # TypeScript compiler API utilities
│   ├── enforcement.ts     # Three-mode policy engine
│   ├── frameworkDetector.ts # Framework detection from imports (k6, Playwright, Cypress)
│   ├── projectScanner.ts  # Two-pass file discovery, classification, aggregation, artefact export
│   ├── scanHistory.ts     # History file read/append and trend reporting
│   └── scanPolicy.ts      # Allowed-root checks and ignore-glob matching
└── config/
    ├── defaultRules.ts    # Default rule configuration
    └── loadConfig.ts      # Config discovery, validation, merging, and plugin loading
tests/
├── astParser.test.ts
├── architecture.test.ts
├── customRules.test.ts
├── cypressSelectors.test.ts
├── determinism.test.ts
├── flakeRemediation.test.ts
├── flakeRisk.test.ts
├── frameworkDetector.test.ts
├── loadConfig.test.ts
├── mode.test.ts
├── pipeline.test.ts
├── projectScanner.test.ts
├── scanHistory.test.ts
├── scanPolicy.test.ts
├── server.integration.test.ts
├── severity.test.ts
├── suggestions.test.ts
└── timeoutConfiguration.test.ts
```

## Contributing

Contributions, bug reports, and feature suggestions are welcome. This is an open source project and community input directly shapes the roadmap.

### Reporting Issues

If you find a bug or unexpected behaviour, please [open an issue](https://github.com/jch1887/ai-test-guardrails/issues) and include:

- A minimal code snippet that reproduces the problem
- The framework (`playwright` or `cypress`) and enforcement mode you were using
- The full tool output (JSON response)
- Your Node.js version (`node --version`)

### Suggesting Features or New Rules

Have an idea for a new validation rule, flake risk factor, or tool feature? [Open an issue](https://github.com/jch1887/ai-test-guardrails/issues) with the label **`enhancement`** and describe:

- The problem or pattern you want to catch
- Why it matters for test reliability or architecture
- Any example code that should trigger (or not trigger) the rule

### Submitting a Pull Request

1. Fork the repository and create a branch from `main`
2. Install dependencies: `npm install`
3. Make your changes. New rules live in `src/validators/`, new flake factors in `src/validators/flakeRisk.ts`
4. Add or update tests in `tests/` to cover your change
5. Ensure all checks pass:

```bash
npm test          # all tests must pass
npm run lint      # no lint errors
npm run typecheck # no type errors
```

6. Open a pull request against `main` with a clear description of what changed and why

### Development Setup

```bash
git clone https://github.com/jch1887/ai-test-guardrails.git
cd ai-test-guardrails
npm install
npm run build
npm test
```

### Code Style

- TypeScript strict mode is enabled for `src` and `tests`. Avoid `any`
- Build output comes from `tsconfig.build.json`; the root `tsconfig.json` type-checks tests as well
- Prettier and ESLint configs are included; run `npm run format` before committing
- Keep rule logic self-contained and unit-testable
- Violation messages should be actionable: say what to do, not just what went wrong

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/). From 1.0.0 onward the public contract is:

- The six MCP tool names: `validate_test`, `score_flake_risk`, `enforce_architecture`, `scan_project`, `get_flake_history`, `get_config`
- Their input schemas and defaults
- The shape of their JSON output, including `policy`, `violations`, `suggestion`, the scan summary, and the history file format
- The rule identifiers and severity tiers listed above
- The configuration file schema and the custom rule plugin contract

Adding new rules, factors, or optional output fields is a minor release. Removing or renaming any of the above is a major release. See [CHANGELOG.md](./CHANGELOG.md) for release history.

## Roadmap

- [x] **v0.1**: Core validation engine, three enforcement modes, project scanning
- [x] **v0.2**: Violation severity tiers (critical / major / minor), severity breakdown in scan summary, two-pass `.js`/`.ts` file discovery
- [x] **v1.0**: Auto-fix suggestions on every violation, positional-selector and forced-action rules, configuration file, custom rule plugins, CI artefact export, historical flake tracking, stable API with semver guarantees, npm distribution, CI

Ideas for future minor releases:

- [ ] Additional built-in rules (for example `cy.then()` nesting depth, hard-coded URLs)
- [ ] SARIF export for code-scanning integrations

## Licence

MIT
