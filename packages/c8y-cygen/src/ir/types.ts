/**
 * The IR: the declarative document the model authors. It is the only artifact the model
 * writes, and it is not code.
 *
 * It holds no raw TypeScript. Every runtime value comes from a closed vocabulary of value
 * builders, because an unanchored expression is arbitrary code the linter cannot reason about
 * and the obvious way out of every guardrail in the design.
 *
 * The step list is flat. A capture binds for the remainder of the flow and the compiler, not
 * the model, decides where the `.then()` blocks go: nesting is a fact about Cypress's async
 * chain, not a fact about the test.
 */
import type { Cardinality } from "../ladder/ladder.js";

export type { Cardinality };

export type IrStyle = "integration" | "mocked";

/**
 * A value the emitted spec will hold. There is no raw-expression case on purpose - a value the
 * vocabulary cannot build stops the run and asks a human, and that answer outlives the run.
 */
export type IrValue =
  | string
  | number
  | boolean
  | null
  /** A var or a capture, by name. */
  | { ref: string }
  /** One entry from the repo's value-builder vocabulary. */
  | { builder: string; args?: Record<string, string | number> }
  | { object: Record<string, IrValue> }
  | { list: IrValue[] };

/**
 * A deliberately fragile guess, so that one probe run can walk a flow the model cannot yet
 * name precisely. Probe mode compiles it; spec mode refuses it.
 */
export interface ProvisionalGuess {
  within?: string;
  tag?: string;
  text?: string;
  /** A regular expression source, for a state-dependent label. */
  matches?: string;
  nth?: number;
}

export interface ResolvedTarget {
  /** The emitted Cypress expression, as the ladder produced it. Reviewable in the IR. */
  resolved: string;
  /**
   * The candidate row this selector was derived from. Not optional: you cannot choose a row
   * without naming one, and the linter checks that the ladder applied to this row reproduces
   * `resolved`. That is what upgrades the no-hallucinated-selector rule from a check against a
   * table, to a construction, to a verifiable link.
   */
  fromRow: string;
}

export type IrTarget = ResolvedTarget | { provisional: ProvisionalGuess };

export function isProvisional(t: IrTarget): t is { provisional: ProvisionalGuess } {
  return "provisional" in t;
}

/** What an assertion reads. */
export type Extractor = "text" | "attribute" | "value" | "count";

/** How an assertion tests what it read. */
export type Comparator = "equals" | "includes" | "matches" | "withinMinutesOfNow";

export interface VisitBody {
  path: string;
}

export interface ClickBody {
  target: IrTarget;
}

/** A load-bearing wait, declared rather than inferred, and a legal way to satisfy an outcome. */
export interface SettleBody {
  target: IrTarget;
  state: "visible" | "exists";
  cardinality?: Cardinality;
}

export interface AssertBody {
  target: IrTarget;
  extract: Extractor;
  /** Required when `extract` is "attribute". */
  attribute?: string;
  compare: Comparator;
  /**
   * Asserts the comparison does NOT hold. A flag rather than a mirror-image comparator for each
   * of `equals`/`includes`/`matches`, because an Expected Outcome phrased "shows X and not Y"
   * is one claim about one subject, and splitting the vocabulary would double it for nothing.
   *
   * B1's outcome 2 is the case: *the asset selector shows the device's name, and does not show
   * the group's name*. Without this the second half is unassertable, and axis B counts an
   * outcome with no assertion as a gap.
   */
  negate?: boolean;
  operand: IrValue;
  cardinality?: Cardinality;
}

export interface CallRepoHelperBody {
  name: string;
  args?: IrValue[];
}

/** A real API call for setup. Every field of the body must be anchored. */
export interface RequestBody {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  body?: IrValue;
}

/**
 * How an intercept is keyed on a route.
 *
 * Two forms, because the corpus writes two and axis D grades which one lands. `method` + `url`
 * is the common one and emits `cy.intercept('GET', '/inventory/managedObjects/12345*', ...)`.
 * The object form exists for the case that motivated B1: Cockpit resolves a group's dashboards
 * with a `$filter=((has('c8y_Dashboard!group!<id>')) or ...)` query, and matching it needs
 * `pathname` and `query` separately - a glob over the whole URL cannot express "this path, and
 * this query parameter exactly".
 */
export interface RouteMatcher {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /**
   * A URL glob. Cypress allows this alongside `pathname` and ANDs them, so the two are not
   * exclusive - an earlier version of this comment said they were, which is wrong about what
   * the emitted code does.
   */
  url?: string;
  /** An exact path, for when the query must be matched too. */
  pathname?: string;
  /** Query parameters that must all match. */
  query?: Record<string, string>;
}

/**
 * One recorded change to an observed response body.
 *
 * "Recorded" is the whole point. Ticket 02's rule 3 allows fabrication only by *explicit*
 * mutation of something observed, so the change has to be a thing the linter can see and a
 * reviewer can read - not a body the model retyped with one field quietly different.
 */
export interface StubMutation {
  /** A dotted path into the observed body: `managedObjects.0.name`, `references.0.managedObject.id`. */
  path: string;
  value: IrValue;
}

/**
 * Fabricates a response. The one verb in this design where fiction enters a test, and so the
 * one that carries the most machinery.
 *
 * The model does not write the body. It names an exchange a probe watched and lists the fields
 * it changed; the compiler reads the observed body out of the facts document and applies them.
 * That is the same move the ladder makes for selectors, for the same reason - a body the model
 * types is a body nothing can check, and the cheapest route to green is always to fabricate the
 * value you are about to assert.
 */
export interface StubBody {
  route: RouteMatcher;
  /** The `ObservedRequest.id` this body derives from. Rule 3: no body is invented from nothing. */
  fromRequest: string;
  mutations?: StubMutation[];
  alias?: string;
}

/**
 * Aliases a route so a later `waitFor` can block on it. Fabricates nothing and changes nothing.
 *
 * A separate verb from `stub` rather than a flag on it, because the failure modes are not
 * comparable: a wrong `sync` makes a spec flaky, a wrong `stub` makes it pass against a fiction.
 * Measured across the 154 e2e specs, 1133 intercepts against 63 specs that stub anything -
 * synchronisation is overwhelmingly what this house uses `cy.intercept` for, and giving it its
 * own verb is what stops the model reaching for `stub` when it wants to wait.
 *
 * Ticket 02 names a third, `spy` - observe a call in order to assert on it. It is deliberately
 * not here: asserting on a request needs an extractor family over `cy.wait('@a').its('request')`
 * that nothing has yet, so a `spy` today would emit exactly what a `sync` emits. A verb that
 * silently does a different verb's job is worse than an absent one.
 */
export interface SyncBody {
  route: RouteMatcher;
  alias: string;
}

/** Blocks until the aliased routes have responded. The declared alternative to a numeric sleep. */
export interface WaitForBody {
  aliases: string[];
}

/** Probe-only. Always scoped: an unscoped page yields a table far larger than the flow needs. */
export interface CollectBody {
  label: string;
  within: string;
}

export interface IrStep {
  id: string;
  /** Binds this step's result for the remainder of the flow. A capture names a step, never a selector. */
  captures?: string;
  visit?: VisitBody;
  click?: ClickBody;
  settle?: SettleBody;
  assert?: AssertBody;
  callRepoHelper?: CallRepoHelperBody;
  request?: RequestBody;
  stub?: StubBody;
  sync?: SyncBody;
  waitFor?: WaitForBody;
  collect?: CollectBody;
  /**
   * How to remove what this step created. Ticket 02 Q7(c): reset is per `it()`, lives in the
   * spec, and covers only state the spec itself made - the tool never resets what it did not
   * create. `idFrom` names the capture that holds the created thing's id; the removal itself
   * comes from the blessed move's own `teardown` key in the conventions file, so the IR never
   * carries a delete call.
   */
  undo?: { idFrom: string };
}

export const VERBS = [
  "visit",
  "click",
  "settle",
  "assert",
  "callRepoHelper",
  "request",
  "stub",
  "sync",
  "waitFor",
  "collect",
] as const;

export type Verb = (typeof VERBS)[number];

/** Compiling one of these in spec mode is a lint error, not a compiler fallback. */
export const PROBE_ONLY_VERBS: readonly Verb[] = ["collect"];

/** Verbs that put a real assertion in the emitted spec, and so may satisfy an outcome. */
export const ASSERTING_VERBS: readonly Verb[] = ["assert", "settle"];

/** Verbs that reach the rendered page. An IR with none of them is not a UI e2e spec. */
export const DOM_VERBS: readonly Verb[] = ["visit", "click", "settle", "assert", "collect"];

/**
 * Verbs that register a route before the application asks for it. All of them must be emitted
 * before the `visit` they are meant to catch - an intercept registered afterwards silently
 * never fires, and the page loads against the real tenant as though nothing were mocked.
 */
export const INTERCEPT_VERBS: readonly Verb[] = ["stub", "sync"];

export interface IrOutcome {
  id: number;
  text: string;
  /** Step ids, never indices. Four of four index references were off by one when tried. */
  satisfiedBy: string[];
}

export interface IrMeta {
  /** Repo-relative path of the scenario contract that asked for this spec. */
  contract: string;
  suite: string;
  title: string;
  style: IrStyle;
}

export interface IrDocument {
  version: 1;
  meta: IrMeta;
  vars?: Record<string, IrValue>;
  setup?: IrStep[];
  steps: IrStep[];
  outcomes: IrOutcome[];
}

export function verbOf(step: IrStep): Verb | undefined {
  return VERBS.find((v) => step[v] !== undefined);
}

export function verbsOf(step: IrStep): Verb[] {
  return VERBS.filter((v) => step[v] !== undefined);
}

/**
 * Whether a declared cardinality becomes a real length assertion in the emitted spec.
 *
 * `exactly: 1` does not: Cypress already fails a chain that resolves to nothing, and the corpus
 * does not write `.should('have.length', 1)` on every step. The compiler and the linter both
 * need this answer - the compiler to emit, the linter to know whether deleting a step would
 * lose an assertion - so it lives in one place.
 */
export function emitsLengthAssertion(cardinality: Cardinality | undefined): boolean {
  if (!cardinality) return false;
  if ("atLeast" in cardinality) return true;
  return cardinality.exactly !== 1;
}

export function targetOf(step: IrStep): IrTarget | undefined {
  return step.click?.target ?? step.settle?.target ?? step.assert?.target;
}

export function cardinalityOf(step: IrStep): Cardinality {
  return step.settle?.cardinality ?? step.assert?.cardinality ?? { exactly: 1 };
}

export function allSteps(ir: IrDocument): IrStep[] {
  return [...(ir.setup ?? []), ...ir.steps];
}

/** `steps[3]` / `setup[0]`. The value in the source map, and what a diagnostic names. */
export function stepPath(ir: IrDocument, step: IrStep): string {
  const setupIndex = (ir.setup ?? []).indexOf(step);
  if (setupIndex >= 0) return `setup[${setupIndex}]`;
  return `steps[${ir.steps.indexOf(step)}]`;
}
