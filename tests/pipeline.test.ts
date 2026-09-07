import { describe, it, expect } from "vitest";
import { parseSourceCode } from "../src/utils/astParser.js";
import { validateSource } from "../src/validators/pipeline.js";
import { DEFAULT_THRESHOLDS } from "../src/utils/enforcement.js";
import { DEFAULT_RULES } from "../src/config/defaultRules.js";
import {
  checkUnsupportedFramework,
  createServer,
  SUPPORTED_FRAMEWORKS,
} from "../src/createServer.js";
import { PACKAGE_VERSION } from "../src/version.js";
import { loadRuntimeConfig } from "../src/config/loadConfig.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const BAD = `
import { test } from '@playwright/test';
let shared = 0;
test('login', async ({ page }) => {
  await page.waitForTimeout(1000);
  await page.locator('.bad').click();
});
`;

describe("validateSource pipeline", () => {
  it("combines determinism and architecture violations and resolves policy", () => {
    const result = validateSource(parseSourceCode(BAD), "playwright", "warn", DEFAULT_THRESHOLDS);
    expect(result.valid).toBe(false);
    expect(result.policy.action).toBe("REJECTED");
    expect(result.policy.detected.determinismViolations).toBe(1);
    expect(result.policy.detected.architectureViolations).toBe(2);
    expect(result.policy.detected.criticalCount).toBe(2);
    expect(result.violations.every((v) => typeof v.suggestion === "string")).toBe(true);
  });

  it("respects rule overrides", () => {
    const rules = {
      ...DEFAULT_RULES,
      determinism: { ...DEFAULT_RULES.determinism, detectWaitForTimeout: false },
    };
    const result = validateSource(parseSourceCode(BAD), "playwright", "warn", DEFAULT_THRESHOLDS, {
      rules,
    });
    expect(result.policy.detected.determinismViolations).toBe(0);
    expect(result.determinismScore).toBe(1);
  });

  it("advisory mode never rejects", () => {
    const result = validateSource(
      parseSourceCode(BAD),
      "playwright",
      "advisory",
      DEFAULT_THRESHOLDS,
    );
    expect(result.valid).toBe(true);
    expect(result.policy.action).toBe("ADVISED");
  });
});

describe("server wiring", () => {
  it("PACKAGE_VERSION matches package.json", () => {
    expect(PACKAGE_VERSION).toBe(pkg.version);
  });

  it("checkUnsupportedFramework rejects k6 and lists supported frameworks", () => {
    const result = checkUnsupportedFramework(parseSourceCode(`import http from 'k6/http';`));
    expect(result?.supported).toBe(false);
    expect(result?.detectedFramework).toBe("k6");
    expect(result?.supportedFrameworks).toEqual(SUPPORTED_FRAMEWORKS);
    expect(result?.message).not.toMatch(/v\d/);
  });

  it("checkUnsupportedFramework passes Playwright, Cypress, and unknown sources", () => {
    expect(
      checkUnsupportedFramework(parseSourceCode(`import { test } from '@playwright/test';`)),
    ).toBeNull();
    expect(checkUnsupportedFramework(parseSourceCode(`import 'cypress';`))).toBeNull();
    expect(checkUnsupportedFramework(parseSourceCode(`const a = 1;`))).toBeNull();
  });

  it("createServer builds a server from the default runtime config", async () => {
    const runtime = await loadRuntimeConfig({ argv: [], env: {}, cwd: process.cwd() });
    const server = createServer(runtime);
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });
});
