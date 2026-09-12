/**
 * The loop, end to end: contract in, verdict out, with both metered boundaries injected.
 *
 * The injected boundaries are not assertion seams. They exist so this test can exist - no
 * tenant, no API key - and what it asserts on is the sequence of artifacts the loop produced,
 * never the fakes.
 *
 * No test here asserts that Cypress passes. That needs a tenant, and it is what the benchmark
 * run is for.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runScenario, formatReport, type RunOptions } from "./runScenario.js";
import { PRICE_TABLE_VERSION } from "../pricing/modelPricing.js";
import { packagePath } from "../support/assets.js";
import { b0Ir, b0ProbeIr, b0ProbePayloads } from "../testing/b0.js";
import { withHeader } from "../workarea/provenance.js";
import type { AuthorIrRequest, AuthorIrResult, CallsModel } from "../agent/callsModel.js";
import type { CypressRunResult, RunRequest, RunsCypress } from "../cypress/cypressDriver.js";
import type { IrDocument } from "../ir/types.js";

const CONTRACT = "cypress/e2e/dataAndControlTeam/events.scenario.md";
const SPEC = "cypress/e2e/dataAndControlTeam/events.cy.ts";

function makeRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cygen-e2e-"));
  fs.mkdirSync(path.join(repo, "cypress/e2e/dataAndControlTeam"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".claude/rules"), { recursive: true });
  fs.copyFileSync(
    packagePath("scenarios", "B0-events-details.scenario.md"),
    path.join(repo, CONTRACT)
  );
  fs.writeFileSync(
    path.join(repo, ".claude/rules/e2e-tests.instructions.md"),
    "# e2e house rules\n\nPrefer data-cy.\n"
  );
  fs.writeFileSync(path.join(repo, "package.json"), '{"name":"fake-target"}\n');
  return repo;
}

/** The stray check reads the target repo's git tree, so exercising it needs a real one. */
function makeGitRepo(): string {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, ".gitignore"), ".cygen/\n");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  return repo;
}

/** Replies scripted in order. Anything past the end repeats the last one. */
class ScriptedModel implements CallsModel {
  readonly requests: AuthorIrRequest[] = [];

  constructor(private readonly replies: string[]) {}

  async authorIr(request: AuthorIrRequest): Promise<AuthorIrResult> {
    this.requests.push(request);
    const index = Math.min(this.requests.length - 1, this.replies.length - 1);
    return {
      text: this.replies[index] as string,
      stopReason: "end_turn",
      usage: {
        inputTokens: 500,
        outputTokens: 3_000,
        cacheReadInputTokens: this.requests.length === 1 ? 0 : 10_000,
        cacheCreationInputTokens: this.requests.length === 1 ? 10_000 : 0,
        cacheCreation1h: this.requests.length === 1 ? 10_000 : 0,
        priceTableVersion: PRICE_TABLE_VERSION,
        model: "claude-opus-5",
      },
    };
  }
}

/** Writes what a real probe would write, then reports whatever the test asked it to. */
class ScriptedCypress implements RunsCypress {
  readonly requests: RunRequest[] = [];

  private specRunsSoFar = 0;

  private probeRunsSoFar = 0;

  constructor(
    /** One verdict per spec run; the last repeats. A heal test needs fail, then pass. */
    private readonly specRunPasses: boolean | boolean[],
    /**
     * A repo-relative path the run writes as a side effect, standing in for a plugin the target
     * repo registers. `cypress-failed-log` hard-codes `cypress/logs/`, so no configuration key
     * reaches it and nothing the tool passes can redirect it.
     */
    private readonly pluginWrites?: string,
    /** The emitted line the failure names. Pick one no statement owns to leave it unmapped. */
    private readonly failingLine: number = 34,
    /**
     * One verdict per probe run; the last repeats. A probe dying partway is normal rather than
     * exceptional - it is how a wrong provisional guess reports itself - so a double that can
     * only pass them cannot express the case the loop is most often in.
     */
    private readonly probeRunPasses: boolean | boolean[] = true
  ) {}

  private nextVerdict(script: boolean | boolean[], index: number): boolean {
    if (!Array.isArray(script)) return script;
    return script[Math.min(index, script.length - 1)] ?? false;
  }

  private specRunPasses_(): boolean {
    return this.nextVerdict(this.specRunPasses, this.specRunsSoFar++);
  }

  private probeRunPasses_(): boolean {
    return this.nextVerdict(this.probeRunPasses, this.probeRunsSoFar++);
  }

  async run(request: RunRequest): Promise<CypressRunResult> {
    this.requests.push({ ...request });
    if (this.pluginWrites) {
      const file = path.join(request.targetRepo, this.pluginWrites);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '{"testError":"..."}\n');
    }
    const isProbe = request.specPath.includes(".cygen");
    if (isProbe) {
      const dir = request.env?.["c8yCygenFactsDir"] as string;
      fs.mkdirSync(dir, { recursive: true });
      b0ProbePayloads().forEach((payload, i) => {
        fs.writeFileSync(
          path.join(dir, `${String(i + 1).padStart(3, "0")}-${payload.kind}.json`),
          JSON.stringify(payload)
        );
      });
      // Facts first, verdict second: a probe that dies partway still returns everything it had
      // already collected, which is the whole reason a wrong guess costs rows and not the run.
      if (this.probeRunPasses_()) {
        return {
          pass: true,
          testFailures: [],
          specFailures: [],
          durationMs: 30_000,
          startedAt: new Date().toISOString(),
        };
      }
      return {
        pass: false,
        testFailures: [
          {
            title: ["probe"],
            errorMessage: "AssertionError: Expected to find element: `c8y-nope`, never found it.",
          },
        ],
        specFailures: [],
        durationMs: 30_000,
        startedAt: new Date().toISOString(),
      };
    }
    if (this.specRunPasses_()) {
      return {
        pass: true,
        testFailures: [],
        specFailures: [],
        durationMs: 45_000,
        startedAt: new Date().toISOString(),
      };
    }
    return {
      pass: false,
      durationMs: 45_000,
      startedAt: new Date().toISOString(),
      specFailures: [],
      testFailures: [
        {
          title: ["Tests for device events", "Verify"],
          errorMessage:
            "AssertionError: Timed out retrying: Expected to find element\n" +
            `    at Context.eval (webpack://ui/./${SPEC}:${this.failingLine}:10)`,
          location: { file: SPEC, line: this.failingLine, column: 10 },
          screenshotPath: "/tmp/shot.png",
        },
      ],
    };
  }
}

const fenced = (ir: IrDocument): string =>
  `Here is the IR.\n\n\`\`\`json\n${JSON.stringify(ir, null, 2)}\n\`\`\`\n`;

function options(repo: string, over: Partial<RunOptions> = {}): RunOptions {
  return {
    targetRepo: repo,
    contractPath: CONTRACT,
    conventionsPath: packagePath("conventions", "cumulocity-ui.conventions.yaml"),
    runId: "r1",
    runsCypress: new ScriptedCypress(true),
    callsModel: new ScriptedModel([fenced(b0ProbeIr()), fenced(b0Ir())]),
    styleOverride: "integration",
    styleNote: "the contract's Style line says mocked; the benchmark and the anti-gaming rule say integration",
    baseUrl: "https://tenant.example.c8y.io",
    ...over,
  };
}

describe("the loop, driven end to end", () => {
  it("probes, then emits, then scores - and the verdict is PASS", async () => {
    const repo = makeRepo();

    const report = await runScenario(options(repo));

    expect(report.stopCondition).toBe("green");
    expect(report.score?.verdict).toBe("PASS");
    expect(report.score?.axisB).toMatchObject({ pass: true, covered: 7, total: 7 });
  });

  it("compiles probe mode first because the IR did not yet lint, not because of a phase", async () => {
    const repo = makeRepo();
    const cypress = new ScriptedCypress(true);

    const report = await runScenario(options(repo, { runsCypress: cypress }));

    expect(report.attempts.map((a) => a.mode)).toEqual(["probe", "spec"]);
    expect(cypress.requests[0]?.specPath).toContain(".cygen/probe/");
    expect(cypress.requests[1]?.specPath).toContain(SPEC);
  });

  it("runs probe specs under a pattern the repo's own suite cannot match", async () => {
    const repo = makeRepo();
    const cypress = new ScriptedCypress(true);

    await runScenario(options(repo, { runsCypress: cypress }));

    expect(cypress.requests[0]?.specPattern).toBe(".cygen/probe/*.cy.ts");
    expect(cypress.requests[1]?.specPattern).toBeUndefined();
  });

  it("points Cypress at the run's own asset folders, not the repo's baseline folder", async () => {
    const repo = makeRepo();
    const cypress = new ScriptedCypress(true);

    await runScenario(options(repo, { runsCypress: cypress }));

    for (const request of cypress.requests) {
      expect(request.screenshotsFolder).toBe(path.join(repo, ".cygen/runs/r1/screenshots"));
      expect(request.videosFolder).toContain(".cygen/runs/r1");
      expect(request.downloadsFolder).toContain(".cygen/runs/r1");
    }
  });

  it("throws the probe spec away and keeps only its facts", async () => {
    const repo = makeRepo();

    await runScenario(options(repo));

    expect(fs.existsSync(path.join(repo, ".cygen/probe"))).toBe(false);
    expect(fs.readdirSync(path.join(repo, ".cygen/facts/r1")).length).toBeGreaterThan(0);
  });

  it("lands the spec beside its contract, with a provenance header", async () => {
    const repo = makeRepo();

    await runScenario(options(repo));
    const spec = fs.readFileSync(path.join(repo, SPEC), "utf8");

    expect(spec).toContain(`Generated by c8y-cygen 0.2.0 from ${CONTRACT}`);
    expect(spec).toContain("c8y-cygen-hash:");
    expect(spec).not.toContain("NOT GREEN");
    expect(spec).toContain("cy.visitAndWaitUntilPageLoad(");
  });

  it("tags the it from the contract and the describe from the directory", async () => {
    // The two tags come from two different places and neither is the model's to choose. Getting
    // the it tag wrong runs the spec in a CI lane nobody watches, which no assertion catches.
    const repo = makeRepo();

    await runScenario(options(repo));
    const spec = fs.readFileSync(path.join(repo, SPEC), "utf8");

    expect(spec).toContain(
      "describe('Tests for device events', { tags: ['@deviceManagementTeam', '@dataAndControlTeam'] }"
    );
    expect(spec).toContain("{ tags: '@requiresBackend' }");
  });

  it("keeps every attempt, green run included, with the diff computed rather than claimed", async () => {
    const repo = makeRepo();

    const report = await runScenario(options(repo));
    const lines = fs
      .readFileSync(path.join(repo, ".cygen/runs/r1/attempts.jsonl"), "utf8")
      .trim()
      .split("\n");

    expect(lines).toHaveLength(2);
    expect(report.attempts[1]?.changed.length).toBeGreaterThan(0);
    expect(report.attempts[1]?.changed.map((c) => c.path)).toContain(
      "steps.check-source.assert.compare"
    );
  });

  it("keeps the source map, so an assist could still name a step", async () => {
    const repo = makeRepo();

    await runScenario(options(repo));
    const map = JSON.parse(
      fs.readFileSync(path.join(repo, ".cygen/runs/r1/sourcemap.json"), "utf8")
    ) as { entries: { stepId: string }[]; contentHash: string };

    expect(map.entries.map((e) => e.stepId)).toContain("check-latitude");
    expect(map.contentHash).toHaveLength(64);
  });

  it("records the cost as raw counts plus the price-table version", async () => {
    const repo = makeRepo();

    const report = await runScenario(options(repo));

    expect(report.cost.costUsd).toBeGreaterThan(0);
    expect(report.cost.outputTokens).toBe(6_000);
    expect(report.cost.cacheReadInputTokens).toBe(10_000);
    expect(report.attempts[0]?.usage?.priceTableVersion).toBe(PRICE_TABLE_VERSION);
    expect(report.attempts[0]?.prefixHash).toBe(report.attempts[1]?.prefixHash);
  });

  it("needs one probe run for B0, which is what the tripwire watches", async () => {
    const repo = makeRepo();

    const report = await runScenario(options(repo));

    expect(report.cost.probeRuns).toBe(1);
    expect(report.tripwireFired).toBe(false);
  });

  it("releases the lock, so the next run is not locked out by this one", async () => {
    const repo = makeRepo();

    await runScenario(options(repo));

    expect(fs.existsSync(path.join(repo, ".cygen/lock"))).toBe(false);
  });
});

describe("when the first emitted spec fails", () => {
  it("spends its heal rungs and then reports FAIL", async () => {
    const repo = makeRepo();

    const report = await runScenario(
      options(repo, { runsCypress: new ScriptedCypress(false) })
    );

    expect(report.score?.verdict).toBe("FAIL");
    // Green is a gate, so a healed-green run would still fail axis A - but the rungs are spent
    // trying, which is the difference between a measurement and a shrug.
    expect(report.cost.specRuns).toBeGreaterThan(1);
    expect(report.stopCondition).toBe("heal-exhausted");
  });

  it("maps the failure back to an IR step through the source map", async () => {
    const repo = makeRepo();

    const report = await runScenario(
      options(repo, { runsCypress: new ScriptedCypress(false) })
    );

    expect(report.attempts[1]?.failingStepPath).toMatch(/^steps\[\d+\]$/);
  });

  it("leaves no red spec behind, and still leaves its attempt log", async () => {
    const repo = makeRepo();

    await runScenario(options(repo, { runsCypress: new ScriptedCypress(false) }));

    expect(fs.existsSync(path.join(repo, SPEC))).toBe(false);
    expect(fs.existsSync(path.join(repo, ".cygen/runs/r1/attempts.jsonl"))).toBe(true);
  });

  it("still scores axis B, because coverage is checked independently of Cypress", async () => {
    const repo = makeRepo();

    const report = await runScenario(
      options(repo, { runsCypress: new ScriptedCypress(false) })
    );

    expect(report.score?.axisA.pass).toBe(false);
    expect(report.score?.axisB.pass).toBe(true);
  });
});

describe("when the model produces something the tool will not run", () => {
  it("spends a model turn and no Cypress run on a reply with no IR in it", async () => {
    const repo = makeRepo();
    const cypress = new ScriptedCypress(true);

    const report = await runScenario(
      options(repo, {
        runsCypress: cypress,
        callsModel: new ScriptedModel(["I think the selector is [data-cy=x]."]),
        limits: { probeRuns: 3, totalRuns: 6, modelTurns: 2 },
      })
    );

    expect(cypress.requests).toHaveLength(0);
    expect(report.cost.modelTurns).toBe(2);
    expect(report.cost.totalRuns).toBe(0);
    expect(report.attempts.every((a) => a.verdict === "rejected")).toBe(true);
  });

  it("spends no run on an IR the linter rejects", async () => {
    const repo = makeRepo();
    const cypress = new ScriptedCypress(true);
    const invented = b0Ir();
    invented.steps[0]!.callRepoHelper!.name = "postEvent";

    const report = await runScenario(
      options(repo, {
        runsCypress: cypress,
        callsModel: new ScriptedModel([fenced(invented)]),
        limits: { probeRuns: 3, totalRuns: 6, modelTurns: 2 },
      })
    );

    expect(cypress.requests).toHaveLength(0);
    // postEvent is a vocabulary gap, which a human answers by committing - so the run stops.
    expect(report.stopCondition).toBe("vocabulary-gap");
    expect(report.score).toBeNull();
  });

  it("refuses to overwrite a spec a human wrote at the same path", async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, SPEC), "describe('mine', () => {});\n");

    const report = await runScenario(options(repo));

    expect(fs.readFileSync(path.join(repo, SPEC), "utf8")).toBe(
      "describe('mine', () => {});\n"
    );
    expect(report.stopCondition).toBe("spec-path-not-ours");
  });
});

describe("the report", () => {
  it("prints a verdict per axis rather than a bare fraction", async () => {
    const repo = makeRepo();

    const text = formatReport(await runScenario(options(repo)));

    expect(text).toContain("VERDICT  PASS");
    expect(text).toContain("A green");
    expect(text).toContain("B outcome coverage PASS  7 of 7");
    expect(text).toContain("C flow equivalence  graded by a human");
    expect(text).toContain("interventions      0");
  });

  it("says which of the named stop conditions ended the run", async () => {
    const repo = makeRepo();

    const text = formatReport(
      await runScenario(options(repo, { runsCypress: new ScriptedCypress(false) }))
    );

    expect(text).toContain("stopped because:");
  });
});

describe("files the run did not mean to write", () => {
  it("names what a plugin of the target repo's own wrote into its tree", async () => {
    // Defect nine, as it happened: probe runs fail routinely, and each failure left a JSON file
    // carrying the developer's email address in a tracked directory.
    const repo = makeGitRepo();

    const report = await runScenario(
      options(repo, {
        runsCypress: new ScriptedCypress(true, "cypress/logs/failed-events.json"),
      })
    );

    expect(report.strays.strays).toEqual([
      { path: "cypress/logs/failed-events.json", kind: "added" },
    ]);
  });

  it("does not name the spec, which is the one file a run is asked to write", async () => {
    const repo = makeGitRepo();

    const report = await runScenario(options(repo));

    expect(report.strays.strays).toEqual([]);
    expect(report.strays.unavailable).toBeUndefined();
  });

  it("does not name the working area, even when the repo forgot to ignore it", async () => {
    const repo = makeGitRepo();
    fs.rmSync(path.join(repo, ".gitignore"));

    const report = await runScenario(options(repo));

    expect(report.strays.strays).toEqual([]);
  });

  it("says it could not tell, rather than reporting a clean tree, where git refuses", async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, ".git"), "not a gitfile\n");

    const report = await runScenario(options(repo));

    expect(report.strays.unavailable).toBeTruthy();
    expect(formatReport(report)).toContain("stray files        UNKNOWN");
  });

  it("prints the count on a clean run too, so the next non-zero one means something", async () => {
    const repo = makeGitRepo();

    const text = formatReport(await runScenario(options(repo)));

    expect(text).toContain("stray files        0");
  });

  it("prints each stray, and does not delete it", async () => {
    const repo = makeGitRepo();

    const report = await runScenario(
      options(repo, {
        runsCypress: new ScriptedCypress(true, "cypress/logs/failed-events.json"),
      })
    );

    expect(formatReport(report)).toContain("cypress/logs/failed-events.json");
    expect(fs.existsSync(path.join(repo, "cypress/logs/failed-events.json"))).toBe(true);
  });

  it("carries the finding into the score's notes, not only into stdout", async () => {
    // notes is what a harness reading report.score keeps. Leaving strays out of it would make
    // ticket 09's invariant measured but unrecorded.
    const repo = makeGitRepo();

    const report = await runScenario(
      options(repo, {
        runsCypress: new ScriptedCypress(true, "cypress/logs/failed-events.json"),
      })
    );

    expect(report.score?.notes.join(" ")).toContain("cypress/logs/failed-events.json");
  });

  it("still reports them when the run dies partway, which ticket 12 calls normal", async () => {
    const repo = makeGitRepo();
    const lines: string[] = [];
    // A boundary that writes into the repo and then throws: a crashed run has no RunReport to
    // carry the finding, and this is exactly when it would otherwise reach a commit unmentioned.
    const exploding: RunsCypress = {
      async run(request: RunRequest): Promise<CypressRunResult> {
        fs.mkdirSync(path.join(request.targetRepo, "cypress/logs"), { recursive: true });
        fs.writeFileSync(path.join(request.targetRepo, "cypress/logs/failed-x.json"), "{}");
        throw new Error("Electron died");
      },
    };

    await expect(
      runScenario(options(repo, { runsCypress: exploding, log: (l) => lines.push(l) }))
    ).rejects.toThrow("Electron died");

    expect(lines.join("\n")).toContain("cypress/logs/failed-x.json");
  });
});

describe("a run that never reaches spec mode", () => {
  /** Replies with a probe IR forever, so the loop spends its probe runs and stops. */
  function probeForever(repo: string) {
    return runScenario(
      options(repo, { callsModel: new ScriptedModel([fenced(b0ProbeIr())]) })
    );
  }

  it("leaves the spec that was already there, which it did not write", async () => {
    const repo = makeRepo();
    // What a previous green run wrote and somebody committed. It carries a matching header, so
    // the tool is permitted to delete it - the question is whether it should.
    const committed = withHeader(
      { toolVersion: "0.2.0", contractPath: CONTRACT },
      "describe('committed and green', () => {});\n"
    );
    fs.writeFileSync(path.join(repo, SPEC), committed);

    const report = await probeForever(repo);

    expect(report.stopCondition).toBe("budget-exhausted");
    expect(fs.readFileSync(path.join(repo, SPEC), "utf8")).toBe(committed);
  });

  it("still says why it stopped, though it has no score to say it in", async () => {
    const repo = makeRepo();

    const report = await probeForever(repo);

    // The notes ride on the score, and this run has none. They are the run's whole output.
    expect(report.tripwireFired).toBe(true);
    expect(formatReport(report)).toContain("TRIPWIRE");
  });
});

/**
 * A legal rung-1 patch. These tests are about the loop; what makes a *good* patch, and which
 * fields a diff may not reach, is patchDiff.spec.ts's subject. `meta.title` is free under the
 * frozen/free split, visible in the emitted spec, and touches no assertion.
 */
function retitled(suffix: string): IrDocument {
  const ir = b0Ir();
  return { ...ir, meta: { ...ir.meta, title: `${ir.meta.title}, ${suffix}` } };
}

const patched = (): IrDocument => retitled("healed");

/** What rung 2 asks for: the failing target demoted to provisional, and a collect point at it. */
function demotedTo(tag: string): IrDocument {
  const ir = b0Ir();
  const steps = ir.steps.map((step) =>
    step.id === "tabs-visible"
      ? {
          ...step,
          settle: { ...step.settle, target: { provisional: { tag } } },
        }
      : step
  );
  return {
    ...ir,
    steps: [
      ...steps.slice(0, 3),
      { id: "re-collect", collect: { label: "events-page", within: "c8y-tabs-outlet" } },
      ...steps.slice(3),
    ],
  } as IrDocument;
}

const demoted = (): IrDocument => demotedTo("c8y-tabs-outlet");

/**
 * The emitted line the `tabs-visible` settle owns. The compiler puts it at body line 32 and the
 * provenance header adds seven, and it is the step `demoted()` demotes - so a failure here is
 * the exact story Q15(b) is about.
 */
const TABS_VISIBLE_LINE = 39;

const promptsOf = (model: ScriptedModel): string[] =>
  model.requests.map((r) => r.prompt.tail.map((b) => b.text).join("\n"));

describe("the heal ladder, driven end to end", () => {
  it("patches after the first spec failure instead of ending the run", async () => {
    const repo = makeRepo();
    const model = new ScriptedModel([fenced(b0ProbeIr()), fenced(b0Ir()), fenced(patched())]);

    const report = await runScenario(
      options(repo, { callsModel: model, runsCypress: new ScriptedCypress([false, true]) })
    );

    expect(report.stopCondition).toBe("green");
    // Three turns: author probe, author spec, patch. The third is the one that did not exist.
    expect(model.requests).toHaveLength(3);
    expect(promptsOf(model)[2]).toContain("Rung 1 of 2: PATCH");
  });

  it("tells the patch turn which step the failure mapped to", async () => {
    const repo = makeRepo();
    const model = new ScriptedModel([fenced(b0ProbeIr()), fenced(b0Ir()), fenced(patched())]);

    await runScenario(
      options(repo, { callsModel: model, runsCypress: new ScriptedCypress([false, true]) })
    );

    expect(promptsOf(model)[2]).toMatch(/maps back to `steps\[\d+\]`/);
  });

  it("says so plainly when the failure mapped to no step at all", async () => {
    const repo = makeRepo();
    const model = new ScriptedModel([fenced(b0ProbeIr()), fenced(b0Ir()), fenced(patched())]);

    await runScenario(
      options(repo, {
        callsModel: model,
        runsCypress: new ScriptedCypress([false, true], undefined, 1),
      })
    );

    expect(promptsOf(model)[2]).toContain("mapped back to no step");
  });

  it("re-probes after the second failure, because facts on hand were not enough", async () => {
    const repo = makeRepo();
    const model = new ScriptedModel([
      fenced(b0ProbeIr()),
      fenced(b0Ir()),
      fenced(patched()),
      fenced(demoted()),
      fenced(patched()),
    ]);

    const report = await runScenario(
      options(repo, {
        callsModel: model,
        // Line 1 owns no statement, so the failure maps to no step and Q15(b) cannot fire.
        runsCypress: new ScriptedCypress([false, false, true], undefined, 1),
      })
    );

    expect(promptsOf(model)[3]).toContain("Rung 2 of 2: RE-PROBE");
    expect(report.stopCondition).toBe("green");
    // Ticket 10's pinned shape: probe, fail, patch, fail, re-probe, pass. Five, one spare.
    expect(report.cost.totalRuns).toBe(5);
  });

  it("stops once the patch and the re-probe are both spent", async () => {
    const repo = makeRepo();
    const model = new ScriptedModel([
      fenced(b0ProbeIr()),
      fenced(b0Ir()),
      fenced(patched()),
      fenced(demoted()),
      fenced(patched()),
    ]);

    const report = await runScenario(
      options(repo, {
        callsModel: model,
        runsCypress: new ScriptedCypress([false, false, false], undefined, 1),
      })
    );

    expect(report.stopCondition).toBe("heal-exhausted");
  });

  it("does not carry a spent rung into the turn after the run it asked for", async () => {
    const repo = makeRepo();
    const model = new ScriptedModel([
      fenced(b0ProbeIr()),
      fenced(b0Ir()),
      fenced(patched()),
      fenced(demoted()),
      fenced(retitled("after the re-probe")),
    ]);

    await runScenario(
      options(repo, {
        callsModel: model,
        runsCypress: new ScriptedCypress([false, false, true], undefined, 1),
      })
    );

    // The model obeys. Told to re-probe when it already has, it demotes again, compiles in
    // probe mode again, and loops until the probe cap ends the run with no spec to show.
    expect(promptsOf(model)[3]).toContain("Rung 2 of 2: RE-PROBE");
    expect(promptsOf(model)[4]).not.toContain("heal turn");
  });

  it("does not heal a run that never emitted a spec", async () => {
    const repo = makeRepo();
    const model = new ScriptedModel([fenced(b0ProbeIr())]);

    await runScenario(options(repo, { callsModel: model }));

    expect(promptsOf(model).every((p) => !p.includes("heal turn"))).toBe(true);
  });
});

describe("what the heal turn is still not allowed to do", () => {
  /** The re-probe taken back out, and an assertion quietly weakened on the way. */
  function weakenedAfterReprobe(): IrDocument {
    const ir = patched();
    const steps = ir.steps.map((step) =>
      step.assert ? { ...step, assert: { ...step.assert, cardinality: { exactly: 1 } } } : step
    );
    return { ...ir, steps } as IrDocument;
  }

  it("rejects a weakened assertion on the turn that ends a re-probe", async () => {
    // The loop used to clear `previousSpecFailed` on every compile, probe included - so the
    // turn after a rung-2 re-probe was the one turn in the run with no frozen/free split at
    // all, on the rung reached only after two spec failures.
    const repo = makeRepo();
    const model = new ScriptedModel([
      fenced(b0ProbeIr()),
      fenced(b0Ir()),
      fenced(patched()),
      fenced(demoted()),
      fenced(weakenedAfterReprobe()),
    ]);

    const report = await runScenario(
      options(repo, {
        callsModel: model,
        runsCypress: new ScriptedCypress([false, false, true], undefined, 1),
      })
    );

    const rejected = report.attempts.filter((a) => a.verdict === "rejected");
    expect(rejected[0]?.rejectReason).toMatch(/frozen field/);
    // One rejected diff is re-prompted; a second asks a human. It never reaches a Cypress run.
    expect(report.stopCondition).toBe("heal-rejected-twice");
  });

  it("does not count a failed probe run as a value that was tried and failed", async () => {
    // A probe dying partway is normal - it is how a wrong provisional guess reports itself.
    // Counting it as patch history indexed every field that iteration touched as
    // already-failed, so the re-point a later probe confirmed came back rejected.
    const repo = makeRepo();
    const model = new ScriptedModel([
      fenced(b0ProbeIr()),
      fenced(demoted()),
      fenced(b0Ir()),
      fenced(demoted()),
      fenced(patched()),
    ]);

    const report = await runScenario(
      options(repo, {
        callsModel: model,
        // Probe passes, probe FAILS, spec fails, probe passes, spec passes. The rung-1 patch at
        // turn 4 re-uses the values the failed probe at turn 2 set - and a probe failing is how
        // a wrong provisional guess reports itself, not evidence that those values are wrong.
        runsCypress: new ScriptedCypress([false, true], undefined, 1, [true, false, true]),
      })
    );

    expect(report.attempts.filter((a) => a.verdict === "rejected")).toEqual([]);
    expect(report.stopCondition).toBe("green");
  });
});

describe("when healing has to stop and ask a human", () => {
  /** probe, spec fail, spec fail, re-probe, and the ladder lands back where it started. */
  const confirmsTheSelector = (): ScriptedModel =>
    new ScriptedModel([
      fenced(b0ProbeIr()),
      fenced(b0Ir()),
      fenced(patched()),
      fenced(demoted()),
      fenced(b0Ir()),
    ]);

  it("fires when the re-probe resolves the selector that just failed", async () => {
    const repo = makeRepo();
    // Ticket 11 Q15(b): the probe just re-observed the element and the ladder landed on the
    // same selector, so the failure was never a selector problem. Re-running proves nothing.
    const model = confirmsTheSelector();

    const report = await runScenario(
      options(repo, {
        callsModel: model,
        runsCypress: new ScriptedCypress(false, undefined, TABS_VISIBLE_LINE),
      })
    );

    expect(report.stopCondition).toBe("app-contradicts-scenario");
    // The point of the rule is the run it does NOT spend: probe, spec, spec, probe, then stop.
    expect(report.cost.totalRuns).toBe(4);
  });

  it("does not claim a re-probe that never ran", async () => {
    const repo = makeRepo();
    // Rung 2 is offered, but the model answers with a spec IR rather than demoting, so no
    // probe runs. Q15(b) is a statement about what a re-probe observed; with no re-probe there
    // is nothing to say, and saying it would put a false sentence in front of a human.
    const model = new ScriptedModel([
      fenced(b0ProbeIr()),
      fenced(b0Ir()),
      fenced(retitled("one")),
      fenced(retitled("two")),
    ]);

    const report = await runScenario(
      options(repo, {
        callsModel: model,
        runsCypress: new ScriptedCypress(false, undefined, TABS_VISIBLE_LINE),
      })
    );

    expect(report.stopCondition).toBe("heal-exhausted");
  });

  it("keeps the red spec, which the assist packet needs in order to name a step", async () => {
    const repo = makeRepo();

    await runScenario(
      options(repo, {
        callsModel: confirmsTheSelector(),
        runsCypress: new ScriptedCypress(false, undefined, TABS_VISIBLE_LINE),
      })
    );

    expect(fs.readFileSync(path.join(repo, SPEC), "utf8")).toContain("NOT GREEN");
  });

  it("takes the model's word that the app contradicts the scenario", async () => {
    const repo = makeRepo();
    const asks =
      'I cannot fix this.\n\n```json\n' +
      '{"assist":{"why":"the timeline shows one event, the scenario says three"}}\n```\n';
    const model = new ScriptedModel([fenced(b0ProbeIr()), fenced(b0Ir()), asks]);

    const report = await runScenario(
      options(repo, { callsModel: model, runsCypress: new ScriptedCypress([false, true]) })
    );

    expect(report.stopCondition).toBe("app-contradicts-scenario");
    // Green is a gate, so this is a FAIL that carries a question rather than a shrug.
    expect(report.score?.verdict).toBe("FAIL");
    expect(report.score?.interventions.join(" ")).toContain("the timeline shows one event");
  });

  it("re-prompts one rejected diff, then stops rather than looping for free", async () => {
    const repo = makeRepo();
    // A frozen edit: weakening the comparator, which is the attack the split exists to stop.
    const weakened = (): IrDocument => {
      const ir = b0Ir();
      return {
        ...ir,
        steps: ir.steps.map((step) =>
          step.id === "check-source" && step.assert
            ? { ...step, assert: { ...step.assert, compare: "equals" as const } }
            : step
        ),
      };
    };
    const model = new ScriptedModel([
      fenced(b0ProbeIr()),
      fenced(b0Ir()),
      fenced(weakened()),
      fenced(weakened()),
    ]);

    const report = await runScenario(
      options(repo, { callsModel: model, runsCypress: new ScriptedCypress(false) })
    );

    expect(report.stopCondition).toBe("heal-rejected-twice");
    // A rejection is free in Cypress runs, which is the resource the budget meters - so the cap
    // is the only thing that stops a model retrying a frozen edit until the turn cap catches it.
    expect(report.cost.totalRuns).toBe(2);
    expect(promptsOf(model)[3]).toContain("last attempt");
  });
});

