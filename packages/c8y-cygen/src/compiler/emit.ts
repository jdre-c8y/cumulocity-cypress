/**
 * The emitters both back-ends share.
 *
 * Sharing is not tidiness. The moment probe mode and spec mode emit a blessed move differently,
 * the fidelity argument that motivated the whole one-IR design leaks - and "worked when I
 * explored, fails in the spec" becomes possible again.
 */
import type { EffectiveConventions } from "../conventions/types.js";
import type { BlessedMove } from "../conventions/types.js";
import type { CallRepoHelperBody, IrValue, RequestBody } from "../ir/types.js";

export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompileError";
  }
}

/**
 * A quote *preference* is not enough: a profile naming `"` as preferred emitted
 * `cy.get("[data-cy="..."]")`, which does not parse. This is a real string emitter. The repo's
 * own formatter has the last word on which quote survives; this only has to be valid.
 */
export function emitString(value: string): string {
  if (!value.includes("'") && !value.includes("\\")) return `'${value}'`;
  if (!value.includes('"') && !value.includes("\\")) return `"${value}"`;
  return `\`${value.replace(/[\\`$]/g, "\\$&")}\``;
}

const RUNTIME_REF = /\$\{(\w+)\}/g;

/**
 * A string carrying `${name}` becomes a template literal, never a quoted string. The compiler
 * that got this wrong emitted `'...${Cypress._.now()}...'` inside single quotes and produced a
 * spec that navigated to a URL containing a literal dollar-brace, with no error anywhere.
 */
export function emitInterpolated(value: string, runtime: ReadonlySet<string>): string {
  const refs = [...value.matchAll(RUNTIME_REF)].map((m) => m[1] as string);
  if (refs.length === 0) return emitString(value);

  const unbound = refs.filter((r) => !runtime.has(r));
  if (unbound.length > 0) {
    throw new CompileError(`unbound runtime reference(s): ${unbound.join(", ")}`);
  }
  // A string that is exactly one reference is that identifier, not a template literal wrapping
  // it: cy.createDevice(deviceName), never cy.createDevice(`${deviceName}`).
  const sole = /^\$\{(\w+)\}$/.exec(value);
  if (sole) return sole[1] as string;
  return `\`${value.replace(/[\\`]/g, "\\$&")}\``;
}

function fillTemplate(template: string, args: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = args[key];
    if (v === undefined) {
      throw new CompileError(`value builder template needs '{${key}}' and none was given`);
    }
    return String(v);
  });
}

export interface EmitContext {
  conventions: EffectiveConventions;
  /** Names that are real identifiers in the emitted TypeScript: vars and bound captures. */
  runtime: ReadonlySet<string>;
}

/** Every runtime value comes from here. There is no raw-expression case, on purpose. */
export function emitValue(value: IrValue, ctx: EmitContext): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return emitInterpolated(value, ctx.runtime);

  if ("ref" in value) {
    if (!ctx.runtime.has(value.ref)) {
      throw new CompileError(`unbound runtime reference: ${value.ref}`);
    }
    return value.ref;
  }
  if ("builder" in value) {
    const builder = ctx.conventions.effectiveValueBuilders.find((b) => b.id === value.builder);
    if (!builder) {
      throw new CompileError(
        `no value builder '${value.builder}' in this repo's vocabulary`
      );
    }
    return fillTemplate(builder.emit, value.args ?? {});
  }
  if ("object" in value) {
    const entries = Object.entries(value.object).map(
      ([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : emitString(k)}: ${emitValue(v, ctx)}`
    );
    return `{ ${entries.join(", ")} }`;
  }
  return `[${value.list.map((v) => emitValue(v, ctx)).join(", ")}]`;
}

export function findBlessed(
  ctx: EmitContext,
  name: string
): BlessedMove {
  const move = ctx.conventions.commands.blessed.find((m) => m.name === name);
  if (!move) {
    throw new CompileError(
      `'${name}' is not a blessed setup move in this repo. Setup is enumerated, not inferred.`
    );
  }
  return move;
}

/**
 * A blessed move. Emitted identically in both back-ends - that is the point of this module.
 * A `callShape` on the move wins when it has one, because some idioms are a chain
 * (`cy.getAuth('admin').login()`) rather than a call.
 */
export function emitCallRepoHelper(body: CallRepoHelperBody, ctx: EmitContext): string {
  const move = findBlessed(ctx, body.name);
  const args = (body.args ?? []).map((a) => emitValue(a, ctx));
  if (move.callShape && args.length === 0) return `${move.callShape};`;
  if (move.callShape) {
    return `${move.callShape.replace(/\{(\d+)\}/g, (_w, i: string) => args[Number(i)] ?? "")};`;
  }
  return `cy.${body.name}(${args.join(", ")});`;
}

/**
 * A real API call for setup. Which of `cy.request` and `cy.c8yclient` a repo uses is a
 * conventions fact, not a safety fact; the safety property is anchoring, and the linter checks
 * it before anything reaches here.
 */
export function emitRequest(body: RequestBody, ctx: EmitContext): string {
  const url = emitInterpolated(body.url, ctx.runtime);
  const payload = body.body === undefined ? undefined : emitValue(body.body, ctx);
  const shape = ctx.conventions.apiSetup?.callShape;
  if (shape) {
    const filled = shape
      .replace("{url}", url)
      .replace("{method}", emitString(body.method))
      .replace("{body}", payload ?? "");
    // A shape with a {body} placeholder and no body leaves a dangling argument. Strip only that,
    // at the very end of the call - never a comma that happens to sit inside an emitted value.
    return `${filled.replace(/,\s*\)\s*$/, ")")};`;
  }
  const args = [url, emitString(body.method), payload].filter(
    (a): a is string => a !== undefined
  );
  const call = ctx.conventions.apiSetup?.prefer === "c8yclient" ? "c8yclient" : "request";
  return `cy.${call}(${args.join(", ")});`;
}

export function emitVisit(path: string, ctx: EmitContext): string {
  const pathExpr = emitInterpolated(path, ctx.runtime);
  const shape = ctx.conventions.commands.idiomatic.navigate;
  if (!shape) return `cy.visit(${pathExpr});`;
  return `${shape.replace("{path}", pathExpr)};`;
}

/** Imports and inline helper sources the emitted file needs, in a stable order. */
export interface Preamble {
  imports: string[];
  inlineSources: string[];
}

export function collectPreamble(names: Iterable<string>, ctx: EmitContext): Preamble {
  const imports = new Set<string>();
  const inlineSources: string[] = [];
  for (const name of new Set(names)) {
    const move = ctx.conventions.commands.blessed.find((m) => m.name === name);
    if (!move) continue;
    // A globally registered command needs no import at all. Emitting one for cy.createDevice
    // was a real defect: it is registered with Cypress.Commands.add, not exported.
    if (move.binding === "import" && move.importFrom) {
      imports.add(`import { ${name} } from ${emitString(move.importFrom)};`);
    } else if (move.binding === "inline" && move.source) {
      inlineSources.push(move.source.trimEnd());
    }
  }
  return { imports: [...imports].sort(), inlineSources };
}
