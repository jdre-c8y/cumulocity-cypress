/**
 * B1 end to end at seam 1: a complete mid-tier IR, linted and compiled.
 *
 * The unit tests prove each rule in isolation. This proves they compose - that an IR shaped like
 * the oracle it is graded against passes every rule at once and emits a spec that reads like the
 * repo's own. It is the test that would have caught any of the six stages disagreeing.
 */
import { compile } from "../compiler/compile.js";
import { lintIr, formatLintResult } from "../ir/lintIr.js";
import { buildSourceMap } from "../compiler/sourceMap.js";
import { checkOutcomeCoverage } from "../scorer/scorer.js";
import {
  B1_DASHBOARD_FILTER,
  b1Contract,
  b1Conventions,
  b1Facts,
  b1Ir,
  b1ProbeIr,
} from "./b1.js";

const input = () => ({
  ir: b1Ir(),
  mode: "spec" as const,
  conventions: b1Conventions(),
  contract: b1Contract(),
  facts: b1Facts(),
});

const emitted = (): string =>
  compile({
    ir: b1Ir(),
    mode: "spec",
    conventions: b1Conventions(),
    facts: b1Facts(),
  }).text;

describe("B1, the intercept tier, end to end", () => {
  it("lints clean", () => {
    const result = lintIr(input());

    expect(formatLintResult(result)).not.toMatch(/^ERROR/m);
    expect(result.ok).toBe(true);
  });

  it("covers all four Expected Outcomes", () => {
    expect(lintIr(input()).coveredOutcomes).toEqual([1, 2, 3, 4]);
  });

  it("emits the $filter the probe observed, to the character", () => {
    // The single fact that makes B1 the intercept tier. A near miss here does not fail loudly;
    // the route never fires and the page loads empty against the real tenant.
    expect(emitted()).toContain(B1_DASHBOARD_FILTER);
  });

  it("emits four intercepts, each serving an observed body", () => {
    const text = emitted();

    expect(text.match(/cy\.intercept\(/g) ?? []).toHaveLength(4);
    expect(text).toContain("cy.intercept('GET', '/inventory/managedObjects/2000*',");
    expect(text).toContain("pathname: '/inventory/managedObjects'");
  });

  it("serves the device name the contract asked for, not the one the tenant returned", () => {
    const text = emitted();

    expect(text).toContain("name: deviceName");
    // The rest of each observed body survives untouched - that is what "derived" means.
    expect(text).toContain("componentId: 'Asset Properties'");
    expect(text).toContain("c8y_IsDeviceGroup: {}");
  });

  it("asserts the device and denies the group on one subject", () => {
    const text = emitted();

    expect(text).toContain("cy.contains('span', 'e2eDevice').should('contain.text', deviceName);");
    expect(text).toContain("cy.contains('span', 'e2eDevice').should('not.contain.text', groupName);");
  });

  it("resolves the chip by its own text, which makes BOTH halves of outcome 2 circular", () => {
    // A finding about B1, recorded rather than smoothed over - and corrected. The chip carries
    // no data-cy, so the ladder identifies it by the very text outcome 2 asserts.
    //
    // The positive half cannot fail on the text: `cy.contains('span','e2eDevice')` either
    // resolves or the step fails on absence. The denial half is circular for the same reason,
    // which an earlier version of this comment got wrong by calling it "a real check" - its
    // subject is *the span containing the device name*, so it can only fail if that same span
    // also contains the group name. If the selector regressed and showed the group instead, the
    // step would fail on absence, not on the denial.
    //
    // So outcome 2 asserts nothing about the asset-selector container the contract names. The
    // name field after each save (outcomes 3 and 4) is the load-bearing check in this spec.
    // The hand-written oracle avoids the circularity by reaching the chip through a data-cy
    // ancestor - `[data-cy="Asset selection"]).parent().find('.chip, .tag')` - a path shape the
    // ladder does not build. That is the axis C and D observation a grader needs.
    expect(emitted()).toContain(
      "cy.contains('span', 'e2eDevice').should('contain.text', deviceName);"
    );
    expect(emitted()).toContain(
      "cy.contains('span', 'e2eDevice').should('not.contain.text', groupName);"
    );
  });

  it("stubs every id the stubbed dashboard points at", () => {
    // The consistency nothing else checks. Each literal in a mutation is anchored to the
    // contract one at a time, but no rule asks whether the widget's configured device is a
    // device this spec actually serves - and an unstubbed id falls through to the real tenant
    // and 404s, far from the stub that caused it.
    const text = emitted();
    const configured = /config: \{ device: \{ name: \w+, id: (\w+) \} \}/.exec(text);

    expect(configured?.[1]).toBe("deviceId");
    expect(text).toContain("cy.intercept('GET', '/inventory/managedObjects/2000*'");
  });

  it("reads the name field by value after each save, which is the actual subject", () => {
    expect(emitted().match(/should\('have\.value', deviceName\)/g) ?? []).toHaveLength(2);
  });

  it("registers every intercept before the visit", () => {
    const text = emitted();

    expect(text.lastIndexOf("cy.intercept(")).toBeLessThan(
      text.indexOf("cy.visitAndWaitUntilPageLoad(")
    );
  });

  it("emits TypeScript the compiler accepts", () => {
    const ts = require("typescript") as typeof import("typescript");
    const result = ts.transpileModule(emitted(), {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    });

    expect(result.diagnostics ?? []).toEqual([]);
  });

  it("anchors every step against the FORMATTED file, where four intercepts share one anchor", () => {
    // The map anchors on the first twelve stripped characters of a statement, and every one of
    // these four starts `cy.intercept(`. The sequential cursor is what keeps them apart, and
    // prettier moves each statement's opening brace onto its own line - so this has to be
    // checked against the formatted text, not the emitted text. A map that loses a step here
    // loses the heal path's ability to name the step a Cypress failure came from.
    const compiled = compile({
      ir: b1Ir(),
      mode: "spec",
      conventions: b1Conventions(),
      facts: b1Facts(),
    });
    // The reflow prettier really performs on these lines, applied directly rather than by
    // depending on prettier here - the package runs the target repo's formatter as a
    // subprocess and does not import one. Doing it by hand also pins the adversarial shape
    // exactly: four statements whose first line is now the identical string `cy.intercept(`.
    const formatted = compiled.text.replace(/cy\.intercept\(/g, "cy.intercept(\n  ");
    const map = buildSourceMap("x.cy.ts", formatted, compiled.statements);

    expect(map.unanchored).toEqual([]);
    const intercepts = map.entries.filter((e) => e.stepId.startsWith("serve-"));
    expect(intercepts).toHaveLength(4);
    // Four distinct, ascending, non-overlapping ranges - not four entries on one line.
    expect(new Set(intercepts.map((e) => e.fromLine)).size).toBe(4);
  });

  it("anchors every step in the source map", () => {
    const compiled = compile({
      ir: b1Ir(),
      mode: "spec",
      conventions: b1Conventions(),
      facts: b1Facts(),
    });
    const map = buildSourceMap("x.cy.ts", compiled.text, compiled.statements);

    expect(map.unanchored).toEqual([]);
  });

  it("passes axis B against the emitted spec, independently of Cypress", () => {
    const compiled = compile({
      ir: b1Ir(),
      mode: "spec",
      conventions: b1Conventions(),
      facts: b1Facts(),
    });
    const coverage = checkOutcomeCoverage(
      b1Contract(),
      compiled.text,
      buildSourceMap("x.cy.ts", compiled.text, compiled.statements)
    );

    expect(coverage.map((o) => o.covered)).toEqual([true, true, true, true]);
  });

  it("reports every outcome that asserts a value a stub wrote, and refuses none", () => {
    // The honest number for B1, and the reason it is a report rather than a ban. All four
    // outcomes assert the device or group name, and all four names are written into the
    // fabricated bodies - because that is what "a widget keeps its configured device" means.
    // Refusing these would make the benchmark's own mid tier unbuildable.
    const result = lintIr(input());

    expect(result.errors).toEqual([]);
    expect(result.stubSatisfied.map((s) => s.outcome).sort()).toEqual([1, 2, 2, 3, 4]);
  });
});

describe("B1's first turn, before any probe has run", () => {
  const probeInput = () => ({
    ir: b1ProbeIr(),
    mode: "probe" as const,
    conventions: b1Conventions(),
    contract: b1Contract(),
  });

  it("lints clean with no facts at all, and names what is still missing", () => {
    const result = lintIr(probeInput());

    expect(result.errors).toEqual([]);
    expect(result.gaps.find((g) => g.need === "selector")?.at).toBe("edit-widgets");
    expect(result.gaps.filter((g) => g.need === "assertion")).toHaveLength(4);
  });

  it("compiles to a probe that stubs nothing", () => {
    const text = compile({
      ir: b1ProbeIr(),
      mode: "probe",
      conventions: b1Conventions(),
    }).text;

    expect(text).not.toContain("cy.intercept(");
    expect(text).toContain("cy.c8yCygenCollect({ label: 'dashboard'");
  });
});
