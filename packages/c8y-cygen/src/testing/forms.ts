/**
 * A form, as a probe would have observed one.
 *
 * B0 and B1 are both read-only flows plus clicks, so neither fixture carries a control anything
 * could be put into - which is the same blind spot the oracle selection had, one layer down. The
 * `fill` verb needs a `<select>`, a checkbox, a radio, a file input and something that only
 * looks like a control, and it needs them from the same reduction a real probe runs.
 *
 * Built out of raw nodes and through `rowsFromRawNodes`, for the reason B0's fixture is: facts
 * hand-written beside the code that makes them drift from what a probe actually produces.
 */
import { rowsFromRawNodes, type RawNode } from "../probe/rawNodes.js";
import { b0Facts } from "./b0.js";
import type { CandidateRow, FactsDocument } from "../facts/types.js";

export const FORM_SURFACE = "widget-config";

/** The option text the fixture's select is asked for. It is in B0's contract, so it anchors. */
export const FORM_SELECT_VALUE = "c8y_LocationUpdate";

function node(i: number, parent: number, tag: string, over: Partial<RawNode> = {}): RawNode {
  return {
    i,
    parent,
    tag,
    attrs: {},
    classes: [],
    text: "",
    visibility: "visible",
    ...over,
  };
}

/**
 * Every element `chooseFillCall` has an opinion about, plus one that only looks like a control.
 *
 * Each carries its own `data-cy`, so the ladder resolves each to `cy.get('[data-cy="..."]')` at
 * rung 1 and a test can name the emitted selector exactly. That is a property of the fixture,
 * not an assumption about the ladder - `resolveSelector` is still what produces it.
 */
const FORM_NODES: RawNode[] = [
  node(0, -1, "c8y-widget-config"),
  node(1, 0, "input", {
    attrs: { "data-cy": "config--title", type: "text" },
    value: "Asset Properties",
  }),
  node(2, 0, "select", { attrs: { "data-cy": "config--render-type" } }),
  node(3, 0, "input", { attrs: { "data-cy": "config--show-label", type: "checkbox" } }),
  node(4, 0, "input", { attrs: { "data-cy": "config--kind", type: "radio" } }),
  node(5, 0, "input", { attrs: { "data-cy": "config--upload", type: "file" } }),
  node(6, 0, "textarea", { attrs: { "data-cy": "config--notes" } }),
  // A custom control that is a div wearing a select's clothes. The one shape ticket 18 names as
  // able to falsify the one-verb argument, so the fixture carries it rather than assuming it away.
  node(7, 0, "div", { attrs: { "data-cy": "config--fake-select" }, text: "Linear" }),
  node(8, 0, "input", {
    attrs: { "data-cy": "config--drawer-name", type: "text" },
    visibility: "hidden",
  }),
];

export const FORM_ROWS = {
  title: `${FORM_SURFACE}#1`,
  renderType: `${FORM_SURFACE}#2`,
  showLabel: `${FORM_SURFACE}#3`,
  kind: `${FORM_SURFACE}#4`,
  upload: `${FORM_SURFACE}#5`,
  notes: `${FORM_SURFACE}#6`,
  fakeSelect: `${FORM_SURFACE}#7`,
  hiddenName: `${FORM_SURFACE}#8`,
} as const;

export function formRows(): CandidateRow[] {
  return rowsFromRawNodes(FORM_SURFACE, FORM_NODES);
}

export function formRow(id: string): CandidateRow {
  const row = formRows().find((r) => r.id === id);
  if (!row) throw new Error(`no such fixture row: ${id}`);
  return row;
}

/** The emitted selector the ladder derives for a fixture row, so a test names one thing once. */
export function formSelector(id: string): string {
  const dataCy = formRow(id).attrs.dataCy as string;
  return `cy.get('[data-cy="${dataCy}"]')`;
}

/** B0's facts with the form surface appended, so an IR can cite both. */
export function factsWithForm(): FactsDocument {
  const facts = b0Facts();
  return {
    ...facts,
    surfaces: [
      ...facts.surfaces,
      {
        label: FORM_SURFACE,
        within: "c8y-widget-config",
        observedAt: "2026-09-09T09:00:03.000Z",
        rows: formRows(),
      },
    ],
  };
}
