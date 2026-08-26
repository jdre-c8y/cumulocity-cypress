# Ground truth: where does it come from, and what must go through the UI?

Type: grilling
Status: open
Blocked by: —

## Question

The motivation rests on one claim: source code is insufficient because rendered output
!= source, so ground truth must come from the running application. That claim is sound.
What v1 never questioned is *which* ground truth needs a live browser and which does not.

Decide the acquisition strategy across three candidate sources:

- **Agentic browser exploration** (v1: Playwright + navigate/snapshot/click/type/list_data_cy/capture_network). Proven to generalise across two unrelated scenarios unmodified. Also the entire cost centre — $4-8+ per interactive run.
- **Proxy recording** via `c8yctrl`, which records and mocks proxied API traffic. Gives network ground truth without spending agent turns on `capture_network`.
- **Deterministic, non-LLM harvest** — a scripted pass that collects the DOM/selector surface of a page with no model in the loop at all.

And settle the setup/precondition path, which is the same question viewed from the cost
side. Evidence that UI-driven setup is avoidable is already in the target repos:
`c8y-ai-agents` establishes preconditions with `cy.mockFeatureAsEnabled("ui.ai-agent-manager")`
and `cy.getAuth("admin").login()` — intercepts and API calls, not clicks. v1 by contrast
had *no* way to shortcut data setup and built "a group with an empty dashboard exists" by
clicking through the UI turn by turn.

- Is there a principled line between "setup, which may go through REST/intercepts" and
  "the thing under test, which must be observed rendered"? Or must it be judged
  case-by-case?
- If the line is principled, state it precisely enough that a generator can apply it
  without a human.

Beware the trap: pushing *too much* setup to REST can produce application state that the
UI would never have produced, so a spec passes against a state real users never reach.
Say where that risk binds.
