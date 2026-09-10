/**
 * The ladder: candidate rows plus a declared cardinality in, a path out - or a refusal.
 *
 * The primary key is uniqueness and the rung order is only a tie-break. This is a path search,
 * not a lookup: humans pick the shortest path that identifies the target and scope even when
 * the leaf is already top-rung, because a page holds three dashboard children.
 *
 * No model is in this loop. The probe records which row it matched; this turns that row into
 * the selector that lands in the spec, which is what makes a hallucinated selector impossible
 * rather than merely detectable.
 */
import type { AncestorDescriptor, CandidateRow } from "../facts/types.js";

/** A descriptor is either a CSS part or the `cy.contains(tag, text)` idiom. */
export type Descriptor = string | { tag: string; text: string };

/** How many elements a step declares it expects. Refusal fires on a mismatch against this. */
export type Cardinality = { exactly: number } | { atLeast: number };

export interface LadderHit {
  ok: true;
  /** Outermost first. */
  path: Descriptor[];
  /** Set only under the repeating-list rule. */
  position?: number;
  leafRung: number;
  scopeRung: number;
  via: string;
  cardinality: Cardinality;
  /** How many rows in the surface the path matches. */
  observed: number;
}

export interface LadderRefusal {
  ok: false;
  reason: string;
  cardinality: Cardinality;
}

export type LadderResult = LadderHit | LadderRefusal;

/** Only 13 of 6,834 host-app selectors have four parts or more. A fourth part asks a human. */
export const MAX_PARTS = 3;

/**
 * Never legal, at any rung. Recorded here for the reader; enforced by the row schema, which
 * has no field for any of them, so the ladder cannot see one even if a probe tried to record it.
 */
export const BANNED: Record<string, string> = {
  c8yicon: "v1 was burned here - the same icon field arrived in two different value shapes",
  "ng-*": "legacy AngularJS pages",
  ":nth-child": "humans use it 12 times in 7,402 selectors",
  value: "holds data, and data changes",
  href: "holds a URL, and URLs carry ids",
};

const isCustomTag = (t: string): boolean =>
  /^c8y/.test(t) || (t.includes("-") && !t.startsWith("ng-"));

interface Rung {
  n: number;
  id: string;
  of: (r: CandidateRow) => Descriptor | null;
}

/**
 * Rungs 3 and 4 are the correction the corpus forced: humans write `[name]` 398 times and
 * `[title]` 1,335, but `[role]` only 18. "Semantic role/label" named the wrong attributes.
 */
export const RUNGS: Rung[] = [
  { n: 1, id: "data-cy", of: (r) => (r.attrs.dataCy ? `[data-cy="${r.attrs.dataCy}"]` : null) },
  { n: 2, id: "custom-tag", of: (r) => (isCustomTag(r.tag) ? r.tag : null) },
  {
    n: 3,
    id: "stable-attr",
    of: (r) =>
      (r.attrs.name && `${r.tag}[name="${r.attrs.name}"]`) ||
      (r.attrs.formControlName &&
        `${r.tag}[formcontrolname="${r.attrs.formControlName}"]`) ||
      (r.attrs.id && `[id="${r.attrs.id}"]`) ||
      (r.attrs.role && `[role="${r.attrs.role}"]`) ||
      (r.attrs.ariaLabel && `[aria-label="${r.attrs.ariaLabel}"]`) ||
      null,
  },
  {
    n: 4,
    id: "human-text",
    of: (r) =>
      (r.attrs.title && `[title="${r.attrs.title}"]`) ||
      (r.attrs.placeholder && `${r.tag}[placeholder="${r.attrs.placeholder}"]`) ||
      (r.text ? { tag: r.tag, text: r.text } : null),
  },
  {
    n: 5,
    id: "tag-class",
    of: (r) => (r.classes.length ? `${r.tag}.${r.classes.join(".")}` : null),
  },
  // Rung 6, position, is not a descriptor. It is applied at the end, under the repeating-list rule.
];

const ancestorDescriptors = (a: AncestorDescriptor): string[] =>
  [
    a.dataCy ? `[data-cy="${a.dataCy}"]` : null,
    isCustomTag(a.tag) ? a.tag : null,
    a.id ? `[id="${a.id}"]` : null,
    a.classes?.length ? `${a.tag}.${a.classes.join(".")}` : null,
  ].filter((x): x is string => Boolean(x));

const leafDescriptors = (r: CandidateRow): Descriptor[] =>
  RUNGS.map((g) => g.of(r)).filter((x): x is Descriptor => x !== null);

function sameDescriptor(a: Descriptor, b: Descriptor): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.tag === b.tag && a.text === b.text;
}

const matchesRow = (d: Descriptor, r: CandidateRow): boolean =>
  typeof d === "string"
    ? leafDescriptors(r).some((x) => typeof x === "string" && x === d)
    : (!d.tag || d.tag === r.tag) && (!d.text || (r.text || "").includes(d.text));

const matchesAncestor = (d: Descriptor, a: AncestorDescriptor): boolean =>
  typeof d === "string"
    ? ancestorDescriptors(a).includes(d)
    : (!d.tag || d.tag === a.tag) && (!d.text || (a.text || "").includes(d.text));

/**
 * A row matches a path when the last descriptor matches the row itself and every earlier
 * descriptor matches an ancestor, in order. Uniqueness is measured against the collected
 * surface, never against the page - which is exactly as safe as the collect scope was wide.
 */
export function matchCount(path: Descriptor[], rows: CandidateRow[]): number {
  const leaf = path[path.length - 1];
  if (!leaf) return 0;
  const scopes = path.slice(0, -1);
  let n = 0;
  outer: for (const r of rows) {
    if (!matchesRow(leaf, r)) continue;
    let ai = 0;
    for (const s of scopes) {
      while (ai < r.ancestors.length && !matchesAncestor(s, r.ancestors[ai] as AncestorDescriptor))
        ai++;
      if (ai >= r.ancestors.length) continue outer;
      ai++;
    }
    n++;
  }
  return n;
}

interface ScopeCandidate {
  d: Descriptor;
  rung: number;
  depth: number;
}

function scopeCandidates(target: CandidateRow): ScopeCandidate[] {
  const structural = target.ancestors.flatMap((a, depth) =>
    ancestorDescriptors(a).map((d, j) => ({
      d: d as Descriptor,
      rung: j === 0 && a.dataCy ? 1 : 3,
      depth,
    }))
  );
  const textual = target.ancestors.flatMap((a, depth) =>
    a.text && isCustomTag(a.tag)
      ? [{ d: { tag: a.tag, text: a.text } as Descriptor, rung: 4, depth }]
      : []
  );
  return [...structural, ...textual];
}

function wanted(cardinality: Cardinality): number {
  return "exactly" in cardinality ? cardinality.exactly : cardinality.atLeast;
}

/**
 * Under `exactly: n` a path must match exactly n rows. Under `atLeast: n` it must match the
 * whole repeating group the target belongs to, and that group must be at least n - which is
 * what stops a generic path from over-matching its way to a green assertion.
 */
function acceptableCount(
  count: number,
  cardinality: Cardinality,
  target: CandidateRow
): boolean {
  if ("exactly" in cardinality) return count === cardinality.exactly;
  return count === target.repeat.siblingsLike && count >= cardinality.atLeast;
}

export function resolveSelector(
  target: CandidateRow,
  rows: CandidateRow[],
  cardinality: Cardinality
): LadderResult {
  const leaves = RUNGS.map((g) => ({ rung: g.n, id: g.id, d: g.of(target) })).filter(
    (x): x is { rung: number; id: string; d: Descriptor } => x.d !== null
  );

  if (leaves.length === 0) {
    return {
      ok: false,
      cardinality,
      reason: `row ${target.id}: the element carries no descriptor on any legal rung`,
    };
  }

  const scopes = scopeCandidates(target);
  const solutions: LadderHit[] = [];

  const consider = (path: Descriptor[], leafRung: number, scopeRung: number, via: string) => {
    const n = matchCount(path, rows);
    if (!acceptableCount(n, cardinality, target)) return;
    solutions.push({
      ok: true,
      path,
      leafRung,
      scopeRung,
      via,
      cardinality,
      observed: n,
    });
  };

  for (const leaf of leaves) {
    consider([leaf.d], leaf.rung, 0, leaf.id);
    for (const s1 of scopes) consider([s1.d, leaf.d], leaf.rung, s1.rung, leaf.id);
    for (const s1 of scopes) {
      for (const s2 of scopes) {
        if (s2.depth <= s1.depth) continue;
        consider([s1.d, s2.d, leaf.d], leaf.rung, s1.rung, leaf.id);
      }
    }
  }

  // Fewest parts, then highest leaf rung, then highest scope rung.
  solutions.sort(
    (a, b) =>
      a.path.length - b.path.length || a.leafRung - b.leafRung || a.scopeRung - b.scopeRung
  );
  const best = solutions[0];
  if (best) return best;

  // A position is legal only inside a repeating list - many neighbours sharing the element's
  // own leaf descriptor, measured by the probe. Humans use a position to pick one row out of
  // many rows, never to separate two different things that happen to look alike.
  if ("exactly" in cardinality && cardinality.exactly === 1 && target.repeat.siblingsLike > 1) {
    const group = target.repeat.siblingsLike;
    for (const leaf of leaves) {
      if (matchCount([leaf.d], rows) === group) {
        return {
          ok: true,
          path: [leaf.d],
          position: target.repeat.index,
          leafRung: leaf.rung,
          scopeRung: 0,
          via: `${leaf.id}+position`,
          cardinality,
          observed: group,
        };
      }
      for (const s1 of scopes) {
        if (matchCount([s1.d, leaf.d], rows) === group) {
          return {
            ok: true,
            path: [s1.d, leaf.d],
            position: target.repeat.index,
            leafRung: leaf.rung,
            scopeRung: s1.rung,
            via: `${leaf.id}+position`,
            cardinality,
            observed: group,
          };
        }
      }
    }
  }

  const observedByBestLeaf = Math.max(
    ...leaves.map((l) => matchCount([l.d], rows)),
    0
  );
  return {
    ok: false,
    cardinality,
    reason:
      `row ${target.id}: declared ${wanted(cardinality)}, observed ${observedByBestLeaf} - ` +
      `no path of ${MAX_PARTS} parts or fewer yields the declared cardinality, and this is not a repeating list`,
  };
}

const quote = (s: string): string => `'${s.replace(/'/g, "\\'")}'`;

/** The emitted call. Formatting is the repo's formatter's job, never this function's. */
export function emitPath(hit: LadderHit): string {
  const [first, ...rest] = hit.path;
  if (!first) return "";
  let out =
    typeof first === "object"
      ? `cy.contains(${quote(first.tag)}, ${quote(first.text)})`
      : `cy.get(${quote(first)})`;
  for (const p of rest) {
    out +=
      typeof p === "object"
        ? `.contains(${quote(p.tag)}, ${quote(p.text)})`
        : `.find(${quote(p)})`;
  }
  if (hit.position !== undefined) {
    out += hit.position === 0 ? ".first()" : `.eq(${hit.position})`;
  }
  return out;
}

/** The path as it appears in the IR and in a diagnostic: readable, and stable across sessions. */
export function pathToSelectorText(path: Descriptor[], position?: number): string {
  const parts = path.map((d) => (typeof d === "string" ? d : `${d.tag}:contains(${d.text})`));
  return position === undefined ? parts.join(" ") : `${parts.join(" ")} @${position}`;
}

export function samePath(a: Descriptor[], b: Descriptor[]): boolean {
  return a.length === b.length && a.every((d, i) => sameDescriptor(d, b[i] as Descriptor));
}
