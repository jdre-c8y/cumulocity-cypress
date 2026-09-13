/**
 * The frozen/free split, and the oscillation check.
 *
 * The rule arrived before the path that needs it, which is what ticket 11 required: healing is
 * authoring under pressure to turn a red thing green, and the cheapest available fix to
 * "declared 3, observed 1" is to declare 1 - which lints clean, passes, and is exactly the
 * fabrication the whole anti-gaming apparatus exists to stop. `run/healLadder.ts` is the path
 * that consumes it.
 *
 * The changed field paths are computed from the diff rather than claimed, which is what a later
 * stateless session needs in order to see an oscillation it did not take part in.
 */
import {
  allSteps,
  verbsOf,
  PROBE_ONLY_VERBS,
  type IrDocument,
  type IrStep,
} from "./types.js";

export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface PatchVerdict {
  accepted: boolean;
  changed: FieldChange[];
  frozenViolations: FieldChange[];
  /** A change that restores a value an earlier iteration already tried and failed with. */
  oscillations: FieldChange[];
  reason?: string;
}

/**
 * Intent, not mechanics. What a step asserts is frozen; how it finds its target is free.
 * Adding a step is never frozen - an addition cannot weaken an assertion - but deleting one is.
 *
 * With one exception, and it is the exception that lets this guard stay on for a whole heal
 * sequence. A `collect` step asserts nothing: it is probe-only scaffolding, and rung 2 works by
 * adding collects, running a probe, and then taking them back out to compile in spec mode. If
 * deleting one counted as deleting a step, the turn that ends a re-probe would always be
 * rejected - which is why the loop used to switch this whole check off for that turn, and with
 * it the freeze on every assertion field, on the one rung reached only after two failures.
 */
const FROZEN_STEP_FIELDS = [
  "assert.extract",
  "assert.attribute",
  "assert.compare",
  "assert.operand",
  "assert.cardinality",
  "settle.cardinality",
  "settle.state",
  // What the flow enters into a form is intent, not mechanics. Re-pointing a fill at a
  // different control is a targeting fix and stays free; changing what it types is changing the
  // scenario, and it is the heal turn's cheapest route to green - pick the render type the form
  // already shows and the assertion after it passes for nothing.
  "fill.value",
] as const;

function flatten(value: unknown, prefix: string, into: Map<string, unknown>): void {
  if (value === null || typeof value !== "object") {
    into.set(prefix, value);
    return;
  }
  if (Array.isArray(value)) {
    into.set(`${prefix}.length`, value.length);
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, into));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    flatten(v, prefix ? `${prefix}.${k}` : k, into);
  }
}

/**
 * A step that exists only to observe. It puts nothing in the emitted spec - the compiler refuses
 * `collect` in spec mode outright - so removing one cannot weaken what the spec asserts.
 */
function isProbeScaffolding(step: IrStep): boolean {
  const verbs = verbsOf(step);
  return verbs.length > 0 && verbs.every((v) => PROBE_ONLY_VERBS.includes(v));
}

function stepsById(ir: IrDocument): Map<string, IrStep> {
  return new Map(allSteps(ir).map((s) => [s.id, s]));
}

/** `steps.check-time.assert.compare` - keyed by step id, so inserting a step shifts nothing. */
function fieldMap(ir: IrDocument): Map<string, unknown> {
  const out = new Map<string, unknown>();
  flatten(ir.meta, "meta", out);
  flatten(ir.vars ?? {}, "vars", out);
  for (const [id, step] of stepsById(ir)) flatten(step, `steps.${id}`, out);
  // Where each step sits, as fields of its own. Keying by id carries neither the order nor the
  // list a step belongs to, so re-ordering the flow - or moving a step between `setup` and
  // `steps`, which changes its scope, what its capture can see and its path in the source map -
  // diffed as nothing at all: accepted with no reason to give, and logged as "(no change)".
  const place = (steps: IrStep[] | undefined, sequence: "setup" | "steps"): void => {
    (steps ?? []).forEach((step, i) => {
      out.set(`steps.${step.id}.@sequence`, sequence);
      out.set(`steps.${step.id}.@position`, i);
    });
  };
  place(ir.setup, "setup");
  place(ir.steps, "steps");
  for (const outcome of ir.outcomes) flatten(outcome, `outcomes.${outcome.id}`, out);
  return out;
}

/**
 * Splits `steps.<id>.<field>` when the id may itself contain dots.
 *
 * The schema puts no pattern on `id`, so splitting at the first dot turns `check.time` into the
 * step id `check`, which matches nothing - and a step whose id matches nothing has no frozen
 * fields at all. Matching against the ids that actually exist, longest first, closes that.
 */
function splitStepPath(rest: string, ids: Set<string>): { stepId: string; field: string } {
  let best = "";
  for (const id of ids) {
    if ((rest === id || rest.startsWith(`${id}.`)) && id.length > best.length) best = id;
  }
  if (best === "") {
    const dot = rest.indexOf(".");
    return dot === -1 ? { stepId: rest, field: "" } : { stepId: rest.slice(0, dot), field: rest.slice(dot + 1) };
  }
  return { stepId: best, field: rest.slice(best.length + 1) };
}

function isFrozenPath(path: string, before: IrDocument, after: IrDocument): boolean {
  if (path.startsWith("outcomes.")) return true;
  if (!path.startsWith("steps.")) return false;

  const beforeSteps = stepsById(before);
  const afterSteps = stepsById(after);
  const ids = new Set([...beforeSteps.keys(), ...afterSteps.keys()]);
  const { stepId } = splitStepPath(path.slice("steps.".length), ids);
  const rest = path.slice("steps.".length);
  const field = rest === stepId ? "" : rest.slice(stepId.length + 1);

  // Deleting a step is frozen; adding one is free. Removing probe scaffolding is neither.
  const wasThere = beforeSteps.get(stepId);
  const stillThere = afterSteps.get(stepId);
  if (wasThere && !stillThere) return !isProbeScaffolding(wasThere);
  if (!wasThere) return false;

  // An existing step's verb may not change. Checked on the step rather than on the path,
  // because `flatten` always descends into the verb object - so no path is ever a bare
  // `click` or `request`, and a guard written against those never fires. Swapping a blessed
  // helper for a raw request is the edit this stops.
  if (stillThere) {
    const wasVerbs = verbsOf(wasThere).join(",");
    const nowVerbs = verbsOf(stillThere).join(",");
    if (wasVerbs !== nowVerbs) return true;
  }

  return FROZEN_STEP_FIELDS.some((f) => field === f || field.startsWith(`${f}.`) || field.startsWith(`${f}[`));
}

/**
 * A var reachable from a frozen field is frozen too, or the operand escapes through `vars`.
 *
 * Both ways of reaching one count. `{ ref: name }` is the obvious one; `"lat ${expectedLat}"`
 * is the one that slips through, because it is a plain string and the operand it carries is
 * rewritable without any frozen path appearing in the diff.
 */
const INTERPOLATION = /\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g;

function frozenVars(ir: IrDocument): Set<string> {
  const out = new Set<string>();
  const scan = (value: unknown): void => {
    if (typeof value === "string") {
      for (const m of value.matchAll(INTERPOLATION)) out.add(m[1] as string);
      return;
    }
    if (value === null || typeof value !== "object") return;
    if ("ref" in (value as Record<string, unknown>)) {
      out.add(String((value as { ref: unknown }).ref));
      return;
    }
    for (const v of Object.values(value as Record<string, unknown>)) scan(v);
  };
  for (const step of allSteps(ir)) {
    if (step.assert) {
      scan(step.assert.operand);
      scan(step.assert.cardinality);
    }
    if (step.fill) scan(step.fill.value);
  }
  return out;
}

export interface PatchHistoryEntry {
  /** The field paths this iteration changed, and what it set them to. */
  changed: FieldChange[];
  /** Whether the run that followed passed. */
  passed: boolean;
}

export function diffIr(before: IrDocument, after: IrDocument): FieldChange[] {
  const a = fieldMap(before);
  const b = fieldMap(after);
  const paths = new Set([...a.keys(), ...b.keys()]);
  const changed: FieldChange[] = [];
  for (const p of paths) {
    const x = a.get(p);
    const y = b.get(p);
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      changed.push({ path: p, before: x, after: y });
    }
  }
  return changed.sort((l, r) => l.path.localeCompare(r.path));
}

export function checkPatch(
  before: IrDocument,
  after: IrDocument,
  history: PatchHistoryEntry[] = []
): PatchVerdict {
  const changed = diffIr(before, after);
  const varLock = frozenVars(before);

  const frozenViolations = changed.filter((c) => {
    if (isFrozenPath(c.path, before, after)) return true;
    if (c.path.startsWith("vars.")) {
      const name = c.path.slice("vars.".length).split(/[.[]/)[0] as string;
      return varLock.has(name);
    }
    return false;
  });

  const failedBefore = new Map<string, unknown[]>();
  for (const entry of history) {
    if (entry.passed) continue;
    for (const c of entry.changed) {
      const list = failedBefore.get(c.path) ?? [];
      list.push(c.after);
      failedBefore.set(c.path, list);
    }
  }
  const oscillations = changed.filter((c) =>
    (failedBefore.get(c.path) ?? []).some((v) => JSON.stringify(v) === JSON.stringify(c.after))
  );

  const accepted = frozenViolations.length === 0 && oscillations.length === 0;
  const reason = accepted
    ? undefined
    : [
        ...frozenViolations.map(
          (c) =>
            `${c.path} is a frozen field: it says WHAT the step asserts, not how it finds its target`
        ),
        ...oscillations.map(
          (c) =>
            `${c.path} is being restored to a value an earlier iteration already tried and failed with`
        ),
      ].join("; ");

  return { accepted, changed, frozenViolations, oscillations, ...(reason ? { reason } : {}) };
}
