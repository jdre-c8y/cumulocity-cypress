# Define the acceptance benchmark

Type: task
Status: resolved
Blocked by: —

## Question

Nothing else on this map can be argued without a number. Reliability is the top-ranked
axis, so the map needs a *measurable* definition of it before any design ticket can be
judged. v1 spent ~15.8k lines on a shape that was never falsifiable.

Produce the benchmark:

1. **Select the oracle specs.** Classify candidates by *interaction cost* — how many
   UI-interaction turns the flow actually requires — not by feature area. Target five:
   - one read-only, single-page baseline (`cumulocity-ui`'s `events.cy.ts`, the known-cheap case v1 already reproduced),
   - two mid-complexity from `cumulocity-ui` (246 available under `cypress/e2e/<team>Team/`),
   - the interactive, form-filling / mode-toggling scenario that **beat v1** (quick-links widget configuration),
   - one from `c8y-ai-agents/cypress/e2e/no-llm/` — the plugin target, with the least `[data-cy]` coverage, which is the only tier that genuinely exercises the selector ladder.
2. **Write a scenario contract for each**, in the v1 Objective / Preconditions / Setup /
   Steps / Expected Outcomes / Style format (validated across two very different
   scenarios; salvage-permitted, but confirm it still holds for the plugin case and the
   contract genre).
3. **Define the measurement.** How a generated spec is compared to its oracle — flow
   equivalence, house-style conformance, and green-on-the-real-tenant. Green means green
   **without retries**, whatever the target repo's own `retries` config tolerates.
4. **State the pass bar** as a fraction of the five, and what per-run cost figure is
   recorded alongside it.

Deliverable: a benchmark definition committed under this effort, concrete enough that a
later ticket can say "this design scores N/5" rather than "this design feels better".

Note: selecting these is real judgement, not clerical work — record *why* each oracle
earned its tier, because the tiers are what make a later score interpretable.

## Answer

**Deliverable:** [`benchmark/README.md`](../benchmark/README.md) plus five scenario
contracts in [`benchmark/scenarios/`](../benchmark/scenarios/).

### The ticket's own premise needed two corrections

**1. The unit of an oracle is a test, not a spec file.** v1's proven M7 oracle was an
*extract* — the single `it('Verify the event for a device shows respective event
details')` block, source lines 75–114, plus its `describe`/`beforeEach`/`eventObj`. v1's
frozen copy says so in its header. This is not pedantry: at file granularity
`events.cy.ts` scores 16 interaction points and looks mid-complexity; at test
granularity the actual oracle scores **1**. And some files are unusable as a unit
entirely — `c8y-ai-agents`'s `agent-management.cy.ts` scores 176 across 1486 lines, while
individual tests inside it score 5–29. All five oracles are therefore `file:line` + title.

**2. "Flow equivalence" is unavailable for the hard tier, because it has no oracle.**
v1's own scenario file states it: *"Genuinely new coverage — there is no hand-written
oracle spec for this flow."* The benchmark therefore has **two grading modes**, and the
more important observation is that **in production there is never an oracle** — oracle
mode is a scaffold for validating the generator; open mode is the actual workload. One
open-mode oracle is kept: enough to measure the real thing, few enough that subjective
grading cannot dominate.

### The five oracles

Selected by an interaction-cost proxy — mutating interactions + navigations, counted per
`it()` body — measured across **1393 `it()` blocks** in both target repos.

| id | tier | oracle | cost | asserts | style | mode |
|---|---|---|---|---|---|---|
| B0 | baseline / regression floor | `ui:dataAndControlTeam/events.cy.ts:75` | 1 | 8 | integration | oracle |
| B1 | intercept-writing | `ui:appEnablementTeam/widget-asset-selector.cy.ts:69` | 10 | 10 | mocked | oracle |
| B2 | **hazard** | `ui:appEnablementTeam/cockpitWidgets.cy.ts:1687` | 11 | 24 | mocked | oracle |
| B3 | hard — the scenario that beat v1 | quick-links widget config preview | ~15 | n/a | mocked | **open** |
| B4 | plugin / **selector ladder** | `ai:no-llm/provider-management.cy.ts:9` | 17 | 17 | integration | oracle |

**B2 is the most valuable find.** It reproduces both v1-documented hazard classes *and*
has a hand-written reference to diff against, which v1's own hard scenario never did:
its assertion selector changes with the render mode
(`'[data-label*="e2eSeries"] .text-truncate'` → `'.text-truncate'`), and it asserts
`have.length 3` then `have.length 1` across a state change — the exact "expected N,
found 1" shape §3 says points nowhere near its cause.

**B4 surfaced a third hazard variant not in the groundwork: a state-dependent label.**
The same control reads *"Add global provider"* before a provider exists and *"Change
provider"* after; the oracle uses a regex on first use and a plain string on the second.
A generator that hard-codes the first label breaks on the second interaction.

### Measurement, verdicts, pass bar

Four axes: **green** (gate — first attempt, `retries=0`, regardless of the target repo's
own `retries` config), **outcome coverage** (v1's anti-gaming guardrail, checked
independently of Cypress's verdict), **flow equivalence** (oracle mode only, judged on
entry point / state-changing interactions / assertion subjects / no extra tenant
mutation — not textual diff), **house-style conformance**.

Per-oracle verdict is **PASS / PASS-WITH-ASSIST / FAIL**, reported as
`P PASS / A ASSIST / F FAIL` rather than a bare fraction — the PASS-vs-ASSIST split *is*
the measurement of the autonomy question settled during charting.

**Pass bar:** ≥4 of 5 PASS, zero FAIL, B0 must be PASS (regression floor), B4 must be at
least PASS-WITH-ASSIST. Not 5/5, because v1 missed unattended green on one hard scenario
and there is no evidence 5/5 is reachable — an unreachable bar makes the benchmark
decorative.

**v1's reconstructed score: 1 PASS / 1 ASSIST / 3 unattempted.** That is the number v2
has to beat, and the fact that three tiers were never attempted is why the v1 design was
never falsifiable.

**Cost gates:** no single oracle over **$15** (raised from $10 on 2026-09-13, on B1's first
real v2 data — see the benchmark README), median ≤$3, both derived from v1's measured
$4–8+ and both revisable on real v2 data. Recorded per run: USD, token split including
cache-creation (the §3 TTL-lapse signal), tool-call turns, wall clock, Cypress run count,
human intervention count and kind.

### Facts later tickets depend on

- **The v1 scenario-contract format held.** Applied to a plugin target (B4) with no new
  sections and no special-casing — plugin loading fits Preconditions, feature-flag
  mocking fits Setup. Salvaged on that evidence, per the reversed burden of proof.
- **Contract-genre benchmark deliberately deferred** to
  [UI e2e and API-contract specs: one pipeline or two?](05-two-genres-one-pipeline.md) —
  adding one now would pre-empt that decision. Nominated candidate, ready to adopt if
  ticket 05 says one pipeline: `ai:contracts/mcp-roundtrip.cy.ts:12` `"get MCP servers
  list"` (cost 0, 80 lines, 10 asserts, 1 `cy.request`).
- **Correction to a charting figure:** `cumulocity-ui` has **200** e2e spec files, not
  246. The higher count included component tests and snapshot *directories* that are
  themselves named `*.cy.ts`.
- **Repo-divergent navigation idioms**, for the conventions scout: `cumulocity-ui` uses
  `cy.visitAndWaitUntilPageLoad(path, false)`, `c8y-ai-agents` uses
  `cy.visitAndWaitForSelector(path)`. Alongside the auth divergence already recorded.
- **B2 depends on repo helpers** — a describe-level `openWidgetConfig()`, an imported
  `ensureInlineControlsExpanded` from `./global-context/globalContextHelpers`, and
  fixtures under `widgets/dpt/` — so it also tests whether a generator reuses repo
  helpers instead of reinventing them. Relevant to the conventions scout's capture set.
- **Duplicate test titles already exist in the wild**, for the hygiene ticket:
  `c8y-ai-agents`'s `agent-management.cy.ts` carries `"add, edit and delete an agent"` at
  both `:24` and `:634`, and `"should create simple agent with system message"` at both
  `:171` and `:711`. So "same title in the target repo" cannot by itself be the
  duplicate-detection signal.
- **Benchmark tenant preconditions:** both targets deployed; writable tenant for B0
  (creates device, posts event) and B4 (persists a global provider); B1/B2/B3 fully
  mocked and read-only. `Cypress.env('remotes')` required for B4.
- **Designated substitute for B2** if it proves too large for one session:
  `ui:appEnablementTeam/global-context/globalContextWidgetModeTransitions.cy.ts:31`
  (cost 16, 187 lines, 18 asserts) — same hazard class, cheaper in interactions, longer.
  Substitution must be recorded, not silent.

No new tickets surfaced. The benchmark *harness* — the thing that runs oracles and
records verdicts — is implementation, not a decision, so it belongs to the
implementation effort, not this map.
