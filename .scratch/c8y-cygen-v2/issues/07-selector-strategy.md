# Selector ladder, and fingerprinting selectors across render branches

Type: prototype
Status: open
Blocked by: 02

## Question

v1's central mechanic was harvesting real `[data-cy]` selectors via a `list_data_cy`
tool. Charting overturned the premise that made it work: **`[data-cy]` coverage is a
property of who wrote the component.** It is reliably present on shared `ngx-components`
(`c8y-li--actions-btn`, `select--dropdown-menu`, `c8y-confirm-modal--ok`) and frequently
absent from a plugin's own components. `c8y-ai-agents`'s hand-written specs target the
plugin's own UI by custom element tag, placeholder regex, visible text and DOM walking:

```ts
cy.get("button").contains(/Change provider|Add global provider/)
cy.get("c8yai-provider-modal input[placeholder*='model' i]")
cy.get("c8y-li").contains(agentName).parent().parent().find('[data-cy="c8y-li--actions-btn"]')
```

The strategy is settled as a preference ladder — `[data-cy]` -> custom element tag ->
semantic role/label -> text content -> structural walking. Two things are not:

**Part 1 — the exact ladder and its rules.** Codify it precisely enough to apply without
a human. Where does localisation bite (text-content selectors break under a language
change, and `c8yscrn` already has a `localized` concept for exactly this)? When is
`.parent().parent()` acceptable versus a smell? Validate the ladder by checking it would
reproduce the selector choices real humans made in both target repos — if it disagrees
with the 246 existing specs, the ladder is wrong, not the specs.

**Part 2 — render-branch fingerprinting** (groundwork §5 Q4). Two v1 failures were the
same underlying hazard, and both produced misleading diagnostics:

- The same list item carries a *different* `data-cy` in "Grid" vs. "List" mode. An
  assertion written against one branch silently stops matching once state flips the
  branch, and reports "found 1 instead of 9" — pointing nowhere near the real cause.
- An editing/preview rendering context and a saved, size-constrained instance of the
  same component are not the same viewport. Content unscrolled in a config-dialog
  preview is clipped in the saved instance. Normal layout behaviour, not a bug — but an
  assertion written against the preview does not transfer.

Is there a cheaper, more systematic way to catch this than hoping the agent discovers it
live and adjusts — e.g. a pre-flight pass that fingerprints a component's selector
contract across its own branches *before* any assertion is written against it? What
would such a pass cost, how would it enumerate the branches, and would it have caught
both failures above?

## Context from resolved tickets

[Define the acceptance benchmark](01-acceptance-benchmark.md) selected two oracles that
exercise this ticket's hazards directly, both with hand-written references to check a
proposed ladder against:

- **B2** `cumulocity-ui/cypress/e2e/appEnablementTeam/cockpitWidgets.cy.ts:1687` — the
  assertion selector *changes with the render mode*
  (`'[data-label*="e2eSeries"] .text-truncate'` → `'.text-truncate'`), plus a
  `have.length 3` → `have.length 1` count assertion across a state change.
- **B4** `c8y-ai-agents/cypress/e2e/no-llm/provider-management.cy.ts:9` — spans four
  ladder rungs in one test, and surfaced a **third hazard variant not in the groundwork:
  a state-dependent label.** The same control reads "Add global provider" before a
  provider exists and "Change provider" after; the oracle uses a regex on first use and a
  plain string on the second. Add this to Part 2's hazard list.

A proposed ladder can be validated cheaply by checking it would reproduce the selector
choices these two oracles' authors actually made.
