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
import { runScenario, formatReport, type RunOptions } from "./runScenario.js";
import { PRICE_TABLE_VERSION } from "../pricing/modelPricing.js";
import { packagePath } from "../support/assets.js";
import { b0Ir, b0ProbeIr, b0ProbePayloads } from "../testing/b0.js";
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

  constructor(private readonly specRunPasses: boolean) {}

  async run(request: RunRequest): Promise<CypressRunResult> {
    this.requests.push({ ...request });
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
      return {
        pass: true,
        testFailures: [],
        specFailures: [],
        durationMs: 30_000,
        startedAt: new Date().toISOString(),
      };
    }
    if (this.specRunPasses) {
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
            `    at Context.eval (webpack://ui/./${SPEC}:34:10)`,
          location: { file: SPEC, line: 34, column: 10 },
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
  it("ends the run and reports, because there is no heal rung in this slice", async () => {
    const repo = makeRepo();

    const report = await runScenario(
      options(repo, { runsCypress: new ScriptedCypress(false) })
    );

    expect(report.score?.verdict).toBe("FAIL");
    expect(report.cost.specRuns).toBe(1);
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
