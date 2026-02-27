import { describe, it, expect } from "vitest";
import {
  parseSourceCode,
  findCallsByMethodName,
  findPropertyAccessCalls,
  getDescribeDepth,
  getTestTitles,
  countAwaitExpressions,
  countNavigationCalls,
  findModuleLevelMutableDeclarations,
  hasTemplateLiteralArgument,
  getLineNumber,
} from "../src/utils/astParser.js";

describe("astParser", () => {
  describe("parseSourceCode", () => {
    it("parses valid TypeScript code without throwing", () => {
      const code = `const x: number = 1;`;
      expect(() => parseSourceCode(code)).not.toThrow();
    });

    it("returns a SourceFile node", () => {
      const code = `const x = 1;`;
      const sf = parseSourceCode(code);
      expect(sf.statements.length).toBeGreaterThan(0);
    });
  });

  describe("findCallsByMethodName", () => {
    it("finds direct function calls", () => {
      const sf = parseSourceCode(`describe('test', () => {});`);
      const calls = findCallsByMethodName(sf, "describe");
      expect(calls).toHaveLength(1);
    });

    it("finds property access calls", () => {
      const sf = parseSourceCode(`page.goto('/home');`);
      const calls = findCallsByMethodName(sf, "goto");
      expect(calls).toHaveLength(1);
    });

    it("returns empty for missing methods", () => {
      const sf = parseSourceCode(`console.log('hello');`);
      const calls = findCallsByMethodName(sf, "goto");
      expect(calls).toHaveLength(0);
    });
  });

  describe("findPropertyAccessCalls", () => {
    it("finds object.method calls", () => {
      const sf = parseSourceCode(`Math.random();`);
      const calls = findPropertyAccessCalls(sf, "Math", "random");
      expect(calls).toHaveLength(1);
    });

    it("does not match different object", () => {
      const sf = parseSourceCode(`other.random();`);
      const calls = findPropertyAccessCalls(sf, "Math", "random");
      expect(calls).toHaveLength(0);
    });
  });

  describe("getDescribeDepth", () => {
    it("returns 0 for no describe blocks", () => {
      const sf = parseSourceCode(`test('flat', () => {});`);
      expect(getDescribeDepth(sf)).toBe(0);
    });

    it("returns 1 for single describe", () => {
      const sf = parseSourceCode(`describe('suite', () => { it('test', () => {}); });`);
      expect(getDescribeDepth(sf)).toBe(1);
    });

    it("returns correct depth for nested describes", () => {
      const sf = parseSourceCode(`
        describe('l1', () => {
          describe('l2', () => {
            describe('l3', () => {
              it('test', () => {});
            });
          });
        });
      `);
      expect(getDescribeDepth(sf)).toBe(3);
    });
  });

  describe("getTestTitles", () => {
    it("extracts it() titles", () => {
      const sf = parseSourceCode(`
        it('first test', () => {});
        it('second test', () => {});
      `);
      expect(getTestTitles(sf)).toEqual(["first test", "second test"]);
    });

    it("extracts test() titles", () => {
      const sf = parseSourceCode(`test('my test', () => {});`);
      expect(getTestTitles(sf)).toEqual(["my test"]);
    });
  });

  describe("countAwaitExpressions", () => {
    it("counts await statements", () => {
      const sf = parseSourceCode(`
        async function run() {
          await a();
          await b();
          await c();
        }
      `);
      expect(countAwaitExpressions(sf)).toBe(3);
    });

    it("returns 0 for sync code", () => {
      const sf = parseSourceCode(`const x = 1 + 2;`);
      expect(countAwaitExpressions(sf)).toBe(0);
    });
  });

  describe("countNavigationCalls", () => {
    it("counts goto calls for Playwright", () => {
      const sf = parseSourceCode(`
        await page.goto('/a');
        await page.goto('/b');
      `);
      expect(countNavigationCalls(sf, "playwright")).toBe(2);
    });

    it("counts visit calls for Cypress", () => {
      const sf = parseSourceCode(`
        cy.visit('/a');
        cy.visit('/b');
      `);
      expect(countNavigationCalls(sf, "cypress")).toBe(2);
    });
  });

  describe("findModuleLevelMutableDeclarations", () => {
    it("finds let declarations", () => {
      const sf = parseSourceCode(`let x = 1;`);
      expect(findModuleLevelMutableDeclarations(sf)).toHaveLength(1);
    });

    it("finds var declarations", () => {
      const sf = parseSourceCode(`var x = 1;`);
      expect(findModuleLevelMutableDeclarations(sf)).toHaveLength(1);
    });

    it("ignores const declarations", () => {
      const sf = parseSourceCode(`const x = 1;`);
      expect(findModuleLevelMutableDeclarations(sf)).toHaveLength(0);
    });
  });

  describe("hasTemplateLiteralArgument", () => {
    it("detects template literal arguments", () => {
      const sf = parseSourceCode("page.locator(`div.${cls}`);");
      const calls = findCallsByMethodName(sf, "locator");
      expect(calls).toHaveLength(1);
      expect(hasTemplateLiteralArgument(calls[0]!)).toBe(true);
    });

    it("returns false for string literal arguments", () => {
      const sf = parseSourceCode(`page.locator('[data-testid="btn"]');`);
      const calls = findCallsByMethodName(sf, "locator");
      expect(calls).toHaveLength(1);
      expect(hasTemplateLiteralArgument(calls[0]!)).toBe(false);
    });
  });

  describe("getLineNumber", () => {
    it("returns correct 1-based line number", () => {
      const code = `const a = 1;\nconst b = 2;\nfoo();`;
      const sf = parseSourceCode(code);
      const calls = findCallsByMethodName(sf, "foo");
      expect(calls).toHaveLength(1);
      expect(getLineNumber(calls[0]!, sf)).toBe(3);
    });
  });
});
