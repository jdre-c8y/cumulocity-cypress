/**
 * One raw node, with everything the ladder does not care about already filled in.
 *
 * The rungs that turn on ancestor identity (the hop, ticket 17 finding 2) need fixtures built
 * through `rowsFromRawNodes`, never a hand-written ancestor spine - that identity is exactly the
 * thing a hand-written spine can drift from. This keeps the noise in one place, the way
 * `testing/rows.ts` does for a hand-built `CandidateRow`.
 */
import type { RawNode } from "../probe/rawNodes.js";
import type { CandidateRow } from "../facts/types.js";

export function node(i: number, parent: number, tag: string, over: Partial<RawNode> = {}): RawNode {
  return { i, parent, tag, attrs: {}, classes: [], text: "", visibility: "visible", ...over };
}

export function find(rows: CandidateRow[], id: string): CandidateRow {
  const hit = rows.find((r) => r.id === id);
  if (!hit) throw new Error(`no such fixture row: ${id}`);
  return hit;
}
