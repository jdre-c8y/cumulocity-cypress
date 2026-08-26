# Define the acceptance benchmark

Type: task
Status: open
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
