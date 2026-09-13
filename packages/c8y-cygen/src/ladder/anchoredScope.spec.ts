/**
 * Ticket 17 finding 2: the element identified by what sits next to it.
 *
 * The ladder's only compound form was *ancestor-with-its-own-descriptor -> leaf*. A third of the
 * corpus reaches an element by walking up from a neighbour instead - 238 chains in 71 of 214
 * specs - and neither oracle that needs it could be generated without this rung.
 *
 * The fixtures are built through `rowsFromRawNodes`, for the reason B0's and the form's are: the
 * rung turns on ancestor **identity**, and a hand-written ancestor spine is exactly the thing
 * that can drift from what a probe produces.
 */
import { resolveSelector, emitPath } from "./ladder.js";
import { rowsFromRawNodes, type RawNode } from "../probe/rawNodes.js";
import type { CandidateRow } from "../facts/types.js";

function node(i: number, parent: number, tag: string, over: Partial<RawNode> = {}): RawNode {
  return { i, parent, tag, attrs: {}, classes: [], text: "", visibility: "visible", ...over };
}

const find = (rows: CandidateRow[], id: string): CandidateRow => {
  const hit = rows.find((r) => r.id === id);
  if (!hit) throw new Error(`no such fixture row: ${id}`);
  return hit;
};

/**
 * B1's asset-selector chip, as the probe collected it. The chip carries a layout class and
 * nothing else, and the same class shows up in the second selector on the page - so no path of
 * the old shape identifies it. The button beside it carries a `data-cy`.
 */
const CHIP_NODES: RawNode[] = [
  node(0, -1, "c8y-asset-selector"),
  node(1, 0, "div", { classes: ["d-flex", "p-r-16"] }),
  node(2, 1, "button", { attrs: { "data-cy": "Asset selection" }, text: "Select asset" }),
  node(3, 1, "span", { classes: ["chip", "tag"] }),
  node(4, 0, "div", { classes: ["d-flex", "p-r-16"] }),
  node(5, 4, "button", { attrs: { "data-cy": "Group selection" }, text: "Select group" }),
  node(6, 4, "span", { classes: ["chip", "tag"] }),
];

/**
 * B2's datapoint selector list. Two series on one fragment, the second named for the first with
 * a `2` on the end, each in its own list item with its own render-type select. Nothing but the
 * label text tells the two items apart, which is why the anchor here is a rung-4 row.
 */
const series = (i: number, name: string): RawNode[] => [
  node(i, 0, "c8y-datapoint-selector-list-item"),
  node(i + 1, i, "div", { classes: ["d-flex"] }),
  node(i + 2, i + 1, "span", { classes: ["text-truncate"], text: name }),
  node(i + 3, i, "select", { attrs: { formcontrolname: "renderType" } }),
];

const SERIES_NODES: RawNode[] = [
  node(0, -1, "c8y-datapoint-selector"),
  ...series(1, "e2eSeries"),
  ...series(5, "e2eSeries2"),
];

describe("reaching an element by the neighbour that names it", () => {
  const rows = rowsFromRawNodes("config", CHIP_NODES);

  it("walks up to the anchor's own parent, which needs no descriptor", () => {
    const r = resolveSelector(find(rows, "config#3"), rows, { exactly: 1 });

    expect(r.ok).toBe(true);
    expect(r.ok && emitPath(r)).toBe(
      "cy.get('[data-cy=\"Asset selection\"]').parent().find('span.chip.tag')"
    );
  });

  // The rung exists because the old shape cannot do this, so the old shape has to have been
  // tried and failed. `span.chip.tag` alone matches both chips, and the only ancestor either
  // chip has is a layout div shared with the other one.
  it("is reached only after every ordinary path has failed", () => {
    // The same chip, alone on its surface: one part, no hop, no anchor.
    const alone = rowsFromRawNodes("config", CHIP_NODES.slice(0, 4));

    expect(resolveSelector(find(alone, "config#3"), alone, { exactly: 1 }).ok).toBe(true);
    expect(emitPath(resolveSelector(find(alone, "config#3"), alone, { exactly: 1 }) as never)).toBe(
      "cy.get('span.chip.tag')"
    );
  });
});

describe("reaching an element by a neighbour only its text names", () => {
  const rows = rowsFromRawNodes("config", SERIES_NODES);

  // B2's line, and the composition ticket 18 Q2 could not do alone: the anchored matcher picks
  // the label out of a prefix pair, and this rung walks out of the label to the list item that
  // holds it. The human wrote the same two moves as `cy.contains(item, name).find(select)`.
  it("anchors on a rung-4 text row and closes on the component that holds it", () => {
    const r = resolveSelector(find(rows, "config#4"), rows, { exactly: 1 });

    expect(r.ok).toBe(true);
    expect(r.ok && emitPath(r)).toBe(
      "cy.contains('span', /^\\s*e2eSeries\\s*$/)" +
        ".closest('c8y-datapoint-selector-list-item')" +
        ".find('select[formcontrolname=\"renderType\"]')"
    );
  });

  it("resolves the sibling with a plain matcher, because nothing forces a regex there", () => {
    const r = resolveSelector(find(rows, "config#8"), rows, { exactly: 1 });

    expect(r.ok && emitPath(r)).toBe(
      "cy.contains('span', 'e2eSeries2')" +
        ".closest('c8y-datapoint-selector-list-item')" +
        ".find('select[formcontrolname=\"renderType\"]')"
    );
  });
});

describe("what the rung refuses", () => {
  // A layout class is not an identity. Pinning a spec to `div.d-flex` is a flake with a green
  // tick on it, and the corpus's own `.closest()` arguments are never one.
  it("refuses a hop to an ancestor whose only descriptor is a layout class", () => {
    const nodes: RawNode[] = [
      node(0, -1, "c8y-panel"),
      node(1, 0, "div", { classes: ["d-flex"] }),
      node(2, 1, "div", { classes: ["inner"] }),
      node(3, 2, "button", { attrs: { "data-cy": "anchor" } }),
      node(4, 1, "span", { classes: ["chip"] }),
      node(5, 0, "div", { classes: ["d-flex"] }),
      node(6, 5, "span", { classes: ["chip"] }),
    ];
    const rows = rowsFromRawNodes("p", nodes);

    // `span.chip` matches two and both wear the same `div.d-flex` spine, so no ordinary path
    // resolves it. The hop out of the anchor lands one above the anchor's parent, and the only
    // thing that ancestor carries is the layout class.
    expect(resolveSelector(find(rows, "p#4"), rows, { exactly: 1 }).ok).toBe(false);
  });

  // `.closest()` stops at the FIRST matching ancestor. If a nearer one wears the same
  // descriptor, the emitted selector lands somewhere the ladder never measured.
  it("refuses when a nearer ancestor of the anchor wears the same descriptor", () => {
    const nodes: RawNode[] = [
      node(0, -1, "c8y-outer"),
      node(1, 0, "c8y-item"),
      node(2, 1, "c8y-item"),
      node(3, 2, "button", { attrs: { "data-cy": "anchor" } }),
      node(4, 1, "span", { classes: ["chip"] }),
      // A second nested pair, so the shadowing item is not itself a usable anchor.
      node(5, 0, "c8y-item"),
      node(6, 5, "c8y-item"),
      node(7, 5, "span", { classes: ["chip"] }),
    ];
    const rows = rowsFromRawNodes("n", nodes);

    expect(resolveSelector(find(rows, "n#4"), rows, { exactly: 1 }).ok).toBe(false);
  });

  // A hop is only as good as the thing it starts from. An anchor that matches two elements
  // makes `.parent()` ambiguous in a way no count downstream can detect.
  it("refuses an anchor that does not resolve to one element itself", () => {
    const nodes: RawNode[] = [
      node(0, -1, "c8y-outer"),
      node(1, 0, "c8y-item"),
      node(2, 1, "button", { classes: ["btn"] }),
      node(3, 1, "span", { classes: ["chip"] }),
      node(4, 0, "c8y-item"),
      node(5, 4, "button", { classes: ["btn"] }),
      node(6, 4, "span", { classes: ["chip"] }),
    ];
    const rows = rowsFromRawNodes("a", nodes);

    expect(resolveSelector(find(rows, "a#3"), rows, { exactly: 1 }).ok).toBe(false);
  });
});

describe("the count still decides", () => {
  it("refuses a hop whose scope holds more of the leaf than the step declared", () => {
    const nodes: RawNode[] = [
      node(0, -1, "c8y-outer"),
      // A bare div: it carries no descriptor of its own, so it is reachable only by walking up
      // from the anchor. That is the shape this rung is for.
      node(1, 0, "div"),
      node(2, 1, "button", { attrs: { "data-cy": "anchor" } }),
      node(3, 1, "span", { classes: ["chip"] }),
      node(4, 1, "span", { classes: ["chip"] }),
      node(5, 0, "span", { classes: ["chip"] }),
    ];
    const rows = rowsFromRawNodes("c", nodes);

    // The hop lands on the bare div, which holds two chips. A step declaring one gets a
    // refusal, and a step declaring two gets the hop.
    expect(resolveSelector(find(rows, "c#3"), rows, { exactly: 1 }).ok).toBe(false);
    expect(resolveSelector(find(rows, "c#3"), rows, { exactly: 2 }).ok).toBe(true);
    expect(
      emitPath(resolveSelector(find(rows, "c#3"), rows, { exactly: 2 }) as never)
    ).toBe("cy.get('[data-cy=\"anchor\"]').parent().find('span.chip')");
  });
});
