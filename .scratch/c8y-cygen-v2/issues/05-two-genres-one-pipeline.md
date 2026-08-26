# UI e2e and API-contract specs: one pipeline or two?

Type: grilling
Status: open
Blocked by: 02

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
