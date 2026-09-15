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
import { MAX_TEXT } from "../probe/describeElement.js";
import type { AncestorDescriptor, CandidateRow } from "../facts/types.js";

/**
 * The `cy.contains(tag, text)` idiom.
 *
 * `anchored` turns the emitted matcher from the string into `/^\s*text\s*$/`. Ticket 18 Q2:
 * Cypress matches a substring, so `'e2eSeries'` also matches `'e2eSeries2'` - and the
 * alternative to an anchored matcher is `.first()`, which resolves the ambiguity by DOM order.
 * Reorder the series and the test silently asserts against the other one.
 */
export interface TextDescriptor {
  tag: string;
  text: string;
  anchored?: true;
}

/** A descriptor is either a CSS part or the `cy.contains(tag, text)` idiom. */
export type Descriptor = string | TextDescriptor;

/** How many elements a step declares it expects. Refusal fires on a mismatch against this. */
export type Cardinality = { exactly: number } | { atLeast: number };

/**
 * A scope reached by walking up out of a neighbour, rather than down from an ancestor the target
 * describes by itself. Ticket 17 finding 2: a third of the corpus reaches an element this way -
 * 238 chains in 71 of 214 specs - and the ladder had no shape for it.
 */
export interface AnchoredScope {
  /** The emitted expression for the anchor row, which resolves to exactly one element. */
  anchor: string;
  /** The `.closest()` argument. Absent when the shared ancestor is the anchor's own parent. */
  closest?: string;
}

export interface LadderHit {
  ok: true;
  /** Outermost first. Just the leaf when `scope` carries the rest. */
  path: Descriptor[];
  /** Set only under the anchored-scope rung. */
  scope?: AnchoredScope;
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

/**
 * A person numbering fields by hand counts the things on the page. A framework allocating ids
 * counts every field it has ever rendered in the session, and renumbers on the next render.
 *
 * B1's fourth run was lost to the difference. The ladder derived `input[name="sf-name73"]`; it
 * passed after the first save cycle, and after the second the element did not exist, while the
 * screenshot showed the widget rendered correctly. The surface carried the allocator in plain
 * sight - `sf-id72`, `sf-name73`, `sf-type74`, `idStatus75`, `nameStatus77`, `typeStatus79`:
 * one counter running through six different stems.
 *
 * The threshold is measured rather than chosen. Of 846 `[name]`, `[formcontrolname]` and `[id]`
 * literals across the two corpora, 15 end in a digit - `groups0`, `apps0`, `stopSequence0`,
 * `stopSequence1`, `headerKey0`, `headerKey1`, `field1`, `field2` - and **every one of those
 * suffixes is 0 or 1**. The generated ones start at 72. Nothing human measured lands in
 * between, so the rule costs nothing that was ever observed and the slack is nine.
 *
 * Refusing the descriptor, not the row: the ladder falls through to the next rung, which for
 * B1's input is `[title="Name"]` - the label the form renders, which does not renumber.
 */
const ALLOCATED = /[^0-9](\d{2,})$/;

export function allocatedIdentifier(value: string): boolean {
  const m = ALLOCATED.exec(value);
  return m !== null && Number(m[1]) >= 10;
}

const stable = (value: string | undefined): string | undefined =>
  value !== undefined && allocatedIdentifier(value) ? undefined : value;

const isCustomTag = (t: string): boolean =>
  /^c8y/.test(t) || (t.includes("-") && !t.startsWith("ng-"));

interface Rung {
  n: number;
  id: string;
  /**
   * Every descriptor this rung could produce for a row, best first.
   *
   * A list rather than a winner, because two different questions are asked of a rung. Climbing
   * wants the one it would emit; counting wants all of them. Rungs 3 and 4 pick with `||`, so a
   * row carrying both `id` and `role` yields only `[id=...]` - and a count of `[role="tab"]`
   * that skipped such a row came back 1 for a selector matching two elements. The ladder then
   * emitted it as unique and the spec failed at run time with "cy.get() found 2 elements", which
   * is the failure the ladder exists to make impossible.
   */
  all: (r: CandidateRow) => Descriptor[];
}

const compact = (xs: (Descriptor | false | "" | null | undefined)[]): Descriptor[] =>
  xs.filter((x): x is Descriptor => Boolean(x));

/** What this rung would emit: the first alternative it can produce. */
const rungOf = (rung: Rung, r: CandidateRow): Descriptor | null => rung.all(r)[0] ?? null;

/**
 * Rungs 3 and 4 are the correction the corpus forced: humans write `[name]` 398 times and
 * `[title]` 1,335, but `[role]` only 18. "Semantic role/label" named the wrong attributes.
 */
export const RUNGS: Rung[] = [
  {
    n: 1,
    id: "data-cy",
    all: (r) => compact([r.attrs.dataCy && `[data-cy="${r.attrs.dataCy}"]`]),
  },
  { n: 2, id: "custom-tag", all: (r) => compact([isCustomTag(r.tag) && r.tag]) },
  {
    n: 3,
    id: "stable-attr",
    all: (r) =>
      compact([
        stable(r.attrs.name) && `${r.tag}[name="${r.attrs.name}"]`,
        stable(r.attrs.formControlName) &&
          `${r.tag}[formcontrolname="${r.attrs.formControlName}"]`,
        stable(r.attrs.id) && `[id="${r.attrs.id}"]`,
        r.attrs.role && `[role="${r.attrs.role}"]`,
        r.attrs.ariaLabel && `[aria-label="${r.attrs.ariaLabel}"]`,
      ]),
  },
  {
    n: 4,
    id: "human-text",
    all: (r) =>
      compact([
        r.attrs.title && `[title="${r.attrs.title}"]`,
        r.attrs.placeholder && `${r.tag}[placeholder="${r.attrs.placeholder}"]`,
        r.text ? { tag: r.tag, text: r.text } : null,
      ]),
  },
  {
    n: 5,
    id: "tag-class",
    all: (r) => compact([r.classes.length ? `${r.tag}.${r.classes.join(".")}` : null]),
  },
  // Rung 6, position, is not a descriptor. It is applied at the end, under the repeating-list rule.
];

const ancestorDescriptors = (a: AncestorDescriptor): string[] =>
  [
    a.dataCy ? `[data-cy="${a.dataCy}"]` : null,
    isCustomTag(a.tag) ? a.tag : null,
    stable(a.id) ? `[id="${a.id}"]` : null,
    a.classes?.length ? `${a.tag}.${a.classes.join(".")}` : null,
  ].filter((x): x is string => Boolean(x));

/** Every descriptor any rung could produce for this row - what a count must be measured over. */
const leafDescriptors = (r: CandidateRow): Descriptor[] => RUNGS.flatMap((g) => g.all(r));

function sameDescriptor(a: Descriptor, b: Descriptor): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.tag === b.tag && a.text === b.text && a.anchored === b.anchored;
}

/** Cypress's own matching rule, which is what uniqueness has to be measured under. */
const textMatches = (d: TextDescriptor, observed: string | undefined): boolean =>
  d.anchored ? (observed ?? "") === d.text : (observed ?? "").includes(d.text);

const matchesRow = (d: Descriptor, r: CandidateRow): boolean =>
  typeof d === "string"
    ? leafDescriptors(r).some((x) => typeof x === "string" && x === d)
    : (!d.tag || d.tag === r.tag) && (!d.text || textMatches(d, r.text));

const matchesAncestor = (d: Descriptor, a: AncestorDescriptor): boolean =>
  typeof d === "string"
    ? ancestorDescriptors(a).includes(d)
    : (!d.tag || d.tag === a.tag) && (!d.text || textMatches(d, a.text));

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

const isText = (d: Descriptor): d is TextDescriptor => typeof d === "object";

/**
 * Anchoring a text asserts that the text is the whole of what the element holds, so it can only
 * be offered for a text the probe recorded whole. A row's text is cut at `MAX_TEXT`, and a cut
 * text is a prefix of the real one - which is precisely what an anchored matcher cannot survive.
 * The plain form tolerates the cut, because a prefix is still a substring.
 */
const anchorable = (d: Descriptor): d is TextDescriptor =>
  isText(d) && d.text.length > 0 && d.text.length < MAX_TEXT;

const anchor = (d: TextDescriptor): TextDescriptor => ({ tag: d.tag, text: d.text, anchored: true });

/**
 * Whether a text is trustworthy enough to identify an element by, rather than merely well-formed
 * enough to anchor (that is `anchorable`, above - a different question).
 *
 * Ticket 17 finding 2's rung reaches for whatever text makes a neighbouring row unique, and a
 * probe walks the live tenant - so on B2's first run the text it reached for was a timestamp,
 * `13 Sept 2026 22:24:36`, which cannot survive the crossing into a spec run against a stubbed
 * fixture. The default admits everything, because almost every caller in this file's tests is
 * exercising a rung that has nothing to do with anchoring and has no contract to check against.
 * `lintIr.ts`, the one caller that verifies a real spec, always supplies
 * `(text) => isAnchoredLiteral(text, contract)` - the same rule a fabricated stub body is held
 * to, because "did a human write this down" is exactly as good a test here as it is there.
 */
type Traceable = (text: string) => boolean;
const ALWAYS_TRACEABLE: Traceable = () => true;

interface LeafCandidate {
  rung: number;
  id: string;
  d: Descriptor;
}

/** The ancestor node indices a row carries, outermost first. Empty for a hand-built row. */
const spineOf = (r: CandidateRow): number[] =>
  r.ancestors.map((a) => a.node).filter((n): n is number => n !== undefined);

/**
 * What `.closest()` may be given: rungs 1, 2 and 3 only.
 *
 * Never a class. Rung 5 would offer `div.d-flex.p-r-16.fit-w.m-t-4.m-b-4` for B1's chip, and
 * pinning a spec to a layout utility class is a flake with a green tick on it. Measured over the
 * corpus's 197 ancestor hops: 155 expressible under this rule, 42 refused, and the 42 are
 * exactly the `.d-flex` / `.row` / `.card` / `.form-group` arguments.
 */
function closestDescriptor(a: AncestorDescriptor): string | null {
  if (a.dataCy) return `[data-cy="${a.dataCy}"]`;
  if (isCustomTag(a.tag)) return a.tag;
  const id = stable(a.id);
  return id ? `[id="${id}"]` : null;
}

/** The deepest ancestor the two rows share, by node identity. */
function nearestShared(anchor: CandidateRow, target: CandidateRow): number | null {
  const targetNodes = new Set(spineOf(target));
  const anchorSpine = spineOf(anchor);
  for (let i = anchorSpine.length - 1; i >= 0; i--) {
    const n = anchorSpine[i] as number;
    if (targetNodes.has(n)) return n;
  }
  return null;
}

type Hop = { parent: true } | { closest: string };

/**
 * How far down the ladder an anchor may sit.
 *
 * Ticket 17 wrote rungs 1-3. Rung 4 was added when B2 showed its anchor can only be a text - two
 * series list items that differ in nothing else - and `cy.contains(item, seriesName)` is what the
 * human wrote there by hand. Rung 5 stays out for the same reason `.closest()` refuses a class:
 * an anchor pinned to a layout utility is a flake with a green tick on it.
 */
const ANCHOR_MAX_RUNG = 4;

/**
 * How the anchor reaches the shared ancestor, or `null` when it cannot be reached safely.
 *
 * `.closest()` rather than the corpus's more common `.parents()`: `.parents()` can return
 * several elements and humans then patch it with `.first()`, while `.closest()` returns at most
 * one. It stops at the *first* matching ancestor, so a nearer ancestor wearing the same
 * descriptor would silently land the selector somewhere the ladder never measured - and that is
 * a refusal, not a longer path.
 */
function hopTo(anchor: CandidateRow, sharedNode: number): Hop | null {
  const chain = anchor.ancestors;
  const at = chain.findIndex((a) => a.node === sharedNode);
  if (at < 0) return null;
  if (at === chain.length - 1) return { parent: true };

  const shared = chain[at] as AncestorDescriptor;
  const descriptor = closestDescriptor(shared);
  if (!descriptor) return null;
  for (let i = at + 1; i < chain.length; i++) {
    if (ancestorDescriptors(chain[i] as AncestorDescriptor).includes(descriptor)) return null;
  }
  return { closest: descriptor };
}

/**
 * Ticket 17 finding 2, and the last rung before a position.
 *
 * The anchor is any OTHER row that resolves to exactly one element on its own - which, since
 * ticket 18 Q2, includes a row that only an anchored matcher can pick out of a prefix pair. That
 * composition is B2's line: the matcher names the series label, and this walks out of the label
 * to the list item that holds it, exactly as the human wrote it by hand.
 *
 * `isTraceable` travels into that resolution (below), not just into this function's own leaves -
 * an anchor row that can only be told apart from its neighbours by an untraceable text must fail
 * to resolve at all, which drops it from `candidates` and lets the search fall through to the
 * position rung. B2's first run reached for a timestamp here for exactly this reason.
 *
 * Anchors are filtered structurally before any of them is resolved - shared ancestor, legal hop,
 * acceptable count - because resolving one is the expensive half and the structural test throws
 * away nearly all of them. Deepest shared ancestor first: the tightest scope is both the best
 * selector and the likeliest to satisfy the count.
 */
function resolveByHop(
  target: CandidateRow,
  rows: CandidateRow[],
  cardinality: Cardinality,
  leaves: LeafCandidate[],
  isTraceable: Traceable = ALWAYS_TRACEABLE
): LadderHit | undefined {
  if (spineOf(target).length === 0) return undefined;

  const candidates = rows
    .filter((r) => r.id !== target.id && spineOf(r).length > 0)
    .flatMap((r) => {
      const sharedNode = nearestShared(r, target);
      if (sharedNode === null) return [];
      const hop = hopTo(r, sharedNode);
      if (!hop) return [];
      const depth = spineOf(r).indexOf(sharedNode);
      return [{ row: r, sharedNode, hop, depth }];
    })
    .sort((a, b) => b.depth - a.depth);
  if (candidates.length === 0) return undefined;

  const resolved = new Map<string, string | null>();
  const anchorExpression = (r: CandidateRow): string | null => {
    const cached = resolved.get(r.id);
    if (cached !== undefined) return cached;
    const hit = resolve(r, rows, { exactly: 1 }, false, isTraceable);
    // A position would make the anchor depend on DOM order, which is what the hop exists to
    // stop the *target* depending on. It cannot come back in through the other half.
    const usable = hit.ok && hit.leafRung <= ANCHOR_MAX_RUNG && hit.position === undefined;
    const expression = usable && hit.ok ? emitPath(hit) : null;
    resolved.set(r.id, expression);
    return expression;
  };

  for (const leaf of leaves) {
    for (const c of candidates) {
      const under = rows.filter(
        (r) => spineOf(r).includes(c.sharedNode) && matchesRow(leaf.d, r)
      );
      if (!acceptableCount(under.length, cardinality, target)) continue;
      if (!under.some((r) => r.id === target.id)) continue;

      const anchor = anchorExpression(c.row);
      if (!anchor) continue;
      return {
        ok: true,
        path: [leaf.d],
        scope: { anchor, ...("closest" in c.hop ? { closest: c.hop.closest } : {}) },
        leafRung: leaf.rung,
        scopeRung: 0,
        via: `${leaf.id}+hop`,
        cardinality,
        observed: under.length,
      };
    }
  }
  return undefined;
}

export function resolveSelector(
  target: CandidateRow,
  rows: CandidateRow[],
  cardinality: Cardinality,
  isTraceable: Traceable = ALWAYS_TRACEABLE
): LadderResult {
  return resolve(target, rows, cardinality, true, isTraceable);
}

function resolve(
  target: CandidateRow,
  rows: CandidateRow[],
  cardinality: Cardinality,
  allowHop: boolean,
  isTraceable: Traceable = ALWAYS_TRACEABLE
): LadderResult {
  const leaves = RUNGS.map((g) => ({ rung: g.n, id: g.id, d: rungOf(g, target) })).filter(
    (x): x is LeafCandidate => x.d !== null
  );

  if (leaves.length === 0) {
    return {
      ok: false,
      cardinality,
      reason: `row ${target.id}: the element carries no descriptor on any legal rung`,
    };
  }

  const scopes = scopeCandidates(target);

  const search = (
    leafSet: LeafCandidate[],
    scopeSet: ScopeCandidate[]
  ): LadderHit | undefined => {
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

    for (const leaf of leafSet) {
      consider([leaf.d], leaf.rung, 0, leaf.id);
      for (const s1 of scopeSet) consider([s1.d, leaf.d], leaf.rung, s1.rung, leaf.id);
      for (const s1 of scopeSet) {
        for (const s2 of scopeSet) {
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
    return solutions[0];
  };

  const plain = search(leaves, scopes);
  if (plain) return plain;

  // Ticket 18 Q2, and it is a second pass rather than a sixth rung on purpose. Every plain path
  // has to fail first, however long: 11 of the corpus's 1611 contains() calls carry a regex, so
  // a ladder that reached for one in preference to a longer plain path would write a dialect.
  //
  // The pass offers an anchored variant of every anchorable leaf and lets the count decide,
  // rather than testing first whether some other text contains this one. Those are the same
  // test: an anchored matcher is strictly narrower than its plain form, so it can only change
  // the count where another observed text carries this one inside it - which is exactly the
  // ambiguity the rung exists for. Two elements reading the same stay ambiguous under both, and
  // the refusal below still stands.
  //
  // **Leaves only, and a scope never.** Cypress tests a regex against the element's whole
  // subtree text; a candidate row records the element's own text. The two are the same string on
  // a leaf and nothing like it on a wrapper, so an anchored scope on the list item ticket 18
  // names would match zero elements and fail on a timeout rather than on a count this function
  // could refuse. That target needs ticket 17's anchored-scope rung - reach the element carrying
  // the text, then walk out to the component holding it - composed with this one at the leaf.
  //
  // Traceable only. `anchorable` says a text is well-formed enough to anchor; it says nothing
  // about whether the text is safe to trust as an identity, and a probe walking the live tenant
  // can hand back a timestamp as readily as a label a human wrote in the contract.
  const anchoredLeaves = leaves
    .filter((x) => anchorable(x.d) && isTraceable((x.d as TextDescriptor).text))
    .map((x) => ({ ...x, d: anchor(x.d as TextDescriptor) }));

  if (anchoredLeaves.length > 0) {
    const anchored = search([...leaves, ...anchoredLeaves], scopes);
    if (anchored) return anchored;
  }

  // Before the position rung, and deliberately: a hop is an identity the probe measured, and a
  // position is the order the page happened to render in.
  if (allowHop) {
    const hop = resolveByHop(target, rows, cardinality, [...leaves, ...anchoredLeaves], isTraceable);
    if (hop) return hop;
  }

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

/**
 * A regex literal, with the delimiter escaped too - a text holding a slash would not parse.
 *
 * `\s*` at both ends because Cypress collapses runs of whitespace in the text it tests but does
 * not trim it, while a candidate row's text is trimmed. Without the slack, a span written over
 * three lines matches nothing.
 */
const regexLiteral = (s: string): string =>
  `/^\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\//g, "\\/")}\\s*$/`;

/** The second argument to `contains`, which is the one thing anchoring changes. */
const textMatcher = (d: TextDescriptor): string =>
  d.anchored ? regexLiteral(d.text) : quote(d.text);

const containsArgs = (d: TextDescriptor): string => `${quote(d.tag)}, ${textMatcher(d)}`;

/** The emitted call. Formatting is the repo's formatter's job, never this function's. */
export function emitPath(hit: LadderHit): string {
  const [first, ...rest] = hit.path;
  if (!first) return "";
  let out = hit.scope
    ? `${hit.scope.anchor}${hit.scope.closest ? `.closest(${quote(hit.scope.closest)})` : ".parent()"}` +
      (typeof first === "object" ? `.contains(${containsArgs(first)})` : `.find(${quote(first)})`)
    : typeof first === "object"
      ? `cy.contains(${containsArgs(first)})`
      : `cy.get(${quote(first)})`;
  for (const p of rest) {
    out += typeof p === "object" ? `.contains(${containsArgs(p)})` : `.find(${quote(p)})`;
  }
  if (hit.position !== undefined) {
    out += hit.position === 0 ? ".first()" : `.eq(${hit.position})`;
  }
  return out;
}

/** The path as it appears in the IR and in a diagnostic: readable, and stable across sessions. */
export function pathToSelectorText(path: Descriptor[], position?: number): string {
  const parts = path.map((d) => (typeof d === "string" ? d : `${d.tag}:contains(${textMatcher(d)})`));
  return position === undefined ? parts.join(" ") : `${parts.join(" ")} @${position}`;
}

export function samePath(a: Descriptor[], b: Descriptor[]): boolean {
  return a.length === b.length && a.every((d, i) => sameDescriptor(d, b[i] as Descriptor));
}
