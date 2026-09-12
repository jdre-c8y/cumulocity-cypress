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

  it("refuses a stub in a probe IR, whose job is to see the real response", () => {
    const result = lintIr({ ...input([stub(), visit, TITLE]), mode: "probe" });

    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/probe/i);
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

describe("what the ordering rule must NOT refuse", () => {
  const secondVisit: IrStep = { id: "go2", visit: { path: "/apps/cockpit/index.html#/other" } };

  it("allows a second page's stubs to sit between the two visits", () => {
    // The stricter reading of this rule - "every intercept before the first visit" - refused
    // this, which is a legitimate and ordinary flow. A linter that spends a turn telling the
    // model to break working code is worse than one rule short.
    const result = lintIr(
      input([stub(), visit, { ...stub(), id: "stub-2" }, secondVisit, TITLE])
    );

    expect(result.errors).toEqual([]);
  });

  it("allows a stub for traffic a later click triggers", () => {
    const result = lintIr(
      input([
        visit,
        { ...stub(), id: "stub-lazy" },
        {
          id: "expand",
          click: {
            target: {
              resolved: "cy.get('[data-cy=\"c8y-title--title-outlet\"]')",
              fromRow: "page#0",
            },
          },
        },
        TITLE,
      ])
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
