# Anchored scope, and the value no row carries

Type: prototype
Status: partly built — findings 1, 3, 4, 5 built and measured; findings 2, 6 and 7 open. B1's spec now passes; axis A fails only on the first-attempt rule.
Blocked by: — (07 resolved; reopened by the B1 oracle run)
Assignee: jdre

## Why this ticket exists

The map closed at sixteen resolved tickets with the note *"deciding complete."* B1 is the
first oracle to run end-to-end against a live tenant, and it came back **FAIL**. Axis B
passed 4 of 4 — the spec asserted every Expected Outcome for real, and gamed nothing. Axis A
failed on one assertion, and the run then hit the probe-run tripwire mid-heal.

```
VERDICT  FAIL
  A green            FAIL  1 test failure
  B outcome coverage PASS  4 of 4
  interventions      0
  cost               $4.8960 over 10 iterations, 7 Cypress runs (5 probe), 10 model turns
  note               TRIPWIRE: 5 probe runs against a cap of 5
```

This ticket exists because the failure is not a fluke and not a model mistake. **Three
separate mechanisms had to be missing for the run to end where it did**, and each is a
decision ticket 07 made, or did not make.

Everything below is measured. The run's facts survived at
`cumulocity-ui-e2e/.cygen/facts/b1-third/`, so each claim is checked against the DOM the
probe actually saw, and each corpus figure against the 214 hand-written specs in
`cumulocity-ui-e2e` and `c8y-ai-agents`.

## What failed

The blocking assertion, in two separate spec runs (iterations 6 and 9):

```
get [data-cy="c8y-dashboard-list--device-widget"]
assert expected '<span>' to contain text 'e2eDevice', but the text was ' Asset Properties '
```

The step behind it, as the final IR still carries it — this is outcome 4's. Outcome 3's step
carried the same resolved target in both failing runs; the last heal reverted it to a
provisional for a re-probe that the tripwire then refused to pay for.

```yaml
- id: assert-device-after-second-cycle
  assert:
    target:
      resolved: cy.get('[data-cy="c8y-dashboard-list--device-widget"]')
      fromRow: widget card on the group dashboard#13
    extract: text
    compare: includes
    operand: { ref: deviceName }
```

The row it names, from `probe-07/008-collect.json`:

```json
{ "i": 14, "parent": 10, "tag": "span",
  "attrs": { "data-cy": "c8y-dashboard-list--device-widget" },
  "classes": [], "text": "Asset Properties", "visibility": "visible" }
```

The element is the widget's **type label**. Its `data-cy` says *device-widget*; its text says
*Asset Properties*. The model chose it three times across two spec runs: for the assertion
immediately after the config dialog opened (iteration 6, failed at `steps[9]`), and again for
both post-save assertions (iteration 9, failed at `steps[13]`). Between the two it healed the
first one onto `[title="e2eDevice"]` and left the other two where they were.

## Finding 1 — the row summary hides a row's text as soon as it has a `data-cy`

`summariseFacts` builds one label per row, and the branches are exclusive:

```ts
const label = row.attrs.dataCy
  ? `data-cy=${row.attrs.dataCy}`
  : row.attrs.title
    ? `title=${row.attrs.title}`
    : row.text
      ? `"${row.text.slice(0, 40)}"`
      : "";
```

So the model was shown

```
widget card on the group dashboard#13  span  data-cy=c8y-dashboard-list--device-widget
```

and was never shown that the span reads *"Asset Properties"*. It picked the one row on the
surface whose **name** promised a device, against a summary that had withheld the one field
that would have refused it.

This is the defect that failed the run. It is a `data-cy` name-lure, and it is a fourth
variant for ticket 07 Part 2's hazard list — *a `data-cy` whose name describes the component
that owns the element rather than the content the element holds*. Unlike the other three it
needs no second state and no re-probe to catch: the contradicting evidence was already in the
facts, and the summary dropped it.

**Decision to take:** a row's label carries its identifying attribute **and** its text when
both exist. The summary is the largest text sent to a model and the cap is real, so the cost
was measured rather than assumed: across all 1,267 rows B1 collected, **91 (7.2%)** carry a
label *and* a text that the label currently hides. Restoring them costs **~1,060 characters,
about 266 tokens**, for the whole run. That is the entire price of the fix.

## Finding 2 — the ladder has no rung for an element identified by its neighbour

The hand-written B1 oracle reaches the asset-selector chip like this:

```ts
cy.get('[data-cy="Asset selection"]').parent().find('.chip, .tag')
```

The chip carries no `data-cy` and nothing else distinctive. It is identified by **what sits
next to it**, and no rung in ticket 07 can express that. The ladder's only compound form is
*ancestor-with-its-own-descriptor → leaf*.

### The corpus says this is a third of all specs

| shape | count |
| --- | --- |
| chains containing an upward verb | **238**, in **71 of 214 specs** (33%) |
| `.parents(SEL)` → `.find` / `.within` | 81 |
| `.parent()` → `.find` / `.click` / `.should` / `.contains` | 72 |
| `.closest(SEL)` → `.find` / `.within` / `.scrollIntoView` | 25 |
| `.siblings()` → … | 12 |
| `.parent().parent()` runs | 4 |

The four rows below the first are the common shapes, not a partition of the 238. Counted as
bare occurrences instead: **`.parent()` with no argument, 99**; **`.parents(SEL)` or
`.closest(SEL)` with one, 98**; `.siblings()` with none, 11. Two forms carry nearly all of it,
and the deep `.parent().parent()` walk that the ticket asked about — *when is it acceptable
versus a smell* — is **4 uses in 214 specs**. It is a smell. Do not build for it.

A check first, because ticket 07's rule is *if the ladder disagrees with the specs, the ladder
is wrong*: I also measured what humans use as the **scope** half of an ordinary compound
selector, to see whether `AncestorDescriptor`'s narrower vocabulary — `tag`, `dataCy`, `id`,
`classes`, `text`, and no `[name]`/`[title]`/`[role]` — is a second gap.

```
compound scopes measured: 609   custom-tag 432, tag.class 68, #id 9, other 100
scopes the ancestor vocabulary cannot express: 0
```

**Zero.** The ancestor vocabulary matches human practice exactly and must not be widened.
The gap is the *shape*, not the vocabulary.

### The rung

> **Anchored scope.** A scope part may be an ancestor the target shares with a named
> **anchor** row, where the anchor is any row that resolves on rung 1, 2 or 3.

Emitted in two forms, both taken from the corpus:

- `cy.get(<anchor>).parent().find(<leaf>)` — when the shared ancestor is the anchor's
  direct parent. No descriptor is needed, so nothing can be got wrong.
- `cy.get(<anchor>).closest(<descriptor>).find(<leaf>)` — when it is higher, and only if
  that ancestor carries a rung-1, -2 or -3 descriptor.

`.closest()` rather than the more common `.parents()`: `.parents()` can return several
elements and humans then patch it with `.first()`/`.last()`, while `.closest()` returns at
most one. The simpler verb, and deterministic.

**Refuse** when the shared ancestor is more than one hop up and its only descriptor is a class.
Rung 5 would offer `div.d-flex.p-r-16.fit-w.m-t-4.m-b-4` for B1's, and pinning a spec to a
layout utility class is a flake with a green tick on it. Coverage under this rule, measured
over the 197 **ancestor** hops (`.parent()`, `.parents(SEL)`, `.closest(SEL)`; `.siblings()`
excluded, see below): **155 expressible (79%), 42 refused** — and the 42 are exactly the
`.d-flex` / `.row` / `.card` / `.form-group` arguments.

`.siblings()` is **out of scope** and stays refused: 11 uses in 214 specs, and a sibling hop
is not an ancestor the two rows share, so it would need a second rule rather than a wider one.

The anchored scope counts as **one part**, so the three-part cap is unchanged.

### It solves B1's chip exactly, and costs no probe run

Computed against `probe-07/002-collect.json`:

```
chip:                            170  span.text-truncate[title="e2eDevice"]
anchor:                          138  button[data-cy="Asset selection"]
nearest shared ancestor:         103  div.d-flex.p-r-16.fit-w.m-t-4.m-b-4
                                      = the anchor's direct parent
emitted: cy.get('[data-cy="Asset selection"]').parent().find('span.tag.chip.text-12.tag--info')
human:   cy.get('[data-cy="Asset selection"]').parent().find('.chip, .tag')
```

The same hop, chosen mechanically.

The cost is the part worth arguing. **No new probe run, no browser change.** Rows already carry
their ancestor spines; the only thing missing is *identity* — two rows' spines are lists of
descriptors, and descriptors cannot be compared for sameness. Adding the node index to
`AncestorDescriptor` is a node-side change inside `rowsFromRawNodes`, where the raw `i`/`parent`
pairs are already in hand. Nothing new crosses the browser boundary.

This matters against ticket 02's falsification criterion, which reopens the Cypress-probe
decision above ~3 probe runs per scenario. B1 spent 5 against a cap of 5. A rung that needed
a second observation could not be afforded; this one needs none.

## Finding 3 — no row carries a value, so `extract: "value"` can never be anchored

The oracle's outcome-3 and outcome-4 checks read an input:

```ts
cy.get('ng-form[name="vm.ngForm"]').find('[title="Name"]').invoke('val').should('eq', 'e2eDevice');
```

The IR can say this. `Extractor` is `"text" | "attribute" | "value" | "count"` and the compiler
emits all four. But **nothing in the facts can ever justify it**: `RowAttrs` is documented as
*"the ladder's whole attribute vocabulary"* and has no field for a value, and `LADDER_ATTRS` in
the browser half does not read one. Searched across all four of B1's post-save surfaces, the
string `e2eDevice` appears in **zero of 293 rows**. The device name was on the screen; no fact
said so.

So the model had a correct assertion available, no evidence that it was available, and one row
whose name promised the device. It took the row.

The corpus says this is not a B1 quirk: **100 value-reading assertions** — 87 `have.value`,
13 `.invoke('val')` — across **36 of 214 specs** (16.8%).

### The distinction the ban blurred

`[value]` is banned as a **selector part** and must stay banned: it holds data, and data
changes. Ticket 07 then enforced that ban by giving the value no field to arrive in — and that
enforcement reached past *selection* into *observation*. The two are different questions:

- *May a selector be written against a value?* No, and the row schema should keep making that
  impossible.
- *May the model know an element holds a value?* It must, or a sixth of the corpus is
  unreachable.

**Decision to take:** the value becomes a field on `CandidateRow`, deliberately **not** inside
`RowAttrs`. Keeping `RowAttrs` as the ladder's complete vocabulary keeps the selector ban
structural rather than remembered, while the observation becomes visible to the summary and
citable by an `extract: "value"` assertion.

One implementation detail that is load-bearing: the browser half must read the **`.value`
property, not `getAttribute('value')`**. For a databound input the attribute holds the initial
server value or nothing at all, while the property holds what is on the screen. Reading the
attribute would produce a fact that is wrong in exactly the case the ticket exists for.

## Also found. None of it belongs to this ticket

- **The frozen-field guard fired for real, and it was right.** Iteration 8's heal was refused
  with 18 violations — the first time the guard has fired outside a unit test. Read back, the
  model had *deleted* `assert-device-after-widget-save` and `watch-child-assets`, re-added
  replacements under new ids, and remapped `outcomes.3.satisfiedBy[0]`. Every one of those is
  frozen, correctly. But editing that same step's `assert.target` **in place** is free, and
  nothing tells the model so: it burned a turn on a rename it never needed. →
  [Heal granularity](11-heal-granularity.md).

- **A probe takes one snapshot; a Cypress assertion retries.** One frame after the save the
  probe recorded `ng-form[name="vm.ngForm"]` as `hidden` with zero children — the widget's
  schema form had not rendered yet. The oracle's assertion waits it out. B1's outcome 3 needs a
  `settle` before the collect, and the domain notes never say that a surface which renders after
  a save must be settled before it is collected. → [Scenario authoring](08-scenario-authoring-assist.md).

- **The crash on B1's second run exited 0.** A CI would have read it as success. →
  [Hygiene](09-hygiene.md).

## Order, and the honest prediction

This corrects what the B1 post-mortem said first. The blocker was reported as the missing
parent/descendant path shape. It is not: **finding 1 is what failed the run**, finding 3 is
what makes the correct assertion expressible at all, and finding 2 — the one with the corpus
weight behind it — cost B1 nothing, because outcome 2 passed on a `[title="e2eDevice"]` that
happened to work.

1. ~~**Finding 1**, the summary label.~~ **Done** (`2431213`). Replayed through the run's own
   facts, the row that lured B1 now reads
   `span  data-cy=c8y-dashboard-list--device-widget  "Asset Properties"`.
2. ~~**Finding 3**, the observed value.~~ **Done** (`2431213`). The probe reads the `.value`
   property; the row carries it outside `RowAttrs`; the linter refuses an assertion on a value
   no probe observed, the way it already refuses an invented selector.
3. ~~The **settle** note in the domain notes.~~ **Done** (`2431213`) — and it is also the hint
   the new linter rule gives, so the model is told at the moment it needs it rather than only
   in the standing notes.
4. **Finding 2**, the anchored-scope rung. Open. The largest piece, the least B1 urgency, and
   the one a third of the corpus is waiting on.

### Two things the review of 1 and 3 found, which no test would have

- **A password would have reached the prompt.** Facts are written to disk and then sent to a
  model. A probe that walks a login form would have carried the tenant's credentials into both
  the facts file and the API payload. Refused in the browser half and again in node — the
  browser half is the layer a hand-written or replayed payload can bypass.
- **Clipping a value is a lie with a green tick on it.** The first cut clipped at the boundary
  and dropped at the final cap, so a clipped string could exist. Both stages now drop. An
  equality asserted against a prefix fails for a reason nothing in the facts explains.

Re-run B1 once after 1–3. Not before: a re-run without them fails identically, and B1 has
already spent $7.81 against the benchmark's $10-per-oracle gate.

## The re-run: what 1 and 3 bought, and the two walls behind them

`b1-fourth`, 2026-09-13, against the same tenant and the same fixture.

```
VERDICT  FAIL
  A green            FAIL  1 test failure
  B outcome coverage PASS  4 of 4
  interventions      1   app-contradicts-scenario, raised by the model itself
  cost               $5.3687 over 9 iterations, 4 Cypress runs (3 probe), 9 model turns
```

**The falsification test passed on its own terms.** Findings 1 and 3 did what they claimed:

- **Nobody was lured.** The `c8y-dashboard-list--device-widget` span appears once in the new
  spec, asserted `to be visible` — which is all a widget-type label can honestly support. Its
  text is now on its line, and the model used it for what it is.
- **`extract: "value"` worked end to end, live.** The probe observed
  `input title="Name" value="e2eDevice"`, the model asserted against it, and
  **outcome 3 passed against the real application**: `expected <input#sf-name73…> to have
  value e2eDevice`. That assertion could not have been written before this ticket.
- **Probe runs fell from 5 of 5 to 3 of 5.** The tripwire did not fire. The prediction was
  that a model which can see a value stops hunting for a substitute element, and it held.
- The spec now walks the **whole** flow — both save cycles — and fails at `steps[21]` rather
  than `steps[9]`.

It still fails, and on two things neither this ticket nor ticket 07 had seen.

### Finding 4 — rung 3 trusts a `[name]` that a form library generated

The ladder derived `cy.get('input[name="sf-name73"]')`. It passed after the first save cycle
and after the second the element did not exist: *"Expected to find element:
`input[name="sf-name73"]`, but never found it"* — while the screenshot shows the widget
rendered correctly with Name = e2eDevice. angular-schema-form regenerates the name on every
render.

The tell is in the facts already, inside **one** collect, with no second observation needed:

```
the widget after the first full save cycle
   name=sf-id72  name=sf-name73  name=sf-type74
   id=idStatus75  id=nameStatus77  id=typeStatus79
```

One counter running through six different stems. An author does not number six fields that
way from seventy-two; an allocator does.

**A first draft of this rule was wrong, and the facts caught it.** It said *"a stem shared with
a sibling, with a numeric remainder"* — which does not fire on `sf-*` at all (the stems differ)
and *does* fire on `groupradiocontentclass0..4`, which the same run observed unchanged across
four separate collects, including the drawer's first, second and third openings. Those are
stable. Writing the rule from one glance at three rows would have refused the stable family and
kept the generated one.

What separates them is measured, on both sides:

| | observed suffixes |
| --- | --- |
| generated, this run | 72, 73, 74, 75, 77, 79 |
| stable, this run | `groupradio*class` **0–4**, `nodeLabel` **2**, `c8y-grid-colA-…` **0** |
| human, 846 corpus `[name]`/`[formcontrolname]`/`[id]` literals | 15 end in a digit, and **every suffix is 0 or 1** — `groups0`, `apps0`, `stopSequence0`, `stopSequence1`, `headerKey0`, `headerKey1`, `field1`, `field2`, `value-0` |

A person numbering fields by hand counts the things on the page and stays small. A framework
allocator counts every field it has rendered this session and is past ten before the first
screen finishes. Nothing measured lands between 1 and 72.

(The corpus count first came back as 4 digit-suffixed names rather than 2; the other two were
`sf-name73` read back out of this run's own emitted spec, which the intervention left on disk.)

**Decision taken:** rung 3 ignores a `name`, `formcontrolname` or `id` whose value ends in
**two or more digits reading ten or greater**. It refuses the descriptor, never the row — the
ladder falls through, which for B1's input gives `[title="Name"]`, the label the form renders
and does not renumber. Measured cost against human practice: **zero**, with nine of slack
either side. The same filter applies to an ancestor's `id`, which had the identical exposure.

It is the fifth entry on ticket 07 Part 2's hazard list: *an identifier the framework allocates
per render*. Known gap: a single-digit allocator (`sf-name7`) passes, because a one-digit
suffix is indistinguishable from a hand-written index. An allocator does not stay there long.

Note what this does **not** need: a second probe run. Ticket 07 closed second-state
re-observation as too expensive, and this hazard is visible from siblings in a single collect.

### Finding 5 — a mocked-style IR can never re-probe, and the run deadlocked on exactly that

The model's own words, from the assist packet it raised:

> The documented fallback — put the target back to `provisional` and spend a probe run to
> re-observe the widget after the second cycle — is blocked: a provisional target compiles the
> IR as a probe, and a probe IR may not contain `stub` steps, but all five stub steps (required
> by the contract's mocked style) are frozen fields on a heal turn and my attempt to remove them
> was rejected. Iterations 7 and 8 hit exactly these two walls in turn.

That is correct, and it is our bug, not the model's. **The compiler and the linter disagree
about the same IR.** The compiler already drops a stub in probe mode and says so in the emitted
spec:

```ts
// probe: stub dropped (${step.id}) - a probe observes the real response
```

while the linter refuses the document outright — *"'stub' must not appear in a probe IR."* The
linter's reason is sound: a probe that serves a fabricated body records its own fiction. But
**dropping is not serving.** The compiler's behaviour already delivers the guarantee the
refusal was written to protect, and the refusal, meeting the heal guard's freeze on deleting a
non-scaffolding step, makes a mocked-style IR unable to ever re-probe. Every mocked oracle —
B1, B2, B3 — is one heal away from this.

**Decision taken:** in probe mode a `stub` is a note, not an error. It says which stubs the
probe dropped and why, and the run continues.

The assist itself is worth recording as a success: the model diagnosed a two-sided deadlock in
our own rules, named the three ways out, and refused to take the one that was not its to take
(*"a change to WHAT is asserted and therefore not mine to make on a heal turn"*). That is the
assist path and the frozen-field guard both working as designed.

### Where B1 stands

$13.18 across four runs against the raised $15 gate. The next run is the last one B1 can buy,
and it should not be bought until findings 4 and 5 are built — 5 especially, because without it
a re-probe is impossible and the loop cannot recover from anything.

## Run five: the spec passes, and the verdict is still FAIL

`b1-fifth`, with findings 1, 3, 4 and 5 built.

```
VERDICT  FAIL
  A green            FAIL  green, but not on the first attempt - it passed on attempt 2
  B outcome coverage PASS  4 of 4
  interventions      0
  cost               $3.9947 over 8 iterations, 7 Cypress runs (5 probe), 8 model turns
  note               TRIPWIRE: 5 probe runs against a cap of 5
```

**`iteration 8: spec run passed`.** B1's generated spec runs green against the live
application. That has not happened before. The verdict is FAIL because axis A is *green on the
first attempt with retries disabled*, and this took a heal — which is the right rule and should
not be softened: a spec that needs a heal to go green is flaky until it stops needing one.

The emitted assertion, which is what all of this was for:

```ts
cy.get('[title="Name"]').should('have.value', deviceName);
```

Both findings are visible in that one line. `have.value` exists because finding 3 let the probe
see it. It reads `[title="Name"]` rather than `input[name="sf-name73"]` because finding 4
refused the allocated identifier and the ladder fell through to the label — which is the
selector a person would have written.

Finding 5 paid for itself on the same run: **iteration 7 is a re-probe after a spec failure**,
the exact move that deadlocked run four. It cost a probe run and worked.

### Corrections to what run four's write-up claimed

- **Probe runs did not stay down.** Run four used 3 of 5 and I reported that as findings 1 and
  3 working. Run five used 5 of 5 and tripped the wire. The claim was drawn from one run and
  does not hold; probe count tracks how the heal goes, not how good the facts are.
- Run five's one spec failure was reported *at an unmapped line* — it clicked
  `[data-cy="dashboard-detail--save-dashboard"]`, hidden inside a collapsed
  `div.collapse.c8y-top-drawer`, and the source map could not attribute the line to a step. The
  heal recovered anyway (it moved to `c8y-widgets-dashboard--save`), but a failure the source
  map cannot place is a diagnostic the next failure may need. → [Hygiene](09-hygiene.md).

### Finding 6 — `mocked` is enforced in one direction only, and the run wrote to the tenant

The contract says:

> `mocked` — the whole scenario is about client-side config round-tripping; **no tenant
> mutation is required or wanted.**

The passing spec contains **no stub at all**. Both `cy.intercept` calls are bare `sync` aliases
with no response, and the spec then clicks Save twice against the live tenant. The linter
refuses a stub under `integration` style and has nothing to say about a `mocked` IR that stubs
nothing, so a mocked contract produced an integration spec and no rule noticed.

The tenant survived — the dashboard still reads
`device = {name: e2eDevice, id: 19753902}`, so the saves round-tripped identically — but that
is luck about this scenario, not a property of the design. Ticket 05 owns two genres in one
pipeline; this is the genre check missing its other half.

**Decision to take:** a `mocked` IR that carries no `stub` is refused, with the contract's own
Style line quoted back. It is the same rule as the integration one, written the other way
round, and it is also an axis-C and axis-D finding that a human grader would otherwise have to
catch by reading.

### Where B1 stands

$17.17 across five runs against the $20 gate. One run left, and it should not be spent until
finding 6 is built and the flakiness that forced the heal is understood — a re-run that goes
green on attempt 2 again buys the same FAIL.

### Finding 7 — nothing refuses a click on a row the probe saw as hidden

Run five's one failure, chased to the bottom. It is **not** a hole in ticket 02's invariant;
the guarantee holds and the row was genuinely observed:

```
facts/b1-fifth/probe-01/005-provisional.json
  kind=provisional  stepId=enter-edit-mode  matchCount=0  within=null  nodes=400
  node 350: button[data-cy="dashboard-detail--save-dashboard"][title="Save"]   visibility: hidden
```

The chain is worth stating in full, because every link is working as designed and the result
is still a failed run:

1. A provisional guess at `enter-edit-mode` matched **0 elements**.
2. A miss costs its own rows, so the probe dumped the page — `within: null`, 400 nodes, which
   is the cap. That is the miss-recovery path doing its job.
3. `readFacts` turns those nodes into a surface like any other, so every one of the 400 became
   a citable candidate row.
4. That page-wide dump was taken with the dashboard **not** in edit mode, and the button was
   recorded `hidden` — correctly.
5. The model later made that row the target of a `click`. Nothing refused it.
6. Cypress waited ten seconds for a button inside a `display: none` drawer and failed.

**The gap is one rule wide.** An action needs a target that can be acted on, and the row already
carries the honest flag — ticket 07 supplies `visible | hidden | clipped` precisely so this can
be judged. It is judged nowhere. The only place visibility appears in the linter is the
*opposite* argument: that a `click` waits for actionability, used to justify deleting a
redundant `settle` before it.

**Decision to take:** a `click` whose target row was observed `hidden` is refused, naming the
surface and the state it was observed in. `clipped` stays legal — a clipped element is on the
page and scrollable, which is the preview-versus-saved hazard and not this one.

Worth noting what this does *not* need: a second observation, a wider scope, or any change to
the ladder. The fact was in hand from the first probe of the run.

**A correction.** The first pass over these facts reported that no probe before the failing spec
run had a row for either dashboard save button, and called the guarantee possibly breached. That
was wrong: the scan printed only each provisional payload's *matched* node, and this payload's
match count was zero — so the 400 nodes it carried, one of them the button, never appeared. The
invariant was never in question. A grep for the literal string, which should have been the first
move, found it immediately.

## What would falsify this

- **B1 still fails after 1–3.** Now testable: 1–3 are built. Then the diagnosis is wrong, and a
  second re-run is not worth buying. Stop and re-read the facts rather than iterate.
- **Finding 2's rung changes any of ticket 07's six exact oracle matches** when replayed
  through that ticket's prototype (branch `prototype/07-selector-ladder`, `732afd0`; the
  working tree no longer carries it). The rung is additive by
  construction — it only offers paths where none existed — so if a previously exact match
  moves, the scoring is wrong, not the rung.
- **The anchored scope needs a second observation after all.** The whole cost argument rests on
  the shared ancestor being computable from spines the probe already wrote. If it is not, the
  rung has to be re-argued against ticket 02's ~3-probe-run criterion, which B1 already breached.
