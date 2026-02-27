import ts from "typescript";

export function parseSourceCode(code: string): ts.SourceFile {
  return ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

export function walkAst(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node);
  ts.forEachChild(node, (child) => walkAst(child, visitor));
}

function getCallName(node: ts.CallExpression): string | undefined {
  const expr = node.expression;
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.name.text;
  }
  return undefined;
}

export function findCallsByMethodName(
  sourceFile: ts.SourceFile,
  methodName: string,
): ts.CallExpression[] {
  const results: ts.CallExpression[] = [];
  walkAst(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const expr = node.expression;
    if (ts.isIdentifier(expr) && expr.text === methodName) {
      results.push(node);
    }
    if (ts.isPropertyAccessExpression(expr) && expr.name.text === methodName) {
      results.push(node);
    }
  });
  return results;
}

export function findPropertyAccessCalls(
  sourceFile: ts.SourceFile,
  objectName: string,
  methodName: string,
): ts.CallExpression[] {
  const results: ts.CallExpression[] = [];
  walkAst(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const expr = node.expression;
    if (
      ts.isPropertyAccessExpression(expr) &&
      expr.name.text === methodName &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === objectName
    ) {
      results.push(node);
    }
  });
  return results;
}

export function getStringLiteralValue(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node)) {
    return node.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

export function getFirstArgumentText(call: ts.CallExpression): string | undefined {
  const firstArg = call.arguments[0];
  if (!firstArg) return undefined;
  return getStringLiteralValue(firstArg);
}

export function getDescribeDepth(sourceFile: ts.SourceFile): number {
  let maxDepth = 0;

  function visit(node: ts.Node, currentDepth: number): void {
    if (ts.isCallExpression(node)) {
      const name = getCallName(node);
      if (name === "describe" || name === "context") {
        const newDepth = currentDepth + 1;
        if (newDepth > maxDepth) {
          maxDepth = newDepth;
        }
        ts.forEachChild(node, (child) => visit(child, newDepth));
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, currentDepth));
  }

  visit(sourceFile, 0);
  return maxDepth;
}

export function getTestTitles(sourceFile: ts.SourceFile): string[] {
  const titles: string[] = [];
  walkAst(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const name = getCallName(node);
    if (name === "it" || name === "test") {
      const title = getFirstArgumentText(node);
      if (title !== undefined) {
        titles.push(title);
      }
    }
  });
  return titles;
}

export function countAwaitExpressions(sourceFile: ts.SourceFile): number {
  let count = 0;
  walkAst(sourceFile, (node) => {
    if (ts.isAwaitExpression(node)) {
      count++;
    }
  });
  return count;
}

export function countNavigationCalls(
  sourceFile: ts.SourceFile,
  framework: "playwright" | "cypress",
): number {
  const navMethods = framework === "playwright" ? ["goto", "navigate"] : ["visit", "go"];
  let count = 0;
  for (const method of navMethods) {
    count += findCallsByMethodName(sourceFile, method).length;
  }
  return count;
}

export function findModuleLevelMutableDeclarations(sourceFile: ts.SourceFile): ts.VariableDeclaration[] {
  const results: ts.VariableDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const flags = statement.declarationList.flags;
      const isConst = (flags & ts.NodeFlags.Const) !== 0;
      if (!isConst) {
        for (const decl of statement.declarationList.declarations) {
          results.push(decl);
        }
      }
    }
  }
  return results;
}

export function hasTemplateLiteralArgument(call: ts.CallExpression): boolean {
  return call.arguments.some(
    (arg) => ts.isTemplateExpression(arg) || ts.isTaggedTemplateExpression(arg),
  );
}

export function getLineNumber(node: ts.Node, sourceFile: ts.SourceFile): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}
