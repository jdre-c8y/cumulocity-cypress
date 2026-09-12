/**
 * Reads what a probe run wrote, and validates it at the boundary.
 *
 * A malformed payload is the input to every downstream decision, so it is refused here rather
 * than producing a confidently wrong selector three modules later. A payload that is merely
 * *missing* is not malformed: a probe that dies partway is normal, and a facts document is
 * valid when incomplete.
 */
import fs from "node:fs";
import path from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
import { readPackageAsset } from "../support/assets.js";
import { rowsFromRawNodes, type RawNode } from "./rawNodes.js";
import type {
  CandidateRow,
  CollectedSurface,
  FactsDocument,
  ObservedRequest,
  PageComponent,
  ProvisionalMatch,
} from "../facts/types.js";

export class FactsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactsError";
  }
}

/** One network exchange as the browser half writes it, before the pathname and query are split. */
export interface RawExchange {
  method: string;
  url: string;
  status: number;
  createdId?: string;
  body?: unknown;
  bodyDropped?: boolean;
}

export interface ProbePayload {
  kind: "collect" | "provisional" | "network";
  label: string;
  stepId?: string;
  within?: string | null;
  observedAt: string;
  matchCount?: number;
  matchedIndex?: number;
  /** True when `within` matched nothing, so the payload carries an inventory instead of rows. */
  scopeMissed?: boolean;
  pageComponents?: PageComponent[];
  /** Present on a `network` payload, and on no other. */
  requests?: RawExchange[];
  /** How many exchanges the browser saw past its cap and did not record. */
  droppedExchanges?: number;
  /** Present on a `collect` or `provisional` payload, and on no other. */
  nodes?: RawNode[];
}

/**
 * Splits an observed URL into the two halves an intercept is keyed on.
 *
 * Done here rather than in the browser for the reason the rest of the payload is: every
 * reduction that can happen in node happens in node. It also has to be tolerant - a probe
 * watches whatever the app asks for, including URLs this parser would rather not see - so a
 * URL it cannot parse yields the whole string as the pathname and no query at all, which is
 * still a usable record of the exchange.
 */
export function splitUrl(url: string): { pathname: string; query?: Record<string, string> } {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://probe.invalid");
  } catch {
    return { pathname: url };
  }
  const query: Record<string, string> = {};
  for (const [k, v] of parsed.searchParams) query[k] = v;
  return Object.keys(query).length > 0
    ? { pathname: parsed.pathname, query }
    : { pathname: parsed.pathname };
}

let validator: ValidateFunction | undefined;

export function payloadSchemaBytes(): string {
  return readPackageAsset("probe/payload.schema.json");
}

function getValidator(): ValidateFunction {
  if (!validator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    validator = ajv.compile(JSON.parse(payloadSchemaBytes()));
  }
  return validator;
}

export function parsePayload(source: string, where: string): ProbePayload {
  let doc: unknown;
  try {
    doc = JSON.parse(source);
  } catch (e) {
    throw new FactsError(`${where}: not valid JSON - ${(e as Error).message}`);
  }
  const validate = getValidator();
  if (!validate(doc)) {
    const detail = (validate.errors ?? [])
      .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`)
      .join("; ");
    throw new FactsError(`${where}: does not match the probe payload schema - ${detail}`);
  }
  return doc as ProbePayload;
}

export interface ReadFactsOptions {
  runId: string;
  tenantUrl: string;
  appVersion?: string | null;
  /** True when the probe run reached its last collect point. */
  complete?: boolean;
}

/** Assembles one facts document from the files one probe run left behind, in write order. */
export function readFacts(dir: string, options: ReadFactsOptions): FactsDocument {
  const surfaces: CollectedSurface[] = [];
  const provisionalMatches: ProvisionalMatch[] = [];
  const requests: ObservedRequest[] = [];
  let exchangesDropped = 0;
  // Row ids are `<label>#<index>` and the browser restarts the index at 0 on every collect, so
  // two collects sharing a label produce two surfaces with fully overlapping ids. The re-probe
  // rung makes that the normal case: it re-collects the scope that failed, under the label the
  // IR already uses. `findRow` takes the first match, so the ladder would build a selector from
  // the older run's element and report no conflict. Disambiguate instead of dropping either -
  // the earlier surface may be a different state of the page, not a worse look at the same one.
  const labelsSeen = new Map<string, number>();
  const uniqueLabel = (label: string): string => {
    const seen = labelsSeen.get(label) ?? 0;
    labelsSeen.set(label, seen + 1);
    return seen === 0 ? label : `${label}~${seen + 1}`;
  };

  // One subdirectory per probe run, oldest first, then the payloads inside it in write order.
  // Reading them all is what makes facts accumulate across probe runs rather than replace each
  // other: a later run adds surfaces, it does not discard the ones already paid for.
  const files: string[] = [];
  if (fs.existsSync(dir)) {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        for (const inner of fs.readdirSync(full).sort()) {
          if (inner.endsWith(".json")) files.push(path.join(full, inner));
        }
      } else if (entry.name.endsWith(".json")) {
        files.push(full);
      }
    }
  }

  for (const full of files) {
    const payload = parsePayload(fs.readFileSync(full, "utf8"), full);
    const label = uniqueLabel(payload.label);

    if (payload.kind === "network") {
      exchangesDropped += payload.droppedExchanges ?? 0;
      // Ids are `<label>#<index>` for the same reason rows are: a stub names one of these from
      // a later, stateless model turn, so identity cannot be a position in an array.
      (payload.requests ?? []).forEach((exchange, i) => {
        const { pathname, query } = splitUrl(exchange.url);
        requests.push({
          id: `${label}#${i}`,
          method: exchange.method,
          url: exchange.url,
          pathname,
          ...(query ? { query } : {}),
          status: exchange.status,
          ...(exchange.createdId !== undefined ? { createdId: exchange.createdId } : {}),
          ...(exchange.body !== undefined ? { body: exchange.body } : {}),
          ...(exchange.bodyDropped ? { bodyDropped: true } : {}),
        });
      });
      continue;
    }

    const rows = rowsFromRawNodes(label, payload.nodes ?? []);

    if (payload.kind === "collect") {
      surfaces.push({
        label,
        within: payload.within ?? null,
        observedAt: payload.observedAt,
        rows,
        ...(payload.scopeMissed
          ? { scopeMissed: true, pageComponents: payload.pageComponents ?? [] }
          : {}),
      });
      continue;
    }

    const matchedId = `${label}#${payload.matchedIndex}`;
    provisionalMatches.push({
      stepId: payload.stepId ?? payload.label,
      matchCount: payload.matchCount ?? 0,
      surfaceLabel: label,
      row: rows.find((r) => r.id === matchedId) ?? null,
    });
    // A provisional match is also a surface: the model may point a later step at any row the
    // probe saw while resolving it, and it saw the whole scope.
    surfaces.push({
      label,
      within: payload.within ?? null,
      observedAt: payload.observedAt,
      rows,
    });
  }

  return {
    version: 1,
    runId: options.runId,
    tenantUrl: options.tenantUrl,
    appVersion: options.appVersion ?? null,
    surfaces,
    provisionalMatches,
    requests,
    ...(exchangesDropped > 0 ? { exchangesDropped } : {}),
    complete: options.complete ?? false,
  };
}

/**
 * Rows the model can actually do something with, first.
 *
 * A wide collect returns hundreds of rows and the summary shows a slice of them. In document
 * order that slice is the page's chrome - wrappers, layout divs, whatever the DOM happens to
 * open with - and the rows that carry a `data-cy` are somewhere past the cut. Ranking by what
 * identifies a row puts the useful ones in the window; nothing is hidden that was not hidden
 * before, and the full rows stay on disk for the ladder either way.
 */
export function rankRows(rows: CandidateRow[]): CandidateRow[] {
  const score = (row: CandidateRow): number => {
    let n = 0;
    if (row.attrs.dataCy) n += 8;
    if (row.attrs.title || row.attrs.name || row.attrs.ariaLabel) n += 4;
    if (row.actionable) n += 2;
    if (row.text) n += 1;
    if (row.visibility !== "visible") n -= 2;
    return n;
  };
  return [...rows].sort((a, b) => score(b) - score(a));
}

/**
 * The shape of a body, not the body.
 *
 * A stub names an exchange and the compiler reads the body out of the facts document, so the
 * model never needs to see one - and observed Cumulocity responses are large enough that
 * dumping them would be the biggest text this tool ever sends. What it does need is enough
 * shape to write a mutation path against - and a path like `managedObjects.0.name` names a
 * key one level below an array, so the depth has to clear an envelope, a list, and an element.
 */
const MAX_SHAPE_DEPTH = 3;

function describeBody(body: unknown, depth = 0): string {
  if (Array.isArray(body)) {
    return body.length === 0
      ? "[]"
      : `[${body.length} x ${depth < MAX_SHAPE_DEPTH ? describeBody(body[0], depth + 1) : "..."}]`;
  }
  if (body !== null && typeof body === "object") {
    const keys = Object.keys(body as Record<string, unknown>);
    if (depth >= MAX_SHAPE_DEPTH) return "{...}";
    return `{${keys
      .slice(0, 12)
      .map((k) => `${k}: ${describeBody((body as Record<string, unknown>)[k], depth + 1)}`)
      .join(", ")}${keys.length > 12 ? ", ..." : ""}}`;
  }
  return typeof body === "string" ? "str" : String(body);
}

/**
 * The one-line-per-row summary the model is shown. It never sees the rows themselves: under the
 * ladder it no longer chooses a selector, it names a target loosely, so the ancestor lists would
 * be tokens spent on work the ladder already did. The candidate table is the largest text the
 * tool would ever send.
 */
export function summariseFacts(
  facts: FactsDocument,
  maxRowsPerSurface = 120,
  maxExchanges = 60
): string {
  const lines: string[] = [];
  for (const surface of facts.surfaces) {
    // A missed scope is reported as a miss, not as an empty surface. An empty surface reads as
    // "the page has nothing in it"; the miss plus the inventory reads as "you named it wrong,
    // and here is what it is called" - which is the only thing the next guess needs.
    if (surface.scopeMissed) {
      const inventory = (surface.pageComponents ?? [])
        .map((c) => (c.count > 1 ? `${c.tag} x${c.count}` : c.tag))
        .join(", ");
      lines.push(
        `# ${surface.label}  (within ${surface.within ?? "page"})  NOTHING MATCHED THAT ` +
          `SCOPE, so no rows were collected. The page carries these components - name one of ` +
          `them instead:`,
        inventory || "(the page carries no custom elements at all)"
      );
      continue;
    }
    lines.push(`# ${surface.label}  (within ${surface.within ?? "page"})`);
    for (const row of rankRows(surface.rows).slice(0, maxRowsPerSurface)) {
      const label = row.attrs.dataCy
        ? `data-cy=${row.attrs.dataCy}`
        : row.attrs.title
          ? `title=${row.attrs.title}`
          : row.text
            ? `"${row.text.slice(0, 40)}"`
            : "";
      const marks = [
        row.actionable ? "actionable" : "",
        row.visibility !== "visible" ? row.visibility : "",
        row.repeat.siblingsLike > 1 ? `1 of ${row.repeat.siblingsLike}` : "",
      ].filter(Boolean);
      lines.push(
        `${row.id}  ${row.tag}  ${label}${marks.length ? `  [${marks.join(", ")}]` : ""}`
      );
    }
    if (surface.rows.length > maxRowsPerSurface) {
      lines.push(
        `... ${surface.rows.length - maxRowsPerSurface} further rows, ranked below these and ` +
          `still on disk. A narrower \`within\` would have shown you all of them.`
      );
    }
  }
  for (const match of facts.provisionalMatches) {
    lines.push(
      `provisional ${match.stepId}: matched ${match.matchCount} element(s)` +
        (match.row ? `, row ${match.row.id}` : ", no row recorded")
    );
  }
  // Without this the model cannot write a stub at all. `fromRequest` has to name something, and
  // this is the only place it ever learns what was observed - which is the point: it names an
  // exchange and the compiler reads the body, so it never sees a body to retype.
  if (facts.requests.length > 0) {
    lines.push("", "# network exchanges a stub may derive from");
    // Bounded like the rows above, and for the same reason: this block goes into every prompt
    // of every later iteration, on a metered API, and each line carries a body shape three
    // levels deep plus a decoded query string that can be 180 characters on its own.
    for (const r of facts.requests.slice(0, maxExchanges)) {
      const query = r.query
        ? "  ?" +
          Object.entries(r.query)
            .map(([k, v]) => `${k}=${v}`)
            .join("&")
        : "";
      const size =
        r.body === undefined
          ? "  NO BODY, so no stub can derive from it"
          : `  ${describeBody(r.body)}`;
      lines.push(`${r.id}  ${r.method} ${r.pathname} -> ${r.status}${query}${size}`);
    }
    if (facts.requests.length > maxExchanges) {
      lines.push(
        `... ${facts.requests.length - maxExchanges} further exchange(s), still on disk. Name a ` +
          `narrower collect point to see the ones from the state you care about.`
      );
    }
  }
  if (facts.exchangesDropped) {
    lines.push(
      `NOTE the probe saw ${facts.exchangesDropped} further exchange(s) past its per-flush cap ` +
        `and did not record them. If the one you need is absent, collect closer to the traffic.`
    );
  }
  return lines.join("\n");
}
