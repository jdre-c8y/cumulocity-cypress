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
- ~~**Genre scope:** both UI e2e specs *and* API-contract/pact roundtrip specs are in
  scope.~~ **Overturned** by [Two genres](issues/05-two-genres-one-pipeline.md), the ticket
  charted to decide it. v2 generates **UI e2e only** and refuses the contract genre.
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

- [Selector ladder, and fingerprinting selectors across render branches](issues/07-selector-strategy.md) —
  **The ladder is a path search, not a rung preference**: the primary key is *uniqueness*, the
  rung order only a tie-break, capped at three parts. Humans scope even when the leaf is already
  `[data-cy]`. A step now **declares its cardinality**, so refusal fires on a mismatch, never on
  `>1` — without this B2 is ungeneratable, and with it v1's useless *"found 1 instead of 9"*
  becomes *"declared 3, observed 1"*. That repricing **closes ticket 02's `Q8(c)`: no preventive
  second-state re-observation**, which keeps ticket 12's one-probe-run claim intact.
  A corpus study of **7,402 selectors across 211 hand-written specs** overturned the middle of the
  charted ladder — humans use `role` 18 times and `title` 1,335 — and showed `[data-cy]` is a
  minority rung in the **host** app too (29.2%), not only in plugins. Six rungs, a ban list
  (`c8yicon`, `ng-*`, `:nth-child`, `[value]`, `[href]`), `[type]` as a refinement only. A
  position is legal **only inside a repeating list**. The candidate table is **one flat table**,
  each row carrying its own ancestor list, so the ladder never needs a tree and the model is never
  shown a DOM; the model gets a **summary**, not the rows. Identity: a matched element is keyed by
  **the step that matched it**, a table row by **its resolved path** — a content fingerprint was
  rejected because the fields that would make it stable are the fields a branch change alters.
  Result: 6 exact / 3 shorter / 1 refused on ten oracle targets; 87.5% and 93.5% corpus agreement.
  **Found by trying:** Cypress aliases are not selectors and have no candidate row (241 in the
  corpus, 3 in B2) — raised on [Runtime values](issues/15-runtime-values-in-ir.md); and the single
  refusal is a **latent flake in B2's own oracle** (`cy.contains` matches a substring, and
  `e2eSeries` is a prefix of `e2eSeries2`) — raised on
  [Scenario authoring](issues/08-scenario-authoring-assist.md).
  Prototype: `prototype/07-selector-ladder` (`732afd0`).

- [Runtime values in a declarative IR: raw expressions and nesting scope](issues/15-runtime-values-in-ir.md) —
  **The IR holds no raw TypeScript.** Runtime values come from a **closed vocabulary of value
  builders**, by the same argument that made setup an enumerated vocabulary; an unknown builder
  stops and asks a human. Assertions split into **extractor + comparator + operand**, each from a
  closed list, so the vocabulary stops growing one verb per oracle. The IR stays a **flat step
  list** — a capture binds for the rest of the flow and the *compiler* places the `.then()`
  blocks, which keeps step ids flat and ticket 03's source map intact. Value captures, DOM
  aliases and intercept aliases are **one concept**: a capture names a *step*, never a selector,
  so ticket 07's invariant survives. A real `request` for setup is allowed where no helper exists,
  but its **body must be anchored** — every field traces to the contract, a capture or a builder.
  **Found by reading the real oracle rather than the prototype's copy:** ticket 12's
  *"B0 now compiles to the oracle's shape"* compiles a B0 with **three of seven outcomes**, and
  calls `postEvent` — **a helper that exists nowhere in either repo**, which linted clean because
  nothing checks that a blessed helper is real. **B0 does not pass today.** The bar does not bend:
  the IR grows.
  **Corrects ticket 02:** the blanket ban on `cy.c8yclient` is superseded — the plugin repo uses
  it 37 times and the host repo zero, so the choice is a *conventions* fact and the transferable
  rule is anchoring, not the ban. **Simplifies ticket 13:** three new trip conditions collapse
  into its existing first one, leaving five, not eight. Hands ticket 06 three hard requirements —
  enumerate real helpers, carry the seeded builder vocabulary, declare the API-setup idiom.

- [Conventions scout: what it captures, and its output format](issues/06-conventions-scout.md) —
  **Two artifacts, not one.** Ticket 02's "all three payloads are stale in the same way" is
  false: a stale style profile or helper list fails *silently*, a stale reachability index
  costs one probe run and self-corrects. So a reviewed `conventions.yaml` in the **target
  repo** (YAML + JSON Schema, matching the IR's own), and a generated reach index that is a
  **cache**. One scout pass, two outputs, two review standards.
  **`available` != `blessed` != `idiomatic`** — three sets, three consumers. `cumulocity-ui`
  registers 14 library commands with **zero call sites in 190 specs**, so ticket 02's blessed
  create/delete pairs are safe, correct and visibly foreign. The split also gives the linter
  two verdicts: *not real* is an IR bug, *real but unblessed* is ticket 13's first trip
  condition.
  **The list is probed, not grepped.** Six commands `cumulocity-ui` calls cannot be placed by
  any grep — `cy.verifyDownload` (14 uses) arrives via `require(...).addCustomCommand()`. A
  throwaway spec dumping the registry is exact by construction and resolves the three
  double-registrations whose signatures are incompatible. **`postEvent` now fails at lint time
  with no tenant.**
  **Style is mostly not ours to record:** running each repo's own prettier reproduced both
  repos' house quoting, escaping case included, with zero profile fields — so `quote` and
  `indent` leave the profile, and with them the class of defect that made ticket 12 emit
  unparseable `cy.get("[data-cy="…"]")`. `binding` is **ternary** (`global`/`import`/`inline`),
  which closes ticket 12's defect and adds the case it did not see. Directory **overrides are
  load-bearing**: `contracts/` must *deny* the `uniqueName` builder, or the spec passes its
  first run and fails every one after. `kind:` is **proposed** lexically (15/15) and approved
  by a human — the one miss, `createTenant`, creates state by clicking, which no lexical rule
  can see.
  **Found by trying:** the reachability index **seeds nothing** in the plugin repo — 0 of 34
  navigations use a route literal, and 2 distinct routes for 11 specs.
  **Corrects ticket 02:** `visitAndWaitToFinishLoading` exists nowhere; it was read out of a
  stale `@example` in the library's own `.d.ts`. Second phantom after `postEvent`, and this one
  was *read, not invented* — so extract from registration sites only.
  **Corrects ticket 15:** its `c8yclient` 37 is `c8yclient` 22 + `c8yclientf` 15; all 15
  `c8yclientf` calls are teardown.
  Prototype: `prototype/06-conventions-scout` (`f439eb6`), corpus 7/7, schema 7/7.

- [Can iterations replay against recorded traffic instead of a live tenant?](issues/04-replay-and-determinism.md) —
  **No. v2 heals against a live tenant.** The primitives permit replay with no library
  modification — `{ c8ypact: { id } }` decouples a recording from the spec that made it and
  *nothing* compares a recording's title to the current test, so a probe spec and the generated
  spec can share one pact; a catch-all `cy.intercept("**")` records everything and can live in a
  v2-injected support file, absent from the emitted spec. So the mechanical answer is *yes*.
  Declined anyway. **The decisive objection is anti-gaming:** ticket 02 contained fabrication risk
  at exactly one place, the unanchored `stub`, because a wrong stub *passes against a fiction*.
  Replay is an unanchored stub over the whole run **and it is self-recorded** — from this tool,
  this IR, the probe run. The invariant does not get harder to check; it goes **vacuous**. That
  objection did not exist when the ticket was charted.
  **Most of its value was already banked:** ticket 10 made sessions stateless (killing the
  ticket's own prompt-cache premise — and the 5-minute TTL is configurable anyway) and patches
  before re-probing, so few Cypress runs remain to cheapen; ticket 12 made selector resolution
  deterministic by construction, which was v1's dominant flake. Replay insulates against *tenant*
  flake, not tool flake.
  **And the configuration v2 needs has zero instances in either target repo.** Two things are
  called "pact": `apply` mode is a *live* request with the response matched after (not replay),
  and the one genuinely tenant-free replay in CI is `cumulocity-ui`'s **component** job — one
  Angular component in isolation, already 72 records / 2.6 MB worst case, against a full-shell
  spec that bootstraps the shell 10–17 times per file. `c8yctrl` appears in both repos only in
  `yarn.lock`. **`c8yclient` never replays at all.**
  **Found by measuring rather than guessing:** the host repo already labels the live-only failure
  class itself — `@requiresBackend`, **134 tests across 57 of 200 files (28.5%)**, CI-enforced,
  concentrated in auth and microservice lifecycle, and a *lower* bound. Adopted as a conventions
  fact for [Conventions scout](issues/06-conventions-scout.md) and as the first zero-cost hazard
  prior for [Scenario authoring](issues/08-scenario-authoring-assist.md).
  Pact matching **asserts**, overlapping the spec's own assertions on payloads and complementary
  on DOM — so the two genres want **opposite** settings of one switch, handed to
  [Two genres](issues/05-two-genres-one-pipeline.md).
  **Corrects ticket 02:** `c8yctrl`'s value "collapses to replay and defers wholly to ticket 04"
  now resolves — **`c8yctrl` leaves the design entirely.**
  **Corrects ticket 12's framing:** *"B1, B2, B3 cannot be generated tenant-free"* stands, and
  owes nothing — a reachable tenant is already a stated precondition of the whole design, so that
  line reads as a defect but is only an observation.
  Research: `research/04-replay-and-determinism` (`883e204`).

- [UI e2e and API-contract specs: one pipeline or two?](issues/05-two-genres-one-pipeline.md) —
  **Two efforts. The contract genre is out of scope**, and v2 **refuses** rather than trying.
  The ticket's own framing was wrong: *payload vs. DOM* is not the boundary — **16 host spec
  files already assert on a `cy.request` response** with no pact involved, and B0 does a real
  `cy.request` POST. What actually separates the genre is **zero DOM** (three commands in 1733
  lines), a **JSON Schema** as the assertion (12 inline blocks, one 60 lines), a **template over
  a typed profile table** importing the product's own model types, and pact as the oracle. Three
  of those four are *additions* to the IR, not a skippable browser phase.
  **The decisive objection is that ticket 10's stop condition does not exist here** — "an
  under-probed IR is unlinttable by construction" is a *probe* property, and with nothing to
  probe the loop loses its free "am I done?" check. Set against **23 `it()`s in one of two
  repos** (the host repo has **zero** — no `c8ypact`, no `c8yclient`) against 160 UI specs, for
  a genre that by the §1 motivation needs no eyes.
  **Refusal is a safety property, not tidiness:** a silently-attempted contract spec is scored
  by a recording v2 just made itself — ticket 04's unanchored stub, passing against a fiction.
  Criterion is **IR shape — zero DOM steps, refused at lint time**, not the directory; a
  measured reason, since `globalContextWidgetDisplayModes.cy.ts` has zero `cy.get` and is fully
  DOM-driven through an imported helper module, so any lexical rule misclassifies it. Ticket
  06's `contracts/` override survives as an early-refusal optimisation. Named cost: this refuses
  `branding.schema.cy.ts`, 1 real in-scope host spec of 154.
  **Two gains for the surviving genre:** response assertions enter the IR **narrowly** — two
  extractors (`status`, `body.<path>`) on ticket 15's closed list, explicitly not JSON Schema —
  without which 16 host files' pattern is ungeneratable; and emitted specs carry
  `{ c8ypact: { ignore: true } }` so ticket 04's auto-asserting pact layer cannot fail a spec on
  payload drift the model never authored.
  **Anti-gaming transfers unchanged, nothing added** — ticket 02 phrased it over *values*, not
  the DOM, and the probe already records responses. **Benchmark stays at five**: both new holes
  are *lint verdicts, not generation outcomes*, so they go to the broken-file corpus, not an
  oracle. Measured on the way: **no oracle asserts on a response payload** (B2's four are at
  `:154`/`:1333`, not its oracle at `:1687`). Adds **zero verbs**, two extractors, one lint rule.
  **Hands ticket 13 a sixth trip condition.** **Corrects ticket 06:** its `uniqueName` denial in
  `contracts/` is dead as an example — the conclusion that directory overrides are load-bearing
  survives, now carrying a *not-generatable* flag.


- [Scenario authoring: hazard checklist and cost signalling](issues/08-scenario-authoring-assist.md) —
  **There is no hazard checklist. There is an authoring interview.** Applied to the five
  oracles, the six candidate hazards fire on 13 of 30 cells (8 true / 5 false) — but the true
  ones are **circular**: every well-covered cell triggers on a warning *the author had already
  written into the prose* (`B2:67-69`, `B4:46-47`), which is the exact opposite of this ticket's
  audience. B0 and B1 are nearly invisible to the checklist and carry real hazards anyway. So the
  thing worth industrialising is the **annotation, not the audit**: seven questions in a skeleton
  scenario file, answered next to the step they concern, where the model reads them.
  **The scenario lint turns out to be empty.** Both proposed checks moved to the IR. *"Every
  Setup line has a blessed move"* requires matching contract prose to a repo inventory — the
  operation hazard 6 was measured failing — and is already exact as trip condition 1. *"Every
  outcome names a concrete value"* refuses **four of five oracles** (B1 and B3 carry zero
  literals in any outcome, 25 of 26 flagged); the missing property was never *literal* but
  **anchored**, and the defect is in v1's text-overlap matcher, so **each IR assertion now
  declares the Expected Outcome it satisfies** — a second duty for ticket 03's source map.
  **Two hazards struck, one repriced.** Hazard 4 dies because the design removed its cause —
  v1's cost was in *exploration*, which had no API shortcut; the probe now runs blessed moves.
  Hazard 5 dies as a check: the operative relation is **substring, not prefix** (the prefix rule
  misses B2's own case), the corpus false-positive rate is **68%** (8 true / 17 false over 25
  pairs), and the ladder already refuses ambiguity at zero FP one probe run later. Hazard 6's
  numbers are confirmed *exactly*, but its matcher returns **the same three files for B1, B2 and
  B3** and zero for B4 — and **B0 itself carries the tag**, so a blocking version would refuse
  the mandated regression floor. The fact stays in the conventions file; its consumer is the
  style decision.
  **Governance, which v1 measurably lacked:** admission = observed in a real failure; placement
  = checkable → a check, judgement → the interview; only a **fact** may block, so this ticket
  adds **no new gate**; growth = every assist event is a hazard candidate, promoted by a human
  from the attempt log. v1's domain notes begged in their own header to accumulate and got
  **two hand commits in their entire life**.
  **Found by measuring:** 13 further hazard classes live in the oracle specs that none of the
  six catch — held as candidates, not admitted, because they were seen in *specs, not failures*.
  Two are routed out: an asserted value that is a *formatted derivative* of the data (B2's
  contract quotes `15.34` where the fixture holds `15.34432`) becomes an interview question, and
  **a correction to [Selector ladder](issues/07-selector-strategy.md)** — a `data-cy` bound from
  translatable UI copy (`[attr.data-cy]="section.label"`) sits at rung 1 and survives a UI change
  like a text selector. **The contract format is unchanged**, a fourth consecutive ticket to
  leave it alone. Adds **zero verbs**, one IR property.

## Unvalidated assumptions

<!-- Not part of the wayfinder template. Added because the destination is a design spec,
     and three load-bearing numbers in it have never been measured. Each carries the
     result that reopens its decision, which is the most a planning effort can do. -->

- **≤3 probe runs per scenario.** Measured structurally only: all collect points lie on one
  linear flow, so one run reaches them all *if every provisional selector hits*. The real
  figure is `1 + (provisional misses)`, and the miss rate depends on how good the
  reachability index is at seeding guesses. **[Conventions scout](issues/06-conventions-scout.md)
  has now measured the seed, and in the plugin repo there is none:** 0 of 34 navigations use a
  route literal, and resolving the bindings yields **2 distinct routes for 11 specs**. So the
  host repo's index is rich (192 routes, 5.0 navigations each) and B4's one-probe-run figure
  has no support from this side at all. **Reopens
  [Ground truth](issues/02-ground-truth-and-setup-path.md)'s Q6** (Cypress probe vs. the
  Playwright hybrid) if exceeded.
- **Cost baseline.** The benchmark has never been run against anything, v1 included — its
  1 PASS / 1 ASSIST / 3 unattempted score is *reconstructed from the groundwork document,
  not observed*. Every cost claim in this map is therefore relative to an unmeasured origin.
- **A collect scope is wide enough to make its selectors safe.** [Selector ladder](issues/07-selector-strategy.md)
  measures uniqueness against the *collected surface*, and the probe collects inside a `within`.
  Three B4 targets therefore resolved *shorter* than the human wrote — correct, and cheaper, but
  only safe if the collect scope was wide enough. A narrow scope lets the ladder confidently emit
  a one-part selector that is ambiguous on the real page. **Reopens the collect-scope rule in
  [Probe mode](issues/12-probe-mode-compiler.md)** if a generated spec fails on an ambiguous match
  that the probe declared unique.
- **No scenario needs to branch on live page state.** [Runtime values](issues/15-runtime-values-in-ir.md)
  ruled a DOM conditional out of the IR: it creates a path that never runs, so the anti-gaming rule
  cannot prove an outcome was checked. No oracle *contract* requires one — but B2's human author
  wrote one defensively, and the corpus branches 32 times (`if ($…)`) plus 99 `.then(($el) => …)`.
  **Reopens** if a benchmark scenario, or a scenario a teammate actually writes, cannot be expressed
  without one.
- **Tenant flake is not a material cost.** [Replay](issues/04-replay-and-determinism.md)
  declined replay partly because the reliability it buys is insulation from *tenant* flake
  specifically, and tickets 10 and 12 already hold the tool-flake margin. Nothing has measured
  how often a live tenant is itself the cause of a failed iteration — the benchmark has never
  been run. **Reopens the replay decision** if, once a baseline exists, tenant flake is a
  material cause of budget exhaustion. It is the one axis replay uniquely still serves; cost is
  not, and should not reopen it.
- **The interview actually gets the annotation written.** [Scenario
  authoring](issues/08-scenario-authoring-assist.md) rests entirely on the claim that a prompted
  author will write down what an expert wrote unprompted — measured only in the negative, as the
  circularity that killed the checklist. No teammate has ever been handed the skeleton.
  **Reopens the interview's delivery** (a tool-run review pass over the finished scenario was the
  runner-up, declined for costing a model turn) if a first scenario written *with* the skeleton
  still fails on a hazard the interview asked about.

- **One model throughout beats tiering.** Chosen in [Loop shape](issues/10-loop-shape.md)
  because a model-tier variable would make the first benchmark numbers uninterpretable.
  Revisit once a baseline exists.

Also tracked: the IR's **verb count** is now growing on an axis ticket 03's convergence
check was not watching. That check passed on *"oracle B4 needed 0 new verbs"* — scenario
growth. Ticket 12 added two verbs for a new *capability*. Not a falsification, but the next
ticket that adds a verb should say so out loud. Ticket 07 added none — it added *properties*
(cardinality, visibility, repeat) and one algorithm. Ticket 15 added one verb (`request`) and two
closed vocabularies (value builders, extractor/comparator) — and said so.

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
  yet — nothing has ever been scored. [Scenario
  authoring](issues/08-scenario-authoring-assist.md) narrowed it further: the free text-derived
  signal it hoped for does not exist, because predicting cost from contract prose means matching
  prose to a repo inventory, which was measured failing. The cheapest signal left before a model
  turn is **the author's own interaction estimate**, asked directly.
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
- **The API-contract / pact roundtrip genre.** Ruled out by
  [Two genres](issues/05-two-genres-one-pipeline.md) — the ticket charted to decide it. It
  needs no eyes, which is the one thing this design supplies; it would grow the IR a second
  assertion language (JSON Schema), test-templating over a data table, and product-type
  imports; and it removes ticket 10's stop condition. Its whole surface is 23 `it()`s in one
  of two target repos. A **follow-up effort**, like `[data-cy]` below — not a resumption.
  v2 does not merely skip it: it **refuses**, because attempting it silently scores a spec
  against a recording v2 made itself.

- **Non-Cumulocity repos / arbitrary unknown conventions.** The target set is Cumulocity
  UI apps and plugins built on `ngx-components`. Generalising further before the tool
  works reliably on known conventions makes the design abstract and unfalsifiable.
