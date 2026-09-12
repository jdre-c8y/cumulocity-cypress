import ts from "typescript";
import { compile, type CompileInput } from "./compile.js";
import { CompileError } from "./emit.js";
import { buildSourceMap, hashContent, stepAtLine } from "./sourceMap.js";
import { b0Conventions, b0Ir, b0ProbeIr } from "../testing/b0.js";
import type { IrDocument, IrStep } from "../ir/types.js";

function specInput(mutate: (ir: IrDocument) => void = () => {}): CompileInput {
  const ir = b0Ir();
  mutate(ir);
  return { ir, mode: "spec", conventions: b0Conventions() };
}

function specOf(mutate: (ir: IrDocument) => void = () => {}): string {
  return compile(specInput(mutate)).text;
}

describe("the spec back-end", () => {
  it("emits the oracle's shape", () => {
    expect(specOf()).toMatchSnapshot();
  });

  it("declares a value builder as a template literal, not a quoted string", () => {
    // The compiler that got this wrong emitted '...${Cypress._.now()}...' in single quotes, so
    // the spec navigated to a URL containing a literal dollar-brace, with no error anywhere.
    expect(specOf()).toContain(
      "const deviceName = `e2eDeviceToTestEvents${Cypress._.now()}`;"
    );
  });

  it("passes a sole runtime reference as the identifier, not as a template literal", () => {
    expect(specOf()).toContain("cy.getDeviceIdByName(deviceName)");
    expect(specOf()).not.toContain("cy.getDeviceIdByName(`${deviceName}`)");
  });

  it("interpolates a path that mixes literal text with a capture", () => {
    expect(specOf()).toContain(
      "cy.visitAndWaitUntilPageLoad(`/apps/devicemanagement/index.html#/device/${deviceId}/events`, false)"
    );
  });

  it("puts the .then() blocks in, so the model never has to reason about async scope", () => {
    const text = specOf();

    expect(text).toContain("cy.getDeviceIdByName(deviceName).then((deviceId: any) => {");
    // Everything after the capture is nested inside it, and the block is closed.
    // Named precisely: the teardown's own cy.request sits in the afterEach, above the it().
    expect(text.indexOf("cy.request('/event/events'")).toBeGreaterThan(
      text.indexOf(".then((deviceId")
    );
    expect(text).toContain("});");
  });

  it("emits a declared 'at least n' cardinality as a run-time length assertion", () => {
    // This is what turns the Grid-versus-List hazard into "expected 3, found 1" instead of a
    // message pointing nowhere near its cause.
    expect(specOf()).toContain(
      "cy.get('[data-cy=\"event-details-custom-data-item\"]').should('have.length.at.least', 1);"
    );
  });

  it("does not write have.length 1 on every ordinary step", () => {
    expect(specOf()).not.toContain("'have.length', 1");
  });

  it("emits each comparator from the closed list", () => {
    const text = specOf();

    expect(text).toContain(".should('contain.text', deviceName);");
    expect(text).toContain(".should('contain.text', 'c8y_LocationUpdate');");
    expect(text).toContain(
      "expect(dayjs(text).diff(dayjs().utc(), 'minutes')).to.be.within(-3, 3);"
    );
  });

  it("brings in whatever a comparator needs, as a repo fact rather than a compiler constant", () => {
    const text = specOf();

    expect(text).toContain("import * as dayjs from 'dayjs';");
    expect(text).toContain("dayjs.extend(utc);");
  });

  it("brings the preamble in for a value builder too, not only for a comparator", () => {
    // isoTime emits dayjs().format(...). Asking the IR which comparators it uses would miss
    // that, so the question is asked of the emitted text.
    const text = specOf((ir) => {
      ir.steps = ir.steps.filter((s) => s.assert?.compare !== "withinMinutesOfNow");
      ir.outcomes = ir.outcomes.filter((o) => o.id !== 3 && o.id !== 5);
    });

    expect(text).toContain("dayjs().format('YYYY-MM-DDTHH:mm:ssZ')");
    expect(text).toContain("import * as dayjs from 'dayjs';");
  });

  it("leaves the time preamble out when nothing emitted needs it", () => {
    const text = specOf((ir) => {
      ir.steps = ir.steps.filter((s) => s.assert?.compare !== "withinMinutesOfNow");
      ir.outcomes = ir.outcomes.filter((o) => o.id !== 3 && o.id !== 5);
      (ir.steps[2] as IrStep).request!.body = {
        object: { source: { object: { id: { ref: "deviceId" } } }, type: "c8y_LocationUpdate" },
      };
    });

    expect(text).not.toContain("dayjs");
  });

  it("imports nothing for a globally registered command", () => {
    // createDevice and getDeviceIdByName are Cypress.Commands.add, not module exports.
    expect(specOf()).not.toContain("import { createDevice }");
  });

  it("does not emit the repo's auth idiom twice when the IR authors it too", () => {
    const text = specOf((ir) => {
      ir.setup = [{ id: "login", callRepoHelper: { name: "login" } }];
    });

    expect(text.split("cy.login(Cypress.env('username')").length - 1).toBe(1);
  });

  it("takes the describe tags from the directory, not from the model", () => {
    // The scout mined dataAndControlTeam's tags off 42 spec files. Nothing derives them from a
    // scenario about events, and nothing should: the author chose the directory, and that chose
    // these. The IR has no field for them any more.
    expect(compile(specInput()).text).toContain(
      "describe('Tests for device events', { tags: ['@deviceManagementTeam', '@dataAndControlTeam'] }, () => {"
    );
  });

  it("writes a single tag as a bare string, which is how this repo writes 229 of 233", () => {
    // The oracle itself writes { tags: '@requiresBackend' }. Emitting the one-element array
    // form is the 4-in-233 shape - the same class of house-style defect this change set exists
    // to remove.
    const text = compile({ ...specInput(), itTags: ["@requiresBackend"] }).text;

    expect(text).toContain(
      "it('Verify the event for a device shows respective event details', { tags: '@requiresBackend' }, () => {"
    );
  });

  it("writes several tags as a list", () => {
    const text = compile({ ...specInput(), itTags: ["@requiresBackend", "@slow"] }).text;

    expect(text).toContain("{ tags: ['@requiresBackend', '@slow'] }");
  });

  it("writes a bare it when the contract declared no tags, rather than guessing one", () => {
    expect(compile(specInput()).text).toContain(
      "it('Verify the event for a device shows respective event details', () => {"
    );
  });

  it("emits the repo's beforeEach idiom", () => {
    expect(compile(specInput()).text).toContain(
      "cy.login(Cypress.env('username'), Cypress.env('password'));"
    );
  });

  it("resets the state the spec created, per it(), and nothing else", () => {
    // Ticket 02 Q7(c). cumulocity-ui has no cy.deleteDevice, so the conventions file names the
    // house snippet - a cascade delete of the managed object - on the blessed move itself.
    const text = specOf();

    expect(text).toContain("let createdDeviceId: string | undefined;");
    expect(text).toContain("afterEach(() => {");
    expect(text).toContain("if (createdDeviceId) {");
    expect(text).toContain("managedObjects/${createdDeviceId}?cascade=true");
    expect(text).toContain("method: 'DELETE'");
  });

  it("binds the id for teardown where the capture binds, not before it exists", () => {
    const text = specOf();
    const then = text.indexOf("cy.getDeviceIdByName(deviceName).then((deviceId: any) => {");
    const assign = text.indexOf("createdDeviceId = deviceId;");

    expect(then).toBeGreaterThan(-1);
    expect(assign).toBeGreaterThan(then);
  });

  it("clears the id after deleting, so a second it() cannot delete the first one's device", () => {
    expect(specOf()).toContain("createdDeviceId = undefined;");
  });

  it("emits no teardown when nothing in the flow created real state", () => {
    const text = compile({
      ...specInput((ir) => {
        ir.steps = ir.steps.filter((s) => s.callRepoHelper?.name !== "createDevice");
        delete ir.steps[0]?.undo;
      }),
    }).text;

    expect(text).not.toContain("afterEach(");
  });

  it("emits teardown in probe mode too: the spec is thrown away, the device is not", () => {
    const text = compile({ ir: b0ProbeIr(), mode: "probe", conventions: b0Conventions() }).text;

    // A probe is the mode that fails on purpose, and Cypress runs afterEach after a failing
    // test. Three probe runs of B0 stranded three real devices on a real tenant before this.
    expect(text).toContain("afterEach(");
    expect(text).toContain("?cascade=true");
  });

  it("refuses a provisional selector rather than emitting null.click()", () => {
    expect(() =>
      compile({ ir: b0ProbeIr(), mode: "spec", conventions: b0Conventions() })
    ).toThrow(CompileError);
  });

  it("refuses a collect step rather than emitting a comment and shipping", () => {
    expect(() =>
      specOf((ir) => {
        ir.steps.push({ id: "x", collect: { label: "l", within: "body" } });
      })
    ).toThrow(/probe-only/);
  });

  it("emits a valid string when the content holds the preferred quote", () => {
    const text = specOf((ir) => {
      (ir.steps[8] as IrStep).assert!.operand = "it's a type";
    });

    expect(text).toContain(`.should('contain.text', "it's a type");`);
  });

  it("emits a request with no body without leaving a dangling argument", () => {
    const text = specOf((ir) => {
      delete (ir.steps[2] as IrStep).request!.body;
      (ir.steps[2] as IrStep).request!.method = "GET";
    });

    expect(text).toContain("cy.request('/event/events', 'GET');");
  });

  it("compiles one IR step to exactly one statement", () => {
    const result = compile({ ir: b0Ir(), mode: "spec", conventions: b0Conventions() });
    const ids = result.statements.map((s) => s.stepId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("post-event");
  });
});

describe("the probe back-end", () => {
  const probe = () =>
    compile({ ir: b0ProbeIr(), mode: "probe", conventions: b0Conventions() });

  it("emits a throwaway spec that collects", () => {
    expect(probe().text).toMatchSnapshot();
  });

  it("emits the blessed setup moves byte-identically to spec mode", () => {
    // The fidelity argument that motivated the whole one-IR design leaks the moment these
    // diverge, so this is checked rather than intended.
    const specText = compile({ ir: b0Ir(), mode: "spec", conventions: b0Conventions() }).text;
    const probeText = probe().text;

    for (const line of [
      "cy.createDevice({ name: deviceName });",
      "cy.getDeviceIdByName(deviceName).then((deviceId: any) => {",
      "cy.request('/event/events', 'POST', {",
      "cy.login(Cypress.env('username'), Cypress.env('password'));",
    ]) {
      expect(specText).toContain(line);
      expect(probeText).toContain(line);
    }
  });

  it("brings in what a value builder needs, because a probe that crashes collects nothing", () => {
    // Measured the hard way: the probe emitted dayjs().format(...) from the isoTime builder with
    // no import, died on the setup request, and returned zero rows for a whole spent run.
    const text = probe().text;

    expect(text).toContain("dayjs().format('YYYY-MM-DDTHH:mm:ssZ')");
    expect(text).toContain("import * as dayjs from 'dayjs';");
  });

  it("routes a provisional selector through the command that records what it matched", () => {
    expect(probe().text).toContain("cy.c8yCygenProvisional('open-first-event',");
  });

  it("scopes every collect", () => {
    const { collects, text } = probe();

    expect(collects.map((c) => c.label)).toEqual(["events-page", "event-detail"]);
    expect(collects.every((c) => c.within.length > 0)).toBe(true);
    expect(text).toContain(
      "cy.c8yCygenCollect({ label: 'events-page', within: 'c8y-device-events' });"
    );
  });

  it("asserts nothing about a value it was sent to discover", () => {
    expect(probe().text).not.toContain("contain.text");
  });
});

describe("what lands on disk is valid TypeScript", () => {
  // A quote *preference* once emitted cy.get("[data-cy="..."]"), which does not parse - and
  // nothing caught it until Cypress ran. Parsing both back-ends closes that whole class here.
  const parseErrors = (text: string): string[] => {
    const file = ts.createSourceFile("out.cy.ts", text, ts.ScriptTarget.ES2022, true);
    return ((file as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []).map(
      (d) => ts.flattenDiagnosticMessageText(d.messageText, " ")
    );
  };

  it("parses the emitted spec", () => {
    expect(parseErrors(specOf())).toEqual([]);
  });

  it("parses the emitted probe", () => {
    const probe = compile({ ir: b0ProbeIr(), mode: "probe", conventions: b0Conventions() });

    expect(parseErrors(probe.text)).toEqual([]);
  });

  it("still parses when a value carries the quote the emitter prefers", () => {
    const text = specOf((ir) => {
      (ir.steps[8] as IrStep).assert!.operand = "a 'quoted' and \"double-quoted\" value";
    });

    expect(parseErrors(text)).toEqual([]);
  });
});

describe("the source map", () => {
  it("keys a step by the line range it occupies in the formatted file", () => {
    const { text, statements } = compile({
      ir: b0Ir(),
      mode: "spec",
      conventions: b0Conventions(),
    });
    // Stand in for the repo's formatter: rewrap a chain and flip a quote, which is what it does.
    const formatted = text
      .replace(
        "cy.get('[data-cy=\"c8y-event-details--source-wrapper\"]').should('contain.text', deviceName);",
        "cy.get('[data-cy=\"c8y-event-details--source-wrapper\"]').should(\n      'contain.text',\n      deviceName\n    );"
      );

    const map = buildSourceMap("cypress/e2e/x.cy.ts", formatted, statements);
    const lines = formatted.split("\n");
    const failingLine =
      lines.findIndex((l) => l.includes("'contain.text',") && !l.includes("cy.get")) + 1;

    expect(stepAtLine(map, failingLine)?.stepId).toBe("check-source");
  });

  it("resolves a failure inside a multi-line chain to the step that opened it", () => {
    const { text, statements } = compile({
      ir: b0Ir(),
      mode: "spec",
      conventions: b0Conventions(),
    });
    const map = buildSourceMap("cypress/e2e/x.cy.ts", text, statements);
    const lines = text.split("\n");
    const expectLine = lines.findIndex((l) => l.includes("to.be.within(-3, 3)")) + 1;

    expect(stepAtLine(map, expectLine)?.stepId).toBe("check-time");
  });

  it("carries the outcomes each statement satisfies, as a lookup rather than new data", () => {
    const { text, statements } = compile({
      ir: b0Ir(),
      mode: "spec",
      conventions: b0Conventions(),
    });
    const map = buildSourceMap("cypress/e2e/x.cy.ts", text, statements);

    expect(map.entries.find((e) => e.stepId === "check-latitude")?.outcomes).toEqual([7]);
    expect(map.entries.find((e) => e.stepId === "check-longitude")?.outcomes).toEqual([7]);
  });

  it("reports a statement it could not locate instead of silently dropping it", () => {
    // A step the map loses is otherwise indistinguishable from a step that asserts nothing, and
    // the scorer would blame the spec for a defect in the map.
    const { statements } = compile({
      ir: b0Ir(),
      mode: "spec",
      conventions: b0Conventions(),
    });

    const map = buildSourceMap("x.cy.ts", "describe('nothing like it', () => {});\n", statements);

    expect(map.entries).toEqual([]);
    expect(map.unanchored).toContain("check-latitude");
  });

  it("records the hash of the file it was built from, for whoever reads the run afterwards", () => {
    // There was an `isStale` beside this, and nothing ever called it: the map is rebuilt from
    // the file every time it is used, so there is no stale map to catch. The hash is written
    // into the run's sourcemap.json and stays as provenance.
    const { text, statements } = compile({
      ir: b0Ir(),
      mode: "spec",
      conventions: b0Conventions(),
    });
    const map = buildSourceMap("cypress/e2e/x.cy.ts", text, statements);

    expect(map.contentHash).toBe(hashContent(text));
    expect(map.contentHash).not.toBe(hashContent(`${text}// a human edited this\n`));
  });
});
