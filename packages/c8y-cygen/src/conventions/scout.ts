/**
 * The conventions scout: one pass, two outputs, two review standards.
 *
 *   conventions.yaml   reviewed line by line, committed. A stale entry here SHIPS.
 *   reach.index.json   a cache, not reviewed. A stale entry costs one probe run and
 *                      self-corrects, because it is read as priors and always verified live.
 *
 * They also differ in size, in key, and in what notices when they go stale, which is why they
 * are two files and not one.
 *
 * This miner is deterministic and cheap, so staleness needs no machinery of its own: re-run it
 * and diff the mined half. What it cannot do is enumerate the repo's commands - a source grep
 * cannot place a command registered by a third party's side effect, and an incomplete list turns
 * lint failures into run-time failures. That list comes from the registry probe below, which
 * needs a tenant and runs once.
 */
import fs from "node:fs";
import path from "node:path";

export interface MinedCounts {
  [pattern: string]: number;
}

export interface MinedDirectory {
  specs: number;
  tag: string | string[] | null;
}

export interface MinedConventions {
  repo: string;
  specFiles: number;
  placement: { specRoot: string; suffix: string; directories: Record<string, MinedDirectory> };
  formatter: { configFound: string | null; run: string[]; cwd: string };
  commandCalls: MinedCounts;
  apiSetup: { prefer: "request" | "c8yclient"; counts: MinedCounts };
  valueBuilderCandidates: MinedCounts;
  /** Every `cy.<name>(` a spec calls. The registry probe says which of these are real. */
  calledCommands: string[];
}

export interface ReachEntry {
  route: string;
  /** Spec files that navigate here, as priors - never copied unverified. */
  specs: string[];
  uses: number;
}

export interface ReachIndex {
  repo: string;
  minedAt: string;
  /** A cache. Not reviewed, and read as priors that are always verified live. */
  generated: true;
  routes: ReachEntry[];
  /** Navigations from a bound variable, which a literal scan cannot resolve. */
  unresolvedNavigations: number;
}

const SPEC = /\.cy\.ts$/;

function walkSpecs(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (SPEC.test(entry.name)) out.push(full);
    }
  };
  visit(root);
  return out;
}

function count(text: string, needle: string): number {
  let n = 0;
  let i = text.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = text.indexOf(needle, i + needle.length);
  }
  return n;
}

const NAVIGATE = /cy\.(visitAndWaitUntilPageLoad|visitAndWaitForSelector|visit)\(\s*(['"`])([^'"`]*)\2/g;
const NAVIGATE_BOUND = /cy\.(visitAndWaitUntilPageLoad|visitAndWaitForSelector|visit)\(\s*[A-Za-z_$]/g;
const CY_CALL = /cy\.([A-Za-z_$][\w$]*)\s*\(/g;
/**
 * Anchored on `describe(` and its title, so an `it`-level tag or a `tags:` key inside a fixture
 * literal is not read as the directory's own. Both happened against the host repo:
 * `authentication/` was mined as '@requiresBackend' (an it tag) where every describe says
 * '@authentication', and `documentation-screenshots/` as ['default','latest'] - a field of an
 * IApplicationVersion object. Those values went into a reviewed file and from there would have
 * gone into every spec the directory generated.
 */
const DESCRIBE_TAGS =
  /\bdescribe(?:\.only|\.skip)?\s*\(\s*(['"`])(?:[^'"`\\]|\\.)*?\1\s*,\s*\{[^{}]*?tags:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g;

/**
 * Route normalisation. A leading-slash inconsistency alone merged the host repo's top route
 * from 67 hits to 148, so it is done before anything is keyed.
 */
export function normaliseRoute(route: string): string {
  const withoutTemplate = route.replace(/\$\{[^}]*\}/g, "*");
  const leading = withoutTemplate.startsWith("/") ? withoutTemplate : `/${withoutTemplate}`;
  return leading.replace(/\/+$/, "") || "/";
}

export function mineConventions(repo: string, specRoot = "cypress/e2e"): MinedConventions {
  const root = path.join(repo, specRoot);
  const files = walkSpecs(root);

  const directories: Record<string, MinedDirectory> = {};
  const tagVotes: Record<string, Record<string, number>> = {};
  const commandCalls: MinedCounts = {};
  const called = new Set<string>();
  const builders: MinedCounts = {};
  const api: MinedCounts = { "cy.request(": 0, "cy.c8yclient(": 0, "cy.c8yclientf(": 0 };

  for (const file of files) {
    const relative = path.relative(root, file);
    const directory = relative.split(path.sep)[0] ?? ".";
    const text = fs.readFileSync(file, "utf8");

    const entry = directories[directory] ?? { specs: 0, tag: null };
    entry.specs += 1;
    // Tallied, not first-file-wins. dataAndControlTeam has 24 describes agreeing and one that
    // does not; whichever the walk reached first used to decide the whole directory.
    const seen = tagVotes[directory] ?? (tagVotes[directory] = {});
    for (const match of text.matchAll(DESCRIBE_TAGS)) {
      const tags = match[2] as string;
      seen[tags] = (seen[tags] ?? 0) + 1;
    }
    directories[directory] = entry;

    for (const pattern of Object.keys(api)) api[pattern] = (api[pattern] ?? 0) + count(text, pattern);

    for (const match of text.matchAll(CY_CALL)) {
      const name = match[1] as string;
      called.add(name);
      commandCalls[name] = (commandCalls[name] ?? 0) + 1;
    }

    // Seeded from what the repo actually writes, not from a minimal list. A short vocabulary
    // fires assist constantly, which is the adoption failure that matters most here.
    for (const pattern of [
      "Cypress._.now()",
      "Cypress._.cloneDeep(",
      "Cypress._.clone(",
      "Cypress._.times(",
      "dayjs(",
      "Cypress.env(",
      "new Date(",
    ]) {
      const n = count(text, pattern);
      if (n > 0) builders[pattern] = (builders[pattern] ?? 0) + n;
    }
  }

  // The directory's tag is the one most of its describes carry. A tie is broken by the tagging
  // that reads first, so the result does not depend on directory-walk order.
  for (const [directory, votes] of Object.entries(tagVotes)) {
    const entry = directories[directory];
    if (!entry) continue;
    const ranked = Object.entries(votes).sort(
      ([a, na], [b, nb]) => nb - na || a.localeCompare(b)
    );
    entry.tag = ranked[0]?.[0] ?? null;
  }

  const prettierrc = [".prettierrc.yaml", ".prettierrc.json", ".prettierrc", ".prettierrc.js"]
    .map((name) => ({ name, full: path.join(repo, name) }))
    .find((c) => fs.existsSync(c.full));

  return {
    repo: path.basename(path.resolve(repo)),
    specFiles: files.length,
    placement: { specRoot, suffix: ".cy.ts", directories },
    formatter: {
      // null is a real answer: a repo with no config gets prettier's defaults, which is exactly
      // what its own developers get.
      configFound: prettierrc?.name ?? null,
      run: ["node_modules/.bin/prettier", "--write", "{file}"],
      cwd: ".",
    },
    commandCalls,
    apiSetup: {
      prefer:
        (api["cy.c8yclient("] ?? 0) + (api["cy.c8yclientf("] ?? 0) > (api["cy.request("] ?? 0)
          ? "c8yclient"
          : "request",
      counts: api,
    },
    valueBuilderCandidates: builders,
    calledCommands: [...called].sort(),
  };
}

export function mineReachIndex(repo: string, specRoot = "cypress/e2e"): ReachIndex {
  const root = path.join(repo, specRoot);
  const byRoute = new Map<string, ReachEntry>();
  let unresolved = 0;

  for (const file of walkSpecs(root)) {
    const relative = path.relative(repo, file);
    const text = fs.readFileSync(file, "utf8");

    for (const match of text.matchAll(NAVIGATE)) {
      const route = normaliseRoute(match[3] as string);
      const entry = byRoute.get(route) ?? { route, specs: [], uses: 0 };
      entry.uses += 1;
      if (!entry.specs.includes(relative)) entry.specs.push(relative);
      byRoute.set(route, entry);
    }
    unresolved += [...text.matchAll(NAVIGATE_BOUND)].length;
  }

  return {
    repo: path.basename(path.resolve(repo)),
    minedAt: new Date().toISOString(),
    generated: true,
    routes: [...byRoute.values()].sort((a, b) => b.uses - a.uses),
    unresolvedNavigations: unresolved,
  };
}

/**
 * The enumeration probe: a throwaway spec that reads the command registry after the support
 * file has loaded.
 *
 * Exact by construction, and the only method that finds a command arriving through a
 * third-party registration call - `cy.verifyDownload` reaches the host repo through
 * `require('cy-verify-downloads').addCustomCommand()` with no `Cypress.Commands.add` anywhere
 * in it. It is also what resolves a double registration, where the repo's signature wins and
 * the two signatures are not compatible, so a merged grep would emit the wrong arity.
 *
 * It reads `cy` itself rather than a registry internal. Cypress 15 removed both
 * `Cypress.Commands._commands` and `Cypress.Commands.getAll()`; every registered command is a
 * function-valued key on `cy` regardless, which is the fallback this probe always named and is
 * not a private API. Running it a second time with no support file gives a stock baseline, and
 * the difference between the two lists is exactly what this repo registers.
 *
 * Costs a tenant, which a grep would not. Worth it: this list is what makes the linter's
 * "is this helper real?" check sound, and it is why a phantom fails at lint time with no probe
 * run rather than at run time.
 *
 * Runs once per repo, at scout time. Never during generation.
 */
export function registryProbeSpec(outputFile: string): string {
  return `// GENERATED by c8y-cygen, conventions scout. THROWAWAY - never committed.
// It asserts nothing. Its only product is the command list.
describe('c8y-cygen: enumerate registered commands', () => {
  it('dumps every command callable on cy', () => {
    var names = Object.keys(cy).filter(function (key) {
      return typeof cy[key] === 'function';
    });

    cy.writeFile(${JSON.stringify(outputFile)}, {
      cypressVersion: Cypress.version,
      supportFileLoaded: Boolean(Cypress.config('supportFile')),
      count: names.length,
      names: names
    });
  });
});
`;
}

export interface RegistryProbeOutput {
  cypressVersion: string;
  supportFileLoaded: boolean;
  count: number;
  names: string[];
}

/**
 * Everything callable on `cy`, split by where it came from. `names` is what the linter checks a
 * helper against - a name absent from it is not real. `registered` is the repo's own surface,
 * which is what a human reads when deciding what to bless.
 */
export function classifyRegistry(
  withSupport: RegistryProbeOutput,
  stock?: RegistryProbeOutput
): { cypressVersion: string; count: number; commands: { name: string }[]; registered: string[] } {
  const builtins = new Set(stock?.names ?? []);
  const registered = withSupport.names.filter((n) => !builtins.has(n));
  return {
    cypressVersion: withSupport.cypressVersion,
    count: withSupport.names.length,
    commands: withSupport.names.map((name) => ({ name })),
    registered: stock ? registered.sort() : [],
  };
}

export interface RegistryDump {
  cypressVersion: string;
  count: number;
  commands: { name: string; type?: string; overwritten?: boolean }[];
}

/**
 * The draft the human reviews. Deliberately a draft: `blessed` starts empty, because what a
 * generated spec MAY use is the safety boundary and the only set a human curates.
 */
export function draftConventionsYaml(
  mined: MinedConventions,
  registry: RegistryDump | null
): string {
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push("# DRAFT, written by the c8y-cygen conventions scout. Review every line before committing.");
  push("#");
  push("# `available` is generated and not reviewed line by line. `blessed` is the safety");
  push("# boundary and starts EMPTY on purpose: available != blessed != idiomatic, and only a");
  push("# human decides what a generated spec may use. A move that is available and unblessed");
  push("# produces a spec that is correct and visibly foreign.");
  push();
  push("schemaVersion: 1");
  push(`repo: ${mined.repo}`);
  push("kind: app");
  push();
  push("minedFrom:");
  push(`  corpus: { specFiles: ${mined.specFiles} }`);
  push();
  push("placement:");
  push(`  specRoot: ${mined.placement.specRoot}`);
  push(`  suffix: ${mined.placement.suffix}`);
  push("  directories:");
  for (const [name, dir] of Object.entries(mined.placement.directories)) {
    push(`    ${name}: { specs: ${dir.specs}, tag: ${dir.tag ?? "null"} }`);
  }
  push();
  push("formatter:");
  push(`  run: [${mined.formatter.run.map((a) => `'${a}'`).join(", ")}]`);
  push(`  cwd: '${mined.formatter.cwd}'`);
  push(`  configFound: ${mined.formatter.configFound ?? "null"}`);
  push();
  push("commands:");
  push("  available:");
  if (registry) {
    push("    source: probe");
    push("    generated: true");
    push("    names:");
    for (const command of registry.commands) push(`      - ${command.name}`);
  } else {
    push("    # RUN THE REGISTRY PROBE. A grep cannot produce this list, and an incomplete list");
    push("    # turns lint failures into run-time failures.");
    push("    source: probe");
    push("    generated: true");
    push("    names: []");
  }
  push("  blessed: []  # <- a human fills this in");
  push("  idiomatic:");
  push("    auth: ''");
  push("    navigate: ''");
  push();
  push("apiSetup:");
  push(`  prefer: ${mined.apiSetup.prefer}`);
  push(
    `  counts: { ${Object.entries(mined.apiSetup.counts)
      .map(([k, v]) => `'${k}': ${v}`)
      .join(", ")} }`
  );
  push();
  push("# Seeded from what this repo actually writes. Measured occurrences in comments.");
  push("valueBuilders: []  # <- a human fills this in from the candidates below");
  for (const [pattern, uses] of Object.entries(mined.valueBuilderCandidates).sort(
    (a, b) => b[1] - a[1]
  )) {
    push(`#   ${pattern}  x${uses}`);
  }
  push();
  return lines.join("\n");
}
