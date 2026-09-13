/**
 * One candidate row, with everything the ladder does not care about already filled in.
 *
 * The ladder's unit tests are about what distinguishes rows from each other, so every field a
 * given test is silent about is noise in the fixture. This keeps the noise in one place, and it
 * keeps two spec files from disagreeing about what an unremarkable row looks like.
 */
import type { AncestorDescriptor, CandidateRow } from "../facts/types.js";

export function row(id: string, over: Partial<CandidateRow> = {}): CandidateRow {
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

/** An ancestor the `cy.contains(tag, text)` idiom can scope by: a custom tag carrying text. */
export function ancestor(tag: string, text: string): AncestorDescriptor {
  return { tag, text };
}
