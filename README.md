# ai-test-guardrails

An MCP (Model Context Protocol) server that provides deterministic guardrails for AI-generated and existing test automation. It validates Playwright and Cypress test proposals using AST-based analysis — detecting flake-prone patterns, enforcing architecture rules, scoring risk, and scanning entire projects in a single call.

## What It Does

- **Validates** AI-generated test code for determinism, flake risk, and architecture compliance
- **Scans** entire project directories, validating every test file in one pass
- **Detects** flake-prone constructs: hard sleeps, unbounded retries, unmocked network calls, dynamic selectors
- **Enforces** architectural rules: page object patterns, selector hygiene, nesting depth limits
- **Scores** flake risk on a 0–1 scale with detailed factor breakdown
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

Every result includes a `policy` block that makes enforcement transparent:

```json
{
  "valid": false,
  "policy": {
    "mode": "warn",
    "thresholds": { "architectureThreshold": 3, "flakeRiskThreshold": 0.7, "determinismThreshold": 0 },
    "detected":   { "architectureViolations": 10, "flakeRiskScore": 0, "determinismViolations": 0 },
    "action": "REJECTED",
    "reasons": ["10 architecture violations exceeded threshold of 3"]
  }
}
```

This makes it clear the test was rejected because of **policy**, not arbitrary tool behaviour.

---

## MCP Tools

### `scan_project`

Scans an entire project directory, validates every test file in one pass, and returns an aggregate summary with per-file results, project-wide scores, and a ranked list of top offenders.

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
    "totalViolations": 59
  },
  "scores": {
    "averageDeterminism": 0.99,
    "averageFlakeRisk": 0.17,
    "averageArchitecture": 0.93
  },
  "topOffenders": [
    {
      "file": "admin/info-consulting.email-sender-restrictor.spec.ts",
      "policy": { "action": "REJECTED", "reasons": ["20 architecture violations exceeded threshold of 3"] },
      "violations": ["..."]
    }
  ],
  "files": ["...per-file results..."]
}
```

Files scanned: `*.spec.ts`, `*.spec.js`, `*.test.ts`, `*.test.js`, `*.cy.ts`, `*.cy.js`. Directories `node_modules`, `.git`, `dist`, and `coverage` are automatically ignored.

---

### `validate_test`

Validates a single test file for determinism, flake risk, and architecture compliance.

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

**Output — REJECTED (1 determinism violation exceeded threshold of 0):**

```json
{
  "valid": false,
  "policy": {
    "mode": "warn",
    "thresholds": { "architectureThreshold": 3, "flakeRiskThreshold": 0.7, "determinismThreshold": 0 },
    "detected":   { "architectureViolations": 1, "flakeRiskScore": 0, "determinismViolations": 1 },
    "action": "REJECTED",
    "reasons": ["1 determinism violation exceeded threshold of 0"]
  },
  "determinismScore": 0.8333333333333334,
  "flakeRiskScore": 0,
  "architectureScore": 0.75,
  "violations": [
    "[line 2] waitForTimeout introduces non-deterministic timing. Use waitForSelector or expect assertions instead.",
    "[line 3] Direct CSS selector \".btn\" in test code. Extract selectors to page objects and use data-testid or role-based selectors."
  ]
}
```

**Input (advisory mode):**

```json
{
  "testCode": "test('login', async ({ page }) => {\n  await page.waitForTimeout(1000);\n  await page.locator('.btn').click();\n});",
  "framework": "playwright",
  "mode": "advisory"
}
```

**Output — ADVISED (violations surfaced, CI not blocked):**

```json
{
  "valid": true,
  "policy": {
    "mode": "advisory",
    "thresholds": { "architectureThreshold": 3, "flakeRiskThreshold": 0.7, "determinismThreshold": 0 },
    "detected":   { "architectureViolations": 1, "flakeRiskScore": 0, "determinismViolations": 1 },
    "action": "ADVISED",
    "reasons": []
  },
  "determinismScore": 0.8333333333333334,
  "flakeRiskScore": 0,
  "architectureScore": 0.75,
  "violations": [
    "[line 2] waitForTimeout introduces non-deterministic timing. Use waitForSelector or expect assertions instead.",
    "[line 3] Direct CSS selector \".btn\" in test code. Extract selectors to page objects and use data-testid or role-based selectors."
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

Checks a single test file for architectural compliance: page object usage, selector patterns, nesting depth, and duplicate titles. Supports all three enforcement modes.

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
    "thresholds": { "architectureThreshold": 3, "flakeRiskThreshold": 0.7, "determinismThreshold": 0 },
    "detected":   { "architectureViolations": 3, "flakeRiskScore": 0, "determinismViolations": 0 },
    "action": "REJECTED",
    "reasons": ["3 architecture violations exceeded threshold of 3"]
  },
  "score": 0,
  "violations": [
    "[line 1] Module-level mutable variable \"count\" can leak state between tests. Use const or move to test-scoped setup.",
    "Test nesting depth is 3 (max allowed: 2). Flatten describe blocks to improve readability.",
    "Duplicate test title \"test\". Each test should have a unique title for clear reporting."
  ]
}
```

---

## Validation Rules (v0.1)

### Determinism Rules

| Rule | Detects |
|------|---------|
| `waitForTimeout` | `page.waitForTimeout()`, `cy.wait(number)` |
| Hard sleeps | `setTimeout`, `sleep()` |
| Random without seed | `Math.random()` |
| Unbounded retries | `while(true)`, `for(;;)` |
| Unmocked network | `fetch()`, `axios.*()` without `route()`/`intercept()` |
| Dynamic selectors | Template literals in `locator()`, `cy.get()`, etc. |

### Architecture Rules

| Rule | Enforces |
|------|----------|
| Page objects | No direct CSS/ID selectors — use `data-testid` or role-based |
| No global state | No module-level `let`/`var` declarations |
| Nesting depth | Max 2 levels of `describe`/`context` nesting |
| Unique titles | No duplicate `it()`/`test()` titles |

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
│   └── projectScanner.ts  # Project directory walker and aggregator
└── config/
    └── defaultRules.ts    # Default rule configuration
tests/
├── astParser.test.ts
├── determinism.test.ts
├── architecture.test.ts
├── flakeRisk.test.ts
├── mode.test.ts
└── projectScanner.test.ts
```

## Roadmap

- [x] **v0.1** — Core validation engine, three enforcement modes, project scanning
- [ ] **v0.2** — Violation severity tiers (critical / major / minor)
- [ ] **v0.2** — k6 performance test support
- [ ] **v0.3** — Auto-fix suggestions in violation messages
- [ ] **v0.3** — Cypress-specific selector pattern detection
- [ ] **v0.4** — Support for custom rule plugins
- [ ] **v0.4** — CI artefact export (scan results to JSON file)
- [ ] **v0.5** — Historical flake score tracking
- [ ] **v1.0** — Stable API with semver guarantees

## Licence

MIT
