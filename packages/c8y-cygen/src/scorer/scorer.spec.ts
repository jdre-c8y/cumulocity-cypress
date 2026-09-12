import { checkOutcomeCoverage, score, type ScoreInput } from "./scorer.js";
import { Budget, DEFAULT_LIMITS } from "../budget/budget.js";
import { compile } from "../compiler/compile.js";
import { buildSourceMap } from "../compiler/sourceMap.js";
import { b0Contract, b0Conventions, b0Ir } from "../testing/b0.js";
import type { CypressRunResult } from "../cypress/cypressDriver.js";
import type { RunTotals } from "../attempt/attemptLog.js";

const NO_COST: RunTotals = {
  iterations: 2,
  modelTurns: 2,
  probeRuns: 1,
  specRuns: 1,
  totalRuns: 2,
  costUsd: 0.42,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadInputTokens: 1,
  cacheCreationInputTokens: 1,
  runGapsMs: [420_000],
};

const GREEN: CypressRunResult = {
  pass: true,
  testFailures: [],
  specFailures: [],
  durationMs: 40_000,
  startedAt: "2026-09-09T10:00:00.000Z",
};

const RED: CypressRunResult = {
  pass: false,
  testFailures: [
    {
      title: ["Tests for device events", "Verify"],
      errorMessage: "AssertionError: expected 3 to equal 1",
    },
  ],
  specFailures: [],
  durationMs: 40_000,
  startedAt: "2026-09-09T10:00:00.000Z",
};

function built() {
  const compiled = compile({ ir: b0Ir(), mode: "spec", conventions: b0Conventions() });
  return {
    specText: compiled.text,
    sourceMap: buildSourceMap("cypress/e2e/x.cy.ts", compiled.text, compiled.statements),
  };
}

function input(over: Partial<ScoreInput> = {}): ScoreInput {
  const { specText, sourceMap } = built();
  return {
    contract: b0Contract(),
    specText,
    specPath: "cypress/e2e/dataAndControlTeam/events.cy.ts",
    sourceMap,
    runResult: GREEN,
    specAttempts: 1,
    retriesDisabled: true,
    interventions: [],
    cost: NO_COST,
    ...over,
  };
}

describe("axis B, outcome coverage", () => {
  it("maps every Expected Outcome to a concrete assertion in the emitted spec", () => {
    const coverage = checkOutcomeCoverage(b0Contract(), built().specText, built().sourceMap);

    expect(coverage.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(coverage.every((c) => c.covered)).toBe(true);
  });

  it("quotes the assertion, so a human can check the machine", () => {
    const coverage = checkOutcomeCoverage(b0Contract(), built().specText, built().sourceMap);

    expect(coverage[6]?.assertions.join("\n")).toContain("contain.text', '52.534925'");
  });

  it("is checked independently of what Cypress reported", () => {
    // A spec must not be able to pass by asserting nothing, and a red spec's coverage is still
    // worth knowing.
    const green = score(input({ runResult: GREEN }));
    const red = score(input({ runResult: RED }));

    expect(green.axisB.covered).toBe(red.axisB.covered);
    expect(red.axisB.pass).toBe(true);
  });

  it("fails when a statement that claims an outcome carries no assertion", () => {
    const { specText, sourceMap } = built();
    const gutted = {
      ...sourceMap,
      entries: sourceMap.entries.map((e) =>
        e.stepId === "check-latitude" || e.stepId === "check-longitude"
          ? { ...e, fromLine: 1, toLine: 1 }
          : e
      ),
    };

    const result = score(input({ specText, sourceMap: gutted }));

    expect(result.axisB.pass).toBe(false);
    expect(result.axisB.outcomes.find((o) => o.id === 7)?.covered).toBe(false);
  });
});

describe("the verdict", () => {
  it("is PASS when green on the first attempt with every outcome covered and no help", () => {
    expect(score(input()).verdict).toBe("PASS");
  });

  it("is PASS-WITH-ASSIST when a human had to answer something on the way", () => {
    const result = score(input({ interventions: ["approved cy.postEvent as a blessed move"] }));

    expect(result.verdict).toBe("PASS-WITH-ASSIST");
    expect(result.interventions).toHaveLength(1);
  });

  it("is FAIL when the spec only went green on a later attempt", () => {
    const result = score(input({ specAttempts: 2 }));

    expect(result.verdict).toBe("FAIL");
    expect(result.axisA.detail).toMatch(/not on the first attempt/);
  });

  it("names the attempt it actually took, because a heal run reads this line as a fact", () => {
    // It read "a spec that passes on attempt three is flaky" whatever the count was. The first
    // live heal run went green on attempt two and the report said three.
    expect(score(input({ specAttempts: 2 })).axisA.detail).toContain("it passed on attempt 2");
    expect(score(input({ specAttempts: 3 })).axisA.detail).toContain("it passed on attempt 3");
  });

  it("is FAIL when green was reached with retries the target repo tolerates", () => {
    const result = score(input({ retriesDisabled: false }));

    expect(result.verdict).toBe("FAIL");
    expect(result.axisA.detail).toMatch(/retries were not forced to zero/);
  });

  it("is FAIL when no spec run ever happened", () => {
    const result = score(input({ runResult: null }));

    expect(result.verdict).toBe("FAIL");
    expect(result.axisA.detail).toBe("no spec run happened");
  });

  it("hands axes C and D to a human, with the four things each is judged on", () => {
    const result = score(input());

    expect(result.axisC.inputs).toHaveLength(4);
    expect(result.axisD.graded).toBe("human");
  });
});

describe("the budget", () => {
  it("meters Cypress runs, which is the only expensive irreversible operation", () => {
    const budget = new Budget();
    for (let i = 0; i < DEFAULT_LIMITS.totalRuns; i++) budget.countRun("spec");

    expect(budget.mayRun("spec")).toBe("total-runs");
  });

  it("caps probe runs separately, so the tripwire fires rather than passing silently", () => {
    const budget = new Budget();
    for (let i = 0; i < DEFAULT_LIMITS.probeRuns; i++) budget.countRun("probe");

    expect(budget.mayRun("probe")).toBe("probe-runs");
    expect(budget.mayRun("spec")).toBeNull();
  });

  it("stops a loop that thrashes on lint rejections and never spends a run", () => {
    const budget = new Budget();
    for (let i = 0; i < DEFAULT_LIMITS.modelTurns; i++) budget.countModelTurn();

    expect(budget.totalRuns).toBe(0);
    expect(budget.mayCallModel()).toBe("model-turns");
  });

  it("prints progress a human can read rather than a bare turn count", () => {
    const budget = new Budget();
    budget.countRun("probe");
    budget.countModelTurn();

    expect(budget.progressLine(4, 7)).toBe(
      "run 1 of 6 (probe 1 of 3, model turn 1 of 12), 4 of 7 Expected Outcomes covered"
    );
  });
});
