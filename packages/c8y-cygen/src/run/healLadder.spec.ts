import { rungFor, resolvesToSameSelector, selectorAt, type HealRung } from "./healLadder.js";
import type { IrDocument, IrStep } from "../ir/types.js";

function irOf(steps: IrStep[], setup: IrStep[] = []): IrDocument {
  return {
    version: 1,
    meta: { contract: "c.md", suite: "s", title: "t", style: "integration" },
    setup,
    steps,
    outcomes: [],
  };
}

function settleOn(id: string, selector: string, row = "surface#1"): IrStep {
  return {
    id,
    settle: { target: { resolved: selector, fromRow: row }, state: "visible" },
  };
}

const SELECTOR = "cy.get('[data-cy=\"x\"]')";

describe("the rung ladder", () => {
  it("patches on the first spec failure, because no run is needed to re-point a step", () => {
    expect(rungFor(1)).toBe<HealRung>("patch");
  });

  it("re-probes on the second, because new observation is the only legal way to learn", () => {
    expect(rungFor(2)).toBe<HealRung>("re-probe");
  });

  it("stops after the second, which is ticket 10's pinned five-run shape with one spare", () => {
    // probe, fail, patch, fail, re-probe, pass. A third spec failure has no rung left.
    expect(rungFor(3)).toBeNull();
    expect(rungFor(9)).toBeNull();
  });

  it("has no rung before anything has failed", () => {
    expect(rungFor(0)).toBeNull();
  });
});

describe("the re-probe that confirms the selector it was sent to replace", () => {
  const ir = irOf([settleOn("open", SELECTOR)]);

  it("is caught, so the run is not spent proving the same thing twice", () => {
    // Ticket 11 Q15(b): the element is there and the selector is right, so the failure was
    // never a selector problem. Re-running would fail identically with 5 of 6 runs gone.
    expect(resolvesToSameSelector(ir, "open", SELECTOR)).toBe(true);
  });

  it("does not fire when the ladder resolved somewhere else", () => {
    expect(resolvesToSameSelector(ir, "open", "cy.get('c8y-events-list')")).toBe(false);
  });

  it("does not fire when the step is still provisional, which is a probe waiting to happen", () => {
    const pending = irOf([
      { id: "open", settle: { target: { provisional: { tag: "li" } }, state: "visible" } },
    ]);

    expect(resolvesToSameSelector(pending, "open", "cy.get('li')")).toBe(false);
  });

  it("does not fire when nothing failed, or the failure mapped to no step", () => {
    expect(resolvesToSameSelector(ir, "open", null)).toBe(false);
    expect(resolvesToSameSelector(ir, null, SELECTOR)).toBe(false);
  });

  it("does not fire when the step the failure named is gone", () => {
    // A patch may delete the step a previous failure named. That is not a repeat.
    expect(resolvesToSameSelector(ir, "some-other-step", SELECTOR)).toBe(false);
  });

  it("follows the step an insertion moved, because both rungs invite an insertion", () => {
    // Rung 1 offers "insert a step, including a settle before the failing one"; rung 2 asks for
    // collect points. Either re-numbers every path after it, so a positional lookup would read
    // a different step and the rule would fire, or not fire, on the wrong one.
    const shifted = irOf([settleOn("a-new-settle", "cy.get('nav')"), settleOn("open", SELECTOR)]);

    expect(resolvesToSameSelector(shifted, "open", SELECTOR)).toBe(true);
  });

  it("looks in setup as well, where a failing auth or navigation move lives", () => {
    const withSetup = irOf([settleOn("open", "cy.get('main')")], [settleOn("land", SELECTOR)]);

    expect(resolvesToSameSelector(withSetup, "land", SELECTOR)).toBe(true);
  });
});

describe("recording what a failure was pointed at", () => {
  it("takes the resolved selector of the step that failed", () => {
    expect(selectorAt(irOf([settleOn("open", SELECTOR)]), "open")).toBe(SELECTOR);
  });

  it("has nothing to record for a step that carries no target at all", () => {
    // `callRepoHelper` and `request` steps fail too, and they point at no element.
    const ir = irOf([{ id: "make-device", callRepoHelper: { name: "createDevice", args: [] } }]);

    expect(selectorAt(ir, "make-device")).toBeNull();
  });

  it("has nothing to record when the failure mapped to no step", () => {
    expect(selectorAt(irOf([settleOn("open", SELECTOR)]), null)).toBeNull();
  });
});
