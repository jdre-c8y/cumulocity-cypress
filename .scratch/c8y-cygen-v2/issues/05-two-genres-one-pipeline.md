# UI e2e and API-contract specs: one pipeline or two?

Type: grilling
Status: resolved
Blocked by: — (02 resolved)
Assignee: jdre

## Question

Both genres are in scope. They have materially different ground truth, and it is not yet
decided whether one architecture serves both.

- **UI e2e** (`c8y-ai-agents/cypress/e2e/{llm,no-llm}/`, all of `cumulocity-ui/cypress/e2e/`).
  Ground truth is the rendered DOM, the selectors actually present, and real network
  traffic. This is what the §1 motivation is entirely about, and it is where an
  LLM-without-eyes fails.
- **API-contract / pact roundtrip** (`c8y-ai-agents/cypress/e2e/contracts/*.cy.ts`,
  backed by ~30 pact fixtures). No UI at all. Ground truth is request/response shape.

The tension to resolve: the contract genre arguably needs *no browser and no vision* —
an LLM can plausibly write those from source and a recorded response, which means the
expensive machinery justified by the UI genre may be pure overhead here. But two separate
pipelines means two things to maintain, two sets of conventions, and a user-facing choice
about which to invoke.

- Is the contract genre a *degenerate case* of the same pipeline — same scenario
  contract, same emission path, browser phase simply skipped — or a genuinely separate
  tool that happens to live in the same package?
- Who decides which genre a given scenario is? The human in the scenario contract, or
  inferred?
- Does the anti-gaming guardrail (every Expected Outcome maps to a concrete `.should(...)`)
  transfer unchanged to the contract genre?
- Does the acceptance benchmark from ticket 01 need contract-genre oracles too, and does
  that change the pass bar?

If the honest answer is "these are two efforts", say so — that is a legitimate outcome
and better found here than after the spec is written.

## Context from resolved tickets

[Define the acceptance benchmark](01-acceptance-benchmark.md) deliberately **excluded**
contract-genre oracles rather than pre-empting this decision. This ticket therefore also
owns whether the benchmark gains one. Nominated candidate, ready to adopt if the answer
is "one pipeline": `c8y-ai-agents/cypress/e2e/contracts/mcp-roundtrip.cy.ts:12`
`"get MCP servers list"` — cost 0 interactions, 80 lines, 10 assertions, 1 `cy.request`.
Note that every contract-genre test in that repo scores **cost 0** — no browser
interaction at all — which is itself evidence bearing on this question.

---

## Added by ticket 04 (replay and determinism)

Ticket 04 researched the pact machinery in depth and surfaced three facts this decision needs.
None of them decides it; all three sharpen it.

**1. The contract genre's mechanism is not what "pact" suggests, and it is not tenant-free.**
`c8y-ai-agents`' contract CI runs `C8Y_PACT_MODE=apply`. In `apply` mode `cy.c8yclient` **still
performs the live request** and only *matches* the response against the recording afterwards
(`src/lib/commands/c8yclient.ts:621-695`); its CI job provisions a real tenant, injects real LLM
API keys and deletes the tenant after
(`.github/workflows/cypress-pr-test.yml:249-322`). So the contract genre is
live-request-plus-response-match, not replay. If this ticket assumed the contract genre could
run without a tenant, that assumption is false. Fixture volume is small: **107 records over 66
files, mean 1.6 records each**.

**2. The two genres want opposite settings of one switch — the strongest structural evidence
available so far.** Pact matching **asserts and fails tests**, raising a machine-readable
`C8yPactMatchError` with `actual` / `expected` / `key` / `keyPath` (`src/lib/pact/c8ymatch.ts:42-131`),
and it runs automatically from `cy.c8yclient` when `mode() === "apply"` (`:636-638`). It compares
payloads only and sees no DOM.

- For the **contract** genre that *is* the assertion. It is the whole point of the genre.
- For the **UI** genre it is a hazard: a second, invisible assertion layer that can fail on
  payload drift unrelated to any Expected Outcome, and whose failure the model must diagnose
  without having authored it. It also overlaps the anti-gaming guardrail's territory without
  obeying it.

It is suppressible without touching the library (`C8Y_PACT_MODE=mock`, `{ c8ypact: { ignore: true } }`,
or `Cypress.c8ypact.on.matchingError`). But "one pipeline" must then carry a genre-dependent
switch on a mechanism that is *load-bearing for one genre and a flake source for the other* —
which is worth weighing against the maintenance argument for two pipelines.

Related: this bears on the ticket's own question of whether the anti-gaming guardrail transfers
unchanged. In the contract genre the recorded response **is** the oracle, so "every Expected
Outcome maps to a concrete assertion" has a different meaning than it does over a DOM.

**3. A composition mechanism the contract genre may want.** Pact files support JSON `$ref`
dereferencing **relative to the pact folder** (`src/plugin/index.ts:701-750`), so one recording
can reference fragments of another. If the contract genre generates many near-identical
fixtures, this is the library's own answer to the duplication, and it is public API.

---

## Resolution

**Two efforts. The API-contract genre is out of scope for v2.** v2 generates UI e2e specs
only, and **refuses** — it does not silently try — when asked for a contract spec.

### The genre boundary is not where this ticket assumed it was

The ticket framed the split as *DOM assertions vs. payload assertions*. That is false, and
measuring it is what decided the ticket:

| | UI genre | contract genre |
|---|---|---|
| `cumulocity-ui` (200 specs, 154 in scope) | 154 | **0** — zero `c8ypact`, zero `c8yclient` |
| `c8y-ai-agents` | 6 | 5 files, 23 `it()`, 1733 lines |
| asserts on a response payload | **16 host files already do**, no pact involved | always |
| makes API calls | 95 `cy.request` across 44 host files | 36 `cy.c8yclient` |

Payload assertion already lives inside the UI genre. B0, the baseline oracle, does a real
`cy.request('/event/events','POST')`. So that is not the boundary.

Four things actually separate the contract genre, and only the first is what this design
exists for:

1. **Zero DOM.** Three distinct commands in 1733 lines — `cy.c8yclient`, `cy.getAuth`,
   `cy.request`. No `cy.get`, no `cy.visit`, no selector, anywhere.
2. **The assertion is a JSON Schema** — 12 inline blocks, one 60 lines
   (`mcp-roundtrip.cy.ts:26-63`). Ticket 15 closed assertions to extractor + comparator.
   A JSON Schema shares nothing with that vocabulary; it is a second assertion language.
3. **The test is a template over a typed table** — 4 of 5 files `.forEach` over a profile
   array typed by `@c8y/ai-types` and `../../../packages/ai-plugins/src/app/...`. The IR is
   a flat step list for one `it()` (ticket 15). One pipeline means the IR grows templating
   *and* imports of the product's own model types.
4. **Pact matching is the oracle** — the opposite switch setting from the UI genre
   (ticket 04).

### Why "one pipeline" was declined

Nine resolved tickets of machinery, and the contract genre uses almost none of it. Probe
mode (12), the selector ladder (07), the candidate table, and the *surface* half of ground
truth (02) are wholly inapplicable — there is nothing to probe and nothing to rank.

The decisive structural objection is narrower and worse: **ticket 10's stop condition does
not exist in this genre.** "The linter is the stop condition; an under-probed IR is
unlinttable by construction" is a *probe* property. With nothing to probe there is no free
local check for *am I done gathering?*, and the loop loses the property that makes it
terminate cheaply.

Set against that, the addressable surface is **23 `it()`s in one of two target repos**,
against 160 UI specs — for a genre that by the §1 motivation *needs no eyes*, which is the
one thing this design exists to supply. The ticket's own suspicion was right: the expensive
machinery is pure overhead here.

### What v2 keeps, because refusing is a safety property

**Refusal is explicit, and it is a sixth assist trip condition** — not silence. If v2 is
pointed at a contract spec and tries anyway, it emits a spec whose oracle is a recording it
just made itself. That is exactly the unanchored-stub failure
[ticket 04](04-replay-and-determinism.md) declined replay over: *it passes against a
fiction*. Silence would reintroduce the risk the map already paid to close.

**The recognition criterion is IR shape, not directory.** An IR with **zero DOM steps** is
refused at lint time — free, at exactly the place ticket 10 put the stop condition, and it
catches a contract spec written anywhere. The `contracts/` directory override from
[ticket 06](06-conventions-scout.md) is kept as an *optimisation only*: it refuses early,
before a probe run is spent. It is not the rule, because a per-repo config entry misses a
contract spec written outside that directory.

A lexical rule was rejected for a measured reason:
`global-context/globalContextWidgetDisplayModes.cy.ts` has **zero `cy.get`** and is
nonetheless a fully DOM-driven spec — every selector lives in an imported
`globalContextHelpers` module. A file-level grep misclassifies it; an IR-shape check cannot.

**Named cost of the rule:** it refuses `appEnablementTeam/branding.schema.cy.ts` — 18 lines,
one `cy.request`, no DOM — a real, in-scope host spec. Accepted: 1 of 154, and a spec with
nothing to look at belongs to the deferred effort.

### Two decisions the UI genre gained on the way

**Response assertions enter the IR, narrowly.** 16 host spec files already assert on a
`cy.request` response with no pact involved; ticket 15 legalised `request` as a *setup* verb
but said nothing about asserting on what comes back. Without this, that pattern is
ungeneratable host-repo work. Two new **extractors** — `status` and `body.<path>` — on
ticket 15's existing closed list. Not a new assertion language, and explicitly not JSON
Schema.

**Emitted UI specs are inert to pact matching.** Ticket 04 found pact matching asserts and
fails tests automatically when `mode() === "apply"`. In a generated UI spec that is a second,
invisible assertion layer the model did not author and cannot diagnose. v2's emitted specs
carry `{ c8ypact: { ignore: true } }` — local to the file, constraining no target repo's
config. Neither repo runs the UI genre in `apply` mode today, so this is prevention.

### The anti-gaming guardrail transfers unchanged, with nothing added

The ticket's third sub-question. Ticket 02 phrased the invariant over *values*, never over
the DOM: *no Expected Outcome may be satisfied by an assertion whose value traces to a
`stub` in the same `it()`*. A response assertion on a stubbed intercept traces to the stub
and is already banned; one on a live `cy.request`/`c8yclient` is live and safe by
construction. The operand has an anchor already available — **the probe already records
responses**, which is what ticket 02's *"recorded mutation from an observed response"* was
built on (`12-probe-mode-compiler.md:31`). No new rule.

### The benchmark gains nothing; it stays at five

Both new holes are **lint verdicts, not generation outcomes**, so an oracle is the wrong
instrument even if it were free. They go to the broken-file regression corpus that ticket 03
mandated and tickets 12 (8/8) and 06 (7/7) already run: feed an IR with zero DOM steps,
assert refusal; feed a response assertion, assert it compiles. No tenant, no model, no probe
run. The pass bar is untouched, and `mcp-roundtrip.cy.ts:12` is dropped as a candidate
oracle.

Measured on the way: **none of the five oracles asserts on a response payload.** B2's four
response assertions are at `cockpitWidgets.cy.ts:154` and `:1333`, not in its oracle at
`:1687`. So the capability added above is unexercised by the benchmark — which is precisely
why it needs the corpus rather than an oracle.

### Answers to the four sub-questions as posed

1. *Degenerate case, or separate tool?* — **Neither. A separate effort.** Not a browser
   phase that can be skipped: three of the four distinguishing features are additions to the
   IR, not subtractions from the pipeline.
2. *Who decides the genre?* — **Neither the human nor a directory: the IR's own shape, at
   lint time.** Zero DOM steps is the criterion.
3. *Does anti-gaming transfer?* — **Unchanged for the genre that survives; moot for the one
   ruled out.**
4. *Does the benchmark need contract oracles, and does the bar change?* — **No, and no.**

### Corrections and hand-offs

- **Corrects the map's charting note.** *"Genre scope: both UI e2e specs and
  API-contract/pact roundtrip specs are in scope"* is overturned. It was listed under
  *settled during charting, do not re-litigate*; this ticket was created to decide exactly
  it, and its own text invited the two-efforts answer.
- **Corrects ticket 06.** Its finding *"`contracts/` must deny the `uniqueName` builder, or
  the spec passes its first run and fails every one after"* is now dead as an example —
  v2 never generates into `contracts/`, so that denial never fires. The **conclusion**
  survives intact and gains a better case: directory overrides are load-bearing, and the
  entry now carries a *not-generatable* flag instead.
- **Hands ticket 13 a sixth trip condition** (refuse: no DOM steps in the IR). Ticket 15
  collapsed eight to five; this makes six.
- **Verb-count discipline** (the map asks each ticket to say so out loud): this ticket adds
  **zero verbs**. It adds **two extractors** to an existing closed list, and one lint rule.
