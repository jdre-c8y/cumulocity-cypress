/**
 * The rules that keep a `fill` from reaching Cypress.
 *
 * Every one of them is a compiler throw moved forward. A throw during a spec compile ends the
 * run; a lint error costs a turn and says what to fix, and the run is the metered half.
 */
import { lintIr, type LintInput } from "./lintIr.js";
import { checkPatch } from "./patchDiff.js";
import { b0Contract, b0Conventions, b0Ir } from "../testing/b0.js";
import { FORM_ROWS, FORM_SELECT_VALUE, factsWithForm, formSelector } from "../testing/forms.js";
import type { IrDocument, IrStep, IrTarget, IrValue } from "./types.js";

function fillStep(row: string, value: IrValue): IrStep {
  return {
    id: "fill-it",
    fill: { target: { resolved: formSelector(row), fromRow: row }, value },
  };
}

function inputWith(step: IrStep, mode: "spec" | "probe" = "spec"): LintInput {
  const ir = b0Ir();
  // Between the click that opens the detail and the assertions on it, so the intercept and
  // settle rules see a fill in a realistic position.
  ir.steps.splice(6, 0, step);
  return {
    ir,
    mode,
    conventions: b0Conventions(),
    contract: b0Contract(),
    facts: factsWithForm(),
  };
}

const messages = (input: LintInput): string =>
  lintIr(input)
    .errors.map((e) => `${e.where}: ${e.message}`)
    .join("\n");

describe("linting a fill", () => {
  it("accepts a resolved fill on an observed control", () => {
    // The operand is a var, and `c8y_LocationUpdate` is in B0's contract, so both anchor.
    expect(lintIr(inputWith(fillStep(FORM_ROWS.renderType, FORM_SELECT_VALUE))).errors).toEqual([]);
    expect(lintIr(inputWith(fillStep(FORM_ROWS.title, { ref: "deviceName" }))).errors).toEqual([]);
    expect(lintIr(inputWith(fillStep(FORM_ROWS.showLabel, true))).errors).toEqual([]);
  });

  // The one place a fill and a click part company. A click on the wrong element usually errors;
  // a fill on the wrong input succeeds quietly, and every surface after it is a state nobody
  // asked for. Refused in BOTH modes - a probe cannot guess its way into a form either.
  it("refuses a provisional target in both modes", () => {
    const step: IrStep = {
      id: "fill-it",
      fill: { target: { provisional: { tag: "input" } } as IrTarget, value: "x" },
    };

    expect(messages(inputWith(step))).toMatch(/a fill cannot use a provisional target/);
    expect(messages(inputWith(step, "probe"))).toMatch(/a fill cannot use a provisional target/);
    // And it says what to do instead, which is the half that saves the next turn.
    expect(messages(inputWith(step))).toMatch(/Put a 'collect' on the form/);
  });

  it("names selector-absent, so the assist accounting has it in the right column", () => {
    const step: IrStep = {
      id: "fill-it",
      fill: { target: { provisional: { tag: "input" } } as IrTarget, value: "x" },
    };

    expect(lintIr(inputWith(step)).errors.map((e) => e.trip)).toContain("selector-absent");
  });

  it("refuses a fill on a row the probe observed hidden", () => {
    const input = inputWith(fillStep(FORM_ROWS.hiddenName, { ref: "deviceName" }));

    expect(messages(input)).toMatch(/observed hidden on surface 'widget-config'/);
    expect(messages(input)).toMatch(/a fill waits for an element to be visible/);
  });

  // Surfaced here rather than left to the compiler, and in both modes: a fill the compiler
  // cannot emit ends a probe run part-way and loses every surface after it.
  it("surfaces the dispatch table's refusals as lint errors, in both modes", () => {
    expect(messages(inputWith(fillStep(FORM_ROWS.fakeSelect, "Linear")))).toMatch(
      /<div>, which holds no value/
    );
    expect(messages(inputWith(fillStep(FORM_ROWS.showLabel, "true")))).toMatch(
      /literal true or false/
    );
    expect(messages(inputWith(fillStep(FORM_ROWS.fakeSelect, "Linear"), "probe"))).toMatch(
      /<div>, which holds no value/
    );
  });

  // Ticket 02's anchoring rule, one verb over. What a test enters into a form is part of the
  // scenario; a value nobody wrote down is a value nobody can grade.
  it("refuses a typed literal that appears nowhere in the contract", () => {
    expect(messages(inputWith(fillStep(FORM_ROWS.title, "whatever I feel like")))).toMatch(
      /appears nowhere in the scenario contract/
    );
  });

  it("still checks a fill's value for an unbound reference", () => {
    expect(messages(inputWith(fillStep(FORM_ROWS.title, { ref: "nothingBindsThis" })))).toMatch(
      /unbound runtime reference 'nothingBindsThis'/
    );
  });

  it("counts a fill as a DOM step, because it reaches the rendered page", () => {
    const input = inputWith(fillStep(FORM_ROWS.title, { ref: "deviceName" }));
    input.ir.steps = input.ir.steps.filter((s) => s.fill || s.callRepoHelper);
    input.ir.outcomes = [{ id: 1, text: "x", satisfiedBy: ["fill-it"] }];

    expect(messages(input)).not.toMatch(/zero DOM steps/);
  });

  // `.type()` and `.select()` require actionability exactly as `.click()` does.
  it("calls a settle in front of a fill on the same target redundant", () => {
    const input = inputWith(fillStep(FORM_ROWS.title, { ref: "deviceName" }));
    const at = input.ir.steps.findIndex((s) => s.id === "fill-it");
    input.ir.steps.splice(at, 0, {
      id: "settle-first",
      settle: {
        target: { resolved: formSelector(FORM_ROWS.title), fromRow: FORM_ROWS.title },
        state: "visible",
      },
    });

    expect(messages(input)).toMatch(/a fill retries until the element is actionable/);
  });

  // Typing into a search box fires a query; choosing from a select fires a change that saves.
  // A rule that ignored that would tell the model to move working code.
  it("lets a fill be the interaction an intercept is registered for", () => {
    const input = inputWith(fillStep(FORM_ROWS.title, { ref: "deviceName" }));
    const at = input.ir.steps.findIndex((s) => s.id === "fill-it");
    input.ir.steps.splice(at, 0, {
      id: "watch-save",
      sync: { route: { method: "PUT", url: "/inventory/managedObjects/*" }, alias: "save" },
    });

    expect(messages(input)).not.toMatch(/can never fire/);
    expect(messages(input)).not.toMatch(/whose traffic has already gone/);
  });
});

describe("healing a fill", () => {
  const withFill = (value: IrValue): IrDocument => {
    const ir = b0Ir();
    ir.steps.splice(6, 0, fillStep(FORM_ROWS.title, value));
    return ir;
  };

  // Re-pointing a fill at a different control is a targeting fix. Changing what it types is
  // changing the scenario, and it is the heal turn's cheapest route to green.
  it("freezes what a fill types, and leaves where it types it free", () => {
    const before = withFill({ ref: "deviceName" });

    const retyped = withFill("c8y_LocationUpdate");
    expect(checkPatch(before, retyped).accepted).toBe(false);
    expect(checkPatch(before, retyped).reason).toMatch(/fill\.value is a frozen field/);

    const repointed = withFill({ ref: "deviceName" });
    const step = repointed.steps.find((s) => s.id === "fill-it") as IrStep;
    step.fill = {
      target: { resolved: formSelector(FORM_ROWS.notes), fromRow: FORM_ROWS.notes },
      value: { ref: "deviceName" },
    };
    expect(checkPatch(before, repointed).accepted).toBe(true);
  });

  it("freezes the var a fill reaches through, so the value cannot escape that way", () => {
    const before = withFill({ ref: "deviceName" });
    const after = withFill({ ref: "deviceName" });
    (after.vars as Record<string, IrValue>).deviceName = "something else";

    expect(checkPatch(before, after).accepted).toBe(false);
  });
});
