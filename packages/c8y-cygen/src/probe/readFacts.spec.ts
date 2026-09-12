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
import { findRow } from "../facts/types.js";

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

