import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  WorkingArea,
  WorkingAreaError,
  discardSpec,
  ensureIgnored,
  specPathForContract,
} from "./workingArea.js";
import { hashBody, mayWrite, readProvenance, withHeader } from "./provenance.js";

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cygen-repo-"));
}

const PROV = { toolVersion: "0.2.0", contractPath: "cypress/e2e/team/events.scenario.md" };

/** A spec with this tool's provenance header on it, which is what `discardSpec` recognises. */
function writeGenerated(target: string, body: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, withHeader(PROV, body));
}

describe("specPathForContract", () => {
  it("is a pure function of the contract path, so a re-run cannot make a second file", () => {
    expect(specPathForContract("cypress/e2e/dataAndControlTeam/events.scenario.md")).toBe(
      "cypress/e2e/dataAndControlTeam/events.cy.ts"
    );
  });

  it("puts the spec in the directory the author already chose", () => {
    // Nothing derives "dataAndControlTeam" from a scenario about events. The author chose it
    // when they saved the contract, and that is the only way the team-by-team tree survives.
    expect(path.dirname(specPathForContract("cypress/e2e/platformTeam/x.scenario.md"))).toBe(
      "cypress/e2e/platformTeam"
    );
  });

  it("refuses a path that is not a scenario contract", () => {
    expect(() => specPathForContract("cypress/e2e/notes.md")).toThrow(WorkingAreaError);
  });
});

describe("the provenance header", () => {
  it("round-trips its three fields", () => {
    const file = withHeader(PROV, "describe('x', () => {});\n");
    const parsed = readProvenance(file);

    expect(parsed?.provenance.toolVersion).toBe("0.2.0");
    expect(parsed?.provenance.contractPath).toBe("cypress/e2e/team/events.scenario.md");
    expect(parsed?.provenance.hash).toBe(hashBody("describe('x', () => {});\n"));
  });

  it("lets a re-run overwrite exactly one file", () => {
    expect(mayWrite(withHeader(PROV, "body\n"))).toEqual({
      allowed: true,
      reason: "matching-header",
    });
  });

  it("refuses rather than overwriting a hand-written spec that shares the name", () => {
    const verdict = mayWrite("describe('mine', () => {});\n");

    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toBe("hand-written");
  });

  it("refuses rather than destroying a hand-edited generated spec", () => {
    const edited = `${withHeader(PROV, "body\n")}// I fixed the selector by hand\n`;

    const verdict = mayWrite(edited);

    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toBe("hand-edited");
  });

  it("marks a spec the run did not turn green", () => {
    const file = withHeader({ ...PROV, notGreen: true }, "body\n");

    expect(file).toContain("NOT GREEN");
    expect(readProvenance(file)?.provenance.notGreen).toBe(true);
  });
});

describe("discardSpec", () => {
  it("removes a spec this tool wrote when the run did not end green", () => {
    const repo = tempRepo();
    const target = path.join(repo, "x.cy.ts");
    writeGenerated(target, "body\n");

    discardSpec(target);

    expect(fs.existsSync(target)).toBe(false);
  });

  it("never deletes a file a human wrote or edited, even while cleaning up", () => {
    const repo = tempRepo();
    const target = path.join(repo, "x.cy.ts");
    fs.writeFileSync(target, "hand written\n");

    discardSpec(target);

    expect(fs.existsSync(target)).toBe(true);
  });
});

describe("the working area", () => {
  it("puts the run's own assets in the run's own directory", () => {
    // Not cypress/snapshots/actual, where cypress-visual-regression compares against committed
    // baselines, and where trashAssetsBeforeRuns would destroy the developer's own artifacts.
    const repo = tempRepo();
    const area = new WorkingArea(repo, "r1");
    area.prepare();

    expect(area.screenshotsFolder).toBe(path.join(repo, ".cygen/runs/r1/screenshots"));
    expect(fs.existsSync(area.videosFolder)).toBe(true);
    expect(area.screenshotsFolder.includes("cypress/snapshots")).toBe(false);
  });

  it("runs probe specs under a pattern the repo's own suite cannot match", () => {
    const area = new WorkingArea(tempRepo(), "r1");

    expect(area.probeSpecPattern()).toBe(".cygen/probe/*.cy.ts");
    expect(area.probeSpecPattern().startsWith("cypress/e2e")).toBe(false);
  });

  it("throws away probe specs and keeps only their facts", () => {
    const repo = tempRepo();
    const area = new WorkingArea(repo, "r1");
    area.prepare();
    area.writeProbeSpec("iteration-1", "describe('probe', () => {});");

    area.discardProbeSpecs();

    expect(fs.existsSync(area.probeDir)).toBe(false);
    expect(fs.existsSync(area.factsDir)).toBe(true);
  });

  it("allows one run at a time per repo", () => {
    const repo = tempRepo();
    new WorkingArea(repo, "r1").acquireLock();
    fs.writeFileSync(
      path.join(repo, ".cygen/lock"),
      JSON.stringify({ runId: "r1", pid: process.pid, startedAt: "now" })
    );

    // A second run in the same process would be the same pid; simulate a live one.
    const other = new WorkingArea(repo, "r2");
    fs.writeFileSync(
      path.join(repo, ".cygen/lock"),
      JSON.stringify({ runId: "r1", pid: 1, startedAt: "now" })
    );

    expect(() => other.acquireLock()).toThrow(WorkingAreaError);
  });

  it("takes over a lock left by a process that died", () => {
    const repo = tempRepo();
    fs.mkdirSync(path.join(repo, ".cygen"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".cygen/lock"),
      JSON.stringify({ runId: "dead", pid: 2 ** 22, startedAt: "yesterday" })
    );

    expect(new WorkingArea(repo, "r2").acquireLock().runId).toBe("r2");
  });
});

describe("ensureIgnored", () => {
  it("adds the one line the scout's reviewed commit carries", () => {
    const repo = tempRepo();

    expect(ensureIgnored(repo)).toBe("added");
    expect(ensureIgnored(repo)).toBe("already-present");
    expect(fs.readFileSync(path.join(repo, ".gitignore"), "utf8")).toContain(".cygen/");
  });
});
