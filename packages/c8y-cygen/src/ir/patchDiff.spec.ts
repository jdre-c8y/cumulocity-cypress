import { checkPatch, diffIr } from "./patchDiff.js";
import { b0Ir } from "../testing/b0.js";
import type { IrDocument, IrStep } from "./types.js";

function patched(mutate: (ir: IrDocument) => void): IrDocument {
  const ir = b0Ir();
  mutate(ir);
  return ir;
}

describe("the frozen/free split", () => {
  it("computes the changed field paths from the diff rather than taking them on trust", () => {
    const after = patched((ir) => {
      (ir.steps[4] as IrStep).settle!.timeoutMs = 20_000;
    });

    expect(diffIr(b0Ir(), after).map((c) => c.path)).toEqual([
      "steps.tabs-visible.settle.timeoutMs",
    ]);
  });

  it("accepts a timeout, a scope or a re-pointed row - the mechanics zone", () => {
    const after = patched((ir) => {
      (ir.steps[4] as IrStep).settle!.timeoutMs = 20_000;
      (ir.steps[6] as IrStep).assert!.target = {
        resolved: "cy.get('c8y-event-details').find('[data-cy=\"x\"]')",
        fromRow: "event-detail#1",
      };
    });

    expect(checkPatch(b0Ir(), after).accepted).toBe(true);
  });

  it("accepts an added step, because an addition cannot weaken an assertion", () => {
    const after = patched((ir) => {
      ir.steps.splice(4, 0, {
        id: "settle-detail",
        settle: {
          target: { resolved: "cy.get('c8y-event-details')", fromRow: "event-detail#0" },
          state: "visible",
        },
      });
    });

    expect(checkPatch(b0Ir(), after).accepted).toBe(true);
  });

  it("rejects weakening a declared cardinality, which is the whole reason the rule exists", () => {
    // The cheapest fix to "declared 3, observed 1" is to declare 1. It lints clean and passes.
    const after = patched((ir) => {
      (ir.steps[10] as IrStep).settle!.cardinality = { atLeast: 0 as unknown as number };
    });

    const verdict = checkPatch(b0Ir(), after);

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toMatch(/frozen field/);
  });

  it("rejects a changed comparator", () => {
    const after = patched((ir) => {
      (ir.steps[7] as IrStep).assert!.compare = "includes";
    });

    expect(checkPatch(b0Ir(), after).accepted).toBe(false);
  });

  it("rejects a changed operand", () => {
    const after = patched((ir) => {
      (ir.steps[11] as IrStep).assert!.operand = "52";
    });

    expect(checkPatch(b0Ir(), after).accepted).toBe(false);
  });

  it("rejects a deleted step", () => {
    const after = patched((ir) => {
      ir.steps.splice(11, 1);
      ir.outcomes[6]!.satisfiedBy = ["check-longitude"];
    });

    expect(checkPatch(b0Ir(), after).accepted).toBe(false);
  });

  it("rejects a changed verb on an existing step", () => {
    const after = patched((ir) => {
      const step = ir.steps[6] as IrStep;
      delete step.assert;
      step.settle = {
        target: {
          resolved: "cy.get('[data-cy=\"c8y-event-details--source-wrapper\"]')",
          fromRow: "event-detail#0",
        },
        state: "visible",
      };
    });

    expect(checkPatch(b0Ir(), after).accepted).toBe(false);
  });

  it("rejects a changed outcome, text and satisfiedBy alike", () => {
    const after = patched((ir) => {
      ir.outcomes[3]!.satisfiedBy = ["tabs-visible"];
    });

    expect(checkPatch(b0Ir(), after).accepted).toBe(false);
  });

  it("freezes a var a frozen field reaches, or the operand escapes through vars", () => {
    const after = patched((ir) => {
      ir.vars = { deviceName: "e2eDeviceToTestEvents" };
    });

    expect(checkPatch(b0Ir(), after).accepted).toBe(false);
  });

  it("rejects restoring a value an earlier iteration already tried and failed with", () => {
    // Without the attempt log, fresh sessions oscillate - flip a selector, fail, flip it back,
    // fail - and the budget burns on a two-state loop no single session can see.
    const after = patched((ir) => {
      (ir.steps[4] as IrStep).settle!.timeoutMs = 20_000;
    });

    const verdict = checkPatch(b0Ir(), after, [
      {
        passed: false,
        changed: [
          { path: "steps.tabs-visible.settle.timeoutMs", before: undefined, after: 20_000 },
        ],
      },
    ]);

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toMatch(/already tried and failed/);
  });
});
