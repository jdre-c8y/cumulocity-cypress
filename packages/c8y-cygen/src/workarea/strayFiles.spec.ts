import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  formatStrays,
  parseGitStatus,
  snapshotRepoTree,
  straysBetween,
  type RepoTreeSnapshot,
} from "./strayFiles.js";

function tempDir(prefix = "cygen-stray-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function gitRepo(): string {
  const dir = tempDir();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

/**
 * A directory git refuses to read, whatever encloses it. Asserting that `os.tmpdir()` happens
 * not to sit inside a checkout is an assumption about the machine; a `.git` file that is not a
 * gitfile fails identically everywhere.
 */
export function notAGitRepo(): string {
  const dir = tempDir("cygen-nogit-");
  fs.writeFileSync(path.join(dir, ".git"), "not a gitfile\n");
  return dir;
}

function snapshot(entries: [string, string, string][]): RepoTreeSnapshot {
  return { entries: entries.map(([p, status, stamp]) => ({ path: p, status, stamp })) };
}

describe("parseGitStatus", () => {
  it("reads a status and a path per record out of NUL-separated porcelain output", () => {
    expect(parseGitStatus(" M cypress/e2e/a.cy.ts\0?? cypress/logs/failed-1.json\0")).toEqual([
      { status: " M", path: "cypress/e2e/a.cy.ts" },
      { status: "??", path: "cypress/logs/failed-1.json" },
    ]);
  });

  it("consumes a rename's second record, which is the old path and not a new file", () => {
    expect(parseGitStatus("R  new.ts\0old.ts\0?? other.ts\0").map((e) => e.path)).toEqual([
      "new.ts",
      "other.ts",
    ]);
  });

  it("keeps a path that contains a space, which is why -z is used rather than quoting", () => {
    expect(parseGitStatus("?? cypress/e2e/my spec.cy.ts\0")[0]?.path).toBe(
      "cypress/e2e/my spec.cy.ts"
    );
  });

  it("is empty for a clean tree", () => {
    expect(parseGitStatus("")).toEqual([]);
  });
});

describe("snapshotRepoTree", () => {
  it("sees a file nothing tracks yet, and stamps it", () => {
    const repo = gitRepo();
    fs.mkdirSync(path.join(repo, "cypress", "logs"), { recursive: true });
    fs.writeFileSync(path.join(repo, "cypress", "logs", "failed-1.json"), "{}");

    const entry = snapshotRepoTree(repo).entries.find(
      (e) => e.path === "cypress/logs/failed-1.json"
    );

    expect(entry?.status).toBe("??");
    expect(entry?.stamp).not.toBe("absent");
  });

  it("does not see a file the repo ignores, because that is what ignoring it means", () => {
    const repo = gitRepo();
    fs.writeFileSync(path.join(repo, ".gitignore"), ".cygen/\n");
    fs.mkdirSync(path.join(repo, ".cygen"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".cygen", "lock"), "{}");

    expect(snapshotRepoTree(repo).entries.map((e) => e.path)).not.toContain(".cygen/lock");
  });

  it("reports paths relative to the Cypress project, not to the git top level", () => {
    // Porcelain output is always root-relative. A Cypress project nested in a larger repo would
    // otherwise be compared against paths carrying a prefix nothing else in the tool uses, and
    // every green run would report its own spec as a stray.
    const root = gitRepo();
    const project = path.join(root, "packages", "app");
    fs.mkdirSync(path.join(project, "cypress"), { recursive: true });
    fs.writeFileSync(path.join(project, "cypress", "a.cy.ts"), "//\n");

    expect(snapshotRepoTree(project).entries.map((e) => e.path)).toEqual(["cypress/a.cy.ts"]);
  });

  it("drops what is outside the Cypress project, which is not this run's business", () => {
    const root = gitRepo();
    const project = path.join(root, "packages", "app");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(root, "elsewhere.txt"), "a colleague's edit\n");

    expect(snapshotRepoTree(project).entries).toEqual([]);
  });

  it("stamps bytes, so a rewrite of one path is visible and not just its first appearance", () => {
    // The end-to-end half of the rewrite case: git reports the same path and the same `??` both
    // times, so only the stamp separates "already there" from "written again by this run".
    const repo = gitRepo();
    fs.mkdirSync(path.join(repo, "cypress", "logs"), { recursive: true });
    const file = path.join(repo, "cypress", "logs", "failed-1.json");
    fs.writeFileSync(file, '{"testError":"first"}');
    const before = snapshotRepoTree(repo);
    fs.writeFileSync(file, '{"testError":"second, and a different length"}');

    expect(straysBetween(before, snapshotRepoTree(repo), []).strays).toEqual([
      { path: "cypress/logs/failed-1.json", kind: "modified" },
    ]);
  });

  it("says it could not tell rather than throwing when git refuses the directory", () => {
    const snapshot = snapshotRepoTree(notAGitRepo());

    expect(snapshot.unavailable).toBeTruthy();
    expect(snapshot.entries).toEqual([]);
  });

  it("keeps only the first line of a git refusal, because the report is column-aligned", () => {
    expect(snapshotRepoTree(notAGitRepo()).unavailable).not.toContain("\n");
  });
});

describe("straysBetween", () => {
  const before = snapshot([["cypress/e2e/existing.cy.ts", " M", "10:1"]]);

  it("names a file that appeared while the run was happening", () => {
    const after = snapshot([
      ["cypress/e2e/existing.cy.ts", " M", "10:1"],
      ["cypress/logs/failed-1.json", "??", "20:2"],
    ]);

    expect(straysBetween(before, after, []).strays).toEqual([
      { path: "cypress/logs/failed-1.json", kind: "added" },
    ]);
  });

  it("names a file the run rewrote, which path identity alone would call unchanged", () => {
    // cypress-failed-log names its file after the failing test, so a run that fails the same way
    // twice rewrites one path. Reporting "0 strays" there is a false statement about the run.
    const seen = snapshot([["cypress/logs/failed-1.json", "??", "20:2"]]);
    const rewritten = snapshot([["cypress/logs/failed-1.json", "??", "31:9"]]);

    expect(straysBetween(seen, rewritten, []).strays).toEqual([
      { path: "cypress/logs/failed-1.json", kind: "modified" },
    ]);
  });

  it("says deleted for a file the run removed, not that it appeared", () => {
    const after = snapshot([
      ["cypress/e2e/existing.cy.ts", " M", "10:1"],
      ["cypress/fixtures/a.json", " D", "absent"],
    ]);

    expect(straysBetween(before, after, []).strays).toEqual([
      { path: "cypress/fixtures/a.json", kind: "deleted" },
    ]);
  });

  it("says modified for a tracked file the run changed", () => {
    const after = snapshot([
      ["cypress/e2e/existing.cy.ts", " M", "10:1"],
      ["cypress/support/e2e.ts", " M", "44:4"],
    ]);

    expect(straysBetween(before, after, []).strays).toEqual([
      { path: "cypress/support/e2e.ts", kind: "modified" },
    ]);
  });

  it("leaves alone a dirty file the run never touched", () => {
    const after = snapshot([["cypress/e2e/existing.cy.ts", " M", "10:1"]]);

    expect(straysBetween(before, after, []).strays).toEqual([]);
  });

  it("does not name the one spec a run is allowed to write", () => {
    const after = snapshot([
      ["cypress/e2e/existing.cy.ts", " M", "10:1"],
      ["cypress/e2e/team/events.cy.ts", "??", "99:9"],
    ]);

    expect(straysBetween(before, after, ["cypress/e2e/team/events.cy.ts"]).strays).toEqual([]);
  });

  it("matches the spec path whatever separator the host platform joined it with", () => {
    const after = snapshot([["cypress/e2e/team/events.cy.ts", "??", "99:9"]]);
    const windowsStyle = ["cypress", "e2e", "team", "events.cy.ts"].join(path.sep);

    expect(straysBetween(snapshot([]), after, [windowsStyle]).strays).toEqual([]);
  });

  it("does not name the working area, which is the run's own to write", () => {
    const after = snapshot([[".cygen/runs/r1/attempts.jsonl", "??", "5:5"]]);

    expect(straysBetween(snapshot([]), after, []).strays).toEqual([]);
  });

  it("reports that it could not tell, rather than reporting nothing, when git was blind", () => {
    const blind = { entries: [], unavailable: "not a git repository" };

    expect(straysBetween(blind, snapshot([]), []).unavailable).toBe("not a git repository");
    expect(straysBetween(before, blind, []).unavailable).toBe("not a git repository");
  });

  it("treats an empty reason as blind too, rather than diffing against nothing", () => {
    // `??` would fall through here and blame the run for the developer's whole working tree.
    const blind = { entries: [], unavailable: "" };
    const after = snapshot([["cypress/logs/failed-1.json", "??", "20:2"]]);

    expect(straysBetween(blind, after, []).strays).toEqual([]);
  });
});

describe("the stray line", () => {
  it("prints zero, so the next non-zero one means something", () => {
    expect(formatStrays({ strays: [] })).toContain("stray files        0");
  });

  it("prints UNKNOWN rather than zero when git could not read the tree", () => {
    expect(formatStrays({ strays: [], unavailable: "dubious ownership" })).toContain(
      "stray files        UNKNOWN"
    );
  });

  it("labels each path with what happened to it", () => {
    const text = formatStrays({
      strays: [
        { path: "cypress/logs/failed-1.json", kind: "added" },
        { path: "cypress/fixtures/a.json", kind: "deleted" },
      ],
    });

    expect(text).toContain("added    cypress/logs/failed-1.json");
    expect(text).toContain("deleted  cypress/fixtures/a.json");
  });

  it("stays inside a terminal column, because the rest of the report is aligned", () => {
    const text = formatStrays({
      strays: [{ path: "cypress/logs/failed-1.json", kind: "added" }],
    });

    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(100);
  });
});
