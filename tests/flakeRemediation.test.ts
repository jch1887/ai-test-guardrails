import { describe, it, expect } from "vitest";
import { parseSourceCode } from "../src/utils/astParser.js";
import { scoreFlakeRisk } from "../src/validators/flakeRisk.js";
import { DEFAULT_RULES } from "../src/config/defaultRules.js";

const CODE = `test('x', async ({ page }) => { await page.goto('/'); });`;

describe("flake risk factor remediation", () => {
  it("every factor carries a non-empty remediation", () => {
    const { factors } = scoreFlakeRisk(
      parseSourceCode(CODE),
      "playwright",
      DEFAULT_RULES.flakeRisk,
    );
    expect(factors).toHaveLength(5);
    for (const factor of factors) {
      expect(factor.remediation.length).toBeGreaterThan(30);
      expect(factor.remediation).not.toBe(factor.description);
    }
  });

  it("remediation is framework-specific", () => {
    const pw = scoreFlakeRisk(parseSourceCode(CODE), "playwright", DEFAULT_RULES.flakeRisk).factors;
    const cy = scoreFlakeRisk(parseSourceCode(CODE), "cypress", DEFAULT_RULES.flakeRisk).factors;
    const network = (list: typeof pw) =>
      list.find((f) => f.name === "network-dependency")?.remediation;
    const timing = (list: typeof pw) =>
      list.find((f) => f.name === "timing-assertions")?.remediation;
    expect(network(pw)).toContain("page.route");
    expect(network(cy)).toContain("cy.intercept");
    expect(timing(pw)).toContain("toBeVisible");
    expect(timing(cy)).toContain("should('be.visible')");
  });
});
