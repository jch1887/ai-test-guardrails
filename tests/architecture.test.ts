import { describe, it, expect } from "vitest";
import { parseSourceCode } from "../src/utils/astParser.js";
import { validateArchitecture } from "../src/validators/architecture.js";
import { DEFAULT_RULES } from "../src/config/defaultRules.js";

const config = DEFAULT_RULES.architecture;

describe("architecture validator", () => {
  describe("direct selector detection", () => {
    it("flags CSS class selectors in Playwright", () => {
      const code = `
        test('example', async ({ page }) => {
          await page.locator('.some-class').click();
        });
      `;
      const result = validateArchitecture(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.includes("Direct CSS selector"))).toBe(true);
    });

    it("flags CSS ID selectors in Playwright", () => {
      const code = `
        test('example', async ({ page }) => {
          await page.locator('#login-button').click();
        });
      `;
      const result = validateArchitecture(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.includes("Direct CSS selector"))).toBe(true);
    });

    it("flags CSS selectors in Cypress", () => {
      const code = `
        it('example', () => {
          cy.get('.submit-btn').click();
        });
      `;
      const result = validateArchitecture(parseSourceCode(code), "cypress", config);
      expect(result.violations.some((v) => v.includes("Direct CSS selector"))).toBe(true);
    });

    it("allows data-testid selectors", () => {
      const code = `
        test('example', async ({ page }) => {
          await page.locator('[data-testid="header"]').click();
        });
      `;
      const result = validateArchitecture(parseSourceCode(code), "playwright", config);
      expect(result.violations.filter((v) => v.includes("Direct CSS selector"))).toHaveLength(0);
    });

    it("allows role-based selectors", () => {
      const code = `
        test('example', async ({ page }) => {
          await page.locator('role=button[name="Submit"]').click();
        });
      `;
      const result = validateArchitecture(parseSourceCode(code), "playwright", config);
      expect(result.violations.filter((v) => v.includes("Direct CSS selector"))).toHaveLength(0);
    });
  });

  describe("global state detection", () => {
    it("flags module-level let declarations", () => {
      const code = `
        let counter = 0;
        test('test1', () => { counter++; });
        test('test2', () => { expect(counter).toBe(1); });
      `;
      const result = validateArchitecture(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.includes("Module-level mutable variable"))).toBe(
        true,
      );
    });

    it("flags module-level var declarations", () => {
      const code = `
        var sharedData = {};
        test('test1', () => {});
      `;
      const result = validateArchitecture(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.includes("Module-level mutable variable"))).toBe(
        true,
      );
    });

    it("allows module-level const declarations", () => {
      const code = `
        const BASE_URL = 'http://localhost:3000';
        test('test1', async ({ page }) => {
          await page.goto(BASE_URL);
        });
      `;
      const result = validateArchitecture(parseSourceCode(code), "playwright", config);
      expect(result.violations.filter((v) => v.includes("Module-level mutable"))).toHaveLength(0);
    });
  });

  describe("nesting depth detection", () => {
    it("flags excessive describe nesting beyond depth 2", () => {
      const code = `
        describe('level 1', () => {
          describe('level 2', () => {
            describe('level 3', () => {
              it('test', () => {});
            });
          });
        });
      `;
      const result = validateArchitecture(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.includes("nesting depth"))).toBe(true);
    });

    it("allows nesting at exactly depth 2", () => {
      const code = `
        describe('level 1', () => {
          describe('level 2', () => {
            it('test', () => {});
          });
        });
      `;
      const result = validateArchitecture(parseSourceCode(code), "playwright", config);
      expect(result.violations.filter((v) => v.includes("nesting depth"))).toHaveLength(0);
    });
  });

  describe("duplicate test title detection", () => {
    it("flags duplicate test titles", () => {
      const code = `
        it('should work', () => {});
        it('should work', () => {});
      `;
      const result = validateArchitecture(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.includes("Duplicate test title"))).toBe(true);
    });

    it("allows unique test titles", () => {
      const code = `
        it('should work A', () => {});
        it('should work B', () => {});
      `;
      const result = validateArchitecture(parseSourceCode(code), "playwright", config);
      expect(result.violations.filter((v) => v.includes("Duplicate test title"))).toHaveLength(0);
    });
  });

  describe("scoring", () => {
    it("returns score 1 for fully compliant code", () => {
      const code = `
        const CONFIG = { url: '/' };
        describe('feature', () => {
          it('should load', async ({ page }) => {
            await page.locator('[data-testid="header"]').toBeVisible();
          });
          it('should display', async ({ page }) => {
            await page.locator('[data-testid="content"]').toBeVisible();
          });
        });
      `;
      const result = validateArchitecture(parseSourceCode(code), "playwright", config);
      expect(result.valid).toBe(true);
      expect(result.score).toBe(1);
    });

    it("returns valid: false when violations exist", () => {
      const code = `
        let state = {};
        it('test', async ({ page }) => {
          await page.locator('.bad-selector').click();
        });
        it('test', () => {});
      `;
      const result = validateArchitecture(parseSourceCode(code), "playwright", config);
      expect(result.valid).toBe(false);
      expect(result.score).toBeLessThan(1);
    });
  });
});
