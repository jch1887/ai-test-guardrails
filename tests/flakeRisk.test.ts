import { describe, it, expect } from "vitest";
import { parseSourceCode } from "../src/utils/astParser.js";
import { scoreFlakeRisk } from "../src/validators/flakeRisk.js";
import { DEFAULT_RULES } from "../src/config/defaultRules.js";

const config = DEFAULT_RULES.flakeRisk;

describe("flake risk scorer", () => {
  describe("score range", () => {
    it("returns a score between 0 and 1", () => {
      const code = `
        test('example', async ({ page }) => {
          await page.goto('/');
        });
      `;
      const result = scoreFlakeRisk(parseSourceCode(code), "playwright", config);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it("returns 0 for minimal, clean tests", () => {
      const code = `
        test('simple', () => {
          expect(1 + 1).toBe(2);
        });
      `;
      const result = scoreFlakeRisk(parseSourceCode(code), "playwright", config);
      expect(result.score).toBe(0);
    });
  });

  describe("async-heavy detection", () => {
    it("assigns higher risk for tests with many await expressions", () => {
      const lightCode = `
        test('simple', () => {
          expect(1).toBe(1);
        });
      `;
      const heavyCode = `
        test('complex', async ({ page }) => {
          await page.goto('/');
          await page.click('[data-testid="btn"]');
          await page.fill('#input', 'value');
          await page.waitForSelector('.result');
          await expect(page.locator('.result')).toBeVisible();
          await page.screenshot();
        });
      `;
      const lightResult = scoreFlakeRisk(parseSourceCode(lightCode), "playwright", config);
      const heavyResult = scoreFlakeRisk(parseSourceCode(heavyCode), "playwright", config);
      expect(heavyResult.score).toBeGreaterThan(lightResult.score);
    });
  });

  describe("network dependency detection", () => {
    it("detects fetch calls as network dependency", () => {
      const code = `
        test('api test', async () => {
          const res = await fetch('/api/data');
        });
      `;
      const result = scoreFlakeRisk(parseSourceCode(code), "playwright", config);
      const networkFactor = result.factors.find((f) => f.name === "network-dependency");
      expect(networkFactor?.detected).toBe(true);
    });

    it("does not flag tests without network calls", () => {
      const code = `
        test('ui test', () => {
          expect(true).toBe(true);
        });
      `;
      const result = scoreFlakeRisk(parseSourceCode(code), "playwright", config);
      const networkFactor = result.factors.find((f) => f.name === "network-dependency");
      expect(networkFactor?.detected).toBe(false);
    });
  });

  describe("multiple navigation detection", () => {
    it("detects multiple goto calls in Playwright", () => {
      const code = `
        test('multi-page', async ({ page }) => {
          await page.goto('/login');
          await page.goto('/dashboard');
        });
      `;
      const result = scoreFlakeRisk(parseSourceCode(code), "playwright", config);
      const navFactor = result.factors.find((f) => f.name === "multiple-navigations");
      expect(navFactor?.detected).toBe(true);
    });

    it("detects multiple visit calls in Cypress", () => {
      const code = `
        it('multi-page', () => {
          cy.visit('/login');
          cy.visit('/dashboard');
        });
      `;
      const result = scoreFlakeRisk(parseSourceCode(code), "cypress", config);
      const navFactor = result.factors.find((f) => f.name === "multiple-navigations");
      expect(navFactor?.detected).toBe(true);
    });
  });

  describe("shared state detection", () => {
    it("detects module-level let variables as shared state", () => {
      const code = `
        let counter = 0;
        test('test', () => { counter++; });
      `;
      const result = scoreFlakeRisk(parseSourceCode(code), "playwright", config);
      const sharedFactor = result.factors.find((f) => f.name === "shared-state");
      expect(sharedFactor?.detected).toBe(true);
    });
  });

  describe("factor details", () => {
    it("returns all expected factors", () => {
      const code = `
        test('example', async ({ page }) => {
          await page.goto('/');
        });
      `;
      const result = scoreFlakeRisk(parseSourceCode(code), "playwright", config);
      expect(result.factors).toHaveLength(5);

      const factorNames = result.factors.map((f) => f.name);
      expect(factorNames).toContain("async-heavy");
      expect(factorNames).toContain("network-dependency");
      expect(factorNames).toContain("multiple-navigations");
      expect(factorNames).toContain("shared-state");
      expect(factorNames).toContain("timing-assertions");
    });

    it("each factor has required properties", () => {
      const code = `test('simple', () => {});`;
      const result = scoreFlakeRisk(parseSourceCode(code), "playwright", config);
      for (const factor of result.factors) {
        expect(factor).toHaveProperty("name");
        expect(factor).toHaveProperty("weight");
        expect(factor).toHaveProperty("detected");
        expect(factor).toHaveProperty("description");
        expect(typeof factor.weight).toBe("number");
        expect(typeof factor.detected).toBe("boolean");
      }
    });
  });
});
