/**
 * The working area: one ignored directory at the target repo root holding everything a run
 * needs that is not committed.
 *
 *   .cygen/
 *   |- lock                     runId and pid; one run at a time per repo
 *   |- facts/                   per-entry cache-keyed, TTL backstop, never shared
 *   |- probe/                   throwaway probe specs, deleted at the end of the run
 *   `- runs/<runId>/
 *      |- ir.yaml               ephemeral
 *      |- attempts.jsonl        append-only, kept in full
 *      |- sourcemap.json        kept, so an assist can still name a step
 *      `- screenshots|videos|downloads/
 *
 * It has to be inside the repo, because a probe spec must be bundled by that repo's own Cypress
 * project.
 *
 * The three asset folders are overridden into the run directory. That fixes three things at
 * once: the tool stops writing into the folder the repo's visual-regression baselines are
 * compared against, it stops trashing the developer's unrelated screenshots and videos, and
 * `trashAssetsBeforeRuns` becomes harmless rather than hostile, because the folder it trashes is
 * a fresh per-run directory that is already empty.
 */
import fs from "node:fs";
import path from "node:path";
import { mayWrite } from "./provenance.js";

export class WorkingAreaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkingAreaError";
  }
}

export const WORKING_DIR = ".cygen";

export interface LockInfo {
  runId: string;
  pid: number;
  startedAt: string;
}

export class WorkingArea {
  readonly root: string;

  constructor(
    readonly targetRepo: string,
    readonly runId: string
  ) {
    this.root = path.join(path.resolve(targetRepo), WORKING_DIR);
  }

  get runDir(): string {
    return path.join(this.root, "runs", this.runId);
  }
  get factsDir(): string {
    return path.join(this.root, "facts", this.runId);
  }

  /**
   * One directory per probe run. The browser half restarts its file counter each run, so a
   * shared directory would let run 2 overwrite run 1 - discarding facts already paid for that
   * did not change, which is the expensive kind of wrong per-entry keying exists to avoid.
   */
  factsDirFor(iteration: number): string {
    return path.join(this.factsDir, `probe-${String(iteration).padStart(2, "0")}`);
  }
  get probeDir(): string {
    return path.join(this.root, "probe");
  }
  get screenshotsFolder(): string {
    return path.join(this.runDir, "screenshots");
  }
  get videosFolder(): string {
    return path.join(this.runDir, "videos");
  }
  get downloadsFolder(): string {
    return path.join(this.runDir, "downloads");
  }
  get attemptLogPath(): string {
    return path.join(this.runDir, "attempts.jsonl");
  }
  get sourceMapPath(): string {
    return path.join(this.runDir, "sourcemap.json");
  }
  get irPath(): string {
    return path.join(this.runDir, "ir.yaml");
  }
  private get lockPath(): string {
    return path.join(this.root, "lock");
  }

  prepare(): void {
    for (const dir of [
      this.runDir,
      this.factsDir,
      this.probeDir,
      this.screenshotsFolder,
      this.videosFolder,
      this.downloadsFolder,
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * One run at a time per repo. Not a restriction the tool invents: the house convention uses
   * fixed literal entity names, so two concurrent runs against one tenant collide on names
   * whether or not anything is swept. Given that, serialising costs nothing real - and it makes
   * crash recovery correct by construction, because a dead process leaves a stale lock that is
   * safe to take over.
   */
  acquireLock(): LockInfo {
    fs.mkdirSync(this.root, { recursive: true });
    const lock: LockInfo = {
      runId: this.runId,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    const body = JSON.stringify(lock, null, 2);

    // `wx` is the point: create-or-fail in one syscall. Reading first and writing second let two
    // runs started milliseconds apart both find no lock, both write one, and both proceed - and
    // with fixed literal entity names in the house conventions that is a collision on the tenant
    // rather than a race nobody would notice.
    try {
      fs.writeFileSync(this.lockPath, body, { flag: "wx" });
      return lock;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }

    const existing = this.readLock();
    if (existing && existing.pid !== process.pid && isAlive(existing.pid)) {
      throw new WorkingAreaError(
        `Another c8y-cygen run holds the lock in ${this.targetRepo}: run ${existing.runId}, pid ${existing.pid}, started ${existing.startedAt}.`
      );
    }
    // Taking over a stale lock is still read-then-write, and stays so: the window only matters
    // when the holder is already dead, and crash recovery is worth more than closing it.
    fs.writeFileSync(this.lockPath, body);
    return lock;
  }

  readLock(): LockInfo | null {
    if (!fs.existsSync(this.lockPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.lockPath, "utf8")) as LockInfo;
    } catch {
      return null;
    }
  }

  releaseLock(): void {
    const existing = this.readLock();
    if (existing && existing.runId === this.runId) fs.rmSync(this.lockPath, { force: true });
  }

  writeProbeSpec(name: string, text: string): string {
    fs.mkdirSync(this.probeDir, { recursive: true });
    const file = path.join(this.probeDir, `${name}.cy.ts`);
    fs.writeFileSync(file, text);
    return file;
  }

  /** Only facts survive a probe run. The spec itself is thrown away with the run that made it. */
  discardProbeSpecs(): void {
    fs.rmSync(this.probeDir, { recursive: true, force: true });
  }

  /**
   * Probe specs run under this, which makes them structurally incapable of being picked up by
   * the repo's own suite. Both target repos leave `specPattern` unset for e2e, so Cypress's
   * default applies and any `.cy.ts` under `cypress/e2e/` would otherwise run in CI.
   */
  probeSpecPattern(): string {
    return path.join(WORKING_DIR, "probe", "*.cy.ts");
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The output path is a pure function of the contract path, which is what kills the
 * duplicate-spec bug structurally rather than by cleanup: asking twice cannot produce a second
 * file. It also honours the team-by-team organisation of the spec tree without the tool
 * guessing at it - the author already chose the directory when they saved the contract.
 */
export function specPathForContract(contractPath: string, suffix = ".cy.ts"): string {
  const dir = path.dirname(contractPath);
  const base = path.basename(contractPath).replace(/\.scenario\.md$/, "");
  if (base === path.basename(contractPath)) {
    throw new WorkingAreaError(
      `${contractPath} is not a scenario contract: the name must end in .scenario.md so the spec path is derivable from it.`
    );
  }
  return path.join(dir, `${base}${suffix}`);
}

/**
 * A run that does not end green deletes its spec. An assist is not that failure - it is a
 * supported outcome, so its spec stays at its final path, marked not green in its header. The
 * honest invariant is the weaker one: c8y-cygen never leaves anything red that is committed.
 */
export function discardSpec(absoluteSpecPath: string): void {
  if (!fs.existsSync(absoluteSpecPath)) return;
  const verdict = mayWrite(fs.readFileSync(absoluteSpecPath, "utf8"));
  // Never delete something a human wrote or edited, even to clean up after ourselves.
  if (verdict.allowed && verdict.reason === "matching-header") {
    fs.rmSync(absoluteSpecPath, { force: true });
  }
}

/** The one line the scout's reviewed commit carries. Setup writes to the repo; runs do not. */
export function ensureIgnored(targetRepo: string): "added" | "already-present" {
  const file = path.join(path.resolve(targetRepo), ".gitignore");
  const line = `${WORKING_DIR}/`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (current.split("\n").some((l) => l.trim() === line || l.trim() === WORKING_DIR)) {
    return "already-present";
  }
  const separator = current.endsWith("\n") || current === "" ? "" : "\n";
  fs.writeFileSync(file, `${current}${separator}${line}\n`);
  return "added";
}
