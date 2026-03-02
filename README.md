# ai-test-guardrails

[![npm version](https://img.shields.io/npm/v/ai-test-guardrails.svg)](https://www.npmjs.com/package/ai-test-guardrails)
[![licence](https://img.shields.io/npm/l/ai-test-guardrails.svg)](./LICENSE)

An MCP (Model Context Protocol) server that provides deterministic guardrails for AI-generated and existing test automation. It validates Playwright and Cypress test proposals using AST-based analysis — detecting flake-prone patterns, enforcing architecture rules, scoring risk, and scanning entire projects in a single call.

## What It Does

- **Validates** AI-generated test/ existing test code for determinism, flake risk, and architecture compliance
- **Classifies** violations as `critical`, `major`, or `minor` for prioritised remediation
- **Scans** entire project directories, validating every test file in one pass with severity breakdown
- **Detects** flake-prone constructs: hard sleeps, unbounded retries, unmocked network calls, dynamic selectors
- **Enforces** architectural rules: page object patterns, selector hygiene, nesting depth limits
- **Scores** flake risk on a 0–1 scale with detailed factor breakdown
- **Rejects gracefully** unsupported frameworks (e.g. k6) with a clear, actionable message
- **Returns** structured JSON results with transparent policy output via the MCP tool protocol

## What It Does Not Do

- Generate tests
- Run Playwright or Cypress
- Replace CI pipelines
- Modify your repository

It is a pure validation and scoring engine.

## Installation

```bash
npm install
npm run build
```

Requires Node.js >= 20.

## Usage

### As an MCP Server (stdio)

```bash
node dist/server.js
```

Configure in your MCP client. For **Cursor**, add a `.cursor/mcp.json` file to your project root:

```json
{
  "mcpServers": {
    "ai-test-guardrails": {
      "command": "node",
      "args": ["/path/to/ai-test-guardrails/dist/server.js"]
    }
  }
}
```

For **Claude Desktop**, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ai-test-guardrails": {
      "command": "node",
      "args": ["/path/to/ai-test-guardrails/dist/server.js"]
    }
  }
}
```

### Enforcement Modes

All tools support a three-tier enforcement model designed for organisational adoption.

| Mode | Action | Use case |
|------|--------|----------|
| `"advisory"` | Always `PASSED` or `ADVISED`. Never blocks. | Rollout phase — build trust without friction |
| `"warn"` *(default)* | `WARNED` if under threshold, `REJECTED` if exceeded | Balanced adoption — enforce policy gradually |
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
| `flakeRiskThreshold` | `0.7` | Max flake risk score (0–1) before REJECTED |
| `determinismThreshold` | `0` | Max determinism violations before REJECTED |

### Policy Output

Every result includes a `policy` block that makes enforcement transparent. As of v0.2, `detected` also includes a severity breakdown:

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
  "determinismThreshold": 0
}
```

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
  ]
}
```

**File discovery:** The scanner picks up files in two passes:
1. **Conventional names** — `*.spec.ts/js`, `*.test.ts/js`, `*.cy.ts/js` are always included.
2. **Framework-detected** — any other `.ts`/`.js` file whose imports identify it as Playwright, Cypress, or an unsupported framework (e.g. k6) is also picked up. Files with no recognised test-framework imports (config files, helpers, etc.) are silently skipped.

Directories `node_modules`, `.git`, `dist`, and `coverage` are always ignored.

---

### `validate_test`

Validates a single test file for determinism, flake risk, and architecture compliance. Each violation carries a `severity` (`critical`, `major`, or `minor`), a `rule` identifier, and a `message`.

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

**Output — REJECTED:**

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
      "message": "[line 2] waitForTimeout introduces non-deterministic timing. Use waitForSelector or expect assertions instead."
    },
    {
      "severity": "major",
      "rule": "no-raw-selector",
      "message": "[line 3] Direct CSS selector \".btn\" in test code. Extract selectors to page objects and use data-testid or role-based selectors."
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

**Output — ADVISED (violations surfaced, CI not blocked):**

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

Analyses the flake risk of a single test file and returns a numeric risk score (0–1) with contributing factors.

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
    { "name": "async-heavy",          "weight": 0.15, "detected": false, "description": "High number of async operations increases timing sensitivity" },
    { "name": "network-dependency",   "weight": 0.25, "detected": true,  "description": "Network calls without mocking create external dependencies" },
    { "name": "multiple-navigations", "weight": 0.20, "detected": true,  "description": "Multiple navigation steps increase page load timing variability" },
    { "name": "shared-state",         "weight": 0.20, "detected": false, "description": "Module-level mutable state can leak between tests" },
    { "name": "timing-assertions",    "weight": 0.20, "detected": false, "description": "Timing-dependent assertions are sensitive to execution speed" }
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

If test code imports from an unsupported framework (e.g. k6), tools return a graceful rejection instead of attempting validation:

```json
{
  "supported": false,
  "detectedFramework": "k6",
  "message": "Framework \"k6\" is not supported by ai-test-guardrails v0.2. Supported frameworks: playwright, cypress.",
  "supportedFrameworks": ["playwright", "cypress"]
}
```

---

## Validation Rules (v0.2)

### Determinism Rules

| Rule | Severity | Detects |
|------|----------|---------|
| `no-wait-for-timeout` | **critical** | `page.waitForTimeout()`, `cy.wait(number)` |
| `no-hard-sleep` | **critical** | `setTimeout`, `sleep()` |
| `no-unbounded-retry` | **critical** | `while(true)`, `for(;;)` |
| `no-random-without-seed` | **major** | `Math.random()` |
| `no-unmocked-network` | **major** | `fetch()`, `axios.*()` without `route()`/`intercept()` |
| `no-dynamic-selector` | **major** | Template literals in `locator()`, `cy.get()`, etc. |

### Architecture Rules

| Rule | Severity | Enforces |
|------|----------|----------|
| `no-global-state` | **critical** | No module-level `let`/`var` declarations |
| `no-raw-selector` | **major** | No direct CSS/ID selectors — use `data-testid` or role-based |
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
npm run dev          # Run server in dev mode (tsx)
npm run build        # Compile TypeScript
npm test             # Run tests
npm run test:watch   # Watch mode
npm run lint         # Lint with ESLint
npm run format       # Format with Prettier
npm run typecheck    # Type-check without emitting
```

## Project Structure

```
src/
├── server.ts              # MCP server entry point with tool registration
├── validators/
│   ├── determinism.ts     # Determinism rule checks
│   ├── architecture.ts    # Architecture compliance checks
│   └── flakeRisk.ts       # Flake risk scoring engine
├── types/
│   └── guardrail.types.ts # Shared TypeScript interfaces
├── utils/
│   ├── astParser.ts       # TypeScript compiler API utilities
│   ├── enforcement.ts     # Three-mode policy engine
│   ├── frameworkDetector.ts # Framework detection from imports (k6, Playwright, Cypress)
│   └── projectScanner.ts  # Two-pass file discovery, classification, and aggregator
└── config/
    └── defaultRules.ts    # Default rule configuration
tests/
├── astParser.test.ts
├── determinism.test.ts
├── architecture.test.ts
├── flakeRisk.test.ts
├── mode.test.ts
├── projectScanner.test.ts
└── severity.test.ts
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
3. Make your changes — new rules live in `src/validators/`, new flake factors in `src/validators/flakeRisk.ts`
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

- TypeScript strict mode is enabled — avoid `any`
- Prettier and ESLint configs are included; run `npm run format` before committing
- Keep rule logic self-contained and unit-testable
- Violation messages should be actionable: say what to do, not just what went wrong

---

## Roadmap

- [x] **v0.1** — Core validation engine, three enforcement modes, project scanning
- [x] **v0.2** — Violation severity tiers (critical / major / minor), severity breakdown in scan summary, two-pass `.js`/`.ts` file discovery
- [ ] **v0.3** — Auto-fix suggestions in violation messages
- [ ] **v0.3** — Cypress-specific selector pattern detection
- [ ] **v0.4** — Support for custom rule plugins
- [ ] **v0.4** — CI artefact export (scan results to JSON file)
- [ ] **v0.5** — Historical flake score tracking
- [ ] **v1.0** — Stable API with semver guarantees

## Licence

MIT
