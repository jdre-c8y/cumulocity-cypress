/**
 * Ticket 17 finding 2, from B2's first run: the anchored rungs will anchor on live data.
 *
 * Both the leaf (ticket 18 Q2) and the hop (ticket 17 finding 2) reach for whatever text makes a
 * row unique, and a probe walks the application unstubbed - so the text they reach for can be
 * `13 Sept 2026 22:24:36` as readily as `e2eSeries`. The first is live tenant data and cannot
 * survive the crossing into a spec run against a stubbed fixture; the second is what a human
 * wrote in the contract. Nothing before this told the two apart.
 *
 * `isTraceable` is the answer, and it is the same rule `isAnchoredLiteral` already applies to a
 * fabricated stub body: did this text come from what a human wrote down. Most tests in this
 * package are silent about it, because they exercise rungs that have nothing to do with
 * anchoring - see the last describe below for why that is safe.
 */
import { resolveSelector, emitPath } from "./ladder.js";
import { row } from "../testing/rows.js";
import { rowsFromRawNodes } from "../probe/rawNodes.js";
import { find } from "../testing/rawNodes.js";
import { SERIES_NODES } from "../testing/datapointSeriesNodes.js";
import type { CandidateRow } from "../facts/types.js";

describe("anchoring a leaf requires the text to be traceable", () => {
  // The same prefix pair ticket 18 Q2 was built for: nothing but an anchored matcher resolves
  // either row on its own.
  const rows: CandidateRow[] = [
    row("s#0", { tag: "span", text: "e2eSeries" }),
    row("s#1", { tag: "span", text: "e2eSeries2" }),
  ];

  it("anchors when the predicate says the text was written down", () => {
    const r = resolveSelector(rows[0] as CandidateRow, rows, { exactly: 1 }, () => true);

    expect(r.ok).toBe(true);
    expect(r.ok && emitPath(r)).toBe("cy.contains('span', /^\\s*e2eSeries\\s*$/)");
  });

  it("refuses rather than anchor on a text the predicate does not recognise", () => {
    const r = resolveSelector(rows[0] as CandidateRow, rows, { exactly: 1 }, () => false);

    expect(r.ok).toBe(false);
  });

  // `e2eSeries2` is contained in nothing, so nothing forces a regex for it - it resolves plainly
  // regardless of what the predicate says, exactly as in anchoredText.spec.ts. The predicate has
  // no veto over a text that never needed anchoring in the first place; it only gets a say once
  // the ladder reaches for the anchored form, which is the case for `e2eSeries` alone here.
  it("has no say over a text that resolves without anchoring", () => {
    const rejectsEverything = () => false;

    const r = resolveSelector(rows[1] as CandidateRow, rows, { exactly: 1 }, rejectsEverything);

    expect(r.ok).toBe(true);
    expect(r.ok && emitPath(r)).toBe("cy.contains('span', 'e2eSeries2')");
  });
});

describe("the gate travels through the hop (ticket 17 finding 2's anchor)", () => {
  // B2's datapoint selector list, exactly as in anchoredScope.spec.ts: two series on one
  // fragment, told apart only by the label text, each in its own list item with its own
  // render-type select.
  const rows = rowsFromRawNodes("config", SERIES_NODES);

  it("composes the hop with the anchored leaf when the label is traceable", () => {
    const r = resolveSelector(find(rows, "config#4"), rows, { exactly: 1 }, () => true);

    expect(r.ok).toBe(true);
    expect(r.ok && emitPath(r)).toBe(
      "cy.contains('span', /^\\s*e2eSeries\\s*$/)" +
        ".closest('c8y-datapoint-selector-list-item')" +
        ".find('select[formcontrolname=\"renderType\"]')"
    );
  });

  // This is B2's actual defect, reproduced at the size of a unit test: the label is the anchor
  // ticket 17 finding 2 reaches for, and if it cannot be traced to the contract - a timestamp,
  // rather than `e2eSeries` - the anchor must not resolve, which is what excludes it from the
  // hop's candidate list. Neither series' select is itself part of a repeating group by the
  // ladder's own rule (each is the only `select` under its own list item), so there is no
  // position to fall through to here, and the honest answer is a refusal instead of a selector
  // pinned to data that will not be there when the spec runs stubbed.
  it("refuses the hop rather than emit a selector pinned to an untraceable label", () => {
    const r = resolveSelector(find(rows, "config#4"), rows, { exactly: 1 }, () => false);

    expect(r.ok).toBe(false);
  });
});

describe("the default admits every text", () => {
  // Almost every other test in this package calls `resolveSelector` with three arguments,
  // because it is exercising a rung with nothing to do with anchoring and has no contract to
  // check a text against. `lintIr.ts` is the one caller that verifies a real spec, and it always
  // supplies `(text) => isAnchoredLiteral(text, contract)`.
  it("still anchors when isTraceable is omitted, exactly as before this rung existed", () => {
    const rows: CandidateRow[] = [
      row("s#0", { tag: "span", text: "e2eSeries" }),
      row("s#1", { tag: "span", text: "e2eSeries2" }),
    ];

    const r = resolveSelector(rows[0] as CandidateRow, rows, { exactly: 1 });

    expect(r.ok).toBe(true);
    expect(r.ok && emitPath(r)).toBe("cy.contains('span', /^\\s*e2eSeries\\s*$/)");
  });
});
