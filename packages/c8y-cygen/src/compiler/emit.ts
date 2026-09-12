/**
 * The emitters both back-ends share.
 *
 * Sharing is not tidiness. The moment probe mode and spec mode emit a blessed move differently,
 * the fidelity argument that motivated the whole one-IR design leaks - and "worked when I
 * explored, fails in the spec" becomes possible again.
 */
import type { EffectiveConventions } from "../conventions/types.js";
import type { BlessedMove } from "../conventions/types.js";
import type {
  CallRepoHelperBody,
  IrValue,
  RequestBody,
  RouteMatcher,
  StubBody,
  StubMutation,
  SyncBody,
  WaitForBody,
} from "../ir/types.js";
import type { FactsDocument } from "../facts/types.js";

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
 *
 * Quoting was never the only way to emit something that does not parse. A value read off the
 * page can carry a newline, and a newline inside `'...'` is an unterminated string literal - a
 * spec-level failure with no step location, burnt on a metered run. Anything beyond a plain
 * printable string goes through `JSON.stringify`, whose output is JavaScript string syntax and
 * which escapes the backslashes, quotes and control characters a hand-rolled emitter forgets.
 */
// The control characters are the point of the rule, and the point of this line.
// eslint-disable-next-line no-control-regex
const NEEDS_ESCAPING = /['\\\u0000-\u001f\u007f]/;

export function emitString(value: string): string {
  if (!NEEDS_ESCAPING.test(value)) return `'${value}'`;
  return JSON.stringify(value);
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
  /** Needed only to emit a `stub`, whose body is read from an observed exchange. */
  facts?: FactsDocument;
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
  // No early return for zero args: a `callShape` carrying `{0}` took that branch and shipped
  // the placeholder into the spec verbatim. Substitution handles an empty list on its own.
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

/** An object key, quoted only when it is not a bare identifier. */
function emitKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : emitString(key);
}

/**
 * A value the probe observed, emitted as the literal it is.
 *
 * `emitString` and deliberately NOT `emitInterpolated`. The quoting rules are the same as
 * everywhere else - it is the interpolation that must not happen here. An observed string is
 * text a server sent, and a `${...}` inside one is a dollar and a brace that happened to be in
 * a response, not a reference the model wrote. Through the interpolator it would either emit a
 * template literal reaching for a name that does not exist or, worse, silently splice in one
 * that does.
 */
function emitObservedLiteral(value: unknown): string {
  if (typeof value === "string") return emitString(value);
  return JSON.stringify(value);
}

/**
 * The observed body, with the IR's recorded mutations spliced in at their paths.
 *
 * This is where "the model never authors a response body" is enforced, the same way the ladder
 * enforces "the model never authors a selector". The body comes out of the facts document; the
 * IR contributes only which exchange and which fields.
 */
export function emitStubBody(
  observed: unknown,
  mutations: readonly StubMutation[],
  ctx: EmitContext
): string {
  const pending = new Map(mutations.map((m) => [m.path, m.value]));

  const walk = (node: unknown, at: string): string => {
    if (pending.has(at)) {
      const value = pending.get(at) as IrValue;
      pending.delete(at);
      return emitValue(value, ctx);
    }
    const under = (key: string): string => (at === "" ? key : `${at}.${key}`);
    if (Array.isArray(node)) {
      return `[${node.map((v, i) => walk(v, under(String(i)))).join(", ")}]`;
    }
    if (node !== null && typeof node === "object") {
      const entries = Object.entries(node as Record<string, unknown>).map(
        ([k, v]) => `${emitKey(k)}: ${walk(v, under(k))}`
      );
      // Real Cumulocity bodies are full of empty objects - `c8y_IsDevice: {}` is how the
      // platform marks a fragment as present - so this branch is taken constantly.
      return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
    }
    return emitObservedLiteral(node);
  };

  const text = walk(observed, "");
  if (pending.size > 0) {
    // A mutation that matches nothing is otherwise a silent no-op: the stub serves the body
    // unchanged and the spec reads as though the change took. It then fails at run time, on a
    // metered run, pointing nowhere near the IR.
    throw new CompileError(
      `stub mutation path(s) ${[...pending.keys()].map((k) => `'${k}'`).join(", ")} match nothing in the observed body. A path names a field that is there, e.g. 'managedObjects.0.name'.`
    );
  }
  return text;
}

/**
 * The route arguments, in whichever of the two house forms the matcher calls for.
 *
 * `method` + `url` emits the two-argument form the corpus writes most. Anything mentioning a
 * `pathname` or a `query` emits the object form, which is the only one that can say "this path,
 * and this query parameter exactly" - the shape B1's `$filter=` lookup needs.
 */
export function emitRouteMatcher(route: RouteMatcher): string[] {
  if (route.pathname === undefined && route.query === undefined) {
    if (route.url === undefined) {
      throw new CompileError("a route matcher needs a 'url', or a 'pathname'");
    }
    const url = emitString(route.url);
    return route.method ? [emitString(route.method), url] : [url];
  }

  const fields: string[] = [];
  if (route.method) fields.push(`method: ${emitString(route.method)}`);
  if (route.pathname !== undefined) fields.push(`pathname: ${emitString(route.pathname)}`);
  if (route.url !== undefined) fields.push(`url: ${emitString(route.url)}`);
  if (route.query) {
    const pairs = Object.entries(route.query).map(
      ([k, v]) => `${emitKey(k)}: ${emitString(v)}`
    );
    fields.push(`query: { ${pairs.join(", ")} }`);
  }
  return [`{ ${fields.join(", ")} }`];
}

export function emitStub(body: StubBody, ctx: EmitContext, stepId: string): string {
  const exchange = ctx.facts?.requests.find((r) => r.id === body.fromRequest);
  if (!exchange) {
    throw new CompileError(
      `step '${stepId}': stub derives from '${body.fromRequest}', which no probe observed. A stub body is never invented; it is an observed response with recorded changes.`
    );
  }
  if (exchange.body === undefined) {
    throw new CompileError(
      `step '${stepId}': exchange '${body.fromRequest}' was recorded without a body${exchange.bodyDropped ? " - it was over the size cap and dropped whole rather than clipped" : ""}, so there is nothing here to derive from.`
    );
  }
  const args = [
    ...emitRouteMatcher(body.route),
    emitStubBody(exchange.body, body.mutations ?? [], ctx),
  ];
  const alias = body.alias ? `.as(${emitString(body.alias)})` : "";
  return `cy.intercept(${args.join(", ")})${alias};`;
}

export function emitSync(body: SyncBody): string {
  return `cy.intercept(${emitRouteMatcher(body.route).join(", ")}).as(${emitString(body.alias)});`;
}

/** One alias is a string and several are a list, which is how the corpus writes both. */
export function emitWaitFor(body: WaitForBody, stepId: string): string {
  if (body.aliases.length === 0) {
    throw new CompileError(`step '${stepId}': waitFor names no alias`);
  }
  const refs = body.aliases.map((a) => emitString(`@${a}`));
  return body.aliases.length === 1
    ? `cy.wait(${refs[0]});`
    : `cy.wait([${refs.join(", ")}]);`;
}
