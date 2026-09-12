import { Budget, DEFAULT_LIMITS } from "./budget.js";

/** Spends probe runs the way the loop does: ask first, then count. */
function spendProbes(budget: Budget, wanted: number): number {
  let spent = 0;
  for (let i = 0; i < wanted; i++) {
    if (budget.mayRun("probe")) break;
    budget.countRun("probe");
    spent += 1;
  }
  return spent;
}

describe("the probe tripwire", () => {
  it("fires when the cap is reached", () => {
    const budget = new Budget(DEFAULT_LIMITS);

    spendProbes(budget, DEFAULT_LIMITS.probeRuns);

    expect(budget.tripwireFired()).toBe(true);
  });

  it("does not fire below the cap, so a normal run reports nothing", () => {
    const budget = new Budget(DEFAULT_LIMITS);

    // Ticket 12's formula: one probe run, plus one per provisional that missed. B0 measured two.
    spendProbes(budget, 2);

    expect(budget.probeRuns).toBe(2);
    expect(budget.tripwireFired()).toBe(false);
  });

  it("watches the cap because the count can never pass it", () => {
    const budget = new Budget(DEFAULT_LIMITS);

    // mayRun refuses the run that would pass the cap, so a tripwire testing for "more than the
    // cap" tests a condition this class makes unreachable. It would never fire, and the
    // Cypress-probe decision it exists to reopen would stay closed on a technicality.
    const spent = spendProbes(budget, DEFAULT_LIMITS.probeRuns + 5);

    expect(spent).toBe(DEFAULT_LIMITS.probeRuns);
    expect(budget.probeRuns).toBe(DEFAULT_LIMITS.probeRuns);
    expect(budget.mayRun("probe")).toBe("probe-runs");
  });
});

describe("the two counters", () => {
  it("counts a spec run against the total but not against the probe cap", () => {
    const budget = new Budget(DEFAULT_LIMITS);

    budget.countRun("spec");

    expect(budget.probeRuns).toBe(0);
    expect(budget.totalRuns).toBe(1);
    expect(budget.mayRun("probe")).toBeNull();
  });

  it("stops on the total cap even when probe runs are still available", () => {
    const budget = new Budget({ probeRuns: 3, totalRuns: 2, modelTurns: 12 });

    budget.countRun("spec");
    budget.countRun("spec");

    expect(budget.mayRun("probe")).toBe("total-runs");
  });

  it("counts model turns beside runs, so a lint thrash cannot spend dollars unseen", () => {
    const budget = new Budget({ probeRuns: 3, totalRuns: 6, modelTurns: 2 });

    budget.countModelTurn();
    budget.countModelTurn();

    expect(budget.mayCallModel()).toBe("model-turns");
    expect(budget.totalRuns).toBe(0);
  });
});
