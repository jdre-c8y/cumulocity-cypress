# Map: c8y-cygen v2

## Destination

A reviewed design spec for **c8y-cygen v2**, committed on `c8y-e2e-generation-agents-2`,
with every load-bearing architecture decision locked and argued against a *measured*
oracle benchmark — ready to hand to a separate implementation effort that builds it as
`packages/c8y-cygen/`. The map is done when nothing architectural is left to decide.

This map plans; it does not implement. Reaching the destination produces a document,
not a working generator.

## Notes

**Domain.** LLM-agent-driven generation of Cypress E2E specs for Cumulocity UI
applications and plugins, using ground truth harvested from the running application
(rendered DOM, real selectors, real network traffic) rather than from source.

**Standing context every session must load:**

- Motivation and v1 lessons: `../../../c8y-cygen-v2-groundwork.md` (workspace root, outside this repo).
- v1 implementation, **reference only**: branch `c8y-e2e-generation-agents`, PR #862.
  Salvage is permitted but the burden of proof is reversed — nothing carries over by
  default, and "we already have it" is not an argument. Each piece must be re-derived
  from the motivation.

**Settled during charting (not ticket resolutions — do not re-litigate):**

- **Ranked success axes:** (1) reliability — unattended green; (2) cost — predictability
  as much as absolute figure. Architecture quality is *instrumental* to these, never a
  goal in itself.
- **Audience is team adoption**, not personal use. Output-location hygiene, tenant-data
  cleanup, cost predictability and docs are therefore in scope as adoption blockers, not
  polish.
- **Packaging:** v2 is its own workspace package `packages/c8y-cygen/`. It consumes
  `cumulocity-cypress`, `c8yctrl` and `c8ypact` through their **public APIs** and must
  not modify them.
- **Targets:** `Cumulocity-IoT/cumulocity-ui` (200 hand-written e2e specs; 154 once the
  46 documentation-screenshot ones are excluded) *and*
  Cumulocity UI **plugins**, e.g. `Cumulocity-IoT/c8y-ai-agents`. Plugins are loaded
  into a host app declaratively via `?remotes={"pkg":["Module",...]}` and use
  `ngx-components` from cumulocity-ui.
- **Autonomy stance:** unattended green is the goal, but a *structured* human-assist
  path (exact failing assertion + screenshot + proposed patch, human approves) is a
  first-class supported outcome, not a failure. Asking early beats burning $4 guessing.
- **Conventions acquisition:** a one-time automated scout pass per target repo *writes*
  a conventions file, which a human reviews and commits; every later run reads that
  static file. Never re-derive conventions live per run.
- **Selector strategy:** a documented preference ladder — `[data-cy]` -> custom element
  tag -> semantic role/label -> text content -> structural walking — picking the most
  robust selector actually available. `[data-cy]` coverage is *not* guaranteed: it
  exists on `ngx-components` elements but frequently not on a plugin's own components.
- **Genre scope:** both UI e2e specs *and* API-contract/pact roundtrip specs are in
  scope.
- **Scenario authoring assistance is in scope** — scenario design was v1's single
  biggest realised cost lever.
- **Precondition:** a reachable tenant with the app/plugin **already deployed**. v2
  never builds or serves the application under test.
- **"Green" means green without retries**, regardless of what the target repo's own
  `retries` config tolerates.

**Skills:** every session runs `/grilling` and `/domain-modeling`. Prototype tickets
also run `/prototype`; research tickets are resolved by a `/research` subagent.

## Decisions so far

<!-- one line per closed ticket: gist + link. Empty until the first ticket resolves. -->

- [Define the acceptance benchmark](issues/01-acceptance-benchmark.md) — five oracles at
  `it()` granularity (not spec-file), graded PASS / PASS-WITH-ASSIST / FAIL on green
  (first attempt, no retries) + outcome coverage + flow equivalence + house style. Bar:
  >=4 of 5 PASS, zero FAIL, baseline must PASS, plugin must at least ASSIST. Two grading
  modes, because the hard tier has no hand-written reference — and production never has
  one either. v1's reconstructed score: 1 PASS / 1 ASSIST / 3 unattempted. Definition and
  contracts in [`benchmark/`](benchmark/README.md).

- [Emission target: TypeScript spec, declarative DSL, or hybrid?](issues/03-emission-target.md) —
  **(c)**: the agent emits a declarative IR; a compiler turns it into house-style
  TypeScript, which is what lands in the repo. Convergence check passed on its
  pre-registered criterion (oracle B4 needed 0 new verbs), though growth is in
  *properties* not verbs (8 new). Carries two now-mandatory requirements: a **source map**
  from emitted assertions back to IR steps, and a **broken-file regression corpus** for the
  schema and linter — one capability addition silently cut schema coverage 3->2 during the
  prototype. Prototype: branch `prototype/03-emission-target` (`171af62`).


- [Ground truth: where does it come from, and what must go through the UI?](issues/02-ground-truth-and-setup-path.md) —
  **Ground truth is two substances, not one.** *Surface* (what's on the page) is dumped
  deterministically and never costs a model turn; *reachability* (how you got there) is
  answered from a committed index mined from the repo's 154 existing specs, then by
  residual agentic exploration only. v1 paid an LLM turn for both — half its browser tool
  surface was pure dumping.
  **One runtime: Cypress.** The harvester is a *probe spec* compiled from the **same IR**
  as the output through a second back-end, so what the tool verifies is what it ships.
  Standalone Playwright is out — v1's 144-line bespoke auth session was a fidelity gap, and
  a Playwright harvester structurally cannot run a blessed `cy.*` setup move. Facts leave
  via our own `c8y:cygen:facts` task and are an **ephemeral cached artifact**, not
  committed. `c8yctrl` leaves acquisition entirely; its value collapses to replay
  (ticket 04). The model is shown a **candidate table**, never DOM, under the invariant
  *no selector may enter the IR unless a probe observed it*.
  **The setup/SUT line is not principled — it is mechanical, in three parts:** setup is
  *enumerated* by a per-repo blessed vocabulary, not inferred; that vocabulary is closed at
  generation time (no blessed move ⇒ click through the UI, or propose one to human review;
  `cy.c8yclient` is never blessed); and fabrication must be *anchored* — a `stub` body
  comes from a blessed helper or by recorded mutation of an observed response, never
  invented. **The risk binds at exactly one place, the unanchored `stub`**, contained by
  the anti-gaming invariant that *no Expected Outcome may be satisfied by an assertion
  whose value traces to a `stub` in the same `it()`* (spies stay legal). `cy.intercept`
  splits into three IR verbs — `stub` / `spy` / `sync` — because a wrong `sync` is flaky
  but a wrong `stub` passes against a fiction. State: **always establish; reset only your
  own footprint**, matching the library's own create/delete pairings.
  Cost consequence: **the blessed vocabulary is the primary cost lever in the design.**
  Pre-registered tripwire: >~3 probe runs for one benchmark scenario reopens the
  Cypress-probe decision.

## Not yet specified

In scope, but not yet sharp enough to ticket. Graduates as the frontier advances.

<!-- graduated to tickets by the emission-target decision:
     Loop shape -> issues/10-loop-shape.md
     Heal granularity -> issues/11-heal-granularity.md
     new ticket raised by the ground-truth decision (not from fog):
     Probe mode -> issues/12-probe-mode-compiler.md -->

- **Cost predictability.** Pre-run estimate, hard budget ceiling, visible per-turn
  progress, distinguishing productive exploration from a stuck loop. v1 silently
  exhausted a 50-turn budget three times with no diagnostic signal. Depends on loop
  shape. Sharpened by the ground-truth decision: cost is now dominated by two countable
  units — probe runs and residual reachability turns — and the blessed setup vocabulary
  is the lever that moves both.
- **Autonomy handoff UX.** What the structured human-assist path actually presents, and
  how a human's answer re-enters the loop. The ground-truth decision gave it a first
  concrete trigger — "no blessed setup move exists for this precondition; approve one?" —
  but the general shape still depends on loop shape.
- **Agent runtime and prompt-cache strategy.** Anthropic Tool Runner (v1) vs. Agent SDK
  vs. Claude Code subagents; cache-breakpoint TTL. v1's 1-hour TTL fix was never
  empirically re-validated — treat as an unconfirmed hypothesis.
- **Deliverable assembly.** Final structure and location of the spec document itself.

## Out of scope

Ruled beyond this destination. Does not graduate; returns only as a fresh effort.

- **Proposing or adding `[data-cy]` attributes to component source.** Tempting — it
  would make generating a test also improve instrumentation — but it turns a test
  generator into a source-modifying refactoring tool, doubles the review surface, and
  lets a failed run leave stray attributes in production components. Deliberately
  deferred to a **follow-up effort** after v2 works.
- **Building or serving the app/plugin locally** so undeployed code can be tested.
  Genuinely valuable and closer to the real developer loop, but it adds a build
  orchestration surface to a tool that has not yet proven it can reliably write one
  spec. Bolt-on-able later without redesign.
- **Non-Cumulocity repos / arbitrary unknown conventions.** The target set is Cumulocity
  UI apps and plugins built on `ngx-components`. Generalising further before the tool
  works reliably on known conventions makes the design abstract and unfalsifiable.
