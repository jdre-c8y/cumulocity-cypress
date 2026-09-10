import fs from "node:fs";
import path from "node:path";

/**
 * Reads a file that ships with the package, by its path under `src/` (and, once built, under
 * `dist/`). Schemas and prompt fragments are loaded through here rather than rebuilt at request
 * time: they go into the model prompt behind a cache breakpoint, and the bytes have to be a
 * function of the file, never of the code path that assembled them.
 */
const PACKAGE_SRC = path.resolve(__dirname, "..");

const cache = new Map<string, string>();

export function readPackageAsset(relativePath: string): string {
  const cached = cache.get(relativePath);
  if (cached !== undefined) return cached;
  const bytes = fs.readFileSync(path.join(PACKAGE_SRC, relativePath), "utf8");
  cache.set(relativePath, bytes);
  return bytes;
}

/** The package root, for artifacts that ship beside `src/` rather than inside it. */
export const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");

export function packagePath(...parts: string[]): string {
  return path.join(PACKAGE_ROOT, ...parts);
}
