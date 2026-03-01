import { describe, it, expect } from "vitest";
import { parseSourceCode } from "../src/utils/astParser.js";
import { validateDeterminism } from "../src/validators/determinism.js";
import { validateArchitecture } from "../src/validators/architecture.js";
import { detectFrameworkFromSource } from "../src/utils/frameworkDetector.js";
import { countBySeverity } from "../src/utils/enforcement.js";
import { DEFAULT_RULES } from "../src/config/defaultRules.js";

describe("violation severity classification — determinism", () => {
  it("waitForTimeout is classified as critical", () => {
    const code = `
      test('x', async ({ page }) => {
        await page.waitForTimeout(500);
      });
    `;
    const result = validateDeterminism(parseSourceCode(code), "playwright", DEFAULT_RULES.determinism);
    const v = result.violations.find((v) => v.rule === "no-wait-for-timeout");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("critical");
  });

  it("setTimeout / hard sleep is classified as critical", () => {
    const code = `
      test('x', async () => {
        await new Promise(r => setTimeout(r, 2000));
      });
    `;
    const result = validateDeterminism(parseSourceCode(code), "playwright", DEFAULT_RULES.determinism);
    const v = result.violations.find((v) => v.rule === "no-hard-sleep");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("critical");
  });

  it("while(true) unbounded retry is classified as critical", () => {
    const code = `
      test('x', async () => {
        while(true) { break; }
      });
    `;
    const result = validateDeterminism(parseSourceCode(code), "playwright", DEFAULT_RULES.determinism);
    const v = result.violations.find((v) => v.rule === "no-unbounded-retry");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("critical");
  });

  it("Math.random is classified as major", () => {
    const code = `
      test('x', () => {
        const x = Math.random();
      });
    `;
    const result = validateDeterminism(parseSourceCode(code), "playwright", DEFAULT_RULES.determinism);
    const v = result.violations.find((v) => v.rule === "no-random-without-seed");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("major");
  });

  it("unmocked fetch is classified as major", () => {
    const code = `
      test('x', async () => {
        await fetch('/api');
      });
    `;
    const result = validateDeterminism(parseSourceCode(code), "playwright", DEFAULT_RULES.determinism);
    const v = result.violations.find((v) => v.rule === "no-unmocked-network");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("major");
  });

  it("dynamic template literal selector is classified as major", () => {
    const code = `
      test('x', async ({ page }) => {
        const id = 'foo';
        await page.locator(\`#\${id}\`).click();
      });
    `;
    const result = validateDeterminism(parseSourceCode(code), "playwright", DEFAULT_RULES.determinism);
    const v = result.violations.find((v) => v.rule === "no-dynamic-selector");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("major");
  });

  it("each violation has severity, rule, and message properties", () => {
    const code = `
      test('x', async ({ page }) => {
        await page.waitForTimeout(100);
      });
    `;
    const result = validateDeterminism(parseSourceCode(code), "playwright", DEFAULT_RULES.determinism);
    expect(result.violations.length).toBeGreaterThan(0);
    for (const v of result.violations) {
      expect(v).toHaveProperty("severity");
      expect(v).toHaveProperty("rule");
      expect(v).toHaveProperty("message");
      expect(["critical", "major", "minor"]).toContain(v.severity);
    }
  });
});

describe("violation severity classification — architecture", () => {
  it("module-level mutable state is classified as critical", () => {
    const code = `
      let count = 0;
      test('x', () => { count++; });
    `;
    const result = validateArchitecture(parseSourceCode(code), "playwright", DEFAULT_RULES.architecture);
    const v = result.violations.find((v) => v.rule === "no-global-state");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("critical");
  });

  it("excessive nesting is classified as minor", () => {
    const code = `
      describe('l1', () => {
        describe('l2', () => {
          describe('l3', () => {
            it('x', () => {});
          });
        });
      });
    `;
    const result = validateArchitecture(parseSourceCode(code), "playwright", DEFAULT_RULES.architecture);
    const v = result.violations.find((v) => v.rule === "no-deep-nesting");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("minor");
  });

  it("duplicate test title is classified as minor", () => {
    const code = `
      it('same title', () => {});
      it('same title', () => {});
    `;
    const result = validateArchitecture(parseSourceCode(code), "playwright", DEFAULT_RULES.architecture);
    const v = result.violations.find((v) => v.rule === "no-duplicate-title");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("minor");
  });

  it("raw CSS class selector is classified as major", () => {
    const code = `
      test('x', async ({ page }) => {
        await page.locator('.some-class').click();
      });
    `;
    const result = validateArchitecture(parseSourceCode(code), "playwright", DEFAULT_RULES.architecture);
    const v = result.violations.find((v) => v.rule === "no-raw-selector");
    expect(v).toBeDefined();
    expect(["major", "critical"]).toContain(v?.severity);
  });
});

describe("countBySeverity utility", () => {
  it("counts zero for empty violations", () => {
    const counts = countBySeverity([]);
    expect(counts).toEqual({ criticalCount: 0, majorCount: 0, minorCount: 0 });
  });

  it("correctly counts mixed severities", () => {
    const violations = [
      { severity: "critical" as const, rule: "a", message: "m" },
      { severity: "critical" as const, rule: "b", message: "m" },
      { severity: "major" as const, rule: "c", message: "m" },
      { severity: "minor" as const, rule: "d", message: "m" },
      { severity: "minor" as const, rule: "e", message: "m" },
      { severity: "minor" as const, rule: "f", message: "m" },
    ];
    const counts = countBySeverity(violations);
    expect(counts.criticalCount).toBe(2);
    expect(counts.majorCount).toBe(1);
    expect(counts.minorCount).toBe(3);
  });
});

describe("k6 framework detection", () => {
  it("detects k6 import and marks as unsupported", () => {
    const code = `
      import http from 'k6/http';
      import { sleep } from 'k6';
      export default function() {
        http.get('https://test.k6.io');
        sleep(1);
      }
    `;
    const detection = detectFrameworkFromSource(parseSourceCode(code));
    expect(detection.detected).toBe("k6");
    expect(detection.isSupported).toBe(false);
    expect(detection.indicators.length).toBeGreaterThan(0);
  });

  it("detects Playwright import as supported", () => {
    const code = `
      import { test, expect } from '@playwright/test';
      test('x', async ({ page }) => {});
    `;
    const detection = detectFrameworkFromSource(parseSourceCode(code));
    expect(detection.detected).toBe("playwright");
    expect(detection.isSupported).toBe(true);
  });

  it("detects Cypress import as supported", () => {
    const code = `
      import cypress from 'cypress';
      it('x', () => {});
    `;
    const detection = detectFrameworkFromSource(parseSourceCode(code));
    expect(detection.detected).toBe("cypress");
    expect(detection.isSupported).toBe(true);
  });

  it("returns null detected for code with no framework imports", () => {
    const code = `
      function add(a, b) { return a + b; }
    `;
    const detection = detectFrameworkFromSource(parseSourceCode(code));
    expect(detection.detected).toBeNull();
    expect(detection.isSupported).toBe(true);
  });

  it("detects k6 via require", () => {
    const code = `
      const http = require('k6/http');
      export default function() {}
    `;
    const detection = detectFrameworkFromSource(parseSourceCode(code));
    expect(detection.detected).toBe("k6");
    expect(detection.isSupported).toBe(false);
  });
});
