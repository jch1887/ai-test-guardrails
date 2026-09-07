import ts from "typescript";
import { walkAst } from "./astParser.js";

/**
 * Package names (and scopes) that identify a framework. A specifier matches when it
 * is exactly the package name or a subpath of it (`cypress/react`, `k6/http`), or when
 * it lives under a listed scope (`@playwright/test`). Relative imports such as
 * `./playwright-helpers` never match.
 */
interface FrameworkSignature {
  packages: string[];
  scopes: string[];
  /** Remote module hosts, used by k6 scripts that import from jslib.k6.io. */
  hosts: string[];
}

const K6_SIGNATURE: FrameworkSignature = {
  packages: ["k6"],
  scopes: [],
  hosts: ["jslib.k6.io"],
};

const PLAYWRIGHT_SIGNATURE: FrameworkSignature = {
  packages: ["playwright", "playwright-core"],
  scopes: ["@playwright"],
  hosts: [],
};

const CYPRESS_SIGNATURE: FrameworkSignature = {
  packages: ["cypress", "@testing-library/cypress"],
  scopes: ["@cypress"],
  hosts: [],
};

function isPackageOrSubpath(specifier: string, pkg: string): boolean {
  return specifier === pkg || specifier.startsWith(`${pkg}/`);
}

function matchesSignature(specifier: string, signature: FrameworkSignature): boolean {
  if (signature.packages.some((pkg) => isPackageOrSubpath(specifier, pkg))) return true;
  if (signature.scopes.some((scope) => specifier.startsWith(`${scope}/`))) return true;
  if (signature.hosts.length > 0 && /^https?:\/\//.test(specifier)) {
    try {
      const host = new URL(specifier).hostname;
      return signature.hosts.includes(host);
    } catch {
      return false;
    }
  }
  return false;
}

export interface FrameworkDetectionResult {
  detected: string | null;
  isSupported: boolean;
  indicators: string[];
}

export function detectFrameworkFromSource(sourceFile: ts.SourceFile): FrameworkDetectionResult {
  const imports: string[] = [];

  walkAst(sourceFile, (node) => {
    if (ts.isImportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (ts.isStringLiteral(specifier)) {
        imports.push(specifier.text);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      const firstArg = node.arguments[0];
      if (firstArg && ts.isStringLiteral(firstArg)) {
        imports.push(firstArg.text);
      }
    }
  });

  const k6Matches = imports.filter((i) => matchesSignature(i, K6_SIGNATURE));
  if (k6Matches.length > 0) {
    return { detected: "k6", isSupported: false, indicators: k6Matches };
  }

  const pwMatches = imports.filter((i) => matchesSignature(i, PLAYWRIGHT_SIGNATURE));
  if (pwMatches.length > 0) {
    return { detected: "playwright", isSupported: true, indicators: pwMatches };
  }

  const cyMatches = imports.filter((i) => matchesSignature(i, CYPRESS_SIGNATURE));
  if (cyMatches.length > 0) {
    return { detected: "cypress", isSupported: true, indicators: cyMatches };
  }

  return { detected: null, isSupported: true, indicators: [] };
}
