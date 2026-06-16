// ---------------------------------------------------------------------------
// Path-safety helpers for the Local Filesystem skill (PRD FR-6.4, SEC-6).
//
// `resolveWithinRoot` is the SINGLE source of truth for "is this path allowed
// to be touched at all" - every tool in skills/filesystem/server.ts MUST go
// through it before doing anything with a model-supplied path. It is a pure
// function over strings (plus `path.resolve`), so it's cheap to unit-test
// thoroughly without real symlinks or a real filesystem.
//
// `resolveFilesystemWriteTarget` is a small convenience wrapper used by
// core/permissions.ts's CLASSIFIER_HOOKS to do a synchronous, best-effort
// resolution of a write tool's target path against the CONFIGURED allowed
// root (config.allowedDirectory), for the Tier 1 (new file) vs Tier 2
// (overwrite) classification (FR-6.3/6.5). It deliberately has the same
// "fail closed -> undefined" behavior as resolveWithinRoot.
// ---------------------------------------------------------------------------

import path from "node:path";
import { config } from "../../config";

/**
 * Resolve `requestedPath` against `root`, returning the resolved absolute
 * path IF AND ONLY IF it is `root` itself or strictly inside it.
 *
 * Returns `undefined` if:
 *   - `requestedPath` is not a non-empty string,
 *   - the resolved path is `root`'s parent or any ancestor/sibling (e.g. via
 *     `..` traversal),
 *   - `requestedPath` is an absolute path outside `root`.
 *
 * `requestedPath` may be relative (resolved against `root`) or absolute
 * (resolved as-is, then checked against `root`). Both `root` and the
 * resolved candidate are normalized via `path.resolve` first, so trailing
 * slashes and `.`/`..` segments are handled consistently across platforms.
 *
 * This is a PURE function (no filesystem access) - it does not check
 * existence, and does not resolve symlinks. Symlink-based escapes are a
 * known limitation noted in the skill's tests/README; the allowed root is
 * expected to be a plain directory JARVIS itself created.
 */
export function resolveWithinRoot(root: string, requestedPath: string): string | undefined {
  if (typeof requestedPath !== "string" || requestedPath.length === 0) return undefined;

  const resolvedRoot = path.resolve(root);
  const candidate = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(resolvedRoot, requestedPath);

  if (candidate === resolvedRoot) return candidate;

  // Ensure `candidate` is strictly inside `resolvedRoot` by checking it
  // starts with `resolvedRoot + path.sep` - a plain `startsWith(resolvedRoot)`
  // would incorrectly accept a sibling directory like
  // "/allowed-root-evil" when resolvedRoot is "/allowed-root".
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (candidate.startsWith(rootWithSep)) return candidate;

  return undefined;
}

/**
 * Convenience wrapper for CLASSIFIER_HOOKS (core/permissions.ts): resolves
 * `requestedPath` (a model-supplied tool argument, of unknown type) against
 * the CONFIGURED allowed root (`config.allowedDirectory`), or returns
 * `undefined` if it's missing, not a string, or escapes the root.
 */
export function resolveFilesystemWriteTarget(requestedPath: unknown): string | undefined {
  if (typeof requestedPath !== "string") return undefined;
  return resolveWithinRoot(config.allowedDirectory, requestedPath);
}
