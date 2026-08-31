# Selector ladder, and fingerprinting selectors across render branches

Type: prototype
Status: resolved
Blocked by: — (02 resolved)
Assignee: jdre

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

---

## Added by ticket 02 (ground truth)

Ticket 02 decided the model is **never shown DOM**. It is shown a **candidate table**, and
this ticket now owns that table's schema — the ladder ranks its rows rather than
reconstructing a document.

One row per element that could plausibly be acted on or asserted against, carrying at
minimum: ladder-ranked selector, tag, `data-cy`, role, accessible name, visible text,
visibility. The state's observed network calls ride alongside the table.

This makes the ladder's output a **committed, machine-checkable artifact** rather than
prose guidance, and it carries an invariant the linter enforces:

> **No selector may appear in the IR unless a probe observed it.**

That converts hallucinated selectors — which v1 emitted and a human had to hand-patch —
from discouraged to structurally impossible.

Also handed over by ticket 02: `Q8(c)`, **second-state re-observation**, is reserved and
opt-in per scenario, and this ticket decides when it fires. It is the only mechanism that
would automatically catch the groundwork's "same element, different `[data-cy]` per
rendered branch" hazard, since it re-probes the same surface from a second established
state and diffs the candidate tables. It roughly doubles observation cost, so it cannot be
the default.

Note the interaction with ticket 02's falsification criterion: second-state re-observation
costs a probe run, and the criterion reopens the Cypress-probe decision at more than ~3
probe runs per scenario. Whatever trigger this ticket picks must fit inside that budget.

---

## Requirement from ticket 12 (probe mode)

[Probe mode](12-probe-mode-compiler.md) made selector resolution **deterministic**, and that
lands a hard requirement on this ticket.

The probe records **which candidate row each provisional selector actually matched** — it
holds the element at the moment it acts on it, so this costs nothing. The ladder then picks
that row's best available selector **mechanically, with no model in the loop**.

Consequences for this ticket:

- **The ladder is now executable code, not guidance.** It must produce a single answer from
  one candidate row, deterministically, with a defined tie-break.
- **Ticket 02's invariant inverts.** A resolved selector is *derived from* facts rather than
  *asserted against* them, so a hallucinated selector becomes impossible rather than merely
  detectable. The ladder is what carries that guarantee.
- **The row must carry a stable identity**, so a provisional's match can be recorded now and
  resolved later, across a stateless session boundary.
- **Match count is part of the contract.** Ticket 12 refuses to resolve a provisional that
  matched more than one element, routing to assist instead. The row set therefore has to
  support counting matches, not just listing candidates.

---

## Resolution

Prototype: branch `prototype/07-selector-ladder` (`732afd0`), at
`.scratch/c8y-cygen-v2/prototypes/07-selector-ladder/`. Run it with `node run07.mjs`.

Measured first, decided second. The ticket's own rule — *if the ladder disagrees with the
existing specs, the ladder is wrong* — was run as a corpus study over **7,402 selectors from
211 hand-written specs** before any design was argued. It overturned three things.

### The ladder is a path search, not a rung preference (Q1)

**The primary key is uniqueness; the rung order is only a tie-break.** Charting described a
preference ladder, and ticket 12 built on that description: *"the ladder picks that row's best
available selector."* That is a function from one row to one selector, and the corpus says
humans do not work that way. They pick the shortest path that uniquely identifies the target,
and they scope **even when the leaf is already top-rung**. B2 writes
`cy.contains('c8y-dashboard-child', 'Data points table').find('[data-cy="global-date-context--Auto-refresh-toggle"]')`
— a rung-1 leaf that still needs a scope, because the page holds three dashboard children.

Compound selectors are 15.3% of host-app and **46.1% of plugin** selectors, and both figures
are lower bounds (see finding 4). This corrects ticket 12's resolution step from *look up a row*
to *search the observed rows*.

### A step declares how many elements it expects (Q2)

Ticket 12 made it a hard contract that a provisional matching more than one element refuses and
routes to assist. **B2 cannot be generated under that rule.** Its central assertion is a count
over three elements, and the corpus holds 359 `have.length` assertions.

So a step declares its cardinality, and refusal fires on a **mismatch** between declared and
observed — never on `>1` alone. Actions default to one and cannot override; assertions default
to one and may declare otherwise. This makes the rule *stricter*, not weaker: it now catches
"I expected one and found three" **and** "I expected three and found one" — which is exactly
v1's Grid-versus-List failure, finally reporting itself as `declared 3, observed 1` instead of
the useless `found 1 instead of 9`.

### The rungs (Q3, Q11)

Text rungs are ordinary rungs. English is assumed, no locale switch, and the conventions file
gains no field for it — deliberately not complicated.

The corpus overturned the **middle** of the charted ladder. It named *"semantic role/label"*,
but humans use `role` 18 times and `aria-label` 73 times out of 7,402 — while using `title`
1,335 times and `name` 398 times. `[data-cy]` is also a minority rung in the **host** app, not
only in plugins: 29.2%, with legacy AngularJS excluded.

1. `[data-cy]`
2. custom element tag
3. stable attribute — `[name]`, `[formcontrolname]`, `[id]`, `[role]`, `[aria-label]`
4. human-readable text — `[title]`, `[placeholder]`, visible text
5. tag with CSS class
6. position, under the repeating-list rule below

Never legal, at any rung: `[c8yicon]` and its two other spellings (v1 was burned when the same
icon field arrived in two different value shapes), any `ng-*` attribute, `:nth-child` (12 uses
in 7,402), `[value]` and `[href]`. `[type]` **refines** a part and is never a part — humans
write `input[type="checkbox"]` 158 times and never `[type="checkbox"]` standing alone as a
whole selector.

Enforced twice: the row schema cannot carry a banned attribute, so the ladder cannot see one.

### The search: scope, score, cap (Q5)

Uniqueness is measured **against the collected surface**, not the whole page — the probe
already collects inside a `within`, so this costs nothing new. The score is: fewest parts,
then highest leaf rung, then highest scope rung. **Hard cap of three parts**; a fourth part
refuses and asks a human. Only 13 of 6,834 host-app selectors have four parts or more.

### Ambiguity: position, and when to refuse (Q6)

A position is legal **only inside a repeating list** — many neighbours sharing the element's own
leaf descriptor, measured by the probe and never guessed. Every other ambiguity still routes to
assist. Evidence: all 167 `.first()` and 168 `.eq(n)` uses in the corpus sit on grid rows,
breadcrumb items, layout options and date pickers. Humans use a position to pick one row out of
many rows, never to separate two different things that happen to look alike.

Under the always-refuse rule the tool would ask a human about every grid; under a
position-is-the-last-rung rule it would hide a real mistake behind `.eq(2)`.

### The candidate row (Q4, Q8, Q9)

**One flat table.** Each row carries its own ancestor list, each ancestor already reduced to a
short descriptor. The ladder searches rows and tests uniqueness by a scan, so it never needs a
tree — and ticket 02's rule that the model is never shown a DOM survives without a second
artifact. Schema: `row.schema.json`.

**Visibility is three in-page states** — `visible`, `hidden`, `clipped` — because the
preview-versus-saved hazard changes neither the count nor the path, only the visible area. Not
in the page is expressed by the row not existing. Measured size and position were rejected:
they change with every screen size, so the facts would stop being stable. The scenario-level
advice belongs to [Scenario authoring](08-scenario-authoring-assist.md); this ticket supplies
only the honest flag.

**The model sees a summary, not the table.** Under Q1 and Q6 the model no longer chooses a
selector — it names a target loosely and the ladder builds the path. So its summary carries one
short line per row: tag, visible text, and whether a person can act on it. The full rows stay on
disk for the ladder. The candidate table is the largest text the tool would send to a model, and
the model does not need the ancestor lists to write `{ tag: button, text: OK }`.

### Row identity (Q10)

**A matched element is recorded against the step that matched it**, at the moment of the match —
the probe already holds the element, so this costs nothing and the later stateless session reads
the step and gets the row without searching. **A row inside a table is keyed by its resolved
path**, which Q5 already guarantees is unique within the collected surface, so no new field is
added and the key is readable in a diagnostic.

A content fingerprint was rejected on a sharp argument: a fingerprint must be built from stable
fields, but the fields a branch change alters *are* those fields — hazard 1 changes the
`data-cy`, hazard 3 changes the text. It would break in the one case it exists to survive.

### Part 2 — no preventive second look (Q7)

**This closes ticket 02's `Q8(c)`, and it closes it as "never fires by default".**

Second-state re-observation is the only mechanism that finds a branch change *before* the test
runs, and it costs one probe run against a cap of three. It is no longer worth it, because Q2
changed the economics: a declared cardinality turns both the Grid-versus-List hazard and the
state-dependent-label hazard into a precise message at run time, at zero cost. Ticket 10 already
says patch from the message first and re-probe on the second failure. Paying a full probe run to
find a fault that now costs nothing to find later is a bad trade — and it would have broken
ticket 12's claim that both oracles fit in one run.

The mechanism is not deleted. The re-probe after a failure uses it; it simply never fires
speculatively.

### Result

```
ORACLE RESOLUTION   6 exact match / 3 shorter than the human / 1 refused, of 10
CORPUS AUDIT        cumulocity-ui 87.5% permitted   c8y-ai-agents 93.5% permitted
REFUSAL CHECK       both refusal paths fire correctly
```

The audit's refusals are the intended ones: 9.6% are `ng-*`, `[href]` and `[c8yicon]`, all
deliberately banned; 0.2% exceed three parts; 2.7% sit off the ladder, two thirds of those a
bare `[type="checkbox"]`.

### Found by trying

1. **Cypress aliases are not selectors, and nothing in the design accounts for them.** 241
   corpus literals are `cy.get('@applyBtn')` — a reference to a subject bound earlier in the
   same test. There is no candidate row for an alias and no rung that could produce one. B2 uses
   three. An alias is a runtime binding, so this is raised on
   [Runtime values in a declarative IR](15-runtime-values-in-ir.md).

2. **The ladder refuses exactly where a human wrote a latent flake.** The single unresolved
   oracle target is B2's `cy.contains('c8y-datapoint-selector-list-item', 'e2eSeries')`.
   `cy.contains` matches a substring, and `e2eSeries` is a prefix of `e2eSeries2` on the same
   surface; the oracle resolves the ambiguity with DOM order plus `.first()`. The ladder measures
   uniqueness under Cypress's own matching rules, finds two matches, and routes to assist. This
   is a **fourth hazard variant** for Part 2's list — *a text value that is a prefix of another
   text value on the same surface* — and it is raised on
   [Scenario authoring](08-scenario-authoring-assist.md).

3. **"Unique in the collected surface" is not "unique on the page."** Three B4 targets resolved
   *shorter* than the human wrote, because the observed rows showed the human's scope was
   unnecessary. Correct under Q5, and cheaper. But the probe collects inside a `within`, so a
   narrow collect scope lets the ladder confidently emit a one-part selector that is ambiguous on
   the real page. **The emitted selector is only as safe as the collect scope was wide.** Raised
   as an unvalidated assumption on the map.

4. **The measured compound rate is a lower bound.** The extraction reads each `cy.get()` and
   `.find()` argument as a separate literal, so a chained `cy.get('A').find('B')` counts as two
   one-part selectors. Real path depth is higher than 15.3% / 46.1%, which strengthens Q1.

### Corrections to closed tickets

- [Probe mode](12-probe-mode-compiler.md)'s resolution step said the ladder *"picks that row's
  best available selector"*. It searches the rows for a path. Its guarantee — a hallucinated
  selector is impossible rather than merely detectable — is unaffected and now has code behind it.
- [Probe mode](12-probe-mode-compiler.md)'s fifth trip condition was *"refuses a provisional that
  matched more than one element"*. It is now *refuses a mismatch against declared cardinality*.
- [Ground truth](02-ground-truth-and-setup-path.md)'s `Q8(c)` is closed: no preventive
  second-state re-observation.
