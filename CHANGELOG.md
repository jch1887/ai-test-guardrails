# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Release workflow: pushing a `v*` tag runs the gate, publishes to npm with provenance, and creates the GitHub release from the matching CHANGELOG section.

## [1.0.0] - 2026-09-07

First stable release. From this version on, the MCP tool names, their input
schemas, the shape of their JSON output, the config file schema, and the custom
rule plugin contract are covered by semantic versioning. Breaking changes to any
of them will require a major version bump.

### Added

- `suggestion` field on every built-in violation with a framework-specific fix.
- `no-positional-selector` rule: flags `.eq(n)`, `.nth(n)`, `:nth-child()`, `:eq()` (major) and `.first()`/`.last()` (minor).
- `no-force-action` rule: flags actions called with `{ force: true }` (major).
- `data-cy` attribute selectors are now recognised as stable and no longer trigger `no-raw-selector`.
- Configuration file (`ai-test-guardrails.config.{mjs,js,cjs,json}`) discovered from `--config`, `AI_TEST_GUARDRAILS_CONFIG`, or the working directory. Overrides thresholds and individual rules.
- Custom rule plugins loaded from the config file. Rules declare a category and severity and receive the parsed file, the `ts` instance, and the AST helpers.
- `scan_project` gains `outputPath` (writes the summary as a JSON artefact for CI) and `historyPath` (appends the scan to a history file and returns deltas and per-file flake regressions).
- `scan_project` gains an `ignore` parameter, and the config file gains `scan.ignore` (gitignore-style globs) and `scan.allowedRoots` (directories the scanner may read from and write to).
- `remediation` field on every flake risk factor with a framework-specific fix.
- `get_flake_history` tool: project-wide and per-file score series read from a history file.
- `get_config` tool: reports the active version, config file, rules, thresholds, and loaded plugins.
- `--version` and `--help` CLI flags on the binary.
- Programmatic API exported from the package entry point (`validateSource`, `scanProject`, `createServer`, `defineConfig`, history helpers, and all types).
- `LICENSE` (MIT), `CHANGELOG.md`, and a GitHub Actions CI workflow.
- `files` allowlist, `repository`, `homepage`, and `bugs` metadata in `package.json`. The `bin` path is written without a leading `./`, which npm 11 otherwise rejects and drops.
- `prepublishOnly` script that runs lint, typecheck, format check, tests, and build before publishing.
- Stdio integration test that drives the server through a real MCP client.

### Changed

- `no-hard-sleep` no longer flags test-runner timeout settings such as `test.setTimeout()`, `testInfo.setTimeout()`, `jest.setTimeout()`, or `this.setTimeout()`. The timing-assertions flake factor applies the same exemption.
- Framework detection matches import specifiers on package boundaries (`playwright`, `@playwright/*`, `cypress/*`, `@cypress/*`, `@testing-library/cypress`, `k6/*`, `jslib.k6.io`). Relative imports such as `./playwright-helpers` are no longer mistaken for a framework.
- Tests are now type-checked and linted alongside `src`. The build uses `tsconfig.build.json`.
- Dependencies updated: `@modelcontextprotocol/sdk` 1.30, `zod` 4, `vitest` 5, `eslint` 10, `@types/node` 26. TypeScript stays on 5.9 because `typescript-eslint` does not yet support TypeScript 6.1 or later.
- The MCP server reports the version from `package.json` instead of a hard-coded string.
- The unsupported-framework message no longer embeds a version number.
- Package `main`/`exports` now point at `dist/index.js` (the programmatic API). The `ai-test-guardrails` binary still points at `dist/server.js`.
- Internal refactor: a single `validateSource` pipeline is shared by the tools and the scanner; server construction moved to `createServer`.
- Documentation and code comments use ASCII punctuation only.

### Security

- Refreshed `package-lock.json` to pick up patched transitive dependencies (non-breaking `npm audit fix`). Production dependencies report zero advisories.

## [0.2.1] - 2026-03-02

### Fixed

- npm tarball no longer ships `src/`, `examples/`, `.cursor/`, and tool config files. No runtime changes.

## [0.2.0] - 2026-02-26

### Added

- Violation severity tiers (`critical`, `major`, `minor`) on every violation.
- Severity breakdown in `policy.detected` and in the `scan_project` summary totals.
- Two-pass file discovery in `scan_project`: conventional test filenames plus framework detection from imports.
- k6 detection with a graceful unsupported-framework response.

## [0.1.0] - 2026-02-01

### Added

- Core validation engine for Playwright and Cypress.
- Determinism, flake risk, and architecture validators.
- Three enforcement modes: `advisory`, `warn`, `block`, with configurable thresholds.
- `validate_test`, `score_flake_risk`, `enforce_architecture`, and `scan_project` MCP tools.

[Unreleased]: https://github.com/jch1887/ai-test-guardrails/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/jch1887/ai-test-guardrails/compare/v0.2.0...v1.0.0
[0.2.1]: https://github.com/jch1887/ai-test-guardrails/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/jch1887/ai-test-guardrails/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jch1887/ai-test-guardrails/releases/tag/v0.1.0
