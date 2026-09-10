/**
 * The Cypress driver: a spec path plus a configuration override in, a run result out.
 *
 * The programmatic module API, resolved out of the target repo, and never a bare CLI call - it
 * has to override the spec pattern and the three asset folders in the same object.
 *
 * The harness runs Cypress; the model does not. A model-callable run is a model-callable budget
 * under a budget denominated in Cypress runs, and the anti-gaming guard needs the tool, not the
 * model, to observe the result.
 */
import { createRequire } from "node:module";
import path from "node:path";

export class CypressDriverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CypressDriverError";
  }
}

export interface FailureLocation {
  file: string;
  line: number;
  column: number;
}

export interface TestFailure {
  title: string[];
  /** Already truncated, with the location parsed off the untruncated text. */
  errorMessage: string;
  /** The topmost stack frame whose file is the emitted spec. */
  location?: FailureLocation;
  screenshotPath?: string;
}

export interface SpecFailure {
  specRelativePath: string;
  errorMessage: string;
}

export interface CypressRunResult {
  pass: boolean;
  testFailures: TestFailure[];
  specFailures: SpecFailure[];
  /** Wall clock in milliseconds, so the cache-TTL question can rest on a clock. */
  durationMs: number;
  startedAt: string;
}

export interface RunRequest {
  /** The target repo whose own Cypress, config, support file and helpers are used. */
  targetRepo: string;
  /** Absolute path of the spec to run. */
  specPath: string;
  /**
   * Where Cypress may write. Overridden so the tool stops writing into the folder the repo's
   * visual-regression baselines are compared against, and stops trashing unrelated artifacts.
   */
  screenshotsFolder: string;
  videosFolder: string;
  downloadsFolder: string;
  /**
   * Probe specs live outside the spec tree and are picked up only through this, which makes
   * them structurally incapable of being run by the repo's own suite.
   */
  specPattern?: string;
  env?: Record<string, string>;
  baseUrl?: string;
}

/** The metered boundary. Exactly one production implementation. */
export interface RunsCypress {
  run(request: RunRequest): Promise<CypressRunResult>;
}

const DEFAULT_MAX_ERROR_CHARS = 3000;

/**
 * Keeps the head and the tail and elides the middle.
 *
 * There is no structured location field anywhere in a Cypress result - one regular expression
 * over one string is the entire mechanism, and the stack frames sit at that string's end. A
 * head-first cut deletes the source-map key on exactly the largest failures, which are the ones
 * that most need it.
 */
export function truncateMiddle(text: string, max = DEFAULT_MAX_ERROR_CHARS): string {
  if (text.length <= max) return text;
  // At least one character from each end: `slice(-0)` is `slice(0)`, which would return the
  // whole string and quietly undo the truncation.
  const keep = Math.max(1, Math.floor((max - 40) / 2));
  const elided = text.length - keep * 2;
  return `${text.slice(0, keep)}\n... ${elided} characters elided ...\n${text.slice(-keep)}`;
}

const FRAME = /(?:^|\s|\()([^\s()]+?):(\d+):(\d+)\)?/gm;

/**
 * The topmost stack frame whose file is the emitted spec. A failure raised inside a blessed
 * helper still names the step that called it, and a failure in a beforeEach names its setup
 * entry - both fall out of this rule rather than needing a special case.
 */
export function parseFailureLocation(
  errorMessage: string,
  specPath: string
): FailureLocation | undefined {
  const wanted = path.basename(specPath);
  for (const match of errorMessage.matchAll(FRAME)) {
    const file = match[1] as string;
    if (!file.includes(wanted)) continue;
    return {
      file,
      line: Number(match[2]),
      column: Number(match[3]),
    };
  }
  return undefined;
}

/** Cypress names a failure screenshot "<describe> -- <it> (failed).png". There is no id. */
function screenshotFor(
  screenshots: { path: string }[],
  title: string[]
): string | undefined {
  const joined = title.join(" -- ");
  return screenshots.find((s) => path.basename(s.path).startsWith(joined))?.path;
}

interface RawScreenshot {
  path: string;
}
interface RawTest {
  title: string[];
  state: string;
  displayError?: string | null;
}
interface RawRun {
  error?: string | null;
  spec: { relative: string };
  tests?: RawTest[];
  screenshots?: RawScreenshot[];
}
interface RawSuccess {
  status?: string;
  totalFailed: number;
  runs: RawRun[];
}
interface RawFailure {
  status: "failed";
  message: string;
}

/**
 * Pure, and deliberately separate from the run so it can be exercised against recorded output
 * without spawning Electron.
 */
export function parseRunResult(
  raw: unknown,
  specPath: string,
  timing: { startedAt: string; durationMs: number },
  maxErrorChars = DEFAULT_MAX_ERROR_CHARS
): CypressRunResult {
  const base = { ...timing, testFailures: [] as TestFailure[], specFailures: [] as SpecFailure[] };

  if ((raw as RawFailure)?.status === "failed") {
    return {
      ...base,
      pass: false,
      specFailures: [
        {
          specRelativePath: "",
          errorMessage: truncateMiddle((raw as RawFailure).message, maxErrorChars),
        },
      ],
    };
  }

  const result = raw as RawSuccess;
  const testFailures: TestFailure[] = [];
  const specFailures: SpecFailure[] = [];

  for (const run of result.runs ?? []) {
    if (run.error) {
      specFailures.push({
        specRelativePath: run.spec.relative,
        errorMessage: truncateMiddle(run.error, maxErrorChars),
      });
      continue;
    }
    for (const test of run.tests ?? []) {
      if (test.state !== "failed") continue;
      const full = test.displayError ?? "Cypress reported a failure with no error message.";
      // Location first, truncation second. The order is the whole point.
      const location = parseFailureLocation(full, specPath);
      const screenshotPath = screenshotFor(run.screenshots ?? [], test.title);
      testFailures.push({
        title: test.title,
        errorMessage: truncateMiddle(full, maxErrorChars),
        ...(location ? { location } : {}),
        ...(screenshotPath ? { screenshotPath } : {}),
      });
    }
  }

  return {
    ...base,
    pass: (result.totalFailed ?? 0) === 0 && specFailures.length === 0,
    testFailures,
    specFailures,
  };
}

type CypressRunFn = (options: Record<string, unknown>) => Promise<unknown>;

/**
 * Runs the target repo's own installed Cypress, so the generated spec sees that repo's real
 * cy.login, custom commands, fixtures and cypress.config.ts.
 */
export class ModuleApiCypressRunner implements RunsCypress {
  constructor(private readonly maxErrorChars = DEFAULT_MAX_ERROR_CHARS) {}

  async run(request: RunRequest): Promise<CypressRunResult> {
    const repo = path.resolve(request.targetRepo);
    const requireFromRepo = createRequire(path.join(repo, "package.json"));

    let modulePath: string;
    try {
      modulePath = requireFromRepo.resolve("cypress");
    } catch {
      throw new CypressDriverError(
        `No cypress installation inside ${repo}. c8y-cygen runs the target repo's own Cypress, never a bundled one - run an install there first.`
      );
    }

    const loaded = (await import(modulePath)) as {
      run?: CypressRunFn;
      default?: { run: CypressRunFn };
    };
    const run = loaded.run ?? loaded.default?.run;
    if (!run) {
      throw new CypressDriverError(
        `Resolved cypress at ${modulePath} but it exposes no run().`
      );
    }

    const startedAt = new Date().toISOString();
    const start = Date.now();
    const raw = await run({
      project: repo,
      spec: request.specPath,
      config: {
        // Green means green, not green on the third try, whatever the repo's own config tolerates.
        retries: 0,
        screenshotsFolder: request.screenshotsFolder,
        videosFolder: request.videosFolder,
        downloadsFolder: request.downloadsFolder,
        ...(request.specPattern ? { specPattern: request.specPattern } : {}),
        ...(request.baseUrl ? { baseUrl: request.baseUrl } : {}),
      },
      ...(request.env ? { env: request.env } : {}),
    });

    return parseRunResult(
      raw,
      request.specPath,
      { startedAt, durationMs: Date.now() - start },
      this.maxErrorChars
    );
  }
}
