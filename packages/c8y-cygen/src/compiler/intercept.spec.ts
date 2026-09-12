import { compile, type CompileInput } from "./compile.js";
import { CompileError } from "./emit.js";
import { b0Conventions } from "../testing/b0.js";
import type { FactsDocument } from "../facts/types.js";
import type { IrDocument, IrStep } from "../ir/types.js";

/** One observed exchange, of the shape the dashboard lookup really returns. */
const DASHBOARD_BODY = {
  managedObjects: [
    {
      id: "98765",
      name: "realDashboard",
      c8y_Dashboard: { children: {}, columns: 24 },
    },
  ],
  statistics: { pageSize: 1000, currentPage: 1 },
};

function facts(): FactsDocument {
  return {
    version: 1,
    runId: "fixture",
    tenantUrl: "https://t.example.c8y.io",
    appVersion: null,
    surfaces: [],
    provisionalMatches: [],
    complete: true,
    requests: [
      {
        id: "boot#0",
        method: "GET",
        url: "https://t.example.c8y.io/inventory/managedObjects?query=%24filter%3Dhas(x)&pageSize=1000",
        pathname: "/inventory/managedObjects",
        query: { query: "$filter=has(x)", pageSize: "1000" },
        status: 200,
        body: DASHBOARD_BODY,
      },
      {
        id: "boot#1",
        method: "GET",
        url: "https://t.example.c8y.io/inventory/managedObjects/12345",
        pathname: "/inventory/managedObjects/12345",
        status: 200,
        body: { id: "12345", name: "realGroup", type: "c8y_DeviceGroup" },
      },
      {
        id: "boot#2",
        method: "GET",
        url: "https://t.example.c8y.io/inventory/binaries/9",
        pathname: "/inventory/binaries/9",
        status: 200,
        bodyDropped: true,
      },
    ],
  };
}

function irWith(steps: IrStep[], vars: IrDocument["vars"] = {}): IrDocument {
  return {
    version: 1,
    meta: {
      contract: "cypress/e2e/x.scenario.md",
      suite: "Asset Properties Widget",
      title: "retains the configured device",
      style: "mocked",
    },
    vars,
    steps: [
      ...steps,
      { id: "go", visit: { path: "/apps/cockpit/index.html#/group/12345" } },
      {
        id: "see",
        settle: {
          target: { resolved: "cy.get('[data-cy=\"c8y-title--title-outlet\"]')", fromRow: "x#0" },
          state: "visible",
        },
      },
    ],
    outcomes: [{ id: 1, text: "the title shows the group", satisfiedBy: ["see"] }],
  };
}

function specOf(steps: IrStep[], vars: IrDocument["vars"] = {}): string {
  const input: CompileInput = {
    ir: irWith(steps, vars),
    mode: "spec",
    conventions: b0Conventions(),
    facts: facts(),
  };
  return compile(input).text;
}

describe("stub: the verb that fabricates, and the only one that can", () => {
  it("emits the house two-argument form for a method-and-url route", () => {
    const text = specOf([
      {
        id: "stub-group",
        stub: {
          route: { method: "GET", url: "/inventory/managedObjects/12345*" },
          fromRequest: "boot#1",
        },
      },
    ]);

    expect(text).toContain(
      "cy.intercept('GET', '/inventory/managedObjects/12345*', { id: '12345', name: 'realGroup', type: 'c8y_DeviceGroup' });"
    );
  });

  it("emits the object form when a query must be matched exactly", () => {
    // The reason B1 is the intercept tier. Cockpit keys its dashboard lookup on a $filter
    // expression, and a glob over the whole URL cannot say "this path, and this query exactly".
    const text = specOf([
      {
        id: "stub-dash",
        stub: {
          route: {
            pathname: "/inventory/managedObjects",
            query: { query: "$filter=has(x)", pageSize: "1000" },
          },
          fromRequest: "boot#0",
        },
      },
    ]);

    expect(text).toContain(
      "cy.intercept({ pathname: '/inventory/managedObjects', query: { query: '$filter=has(x)', pageSize: '1000' } },"
    );
  });

  it("takes the body from the observed exchange, so the model never writes one", () => {
    const text = specOf([
      {
        id: "stub-dash",
        stub: {
          route: { method: "GET", url: "/inventory/managedObjects*" },
          fromRequest: "boot#0",
        },
      },
    ]);

    expect(text).toContain("name: 'realDashboard'");
    expect(text).toContain("statistics: { pageSize: 1000, currentPage: 1 }");
  });

  it("splices a recorded mutation into the observed body, by path", () => {
    const text = specOf(
      [
        {
          id: "stub-dash",
          stub: {
            route: { method: "GET", url: "/inventory/managedObjects*" },
            fromRequest: "boot#0",
            mutations: [{ path: "managedObjects.0.name", value: { ref: "groupName" } }],
          },
        },
      ],
      { groupName: "e2eWidgetGroup" }
    );

    expect(text).toContain("name: groupName");
    expect(text).not.toContain("name: 'realDashboard'");
  });

  it("refuses a mutation whose path matches nothing in the observed body", () => {
    // Otherwise it is a silent no-op: the stub serves the unmutated body and the spec looks as
    // though the mutation took. That is the expensive kind of wrong - it fails at run time, on
    // a metered run, pointing nowhere near the IR.
    expect(() =>
      specOf([
        {
          id: "stub-dash",
          stub: {
            route: { method: "GET", url: "/x*" },
            fromRequest: "boot#0",
            mutations: [{ path: "managedObjects.0.nmae", value: "typo" }],
          },
        },
      ])
    ).toThrow(/managedObjects\.0\.nmae/);
  });

  it("refuses to derive a body from an exchange no probe observed", () => {
    expect(() =>
      specOf([
        {
          id: "stub-dash",
          stub: { route: { method: "GET", url: "/x*" }, fromRequest: "boot#99" },
        },
      ])
    ).toThrow(CompileError);
  });

  it("refuses to derive a body from an exchange whose body was dropped", () => {
    // Half a body is not a body. An exchange recorded without one anchors nothing.
    expect(() =>
      specOf([
        {
          id: "stub-bin",
          stub: { route: { method: "GET", url: "/x*" }, fromRequest: "boot#2" },
        },
      ])
    ).toThrow(/boot#2/);
  });

  it("emits an observed string literally, even when it carries a dollar-brace", () => {
    // An observed string is text a server sent, not a reference the model wrote. Running it
    // through the interpolator would turn a `$filter=` in a response into a template literal
    // reaching for a name that does not exist.
    const withDollar = facts();
    (withDollar.requests[1] as { body: unknown }).body = { name: "${groupName}" };
    const text = compile({
      ir: irWith(
        [
          {
            id: "s",
            stub: { route: { method: "GET", url: "/x*" }, fromRequest: "boot#1" },
          },
        ],
        { groupName: "real" }
      ),
      mode: "spec",
      conventions: b0Conventions(),
      facts: withDollar,
    }).text;

    // Quoted, so the spec holds the two characters the server sent. Never a template literal,
    // which would reach for the `groupName` the IR really does bind and splice in "real".
    expect(text).toContain("name: '${groupName}'");
    expect(text).not.toContain("`${groupName}`");
  });

  it("names its alias when it has one", () => {
    const text = specOf([
      {
        id: "stub-group",
        stub: {
          route: { method: "GET", url: "/inventory/managedObjects/12345*" },
          fromRequest: "boot#1",
          alias: "group",
        },
      },
    ]);

    expect(text).toMatch(/cy\.intercept\([^\n]*\)\.as\('group'\);/);
  });
});

describe("sync and waitFor: the waiting vocabulary", () => {
  it("aliases a route without fabricating anything", () => {
    const text = specOf([
      {
        id: "watch",
        sync: { route: { method: "GET", url: "/inventory/managedObjects*" }, alias: "objects" },
      },
    ]);

    expect(text).toContain("cy.intercept('GET', '/inventory/managedObjects*').as('objects');");
  });

  it("waits on one alias with a string and on several with a list", () => {
    const one = specOf([
      { id: "w", sync: { route: { url: "/a*" }, alias: "a" } },
      { id: "wait", waitFor: { aliases: ["a"] } },
    ]);
    const many = specOf([
      { id: "w1", sync: { route: { url: "/a*" }, alias: "a" } },
      { id: "w2", sync: { route: { url: "/b*" }, alias: "b" } },
      { id: "wait", waitFor: { aliases: ["a", "b"] } },
    ]);

    expect(one).toContain("cy.wait('@a');");
    expect(many).toContain("cy.wait(['@a', '@b']);");
  });
});

describe("the probe back-end and intercepts", () => {
  it("keeps a sync, which is a wait rather than a fiction", () => {
    const text = compile({
      ir: irWith([{ id: "w", sync: { route: { url: "/a*" }, alias: "a" } }]),
      mode: "probe",
      conventions: b0Conventions(),
      facts: facts(),
    }).text;

    expect(text).toContain("cy.intercept('/a*').as('a');");
  });

  it("drops a stub, because a probe that mocks observes its own fiction", () => {
    // The probe's whole job is to record what the real application returns. A probe that serves
    // a stubbed body records the stub - and every fact downstream is then contingent on itself.
    const text = compile({
      ir: irWith([
        { id: "s", stub: { route: { url: "/a*" }, fromRequest: "boot#1" } },
      ]),
      mode: "probe",
      conventions: b0Conventions(),
      facts: facts(),
    }).text;

    expect(text).not.toContain("realGroup");
    expect(text).toContain("probe: stub dropped (s)");
  });
});

describe("a negated assertion, which an outcome phrased as 'and not' needs", () => {
  const assertStep = (over: Record<string, unknown>): IrStep => ({
    id: "check",
    assert: {
      target: { resolved: "cy.get('.chip')", fromRow: "x#0" },
      extract: "text",
      compare: "includes",
      operand: "e2eWidgetGroup",
      ...over,
    } as IrStep["assert"],
  });

  it("negates each comparator in place rather than adding a comparator per negation", () => {
    expect(specOf([assertStep({ negate: true })])).toContain(
      "cy.get('.chip').should('not.contain.text', 'e2eWidgetGroup');"
    );
    expect(specOf([assertStep({ compare: "equals", negate: true })])).toContain(
      "cy.get('.chip').should('not.have.text', 'e2eWidgetGroup');"
    );
    expect(
      specOf([assertStep({ extract: "value", compare: "equals", negate: true })])
    ).toContain("cy.get('.chip').should('not.have.value', 'e2eWidgetGroup');");
  });

  it("negates the assertion and never the declared cardinality", () => {
    // The cardinality says how many elements the selector resolves to. Negating it would turn
    // "there are three of these, and none says X" into "there are not three of these", which
    // is a different claim and a passing one for the wrong reason.
    const text = specOf([
      assertStep({ negate: true, cardinality: { atLeast: 2 } }),
    ]);

    expect(text).toContain(
      "cy.get('.chip').should('have.length.at.least', 2).should('not.contain.text', 'e2eWidgetGroup');"
    );
  });

  it("refuses to negate a time-window comparison, which has no negative reading", () => {
    expect(() =>
      specOf([assertStep({ compare: "withinMinutesOfNow", operand: 3, negate: true })])
    ).toThrow(/withinMinutesOfNow/);
  });
});

describe("what a route string is allowed to be", () => {
  it("interpolates a bound name in a route, rather than emitting a literal dollar-brace", () => {
    // The v1 defect this package's emitInterpolated docblock exists to prevent, reappearing in
    // the one place that did not use it. A route carrying '${groupId}' as two literal characters
    // matches no URL any application asks for - and an intercept that never fires reports
    // nothing at all, so the page just loads against the real tenant.
    const text = specOf(
      [
        {
          id: "stub-group",
          stub: {
            route: { method: "GET", url: "/inventory/managedObjects/${groupId}*" },
            fromRequest: "boot#1",
          },
        },
      ],
      { groupId: "12345" }
    );

    expect(text).toContain("cy.intercept('GET', `/inventory/managedObjects/${groupId}*`,");
    expect(text).not.toContain("'/inventory/managedObjects/${groupId}*'");
  });

  it("interpolates inside the object form too, pathname and query alike", () => {
    const text = specOf(
      [
        {
          id: "stub-dash",
          sync: {
            route: {
              pathname: "/inventory/managedObjects/${groupId}",
              query: { query: "$filter=has('x!${groupId}')" },
            },
            alias: "objects",
          },
        },
      ],
      { groupId: "12345" }
    );

    expect(text).toContain("pathname: `/inventory/managedObjects/${groupId}`");
    expect(text).toContain("query: `$filter=has('x!${groupId}')`");
  });
});

describe("handing Cypress a body it cannot mistake for something else", () => {
  const withFragment = (fragment: string) => {
    const f = facts();
    (f.requests[1] as { body: unknown }).body = { id: "12345", [fragment]: "x" };
    return compile({
      ir: irWith([
        { id: "s", stub: { route: { method: "GET", url: "/x*" }, fromRequest: "boot#1" } },
      ]),
      mode: "spec",
      conventions: b0Conventions(),
      facts: f,
    }).text;
  };

  it("wraps an observed body that carries a StaticResponse key", () => {
    // Cypress decides between "this is the body" and "this is response metadata" by looking for
    // keys like body, headers, statusCode, delay and log. Cumulocity managed objects carry
    // arbitrary tenant-defined fragments, so a device with a `headers` fragment would be served
    // as a StaticResponse with an empty body - the route fires, returns nothing, and the spec
    // fails a long way from the stub.
    expect(withFragment("headers")).toContain("cy.intercept('GET', '/x*', { body: {");
    expect(withFragment("statusCode")).toContain("{ body: {");
    expect(withFragment("log")).toContain("{ body: {");
  });

  it("leaves an ordinary body bare, which is how the corpus writes it", () => {
    expect(withFragment("c8y_IsDevice")).toContain(
      "cy.intercept('GET', '/x*', { id: '12345', c8y_IsDevice: 'x' });"
    );
  });
});

describe("mutations that quietly lose one of themselves", () => {
  it("refuses two mutations on the same path", () => {
    // `new Map(mutations.map(...))` silently keeps the last. The first vanishes with no
    // diagnostic, and because the pending set still empties, the matches-nothing guard cannot
    // fire either - so the stub serves a body the IR does not describe.
    expect(() =>
      specOf([
        {
          id: "s",
          stub: {
            route: { method: "GET", url: "/x*" },
            fromRequest: "boot#1",
            mutations: [
              { path: "name", value: "first" },
              { path: "name", value: "second" },
            ],
          },
        },
      ])
    ).toThrow(/'name'/);
  });
});
