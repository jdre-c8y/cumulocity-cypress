/**
 * The frozen/free split, and the oscillation check.
 *
 * The heal path that consumes this is out of scope for the B0 slice. The rule is here anyway,
 * with corpus cases, because it must exist before the path that needs it rather than arrive
 * after it: healing is authoring under pressure to turn a red thing green, and the cheapest
 * available fix to "declared 3, observed 1" is to declare 1 - which lints clean, passes, and is
 * exactly the fabrication the whole anti-gaming apparatus exists to stop.
 *
 * The changed field paths are computed from the diff rather than claimed, which is what a later
 * stateless session needs in order to see an oscillation it did not take part in.
 */
import { allSteps, type IrDocument, type IrStep } from "./types.js";

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
 */
const FROZEN_STEP_FIELDS = [
  "assert.extract",
  "assert.attribute",
  "assert.compare",
  "assert.operand",
  "assert.cardinality",
  "settle.cardinality",
  "settle.state",
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

function stepsById(ir: IrDocument): Map<string, IrStep> {
  return new Map(allSteps(ir).map((s) => [s.id, s]));
}

/** `steps.check-time.assert.compare` - keyed by step id, so inserting a step shifts nothing. */
function fieldMap(ir: IrDocument): Map<string, unknown> {
  const out = new Map<string, unknown>();
  flatten(ir.meta, "meta", out);
  flatten(ir.vars ?? {}, "vars", out);
  for (const [id, step] of stepsById(ir)) flatten(step, `steps.${id}`, out);
  for (const outcome of ir.outcomes) flatten(outcome, `outcomes.${outcome.id}`, out);
  return out;
}

function isFrozenPath(path: string, before: IrDocument, after: IrDocument): boolean {
  if (path.startsWith("outcomes.")) return true;
  if (!path.startsWith("steps.")) return false;

  const rest = path.slice("steps.".length);
  const dot = rest.indexOf(".");
  const stepId = dot === -1 ? rest : rest.slice(0, dot);
  const field = dot === -1 ? "" : rest.slice(dot + 1);

  // Deleting a step is frozen; adding one is free.
  const existedBefore = stepsById(before).has(stepId);
  const existsAfter = stepsById(after).has(stepId);
  if (existedBefore && !existsAfter) return true;
  if (!existedBefore) return false;

  // An existing step's verb may not change.
  const verbChanged = field === "" || /^(visit|click|settle|assert|callRepoHelper|request|collect)$/.test(field);
  if (verbChanged && !field.includes(".")) return true;

  return FROZEN_STEP_FIELDS.some((f) => field === f || field.startsWith(`${f}.`) || field.startsWith(`${f}[`));
}

/** A var reachable from a frozen field is frozen too, or the operand escapes through `vars`. */
function frozenVars(ir: IrDocument): Set<string> {
  const out = new Set<string>();
  const scan = (value: unknown): void => {
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
