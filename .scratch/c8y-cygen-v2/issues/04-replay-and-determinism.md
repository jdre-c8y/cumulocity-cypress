# Can iterations replay against recorded traffic instead of a live tenant?

Type: research
Status: resolved
Blocked by: —

## Question

Possibly the highest-value question on this map, and notably **absent** from the v1
groundwork's own list of open questions.

Every v1 self-heal attempt re-ran Cypress against a live tenant. That makes each
iteration slow, non-deterministic, and expensive — and it is why a single attempt plus a
real Cypress run "routinely exceeded 5 minutes end to end", lapsing the prompt cache.
If iterations could instead replay *recorded* traffic, both ranked axes improve at once:
reliability (determinism) and cost (no tenant round-trip per attempt).

The primitives already exist and are already in use in a target repo. `c8y-ai-agents`
runs `configureC8yPlugin(on, config, { pactFolder: "cypress/fixtures/c8ypact" })` with a
`C8Y_PACT_MODE` env var, ~30 recorded pact fixtures, and `cy.cleanupCapturedRequests()`
in `afterEach`.

Research and report — facts, not opinions:

1. What do `c8ypact` and `c8yctrl` **public APIs** actually permit? The packaging
   constraint forbids modifying either, so anything requiring a change to them is a
   finding, not a plan.
2. What are the recording/replay modes, how is a pact keyed and matched, and what
   happens on a miss?
3. Can a *recording* be captured during the exploration phase and then replayed for
   every subsequent self-heal iteration? What invalidates a recording — a changed
   selector? a changed request order? a new request the recording has never seen?
4. Is there a genuine failure class that only appears against a live tenant, which
   replay would therefore hide?
5. How does `c8ypact`'s own matching interact with the generated spec's assertions —
   complementary, or overlapping/conflicting responsibilities?

Sources: `src/lib/pact/`, `src/c8yctrl/`, `doc/Proxy based Testing.md`,
`doc/API and Integration Testing.md`, the pact fixtures and specs in `c8y-ai-agents`.

Findings go to a throwaway `research/04-replay-and-determinism` branch.

---

## Answer

Resolved by two `/research` passes — the library primitives, and the observed usage in both
target repos. Findings on branch `research/04-replay-and-determinism` (`883e204`), at
`.scratch/c8y-cygen-v2/research/04-replay-primitives.md` and `…/04-replay-usage.md`; every
claim cited to `file:line`. Line references below are to `cumulocity-cypress@0.18.27` on
`c8y-e2e-generation-agents-2`.

**Ruling: iterations do not replay. v2 heals against a live tenant.** The primitives permit
replay and no library modification is needed — the mechanical answer to the ticket is *yes*.
It is declined anyway, on four grounds, of which the first is decisive and was not visible
when this ticket was charted.

### 1. What the primitives actually permit — the "yes" half

**`Q1`, `Q2`.** Reachable through the public API, nothing to modify:

- **`cy.c8yclient` never replays.** In `apply` mode it always performs the live request and
  only *matches* the response afterwards (`src/lib/commands/c8yclient.ts:621-695`). The only
  replaying client, `C8yPactFetchClient`, is wired **exclusively** by `cy.mount`
  (`src/lib/commands/mount.ts:74-93`) — component testing. So "replay" in an e2e run means
  `cy.intercept` or the `c8yctrl` proxy, and nothing else. This kills the ticket's implicit
  assumption that the ~30 pact fixtures in `c8y-ai-agents` are evidence of replay; they are
  evidence of live-request-plus-match.
- **A catch-all records everything.** `cy.intercept("**")` under `C8Y_PACT_MODE=record` falls
  through `wrapEmptyRouteHandler` to `req.continue`, emits the interception event and saves
  (`src/lib/commands/intercept.ts:219-232`, `:78-91`). The catch-all can live in a
  **v2-injected support file**, absent from the emitted spec — so house style survives.
- **Pact identity is decoupled from the spec file.** `{ c8ypact: { id } }` wins over the test
  title path (`src/lib/pact/pactutils.ts:68-71`), and *nothing anywhere compares a recording's
  `info.title` to the current test* (`cypresspact.ts:294-324`; `plugin/index.ts:148-157`). A
  probe spec and the generated spec are different files with different titles, and they can
  still share one recording by pinning the same id. **This is the enabler the ticket
  hypothesised, and it is real.**
- **`Q3` — what invalidates a recording.** Record lookup is `method` + normalized URL **only**;
  not headers, not body (`c8ydefaultpact.ts:214-222,276-291`). So: a changed **selector**
  invalidates nothing at all — c8ypact has no knowledge of the DOM. Reordering requests to
  *different* URLs invalidates nothing — cursors are per `method:url` and independent. A **new**
  request the recording has never seen is the real invalidator. And a **repeat** beyond what was
  recorded does not miss — the cursor *clamps* and silently serves the last recorded response
  forever (`c8ydefaultpact.ts:200-203`), which is worse than a miss because it is invisible.

The mechanism is there. The reasons not to use it are elsewhere.

### 2. It would trade the anti-gaming invariant — the decisive objection

[Ground truth](02-ground-truth-and-setup-path.md) found that **the risk binds at exactly one
place, the unanchored `stub`**, and contained it with a checkable invariant: *no Expected
Outcome may be satisfied by an assertion whose value traces to a `stub` in the same `it()`*.
The reason a wrong `stub` is dangerous is that it **passes against a fiction**.

**Replay is an unanchored stub applied to the whole run, and it is self-recorded.** The
recording is produced by this tool, from this IR, during the probe run. A spec that goes green
under replay has established that it is consistent with a recording the tool made from the
artifact under test. Ticket 02's invariant contains the stub case precisely *because* it is
narrow and traceable; under replay every value traces to the recording, so the invariant does
not become harder to check — it becomes **vacuous**.

The obvious mitigation — replay the middle iterations, confirm with one live run — does not
rescue it. The live run is then what gates acceptance, so the benchmark score is unchanged, and
the saving is confined to exactly the iterations that §3 shows are already few.

This objection did not exist when the ticket was charted. Ticket 02 had not run.

### 3. Most of what replay was chartered to buy has already been banked elsewhere

The ticket argues replay improves *both* ranked axes. Both halves have since been overtaken:

- **Cost — the ticket's own premise is superseded.** It cites v1's attempt-plus-run
  "routinely exceeded 5 minutes end to end, lapsing the prompt cache". [Loop shape](10-loop-shape.md)
  then made sessions **stateless and fresh**, reading artifacts from disk — there is no
  accumulated conversation left to lose, so the cache argument is dead on its own terms.
  Separately, the 5-minute TTL the groundwork treats as fixed is **configurable**
  (`cache_control: {"type": "ephemeral", "ttl": "1h"}`, at 2× write cost) — noted for
  [Agent runtime](14-agent-runtime.md), which owns it, not decided here.
- **Cost — there are few runs left to make cheaper.** Ticket 10 decided **patch from the
  diagnostic first, re-probe on the second failure**, with the linter as a free local stop
  condition. Most heal iterations never run Cypress at all. The budget is ≤3 probe / ≤6 total.
- **Reliability — the dominant non-determinism is already gone by construction.**
  [Probe mode](12-probe-mode-compiler.md) made selector resolution deterministic: the probe
  records which candidate row each provisional matched and the ladder picks, which makes a
  hallucinated selector *impossible* rather than detectable. That was v1's main flake source.
  What replay still insulates against is **tenant** flake, not tool flake.

Replay would still buy something. It buys much less than the ticket assumed, and it is no
longer plausibly "the highest-value question on this map".

### 4. The configuration v2 needs has zero instances in either target repo

Two different things are called "pact" in these repos, and neither is what v2 would need:

| Context | Tenant needed at replay time? | In CI? |
| --- | --- | --- |
| API round-trip, `cy.c8yclient`, `apply` | **Yes** — live request, response matched after | Yes (`c8y-ai-agents` contract job) |
| Angular component, `cy.mount`, `mock` | **No** — genuinely tenant-free | **Yes** (`cumulocity-ui` component job) |
| **Full-app UI e2e, `cy.visit`** | No, in principle | **Never — 0 instances in either repo** |

`c8yctrl` — the only transparent mechanism, and the only one that could serve the app shell —
appears in both repos **exclusively in `yarn.lock`**. It has never been run against either
target.

The one working tenant-free replay in either repo is `cumulocity-ui`'s **component** job, and
its scope is a single Angular component mounted in isolation with no shell, no router, no
navigator, no plugins. Its measured cost: **195 records over 32 fixtures, 6.0 MB, worst case
72 records / 2.6 MB for one component.** A full-shell UI spec bootstraps the shell **10–17
times in a single file**. The per-run request count for a full-shell spec is **UNDETERMINED** —
no HAR, no `c8yctrl` folder, no browser-traffic recording has ever been made in either repo —
and so is whether `c8yctrl` can serve a Cumulocity shell bootstrap at all (statics, cometd,
`/notification/realtime`).

Adopting replay would mean pioneering the one configuration nobody has run, on an unmeasured
cost curve, to buy a reliability margin §3 shows is largely already held.

Two further hazards, both measured and both pointing the same way: `cy.intercept` replays
recorded `date` and `set-cookie` headers **verbatim** — only `c8yctrl` strips them
(`httpcontroller.ts:742`) — so intercept-path replay of a login flow replays an expired auth
cookie; and recorded fixtures **bake in environment identity** (`info.tenant` in clear text in
67/67 `c8y-ai-agents` files despite being listed under `obfuscate`, a real username in 15/107
records, frozen `self` links), so a recording is bound to the machine that made it.

### 5. `Q4` — the failure classes replay would hide, measured rather than guessed

**The host repo already answers this question itself.** `{ tags: '@requiresBackend' }` occurs
**134 times across 57 of 200 spec files (28.5%)**, and CI has a switch that selects exactly
those (`cypress-build-pipeline-testing.yml:80-84`). It is a maintained, CI-enforced, hand-applied
partition of the corpus into "needs a live backend" and the rest — a **lower bound**, since no
lint rule enforces it, and `c8y-ai-agents` has no equivalent tag at all.

Concentrated in authentication (SSO 11, users 9, login 7, certificates 7, CRL 5) and
microservice lifecycle — i.e. exactly the shell and auth traffic a probe must traverse before
it reaches any scenario. Alongside it: 95 real `cy.request` writes across 45 specs; 327
`dayjs()` relative-date query strings; binary upload/download, which the library explicitly
does not support; and the cometd WebSocket, which `c8y-ai-agents` documents as defeating
`cy.intercept` outright (`cypress/support/commands.ts:32-35` — it hand-rolled a `window.fetch`
monkey-patch because *"cy.intercept() breaks the connection"*).

So: **yes, there is a genuine live-only failure class, it is large, and the host repo has
already labelled it.**

### 6. `Q5` — pact matching and the generated spec's assertions are *overlapping*, and the two genres want opposite settings

Pact matching **asserts and fails tests** (`c8ymatch.ts:42-131`), raising a machine-readable
`C8yPactMatchError` carrying `actual`, `expected`, `key`, `keyPath`. It runs automatically from
`cy.c8yclient` when `mode() === "apply"` (`c8yclient.ts:636-638`). It compares payloads only —
it sees no DOM.

So the two are **overlapping on API payloads** (both can fail on a body diff) and
**complementary on DOM state**. For the UI genre that overlap is pure hazard: a second,
invisible assertion layer that fails on payload drift unrelated to the Expected Outcome, and
whose failure the model would have to diagnose without having written it. It is suppressible
without touching the library — `C8Y_PACT_MODE=mock`, `{ c8ypact: { ignore: true } }`, or
`Cypress.c8ypact.on.matchingError`.

**For the contract genre it is the entire point.** The two genres therefore want *opposite*
settings of the same switch — handed to [Two genres](05-two-genres-one-pipeline.md) as evidence,
along with the mechanism its contract half actually rests on: `cy.c8yclient` + `cy.c8ymatch` in
`apply` mode against a live tenant, 1.6 records per fixture.

### 7. What is adopted

Replay is declined; three findings from the research are kept.

1. **`@requiresBackend` is a conventions fact.** A per-repo, human-maintained, CI-enforced list
   of flows that cannot be mocked. Handed to [Conventions scout](06-conventions-scout.md) to
   capture, and to [Scenario authoring](08-scenario-authoring-assist.md) as a measured prior for
   its hazard checklist — a scenario touching what those 134 tests touch is a hazard, and this
   is the first hazard signal in the design that costs nothing to acquire.
2. **A value builder whose output reaches a URL is a hazard beyond replay.** `c8y-ai-agents`
   puts `Date.now()`-derived names into request *paths* 33 times, so the name lands in the
   intercept key. This is the same defect [Conventions scout](06-conventions-scout.md) found
   when it ruled `contracts/` must *deny* `uniqueName` — but it bites the **generated spec's own
   `cy.intercept` aliases**, not only a recording. Extends ticket 06's directory override rather
   than adding machinery.
3. **Pact files support JSON `$ref` dereferencing relative to the pact folder**
   (`plugin/index.ts:701-750`) — a composition mechanism, noted for the contract genre in
   ticket 05.

### 8. Corrections to the map

- **Corrects [Ground truth](02-ground-truth-and-setup-path.md).** Its ruling that `c8yctrl`'s
  *"value collapses to replay and defers wholly to ticket 04"* now resolves: replay is declined,
  so **`c8yctrl` leaves the design entirely.** It is not part of acquisition and not part of
  iteration. Nothing in v2 depends on it.
- **Corrects [Probe mode](12-probe-mode-compiler.md)'s framing.** It recorded *"B1, B2 and B3
  produce tenant-free specs that cannot be generated tenant-free — ticket 04's replay research
  could change this; nothing else will."* The answer is that it does not change — **and it did
  not need to.** The map's own Notes already fix *"a reachable tenant with the app/plugin already
  deployed"* as a precondition of the entire design. Generating tenant-free was never a
  requirement, so that line reads as a defect but is only an observation. No cost is owed.
- **Confirms [Loop shape](10-loop-shape.md).** Its conditional — *"healing needs a reachable
  tenant … unless ticket 04's replay research says otherwise"* — resolves to its default.
  Healing needs a reachable tenant.
- **Retires this ticket's own premise.** *"Possibly the highest-value question on this map"* was
  true when written and is not true now; tickets 02, 10 and 12 absorbed most of its value before
  it was fired. The absence the ticket noted — that v1's groundwork never listed this as an open
  question — is still a fair criticism of v1.

### 9. What would reopen this

One experiment settles both UNDETERMINEDs at once — the request count for a full-shell run, and
whether `c8yctrl` can serve a Cumulocity shell bootstrap:

```
npx c8yctrl --port 4200 --folder ./rec --mode record --baseUrl https://<tenant>
npx cypress run --config baseUrl=http://localhost:4200 --spec <one UI spec>
```

Reopen if, once a benchmark baseline exists, **tenant flake is measured as a material cause of
budget exhaustion** — that is the one axis replay uniquely still serves. Do not reopen on cost
grounds: §3 disposes of those.
