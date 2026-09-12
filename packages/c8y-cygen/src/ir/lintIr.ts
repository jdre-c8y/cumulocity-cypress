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
  emitsLengthAssertion,
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

/**
 * ajv's own text plus whichever key it objected to. "must NOT have additional properties" alone
 * leaves the model to guess which of a step's keys to drop, and each guess costs an iteration -
 * which is exactly what happens when a field is removed from the schema and the model keeps its
 * old habit. Every hand-written message in this linter names the thing it is about.
 */
function schemaErrors(errors: ErrorObject[] | null | undefined): LintProblem[] {
  return (errors ?? []).map((e) => {
    const params = e.params as { additionalProperty?: string; allowedValues?: unknown[] };
    const detail = params?.additionalProperty
      ? ` ('${params.additionalProperty}' is not a field of this object)`
      : params?.allowedValues
        ? ` (allowed: ${params.allowedValues.join(", ")})`
        : "";
    return {
      where: e.instancePath || "/",
      message: `schema: ${e.message ?? "invalid"}${detail}`,
    };
  });
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
/** A brace without its dollar. Caught because the result is a URL with a literal brace in it. */
const MISSING_DOLLAR = /(^|[^$])\{(\w+)\}/g;

function refsInString(s: string): string[] {
  return [...s.matchAll(REF_PATTERN)].map((m) => m[1] as string);
}

/**
 * `{deviceId}` where `${deviceId}` was meant.
 *
 * This is the v1 defect that motivated the whole value-builder vocabulary, inverted: there the
 * compiler emitted a template literal's text inside single quotes, so the spec navigated to a
 * URL containing a literal dollar-brace. Here the model drops the dollar and the same thing
 * happens - and nothing downstream can tell the difference between that and a route that really
 * does contain a brace, so it has to be caught by name while the names are still in hand.
 */
function missingDollarRefs(s: string, inScope: ReadonlySet<string>): string[] {
  return [...s.matchAll(MISSING_DOLLAR)]
    .map((m) => m[2] as string)
    .filter((name) => inScope.has(name));
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

/**
 * Selector-shaped as a whole, rather than merely bracket-bearing.
 *
 * `[` is a character class in every non-trivial regular expression, and `matches` exists for
 * exactly those - `Device [0-9]+ online`, `Creation ?[Tt]ime`. Rejecting on a bare `[` refused
 * the field's own documented use and spent a turn telling the model to fix what was right.
 *
 * The bracketed form needs an `=`: an attribute selector effectively always carries one, and
 * without that condition a bare `[0-9]` reads as a selector. A missed selector costs one probe
 * run; a refused regex costs a turn and sends the model somewhere there is nothing to find.
 *
 * A bare tag name counts only inside a comma-separated list, where the commas have already
 * settled what the string is. On its own, `Time` is as good a regex as it is a selector.
 */
const SELECTOR_ALONE =
  /^[.#][\w-]+$|^[a-z][\w-]*\[[^\]]*=[^\]]*\]$|^\[[\w-]+[*^$|~]?=[^\]]*\]$/i;

const BARE_TAG = /^[a-z][\w-]*$/i;

function looksLikeSelector(pattern: string): boolean {
  const parts = pattern.split(",").map((p) => p.trim());
  if (parts.some((p) => p === "")) return false;
  if (parts.length === 1) return SELECTOR_ALONE.test(parts[0] as string);
  return parts.every((p) => SELECTOR_ALONE.test(p) || BARE_TAG.test(p));
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
  for (const step of ir.setup ?? []) {
    boundBefore.set(step.id, new Set());
    // Nothing binds in setup, so a capture there is not a name that is merely out of scope -
    // it is a name that never exists. It was accepted and silently discarded, which is bad on
    // its own and worse with `undo`: the teardown holder was declared and the afterEach emitted
    // against a variable nothing ever assigns, so the guard is always false, the device is never
    // deleted, and the run reports a clean tree. Refused here, where it costs no Cypress run.
    if (step.captures) {
      add(
        `setup.${step.id}`,
        `'captures' is not available in setup: setup compiles to beforeEach, which runs before the test body binds anything. Move this step into 'steps', where a capture binds for the rest of the flow.`
      );
    }
  }
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
        for (const name of missingDollarRefs(v, inScope)) {
          add(
            where,
            `'{${name}}' is missing its dollar: ${name} is a bound name here, so this was meant to be '\${${name}}'. As written it emits a literal brace.`
          );
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
      // Auth is a repo fact, not a scenario fact: the conventions file's beforeEach idiom
      // already emits it on every test. An IR that authors it too gets it twice.
      if (move?.role === "auth" && (conventions.effectiveIdioms.beforeEach ?? []).length > 0) {
        add(
          where,
          `'${name}' is this repo's auth idiom and the compiler already emits it in beforeEach. Authoring it again duplicates the call.`
        );
      }
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
      // `matches` is a regular expression over visible text - it exists for a state-dependent
      // label like /Change provider|Add global provider/. A CSS selector put there is a valid
      // selector and an invalid character class, and it costs a whole probe run to find out.
      const pattern = target.provisional.matches;
      if (pattern !== undefined) {
        if (looksLikeSelector(pattern)) {
          add(
            where,
            `provisional 'matches' is a regular expression over visible text, and ${JSON.stringify(pattern)} is a CSS selector. A selector belongs in 'tag' or 'within'.`
          );
        } else {
          try {
            new RegExp(pattern);
          } catch (e) {
            add(where, `provisional 'matches' is not a valid regular expression: ${(e as Error).message}`);
          }
        }
      }
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

    // `resolved` is the emitted Cypress expression, not the bare selector the ladder searched
    // for. Checked in BOTH modes and before anything else, because probe mode used to pass a
    // resolved target through untouched - so a bare `c8y-tabs-outlet` was emitted as an
    // identifier and the probe died with "c8y is not defined".
    if (!/^cy\./.test(target.resolved)) {
      add(
        where,
        `resolved target ${JSON.stringify(target.resolved)} is not a Cypress expression. It must read like cy.get('...'), which is what the ladder emits - a bare selector here is emitted as code.`
      );
      continue;
    }

    if (!facts) {
      if (mode !== "spec") continue;
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

  // --- reset what you created, and only that -------------------------------------------
  // Ticket 02 Q7(c): reset is per `it()`, lives in the spec, and covers only state the spec
  // itself made. A rule nothing checks is a wish, so it is checked here - and only where the
  // repo has actually recorded how to remove the thing. A blessed move with no `teardown` key
  // is one the repo cannot undo (a read-only lookup, or a fabrication that made nothing), and
  // demanding an undo for it would be the tool inventing a delete, which is the one thing the
  // closed vocabulary exists to prevent.
  if (mode === "spec") {
    const bound = new Set<string>([
      ...Object.keys(ir.vars ?? {}),
      ...allSteps(ir)
        .map((s) => s.captures)
        .filter((c): c is string => typeof c === "string"),
    ]);
    for (const step of allSteps(ir)) {
      const helper = step.callRepoHelper?.name;
      const move = helper
        ? conventions.commands.blessed.find((m) => m.name === helper)
        : undefined;
      if (step.undo && !bound.has(step.undo.idFrom)) {
        add(
          `steps.${step.id}`,
          `undo.idFrom names '${step.undo.idFrom}', which nothing in this IR binds. It must be a capture holding the created thing's id.`
        );
      }
      if (move?.teardown && !step.undo) {
        add(
          `steps.${step.id}`,
          `'${helper}' creates real state and the conventions file records how this repo removes it ('${move.teardown}'). Add undo.idFrom naming the capture that holds the new id, so the spec resets what it created.`
        );
      }
    }
  }

  // --- settles the next command already performs ---------------------------------------
  // A settle emits `cy.get(X).should('be.visible')`. It is redundant only where the step that
  // follows makes the very same guarantee on the very same target, which is narrower than it
  // first looks:
  //
  //   - a `click` waits for actionability, and actionability includes visibility, so a
  //     settle(visible) or settle(exists) before a click on the same target adds nothing;
  //   - an assertion retries until it holds, which implies the element exists - but NOT that it
  //     is visible. `.should('contain.text')` passes on a display:none panel carrying the right
  //     text, so a settle(visible) before an assertion is a real check and stays.
  //
  // A settle whose cardinality becomes a length assertion is never redundant either: nothing
  // else in the chain makes that claim, and it is the Grid-versus-List guard.
  //
  // A settle that satisfies an outcome stays regardless: it IS the assertion, and deleting it
  // would cost axis B.
  if (mode === "spec") {
    const satisfying = new Set(ir.outcomes.flatMap((o) => o.satisfiedBy));
    // setup and steps are two sequences, not one: setup compiles into beforeEach, so its last
    // step is not adjacent to the first step of the body.
    for (const sequence of [ir.setup ?? [], ir.steps]) {
      for (let i = 0; i < sequence.length - 1; i++) {
        const step = sequence[i] as IrStep;
        const next = sequence[i + 1] as IrStep;
        if (!step.settle || satisfying.has(step.id)) continue;
        if (emitsLengthAssertion(step.settle.cardinality)) continue;
        const here = step.settle.target;
        const there = targetOf(next);
        if (!there || isProvisional(here) || isProvisional(there)) continue;
        if (here.resolved !== there.resolved) continue;
        const impliedByNext = next.click !== undefined || step.settle.state === "exists";
        if (!impliedByNext) continue;
        add(
          `steps.${step.id}`,
          `settles ${here.resolved}, which '${next.id}' already ${
            next.click ? "waits for - a click retries until the element is actionable, which means visible" : "implies - an assertion retries until the element exists"
          }. Delete this step; it satisfies no outcome and asserts nothing the next line does not.`
        );
      }
    }
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
