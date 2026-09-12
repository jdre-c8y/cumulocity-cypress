import { resolveSelector, emitPath, MAX_PARTS } from "./ladder.js";
import type { CandidateRow } from "../facts/types.js";

function row(id: string, over: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id,
    ancestors: [],
    tag: "div",
    attrs: {},
    classes: [],
    text: "",
    visibility: "visible",
    actionable: false,
    repeat: { siblingsLike: 1, index: 0 },
    ...over,
  };
}

/** The event detail panel B0 asserts against, as one probe would have collected it. */
const detailPanel: CandidateRow[] = [
  row("detail#0", {
    tag: "c8y-event-details",
    ancestors: [{ tag: "div", classes: ["card"] }],
  }),
  row("detail#1", {
    tag: "div",
    attrs: { dataCy: "c8y-event-details--source-wrapper" },
    text: "e2eDeviceToTestEvents1700000000000",
    ancestors: [{ tag: "c8y-event-details" }],
  }),
  row("detail#2", {
    tag: "div",
    attrs: { dataCy: "c8y-event-details--time-wrapper" },
    text: "2026-09-09T10:00:00Z",
    ancestors: [{ tag: "c8y-event-details" }],
  }),
  row("detail#3", {
    tag: "div",
    attrs: { dataCy: "event-details-custom-data" },
    text: "lat 52.534925 lng 17.582658",
    ancestors: [{ tag: "c8y-event-details" }],
  }),
  row("detail#4", {
    tag: "li",
    attrs: { dataCy: "event-details-custom-data-item" },
    text: "lat 52.534925",
    ancestors: [{ tag: "c8y-event-details" }, { tag: "ul" }],
    repeat: { siblingsLike: 2, index: 0 },
  }),
  row("detail#5", {
    tag: "li",
    attrs: { dataCy: "event-details-custom-data-item" },
    text: "lng 17.582658",
    ancestors: [{ tag: "c8y-event-details" }, { tag: "ul" }],
    repeat: { siblingsLike: 2, index: 1 },
  }),
];

describe("the ladder", () => {
  it("takes a one-part data-cy path when that alone is unique", () => {
    const r = resolveSelector(detailPanel[1] as CandidateRow, detailPanel, {
      exactly: 1,
    });

    expect(r.ok).toBe(true);
    expect(r.ok && r.path).toEqual(['[data-cy="c8y-event-details--source-wrapper"]']);
    expect(r.ok && emitPath(r)).toBe(
      "cy.get('[data-cy=\"c8y-event-details--source-wrapper\"]')"
    );
  });

  it("falls to the custom element tag when there is no data-cy", () => {
    const r = resolveSelector(detailPanel[0] as CandidateRow, detailPanel, {
      exactly: 1,
    });

    expect(r.ok && r.path).toEqual(["c8y-event-details"]);
    expect(r.ok && r.leafRung).toBe(2);
  });

  it("searches for the shortest unique path rather than reading one rung off the row", () => {
    // A rung-1 leaf that is not unique still needs a scope. The corpus does this constantly:
    // a data-cy leaf repeated across three dashboard children.
    const rows = [
      row("a#0", {
        attrs: { dataCy: "value" },
        ancestors: [{ tag: "c8y-dashboard-child", text: "Left" }],
      }),
      row("a#1", {
        attrs: { dataCy: "value" },
        ancestors: [{ tag: "c8y-dashboard-child", text: "Right" }],
      }),
    ];

    const r = resolveSelector(rows[0] as CandidateRow, rows, { exactly: 1 });

    expect(r.ok && r.path).toEqual([
      { tag: "c8y-dashboard-child", text: "Left" },
      '[data-cy="value"]',
    ]);
    expect(r.ok && emitPath(r)).toBe(
      "cy.contains('c8y-dashboard-child', 'Left').find('[data-cy=\"value\"]')"
    );
  });

  it("resolves an 'at least n' step to the whole repeating group and no position", () => {
    const r = resolveSelector(detailPanel[4] as CandidateRow, detailPanel, {
      atLeast: 1,
    });

    expect(r.ok && r.path).toEqual(['[data-cy="event-details-custom-data-item"]']);
    expect(r.ok && r.position).toBeUndefined();
  });

  it("uses a position when the rows are genuinely indistinguishable", () => {
    // A grid of rows sharing one leaf descriptor and one visible text. This is the shape the
    // corpus reserves .eq(n) for: picking one row out of many rows.
    const rows = [
      row("grid#0", {
        tag: "tr",
        attrs: { dataCy: "data-grid--row" },
        text: "Device",
        repeat: { siblingsLike: 2, index: 0 },
      }),
      row("grid#1", {
        tag: "tr",
        attrs: { dataCy: "data-grid--row" },
        text: "Device",
        repeat: { siblingsLike: 2, index: 1 },
      }),
    ];

    const r = resolveSelector(rows[1] as CandidateRow, rows, { exactly: 1 });

    expect(r.ok && r.position).toBe(1);
    expect(r.ok && emitPath(r)).toBe("cy.get('[data-cy=\"data-grid--row\"]').eq(1)");
  });

  it("emits .first() rather than .eq(0) for the first of a repeating list", () => {
    const rows = [
      row("grid#0", {
        tag: "tr",
        attrs: { dataCy: "data-grid--row" },
        text: "Device",
        repeat: { siblingsLike: 2, index: 0 },
      }),
      row("grid#1", {
        tag: "tr",
        attrs: { dataCy: "data-grid--row" },
        text: "Device",
        repeat: { siblingsLike: 2, index: 1 },
      }),
    ];

    const r = resolveSelector(rows[0] as CandidateRow, rows, { exactly: 1 });

    expect(r.ok && emitPath(r)).toBe("cy.get('[data-cy=\"data-grid--row\"]').first()");
  });

  it("prefers a unique text leaf over a position, which is where it parts company with a human", () => {
    // The oracle authors write .eq(n) on a list even when the row text would identify it. The
    // ladder does not: a position is the fallback after the search finds nothing unique. The
    // corpus audit measured this disagreement at 12.5% and accepted it - the ladder resolves
    // shorter, and shorter is what the score optimises for.
    const r = resolveSelector(detailPanel[5] as CandidateRow, detailPanel, { exactly: 1 });

    expect(r.ok && r.position).toBeUndefined();
    expect(r.ok && emitPath(r)).toBe("cy.contains('li', 'lng 17.582658')");
  });

  it("refuses a position for two different things that merely look alike", () => {
    // Same leaf descriptor, but the probe measured them as one-of-a-kind rather than a list.
    const rows = [
      row("b#0", { tag: "button", text: "OK" }),
      row("b#1", { tag: "button", text: "OK" }),
    ];

    const r = resolveSelector(rows[0] as CandidateRow, rows, { exactly: 1 });

    expect(r.ok).toBe(false);
  });

  it("reports a cardinality mismatch as declared-versus-observed, not as 'found 1'", () => {
    const r = resolveSelector(detailPanel[4] as CandidateRow, detailPanel, {
      exactly: 3,
    });

    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("declared 3");
    expect(!r.ok && r.reason).toContain("observed 2");
  });

  it("refuses an element carrying no descriptor on any legal rung", () => {
    const bare = row("c#0", { tag: "div" });

    const r = resolveSelector(bare, [bare], { exactly: 1 });

    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/no descriptor/);
  });

  it("never returns a path longer than the cap", () => {
    const deep = row("d#0", {
      tag: "span",
      classes: ["x"],
      ancestors: [
        { tag: "c8y-a" },
        { tag: "c8y-b" },
        { tag: "c8y-c" },
        { tag: "c8y-d" },
      ],
    });
    const twin = { ...deep, id: "d#1" };

    const r = resolveSelector(deep, [deep, twin], { exactly: 1 });

    expect(r.ok ? r.path.length <= MAX_PARTS : true).toBe(true);
  });

  it("measures uniqueness against the collected surface it was given, not the page", () => {
    // The same row is unique in a narrow surface and ambiguous in a wide one. That the emitted
    // selector is only as safe as the collect scope was wide is a property, not an accident.
    const narrow = [detailPanel[1] as CandidateRow];

    expect(resolveSelector(detailPanel[1] as CandidateRow, narrow, { exactly: 1 }).ok).toBe(
      true
    );
  });
});

describe("uniqueness measured over every descriptor a row could offer", () => {
  it("does not call a selector unique when another row carries it under a losing alternative", () => {
    // Rungs 3 and 4 pick one descriptor per row with `||`. A row with both `id` and `role`
    // yielded only `[id="z"]`, so counting `[role="tab"]` skipped it and answered 1 - and the
    // ladder emitted `cy.get('[role="tab"]')` for a page with two of them. The spec then failed
    // with "cy.get() found 2 elements", which is the failure the ladder exists to prevent.
    const target = row("panel#1", { attrs: { role: "tab" } });
    const sibling = row("panel#2", { attrs: { id: "z", role: "tab" } });

    const r = resolveSelector(target, [target, sibling], { exactly: 1 });

    expect(r.ok && emitPath(r)).not.toBe(`cy.get('[role="tab"]')`);
  });

  it("does not call a placeholder unique when another row hides it behind a title", () => {
    // Rung 4 prefers `title`, so the sibling's own descriptor list stopped there and its
    // identical placeholder was never counted.
    const target = row("field#1", { tag: "input", attrs: { placeholder: "Type a name" } });
    const sibling = row("field#2", {
      tag: "input",
      attrs: { title: "Name", placeholder: "Type a name" },
    });

    const r = resolveSelector(target, [target, sibling], { exactly: 1 });

    expect(r.ok && emitPath(r)).not.toBe(`cy.get('input[placeholder="Type a name"]')`);
  });

  it("still emits the rung each row prefers, so the chosen selector does not change", () => {
    const target = row("panel#1", { attrs: { id: "z", role: "tab" } });

    const r = resolveSelector(target, [target], { exactly: 1 });

    expect(r.ok && emitPath(r)).toBe(`cy.get('[id="z"]')`);
  });
});
