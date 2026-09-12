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
  /** tenant URL + application version + the establishing IR prefix, plus a TTL backstop. */
  cacheKey: string;
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

export interface ObservedRequest {
  method: string;
  url: string;
  status: number;
  /** Present only for a 201 with an id in the body: the dynamic half of the run manifest. */
  createdId?: string;
}

export interface FactsDocument {
  version: 1;
  runId: string;
  tenantUrl: string;
  appVersion: string | null;
  surfaces: CollectedSurface[];
  provisionalMatches: ProvisionalMatch[];
  requests: ObservedRequest[];
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
