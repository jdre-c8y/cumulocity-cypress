import { chooseFillCall, isRefusal, type FillCall, type FillRefusal } from "./fillCall.js";
import { compile } from "./compile.js";
import { CompileError } from "./emit.js";
import { b0Conventions, b0Ir } from "../testing/b0.js";
import {
  FORM_ROWS,
  FORM_SELECT_VALUE,
  factsWithForm,
  formRow,
  formSelector,
} from "../testing/forms.js";
import type { IrDocument, IrStep, IrValue } from "../ir/types.js";

const choose = (row: string, value: IrValue): FillCall | FillRefusal =>
  chooseFillCall(formRow(row), value);

const refusal = (row: string, value: IrValue): string => {
  const chosen = choose(row, value);
  if (!isRefusal(chosen)) throw new Error(`expected a refusal, got ${JSON.stringify(chosen)}`);
  return chosen.refuse;
};

describe("which Cypress call a fill becomes", () => {
  it("reads a select off the tag", () => {
    expect(choose(FORM_ROWS.renderType, FORM_SELECT_VALUE)).toEqual({ call: "select" });
  });

  it("reads a checkbox off the type, both ways round", () => {
    expect(choose(FORM_ROWS.showLabel, true)).toEqual({ call: "check", checked: true });
    expect(choose(FORM_ROWS.showLabel, false)).toEqual({ call: "check", checked: false });
  });

  it("types into a text input and a textarea", () => {
    expect(choose(FORM_ROWS.title, "Asset Properties")).toEqual({ call: "type" });
    expect(choose(FORM_ROWS.notes, { ref: "deviceName" })).toEqual({ call: "type" });
  });

  // The whole one-verb argument rests on the row being enough to choose. Where it is not, the
  // answer is a refusal naming the row - never a default that silently types into a <select>.
  it("refuses a control the facts cannot classify", () => {
    // A div wearing a select's clothes: ticket 18's own falsification case.
    expect(refusal(FORM_ROWS.fakeSelect, "Linear")).toMatch(/<div>, which holds no value/);
    expect(refusal(FORM_ROWS.fakeSelect, "Linear")).toMatch(/click the element that opens it/);
  });

  it("refuses a file input, and says the gap is a decision rather than a bug", () => {
    expect(refusal(FORM_ROWS.upload, "report.csv")).toMatch(/selectFile\(\), which this tool does not/);
    expect(refusal(FORM_ROWS.upload, "report.csv")).toMatch(/ticket 18/i);
  });

  // .check() and .uncheck() carry no value, so a reference would pick one of them regardless of
  // what it holds - the emitted spec would then say something the IR does not.
  it("refuses anything but a literal boolean on a checkbox", () => {
    expect(refusal(FORM_ROWS.showLabel, { ref: "wanted" })).toMatch(/literal true or false/);
    expect(refusal(FORM_ROWS.showLabel, "true")).toMatch(/literal true or false/);
  });

  it("refuses unchecking a radio, which Cypress refuses too", () => {
    expect(refusal(FORM_ROWS.kind, false)).toMatch(/a radio is never unchecked on its own/);
    expect(choose(FORM_ROWS.kind, true)).toEqual({ call: "check", checked: true });
  });

  it("refuses a boolean where text is wanted, and says what true and false are for", () => {
    expect(refusal(FORM_ROWS.title, true)).toMatch(/for a checkbox or a radio/);
    expect(refusal(FORM_ROWS.renderType, false)).toMatch(/for a checkbox or a radio/);
  });

  it("refuses a value no field can hold", () => {
    expect(refusal(FORM_ROWS.title, null)).toMatch(/not something a field can hold/);
    expect(refusal(FORM_ROWS.title, { list: ["a", "b"] })).toMatch(/not something a field can hold/);
    expect(refusal(FORM_ROWS.title, { object: { a: 1 } })).toMatch(/not something a field can hold/);
  });

  // cy.type('') throws. A fill already clears, so the empty string asks for nothing at all.
  it("refuses an empty value rather than emitting .type('')", () => {
    expect(refusal(FORM_ROWS.title, "")).toMatch(/already clears the field/);
    expect(refusal(FORM_ROWS.renderType, "")).toMatch(/Name the option to choose/);
  });
});

function irWithFill(step: Partial<IrStep["fill"]> & { target: unknown; value: IrValue }): IrDocument {
  const ir = b0Ir();
  ir.steps.splice(6, 0, { id: "fill-it", fill: step } as IrStep);
  return ir;
}

const emitted = (row: string, value: IrValue, mode: "spec" | "probe" = "spec"): string =>
  compile({
    ir: irWithFill({ target: { resolved: formSelector(row), fromRow: row }, value }),
    mode,
    conventions: b0Conventions(),
    facts: factsWithForm(),
  }).text;

describe("what a fill emits", () => {
  it("selects, and lets Cypress fire the change event itself", () => {
    expect(emitted(FORM_ROWS.renderType, FORM_SELECT_VALUE)).toContain(
      `cy.get('[data-cy="config--render-type"]').select('c8y_LocationUpdate');`
    );
  });

  // 673 clears against 1058 types in the corpus: a human clears two thirds of the time and
  // knows the field is empty the rest. A generated spec knows neither, so it always clears.
  it("always clears before it types", () => {
    expect(emitted(FORM_ROWS.title, { ref: "deviceName" })).toContain(
      `cy.get('[data-cy="config--title"]').clear().type(deviceName);`
    );
  });

  it("checks and unchecks, with no value in the call", () => {
    expect(emitted(FORM_ROWS.showLabel, true)).toContain(
      `cy.get('[data-cy="config--show-label"]').check();`
    );
    expect(emitted(FORM_ROWS.showLabel, false)).toContain(
      `cy.get('[data-cy="config--show-label"]').uncheck();`
    );
  });

  // A probe that skipped its fills would walk a different flow from the spec and then collect
  // the surfaces of a form nobody filled in. Dropping a stub is right; dropping a fill is not.
  it("emits identically in probe mode, because a probe fills the form for real", () => {
    expect(emitted(FORM_ROWS.title, { ref: "deviceName" }, "probe")).toContain(
      `cy.get('[data-cy="config--title"]').clear().type(deviceName);`
    );
  });

  it("throws rather than guessing when the row is not in the facts", () => {
    expect(() =>
      compile({
        ir: irWithFill({
          target: { resolved: "cy.get('[data-cy=\"nope\"]')", fromRow: "widget-config#99" },
          value: "x",
        }),
        mode: "spec",
        conventions: b0Conventions(),
        facts: factsWithForm(),
      })
    ).toThrow(CompileError);
  });

  // The linter refuses this first, in both modes. The compiler guard is the second wall: without
  // it, probe mode's target expression resolves at run time and leaves nothing to read the call
  // off - so the back-end would fail open exactly where it used to emit null.click().
  it("throws on a provisional target instead of failing open in probe mode", () => {
    expect(() =>
      compile({
        ir: irWithFill({ target: { provisional: { tag: "input" } }, value: "x" }),
        mode: "probe",
        conventions: b0Conventions(),
        facts: factsWithForm(),
      })
    ).toThrow(/a fill needs a resolved target/);
  });
});
