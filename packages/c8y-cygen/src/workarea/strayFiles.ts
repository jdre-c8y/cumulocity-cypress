/**
 * What a run left in the target repo that it had no business writing.
 *
 * Ticket 09 §5 states the invariant in one line: setup writes to the repo, runs do not. A
 * generation run writes one spec and its own gitignored working area, and nothing else.
 *
 * The tool can enforce that for what it writes itself. It cannot enforce it for the target
 * repo's own Cypress plugins, which is where it first broke: `cypress-failed-log` builds its
 * path as `path.join('cypress', 'logs', filename)` with no configuration key anywhere near it,
 * so no override the driver passes can reach it. Probe runs fail routinely - ticket 12
 * guarantees dying partway is normal - so routine operation left three files, carrying the
 * developer's email address, in a tracked tree.
 *
 * So this does not try to predict which plugin writes where. It asks git what the working tree
 * looked like before the run and after it, and reports the difference. That catches the next
 * plugin as well as this one.
 *
 * It reports; it never deletes. A file that changed while a run was happening is not necessarily
 * the run's, and destroying a developer's work to tidy up after ourselves is the worse failure
 * by a wide margin.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WORKING_DIR } from "./workingArea.js";

export interface TreeEntry {
  /** Relative to the Cypress project directory, which is not always the git top level. */
  path: string;
  /** git's two-character XY status, kept so a deletion is not reported as an appearance. */
  status: string;
  /**
   * `size:mtimeMs`, or `absent`. A plugin that names its file after the failing test writes the
   * same path every run, so path identity alone reports the second rewrite as nothing happening.
   */
  stamp: string;
}

export interface RepoTreeSnapshot {
  entries: TreeEntry[];
  /** Set when git could not answer. A blind snapshot is reported as blind, never as clean. */
  unavailable?: string;
}

export type StrayKind = "added" | "modified" | "deleted";

export interface Stray {
  path: string;
  kind: StrayKind;
}

export interface StrayReport {
  strays: Stray[];
  unavailable?: string;
}

const GIT_TIMEOUT_MS = 30_000;
// A hygiene check must never be the thing that hangs or kills a run. A repo with tens of
// thousands of untracked files is unusual, not wrong, and should read as "could not tell".
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["--no-optional-locks", ...args], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
}

/**
 * Porcelain v1 with `-z`: one NUL-terminated record per entry, two status characters, a space,
 * then the path. A rename writes two records - the new path, then the old one - and reading the
 * second as an entry of its own would report the old name as a file that appeared.
 */
export function parseGitStatus(out: string): { path: string; status: string }[] {
  const records = out.split("\0").filter((r) => r.length > 0);
  const entries: { path: string; status: string }[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i] as string;
    const status = record.slice(0, 2);
    entries.push({ status, path: record.slice(3) });
    if (status.startsWith("R") || status.startsWith("C")) i += 1;
  }
  return entries;
}

function stampOf(absolute: string): string {
  try {
    const stat = fs.statSync(absolute);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "absent";
  }
}

/**
 * Porcelain output is always relative to the git top level, never to the directory git ran in,
 * so a Cypress project nested inside a larger repository would otherwise be compared against
 * paths that carry a prefix the rest of the tool never uses. Entries outside the project
 * directory are dropped rather than renamed: a colleague's edit elsewhere in a monorepo is not
 * this run's business.
 */
export function snapshotRepoTree(repo: string): RepoTreeSnapshot {
  try {
    const prefix = git(repo, ["rev-parse", "--show-prefix"]).trim();
    const raw = parseGitStatus(git(repo, ["status", "--porcelain", "-z", "--untracked-files=all"]));
    const entries: TreeEntry[] = [];
    for (const entry of raw) {
      if (prefix && !entry.path.startsWith(prefix)) continue;
      const relative = prefix ? entry.path.slice(prefix.length) : entry.path;
      entries.push({
        path: relative,
        status: entry.status,
        stamp: stampOf(path.join(repo, relative)),
      });
    }
    return { entries };
  } catch (e) {
    const detail = (e as { stderr?: string }).stderr?.trim() || (e as Error).message;
    // First line only: git's `safe.directory` refusal is five lines of hint, and the report is
    // column-aligned.
    return { entries: [], unavailable: (detail.split("\n")[0] ?? "").trim() || "git failed" };
  }
}

const WORKING_PREFIX = `${WORKING_DIR}/`;

function kindOf(status: string, seenBefore: boolean): StrayKind {
  if (status.includes("D")) return "deleted";
  if (!seenBefore && (status === "??" || status.includes("A"))) return "added";
  return "modified";
}

/**
 * Entries that are new since the run started, or whose bytes changed while it ran, minus the
 * ones the run is entitled to: the spec it was asked to write, and its own working area.
 */
export function straysBetween(
  before: RepoTreeSnapshot,
  after: RepoTreeSnapshot,
  expected: string[]
): StrayReport {
  // Tested for presence, not for truthiness. A blind snapshot that carries an empty reason is
  // still blind, and `||` or `??` would both fall through it - diffing the developer's whole
  // working tree against nothing and blaming this run for all of it.
  if (before.unavailable !== undefined) return { strays: [], unavailable: before.unavailable };
  if (after.unavailable !== undefined) return { strays: [], unavailable: after.unavailable };

  const was = new Map(before.entries.map((e) => [e.path, e.stamp]));
  // git always reports forward slashes; specPathForContract uses path.join, which does not on
  // Windows. Without this the run's own spec is reported as a stray on every green run there.
  const allowed = new Set(expected.map((p) => p.split(path.sep).join("/")));

  const strays: Stray[] = [];
  for (const entry of after.entries) {
    if (allowed.has(entry.path)) continue;
    if (entry.path === WORKING_DIR || entry.path.startsWith(WORKING_PREFIX)) continue;
    if (was.get(entry.path) === entry.stamp) continue;
    strays.push({ path: entry.path, kind: kindOf(entry.status, was.has(entry.path)) });
  }
  strays.sort((a, b) => a.path.localeCompare(b.path));
  return { strays };
}

/**
 * Printed on every run, green or not, and printed when it is clean - "0" is the measurement that
 * makes the next non-zero one mean something.
 */
export function formatStrays(report: StrayReport): string {
  if (report.unavailable !== undefined) {
    return `  stray files        UNKNOWN - git could not read the target repo's tree (${report.unavailable})`;
  }
  if (report.strays.length === 0) {
    return "  stray files        0 - the run wrote its spec and its working area, nothing else";
  }
  const lines = [
    `  stray files        ${report.strays.length} changed in the repo's tree while the run ran.`,
    "                     A run writes one spec and .cygen/, and these are neither. They are left",
    "                     as they are: the tool cannot prove they are its own. A modified or",
    "                     deleted tracked file is put back with git checkout, not with rm.",
  ];
  for (const stray of report.strays) {
    lines.push(`                       ${stray.kind.padEnd(9)}${stray.path}`);
  }
  return lines.join("\n");
}
