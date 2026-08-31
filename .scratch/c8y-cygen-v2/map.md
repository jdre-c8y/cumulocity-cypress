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

- [Loop shape: one agent session, or separated phases?](issues/10-loop-shape.md) —
  Neither: **one loop, one artifact, one kind of turn.** The model's only stage is *author
  or refine the IR*; compile is deterministic, the Cypress run needs no model. "Gather
  ground truth" is not a phase — it is an early iteration compiled in probe mode because
  the IR did not yet lint. **The linter is the stop condition**: an under-probed IR is
  unlinttable by construction, so "am I done gathering?" is a free local check.
  **Sessions are stateless and fresh**, reading IR + facts + diagnostic + an **append-only
  attempt log** from disk — the log is load-bearing, since without it fresh sessions
  oscillate. Corrects this ticket's own premise: prompt caching is **prefix-keyed, not
  session-keyed**, so a boundary costs only accumulated conversation, never the expensive
  static preamble. **Budget is denominated in Cypress runs** — the only metered operation —
  capped at **≤3 probe runs, ≤6 total**, which makes ticket 02's tripwire operational
  instead of aspirational. On failure: **patch from the diagnostic first, re-probe on the
  second failure.** One model throughout until the benchmark has a baseline. Assist fires
  at **four named trip conditions**, never at budget exhaustion alone.

- [Probe mode: the second compiler back-end](issues/12-probe-mode-compiler.md) —
  Both oracles fit in **one probe run** (cap 3); the tripwire does not fire, *structurally*.
  The enabling idea: the IR gains a **`provisional` selector** — a fragile structural guess
  that probe mode compiles and spec mode refuses, legal only because the probe is thrown
  away. Without it B0 needs 2 runs and B4 needs 4. **Probe runs = the length of the
  dependency chain of unknowns, not their number.** Resolution is **deterministic, not a
  model judgement**: the probe records which candidate row each provisional matched, and the
  ladder picks the selector — which *inverts* ticket 02's invariant from a check into a
  construction, making a hallucinated selector impossible rather than detectable. An
  ambiguous match refuses and routes to assist (a fifth trip condition). Two new verbs:
  `collect` (always scoped) and `settle` (declared, not inferred). Probe mode strips derived
  stubs but keeps blessed ones, so **it is always integration-shaped** — three of five
  oracles produce tenant-free specs that cannot be generated tenant-free. Facts: one
  document per run, entries individually cache-keyed; a probe dying partway still returns
  what it already collected. Prototype: `prototype/12-probe-mode` (`9a31ec8`), broken-file
  corpus 8/8. **Found by trying:** the spec back-end failed open on every probe-only
  construct, and the IR could not express the *baseline* oracle at all — raised as
  [Runtime values in a declarative IR](issues/15-runtime-values-in-ir.md).

## Unvalidated assumptions

<!-- Not part of the wayfinder template. Added because the destination is a design spec,
     and three load-bearing numbers in it have never been measured. Each carries the
     result that reopens its decision, which is the most a planning effort can do. -->

- **≤3 probe runs per scenario.** Measured structurally only: all collect points lie on one
  linear flow, so one run reaches them all *if every provisional selector hits*. The real
  figure is `1 + (provisional misses)`, and the miss rate depends on how good the
  reachability index is at seeding guesses — an index that does not exist yet. **Reopens
  [Ground truth](issues/02-ground-truth-and-setup-path.md)'s Q6** (Cypress probe vs. the
  Playwright hybrid) if exceeded.
- **Cost baseline.** The benchmark has never been run against anything, v1 included — its
  1 PASS / 1 ASSIST / 3 unattempted score is *reconstructed from the groundwork document,
  not observed*. Every cost claim in this map is therefore relative to an unmeasured origin.
- **One model throughout beats tiering.** Chosen in [Loop shape](issues/10-loop-shape.md)
  because a model-tier variable would make the first benchmark numbers uninterpretable.
  Revisit once a baseline exists.

Also tracked: the IR's **verb count** is now growing on an axis ticket 03's convergence
check was not watching. That check passed on *"oracle B4 needed 0 new verbs"* — scenario
growth. Ticket 12 added two verbs for a new *capability*. Not a falsification, but the next
ticket that adds a verb should say so out loud.

## Not yet specified

In scope, but not yet sharp enough to ticket. Graduates as the frontier advances.

<!-- graduated to tickets by the emission-target decision:
     Loop shape -> issues/10-loop-shape.md
     Heal granularity -> issues/11-heal-granularity.md
     new ticket raised by the ground-truth decision (not from fog):
     Probe mode -> issues/12-probe-mode-compiler.md
     graduated to tickets by the loop-shape decision:
     Autonomy handoff UX -> issues/13-assist-handoff.md
     Agent runtime and prompt-cache strategy -> issues/14-agent-runtime.md -->

- **Cost estimation.** Loop shape answered the *control* half — budget denominated in
  Cypress runs, ≤3 probe / ≤6 total, with legible per-run progress. What remains is the
  *prediction* half: estimating a scenario's cost before running it, so a human can
  decide whether it is worth attempting. That needs benchmark data, which does not exist
  yet — nothing has ever been scored.
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
