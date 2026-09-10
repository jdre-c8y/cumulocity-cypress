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
  emitValue,
  emitVisit,
  type EmitContext,
} from "./emit.js";
import type { EmittedStatement } from "./sourceMap.js";
import {
  allSteps,
  isProvisional,
  stepPath,
  verbOf,
  type AssertBody,
  type Cardinality,
  type IrDocument,
  type IrStep,
  type IrTarget,
  type SettleBody,
} from "../ir/types.js";
import type { EffectiveConventions } from "../conventions/types.js";

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
  /** Tool version, for the provenance header. Spec mode only. */
  toolVersion?: string;
}

const INDENT = "  ";

function cardinalityAssertion(cardinality: Cardinality): string | null {
  if ("atLeast" in cardinality) {
    return `.should('have.length.at.least', ${cardinality.atLeast})`;
  }
  // Cypress already fails a chain that resolves to nothing, and the corpus does not write
  // .should('have.length', 1) on every step. Emitting one would be correct and foreign.
  if (cardinality.exactly === 1) return null;
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

function withTimeout(expr: string, timeoutMs: number | undefined): string {
  if (timeoutMs === undefined) return expr;
  return expr.replace(/\)$/, `, { timeout: ${timeoutMs} })`);
}

function emitSettle(body: SettleBody, mode: CompileMode, stepId: string): string {
  const base = withTimeout(targetExpr(body.target, mode, stepId), body.timeoutMs);
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

function emitAssert(body: AssertBody, ctx: EmitContext, mode: CompileMode, stepId: string): string {
  const base = withTimeout(targetExpr(body.target, mode, stepId), body.timeoutMs);
  const operand = emitValue(body.operand, ctx);
  const cardinality = cardinalityAssertion(body.cardinality ?? { exactly: 1 }) ?? "";

  if (body.compare === "withinMinutesOfNow") {
    if (body.extract !== "text") {
      throw new CompileError(
        `step '${stepId}': withinMinutesOfNow reads text, not ${body.extract}`
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
      if (body.compare === "includes") return `${base}${cardinality}.should('contain.text', ${operand});`;
      if (body.compare === "equals") return `${base}${cardinality}.should('have.text', ${operand});`;
      return `${base}${cardinality}.invoke('text').should('match', new RegExp(${operand}));`;
    case "attribute": {
      if (!body.attribute) {
        throw new CompileError(`step '${stepId}': extract 'attribute' needs an attribute name`);
      }
      const read = `${base}${cardinality}.invoke('attr', ${emitString(body.attribute)})`;
      if (body.compare === "equals") return `${read}.should('equal', ${operand});`;
      if (body.compare === "includes") return `${read}.should('include', ${operand});`;
      return `${read}.should('match', new RegExp(${operand}));`;
    }
    case "value":
      if (body.compare === "equals") return `${base}${cardinality}.should('have.value', ${operand});`;
      return `${base}${cardinality}.invoke('val').should('include', ${operand});`;
    case "count":
      if (body.compare !== "equals") {
        throw new CompileError(
          `step '${stepId}': a count is compared with 'equals'; use a declared cardinality for 'at least n'`
        );
      }
      return `${base}.should('have.length', ${operand});`;
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
    case "click":
      return `${targetExpr(step.click!.target, mode, step.id)}.click();`;
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

export function compile(input: CompileInput): CompileResult {
  const { ir, mode, conventions } = input;
  const runtime = new Set<string>(Object.keys(ir.vars ?? {}));
  const ctx: EmitContext = { conventions, runtime };

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
    const text = emitStepStatement(step, { conventions, runtime: new Set() }, mode);
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

  const declarations = Object.entries(ir.vars ?? {}).map(
    ([name, value]) => `const ${name} = ${emitValue(value, ctx)};`
  );

  // The model writes a flat step list; the compiler is where the .then() blocks go. Nesting is
  // a fact about Cypress's async chain, not a fact about the test.
  let depth = 0;
  const closers: string[] = [];

  for (const step of ir.steps) {
    if (step.collect && mode === "probe") {
      collects.push({ id: step.id, label: step.collect.label, within: step.collect.within });
    }
    const text = emitStepStatement(step, ctx, mode);
    if (text === null) {
      body.push(indentBlock(`// probe: value-bearing assertion dropped (${step.id})`, depth));
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
  }

  while (closers.length > 0) {
    body.push(closers.pop() as string);
  }

  const helperNames = allSteps(ir)
    .filter((s) => s.callRepoHelper)
    .map((s) => (s.callRepoHelper as { name: string }).name);
  const preamble = collectPreamble(helperNames, ctx);

  const emittedCode = [...setup, ...declarations, ...body].join("\n");
  const timePreamble =
    mode === "spec" && needsTimePreamble(emittedCode)
      ? (conventions.effectiveIdioms.timePreamble ?? [])
      : [];

  const suite = mode === "probe" ? `${ir.meta.suite} [probe]` : ir.meta.suite;
  const title = mode === "probe" ? `probe: ${ir.meta.title}` : ir.meta.title;
  const describeOptions =
    mode === "spec" && ir.meta.tags?.length
      ? `, { tags: [${ir.meta.tags.map((t) => emitString(t)).join(", ")}] }`
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

  const text = [
    ...head,
    `describe(${emitString(suite)}${describeOptions}, () => {`,
    ...(setup.length > 0
      ? [`${INDENT}beforeEach(() => {`, ...setup, `${INDENT}});`, ""]
      : []),
    `${INDENT}it(${emitString(title)}, () => {`,
    ...declarations.map((d) => indentBlock(d, 2)),
    ...(declarations.length > 0 ? [""] : []),
    ...body.map((l) => (l === "" ? "" : indentBlock(l, 2))),
    `${INDENT}});`,
    "});",
    "",
  ].join("\n");

  return { text, statements: [...setupStatements, ...statements], collects };
}
