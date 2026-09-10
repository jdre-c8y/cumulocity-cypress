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
  timeoutMs?: number;
}

export interface AssertBody {
  target: IrTarget;
  extract: Extractor;
  /** Required when `extract` is "attribute". */
  attribute?: string;
  compare: Comparator;
  operand: IrValue;
  cardinality?: Cardinality;
  timeoutMs?: number;
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
  collect?: CollectBody;
}

export const VERBS = [
  "visit",
  "click",
  "settle",
  "assert",
  "callRepoHelper",
  "request",
  "collect",
] as const;

export type Verb = (typeof VERBS)[number];

/** Compiling one of these in spec mode is a lint error, not a compiler fallback. */
export const PROBE_ONLY_VERBS: readonly Verb[] = ["collect"];

/** Verbs that put a real assertion in the emitted spec, and so may satisfy an outcome. */
export const ASSERTING_VERBS: readonly Verb[] = ["assert", "settle"];

/** Verbs that reach the rendered page. An IR with none of them is not a UI e2e spec. */
export const DOM_VERBS: readonly Verb[] = ["visit", "click", "settle", "assert", "collect"];

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
  tags?: string[];
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
