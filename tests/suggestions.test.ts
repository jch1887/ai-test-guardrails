import { describe, it, expect } from "vitest";
import { parseSourceCode } from "../src/utils/astParser.js";
import { validateDeterminism } from "../src/validators/determinism.js";
import { validateArchitecture } from "../src/validators/architecture.js";
import { DEFAULT_RULES } from "../src/config/defaultRules.js";
import type { Framework, Violation } from "../src/types/guardrail.types.js";

const PLAYWRIGHT_EVERYTHING = `
import { test, expect } from '@playwright/test';
let counter = 0;
describe('a', () => {
  describe('b', () => {
    describe('c', () => {
      test('dup', async ({ page }) => {
        await page.waitForTimeout(1000);
        await new Promise((r) => setTimeout(r, 100));
        await sleep(100);
        const n = Math.random();
        while (true) { break; }
        for (;;) { break; }
        await fetch('/api');
        await axios.get('/api');
        await page.locator(\`#item-\${n}\`).click();
        await page.locator('.btn').click();
        await page.locator('li:nth-child(2)').click();
        await page.locator('li').nth(1).click();
        await page.locator('li').first().click();
        await page.locator('.btn').click({ force: true });
      });
      test('dup', async () => {});
    });
  });
});
`;

const CYPRESS_EVERYTHING = `
import 'cypress';
var counter = 0;
describe('a', () => {
  describe('b', () => {
    describe('c', () => {
      it('dup', () => {
        cy.wait(1000);
        setTimeout(() => {}, 100);
        sleep(100);
        const n = Math.random();
        while (true) { break; }
        cy.request('/api');
        fetch('/api');
        cy.get(\`#item-\${n}\`).click();
        cy.get('.btn').click();
        cy.get('li:eq(2)').click();
        cy.get('li').eq(1).click();
        cy.get('li').last().click();
        cy.get('.btn').type('x', { force: true });
      });
      it('dup', () => {});
    });
  });
});
`;

const ALL_RULES = [
  "no-wait-for-timeout",
  "no-hard-sleep",
  "no-random-without-seed",
  "no-unbounded-retry",
  "no-unmocked-network",
  "no-dynamic-selector",
  "no-raw-selector",
  "no-global-state",
  "no-deep-nesting",
  "no-duplicate-title",
  "no-positional-selector",
  "no-force-action",
];

function collect(code: string, framework: Framework): Violation[] {
  const sf = parseSourceCode(code);
  return [
    ...validateDeterminism(sf, framework, DEFAULT_RULES.determinism).violations,
    ...validateArchitecture(sf, framework, DEFAULT_RULES.architecture).violations,
  ];
}

describe.each<[Framework, string]>([
  ["playwright", PLAYWRIGHT_EVERYTHING],
  ["cypress", CYPRESS_EVERYTHING],
])("auto-fix suggestions (%s)", (framework, code) => {
  const violations = collect(code, framework);

  it("exercises every built-in rule", () => {
    const rules = new Set(violations.map((v) => v.rule));
    for (const rule of ALL_RULES) {
      expect(rules, `expected rule ${rule} to fire`).toContain(rule);
    }
  });

  it("attaches a non-empty suggestion to every violation", () => {
    expect(violations.length).toBeGreaterThan(0);
    for (const v of violations) {
      expect(typeof v.suggestion, `${v.rule} has no suggestion`).toBe("string");
      expect(v.suggestion?.trim().length ?? 0).toBeGreaterThan(20);
    }
  });

  it("suggestions never repeat the problem statement verbatim", () => {
    for (const v of violations) {
      expect(v.suggestion).not.toBe(v.message);
    }
  });

  it("suggestions are framework-specific for wait replacements", () => {
    const wait = violations.find((v) => v.rule === "no-wait-for-timeout");
    expect(wait).toBeDefined();
    if (framework === "playwright") {
      expect(wait?.suggestion).toContain("expect(");
    } else {
      expect(wait?.suggestion).toContain("cy.intercept");
    }
  });

  it("network suggestions name the framework mocking API", () => {
    const network = violations.find((v) => v.rule === "no-unmocked-network");
    expect(network).toBeDefined();
    expect(network?.suggestion).toContain(
      framework === "playwright" ? "page.route" : "cy.intercept",
    );
  });
});
