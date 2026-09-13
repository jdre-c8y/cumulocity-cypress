/**
 * The linter's half of ticket 02's §5 and rule 3.
 *
 * The compiler tests prove a stub emits the right code. These prove the rules that decide
 * whether it is allowed to - anchoring, ordering, the alias vocabulary, and the record the
 * anti-gaming invariant leaves behind.
 */
import { formatLintResult, lintIr, type LintInput } from "./lintIr.js";
import { b0Conventions } from "../testing/b0.js";
import { parseScenarioContract } from "../contract/scenarioContract.js";
import type { FactsDocument } from "../facts/types.js";
import type { IrDocument, IrStep } from "./types.js";

const CONTRACT = `<!-- id: T -->

# Scenario: A widget keeps its device

## Objective

Check the widget keeps e2eWidgetGroup's configured device.

## Preconditions

- A session.

## Setup

All state is mocked.

## Steps

1. Open the dashboard.

## Expected Outcomes

1. The page title shows the group name.

## Style

\`mocked\`
`;

function contract() {
  return parseScenarioContract(CONTRACT, "cypress/e2e/x.scenario.md");
}

function facts(): FactsDocument {
  return {
    version: 1,
    runId: "fixture",
    tenantUrl: "https://t.example.c8y.io",
    appVersion: null,
    surfaces: [
      {
        label: "page",
        within: "c8y-title",
        observedAt: "2026-09-09T09:00:00.000Z",
        rows: [
          {
            id: "page#0",
            ancestors: [],
            tag: "div",
            attrs: { dataCy: "c8y-title--title-outlet" },
            classes: [],
            text: "realGroup",
            visibility: "visible",
            actionable: false,
            repeat: { siblingsLike: 1, index: 0 },
          },
        ],
      },
    ],
    provisionalMatches: [],
    complete: true,
    requests: [
      {
        id: "boot#0",
        method: "GET",
        url: "https://t.example.c8y.io/inventory/managedObjects/12345",
        pathname: "/inventory/managedObjects/12345",
        status: 200,
        body: { id: "12345", name: "realGroup" },
      },
    ],
  };
}

const TITLE: IrStep = {
  id: "see-title",
  assert: {
    target: {
      resolved: "cy.get('[data-cy=\"c8y-title--title-outlet\"]')",
      fromRow: "page#0",
    },
    extract: "text",
    compare: "includes",
    operand: "e2eWidgetGroup",
  },
};

function ir(steps: IrStep[], over: Partial<IrDocument> = {}): IrDocument {
  return {
    version: 1,
    meta: {
      contract: "cypress/e2e/x.scenario.md",
      suite: "Asset Properties Widget",
      title: "keeps its device",
      style: "mocked",
    },
    steps,
    outcomes: [{ id: 1, text: "The page title shows the group name.", satisfiedBy: ["see-title"] }],
    ...over,
  };
}

function input(steps: IrStep[], over: Partial<IrDocument> = {}): LintInput {
  return {
    ir: ir(steps, over),
    mode: "spec",
    conventions: b0Conventions(),
    contract: contract(),
    facts: facts(),
  };
}

const messages = (i: LintInput): string =>
  lintIr(i)
    .errors.map((e) => `${e.where}: ${e.message}`)
    .join("\n");

const stub = (over: Record<string, unknown> = {}): IrStep => ({
  id: "stub-group",
  stub: {
    route: { method: "GET", url: "/inventory/managedObjects/12345*" },
    fromRequest: "boot#0",
    ...over,
  } as IrStep["stub"],
});

const visit: IrStep = { id: "go", visit: { path: "/apps/cockpit/index.html#/group/12345" } };

describe("rule 3: a stub body is derived, never invented", () => {
  it("passes a stub anchored to an observed exchange", () => {
    expect(lintIr(input([stub(), visit, TITLE])).errors).toEqual([]);
  });

  it("refuses a stub anchored to an exchange no probe observed", () => {
    const result = lintIr(input([stub({ fromRequest: "boot#9" }), visit, TITLE]));

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/boot#9/);
    expect(result.errors.find((e) => e.trip)?.trip).toBe("response-absent");
  });

  it("refuses a stub anchored to an exchange whose body was dropped", () => {
    const bodyless = facts();
    bodyless.requests.push({
      id: "boot#1",
      method: "GET",
      url: "https://t.example.c8y.io/big",
      pathname: "/big",
      status: 200,
      bodyDropped: true,
    });

    const result = lintIr({
      ...input([stub({ fromRequest: "boot#1" }), visit, TITLE]),
      facts: bodyless,
    });

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/dropped|no body/i);
  });

  it("reports a missing exchange as a gap in probe mode, not as an error", () => {
    // In probe mode nothing has been observed yet by definition. The gap is the instruction to
    // go and watch the traffic; an error here would stop the run before it could.
    const result = lintIr({
      ...input([stub({ fromRequest: "boot#9" }), visit, TITLE]),
      mode: "probe",
      facts: undefined,
    });

    expect(result.errors.filter((e) => e.trip === "response-absent")).toEqual([]);
    expect(result.gaps.some((g) => g.need === "response")).toBe(true);
  });

  it("requires a mutation value to trace to the contract, a capture or a builder", () => {
    // The other half of rule 3. An observed body with one field quietly replaced by an invented
    // literal is exactly the fabrication the rule exists to stop, and it is invisible in the
    // emitted spec because the rest of the body is genuine.
    const invented = messages(
      input([
        stub({ mutations: [{ path: "name", value: "totallyMadeUp" }] }),
        visit,
        TITLE,
      ])
    );
    const anchored = messages(
      input([
        stub({ mutations: [{ path: "name", value: "e2eWidgetGroup" }] }),
        visit,
        TITLE,
      ])
    );

    expect(invented).toMatch(/totallyMadeUp/);
    expect(anchored).toBe("");
  });
});

describe("an intercept that fires, rather than one that silently does not", () => {
  it("refuses an intercept registered after the visit it was meant to catch", () => {
    // The expensive failure. Cypress registers the route happily, the request has already gone,
    // nothing errors, and the page loads against the real tenant as though nothing were mocked.
    const result = lintIr(input([visit, stub(), TITLE]));

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(
      /before.*visit|after.*visit/i
    );
  });

  it("accepts an intercept in setup, which runs before the test body", () => {
    expect(
      lintIr(input([visit, TITLE], { setup: [stub()] })).errors
    ).toEqual([]);
  });
});

describe("the alias vocabulary", () => {
  const sync = (alias: string): IrStep => ({
    id: `sync-${alias}`,
    sync: { route: { url: "/inventory/*" }, alias },
  });

  it("refuses a waitFor naming an alias nothing binds", () => {
    const result = lintIr(
      input([sync("objects"), visit, { id: "w", waitFor: { aliases: ["dashboards"] } }, TITLE])
    );

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/dashboards/);
  });

  it("refuses two routes claiming one alias", () => {
    const result = lintIr(input([sync("objects"), { ...sync("objects"), id: "again" }, visit, TITLE]));

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/objects/);
  });

  it("refuses a waitFor on an alias bound later in the flow", () => {
    const result = lintIr(
      input([{ id: "w", waitFor: { aliases: ["objects"] } }, sync("objects"), visit, TITLE])
    );

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/objects/);
  });
});

describe("style, which axis D grades and the linter can check", () => {
  it("refuses a stub in an IR declaring integration style", () => {
    const result = lintIr(
      input([stub(), visit, TITLE], { meta: { ...ir([]).meta, style: "integration" } })
    );

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/integration/);
  });

  // It used to refuse. That cost B1 its fourth run: to re-probe, a target goes back to
  // `provisional`, which compiles as a probe IR - refused here, while the heal guard refused
  // the only fix, because deleting a stub is deleting a non-scaffolding step. The compiler
  // already drops every stub in probe mode and says so in the emitted spec, so the probe calls
  // the real application either way. Dropping is not serving, and a mocked oracle has to be
  // able to re-probe.
  it("lets a probe IR carry a stub, and tells the model the probe dropped it", () => {
    const result = lintIr({ ...input([stub(), visit, TITLE]), mode: "probe" });

    expect(result.errors).toEqual([]);
    expect(result.gaps.map((g) => g.hint).join("\n")).toMatch(/drops stub/);
  });
});

describe("the anti-gaming record, which is reported rather than refused", () => {
  it("names an outcome satisfied by a value the same test wrote into a fake response", () => {
    // Ticket 02's invariant, made visible. It is not a refusal: whether stubbing a precondition
    // and asserting what the app does with it is gaming or is the whole point of a mocked test
    // is a judgement about the scenario, and the linter cannot make it. What the linter can do
    // is count it, so the human grading flow equivalence is never surprised by it.
    const result = lintIr(
      input([
        stub({ mutations: [{ path: "name", value: { ref: "groupName" } }] }),
        visit,
        TITLE,
      ], { vars: { groupName: "e2eWidgetGroup" } })
    );

    expect(result.errors).toEqual([]);
    expect(result.stubSatisfied).toEqual([{ outcome: 1, via: "groupName" }]);
    expect(formatLintResult(result)).toMatch(/NOTE.*outcome 1.*groupName/);
  });

  it("says nothing when the asserted value was never written into a stub", () => {
    const result = lintIr(input([stub(), visit, TITLE]));

    expect(result.stubSatisfied).toEqual([]);
  });
});

describe("where the ordering rule draws its line, and why there", () => {
  const secondVisit: IrStep = { id: "go2", visit: { path: "/apps/cockpit/index.html#/other" } };
  const click = (id: string): IrStep => ({
    id,
    click: {
      target: {
        resolved: "cy.get('[data-cy=\"c8y-title--title-outlet\"]')",
        fromRow: "page#0",
      },
    },
  });

  it("refuses a second page's stubs sitting between the two visits", () => {
    // Refused, and the remedy is free: registering a route before the FIRST visit catches the
    // second page's traffic just as well, because a route stays registered for the whole test.
    // An earlier version of this rule allowed this shape - and allowing it meant allowing B1's
    // real hazard too, since the two are indistinguishable from step order alone.
    const result = lintIr(
      input([stub(), visit, { ...stub(), id: "stub-2" }, secondVisit, TITLE])
    );

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/already gone/);
  });

  it("refuses a stub placed after a visit with no interaction in between", () => {
    const result = lintIr(input([visit, { ...stub(), id: "stub-lazy" }, click("expand"), TITLE]));

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/already gone/);
  });

  it("allows a stub once the flow has interacted, where moving it up may be impossible", () => {
    // The one case with no free remedy: past a click, a stub's body or route may depend on
    // something the flow only learned by interacting, so it cannot be hoisted above the visit.
    const result = lintIr(
      input([visit, click("expand"), { ...stub(), id: "stub-lazy" }, click("expand-2"), TITLE])
    );

    expect(result.errors).toEqual([]);
  });
});

describe("the stub-satisfied count has to be worth believing", () => {
  it("does not call an outcome stubbed because a page size and a count are both 5", () => {
    // A measurement's credibility is the whole of its value. Numbers in these bodies are page
    // sizes and totals; a fabricated identity is a string. Matching on bare numbers would put
    // coincidences in a report a human reads to decide whether a spec is honest.
    const result = lintIr(
      input([
        stub({ mutations: [{ path: "name", value: "e2eWidgetGroup" }] }),
        visit,
        {
          id: "see-title",
          assert: {
            target: {
              resolved: "cy.get('[data-cy=\"c8y-title--title-outlet\"]')",
              fromRow: "page#0",
            },
            extract: "count",
            compare: "equals",
            operand: 5,
          },
        },
      ])
    );

    expect(result.stubSatisfied).toEqual([]);
  });
});

describe("a route that could not be emitted", () => {
  it("refuses a matcher with neither a url nor a pathname, before the compiler throws", () => {
    // The compiler does throw on this, and a throw during a spec compile ends the run. A lint
    // error costs one turn and names the fix.
    const result = lintIr(input([stub({ route: { method: "GET" } }), visit, TITLE]));

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/matches on nothing/);
  });
});

describe("a mutation that is not a mutation", () => {
  it("refuses an empty path, which would replace the whole observed body", () => {
    // The back door out of rule 3. `path: ""` addresses the root, so the 'derived' body would be
    // whatever the model typed - with the observed exchange named beside it as though it had
    // been derived from something.
    const result = lintIr(
      input([
        stub({ mutations: [{ path: "", value: { object: { name: "e2eWidgetGroup" } } }] }),
        visit,
        TITLE,
      ])
    );

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/schema/);
  });
});

describe("everything the compiler would throw on, caught where it costs a turn instead of a run", () => {
  // runScenario's only try/catch logs strays and rethrows, so a CompileError during a spec
  // compile ends the run. The linter is the loop's stop condition, and the invariant it rests
  // on is that an IR which lints is an IR that compiles.

  it("refuses a mutation path that names nothing in the observed body", () => {
    const result = lintIr(
      input([stub({ mutations: [{ path: "nmae", value: "e2eWidgetGroup" }] }), visit, TITLE])
    );

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/'nmae'/);
  });

  it("accepts a path that walks into an array by index", () => {
    const deep = facts();
    (deep.requests[0] as { body: unknown }).body = {
      managedObjects: [{ name: "realGroup" }],
    };

    const result = lintIr({
      ...input(
        [
          stub({
            fromRequest: "boot#0",
            mutations: [{ path: "managedObjects.0.name", value: "e2eWidgetGroup" }],
          }),
          visit,
          TITLE,
        ]
      ),
      facts: deep,
    });

    expect(result.errors).toEqual([]);
  });

  it("refuses two mutations writing one path", () => {
    const result = lintIr(
      input([
        stub({
          mutations: [
            { path: "name", value: "e2eWidgetGroup" },
            { path: "name", value: "e2eWidgetGroup" },
          ],
        }),
        visit,
        TITLE,
      ])
    );

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/'name'/);
  });

  it("refuses a negated time-window comparison", () => {
    const result = lintIr(
      input([
        visit,
        {
          id: "see-title",
          assert: {
            target: {
              resolved: "cy.get('[data-cy=\"c8y-title--title-outlet\"]')",
              fromRow: "page#0",
            },
            extract: "text",
            compare: "withinMinutesOfNow",
            negate: true,
            operand: 3,
          },
        },
      ])
    );

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/withinMinutesOfNow/);
  });

  it("checks a route string for an unbound reference and for a missing dollar", () => {
    const unbound = lintIr(
      input([stub({ route: { method: "GET", url: "/inventory/${nope}*" } }), visit, TITLE])
    );
    const missingDollar = lintIr(
      input(
        [stub({ route: { method: "GET", url: "/inventory/{groupId}*" } }), visit, TITLE],
        { vars: { groupId: "12345" } }
      )
    );

    expect(unbound.errors.map((e) => e.message).join("\n")).toMatch(/nope/);
    expect(missingDollar.errors.map((e) => e.message).join("\n")).toMatch(/missing its dollar/);
  });
});

describe("the stub-satisfied count, read from both ends", () => {
  it("counts a stub that writes a literal read back through a ref", () => {
    // The commonest shape and the one the first version missed: the stub writes the string, the
    // assertion reaches for the var that holds it. Resolving vars on the stub side only made the
    // report understate the number it exists to surface.
    const result = lintIr(
      input(
        [
          stub({ mutations: [{ path: "name", value: "e2eWidgetGroup" }] }),
          visit,
          {
            id: "see-title",
            assert: {
              target: {
                resolved: "cy.get('[data-cy=\"c8y-title--title-outlet\"]')",
                fromRow: "page#0",
              },
              extract: "text",
              compare: "includes",
              operand: { ref: "groupName" },
            },
          },
        ],
        { vars: { groupName: "e2eWidgetGroup" } }
      )
    );

    expect(result.stubSatisfied).toEqual([{ outcome: 1, via: "e2eWidgetGroup" }]);
  });
});
