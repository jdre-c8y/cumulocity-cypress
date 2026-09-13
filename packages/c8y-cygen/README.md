# c8y-cygen

Generates a Cypress E2E spec for a Cumulocity UI application from a scenario contract, and scores
it against the acceptance benchmark.

This is the **B0 slice**: the thinnest thing that can generate a spec for the B0 oracle and score
it. Not a feature-complete c8y-cygen — the slice that produces the first real number. A FAIL on B0
is a successful outcome, provided the attempt log explains it; an unmeasured design is not.

Sources of authority, in order: the seventeen tickets in `.scratch/c8y-cygen-v2/issues/` —
sixteen resolved, plus `17-anchored-scope-and-observed-values.md`, which the first live B1 run
reopened against ticket 07 and which is **not yet built** —
the ubiquitous language in `.scratch/c8y-cygen-v2/CONTEXT.md`, the acceptance contract in
`.scratch/c8y-cygen-v2/benchmark/README.md`, and `PLAN-01-b0-slice.md` beside this file.

## The shape of it

```
contract + conventions
  -> [author or refine the IR]   the only model stage; a fresh stateless session each time
  -> [compile: probe or spec]    deterministic, no model
  -> [run Cypress]               no model; the only metered operation
  -> facts | pass | diagnostic
  -> back to refine
```

There are no phases. "Gather ground truth" is not one: it is an early iteration compiled in probe
mode because the IR did not yet lint. The linter is the stop condition — an under-probed spec IR
cannot lint, so *am I done gathering?* is a free local check rather than a judgement.

Two things are metered, and both sit behind an interface: **runs Cypress** and **calls the model**.
That is the only structural concession to testability, and it is what lets the whole loop be
driven end to end with no tenant and no API key.

## Using it

```bash
# once per target repo
npm run cygen -- init  --repo ../../../cumulocity-ui-e2e
npm run cygen -- scout --repo ../../../cumulocity-ui-e2e

# free, and it repairs every cost estimate at once - do this before quoting any figure as measured
npm run cygen -- count-tokens \
  --repo        ../../../cumulocity-ui-e2e \
  --contract    cypress/e2e/dataAndControlTeam/events-generated.scenario.md \
  --conventions conventions/cumulocity-ui.conventions.yaml

# one action, one scored verdict
npm run cygen -- run \
  --repo        ../../../cumulocity-ui-e2e \
  --contract    cypress/e2e/dataAndControlTeam/events-generated.scenario.md \
  --conventions conventions/cumulocity-ui.conventions.yaml \
  --style       integration \
  --base-url    "$C8Y_BASE_URL"
```

`run` needs a reachable, **writable** tenant (B0 creates a device and posts an event) and an
Anthropic API key. Nothing else in this package needs either.

### B0 runs in integration style, and its contract's own `Style` line cannot be honoured

B0's contract, frozen verbatim from v1, declares `Style: mocked`. Under mocked style the event is
served by a stubbed intercept, so outcomes 4 through 7 would assert values that trace to a stub in
the same test — which the anti-gaming invariant forbids outright. A mocked B0 is not a different
style; it is unbuildable under the design's own rule. So pass `--style integration`, and raise the
stale line as a separate correction rather than editing a file that was frozen on purpose.

## What is here

| Module | Where | What it owns |
| --- | --- | --- |
| Contract reader | `contract/` | the seven-section contract (`## Tags` is the seventh); unknown sections pass through |
| Conventions | `conventions/` | the reviewed file, its schema, the miner, the registry probe |
| IR | `ir/` | the schema, the semantic linter, the anti-gaming guard, the frozen/free split |
| Ladder | `ladder/` | candidate rows plus a declared cardinality in, a path out — or a refusal |
| Compiler | `compiler/` | two back-ends sharing their setup emitters, plus the source map |
| Probe runtime | `probe/` | the browser half, the node boundary, the facts document |
| Cypress driver | `cypress/` | the module API, the config override, parse-before-truncate |
| Agent | `agent/` | prompt assembly, three cache breakpoints, the manual loop |
| Attempt log | `attempt/` | append-only, kept in full, one entry per iteration |
| Budget | `budget/` | Cypress runs, and model turns beside them |
| Scorer | `scorer/` | axis A and axis B; C and D go to a human |
| Working area | `workarea/` | `.cygen/`, the lock, the output path, the provenance header, the stray-file check |

## Two constraints on this package's own code

**No `import.meta`.** The repository runs one jest at the root, which loads these specs through a
CommonJS path, so `import.meta` is a syntax error at test time. Files that ship beside the source
(`*.schema.json`, `domain-notes.md`, `probe/runtime.js`) are read through
`support/assets.ts`, which resolves from `__dirname`, and `scripts/copyAssets.mjs` copies them into
`dist/` at build time.

**Schemas are files, not string constants.** They are read verbatim so their bytes are a function
of the file rather than of the code path that assembled them — a schema rebuilt at request time
has no contractually stable key order, and a changed schema is the one cache invalidation with no
escape hatch.

## Tests

```bash
npm test           # this package, through the root jest config
npm run typecheck
```

No test asserts that Cypress passes. That needs a tenant, and it is what the benchmark run is for.
Tests cover the deterministic half exhaustively; the metered half is covered by injection and by
one real run.

Two seams carry most of it. **Seam 1, the IR** — feed an IR document, assert on the emitted
TypeScript, the linter's verdict, or the source map. **Seam 2, the facts document** — feed recorded
candidate rows and a declared cardinality, assert on the path that comes out. Neither asserts on
how a module got there.

The **broken-file corpus** in `ir/lintIr.spec.ts` is mandatory and grows with every capability
added. One planted defect per rule. It exists because adding one optional field once cut schema
coverage from three defects caught to two, silently, breaking the linter's verb detection and the
compiler's verb lookup at the same time — one capability, three breakages, nothing failing.

The **cache-read check** in `agent/cacheRead.spec.ts` costs two real API calls and is skipped
unless `C8Y_CYGEN_LIVE_CACHE_CHECK=1`. A caching regression is silent: requests keep succeeding and
only the bill changes.

## Deliberately not here

The assist packet's human-facing rendering (the detection and the recorded stop condition are
here); the run manifest and the tenant sweep; oracles B2, B3 and B4, and with them fragments,
render branches and plugin loading; the plugin target repo; the contract genre, which is refused
at lint time on IR shape rather than attempted; replay; and cost estimation before a run, which
now has the baseline it needed.

`spy`, the third of ticket 02's intercept verbs, is also not here. Asserting on a request needs an
extractor family over `cy.wait('@a').its('request')` that nothing has yet, so a `spy` today would
emit exactly what a `sync` emits — and a verb that silently does another verb's job is worse than
an absent one. `stub` and `sync` are separate, which is the split that carries the safety property.

Two things this section used to list have since been built: the **heal rungs** (ticket 11 — a
patch turn and a re-probe, proven end to end by `scripts/healDrill.ts` against a live tenant), and
the **intercept verbs** for B1 (`stub`, `sync`, `waitFor`, plus the network half of the probe).

## Tripwires to watch

Conditions, not tasks. They should be seen every session, not ticked done in a backlog.

- More than roughly three probe runs for one scenario reopens the Cypress-probe decision.
- A generated spec failing on an ambiguous match the probe declared unique reopens the
  collect-scope rule.
- A scenario that cannot be expressed without branching on live page state reopens the
  no-conditionals limitation.
- Tenant flake measured as a material cause of budget exhaustion reopens replay — and only that
  axis reopens it; cost does not.
- A real failure yielding no parseable frame inside the emitted spec reopens the source map's shape.
- Per-iteration cost rising through a run points at the attempt log's full-IR snapshot, not at the
  caching strategy.

The first two are reported by the run itself: the probe tripwire in the report's notes, and the
run start-to-start gaps, which are what the one-hour cache TTL decision turns on and which nothing
had ever measured.
