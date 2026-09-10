/**
 * The conventions file: reviewed, committed, per-repo, and read by every run.
 *
 * Two artifacts come out of one scout pass and they have two review standards. This is the
 * reviewed one - a stale entry here ships. Its companion, the reachability index, is a
 * cache: a stale entry there costs one probe run and self-corrects.
 *
 * It holds no quote style and no indent. Running the repo's own formatter reproduces its
 * house style with zero profile fields, and a quote *preference* emits
 * `cy.get("[data-cy="..."]")`, which does not parse.
 */

/** How a blessed move reaches the emitted spec. */
export type Binding = "global" | "import" | "inline";

/**
 * Whether a move creates real state, fabricates one, or does neither. Load-bearing:
 * fabrication is legal only through a blessed helper or by mutation of an observed
 * response, so the mark is what the linter reads.
 */
export type MoveKind = "real-state" | "fabricating" | "neither";

export type MoveRole = "auth" | "navigate" | "setup" | "teardown";

export interface BlessedMove {
  name: string;
  binding: Binding;
  kind: MoveKind;
  /** Required when binding is "import". */
  importFrom?: string;
  /** Required when binding is "inline": the compiler must emit this helper's source. */
  definedIn?: string;
  source?: string;
  /** The create/delete pairing. `null` is a real answer - cumulocity-ui has no deleteDevice. */
  pairsWith?: string | null;
  teardown?: string;
  uses?: number;
  role?: MoveRole;
  returns?: string;
  fabricates?: string[];
  /** The emitted call shape, `{0}`..`{n}` positional. Defaults to `cy.<name>(...args)`. */
  callShape?: string;
}

export interface CommandCollision {
  name: string;
  winner: "repo" | "library";
  repoSignature?: string;
  librarySignature?: string;
}

export interface KnownPhantom {
  name: string;
  why: string;
  realName?: string;
}

export interface AvailableCommands {
  /**
   * "probe", never "grep". A source grep cannot place six commands cumulocity-ui's specs
   * call, cy.verifyDownload among them - it arrives through
   * require('cy-verify-downloads').addCustomCommand() with no Cypress.Commands.add in the
   * repo at all.
   */
  source: "probe";
  generated: true;
  names: string[];
  collisions?: CommandCollision[];
  knownPhantoms?: KnownPhantom[];
}

export interface WithheldCommands {
  names: string[];
  uses?: number;
  why: string;
}

export interface IdiomaticCommands {
  /** The literal auth line, emitted verbatim. */
  auth?: string;
  /** The navigation call shape, with `{path}` substituted. */
  navigate?: string;
}

export interface ValueBuilder {
  /** The name the IR refers to: `now`, `uniqueName`, `isoTime`. */
  id: string;
  /** The emitted TypeScript, with `{param}` placeholders filled from the IR's args. */
  emit: string;
  uses?: number;
  /** For `envValue`: the key names only. Never the values - the env file holds credentials. */
  keys?: string[];
  prefixConvention?: string;
}

export interface FormatterConfig {
  /** argv, with `{file}` substituted. */
  run: string[];
  cwd?: string;
  /** null is a real value: a repo with no config gets prettier's defaults, as its people do. */
  configFound: string | null;
}

export interface PlacementDirectory {
  specs?: number;
  tag?: string | string[] | null;
}

export interface Placement {
  specRoot: string;
  suffix: string;
  directories?: Record<string, PlacementDirectory>;
}

export interface Idioms {
  describeOptions?: string | null;
  beforeEach?: string[];
  /** Import lines plus setup lines a `withinMinutesOfNow` comparator needs. */
  timePreamble?: string[];
  teardown?: Record<string, unknown>;
  uncaughtException?: string;
}

export interface ApiSetup {
  prefer: "request" | "c8yclient";
  counts?: Record<string, number>;
  requestIsOverwritten?: boolean;
  /** The emitted call shape: `{method}`, `{url}`, `{body}`. */
  callShape?: string;
}

export interface ConventionsOverride {
  /** A directory glob, matched against the spec's repo-relative path. */
  match: string;
  why: string;
  generate?: boolean;
  idioms?: Idioms;
  valueBuilders?: { deny?: string[]; why?: string };
}

export interface RuntimeFacts {
  viewport?: { width: number; height: number };
  defaultCommandTimeout?: number;
  retries?: { runMode?: number; openMode?: number };
  generatedSpecMustPassWithoutRetries?: boolean;
}

export interface Conventions {
  schemaVersion: 1;
  repo: string;
  kind?: "app" | "plugin";
  /** The repo's test-data prefix, for the opt-in prefix sweep and for uniqueName. */
  testDataPrefix?: string;
  minedFrom?: Record<string, unknown>;
  placement: Placement;
  formatter: FormatterConfig;
  commands: {
    available: AvailableCommands;
    blessed: BlessedMove[];
    withheld?: WithheldCommands[];
    idiomatic: IdiomaticCommands;
  };
  apiSetup?: ApiSetup;
  valueBuilders?: ValueBuilder[];
  idioms?: Idioms;
  runtime?: RuntimeFacts;
  overrides?: ConventionsOverride[];
}

/**
 * A conventions file with its directory overrides already applied for one spec path. The
 * compiler and the linter only ever see this, so neither has to remember to apply them.
 */
export interface EffectiveConventions extends Conventions {
  /** false when this directory is out of scope for generation. */
  generate: boolean;
  effectiveIdioms: Idioms;
  effectiveValueBuilders: ValueBuilder[];
  deniedValueBuilders: string[];
  appliedOverrides: string[];
}
