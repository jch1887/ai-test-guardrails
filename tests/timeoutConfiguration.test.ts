import { describe, it, expect } from "vitest";
import { parseSourceCode } from "../src/utils/astParser.js";
import { isTimeoutConfigurationCall, findCallsByMethodName } from "../src/utils/astParser.js";
import { validateDeterminism } from "../src/validators/determinism.js";
import { scoreFlakeRisk } from "../src/validators/flakeRisk.js";
import { DEFAULT_RULES } from "../src/config/defaultRules.js";

function hardSleeps(code: string, framework: "playwright" | "cypress" = "playwright") {
  return validateDeterminism(
    parseSourceCode(code),
    framework,
    DEFAULT_RULES.determinism,
  ).violations.filter((v) => v.rule === "no-hard-sleep");
}

function timingFactor(code: string) {
  return scoreFlakeRisk(parseSourceCode(code), "playwright", DEFAULT_RULES.flakeRisk).factors.find(
    (f) => f.name === "timing-assertions",
  );
}

describe("test-runner timeout configuration is not a hard sleep", () => {
  it.each([
    ["Playwright test.setTimeout", `test.setTimeout(60_000);`],
    [
      "Playwright testInfo.setTimeout",
      `test('x', async ({}, testInfo) => { testInfo.setTimeout(90_000); });`,
    ],
    ["Playwright test.describe chain", `test.describe.setTimeout(10_000);`],
    ["Jest jest.setTimeout", `jest.setTimeout(30_000);`],
    ["Mocha this.setTimeout", `before(function () { this.setTimeout(5000); });`],
    ["Cypress context.setTimeout", `context.setTimeout(5000);`],
  ])("does not flag %s", (_label, code) => {
    expect(hardSleeps(code)).toHaveLength(0);
  });

  it.each([
    ["bare setTimeout", `await new Promise((r) => setTimeout(r, 500));`],
    ["window.setTimeout", `window.setTimeout(() => {}, 500);`],
    ["globalThis.setTimeout", `globalThis.setTimeout(() => {}, 500);`],
  ])("still flags %s", (_label, code) => {
    expect(hardSleeps(code)).toHaveLength(1);
  });

  it("isTimeoutConfigurationCall only matches known receivers", () => {
    const sf = parseSourceCode(`test.setTimeout(1); window.setTimeout(f, 1); setTimeout(f, 1);`);
    const calls = findCallsByMethodName(sf, "setTimeout");
    expect(calls.map(isTimeoutConfigurationCall)).toEqual([true, false, false]);
  });

  it("does not count test.setTimeout toward the timing-assertions flake factor", () => {
    expect(timingFactor(`test.setTimeout(60_000); test('x', async () => {});`)?.detected).toBe(
      false,
    );
    expect(timingFactor(`test('x', async () => { window.setTimeout(f, 1); });`)?.detected).toBe(
      true,
    );
  });
});
