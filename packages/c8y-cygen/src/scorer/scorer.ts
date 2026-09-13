/**
 * The scorer. Emitted spec plus contract plus run result in, a verdict out.
 *
 * Reported as PASS or FAIL per axis, never as a bare fraction, because "green but gamed" and
 * "correct but red" have to stay distinguishable.
 *
 *   A. Green            - binary, gate. First attempt, retries disabled.
 *   B. Outcome coverage - binary, machine-checkable, and checked INDEPENDENTLY of whether
 *                         Cypress reported green. A spec must not be able to pass by asserting
 *                         nothing.
 *   C. Flow equivalence - graded by a human for this slice.
 *   D. House style      - graded by a human for this slice.
 */
import type { ScenarioContract } from "../contract/scenarioContract.js";
import type { CypressRunResult } from "../cypress/cypressDriver.js";
import type { SourceMap } from "../compiler/sourceMap.js";
import type { RunTotals } from "../attempt/attemptLog.js";

export type Verdict = "PASS" | "PASS-WITH-ASSIST" | "FAIL";

export interface OutcomeCoverage {
  id: number;
  text: string;
  covered: boolean;
  /** The emitted assertions that satisfy it, quoted so a human can check the machine. */
  assertions: string[];
}

export interface Score {
  verdict: Verdict;
  axisA: { pass: boolean; detail: string };
  axisB: { pass: boolean; covered: number; total: number; outcomes: OutcomeCoverage[] };
  axisC: { graded: "human"; inputs: string[] };
  axisD: { graded: "human"; inputs: string[] };
  /** Count and kind. Zero is what separates PASS from PASS-WITH-ASSIST. */
  interventions: string[];
  cost: RunTotals;
  notes: string[];
}

export interface ScoreInput {
  contract: ScenarioContract;
  /** The emitted spec exactly as it landed, formatter and all. */
  specText: string;
  specPath: string;
  sourceMap: SourceMap;
  /** null when no spec run ever happened. */
  runResult: CypressRunResult | null;
  /**
   * How many spec runs the loop spent. Axis A wants the first one to have been the green one,
   * and the count rather than a boolean because the report names it: a run that heals says so
   * with the attempt it actually took.
   */
  specAttempts: number;
  retriesDisabled: boolean;
  interventions: string[];
  cost: RunTotals;
  notes?: string[];
}

const ASSERTION = /\.should\(|expect\(/;

/**
 * Axis B, read off the emitted TypeScript rather than off the IR.
 *
 * The IR is what the model wrote; the spec is what ships. Checking the artifact that ships is
 * the only version of this check that a compiler bug cannot fool.
 */
export function checkOutcomeCoverage(
  contract: ScenarioContract,
  specText: string,
  sourceMap: SourceMap
): OutcomeCoverage[] {
  const lines = specText.split("\n");
  return contract.outcomes.map((outcome) => {
    const assertions: string[] = [];
    for (const entry of sourceMap.entries) {
      if (!entry.outcomes.includes(outcome.id)) continue;
      const text = lines.slice(entry.fromLine - 1, entry.toLine).join("\n");
      if (ASSERTION.test(text)) assertions.push(text.trim());
    }
    return {
      id: outcome.id,
      text: outcome.text,
      covered: assertions.length > 0,
      assertions,
    };
  });
}

export function score(input: ScoreInput): Score {
  const outcomes = checkOutcomeCoverage(input.contract, input.specText, input.sourceMap);
  const covered = outcomes.filter((o) => o.covered).length;
  const notes = [...(input.notes ?? [])];

  // A statement the map could not anchor reads here as an outcome with no assertion. Say so,
  // rather than letting a defect in the map be reported as a defect in the spec.
  if (input.sourceMap.unanchored.length > 0) {
    notes.push(
      `the source map could not locate ${input.sourceMap.unanchored.length} emitted statement(s) ` +
        `(${input.sourceMap.unanchored.join(", ")}); any outcome they satisfy reads as uncovered here`
    );
  }

  const greenNow = input.runResult?.pass === true;
  const axisAPass = greenNow && input.specAttempts === 1 && input.retriesDisabled;
  const axisADetail = !input.runResult
    ? "no spec run happened"
    : !greenNow
      ? `Cypress reported ${input.runResult.testFailures.length} test failure(s) and ${input.runResult.specFailures.length} spec failure(s)`
      : !input.retriesDisabled
        ? "green, but retries were not forced to zero, so this does not count"
        : input.specAttempts !== 1
          ? `green, but not on the first attempt - it passed on attempt ${input.specAttempts}, ` +
            `and a spec that needs a heal to go green is flaky until it stops needing one`
          : "green on the first attempt with retries disabled";

  const axisBPass = covered === outcomes.length;

  // Green is a gate: if axis A fails the graded axes are not scored.
  const verdict: Verdict = !axisAPass
    ? "FAIL"
    : !axisBPass
      ? "FAIL"
      : input.interventions.length > 0
        ? "PASS-WITH-ASSIST"
        : "PASS";

  return {
    verdict,
    axisA: { pass: axisAPass, detail: axisADetail },
    axisB: { pass: axisBPass, covered, total: outcomes.length, outcomes },
    axisC: {
      graded: "human",
      inputs: [
        "same navigation entry point as the reference",
        "the same set of state-changing interactions, in an order that reaches the same states",
        "the same assertion subjects - the DOM facts asserted, not the phrasing",
        "no tenant mutation the reference does not make",
      ],
    },
    axisD: {
      graded: "human",
      inputs: [
        "selector-ladder rung chosen where a higher rung was available",
        "grep tags: the describe's come from the directory, the it's from the contract's '## Tags' section - a missing it tag means the contract did not declare one",
        "auth and navigation idiom matching the target repo",
        "file location and naming",
        "reuse of existing repo helpers and fixtures rather than reinventing them",
        "mocked versus integration style consistent with the contract's Style",
        "outcomes asserting a value a stub in the same test wrote - legal, counted below, and the thing to read the flow for",
        "an anchored `cy.contains(sel, /^\\s*text\\s*$/)` is a DELIBERATE deviation, not a lapse: 11 of the corpus's 1611 contains() calls carry a regex, and the ladder emits one only where a text is a prefix of another on the same surface. The alternative is `.first()`, which resolves the ambiguity by DOM order. Ticket 18 Q2 carries the argument",
      ],
    },
    interventions: input.interventions,
    cost: input.cost,
    notes,
  };
}

export function formatScore(score: Score, specPath: string): string {
  const lines: string[] = [];
  lines.push(`VERDICT  ${score.verdict}`);
  lines.push(`  A green            ${score.axisA.pass ? "PASS" : "FAIL"}  ${score.axisA.detail}`);
  lines.push(
    `  B outcome coverage ${score.axisB.pass ? "PASS" : "FAIL"}  ${score.axisB.covered} of ${score.axisB.total}, checked against the emitted spec independently of Cypress`
  );
  for (const outcome of score.axisB.outcomes) {
    lines.push(`     ${outcome.covered ? "ok  " : "MISS"} ${outcome.id}. ${outcome.text}`);
  }
  lines.push("  C flow equivalence  graded by a human:");
  for (const i of score.axisC.inputs) lines.push(`     - ${i}`);
  lines.push("  D house style       graded by a human:");
  for (const i of score.axisD.inputs) lines.push(`     - ${i}`);
  lines.push("");
  lines.push(`  spec               ${specPath}`);
  lines.push(
    `  interventions      ${score.interventions.length}${
      score.interventions.length > 0 ? `: ${score.interventions.join("; ")}` : ""
    }`
  );
  lines.push(
    `  cost               $${score.cost.costUsd.toFixed(4)} over ${score.cost.iterations} iteration(s), ` +
      `${score.cost.totalRuns} Cypress run(s) (${score.cost.probeRuns} probe), ${score.cost.modelTurns} model turn(s)`
  );
  lines.push(
    `  tokens             in ${score.cost.inputTokens}, out ${score.cost.outputTokens}, ` +
      `cache read ${score.cost.cacheReadInputTokens}, cache write ${score.cost.cacheCreationInputTokens}`
  );
  if (score.cost.runGapsMs.length > 0) {
    const gaps = score.cost.runGapsMs.map((ms) => `${(ms / 1000).toFixed(0)}s`).join(", ");
    lines.push(`  run start gaps     ${gaps}  (the one-hour TTL decision turns on whether these exceed 5 min)`);
  }
  for (const note of score.notes) lines.push(`  note               ${note}`);
  return lines.join("\n");
}
