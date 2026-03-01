import { describe, it, expect } from "vitest";
import { parseSourceCode } from "../src/utils/astParser.js";
import { validateDeterminism } from "../src/validators/determinism.js";
import { DEFAULT_RULES } from "../src/config/defaultRules.js";

const config = DEFAULT_RULES.determinism;

describe("determinism validator", () => {
  describe("waitForTimeout detection", () => {
    it("flags waitForTimeout in Playwright tests", () => {
      const code = `
        test('example', async ({ page }) => {
          await page.waitForTimeout(1000);
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "playwright", config);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.some((v) => v.message.includes("waitForTimeout"))).toBe(true);
    });

    it("flags cy.wait with numeric argument in Cypress tests", () => {
      const code = `
        it('example', () => {
          cy.wait(1000);
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "cypress", config);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.some((v) => v.message.includes("cy.wait"))).toBe(true);
    });

    it("does not flag cy.wait with alias argument", () => {
      const code = `
        it('example', () => {
          cy.wait('@apiCall');
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "cypress", config);
      expect(result.violations.filter((v) => v.message.includes("cy.wait"))).toHaveLength(0);
    });
  });

  describe("hard sleep detection", () => {
    it("flags setTimeout usage", () => {
      const code = `
        test('example', async () => {
          await new Promise(r => setTimeout(r, 2000));
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.message.includes("setTimeout"))).toBe(true);
    });

    it("flags sleep() calls", () => {
      const code = `
        test('example', async () => {
          await sleep(1000);
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.message.includes("sleep()"))).toBe(true);
    });
  });

  describe("Math.random detection", () => {
    it("flags Math.random()", () => {
      const code = `
        test('example', () => {
          const value = Math.random();
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.message.includes("Math.random"))).toBe(true);
    });
  });

  describe("unbounded retry detection", () => {
    it("flags while(true) loops", () => {
      const code = `
        test('example', async () => {
          while(true) {
            const el = await page.$('.target');
            if (el) break;
          }
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.message.includes("while(true)"))).toBe(true);
    });

    it("flags infinite for loops", () => {
      const code = `
        test('example', async () => {
          for(;;) {
            const el = await page.$('.target');
            if (el) break;
          }
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.message.includes("Infinite for loop"))).toBe(true);
    });
  });

  describe("unmocked network call detection", () => {
    it("flags fetch without mocking", () => {
      const code = `
        test('example', async () => {
          const data = await fetch('/api/users');
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.message.includes("fetch()"))).toBe(true);
    });

    it("does not flag fetch when route mocking is present", () => {
      const code = `
        test('example', async ({ page }) => {
          await page.route('/api/users', (route) => route.fulfill({ body: '[]' }));
          const data = await fetch('/api/users');
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "playwright", config);
      expect(result.violations.filter((v) => v.message.includes("fetch()"))).toHaveLength(0);
    });

    it("flags axios calls without mocking", () => {
      const code = `
        test('example', async () => {
          const res = await axios.get('/api/data');
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.message.includes("axios"))).toBe(true);
    });
  });

  describe("dynamic selector detection", () => {
    it("flags template literal selectors in Playwright", () => {
      const code = `
        test('example', async ({ page }) => {
          const id = getUserId();
          await page.locator(\`[data-id="\${id}"]\`).click();
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "playwright", config);
      expect(result.violations.some((v) => v.message.includes("template literal"))).toBe(true);
    });

    it("flags template literal selectors in Cypress", () => {
      const code = `
        it('example', () => {
          const id = getUserId();
          cy.get(\`[data-id="\${id}"]\`);
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "cypress", config);
      expect(result.violations.some((v) => v.message.includes("template literal"))).toBe(true);
    });
  });

  describe("scoring", () => {
    it("returns score of 1 for clean code", () => {
      const code = `
        test('example', async ({ page }) => {
          await page.goto('/');
          await expect(page.locator('[data-testid="header"]')).toBeVisible();
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "playwright", config);
      expect(result.violations).toHaveLength(0);
      expect(result.score).toBe(1);
    });

    it("returns score less than 1 for code with violations", () => {
      const code = `
        test('example', async ({ page }) => {
          await page.waitForTimeout(1000);
          const val = Math.random();
        });
      `;
      const result = validateDeterminism(parseSourceCode(code), "playwright", config);
      expect(result.score).toBeLessThan(1);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });
});
