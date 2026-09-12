/**
 * The budget, denominated in Cypress runs.
 *
 * The run is the only expensive, irreversible, tenant-touching operation, so it is the unit.
 * v1 counted tool-call turns because six of its ten tools were sub-second browser calls; those
 * six are gone.
 *
 * Two counters, not one. Model turns are counted beside runs because a loop thrashing on lint
 * rejections costs dollars and advances no run counter - "silently exhausted with no visibility
 * into why", in a new costume.
 */

export interface BudgetLimits {
  /** The pre-registered tripwire made operational: exceeding it reopens the Cypress-probe decision. */
  probeRuns: number;
  totalRuns: number;
  /**
   * Derived rather than invented: two rejected diffs per failure against the total-run cap. It
   * exists so a lint-thrash loop terminates, not to shape the work.
   */
  modelTurns: number;
}

export const DEFAULT_LIMITS: BudgetLimits = {
  probeRuns: 3,
  totalRuns: 6,
  modelTurns: 12,
};

export type BudgetStop = "probe-runs" | "total-runs" | "model-turns";

export class Budget {
  private probe = 0;
  private total = 0;
  private turns = 0;

  constructor(readonly limits: BudgetLimits = DEFAULT_LIMITS) {}

  get probeRuns(): number {
    return this.probe;
  }
  get totalRuns(): number {
    return this.total;
  }
  get modelTurns(): number {
    return this.turns;
  }

  countModelTurn(): void {
    this.turns += 1;
  }

  countRun(kind: "probe" | "spec"): void {
    if (kind === "probe") this.probe += 1;
    this.total += 1;
  }

  /** Whether a run of this kind may still be spent. Checked before spending, never after. */
  mayRun(kind: "probe" | "spec"): BudgetStop | null {
    if (this.total >= this.limits.totalRuns) return "total-runs";
    if (kind === "probe" && this.probe >= this.limits.probeRuns) return "probe-runs";
    return null;
  }

  mayCallModel(): BudgetStop | null {
    return this.turns >= this.limits.modelTurns ? "model-turns" : null;
  }

  /** "run 3 of 6, four of five Expected Outcomes covered" - progress a human can read. */
  progressLine(outcomesCovered: number, outcomesTotal: number): string {
    return (
      `run ${this.total} of ${this.limits.totalRuns} ` +
      `(probe ${this.probe} of ${this.limits.probeRuns}, model turn ${this.turns} of ${this.limits.modelTurns}), ` +
      `${outcomesCovered} of ${outcomesTotal} Expected Outcomes covered`
    );
  }

  /**
   * Roughly three probe runs for one scenario reopens the Cypress-probe decision. It is a
   * condition to watch, so it is reported rather than quietly enforced away.
   *
   * Reaching the cap, not passing it. `mayRun` refuses the run that would pass it, so `>` is a
   * condition this class makes unreachable - a tripwire that cannot fire watches nothing.
   */
  tripwireFired(): boolean {
    return this.probe >= this.limits.probeRuns;
  }
}
