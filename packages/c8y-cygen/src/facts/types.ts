/**
 * What a probe run leaves behind. An ephemeral cached artifact, never committed.
 *
 * One document per probe run, with each collected surface individually cache-keyed. Per-run
 * keying is the expensive kind of wrong: change step 9 and you discard facts for steps 1-8
 * that you already paid for and that did not change.
 *
 * A probe that dies partway still returns what it already collected, so this document must be
 * valid when incomplete. That is normal, not exceptional, and it is why a wrong provisional
 * guess costs progress rather than the run.
 */

/** Three in-page states. Not in the page at all is expressed by the row not existing. */
export type Visibility = "visible" | "hidden" | "clipped";

/**
 * One ancestor, already reduced to a short descriptor. Each row carries its own ancestor
 * list, so the ladder searches rows and never needs a tree - and no DOM is ever shown to a
 * model.
 */
export interface AncestorDescriptor {
  tag: string;
  /**
   * The element's index in the probe's payload. Two rows' ancestor spines are lists of
   * descriptors, and descriptors cannot be compared for sameness - so without this there is no
   * way to ask whether two rows share an ancestor, which is the whole of ticket 17's anchored
   * scope rung. Written node-side from the raw `i`/`parent` pairs; nothing new crosses the
   * browser boundary. Absent on a hand-built descriptor, and a spine with no identity simply
   * offers no hop.
   */
  node?: number;
  dataCy?: string;
  id?: string;
  classes?: string[];
  /** Trimmed and truncated; feeds the cy.contains(tag, text) idiom. */
  text?: string;
}

/**
 * The ladder's whole attribute vocabulary. An attribute absent from here is invisible to the
 * ladder by construction, which is how the ban list is enforced rather than merely documented:
 * `[c8yicon]`, any `ng-*`, `:nth-child`, `[value]` and `[href]` have no field to arrive in.
 */
export interface RowAttrs {
  dataCy?: string;
  name?: string;
  formControlName?: string;
  id?: string;
  role?: string;
  ariaLabel?: string;
  title?: string;
  placeholder?: string;
  /** Refinement only. It may narrow a part; it may never be a part. */
  type?: string;
}

export interface CandidateRow {
  /**
   * Stable identity, written by the probe, unique within the facts document. A provisional's
   * match is recorded now and resolved later across a stateless session boundary, so the row
   * cannot be identified by position in an array.
   */
  id: string;
  ancestors: AncestorDescriptor[];
  tag: string;
  attrs: RowAttrs;
  classes: string[];
  text: string;
  /**
   * What the element holds, for an element that holds something - an input, a textarea, a
   * select. Deliberately **not** in `RowAttrs`.
   *
   * `[value]` is banned as a selector part and stays banned: it holds data, and data changes.
   * Ticket 07 enforced that ban by giving the value no field to arrive in anywhere, and that
   * reached past *selection* into *observation*. They are different questions. A selector may
   * never be written against a value; the model must still be able to see that an element holds
   * one, or `extract: "value"` can never be justified by a fact - which is 100 assertions across
   * 36 of the corpus's 214 specs, and the reason B1 asserted a device name that was on the
   * screen and in none of its 293 post-save rows.
   *
   * Keeping it out of `RowAttrs` is what keeps the selector ban structural: `RowAttrs` is the
   * ladder's whole vocabulary, and the ladder cannot reach a field that is not in it.
   *
   * Dropped whole rather than clipped when it is too long to assert on, the same rule an
   * observed response body follows: a clipped value read back as an equality is a lie.
   */
  value?: string;
  visibility: Visibility;
  /** The one judgement the model's summary carries. */
  actionable: boolean;
  /** A position is legal only inside a repeating list. The probe measures this; nobody guesses it. */
  repeat: { siblingsLike: number; index: number };
}

/** One custom element the page carries, and how many of it there are. */
export interface PageComponent {
  tag: string;
  count: number;
}

/** The elements one collect point gathered, bounded by its `within`. */
export interface CollectedSurface {
  label: string;
  within: string | null;
  observedAt: string;
  rows: CandidateRow[];
  /**
   * True when `within` matched nothing. The surface is then empty rather than absent: a scope is
   * a guess, and a guess that misses has to cost its own rows and nothing else.
   */
  scopeMissed?: boolean;
  /** Written only on a miss: what the page's components are actually called. */
  pageComponents?: PageComponent[];
}

/**
 * What a provisional selector actually matched. The probe holds the element at the moment it
 * acts on it, so recording this costs nothing - and it is what turns selector resolution from
 * a check into a construction.
 */
export interface ProvisionalMatch {
  stepId: string;
  matchCount: number;
  /** The surface the matched row belongs to, when the probe could place it. */
  surfaceLabel: string | null;
  row: CandidateRow | null;
}

/**
 * One network exchange the probe watched, and the anchor a stub is derived from.
 *
 * Ticket 02's rule 3 is that a fabricated response body must be *derived by recorded mutation
 * from a response the probe actually observed*. That rule needs somewhere for the observation
 * to live, and this is it - which is why the body is here and was not before. Without a real
 * body on hand, every stub the model could write would be invented from nothing, and the rule
 * would be unenforceable rather than merely unenforced.
 */
export interface ObservedRequest {
  /**
   * Stable identity within the facts document, written by the probe. A stub names one of these
   * in `fromRequest`, the same way a selector names a candidate row - and for the same reason:
   * the reference crosses a stateless session boundary, so it cannot be a position in an array.
   */
  id: string;
  method: string;
  url: string;
  /** The path alone, with the origin and the query string taken off. */
  pathname: string;
  /**
   * The query string, already parsed.
   *
   * This is the field B1 exists to exercise. Cockpit resolves a group's dashboards with a
   * `$filter=((has('c8y_Dashboard!group!<id>')) or ...)` expression, and an intercept keyed on
   * it must reproduce that string exactly or it never fires and the page loads empty. Nobody
   * can guess it. Recording it is the only way the model ever gets it right.
   */
  query?: Record<string, string>;
  status: number;
  /** Present only for a 201 with an id in the body: the dynamic half of the run manifest. */
  createdId?: string;
  /** The response body as the probe saw it, parsed. Absent when the response carried none. */
  body?: unknown;
  /**
   * Set when the body was over the size cap and was dropped rather than recorded in part.
   * Dropped, not clipped: half a body is not a body a stub may derive from, and a truncated
   * JSON document that still parses is the worst of the available outcomes.
   */
  bodyDropped?: boolean;
}

export interface FactsDocument {
  version: 1;
  runId: string;
  tenantUrl: string;
  appVersion: string | null;
  surfaces: CollectedSurface[];
  provisionalMatches: ProvisionalMatch[];
  requests: ObservedRequest[];
  /**
   * Exchanges the browser saw past its per-flush cap and did not record. Reported for the same
   * reason `bodyDropped` is: without it, the one exchange a stub needs can be missing with no
   * way to tell truncation from a call the application never made - and the model, told the
   * exchange was never observed, re-probes and truncates identically.
   */
  exchangesDropped?: number;
  /** false when the probe died before its last collect point. Valid, just partial. */
  complete: boolean;
}

export function emptyFacts(runId: string, tenantUrl: string): FactsDocument {
  return {
    version: 1,
    runId,
    tenantUrl,
    appVersion: null,
    surfaces: [],
    provisionalMatches: [],
    requests: [],
    complete: false,
  };
}

export function findRow(facts: FactsDocument, rowId: string): CandidateRow | undefined {
  for (const s of facts.surfaces) {
    const hit = s.rows.find((r) => r.id === rowId);
    if (hit) return hit;
  }
  for (const m of facts.provisionalMatches) {
    if (m.row?.id === rowId) return m.row;
  }
  return undefined;
}

export function findSurfaceOf(
  facts: FactsDocument,
  rowId: string
): CollectedSurface | undefined {
  return facts.surfaces.find((s) => s.rows.some((r) => r.id === rowId));
}

export function findRequest(
  facts: FactsDocument,
  requestId: string
): ObservedRequest | undefined {
  return facts.requests.find((r) => r.id === requestId);
}
