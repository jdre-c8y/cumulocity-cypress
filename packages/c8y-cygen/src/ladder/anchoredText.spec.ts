/**
 * Ticket 18 Q2: a text value that is a prefix of another text value on the same surface.
 *
 * `cy.contains` matches a substring, so `'e2eSeries'` also matches `'e2eSeries2'`. Ticket 07
 * measured two matches here and routed to assist, which was correct for an ambiguity it could
 * not resolve. This is the rung that resolves it: `cy.contains(sel, /^\s*e2eSeries\s*$/)`.
 *
 * The decision is deliberately narrow, and most of these tests are about the narrowness. Of the
 * corpus's 1611 `contains()` calls, 11 carry a regex - so a tool that reached for one by
 * preference would be writing a dialect. It fires where a measured containment forces it and
 * nowhere else, and the alternative it beats is `.first()`, which resolves the ambiguity by DOM
 * order: a property of the render, not of the test.
 *
 * The narrowest limit of all is the last describe here, and it was not in the decision. Cypress
 * tests a regex against the element's whole **subtree** text; a candidate row records the
 * element's **own** text. The two agree on a leaf and part company on a wrapper, so an anchored
 * matcher is a leaf move only - which leaves the target ticket 18 named for ticket 17's
 * anchored-scope rung rather than this one.
 */
import { resolveSelector, emitPath } from "./ladder.js";
import { MAX_TEXT } from "../probe/describeElement.js";
import { ancestor, row } from "../testing/rows.js";
import type { CandidateRow } from "../facts/types.js";

/**
 * B2's datapoint selector list, as one probe would have collected it: two series on the same
 * fragment, the second named for the first with a `2` on the end, each carrying its own label
 * and its own render-type select.
 */
const item = (text: string): ReturnType<typeof ancestor> =>
  ancestor("c8y-datapoint-selector-list-item", text);

const seriesList: CandidateRow[] = [
  row("cfg#1", {
    tag: "span",
    classes: ["text-truncate"],
    text: "e2eSeries",
    ancestors: [item("e2eSeries")],
  }),
  row("cfg#2", {
    tag: "select",
    attrs: { formControlName: "renderType" },
    ancestors: [item("e2eSeries")],
  }),
  row("cfg#3", {
    tag: "span",
    classes: ["text-truncate"],
    text: "e2eSeries2",
    ancestors: [item("e2eSeries2")],
  }),
  row("cfg#4", {
    tag: "select",
    attrs: { formControlName: "renderType" },
    ancestors: [item("e2eSeries2")],
  }),
];

describe("a text that is a prefix of another text on the same surface", () => {
  it("anchors the leaf rather than refusing", () => {
    const r = resolveSelector(seriesList[0] as CandidateRow, seriesList, { exactly: 1 });

    expect(r.ok).toBe(true);
    expect(r.ok && emitPath(r)).toBe("cy.contains('span', /^\\s*e2eSeries\\s*$/)");
  });

  // The `\s*` is not decoration. Cypress collapses runs of whitespace in the text it tests but
  // does not trim it, while a candidate row's text is trimmed - so `/^e2eSeries$/` against a
  // span written over three lines matches nothing, and the spec fails on a timeout rather than
  // on a count the ladder could have refused.
  it("tolerates the whitespace Cypress leaves on the text it tests", () => {
    const r = resolveSelector(seriesList[0] as CandidateRow, seriesList, { exactly: 1 });
    const emitted = r.ok ? emitPath(r) : "";
    const source = /\/(.+)\//.exec(emitted)?.[1] as string;

    expect(new RegExp(source).test(" e2eSeries ")).toBe(true);
    expect(new RegExp(source).test("e2eSeries2")).toBe(false);
  });

  // The containment runs one way. `e2eSeries2` is contained in nothing, so nothing forces a
  // regex for it, and it keeps the house-style plain string - on the same surface, in the same
  // run, for the sibling of the row that did need one.
  it("leaves the containing text alone, because nothing forces it", () => {
    const r = resolveSelector(seriesList[3] as CandidateRow, seriesList, { exactly: 1 });

    expect(r.ok && emitPath(r)).toBe(
      "cy.contains('c8y-datapoint-selector-list-item', 'e2eSeries2')" +
        ".find('select[formcontrolname=\"renderType\"]')"
    );
  });

  it("prefers any plain path to an anchored one, however much longer", () => {
    // A one-part regex would resolve this. A two-part plain path also resolves it, and 11
    // regexes in 1611 contains() calls is what the house writes.
    const rows = [
      row("t#1", { tag: "span", text: "Save", ancestors: [{ tag: "div", dataCy: "left" }] }),
      row("t#2", { tag: "span", text: "Saved", ancestors: [{ tag: "div", dataCy: "right" }] }),
    ];

    const r = resolveSelector(rows[0] as CandidateRow, rows, { exactly: 1 });

    expect(r.ok && emitPath(r)).toBe("cy.get('[data-cy=\"left\"]').contains('span', 'Save')");
  });

  // The rung it displaces. Two labels in a repeating list resolve today by DOM order, and DOM
  // order is a property of the render: reorder the series and `.first()` silently tests the
  // other one. An anchored matcher says which one it means.
  it("beats a position, rather than falling through to .first()", () => {
    const rows = [
      row("s#0", { tag: "span", text: "e2eSeries", repeat: { siblingsLike: 2, index: 0 } }),
      row("s#1", { tag: "span", text: "e2eSeries2", repeat: { siblingsLike: 2, index: 1 } }),
    ];

    const r = resolveSelector(rows[0] as CandidateRow, rows, { exactly: 1 });

    expect(r.ok && r.position).toBeUndefined();
    expect(r.ok && emitPath(r)).toBe("cy.contains('span', /^\\s*e2eSeries\\s*$/)");
  });

  // Offering the variant is not the same as accepting it. Where a third row repeats the target's
  // text exactly, the anchored matcher still measures two, and the refusal has to stand - or the
  // rung becomes a way of dressing an unresolved ambiguity as a resolved one.
  it("refuses when anchoring narrows the match but does not resolve it", () => {
    const rows = [
      row("s#0", { tag: "span", text: "e2eSeries" }),
      row("s#1", { tag: "span", text: "e2eSeries2" }),
      row("s#2", { tag: "span", text: "e2eSeries" }),
    ];

    expect(resolveSelector(rows[0] as CandidateRow, rows, { exactly: 1 }).ok).toBe(false);
  });

  it("escapes what a regex would otherwise read as syntax", () => {
    const rows = [
      row("u#0", { tag: "span", text: "Temperature (°C)" }),
      row("u#1", { tag: "span", text: "Temperature (°C) max." }),
    ];

    const r = resolveSelector(rows[0] as CandidateRow, rows, { exactly: 1 });

    expect(r.ok && emitPath(r)).toBe("cy.contains('span', /^\\s*Temperature \\(°C\\)\\s*$/)");
  });

  // A row's text is cut at 80 characters, and a cut text is a prefix of the real one - which is
  // the one thing an anchored matcher cannot survive. The plain form tolerates it, because a
  // prefix is still a substring of what the element holds.
  it("never anchors a text that may have been truncated", () => {
    const long = "Temperature reading for the device in the northern building, ground floor, series ";
    const rows = [
      row("v#0", { tag: "span", text: `${long}one`.slice(0, MAX_TEXT) }),
      row("v#1", { tag: "span", text: `${long}one and two`.slice(0, MAX_TEXT) }),
    ];

    expect(rows[0]?.text.length).toBe(MAX_TEXT);
    expect(resolveSelector(rows[0] as CandidateRow, rows, { exactly: 1 }).ok).toBe(false);
  });
});

describe("why an anchored matcher is a leaf move and not a scope one", () => {
  /**
   * Ticket 18 named `cy.contains('c8y-datapoint-selector-list-item', 'e2eSeries')` as the target
   * this rung exists for, and the target is out of its reach. Cypress tests a regex against the
   * element's whole subtree text; a candidate row records the element's own text, which for a
   * wrapper is a fraction of it. `/^\s*e2eSeries\s*$/` on a list item holding a label, a select
   * and its options matches **nothing**, and a spec that emitted it would fail on a timeout
   * rather than on a count the ladder could refuse.
   *
   * So the scope keeps refusing, which is what ticket 07 already did. What B2's target actually
   * needs is ticket 17's anchored-scope rung - reach the element that carries the text, then
   * walk out to the component that holds it - composed with this one at the leaf.
   */
  it("refuses the scope B2 names rather than emitting a matcher that matches nothing", () => {
    const r = resolveSelector(seriesList[1] as CandidateRow, seriesList, { exactly: 1 });

    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("declared 1");
  });
});
