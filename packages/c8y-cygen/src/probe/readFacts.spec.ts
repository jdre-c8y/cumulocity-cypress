import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FactsError,
  parsePayload,
  rankRows,
  readFacts,
  summariseFacts,
} from "./readFacts.js";
import { rowsFromRawNodes, type RawNode } from "./rawNodes.js";
import { findRequest, findRow } from "../facts/types.js";

function node(over: Partial<RawNode> & Pick<RawNode, "i" | "parent" | "tag">): RawNode {
  return {
    attrs: {},
    classes: [],
    text: "",
    visibility: "visible",
    ...over,
  };
}

const DETAIL_NODES: RawNode[] = [
  // Own text, which is what the browser half reports: a wrapper whose children carry all the
  // text has none of its own.
  node({ i: 0, parent: -1, tag: "c8y-event-details", text: "" }),
  node({
    i: 1,
    parent: 0,
    tag: "div",
    attrs: { "data-cy": "c8y-event-details--type-wrapper" },
    text: "c8y_LocationUpdate",
  }),
  node({
    i: 2,
    parent: 0,
    tag: "div",
    attrs: { "data-cy": "event-details-custom-data" },
    text: "lat 52.534925",
  }),
];

function withTempDir(run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cygen-facts-"));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("the node boundary", () => {
  it("refuses a payload that does not match the schema", () => {
    // A malformed payload is the input to every downstream decision. Refusing it here is the
    // difference between a loud stop and a confidently wrong selector three modules later.
    expect(() =>
      parsePayload(JSON.stringify({ kind: "collect", label: "x" }), "x.json")
    ).toThrow(FactsError);
  });

  it("refuses an attribute the ladder must never see", () => {
    const smuggled = {
      kind: "collect",
      label: "x",
      observedAt: "now",
      nodes: [{ ...node({ i: 0, parent: -1, tag: "i" }), attrs: { c8yicon: "chevron" } }],
    };

    expect(() => parsePayload(JSON.stringify(smuggled), "x.json")).toThrow(/attrs/);
  });

  it("refuses text that is not JSON at all", () => {
    expect(() => parsePayload("<html>404</html>", "x.json")).toThrow(/not valid JSON/);
  });
});

describe("rowsFromRawNodes", () => {
  it("turns a reported subtree into candidate rows the ladder can search", () => {
    const rows = rowsFromRawNodes("event-detail", DETAIL_NODES);

    expect(rows.map((r) => r.id)).toEqual(["event-detail#1", "event-detail#2"]);
    expect(rows[0]?.attrs.dataCy).toBe("c8y-event-details--type-wrapper");
    expect(rows[0]?.ancestors).toEqual([{ tag: "c8y-event-details" }]);
  });

  it("does not offer the collect root as a target", () => {
    // It is the `within` the model already named, so nothing is learned by listing it.
    expect(rowsFromRawNodes("x", DETAIL_NODES).some((r) => r.tag === "c8y-event-details")).toBe(
      false
    );
  });

  it("works out own text on this side, where it is tested", () => {
    expect(rowsFromRawNodes("event-detail", DETAIL_NODES)[1]?.text).toBe("lat 52.534925");
  });
});

describe("readFacts", () => {
  it("assembles one document from the files a probe wrote, in write order", () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "001-collect.json"),
        JSON.stringify({
          kind: "collect",
          label: "events-page",
          within: "c8y-device-events",
          observedAt: "2026-09-09T09:00:00.000Z",
          nodes: DETAIL_NODES,
        })
      );
      fs.writeFileSync(
        path.join(dir, "002-provisional.json"),
        JSON.stringify({
          kind: "provisional",
          stepId: "open-first-event",
          label: "open-first-event",
          within: "c8y-device-events",
          observedAt: "2026-09-09T09:00:01.000Z",
          matchCount: 1,
          matchedIndex: 1,
          nodes: DETAIL_NODES,
        })
      );

      const facts = readFacts(dir, {
        runId: "r1",
        tenantUrl: "https://t.example",
        complete: true,
      });

      expect(facts.surfaces.map((s) => s.label)).toEqual([
        "events-page",
        "open-first-event",
      ]);
      expect(facts.provisionalMatches[0]?.row?.id).toBe("open-first-event#1");
      expect(facts.provisionalMatches[0]?.matchCount).toBe(1);
    });
  });

  it("is valid when incomplete, because a probe dying partway is normal", () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "001-collect.json"),
        JSON.stringify({
          kind: "collect",
          label: "events-page",
          within: "c8y-device-events",
          observedAt: "2026-09-09T09:00:00.000Z",
          nodes: DETAIL_NODES,
        })
      );

      const facts = readFacts(dir, { runId: "r1", tenantUrl: "https://t.example" });

      expect(facts.complete).toBe(false);
      expect(facts.surfaces).toHaveLength(1);
    });
  });

  it("accumulates across probe runs rather than letting a later one replace an earlier", () => {
    // The browser half restarts its file counter each run, so both runs write 001-collect.json.
    // Discarding facts already paid for that did not change is the expensive kind of wrong.
    withTempDir((dir) => {
      for (const [run, label] of [["probe-01", "events-page"], ["probe-02", "event-detail"]]) {
        fs.mkdirSync(path.join(dir, run as string), { recursive: true });
        fs.writeFileSync(
          path.join(dir, run as string, "001-collect.json"),
          JSON.stringify({
            kind: "collect",
            label,
            within: "x",
            observedAt: "now",
            nodes: DETAIL_NODES,
          })
        );
      }

      const facts = readFacts(dir, { runId: "r1", tenantUrl: "https://t" });

      expect(facts.surfaces.map((s) => s.label)).toEqual(["events-page", "event-detail"]);
    });
  });

  it("returns an empty document when the probe wrote nothing at all", () => {
    const facts = readFacts("/nowhere/at/all", { runId: "r1", tenantUrl: "https://t" });

    expect(facts.surfaces).toEqual([]);
  });
});

describe("rankRows", () => {
  it("puts what identifies a row ahead of the page chrome around it", () => {
    // Measured: a body-wide collect returned 399 rows and the model saw the first 60, which in
    // document order are wrappers and layout divs. The rows carrying a data-cy were past the cut.
    const rows = rowsFromRawNodes("x", [
      node({ i: 0, parent: -1, tag: "body" }),
      node({ i: 1, parent: 0, tag: "div", classes: ["wrapper"] }),
      node({ i: 2, parent: 0, tag: "div", classes: ["container"] }),
      node({ i: 3, parent: 0, tag: "button", attrs: { "data-cy": "save" }, text: "Save" }),
    ]);

    expect(rankRows(rows)[0]?.attrs.dataCy).toBe("save");
  });

  it("ranks a hidden row below a visible one that is otherwise alike", () => {
    const rows = rowsFromRawNodes("x", [
      node({ i: 0, parent: -1, tag: "body" }),
      node({ i: 1, parent: 0, tag: "div", attrs: { "data-cy": "a" }, visibility: "hidden" }),
      node({ i: 2, parent: 0, tag: "div", attrs: { "data-cy": "b" } }),
    ]);

    expect(rankRows(rows).map((r) => r.attrs.dataCy)).toEqual(["b", "a"]);
  });
});

describe("summariseFacts", () => {
  it("gives the model one short line per row and never the ancestor lists", () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "001-collect.json"),
        JSON.stringify({
          kind: "collect",
          label: "event-detail",
          within: "c8y-event-details",
          observedAt: "now",
          nodes: DETAIL_NODES,
        })
      );
      const summary = summariseFacts(
        readFacts(dir, { runId: "r1", tenantUrl: "https://t" })
      );

      expect(summary).toContain("event-detail#1  div  data-cy=c8y-event-details--type-wrapper");
      expect(summary).not.toContain("ancestors");
    });
  });
});

describe("a scope that matched nothing", () => {
  const MISS = {
    kind: "collect",
    label: "events-page",
    within: "c8y-tab-view",
    scopeMissed: true,
    pageComponents: [
      { tag: "c8y-events-list", count: 1 },
      { tag: "c8y-tabs-outlet", count: 1 },
      { tag: "c8y-nav-node", count: 12 },
    ],
    observedAt: "2026-09-11T20:21:00.000Z",
    nodes: [],
  };

  it("is a payload the boundary accepts", () => {
    expect(parsePayload(JSON.stringify(MISS), "x.json")).toMatchObject({ scopeMissed: true });
  });

  it("reads as an empty surface rather than as no surface at all", () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, "001-collect.json"), JSON.stringify(MISS));

      const facts = readFacts(dir, { runId: "r1", tenantUrl: "https://t.example" });

      expect(facts.surfaces).toHaveLength(1);
      expect(facts.surfaces[0]).toMatchObject({
        label: "events-page",
        within: "c8y-tab-view",
        scopeMissed: true,
        rows: [],
      });
    });
  });

  it("tells the model what the page carries, which is what the wrong guess was asking", () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, "001-collect.json"), JSON.stringify(MISS));
      const facts = readFacts(dir, { runId: "r1", tenantUrl: "https://t.example" });

      const summary = summariseFacts(facts);

      // Three probe runs of B0 guessed c8y-tab-view, then c8y-event-list, then c8y-tab-view
      // again, because a miss returned nothing to guess better from.
      expect(summary).toMatch(/NOTHING MATCHED THAT SCOPE/);
      expect(summary).toContain("c8y-events-list");
      expect(summary).toContain("c8y-nav-node x12");
    });
  });

  it("does not claim rows it never collected", () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, "001-collect.json"), JSON.stringify(MISS));
      const facts = readFacts(dir, { runId: "r1", tenantUrl: "https://t.example" });

      expect(summariseFacts(facts)).not.toMatch(/events-page#/);
    });
  });
});

describe("two collects that share a label", () => {
  const collect = (nodes: RawNode[]) => ({
    kind: "collect",
    label: "event-list",
    within: "c8y-events",
    observedAt: "2026-09-11T20:21:00.000Z",
    nodes,
  });

  // The scope element itself is never a row, so each fixture needs a child to carry one.
  const OLD = [
    node({ i: 0, parent: -1, tag: "c8y-events" }),
    node({ i: 1, parent: 0, tag: "li", attrs: { "data-cy": "stale" } }),
  ];
  const NEW = [
    node({ i: 0, parent: -1, tag: "c8y-events" }),
    node({ i: 1, parent: 0, tag: "li", attrs: { "data-cy": "fresh" } }),
  ];

  it("do not hand out the same row id twice", () => {
    // The re-probe rung re-collects the scope that failed, under the label the IR already
    // uses - so this is its normal case, not an edge one.
    withTempDir((dir) => {
      fs.mkdirSync(path.join(dir, "probe-01"));
      fs.mkdirSync(path.join(dir, "probe-02"));
      fs.writeFileSync(path.join(dir, "probe-01/001-collect.json"), JSON.stringify(collect(OLD)));
      fs.writeFileSync(path.join(dir, "probe-02/001-collect.json"), JSON.stringify(collect(NEW)));

      const facts = readFacts(dir, { runId: "r1", tenantUrl: "https://t.example" });
      const ids = facts.surfaces.flatMap((s) => s.rows.map((r) => r.id));

      expect(ids).toHaveLength(new Set(ids).size);
    });
  });

  it("keep both, because the earlier one may be a different state of the page", () => {
    withTempDir((dir) => {
      fs.mkdirSync(path.join(dir, "probe-01"));
      fs.mkdirSync(path.join(dir, "probe-02"));
      fs.writeFileSync(path.join(dir, "probe-01/001-collect.json"), JSON.stringify(collect(OLD)));
      fs.writeFileSync(path.join(dir, "probe-02/001-collect.json"), JSON.stringify(collect(NEW)));

      const facts = readFacts(dir, { runId: "r1", tenantUrl: "https://t.example" });

      expect(facts.surfaces.map((s) => s.label)).toEqual(["event-list", "event-list~2"]);
      expect(findRow(facts, "event-list#1")?.attrs.dataCy).toBe("stale");
      expect(findRow(facts, "event-list~2#1")?.attrs.dataCy).toBe("fresh");
    });
  });
});


describe("the network channel, which is what a stub is anchored to", () => {
  const exchange = {
    kind: "network" as const,
    label: "dashboard-resolve",
    observedAt: "2026-09-09T09:00:00.000Z",
    requests: [
      {
        method: "GET",
        url: "https://t.example.c8y.io/inventory/managedObjects?query=%24filter%3Dhas(x)&pageSize=1000",
        status: 200,
        body: { managedObjects: [{ id: "98765", name: "e2eWidgetDashboard" }] },
      },
    ],
  };

  it("records the query string already parsed, because nobody can guess a $filter", () => {
    // The one field B1 exists to exercise. Cockpit keys its dashboard lookup on a $filter
    // expression that an intercept must reproduce exactly; a near miss never fires and the
    // page loads empty, with no error anywhere. It is recorded because it cannot be derived.
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, "0.json"), JSON.stringify(exchange));
      const facts = readFacts(dir, { runId: "r", tenantUrl: "https://t.example.c8y.io" });

      expect(facts.requests).toHaveLength(1);
      expect(facts.requests[0]?.pathname).toBe("/inventory/managedObjects");
      expect(facts.requests[0]?.query).toEqual({
        query: "$filter=has(x)",
        pageSize: "1000",
      });
    });
  });

  it("keeps the response body, which is the thing rule 3 anchors a stub to", () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, "0.json"), JSON.stringify(exchange));
      const facts = readFacts(dir, { runId: "r", tenantUrl: "https://t.example.c8y.io" });

      expect(facts.requests[0]?.body).toEqual({
        managedObjects: [{ id: "98765", name: "e2eWidgetDashboard" }],
      });
    });
  });

  it("gives every exchange an id, so a stub can name one across a session boundary", () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, "0.json"), JSON.stringify(exchange));
      const facts = readFacts(dir, { runId: "r", tenantUrl: "https://t.example.c8y.io" });

      expect(facts.requests[0]?.id).toBe("dashboard-resolve#0");
      expect(findRequest(facts, "dashboard-resolve#0")).toBe(facts.requests[0]);
    });
  });

  it("carries a network payload with no nodes, which the schema used to require", () => {
    expect(() => parsePayload(JSON.stringify(exchange), "n.json")).not.toThrow();
  });

  it("drops an over-large body rather than recording half of one", () => {
    // Half a body is not a body a stub may derive from, and a clipped JSON document that still
    // parses is the worst available outcome: it anchors a stub to a fiction that looks observed.
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "0.json"),
        JSON.stringify({ ...exchange, requests: [{ ...exchange.requests[0], bodyDropped: true, body: undefined }] })
      );
      const facts = readFacts(dir, { runId: "r", tenantUrl: "https://t.example.c8y.io" });

      expect(facts.requests[0]?.bodyDropped).toBe(true);
      expect(facts.requests[0]?.body).toBeUndefined();
    });
  });
});

describe("showing the model what it may derive a stub from", () => {
  const facts = {
    version: 1 as const,
    runId: "r",
    tenantUrl: "https://t.example.c8y.io",
    appVersion: null,
    surfaces: [],
    provisionalMatches: [],
    complete: true,
    requests: [
      {
        id: "page.network#0",
        method: "GET",
        url: "https://t.example.c8y.io/inventory/managedObjects?query=%24filter%3Dhas(x)",
        pathname: "/inventory/managedObjects",
        query: { query: "$filter=has(x)" },
        status: 200,
        body: { managedObjects: [{ id: "1", name: "g" }] },
      },
      {
        id: "page.network#1",
        method: "GET",
        url: "https://t.example.c8y.io/big",
        pathname: "/big",
        status: 200,
        bodyDropped: true,
      },
    ],
  };

  it("lists each exchange by the id a stub names it with", () => {
    // Without this the model cannot write a stub at all: fromRequest has to name something, and
    // the summary is the only place it ever sees what was observed.
    const text = summariseFacts(facts);

    expect(text).toContain("page.network#0");
    expect(text).toContain("GET /inventory/managedObjects");
    // Deep enough to write a mutation path against: `managedObjects.0.name` needs the element's
    // own keys, which is one level below the array.
    expect(text).toContain("managedObjects: [1 x {id: str, name: str}]");
  });

  it("shows the query string, which is the half nobody can guess", () => {
    expect(summariseFacts(facts)).toContain("$filter=has(x)");
  });

  it("marks an exchange with no body as one no stub can derive from", () => {
    const text = summariseFacts(facts);

    expect(text).toMatch(/page\.network#1.*NO BODY/);
  });
});
