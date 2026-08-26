# Can iterations replay against recorded traffic instead of a live tenant?

Type: research
Status: open
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
