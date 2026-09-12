/**
 * The recovery ladder: what a failed spec run is allowed to try next.
 *
 * Ticket 11 settled that the unit of recovery is a bounded diff on the IR, and that the two
 * rungs differ not in size but in *where the information comes from*:
 *
 *   rung 1  PATCH     spends no run to decide. May only re-arrange facts already observed -
 *                     re-point a step at another candidate row the probe already saw, change
 *                     scope or index, insert a settle.
 *   rung 2  RE-PROBE  spends a probe run, because new observation is the only legal way to
 *                     learn anything new. The selector is demoted to `provisional` and the
 *                     ladder resolves it again.
 *
 * The model never authors a selector on either rung. It re-points or it demotes. A hand-written
 * selector on the heal path would re-open the exact hole generation closed, on the one path
 * where the model is most motivated to guess.
 *
 * Everything here is keyed on the step **id**, never on its position. Both rungs invite the
 * model to insert a step - a settle before the failing one, a collect at it - and one insertion
 * re-numbers every path after it. `patchDiff` already keys its diff on the id for exactly this
 * reason; a positional lookup here would silently follow the insertion to a different step.
 */
import { allSteps, isProvisional, targetOf, type IrDocument } from "../ir/types.js";

export type HealRung = "patch" | "re-probe";

/** Ids are unique in a valid IR; the linter refuses duplicates before anything reaches here. */
function stepById(ir: IrDocument, id: string) {
  return allSteps(ir).find((s) => s.id === id);
}

/**
 * Which rung a spec failure lands on. The counter is **per spec run, never per step**.
 *
 * Forced by a measured fact rather than chosen: Cypress stops an `it()` at its first failure,
 * so one spec run yields at most one diagnostic whatever else is broken downstream. A per-step
 * counter would let a flow with four wrong selectors consume four patch runs and blow the
 * six-run cap; one re-probe re-collects everything from the failure point and fixes them
 * together.
 *
 * Null means the ladder is out of rungs. Ticket 10 pinned the shape at probe, fail, patch,
 * fail, re-probe, pass - five runs with one spare - so a third spec failure has nowhere left
 * to go and the run ends and reports.
 */
export function rungFor(specFailures: number): HealRung | null {
  if (specFailures === 1) return "patch";
  if (specFailures === 2) return "re-probe";
  return null;
}

/**
 * Whether the step a failure named still resolves to the selector that just failed.
 *
 * Ticket 11 Q15(b): when a re-probe's ladder lands back on the selector that failed, the
 * element is there and the selector is right, so the failure was never a selector problem.
 * Re-running would fail identically with five of six runs already spent. Stop and ask a human
 * instead - and the question is unusually strong, because the probe has just re-observed the
 * thing: *this selector is correct, and the assertion still fails.*
 */
export function resolvesToSameSelector(
  ir: IrDocument,
  failingStepId: string | null,
  failedSelector: string | null
): boolean {
  if (!failingStepId || !failedSelector) return false;
  const step = stepById(ir, failingStepId);
  if (!step) return false;
  const target = targetOf(step);
  // Still provisional means the re-probe has not resolved it yet, not that it agreed.
  if (!target || isProvisional(target)) return false;
  return target.resolved === failedSelector;
}

/** The resolved selector at a step, for recording what a failure was pointed at. */
export function selectorAt(ir: IrDocument, id: string | null): string | null {
  if (!id) return null;
  const step = stepById(ir, id);
  const target = step ? targetOf(step) : undefined;
  if (!target || isProvisional(target)) return null;
  return target.resolved;
}
