/**
 * IR validation in three layers that must not be collapsed.
 *
 *   1. JSON Schema      - shape only.
 *   2. semantic linter  - everything that matters.
 *   3. anti-gaming      - every outcome has an assertion, and no outcome is satisfied by a
 *                         value that traces to something fabricated in the same test.
 *
 * Layer 2 is hand-written because a schema that gains a capability loses coverage silently:
 * one optional field once cut coverage from three planted defects caught to two, with nothing
 * failing. That is worse than no validation, because people stop looking.
 *
 * The linter is also the loop's stop condition. An under-probed spec IR cannot lint, so
 * "am I done gathering?" is a free local check rather than a judgement the model could get wrong.
 */
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { readPackageAsset } from "../support/assets.js";
import { emitPath, resolveSelector } from "../ladder/ladder.js";
import { findRow, findSurfaceOf, type FactsDocument } from "../facts/types.js";
import type { EffectiveConventions } from "../conventions/types.js";
import type { ScenarioContract } from "../contract/scenarioContract.js";
import {
  ASSERTING_VERBS,
  DOM_VERBS,
  PROBE_ONLY_VERBS,
  VERBS,
  allSteps,
  cardinalityOf,
  isProvisional,
  stepPath,
  targetOf,
  verbsOf,
  type IrDocument,
  type IrStep,
  type IrValue,
  type Verb,
} from "./types.js";

export type LintMode = "probe" | "spec";

/** The seven named states in which the tool stops and asks. */
export type TripCondition =
  | "vocabulary-gap"
  | "selector-absent"
  | "outcome-unmappable"
  | "budget-exhausted"
  | "ambiguous-provisional"
  | "zero-dom-steps"
  | "app-contradicts-scenario";

export interface LintProblem {
  where: string;
  message: string;
  /** Set when this problem is one the human-assist path names. */
  trip?: TripCondition;
}

/** What the next iteration still has to resolve. Probe mode makes the gap legible. */
export interface LintGap {
  at: string;
  need: "selector" | "assertion";
  hint: string;
}

export interface LintResult {
  ok: boolean;
  errors: LintProblem[];
  gaps: LintGap[];
  /** Contract outcome ids this IR already satisfies with a real assertion. */
  coveredOutcomes: number[];
}

export interface LintInput {
  ir: IrDocument;
  mode: LintMode;
  conventions: EffectiveConventions;
  contract: ScenarioContract;
  facts?: FactsDocument;
}

export function irSchemaBytes(): string {
  return readPackageAsset("ir/ir.schema.json");
}

let validator: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!validator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    validator = ajv.compile(JSON.parse(irSchemaBytes()));
  }
  return validator;
}

function schemaErrors(errors: ErrorObject[] | null | undefined): LintProblem[] {
  return (errors ?? []).map((e) => ({
    where: e.instancePath || "/",
    message: `schema: ${e.message ?? "invalid"}`,
  }));
}

/** Walks every value in a tree, so a `ref` nested three objects deep is still seen. */
function walkValues(value: IrValue | undefined, visit: (v: IrValue) => void): void {
  if (value === undefined) return;
  visit(value);
  if (value === null || typeof value !== "object") return;
  if ("object" in value) {
    for (const v of Object.values(value.object)) walkValues(v, visit);
  } else if ("list" in value) {
    for (const v of value.list) walkValues(v, visit);
  }
}

function stepValues(step: IrStep): IrValue[] {
  const out: IrValue[] = [];
  const collect = (v: IrValue | undefined) => walkValues(v, (x) => out.push(x));
  for (const arg of step.callRepoHelper?.args ?? []) collect(arg);
  collect(step.request?.body);
  collect(step.assert?.operand);
  return out;
}

const REF_PATTERN = /\$\{(\w+)\}/g;

function refsInString(s: string): string[] {
  return [...s.matchAll(REF_PATTERN)].map((m) => m[1] as string);
}

/**
 * A literal in a fabricated body must trace to the scenario contract, a capture or a value
 * builder. Nothing invented. A real POST is not a fiction - it creates real state, and
 * asserting on it is honest - so what transfers from the stub rule is the anchoring, not the ban.
 */
function isAnchoredLiteral(literal: string | number | boolean, contract: ScenarioContract): boolean {
  if (typeof literal === "boolean") return true;
  const text = String(literal);
  if (text.length === 0) return true;
  return contract.raw.includes(text);
}

export function lintIr(input: LintInput): LintResult {
  const { ir, mode, conventions, contract, facts } = input;
  const errors: LintProblem[] = [];
  const gaps: LintGap[] = [];
  const add = (where: string, message: string, trip?: TripCondition) =>
    errors.push(trip ? { where, message, trip } : { where, message });

  const validate = getValidator();
  if (!validate(ir)) {
    return { ok: false, errors: schemaErrors(validate.errors), gaps, coveredOutcomes: [] };
  }

  const steps = allSteps(ir);

  // --- ids ---------------------------------------------------------------------------
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) {
      add(stepPath(ir, step), `step id '${step.id}' is used more than once`);
    }
    seen.add(step.id);
  }

  // --- names in scope: vars first, then captures as they are bound --------------------
  // Setup runs in beforeEach, before the test body declares anything, so a setup step has no
  // names in scope at all. Vars are const declarations at the top of the it() body.
  const declared = new Set(Object.keys(ir.vars ?? {}));
  const boundBefore = new Map<string, Set<string>>();
  for (const step of ir.setup ?? []) boundBefore.set(step.id, new Set());
  for (const step of ir.steps) {
    boundBefore.set(step.id, new Set(declared));
    if (step.captures) declared.add(step.captures);
  }
  const builderIds = new Set(conventions.effectiveValueBuilders.map((b) => b.id));
  const deniedBuilders = new Set(conventions.deniedValueBuilders);
  const available = new Set(conventions.commands.available.names);
  const blessed = new Map(conventions.commands.blessed.map((m) => [m.name, m]));

  const checkValue = (where: string, value: IrValue, inScope: Set<string>): void => {
    walkValues(value, (v) => {
      if (v === null) return;
      if (typeof v === "string") {
        for (const ref of refsInString(v)) {
          if (!inScope.has(ref)) {
            add(where, `unbound runtime reference '\${${ref}}'`);
          }
        }
        return;
      }
      if (typeof v !== "object") return;
      if ("ref" in v) {
        if (!inScope.has(v.ref)) add(where, `unbound runtime reference '${v.ref}'`);
        return;
      }
      if ("builder" in v) {
        if (deniedBuilders.has(v.builder)) {
          add(
            where,
            `value builder '${v.builder}' is denied in this directory: ${
              conventions.appliedOverrides.join(", ") || "an override applies"
            }`,
            "vocabulary-gap"
          );
        } else if (!builderIds.has(v.builder)) {
          add(
            where,
            `no value builder '${v.builder}' in this repo's vocabulary. The IR holds no raw TypeScript, so a value the vocabulary cannot build stops the run.`,
            "vocabulary-gap"
          );
        }
      }
    });
  };

  // --- vars --------------------------------------------------------------------------
  for (const [name, value] of Object.entries(ir.vars ?? {})) {
    checkValue(`vars.${name}`, value, new Set(Object.keys(ir.vars ?? {})));
  }

  // --- steps -------------------------------------------------------------------------
  for (const step of steps) {
    const where = `${stepPath(ir, step)} (${step.id})`;
    const inScope = boundBefore.get(step.id) ?? new Set<string>();

    const verbs = verbsOf(step);
    // This rule used to be enforced by the schema's maxProperties, until an added optional
    // property silently removed it. It lives here now, with a corpus case.
    if (verbs.length === 0) {
      add(where, "a step must carry exactly one verb, found none");
      continue;
    }
    if (verbs.length > 1) {
      add(
        where,
        `a step must carry exactly one verb, found ${verbs.length}: ${verbs.join(" + ")}`
      );
    }
    const verb = verbs[0] as Verb;
    if (!VERBS.includes(verb)) {
      add(where, `unknown verb '${verb}'`);
      continue;
    }

    if (mode === "spec" && PROBE_ONLY_VERBS.includes(verb)) {
      add(
        where,
        `'${verb}' is probe-only and must not appear in a spec IR. The spec back-end used to fail open on this and emit a comment.`
      );
    }

    for (const value of stepValues(step)) {
      checkValue(where, value, inScope);
    }
    if (step.visit) checkValue(where, step.visit.path, inScope);
    if (step.request) checkValue(where, step.request.url, inScope);

    // --- the helper is real, and blessed --------------------------------------------
    if (step.callRepoHelper) {
      const name = step.callRepoHelper.name;
      const move = blessed.get(name);
      if (!move) {
        const real = available.has(name);
        add(
          where,
          real
            ? `'${name}' is a real command in this repo but is not blessed. Emitting it is correct and visibly foreign; a human decides.`
            : `'${name}' is not a registered command in this repo. The registry probe enumerates what is real, and this name is not on it.`,
          "vocabulary-gap"
        );
      }
    }

    // --- the request body is anchored ------------------------------------------------
    if (step.request?.body !== undefined) {
      walkValues(step.request.body, (v) => {
        if (v === null || typeof v === "object") return;
        if (!isAnchoredLiteral(v, contract)) {
          add(
            where,
            `request body holds '${String(v)}', which appears nowhere in the scenario contract. Every field of a fabricated body must trace to the contract, a capture or a value builder.`
          );
        }
      });
    }

    // --- the target ------------------------------------------------------------------
    const target = targetOf(step);
    if (!target) continue;

    if (isProvisional(target)) {
      if (mode === "spec") {
        add(
          where,
          "a provisional selector is probe-only. Resolve it against an observed candidate row first.",
          "selector-absent"
        );
      } else {
        gaps.push({
          at: step.id,
          need: "selector",
          hint: JSON.stringify(target.provisional),
        });
      }
      continue;
    }

    if (mode !== "spec") continue;

    if (!facts) {
      add(where, "a resolved selector cannot be checked without facts from a probe run");
      continue;
    }
    const row = findRow(facts, target.fromRow);
    if (!row) {
      add(
        where,
        `selector was derived from row '${target.fromRow}', which no probe observed`,
        "selector-absent"
      );
      continue;
    }
    // The verifiable link: the ladder applied to the named row must reproduce the selector.
    const surface = findSurfaceOf(facts, target.fromRow);
    const rows = surface ? surface.rows : [row];
    const again = resolveSelector(row, rows, cardinalityOf(step));
    if (!again.ok) {
      add(where, `the ladder now refuses row '${target.fromRow}': ${again.reason}`, "ambiguous-provisional");
    } else if (emitPath(again) !== target.resolved) {
      add(
        where,
        `selector ${JSON.stringify(target.resolved)} is not what the ladder derives from row '${target.fromRow}' (${JSON.stringify(emitPath(again))}). The model never authors a selector.`
      );
    }
  }

  // --- the genre line, drawn by IR shape and never by directory ------------------------
  const domSteps = steps.filter((s) => verbsOf(s).some((v) => DOM_VERBS.includes(v)));
  if (domSteps.length === 0) {
    add(
      "steps",
      "this IR has zero DOM steps, so it is not a UI e2e spec. The contract genre - a roundtrip asserted by a recorded response and a schema - is a separate effort, and v2 refuses it rather than attempting it.",
      "zero-dom-steps"
    );
  }

  // --- outcomes, and the anti-gaming guardrail ----------------------------------------
  const byId = new Map(steps.map((s) => [s.id, s]));
  const fabricated = fabricatedNames(ir, conventions);
  const contractIds = new Set(contract.outcomes.map((o) => o.id));
  const covered = new Set<number>();

  for (const outcome of ir.outcomes) {
    if (!contractIds.has(outcome.id)) {
      add(
        `outcomes[${outcome.id}]`,
        `outcome ${outcome.id} is not an Expected Outcome of ${contract.contractPath}`
      );
    }
    for (const ref of outcome.satisfiedBy) {
      const step = byId.get(ref);
      if (!step) {
        add(`outcomes[${outcome.id}]`, `satisfiedBy '${ref}' matches no step id`);
        continue;
      }
      const verb = verbsOf(step)[0];
      if (verb && !ASSERTING_VERBS.includes(verb)) {
        if (mode === "spec") {
          add(
            `outcomes[${outcome.id}]`,
            `satisfied by a '${verb}' step. A dump is not an assertion.`,
            "outcome-unmappable"
          );
        }
        // In probe mode the outcome is simply not covered yet; the single gap for it is
        // recorded below, once per outcome rather than once per reference.
        continue;
      }
      // No outcome may be satisfied by a value that traces to something fabricated in the
      // same test. Without this, the cheapest route to green is to fabricate the value that
      // is about to be asserted - and that yields a *passing* spec, so nothing else catches it.
      for (const value of stepValues(step)) {
        walkValues(value, (v) => {
          if (v !== null && typeof v === "object" && "ref" in v && fabricated.has(v.ref)) {
            add(
              `outcomes[${outcome.id}]`,
              `satisfied by an assertion whose operand traces to '${v.ref}', which a fabricating setup move produced in the same test`
            );
          }
        });
      }
      covered.add(outcome.id);
    }
  }

  for (const outcome of contract.outcomes) {
    if (!covered.has(outcome.id) && mode === "spec") {
      add(
        `outcomes[${outcome.id}]`,
        `Expected Outcome ${outcome.id} has no assertion: ${outcome.text}`,
        "outcome-unmappable"
      );
    } else if (!covered.has(outcome.id)) {
      gaps.push({ at: `outcome ${outcome.id}`, need: "assertion", hint: outcome.text });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    gaps,
    coveredOutcomes: [...covered].sort((a, b) => a - b),
  };
}

/** Names bound by a step whose setup move fabricates rather than creating real state. */
function fabricatedNames(
  ir: IrDocument,
  conventions: EffectiveConventions
): Set<string> {
  const fabricating = new Set(
    conventions.commands.blessed.filter((m) => m.kind === "fabricating").map((m) => m.name)
  );
  const out = new Set<string>();
  for (const step of allSteps(ir)) {
    if (step.captures && step.callRepoHelper && fabricating.has(step.callRepoHelper.name)) {
      out.add(step.captures);
    }
  }
  return out;
}

export function formatLintResult(result: LintResult): string {
  const lines: string[] = [];
  for (const e of result.errors) {
    lines.push(`ERROR  ${e.where}: ${e.message}${e.trip ? `  [${e.trip}]` : ""}`);
  }
  for (const g of result.gaps) {
    lines.push(`GAP    ${g.need.padEnd(9)} @ ${g.at}  ${g.hint}`);
  }
  return lines.join("\n");
}
