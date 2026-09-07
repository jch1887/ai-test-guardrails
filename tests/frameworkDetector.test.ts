import { describe, it, expect } from "vitest";
import { parseSourceCode } from "../src/utils/astParser.js";
import { detectFrameworkFromSource } from "../src/utils/frameworkDetector.js";

function detect(code: string) {
  return detectFrameworkFromSource(parseSourceCode(code));
}

describe("framework detection on package boundaries", () => {
  it.each([
    ["@playwright/test", `import { test } from '@playwright/test';`],
    [
      "@playwright scoped component testing",
      `import { test } from '@playwright/experimental-ct-react';`,
    ],
    ["playwright", `import { chromium } from 'playwright';`],
    ["playwright-core", `import { chromium } from 'playwright-core';`],
    ["playwright subpath", `import x from 'playwright/test';`],
    ["require('playwright')", `const { test } = require('playwright');`],
  ])("detects Playwright from %s", (_label, code) => {
    const result = detect(code);
    expect(result.detected).toBe("playwright");
    expect(result.isSupported).toBe(true);
  });

  it.each([
    ["cypress", `import cypress from 'cypress';`],
    ["cypress subpath", `import { mount } from 'cypress/react';`],
    ["@cypress scope", `import { defineConfig } from '@cypress/vite-dev-server';`],
    ["@testing-library/cypress", `import '@testing-library/cypress/add-commands';`],
  ])("detects Cypress from %s", (_label, code) => {
    expect(detect(code).detected).toBe("cypress");
  });

  it.each([
    ["k6", `import { sleep } from 'k6';`],
    ["k6 subpath", `import http from 'k6/http';`],
    [
      "jslib.k6.io remote module",
      `import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';`,
    ],
  ])("detects k6 from %s and marks it unsupported", (_label, code) => {
    const result = detect(code);
    expect(result.detected).toBe("k6");
    expect(result.isSupported).toBe(false);
  });

  it.each([
    ["relative helper named after Playwright", `import { login } from './playwright-helpers';`],
    ["relative Cypress support path", `import '../support/cypress-commands';`],
    ["look-alike package name", `import x from 'my-cypress-wrapper';`],
    ["package starting with k6", `import x from 'k6-utils';`],
    ["playwright-like scoped package", `import x from '@acme/playwright-tools';`],
    ["remote module from another host", `import x from 'https://example.com/k6.js';`],
  ])("does not match %s", (_label, code) => {
    const result = detect(code);
    expect(result.detected).toBeNull();
    expect(result.indicators).toEqual([]);
  });

  it("reports the matching specifiers as indicators", () => {
    const result = detect(
      `import { test } from '@playwright/test';\nimport { helper } from './helper';`,
    );
    expect(result.indicators).toEqual(["@playwright/test"]);
  });

  it("prefers k6 when a file mixes k6 and other imports", () => {
    expect(detect(`import http from 'k6/http';\nimport 'cypress';`).detected).toBe("k6");
  });
});
