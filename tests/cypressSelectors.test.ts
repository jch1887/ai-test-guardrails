import { describe, it, expect } from "vitest";
import { parseSourceCode } from "../src/utils/astParser.js";
import { validateArchitecture } from "../src/validators/architecture.js";
import { DEFAULT_RULES } from "../src/config/defaultRules.js";

const config = DEFAULT_RULES.architecture;

function archViolations(code: string, framework: "playwright" | "cypress") {
  return validateArchitecture(parseSourceCode(code), framework, config).violations;
}

describe("Cypress selector patterns", () => {
  describe("stable selector allowlist", () => {
    it("allows data-cy attribute selectors", () => {
      const v = archViolations(
        `it('x', () => { cy.get('[data-cy=submit]').click(); });`,
        "cypress",
      );
      expect(v.filter((x) => x.rule === "no-raw-selector")).toHaveLength(0);
    });

    it("allows data-test and data-testid attribute selectors", () => {
      const v = archViolations(
        `it('x', () => { cy.get('[data-test=submit]').click(); cy.get('[data-testid="ok"]').click(); });`,
        "cypress",
      );
      expect(v.filter((x) => x.rule === "no-raw-selector")).toHaveLength(0);
    });

    it("still flags class and id selectors in cy.get and cy.find", () => {
      const v = archViolations(
        `it('x', () => { cy.get('.btn').click(); cy.get('form').find('#email').type('a'); });`,
        "cypress",
      );
      expect(v.filter((x) => x.rule === "no-raw-selector")).toHaveLength(2);
    });
  });

  describe("positional selectors", () => {
    it("flags .eq(n) as major", () => {
      const v = archViolations(`it('x', () => { cy.get('li').eq(2).click(); });`, "cypress");
      const hit = v.find((x) => x.rule === "no-positional-selector");
      expect(hit).toBeDefined();
      expect(hit?.severity).toBe("major");
      expect(hit?.message).toContain(".eq()");
    });

    it("flags .first() and .last() as minor", () => {
      const v = archViolations(
        `it('x', () => { cy.get('li').first().click(); cy.get('li').last().click(); });`,
        "cypress",
      );
      const hits = v.filter((x) => x.rule === "no-positional-selector");
      expect(hits).toHaveLength(2);
      expect(hits.every((x) => x.severity === "minor")).toBe(true);
    });

    it("flags :nth-child and :eq pseudo-classes inside selector strings", () => {
      const v = archViolations(
        `it('x', () => { cy.get('ul li:nth-child(3)').click(); cy.get('li:eq(0)').click(); });`,
        "cypress",
      );
      const hits = v.filter((x) => x.rule === "no-positional-selector");
      expect(hits).toHaveLength(2);
      expect(hits.every((x) => x.severity === "major")).toBe(true);
    });

    it("flags .nth(n) in Playwright but not .eq()", () => {
      const v = archViolations(
        `test('x', async ({ page }) => { await page.getByRole('row').nth(1).click(); });`,
        "playwright",
      );
      const hits = v.filter((x) => x.rule === "no-positional-selector");
      expect(hits).toHaveLength(1);
      expect(hits[0]?.message).toContain(".nth()");
    });

    it("does not flag bare function calls named first or eq", () => {
      const v = archViolations(`it('x', () => { first(); eq(1); });`, "cypress");
      expect(v.filter((x) => x.rule === "no-positional-selector")).toHaveLength(0);
    });

    it("can be disabled through config", () => {
      const disabled = { ...config, detectPositionalSelectors: false };
      const v = validateArchitecture(
        parseSourceCode(`it('x', () => { cy.get('li').eq(2).click(); });`),
        "cypress",
        disabled,
      ).violations;
      expect(v.filter((x) => x.rule === "no-positional-selector")).toHaveLength(0);
    });
  });

  describe("forced actions", () => {
    it("flags { force: true } on Cypress actions as major", () => {
      const v = archViolations(
        `it('x', () => { cy.get('[data-cy=submit]').click({ force: true }); });`,
        "cypress",
      );
      const hit = v.find((x) => x.rule === "no-force-action");
      expect(hit).toBeDefined();
      expect(hit?.severity).toBe("major");
      expect(hit?.message).toContain(".click()");
      expect(hit?.suggestion).toContain("should('be.visible')");
    });

    it("flags { force: true } on Playwright actions", () => {
      const v = archViolations(
        `test('x', async ({ page }) => { await page.getByTestId('a').fill('x', { force: true }); });`,
        "playwright",
      );
      const hit = v.find((x) => x.rule === "no-force-action");
      expect(hit).toBeDefined();
      expect(hit?.suggestion).toContain("toBeEnabled");
    });

    it("does not flag force: false or unrelated options", () => {
      const v = archViolations(
        `it('x', () => { cy.get('[data-cy=a]').click({ force: false, timeout: 1000 }); });`,
        "cypress",
      );
      expect(v.filter((x) => x.rule === "no-force-action")).toHaveLength(0);
    });

    it("can be disabled through config", () => {
      const disabled = { ...config, detectForcedActions: false };
      const v = validateArchitecture(
        parseSourceCode(`it('x', () => { cy.get('[data-cy=a]').click({ force: true }); });`),
        "cypress",
        disabled,
      ).violations;
      expect(v.filter((x) => x.rule === "no-force-action")).toHaveLength(0);
    });
  });

  it("architecture score accounts for the two new checks", () => {
    const clean = validateArchitecture(
      parseSourceCode(`it('x', () => { cy.get('[data-cy=a]').click(); });`),
      "cypress",
      config,
    );
    expect(clean.score).toBe(1);
    const dirty = validateArchitecture(
      parseSourceCode(`it('x', () => { cy.get('li').eq(1).click({ force: true }); });`),
      "cypress",
      config,
    );
    // 6 built-in checks, 2 failing
    expect(dirty.score).toBeCloseTo(4 / 6);
  });
});
