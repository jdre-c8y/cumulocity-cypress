import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { readPackageAsset } from "../support/assets.js";
import type {
  Conventions,
  ConventionsOverride,
  EffectiveConventions,
  Idioms,
  ValueBuilder,
} from "./types.js";

export class ConventionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConventionsError";
  }
}

let validator: ValidateFunction | undefined;

/** The bytes that ship, read once. Not a rebuilt object: key order is not contractually stable. */
export function conventionsSchemaBytes(): string {
  return readPackageAsset("conventions/conventions.schema.json");
}

function getValidator(): ValidateFunction {
  if (!validator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    validator = ajv.compile(JSON.parse(conventionsSchemaBytes()));
  }
  return validator;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((e) => `  ${e.instancePath || "/"} ${e.message ?? ""}`)
    .join("\n");
}

/**
 * Shape by schema, then the rules that matter by hand. The split is deliberate: a schema
 * silently loses coverage when a capability is added, and these three checks are what stop
 * a phantom helper from linting clean and failing only once Cypress runs.
 */
export function parseConventions(source: string, where: string): Conventions {
  let doc: unknown;
  try {
    doc = parseYaml(source);
  } catch (e) {
    throw new ConventionsError(`${where}: not valid YAML - ${(e as Error).message}`);
  }

  const validate = getValidator();
  if (!validate(doc)) {
    throw new ConventionsError(
      `${where}: does not match the conventions schema\n${formatErrors(validate.errors)}`
    );
  }
  const conventions = doc as Conventions;

  const available = new Set(conventions.commands.available.names);
  const phantoms = new Set(
    (conventions.commands.available.knownPhantoms ?? []).map((p) => p.name)
  );

  for (const move of conventions.commands.blessed) {
    if (phantoms.has(move.name)) {
      throw new ConventionsError(
        `${where}: '${move.name}' is blessed and also listed as a known phantom. A phantom is a name that looks real and is not.`
      );
    }
    if (move.binding !== "inline" && !available.has(move.name)) {
      throw new ConventionsError(
        `${where}: '${move.name}' is blessed but does not appear in commands.available.names, which the registry probe generates. Either the probe is stale or the move is not real.`
      );
    }
  }

  const builderIds = new Set<string>();
  for (const b of conventions.valueBuilders ?? []) {
    if (builderIds.has(b.id)) {
      throw new ConventionsError(`${where}: value builder '${b.id}' is declared twice.`);
    }
    builderIds.add(b.id);
  }

  for (const o of conventions.overrides ?? []) {
    for (const denied of o.valueBuilders?.deny ?? []) {
      if (!builderIds.has(denied)) {
        throw new ConventionsError(
          `${where}: override '${o.match}' denies value builder '${denied}', which is not declared.`
        );
      }
    }
  }

  return conventions;
}

export function loadConventions(file: string): Conventions {
  if (!fs.existsSync(file)) {
    throw new ConventionsError(
      `No conventions file at ${file}. It is reviewed and committed per repo; the scout writes it once.`
    );
  }
  return parseConventions(fs.readFileSync(file, "utf8"), file);
}

function globToRegExp(glob: string): RegExp {
  let body = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          body += "(?:[^/]+/)*";
        } else {
          body += ".*";
        }
      } else {
        body += "[^/]*";
      }
    } else if (c === "?") {
      body += "[^/]";
    } else {
      body += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${body}$`);
}

function normalise(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function matches(o: ConventionsOverride, specPath: string): boolean {
  const glob = normalise(o.match);
  return globToRegExp(glob).test(specPath) || globToRegExp(`${glob}/**`).test(specPath);
}

/**
 * Directory overrides applied once, so no later caller has to remember them. They are not
 * polish: a repo whose contracts directory needs byte-stable names gets a spec that passes
 * its first run and fails every one after if `uniqueName` survives there.
 */
export function resolveForSpecPath(
  conventions: Conventions,
  specPath: string
): EffectiveConventions {
  const target = normalise(specPath);
  const applied = (conventions.overrides ?? []).filter((o) => matches(o, target));

  let generate = true;
  let idioms: Idioms = { ...(conventions.idioms ?? {}) };
  const denied = new Set<string>();

  for (const o of applied) {
    if (o.generate === false) generate = false;
    if (o.idioms) idioms = { ...idioms, ...o.idioms };
    for (const d of o.valueBuilders?.deny ?? []) denied.add(d);
  }

  const builders: ValueBuilder[] = (conventions.valueBuilders ?? []).filter(
    (b) => !denied.has(b.id)
  );

  return {
    ...conventions,
    generate,
    effectiveIdioms: idioms,
    effectiveValueBuilders: builders,
    deniedValueBuilders: [...denied],
    appliedOverrides: applied.map((o) => o.match),
  };
}
