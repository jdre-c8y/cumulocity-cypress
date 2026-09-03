# UI e2e and API-contract specs: one pipeline or two?

Type: grilling
Status: open
Blocked by: — (02 resolved)

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
