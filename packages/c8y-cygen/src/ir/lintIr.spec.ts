import { lintIr, type LintInput } from "./lintIr.js";
import { b0Contract, b0Conventions, b0Facts, b0Ir, b0ProbeIr } from "../testing/b0.js";
import type { IrDocument, IrStep } from "./types.js";
import { findRow, type FactsDocument } from "../facts/types.js";

function specInput(mutate: (ir: IrDocument) => void = () => {}): LintInput {
  const ir = b0Ir();
  mutate(ir);
  return {
    ir,
    mode: "spec",
    conventions: b0Conventions(),
    contract: b0Contract(),
    facts: b0Facts(),
  };
}

const messages = (input: LintInput): string =>
  lintIr(input)
    .errors.map((e) => `${e.where}: ${e.message}`)
    .join("\n");

describe("the semantic linter", () => {
  it("passes the B0 spec IR", () => {
    const result = lintIr(specInput());

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("passes the B0 probe IR in probe mode, and lists what is still missing", () => {
    const result = lintIr({
      ir: b0ProbeIr(),
      mode: "probe",
      conventions: b0Conventions(),
      contract: b0Contract(),
    });

    expect(result.errors).toEqual([]);
    expect(result.gaps.find((g) => g.need === "selector")?.at).toBe("open-first-event");
    expect(result.gaps.filter((g) => g.need === "assertion").length).toBeGreaterThan(0);
  });

  it("reports one assertion gap per outcome, not one per reference to a dump", () => {
    const result = lintIr({
      ir: b0ProbeIr(),
      mode: "probe",
      conventions: b0Conventions(),
      contract: b0Contract(),
    });

    const assertionGaps = result.gaps.filter((g) => g.need === "assertion");
    expect(assertionGaps).toHaveLength(7);
    expect(new Set(assertionGaps.map((g) => g.at)).size).toBe(7);
  });

  it("names the outcomes already satisfied, so progress is counted rather than inferred", () => {
    expect(lintIr(specInput()).coveredOutcomes).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(
      lintIr({
        ir: b0ProbeIr(),
        mode: "probe",
        conventions: b0Conventions(),
        contract: b0Contract(),
      }).coveredOutcomes
    ).toEqual([]);
  });

  // A selector is derived from an observed row and can never be invented. An operand read out
  // of the page is the same claim, and had no check at all: `extract: "value"` compiled happily
  // against a row no probe ever saw hold a value. B1 asserted a device name that was on the
  // screen and in no fact, and spent the rest of its budget healing the wrong thing.
  it("refuses to read a value off a row no probe observed one on", () => {
    const input = specInput((ir) => {
      const step = ir.steps.find((s) => s.id === "check-source") as IrStep;
      (step.assert as { extract: string }).extract = "value";
    });

    expect(messages(input)).toMatch(/asserts on a value/);
    // In probe mode the same finding is a gap, not a refusal: it is something still to observe.
    expect(
      lintIr({ ...input, mode: "probe" }).gaps.find((g) => g.need === "value")?.at
    ).toBe("check-source");
  });

  it("allows it once the probe has recorded one, which is what a settle is for", () => {
    const input = specInput((ir) => {
      const step = ir.steps.find((s) => s.id === "check-source") as IrStep;
      (step.assert as { extract: string }).extract = "value";
    });
    const row = findRow(input.facts as FactsDocument, "event-detail#1");
    (row as { value?: string }).value = "e2eDevice";

    expect(lintIr(input).errors).toEqual([]);
  });

  // Run five's only failure. A provisional missed, so the probe dumped the whole page to give
  // the next guess something to work from; that dump was taken with the dashboard not in edit
  // mode, and a Save button inside a collapsed drawer was recorded - correctly - as hidden. The
  // model later clicked it. Every link worked as designed and Cypress still waited ten seconds
  // for a button inside `display: none`.
  //
  // The row has carried `visible | hidden | clipped` since ticket 07 precisely so this can be
  // judged, and it was judged nowhere.
  it("refuses to click a row the probe saw as hidden", () => {
    const input = specInput();
    const row = findRow(input.facts as FactsDocument, "events-page#3");
    (row as { visibility: string }).visibility = "hidden";

    expect(messages(input)).toMatch(/hidden/);
  });

  it("still clicks a clipped row, which is on the page and merely scrolled out of it", () => {
    const input = specInput();
    const row = findRow(input.facts as FactsDocument, "events-page#3");
    (row as { visibility: string }).visibility = "clipped";

    expect(lintIr(input).errors).toEqual([]);
  });

  it("will not let a spec IR lint while any selector is still provisional", () => {
    // This is the loop's stop condition. An under-probed spec IR is unlinttable by
    // construction, so "am I done gathering?" is a free local check.
    const result = lintIr({
      ir: b0ProbeIr(),
      mode: "spec",
      conventions: b0Conventions(),
      contract: b0Contract(),
      facts: b0Facts(),
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.trip === "selector-absent")).toBe(true);
  });
});

describe("the broken-file corpus", () => {
  // One planted defect per rule, extended with every capability added. Not a nice-to-have:
  // adding one optional field once cut schema coverage from three defects caught to two,
  // breaking the linter's verb detection and the compiler's verb lookup at the same time -
  // one capability, three breakages, nothing failing.

  it("catches a create step that declares no undo, so nothing resets what it made", () => {
    // Ticket 02 Q7(c) is a rule about the emitted spec, and a rule nothing checks is a wish.
    // createDevice names a teardown snippet in the conventions file, so the repo knows how to
    // remove what it makes; the IR only has to say which capture holds the id.
    const input = specInput((ir) => {
      delete ir.steps[0]?.undo;
    });

    expect(messages(input)).toMatch(/make-device.*undo/s);
  });

  it("catches an undo pointing at a name nothing binds", () => {
    const input = specInput((ir) => {
      (ir.steps[0] as IrStep).undo = { idFrom: "notBoundAnywhere" };
    });

    expect(messages(input)).toMatch(/notBoundAnywhere/);
  });

  it("asks for no undo from a move the repo cannot remove", () => {
    // getDeviceIdByName is real-state but read-only, and createMockedDevice makes nothing to
    // delete. Neither names a teardown snippet, so neither is asked for one.
    const input = specInput((ir) => {
      delete ir.steps[1]?.undo;
    });

    expect(messages(input)).not.toMatch(/get-device-id.*undo/s);
  });

  it("catches a settle a following click already performs", () => {
    // A click waits for actionability, which includes visibility, so a settle(visible) on the
    // same target is two lines that buy nothing. Measured on the first scored run.
    const input = specInput((ir) => {
      ir.steps.splice(5, 0, {
        id: "settle-first-event",
        settle: {
          target: {
            resolved: "cy.get('[data-cy=\"c8y-events-list--timeline-item\"]')",
            fromRow: "events-page#3",
          },
          state: "visible",
        },
      });
    });

    expect(messages(input)).toMatch(/steps\.settle-first-event: .*already/);
  });

  it("keeps a settle(visible) before an assertion, which does not check visibility", () => {
    // `.should('contain.text')` retries until the text matches; it never checks visibility. A
    // panel left in the DOM at display:none with the right text would start passing.
    const input = specInput((ir) => {
      ir.steps.splice(6, 0, {
        id: "settle-source",
        settle: {
          target: {
            resolved: "cy.get('[data-cy=\"c8y-event-details--source-wrapper\"]')",
            fromRow: "event-detail#1",
          },
          state: "visible",
        },
      });
    });

    expect(messages(input)).not.toMatch(/steps\.settle-source: .*already/);
  });

  it("catches a settle(exists) before an assertion, which does imply existence", () => {
    const input = specInput((ir) => {
      ir.steps.splice(6, 0, {
        id: "settle-source",
        settle: {
          target: {
            resolved: "cy.get('[data-cy=\"c8y-event-details--source-wrapper\"]')",
            fromRow: "event-detail#1",
          },
          state: "exists",
        },
      });
    });

    expect(messages(input)).toMatch(/steps\.settle-source: .*already/);
  });

  it("keeps a settle carrying a length assertion nothing else makes", () => {
    const input = specInput((ir) => {
      ir.steps.splice(5, 0, {
        id: "settle-three",
        settle: {
          target: {
            resolved: "cy.get('[data-cy=\"c8y-events-list--timeline-item\"]')",
            fromRow: "events-page#3",
          },
          state: "visible",
          cardinality: { exactly: 3 },
        },
      });
    });

    expect(messages(input)).not.toMatch(/steps\.settle-three: .*already/);
  });

  it("leaves a settle alone when the next step targets something else", () => {
    // The target comparison's own regression case: redundant in every way except the target.
    const input = specInput((ir) => {
      ir.steps.splice(5, 0, {
        id: "settle-elsewhere",
        settle: {
          target: { resolved: "cy.get('c8y-something-else')", fromRow: "events-page#1" },
          state: "exists",
        },
      });
    });

    expect(messages(input)).not.toMatch(/steps\.settle-elsewhere: .*already/);
  });

  it("names the key ajv objected to, rather than leaving the model to guess", () => {
    // A bare "must NOT have additional properties" costs an iteration per guess, and this is
    // exactly what a model carrying a habit from a removed field will hit.
    const input = specInput((ir) => {
      (ir.steps[4] as unknown as Record<string, unknown>)["timeoutMs"] = 20_000;
    });

    expect(messages(input)).toMatch(/'timeoutMs' is not a field of this object/);
  });

  it("catches a probe-only verb in a spec-mode IR", () => {
    const input = specInput((ir) => {
      ir.steps.push({ id: "sneaky", collect: { label: "x", within: "body" } });
    });

    expect(messages(input)).toMatch(/'collect' is probe-only/);
  });

  it("catches a provisional selector in a spec-mode IR", () => {
    const input = specInput((ir) => {
      (ir.steps[5] as IrStep).click = {
        target: { provisional: { tag: "li", nth: 0 } },
      };
    });

    expect(messages(input)).toMatch(/provisional selector is probe-only/);
  });

  it("catches an outcome satisfied by a step that asserts nothing", () => {
    const input = specInput((ir) => {
      (ir.outcomes[0] as { satisfiedBy: string[] }).satisfiedBy = ["open-events"];
    });

    expect(messages(input)).toMatch(/a dump is not an assertion, and neither is an action/);
  });

  it("catches two verbs in one step", () => {
    const input = specInput((ir) => {
      (ir.steps[3] as IrStep).click = {
        target: { resolved: "cy.get('c8y-tabs-outlet')", fromRow: "events-page#0" },
      };
    });

    expect(messages(input)).toMatch(/exactly one verb, found 2/);
  });

  it("catches an unknown verb", () => {
    const input = specInput((ir) => {
      (ir.steps[3] as unknown as Record<string, unknown>)["teleport"] = { to: "x" };
    });

    // An unknown key is refused by the schema before the linter sees it; either layer is fine,
    // what matters is that it does not reach the compiler.
    expect(messages(input)).toMatch(/schema|unknown verb/);
  });

  it("catches a dangling outcome reference", () => {
    const input = specInput((ir) => {
      (ir.outcomes[2] as { satisfiedBy: string[] }).satisfiedBy = ["check-tiem"];
    });

    expect(messages(input)).toMatch(/satisfiedBy 'check-tiem' matches no step id/);
  });

  it("catches a selector derived from a row no probe observed", () => {
    const input = specInput((ir) => {
      (ir.steps[6] as IrStep).assert!.target = {
        resolved: "cy.get('[data-cy=\"invented\"]')",
        fromRow: "event-detail#99",
      };
    });

    expect(messages(input)).toMatch(/row 'event-detail#99', which no probe observed/);
  });

  it("catches a selector the ladder does not derive from the row it names", () => {
    // The verifiable link. The literal selector stays in the IR so it is reviewable, and the
    // row reference beside it is what makes "the model never authors a selector" checkable.
    const input = specInput((ir) => {
      (ir.steps[6] as IrStep).assert!.target = {
        resolved: "cy.get('.source-wrapper')",
        fromRow: "event-detail#1",
      };
    });

    expect(messages(input)).toMatch(/is not what the ladder derives from row/);
  });

  it("catches an unbound runtime reference", () => {
    const input = specInput((ir) => {
      (ir.steps[3] as IrStep).visit!.path = "/apps/x#/device/${deviceIdentifier}/events";
    });

    expect(messages(input)).toMatch(/unbound runtime reference '\$\{deviceIdentifier\}'/);
  });

  it("catches a bare selector where a Cypress expression belongs", () => {
    // Measured: the model wrote resolved: "c8y-tabs-outlet", the probe back-end passed a
    // resolved target through untouched, and the emitted spec said c8y-tabs-outlet.should(...)
    // - a bare identifier. "c8y is not defined", one probe run spent.
    const input = specInput((ir) => {
      (ir.steps[4] as IrStep).settle!.target = {
        resolved: "c8y-tabs-outlet",
        fromRow: "events-page#1",
      };
    });

    expect(messages(input)).toMatch(/is not a Cypress expression/);
  });

  it("checks a resolved target in probe mode too, not only in spec mode", () => {
    // Probe mode used to skip every resolved-target check, which is the same fail-open shape as
    // the spec back-end emitting null.click() for a provisional.
    const ir = b0ProbeIr();
    (ir.steps[5] as IrStep).click!.target = { resolved: "main", fromRow: "events-page#1" };

    const result = lintIr({
      ir,
      mode: "probe",
      conventions: b0Conventions(),
      contract: b0Contract(),
      facts: b0Facts(),
    });

    expect(result.errors.map((e) => e.message).join(" ")).toMatch(
      /is not a Cypress expression/
    );
  });

  it("catches a CSS selector put where a text regex belongs", () => {
    // Measured: the model wrote matches: "[data-cy='x'], c8y-device-details", which is a valid
    // selector and an invalid character class. The probe run died on it and collected nothing.
    const input = {
      ir: b0ProbeIr(),
      mode: "probe" as const,
      conventions: b0Conventions(),
      contract: b0Contract(),
    };
    (input.ir.steps[5] as IrStep).click!.target = {
      provisional: { matches: "[data-cy='device-details--tab-view'], c8y-device-details" },
    };

    expect(messages(input)).toMatch(/is a CSS selector/);
  });

  it("catches a matches pattern that is not a valid regular expression", () => {
    const input = {
      ir: b0ProbeIr(),
      mode: "probe" as const,
      conventions: b0Conventions(),
      contract: b0Contract(),
    };
    (input.ir.steps[5] as IrStep).click!.target = { provisional: { matches: "Save(" } };

    expect(messages(input)).toMatch(/not a valid regular expression/);
  });

  it("allows the state-dependent label regex the design exists for", () => {
    const input = {
      ir: b0ProbeIr(),
      mode: "probe" as const,
      conventions: b0Conventions(),
      contract: b0Contract(),
    };
    (input.ir.steps[5] as IrStep).click!.target = {
      provisional: { tag: "button", matches: "Change provider|Add global provider" },
    };

    expect(messages(input)).not.toMatch(/matches/);
  });

  it("catches a brace that lost its dollar", () => {
    // Measured: the model wrote #/device/{deviceId}/events and the spec navigated to a URL with
    // a literal brace in it. Nothing downstream can tell that from a route that really contains
    // one, so it has to be caught while the bound names are still in hand.
    const input = specInput((ir) => {
      (ir.steps[3] as IrStep).visit!.path = "/apps/x#/device/{deviceId}/events";
    });

    expect(messages(input)).toMatch(/missing its dollar/);
  });

  it("leaves a brace alone when it names nothing bound", () => {
    const input = specInput((ir) => {
      (ir.steps[3] as IrStep).visit!.path =
        "/apps/x#/device/${deviceId}/events?filter={raw}";
    });

    expect(messages(input)).not.toMatch(/missing its dollar/);
  });

  it("catches the repo auth idiom authored into the IR, which would emit it twice", () => {
    const input = specInput((ir) => {
      ir.setup = [{ id: "login", callRepoHelper: { name: "login" } }];
    });

    expect(messages(input)).toMatch(/already emits it in beforeEach/);
  });

  it("catches a capture referenced before the step that binds it", () => {
    const input = specInput((ir) => {
      const capture = ir.steps[1] as IrStep;
      ir.steps.splice(1, 1);
      ir.steps.push(capture);
    });

    expect(messages(input)).toMatch(/unbound runtime reference/);
  });

  it("catches a helper that is not real", () => {
    // postEvent exists nowhere in either repo. It linted clean once and would have failed only
    // when Cypress ran; the enumeration probe is what closes that hole at lint time.
    const input = specInput((ir) => {
      (ir.steps[0] as IrStep).callRepoHelper!.name = "postEvent";
    });

    expect(messages(input)).toMatch(/'postEvent' is not a registered command/);
  });

  it("tells a real-but-unblessed helper apart from one that is not real", () => {
    const input = specInput((ir) => {
      (ir.steps[0] as IrStep).callRepoHelper!.name = "createUser";
    });

    expect(messages(input)).toMatch(/is a real command in this repo but is not blessed/);
  });

  it("catches a value builder this repo does not have", () => {
    const input = specInput((ir) => {
      ir.vars = { deviceName: { builder: "randomWord" } };
    });

    expect(messages(input)).toMatch(/no value builder 'randomWord'/);
  });

  it("catches a value builder a directory override denies", () => {
    const conventions = b0Conventions();
    conventions.deniedValueBuilders = ["uniqueName"];
    conventions.effectiveValueBuilders = conventions.effectiveValueBuilders.filter(
      (b) => b.id !== "uniqueName"
    );

    const result = lintIr({ ...specInput(), conventions });

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(
      /'uniqueName' is denied in this directory/
    );
  });

  it("catches an invented literal in a request body", () => {
    const input = specInput((ir) => {
      const body = (ir.steps[2] as IrStep).request!.body as {
        object: Record<string, unknown>;
      };
      body.object["severity"] = "CRITICAL";
    });

    expect(messages(input)).toMatch(/appears nowhere in the scenario contract/);
  });

  it("catches an IR with zero DOM steps and names it as the contract genre", () => {
    const input = specInput((ir) => {
      ir.steps = ir.steps.filter((s) => s.request || s.callRepoHelper);
      ir.outcomes = [{ id: 1, text: "x", satisfiedBy: ["post-event"] }];
    });

    const result = lintIr(input);

    expect(result.errors.some((e) => e.trip === "zero-dom-steps")).toBe(true);
  });

  it("catches an Expected Outcome with no assertion at all", () => {
    const input = specInput((ir) => {
      ir.outcomes = ir.outcomes.filter((o) => o.id !== 6);
      ir.steps = ir.steps.filter((s) => s.id !== "check-custom-data-items");
    });

    const result = lintIr(input);

    expect(result.errors.some((e) => e.trip === "outcome-unmappable")).toBe(true);
    expect(messages(input)).toMatch(/Expected Outcome 6 has no assertion/);
  });

  it("catches an outcome satisfied by a value a fabricating move produced", () => {
    // The cheapest route to green is to fabricate the value about to be asserted, and it
    // yields a *passing* spec, so nothing else in the system would ever catch it.
    const input = specInput((ir) => {
      (ir.steps[0] as IrStep).callRepoHelper = {
        name: "createMockedDevice",
        args: [{ object: { name: { ref: "deviceName" } } }],
      };
      (ir.steps[0] as IrStep).captures = "mockedDevice";
      (ir.steps[6] as IrStep).assert!.operand = { ref: "mockedDevice" };
    });

    expect(messages(input)).toMatch(/a fabricating setup move produced in the same test/);
  });

  it("catches a duplicated step id", () => {
    const input = specInput((ir) => {
      (ir.steps[7] as IrStep).id = "check-source";
    });

    expect(messages(input)).toMatch(/used more than once/);
  });

  it("catches an outcome the scenario contract does not have", () => {
    const input = specInput((ir) => {
      ir.outcomes.push({ id: 8, text: "invented", satisfiedBy: ["check-type"] });
    });

    expect(messages(input)).toMatch(/outcome 8 is not an Expected Outcome/);
  });
});

describe("a capture in setup", () => {
  it("is refused, because setup compiles to a beforeEach that binds nothing", () => {
    // Accepted and silently discarded before. With `undo` beside it the compiler declared a
    // teardown holder and emitted an afterEach against a variable nothing assigns - so the
    // guard was always false, the device outlived the run, and the report said the tree
    // was clean.
    const ir = b0Ir();
    const result = lintIr({
      ir: {
        ...ir,
        setup: [
          {
            id: "make-device-early",
            callRepoHelper: { name: "createDevice", args: [{ object: { name: "x" } }] },
            captures: "deviceId",
            undo: { idFrom: "deviceId" },
          },
        ],
      },
      mode: "spec",
      conventions: b0Conventions(),
      contract: b0Contract(),
      facts: b0Facts(),
    });

    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.message).join(" ")).toMatch(
      /'captures' is not available in setup/
    );
  });

  it("says where to put it instead, so the next turn is not a guess", () => {
    const ir = b0Ir();
    const result = lintIr({
      ir: { ...ir, setup: [{ id: "s", callRepoHelper: { name: "createDevice" }, captures: "x" }] },
      mode: "spec",
      conventions: b0Conventions(),
      contract: b0Contract(),
      facts: b0Facts(),
    });

    expect(result.errors.find((e) => e.where === "setup.s")?.message).toMatch(/Move this step into/);
  });
});

describe("a matches pattern that carries a character class", () => {
  function matchesPattern(pattern: string) {
    const ir = b0ProbeIr();
    const steps = ir.steps.map((step) =>
      step.id === "open-first-event"
        ? { ...step, click: { target: { provisional: { within: "c8y-device-events", matches: pattern } } } }
        : step
    );
    return lintIr({
      ir: { ...ir, steps } as IrDocument,
      mode: "probe",
      conventions: b0Conventions(),
      contract: b0Contract(),
    }).errors.map((e) => e.message).join(" ");
  }

  it.each([
    ["a digit class", "Device [0-9]+ online"],
    ["an optional-letter class", "Creation ?[Tt]ime"],
    ["escaped brackets in the label itself", "Alarm \\[critical\\]"],
  ])("accepts %s, which is what the field is for", (_label, pattern) => {
    // It rejected any pattern containing `[`, so the field's own documented use was refused -
    // and the advice sent the model to fix something that was not wrong, for a whole turn.
    expect(matchesPattern(pattern)).not.toMatch(/is a CSS selector/);
  });

  it.each([
    ["an attribute selector", "[data-cy='creation-time']"],
    ["a contains-attribute selector", "[data-cy*='custom']"],
    ["a class selector", ".c8y-tab-view"],
    ["a tag with an attribute", "div[data-cy=x]"],
    ["a selector list", "[data-cy='tab-view'], c8y-device-details"],
  ])("still catches %s", (_label, pattern) => {
    expect(matchesPattern(pattern)).toMatch(/is a CSS selector/);
  });

  it("does not read a bare word as a selector, because it is as good a regex", () => {
    expect(matchesPattern("Time")).not.toMatch(/is a CSS selector/);
  });
});
