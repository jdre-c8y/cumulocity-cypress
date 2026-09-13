/**
 * The compiler. IR plus conventions plus a mode in, TypeScript plus a source map out.
 *
 * Two back-ends. Spec mode emits the house-style file that lands in the repo; probe mode emits
 * a throwaway spec that collects and asserts nothing. Both call the same setup emitters.
 *
 * No model is in this loop.
 */
import {
  CompileError,
  collectPreamble,
  emitCallRepoHelper,
  emitRequest,
  emitString,
  emitStub,
  emitSync,
  emitValue,
  emitVisit,
  emitWaitFor,
  type EmitContext,
} from "./emit.js";
import { chooseFillCall, isRefusal } from "./fillCall.js";
import type { EmittedStatement } from "./sourceMap.js";
import {
  allSteps,
  isProvisional,
  stepPath,
  verbOf,
  type AssertBody,
  type Cardinality,
  emitsLengthAssertion,
  type IrDocument,
  type IrStep,
  type FillBody,
  type IrTarget,
  type SettleBody,
} from "../ir/types.js";
import type { EffectiveConventions } from "../conventions/types.js";
import { findRow, type FactsDocument } from "../facts/types.js";

export type CompileMode = "spec" | "probe";

export interface CompileResult {
  /** Unformatted TypeScript. The repo's own formatter has the last word on quoting and layout. */
  text: string;
  /** In emission order, for the source map to anchor against the formatted file. */
  statements: EmittedStatement[];
  /** Collect labels this probe will write. Empty in spec mode. */
  collects: { id: string; label: string; within: string }[];
}

export interface CompileInput {
  ir: IrDocument;
  mode: CompileMode;
  conventions: EffectiveConventions;
  /**
   * What a probe observed. Needed only by `stub`, which reads its response body from here
   * rather than from the IR - the model names an exchange, it never writes a body.
   */
  facts?: FactsDocument;
  /**
   * Grep tags for the emitted `it`, as the contract's author declared them. Spec mode only.
   * The tool never derives these - see ScenarioContract.tags for the measurement that settled it.
   */
  itTags?: string[];
  /** Tool version, for the provenance header. Spec mode only. */
  toolVersion?: string;
}

const INDENT = "  ";

function cardinalityAssertion(cardinality: Cardinality): string | null {
  if ("atLeast" in cardinality) {
    return `.should('have.length.at.least', ${cardinality.atLeast})`;
  }
  if (!emitsLengthAssertion(cardinality)) return null;
  return `.should('have.length', ${cardinality.exactly})`;
}

function targetExpr(target: IrTarget, mode: CompileMode, stepId: string): string {
  if (!isProvisional(target)) return target.resolved;
  if (mode === "spec") {
    throw new CompileError(
      `step '${stepId}': a provisional selector reached the spec back-end. This is a lint rule, not a compiler fallback - the back-end used to fail open here and emit null.click().`
    );
  }
  // The command resolves the guess, records which candidate row it matched, and yields the
  // element onward, which is what makes resolution a construction rather than a check.
  return `cy.c8yCygenProvisional(${emitString(stepId)}, ${JSON.stringify(target.provisional)})`;
}

function emitSettle(body: SettleBody, mode: CompileMode, stepId: string): string {
  const base = targetExpr(body.target, mode, stepId);
  const cardinality = cardinalityAssertion(body.cardinality ?? { exactly: 1 });
  // A declared cardinality is emitted, not merely checked at resolution time. That is what
  // turns the Grid-versus-List hazard into "expected 3, found 1" at run time instead of a
  // message pointing nowhere near its cause.
  if (cardinality) {
    const visible = body.state === "visible" ? ".should('be.visible')" : "";
    return `${base}${cardinality}${visible};`;
  }
  return `${base}.should(${emitString(body.state === "visible" ? "be.visible" : "exist")});`;
}

/**
 * One value into one control, in whichever call the observed row calls for.
 *
 * The row comes out of the facts document and the call comes out of `chooseFillCall`, so the
 * only thing the IR contributes is which control and what value - the same division of labour
 * the ladder makes for selectors and `stub` makes for response bodies.
 *
 * Both back-ends emit this identically. A probe that skipped its fills would walk a different
 * flow from the spec and collect the surfaces of a form nobody filled in, which is the fidelity
 * argument the one-IR design rests on.
 */
function emitFill(body: FillBody, ctx: EmitContext, mode: CompileMode, stepId: string): string {
  // Before `targetExpr`, which fails open in probe mode: it would emit a runtime-resolved
  // element and leave this function with no row to read the call off. The linter refuses a
  // provisional fill in both modes, so this is the second wall rather than the first.
  if (isProvisional(body.target)) {
    throw new CompileError(
      `step '${stepId}': a fill needs a resolved target. The call it emits is read off the observed row, and a guess has no row.`
    );
  }
  const base = targetExpr(body.target, mode, stepId);
  const row = ctx.facts ? findRow(ctx.facts, body.target.fromRow) : undefined;
  if (!row) {
    throw new CompileError(
      `step '${stepId}': fill targets row '${body.target.fromRow}', which no probe observed. The Cypress call is derived from the row, never chosen by the model.`
    );
  }
  const chosen = chooseFillCall(row, body.value);
  if (isRefusal(chosen)) {
    throw new CompileError(`step '${stepId}': ${chosen.refuse}`);
  }
  if (chosen.call === "check") {
    return `${base}.${chosen.checked ? "check" : "uncheck"}();`;
  }
  const operand = emitValue(body.value, ctx);
  // `.clear()` first, always. 673 clears against 1058 types in the corpus: a human clears two
  // thirds of the time and knows the field is empty the rest. A generated spec knows neither.
  return chosen.call === "select"
    ? `${base}.select(${operand});`
    : `${base}.clear().type(${operand});`;
}

function emitAssert(body: AssertBody, ctx: EmitContext, mode: CompileMode, stepId: string): string {
  const base = targetExpr(body.target, mode, stepId);
  const operand = emitValue(body.operand, ctx);
  const cardinality = cardinalityAssertion(body.cardinality ?? { exactly: 1 }) ?? "";
  // Applied to the assertion and never to the cardinality. Negating the cardinality would turn
  // "there are three of these, and none says X" into "there are not three of these" - a
  // different claim, and one that passes for the wrong reason.
  const chain = (assertion: string): string => (body.negate ? `not.${assertion}` : assertion);

  if (body.compare === "withinMinutesOfNow") {
    if (body.extract !== "text") {
      throw new CompileError(
        `step '${stepId}': withinMinutesOfNow reads text, not ${body.extract}`
      );
    }
    if (body.negate) {
      // "the time shown is not within 3 minutes of now" is not an outcome anyone means, and a
      // window assertion inverted is satisfied by every value outside it, including a parse
      // failure. Refused rather than emitted.
      throw new CompileError(
        `step '${stepId}': withinMinutesOfNow cannot be negated - inverted, it is satisfied by any time outside the window, a failed parse included.`
      );
    }
    return [
      `${base}${cardinality}`,
      `${INDENT}.invoke('text')`,
      `${INDENT}.then((text) => {`,
      `${INDENT}${INDENT}expect(dayjs(text).diff(dayjs().utc(), 'minutes')).to.be.within(-${operand}, ${operand});`,
      `${INDENT}});`,
    ].join("\n");
  }

  switch (body.extract) {
    case "text":
      if (body.compare === "includes") return `${base}${cardinality}.should(${emitString(chain("contain.text"))}, ${operand});`;
      if (body.compare === "equals") return `${base}${cardinality}.should(${emitString(chain("have.text"))}, ${operand});`;
      return `${base}${cardinality}.invoke('text').should(${emitString(chain("match"))}, new RegExp(${operand}));`;
    case "attribute": {
      if (!body.attribute) {
        throw new CompileError(`step '${stepId}': extract 'attribute' needs an attribute name`);
      }
      const read = `${base}${cardinality}.invoke('attr', ${emitString(body.attribute)})`;
      if (body.compare === "equals") return `${read}.should(${emitString(chain("equal"))}, ${operand});`;
      if (body.compare === "includes") return `${read}.should(${emitString(chain("include"))}, ${operand});`;
      return `${read}.should(${emitString(chain("match"))}, new RegExp(${operand}));`;
    }
    case "value":
      if (body.compare === "equals") return `${base}${cardinality}.should(${emitString(chain("have.value"))}, ${operand});`;
      return `${base}${cardinality}.invoke('val').should(${emitString(chain("include"))}, ${operand});`;
    case "count":
      if (body.compare !== "equals") {
        throw new CompileError(
          `step '${stepId}': a count is compared with 'equals'; use a declared cardinality for 'at least n'`
        );
      }
      return `${base}.should(${emitString(chain("have.length"))}, ${operand});`;
  }
}

/**
 * `assert` steps do one of two jobs and probe mode must tell them apart. A settle is a
 * load-bearing wait: drop it and the probe races ahead and dumps the wrong state. A value
 * assertion is an outcome check: keep it and the probe fails on the value it was sent to
 * discover. The IR declares which is which rather than the compiler guessing from shape.
 */
function emitStepStatement(
  step: IrStep,
  ctx: EmitContext,
  mode: CompileMode
): string | null {
  const verb = verbOf(step);
  switch (verb) {
    case "visit":
      return emitVisit(step.visit!.path, ctx);
    case "callRepoHelper":
      return emitCallRepoHelper(step.callRepoHelper!, ctx);
    case "request":
      return emitRequest(step.request!, ctx);
    case "stub":
      // A probe that serves a stubbed body records the stub, and every fact downstream is then
      // contingent on itself. The probe's whole job is to see what the real application returns,
      // so this is the one verb the probe back-end drops outright rather than merely ignoring.
      if (mode === "probe") return null;
      return emitStub(step.stub!, ctx, step.id);
    case "sync":
      return emitSync(step.sync!, ctx);
    case "waitFor":
      return emitWaitFor(step.waitFor!, step.id);
    case "click":
      return `${targetExpr(step.click!.target, mode, step.id)}.click();`;
    case "fill":
      return emitFill(step.fill!, ctx, mode, step.id);
    case "settle":
      return emitSettle(step.settle!, mode, step.id);
    case "assert":
      if (mode === "probe") return null;
      return emitAssert(step.assert!, ctx, mode, step.id);
    case "collect": {
      if (mode === "spec") {
        throw new CompileError(
          `step '${step.id}': 'collect' is probe-only. The spec back-end used to emit a comment here and ship.`
        );
      }
      const body = step.collect!;
      return `cy.c8yCygenCollect({ label: ${emitString(body.label)}, within: ${emitString(body.within)} });`;
    }
    default:
      throw new CompileError(`step '${step.id}': no verb`);
  }
}

function indentBlock(text: string, depth: number): string {
  const pad = INDENT.repeat(depth);
  return text
    .split("\n")
    .map((l) => (l === "" ? "" : pad + l))
    .join("\n");
}

function outcomesFor(ir: IrDocument, stepId: string): number[] {
  return ir.outcomes.filter((o) => o.satisfiedBy.includes(stepId)).map((o) => o.id);
}

/**
 * Whether the emitted code actually reaches for the repo dayjs. Asked of the emitted text
 * rather than of the IR: a value builder brings dayjs in just as a withinMinutesOfNow
 * comparator does, and only one of those is visible in the verb.
 */
function needsTimePreamble(emitted: string): boolean {
  return /\bdayjs\b/.test(emitted);
}

/**
 * The removal for one created thing: which capture holds its id, and the repo's own snippet for
 * deleting it.
 *
 * cumulocity-ui has no `cy.deleteDevice`, so `createDevice` names `inventoryCascadeDelete` -
 * a hand-written cascade delete the conventions file records rather than papers over. The IR
 * never carries the call; it only says which capture holds the id.
 */
interface Removal {
  /** The capture the created id is bound to, e.g. `deviceId`. */
  idFrom: string;
  /** The module-scoped name the afterEach reads, e.g. `createdDeviceId`. */
  holder: string;
  snippet: string;
}

function removalsFor(ir: IrDocument, conventions: EffectiveConventions): Removal[] {
  const snippets = (conventions.effectiveIdioms.teardown ?? {}) as Record<string, unknown>;
  const removals: Removal[] = [];
  // `ir.steps`, not `allSteps`: the holder is assigned in the loop over `ir.steps` further down,
  // so walking setup here emitted an afterEach guarded by a variable nothing ever assigns. The
  // two loops now agree by construction, and the linter refuses a capture in setup outright.
  for (const step of ir.steps) {
    const idFrom = step.undo?.idFrom;
    const name = step.callRepoHelper?.name;
    if (!idFrom || !name) continue;
    const move = conventions.commands.blessed.find((m) => m.name === name);
    const key = move?.teardown;
    const snippet = key ? snippets[key] : undefined;
    if (typeof snippet !== "string") continue;
    removals.push({
      idFrom,
      holder: `created${idFrom.charAt(0).toUpperCase()}${idFrom.slice(1)}`,
      snippet,
    });
  }
  return removals;
}

export function compile(input: CompileInput): CompileResult {
  const { ir, mode, conventions } = input;
  const runtime = new Set<string>(Object.keys(ir.vars ?? {}));
  const ctx: EmitContext = {
    conventions,
    runtime,
    ...(input.facts ? { facts: input.facts } : {}),
  };

  const setupStatements: EmittedStatement[] = [];
  const statements: EmittedStatement[] = [];
  const collects: { id: string; label: string; within: string }[] = [];
  const body: string[] = [];

  const push = (step: IrStep, text: string, depth: number): void => {
    statements.push({
      stepPath: stepPath(ir, step),
      stepId: step.id,
      outcomes: outcomesFor(ir, step.id),
      text,
    });
    body.push(indentBlock(text, depth));
  };

  // Vars become const declarations at the top of the it() body. Every one is a real identifier
  // in the emitted TypeScript, which is what makes interpolation know a template literal from
  // a quoted string.
  // Setup emits first, and with no names in scope: it runs in beforeEach, before the test body
  // binds anything. Its statements lead the source map so a failure there names its setup entry.
  const setup: string[] = [];
  for (const step of ir.setup ?? []) {
    const text = emitStepStatement(
      step,
      { conventions, runtime: new Set(), ...(input.facts ? { facts: input.facts } : {}) },
      mode
    );
    if (!text) continue;
    setupStatements.push({
      stepPath: stepPath(ir, step),
      stepId: step.id,
      outcomes: outcomesFor(ir, step.id),
      text,
    });
    setup.push(indentBlock(text, 2));
  }
  for (const line of conventions.effectiveIdioms.beforeEach ?? []) {
    setup.push(indentBlock(`${line};`, 2));
  }
  // The repo's beforeEach idiom and an IR setup step can emit the same call. A duplicated
  // cy.login is harmless but visibly foreign, and it is the kind of thing a reviewer notices
  // before anything else in the file.
  const seenSetupLines = new Set<string>();
  const dedupedSetup = setup.filter((line) => {
    const key = line.trim();
    if (seenSetupLines.has(key)) return false;
    seenSetupLines.add(key);
    return true;
  });

  const declarations = Object.entries(ir.vars ?? {}).map(
    ([name, value]) => `const ${name} = ${emitValue(value, ctx)};`
  );

  // The model writes a flat step list; the compiler is where the .then() blocks go. Nesting is
  // a fact about Cypress's async chain, not a fact about the test.
  // Both back-ends reset. A probe spec is thrown away with the run that made it, but the device
  // it created is not: that is real state on a real tenant, and a probe is the mode most likely
  // to leave some, because a probe is the mode that fails on purpose. Cypress runs afterEach
  // after a failing test, so the reset the spec would emit is the reset the probe needs.
  const removals = removalsFor(ir, conventions);

  let depth = 0;
  const closers: string[] = [];

  for (const step of ir.steps) {
    if (step.collect && mode === "probe") {
      collects.push({ id: step.id, label: step.collect.label, within: step.collect.within });
    }
    const text = emitStepStatement(step, ctx, mode);
    if (text === null) {
      body.push(
        indentBlock(
          step.stub
            ? `// probe: stub dropped (${step.id}) - a probe observes the real response`
            : `// probe: value-bearing assertion dropped (${step.id})`,
          depth
        )
      );
      continue;
    }

    if (!step.captures) {
      push(step, text, depth);
      continue;
    }

    runtime.add(step.captures);
    const opened = `${text.replace(/;$/, "")}.then((${step.captures}: any) => {`;
    push(step, opened, depth);
    closers.push(indentBlock("});", depth));
    depth += 1;
    // The holder is assigned where the capture binds, never earlier: before this line the id
    // does not exist, and an afterEach that fired then would delete nothing while looking as
    // though it had.
    for (const removal of removals) {
      if (removal.idFrom === step.captures) {
        body.push(indentBlock(`${removal.holder} = ${step.captures};`, depth));
      }
    }
  }

  while (closers.length > 0) {
    body.push(closers.pop() as string);
  }

  const helperNames = allSteps(ir)
    .filter((s) => s.callRepoHelper)
    .map((s) => (s.callRepoHelper as { name: string }).name);
  const preamble = collectPreamble(helperNames, ctx);

  const emittedCode = [...dedupedSetup, ...declarations, ...body].join("\n");
  // Both back-ends, not just spec mode. The probe emits the same blessed setup moves and the
  // same value builders, so it needs the same things in scope - and a probe that crashes on a
  // missing import collects nothing, which costs a whole run for no facts.
  const timePreamble = needsTimePreamble(emittedCode)
    ? (conventions.effectiveIdioms.timePreamble ?? [])
    : [];

  const suite = mode === "probe" ? `${ir.meta.suite} [probe]` : ir.meta.suite;
  const title = mode === "probe" ? `probe: ${ir.meta.title}` : ir.meta.title;
  // Both tag sets are facts the tool is given, never judgements it makes. The describe tags
  // come from the scout's mined placement table - choosing the directory chose them - and the
  // it tags come from the contract's author.
  // One tag is a bare string: this repo writes it that way 229 times against 4 one-element
  // arrays, and the oracle graded against writes `{ tags: '@requiresBackend' }`.
  const tagList = (tags: string[]): string =>
    tags.length === 1
      ? `{ tags: ${emitString(tags[0] as string)} }`
      : `{ tags: [${tags.map(emitString).join(", ")}] }`;
  const describeOptions =
    mode === "spec" && conventions.suiteTags.length > 0
      ? `, ${tagList(conventions.suiteTags)}`
      : "";
  const itOptions =
    mode === "spec" && (input.itTags ?? []).length > 0
      ? `, ${tagList(input.itTags as string[])}`
      : "";

  const head: string[] = [];
  if (mode === "probe") {
    head.push(
      "// GENERATED by c8y-cygen, probe back-end. THROWAWAY - never committed.",
      "// It collects and asserts nothing. Its only product is the facts document."
    );
  }
  head.push(...timePreamble);
  if (timePreamble.length > 0) head.push("");
  head.push(...preamble.imports);
  if (preamble.imports.length > 0) head.push("");
  head.push(...preamble.inlineSources);
  if (preamble.inlineSources.length > 0) head.push("");

  const holders = removals.map((r) => `${INDENT}let ${r.holder}: string | undefined;`);
  const afterEach =
    removals.length > 0
      ? [
          `${INDENT}afterEach(() => {`,
          ...removals.flatMap((r) => [
            `${INDENT}${INDENT}if (${r.holder}) {`,
            ...r.snippet
              .trimEnd()
              .split("\n")
              .map((line) => `${INDENT}${INDENT}${INDENT}${line.replace("${id}", `\${${r.holder}}`)}`),
            // Cleared after the delete so a second it() cannot delete the first one's device.
            `${INDENT}${INDENT}${INDENT}${r.holder} = undefined;`,
            `${INDENT}${INDENT}}`,
          ]),
          `${INDENT}});`,
          "",
        ]
      : [];

  const text = [
    ...head,
    `describe(${emitString(suite)}${describeOptions}, () => {`,
    ...(holders.length > 0 ? [...holders, ""] : []),
    ...(dedupedSetup.length > 0
      ? [`${INDENT}beforeEach(() => {`, ...dedupedSetup, `${INDENT}});`, ""]
      : []),
    ...afterEach,
    `${INDENT}it(${emitString(title)}${itOptions}, () => {`,
    ...declarations.map((d) => indentBlock(d, 2)),
    ...(declarations.length > 0 ? [""] : []),
    ...body.map((l) => (l === "" ? "" : indentBlock(l, 2))),
    `${INDENT}});`,
    "});",
    "",
  ].join("\n");

  return { text, statements: [...setupStatements, ...statements], collects };
}
