import ts from "typescript";
import { walkAst } from "./astParser.js";

const K6_INDICATORS = ["k6/http", "k6/metrics", "k6/checks", "k6"];
const PLAYWRIGHT_INDICATORS = ["@playwright/test", "playwright"];
const CYPRESS_INDICATORS = ["cypress"];

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

  const k6Matches = imports.filter((i) => K6_INDICATORS.some((k) => i.startsWith(k)));
  if (k6Matches.length > 0) {
    return { detected: "k6", isSupported: false, indicators: k6Matches };
  }

  const pwMatches = imports.filter((i) => PLAYWRIGHT_INDICATORS.some((p) => i.includes(p)));
  if (pwMatches.length > 0) {
    return { detected: "playwright", isSupported: true, indicators: pwMatches };
  }

  const cyMatches = imports.filter((i) => CYPRESS_INDICATORS.some((c) => i.includes(c)));
  if (cyMatches.length > 0) {
    return { detected: "cypress", isSupported: true, indicators: cyMatches };
  }

  return { detected: null, isSupported: true, indicators: [] };
}
