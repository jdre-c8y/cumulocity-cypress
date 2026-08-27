# c8y-cygen v2 — acceptance benchmark

Resolves [Define the acceptance benchmark](../issues/01-acceptance-benchmark.md).

The purpose of this document is to make every later design argument falsifiable. After
this exists, a design ticket may say *"this design scores 4 PASS / 1 ASSIST / 0 FAIL"*
instead of *"this design feels better"*.

---

## 1. The unit of an oracle is a test, not a spec file

v1's proven M7 oracle was **not** `events.cy.ts`. It was an extract — the single
`it('Verify the event for a device shows respective event details')` block, source lines
75–114, plus the `describe`/`beforeEach`/`eventObj` it depends on. v1's own frozen copy
says so in its header.

This matters more than it looks:

- At **file** granularity `events.cy.ts` scores 16 interaction points and looks
  mid-complexity. At **test** granularity the actual oracle scores **1**. Describing it
  as "the known-cheap read-only baseline" is only true at test granularity.
- Some spec files are unusable as a unit at all — `c8y-ai-agents/cypress/e2e/no-llm/agent-management.cy.ts`
  scores 176 interaction points across 1486 lines and 16 tests, but individual tests
  inside it score 5–29.

**Every oracle in this benchmark is therefore one `it()` block plus the setup it
depends on**, identified by `file:line` and title. A generation run targets one oracle.

### Interaction-cost metric

Selection used a mechanical proxy for how many live UI turns an agent must spend:

```
cost = count(.click|.dblclick|.rightclick|.type|.clear|.selectFile|.check|.uncheck|.select)
     + count(cy.visit)
```

counted within the `it()` body, with `shared` counted separately for interactions living
in `beforeEach`/helpers the test depends on. Recorded alongside: assertion count
(`.should`/`expect`), `cy.intercept` count, `cy.request`/`.c8yclient` count.

Measured over **1393 `it()` blocks** across both target repos. Distribution:

| cost | 0 | 1–5 | 6–12 | 13–25 | 26–50 | 51+ |
|---|---|---|---|---|---|---|
| tests | 446 | 723 | 174 | 41 | 7 | 2 |

The metric is a proxy, not truth — it cannot see that a single `.click()` opens a modal
requiring three exploration turns to understand. It is good enough to *stratify*
candidates, which is all selection needs.

**Correction to a figure used while charting:** `cumulocity-ui` has **200** e2e spec
files, not 246. The higher number counted component tests and — misleadingly — snapshot
*directories* that are themselves named `*.cy.ts`.

---

## 2. The five oracles

| id | tier | oracle | cost | asserts | icpt | style | mode |
|---|---|---|---|---|---|---|---|
| **B0** | baseline | `ui:dataAndControlTeam/events.cy.ts:75` | 1 | 8 | 0 | integration | oracle |
| **B1** | mid | `ui:appEnablementTeam/widget-asset-selector.cy.ts:69` | 10 | 10 | 3 | mocked | oracle |
| **B2** | hazard | `ui:appEnablementTeam/cockpitWidgets.cy.ts:1687` | 11 | 24 | 3 | mocked | oracle |
| **B3** | hard | quick-links widget config preview — **no reference exists** | ~15 est. | n/a | n/a | mocked | **open** |
| **B4** | plugin | `ai:no-llm/provider-management.cy.ts:9` | 17 | 17 | 0 | integration | oracle |

`ui:` = `cumulocity-ui/cypress/e2e/`, `ai:` = `c8y-ai-agents/cypress/e2e/`.

### Why each earned its tier

**B0 — `"Verify the event for a device shows respective event details"` (cost 1).**
The regression floor. v1 reproduced this end-to-end, house-style, green on a real
tenant. If v2 cannot, v2 is worse than v1 and nothing else about it matters. It is also
the only **integration-style** oracle with real tenant mutation (`cy.createDevice`, real
`cy.request('/event/events','POST')`), so it covers the non-mocked path. Cheap enough
that running it is never a reason to skip a benchmark pass.

**B1 — `"Verify asset properties widget retains correct device selection"` (cost 10).**
The intercept-writing tier. §1 of the motivation names intercepts explicitly as manual,
tedious, and weakly served by Cypress Studio — B1 is fully mocked, with five
`cy.intercept` calls including one keyed on a `query.query` `$filter=` expression that
must match exactly. It is self-contained (no shared helper interactions) and its
selectors are mostly `[data-cy]` with two deliberate escapes — `.parent().find('.chip, .tag')`
and `ng-form[name="vm.ngForm"] [title="Name"]` — so it exercises the low rungs of the
selector ladder without depending on them everywhere.

**B2 — `"Verify that a change in configuration applies to a view"` (cost 11, 24 asserts).**
**The most valuable oracle here.** It reproduces *both* hazard classes the v1
groundwork documented, and it has a hand-written reference to diff against — which
v1's own hard scenario did not:

- *Selector differs per rendered branch.* The assertion helper is called with a
  different selector depending on the render mode selected:
  `verifyTimelineValue('[data-label*="e2eSeries"] .text-truncate')` in the default
  Minimum state, then `verifyTimelineValue('.text-truncate')` after switching to
  Maximum. A generator that assumes one selector survives a mode change fails here.
- *Count assertion after a state change.* `should('have.length', 3)` initially, then
  `should('have.length', 1)` after unchecking a series — the exact
  "expected N, found 1" failure shape that §3 says points nowhere near its real cause.

It also depends on a repo fixture (`widgets/dpt/*.json`), aliased intercepts consumed by
`cy.wait(['@dashboardObjects','@measurementSeries'])`, a describe-level helper
(`openWidgetConfig()`), and an imported cross-file helper
(`ensureInlineControlsExpanded` from `./global-context/globalContextHelpers`) — so it
also tests whether a generator reuses repo helpers instead of reinventing them.

**B3 — quick-links widget config preview (open mode).**
The scenario that actually beat v1: three runs, two of them producing no spec at all at
$4.22 and $2.42, and the third reaching green only after a human read a Cypress
screenshot and hand-patched two selector/assertion bugs. Kept because it is the only
tier that reproduces v1's documented failure, so it is the only one that can show the
failure is fixed. Its contract is salvaged from v1 (see §5).

**B4 — `"should add a global provider and be able to modify it"` (cost 17).**
The plugin tier, and the only tier that genuinely exercises the selector ladder, because
the plugin's own components carry little `[data-cy]`. Its selectors span four rungs:

```ts
cy.get("button").contains(/Change provider|Add global provider/)   // regex text content
cy.get("c8yai-provider-modal", { timeout: 60_000 })                // custom element tag
cy.get("c8yai-provider-modal input[name='model']")                 // attribute on plugin component
cy.get('[data-cy="select--dropdown-menu"]')                        // data-cy — ngx-components only
cy.get('[data-cy="agent--global-provider-name"]')                  // data-cy — plugin does have some
```

It carries a third hazard variant the other oracles do not: a **state-dependent label**
on one control. The same button reads *"Add global provider"* before a provider exists
and *"Change provider"* after — the oracle handles it with a regex on the first use and a
plain string on the second, because by then the state is known. A generator that hard-codes
the first label breaks on the second interaction.

It also exercises plugin loading (`/apps/administration/?remotes=${Cypress.env("remotes")}`)
and the plugin repo's divergent idioms — `cy.visitAndWaitForSelector` rather than
`cy.visitAndWaitUntilPageLoad`, `cy.getAuth("admin").login()` rather than
`cy.login(user, pass)`, and `cy.mockFeatureAsEnabled("ui.ai-agent-manager")` as a
precondition.

### Designated substitute

If B2 proves too large for a single generation session, substitute
`ui:appEnablementTeam/global-context/globalContextWidgetModeTransitions.cy.ts:31`
(cost 16, 187 lines, 18 asserts — "Dashboard → Widget → Show in widget transitions").
It is the same hazard class — mode transitions — and slightly cheaper in interactions,
but longer. **Record the substitution**; do not silently swap.

---

## 3. Measurement

Four axes per oracle. Green is a gate: if it fails, the others are not scored.

**A. Green** — binary, gate. The generated spec passes against the real tenant on the
**first** attempt with retries disabled (`--config retries=0`), regardless of what the
target repo's own config tolerates (`c8y-ai-agents` sets `retries: { runMode: 2 }`).
A spec that only passes on attempt 3 is flaky, and flaky specs are how a team learns to
distrust a suite.

**B. Outcome coverage** — binary, machine-checkable. Every Expected Outcome in the
scenario contract maps to at least one concrete `.should(...)`/`expect(...)` in the
generated spec, checked **independently of whether Cypress reports green**. This is v1's
hybrid anti-gaming guardrail, which §3 records as having done exactly its job in
practice — salvaged deliberately.

**C. Flow equivalence** — graded, **oracle mode only**. Not a textual diff; textual
diffing would penalise legitimate variation. Judged on four things:
1. same navigation entry point,
2. the same set of state-changing interactions, in an order that reaches the same states,
3. the same assertion *subjects* — the DOM facts asserted, not the phrasing,
4. no tenant mutation the reference does not make.

**D. House-style conformance** — graded. Selector-ladder rung chosen where a higher rung
was available; auth/navigation idiom matching the target repo; file location and naming;
reuse of existing repo helpers and fixtures rather than reinventing them; mocked vs
integration style consistent with the contract's `Style`.

### Verdicts

Per oracle, one of:

- **PASS** — A green, B complete, C and D acceptable, no human intervention.
- **PASS-WITH-ASSIST** — reached green only via the structured human-assist path. Record
  the number of interventions and what each one was. This is a *supported* outcome, not
  a failure (charting decision on autonomy), but it is not PASS.
- **FAIL** — never reached green, or B incomplete (outcomes gamed), or C/D unacceptable.

A benchmark result is reported as **`P PASS / A ASSIST / F FAIL`**, never as a bare
fraction, because the PASS-vs-ASSIST split is the direct measurement of the autonomy
question.

### Two grading modes, and why

**Oracle mode** (B0, B1, B2, B4) has a hand-written reference, so axis C is available.

**Open mode** (B3) has none. v1's own scenario file states it outright: *"Genuinely new
coverage — there is no hand-written oracle spec for this flow."* Open mode is graded on
A, B, D and a recorded human review verdict.

This is not a defect in B3 — it is the honest observation that **in production there is
never an oracle.** Oracle mode is a scaffold for validating the generator; open mode is
the actual workload. The benchmark keeps exactly one open-mode oracle: enough to measure
the real thing, few enough that subjective grading cannot dominate the score.

---

## 4. Pass bar and cost gates

**Pass bar:**

1. **≥ 4 of 5 PASS**, and
2. **5 of 5 at least PASS-WITH-ASSIST** — i.e. **zero FAIL**, and
3. **B0 must be PASS** — it is the regression floor; v1 already achieved it, and
4. **B4 must be at least PASS-WITH-ASSIST** — plugin support has to be real, not aspirational.

Why 4/5 and not 5/5: v1 missed unattended green on a single hard scenario and there is
no evidence 5/5 is reachable. An unreachable bar makes the benchmark decorative. 4 PASS
with zero FAIL is a genuine, falsifiable improvement on v1's documented state.

**v1's score on this benchmark, as far as it can be reconstructed:** B0 PASS,
B3 PASS-WITH-ASSIST (two hand-patched bugs, after two earlier attempts that produced no
spec at all), B1/B2/B4 never attempted. So **1 PASS / 1 ASSIST / 3 unattempted** — which
is precisely why the design was never falsifiable.

**Cost recorded per oracle per run** — not optional, it is half the point:

| field | note |
|---|---|
| USD total | the headline |
| input / output / cache-read / cache-creation tokens | cache-creation spikes are the §3 TTL-lapse signal |
| tool-call turns | v1 had a fixed 50-turn budget and no way to see why it was exhausted |
| wall clock, and Cypress run count | a run + attempt exceeding 5 min is the cache-lapse hazard |
| human interventions | count and kind; zero is what separates PASS from ASSIST |

**Cost gates**, both derived from v1's measured figures and both revisable once real v2
numbers exist:

- **no single oracle exceeds $10** — v1's interactive scenario ran $4–8+, so $10 is a
  loose ceiling on "no worse than v1";
- **median oracle ≤ $3**.

A run that reaches green for $50 has not passed in any useful sense.

---

## 5. Scenario contracts

One per oracle, in `scenarios/`, using v1's fixed contract format — Objective /
Preconditions / Setup / Steps / Expected Outcomes / Style.

**The format held.** It was written for `cumulocity-ui` and survived being applied to a
plugin target (B4) — plugin loading fits in Preconditions, feature-flag mocking fits in
Setup — with no new sections and no special-casing. Salvaged on that evidence.

- [`B0-events-details`](scenarios/B0-events-details.scenario.md) — salvaged verbatim from v1
- [`B1-asset-selector-retains-device`](scenarios/B1-asset-selector-retains-device.scenario.md)
- [`B2-datapoints-render-type`](scenarios/B2-datapoints-render-type.scenario.md)
- [`B3-quicklinks-preview`](scenarios/B3-quicklinks-preview.scenario.md) — salvaged from v1
- [`B4-plugin-global-provider`](scenarios/B4-plugin-global-provider.scenario.md)

---

## 6. Preconditions to run the benchmark

- A reachable tenant with **both** targets deployed — the Cumulocity apps for B0–B3, and
  the `ai-plugins` remote for B4. v2 never builds or serves (charting decision).
- A **writable** tenant for B0 (creates a device, posts an event) and B4 (persists a
  global provider with dummy API keys). B1, B2 and B3 are mocked and read-only against
  inventory.
- `Cypress.env('remotes')` set to `{"ai-plugins":["AiManagerModule","aiChatWidgetProviders"]}` for B4.
- Credentials via each repo's own mechanism — never hardcoded.

## 7. Deliberately not covered

- **Contract-genre oracles.** Both genres are in scope for v2, but whether the contract
  genre shares one pipeline is the open question in
  [UI e2e and API-contract specs: one pipeline or two?](../issues/05-two-genres-one-pipeline.md).
  Adding a contract oracle now would pre-empt that decision and might measure the wrong
  thing. Nominated candidate, ready to adopt if ticket 05 says one pipeline:
  `ai:contracts/mcp-roundtrip.cy.ts:12` `"get MCP servers list"` (cost 0, 80 lines,
  10 asserts, 1 `cy.request`).
- **Absolute cost targets beyond the two gates above.** There is no v2 data yet; tighter
  numbers would be invented.
