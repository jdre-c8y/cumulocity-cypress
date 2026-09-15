/**
 * B2's datapoint selector list, as one probe would have collected it. Two series on one
 * fragment, the second named for the first with a `2` on the end, each in its own list item with
 * its own render-type select. Nothing but the label text tells the two items apart, which is why
 * the anchor here is a rung-4 row - and it is the fixture both ticket 17's hop
 * (anchoredScope.spec.ts) and ticket 19's traceability gate (anchorTraceability.spec.ts) measure
 * against, so it lives here rather than in either.
 */
import { node } from "./rawNodes.js";
import type { RawNode } from "../probe/rawNodes.js";

const series = (i: number, name: string): RawNode[] => [
  node(i, 0, "c8y-datapoint-selector-list-item"),
  node(i + 1, i, "div", { classes: ["d-flex"] }),
  node(i + 2, i + 1, "span", { classes: ["text-truncate"], text: name }),
  node(i + 3, i, "select", { attrs: { formcontrolname: "renderType" } }),
];

export const SERIES_NODES: RawNode[] = [
  node(0, -1, "c8y-datapoint-selector"),
  ...series(1, "e2eSeries"),
  ...series(5, "e2eSeries2"),
];
