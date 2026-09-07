import path from "path";

function escapeRegExp(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert a gitignore-style glob into a RegExp that is tested against a
 * project-relative POSIX path (file or directory).
 *
 * - A pattern without `/` matches a basename at any depth (`fixtures`, `*.generated.ts`).
 * - A pattern containing `/` is anchored to the project root (`legacy/e2e`, `tmp/**`).
 * - `**` spans directories, `*` matches within a segment, `?` matches one character.
 */
export function globToRegExp(pattern: string): RegExp {
  let glob = pattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const anchored = glob.includes("/");
  glob = glob.replace(/^\/+/, "");

  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob.charAt(i);
    if (char === "*") {
      if (glob.charAt(i + 1) === "*") {
        i++;
        if (glob.charAt(i + 1) === "/") {
          i++;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(anchored ? `^${source}(?:/|$)` : `(?:^|/)${source}(?:/|$)`);
}

/** Build a predicate that reports whether a project-relative path matches any ignore glob. */
export function createIgnoreMatcher(patterns: string[]): (relativePath: string) => boolean {
  const matchers = patterns.map(globToRegExp);
  if (matchers.length === 0) return () => false;
  return (relativePath: string): boolean => {
    const posix = relativePath.split(path.sep).join("/");
    return matchers.some((matcher) => matcher.test(posix));
  };
}

/** True when `target` resolves to one of `roots` or somewhere beneath one of them. */
export function isWithinRoots(target: string, roots: string[]): boolean {
  const resolved = path.resolve(target);
  return roots.some((root) => {
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(base + path.sep);
  });
}

/**
 * Enforce the `scan.allowedRoots` policy. When no roots are configured every path is
 * allowed. Returns the resolved path; throws a descriptive error otherwise.
 */
export function assertWithinAllowedRoots(target: string, roots: string[], label: string): string {
  const resolved = path.resolve(target);
  if (roots.length === 0 || isWithinRoots(resolved, roots)) return resolved;
  throw new Error(
    `${label} "${resolved}" is outside the allowed roots configured in scan.allowedRoots: ${roots.join(", ")}`,
  );
}
