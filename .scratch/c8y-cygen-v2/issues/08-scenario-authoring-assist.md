# Scenario authoring: hazard checklist and cost signalling

Type: grilling
Status: resolved
Blocked by: — (01 resolved)
Assignee: jdre

## Question

The sharpest lesson in the v1 groundwork is that **scenario design decided cost**, and it
was applied by hand, by an expert, only *after* paying for the failures. An early version
of the second scenario asked the agent to manually add two custom links; the widget had
no "clear all" affordance (only "reset to defaults" and one-at-a-time delete) and a
manually-added link without an icon did not reliably render one — both entirely
incidental to the regression under test. Redesigning the scenario to exercise the
widget's own auto-seeded default state "avoided both problems entirely and cut the
interaction count substantially."

That is the single largest realised cost reduction in the whole v1 build, and it came
from the human's input document, not from any code. Under team adoption the human writing
that document will not have the author's context — and a teammate whose first scenario is
an expensive, flaky one concludes the tool does not work.

Resolve what assistance actually looks like:

1. **A hazard checklist** derived from the four §3 pitfalls — per-render-branch
   selectors, value shapes varying across instances of "the same kind of thing",
   preview-vs-saved viewport differences, and hand-building state the component can seed
   itself. Applied to the scenario *before* any agent turn is spent. This may be most of
   the value for very little machinery.
2. **Cost signalling.** Cost scales with interaction turns, which is hard to predict from
   scenario text — but "this scenario asks you to build state through the UI; the
   component may be able to seed it" is a cheap, checkable heuristic. What else is?
3. **Who applies it** — a human reading a doc, a deterministic lint over the scenario
   contract, or an LLM review pass?
4. **Is it advisory or blocking?** A blocking gate on a heuristic will eventually be
   wrong and infuriating; a purely advisory note will be ignored.
5. Does the scenario contract format need new sections to support this, or does the
   validated Objective/Preconditions/Setup/Steps/Expected-Outcomes/Style format suffice?

Guard against scope creep: this ticket is about the *input document*, not about the
generator's runtime behaviour or budget enforcement (which is fog under "Cost
predictability").

---

## Added by ticket 07 (selector ladder)

**A fifth hazard for the checklist, found by the ladder refusing to resolve a benchmark oracle.**

*A text value that is a prefix of another text value on the same surface.*

B2's own oracle contains it. It scopes with
`cy.contains('c8y-datapoint-selector-list-item', 'e2eSeries')`, but `cy.contains` matches on a
**substring**, and the same page holds `e2eSeries2`. The scope is therefore ambiguous, and the
oracle only works because `cy.contains` yields the first match in DOM order and the author added
`.first()` further down the chain.

This is a scenario-design hazard, not a generator bug: the series were **named** `e2eSeries` and
`e2eSeries2` by whoever wrote the fixture. A checklist item — *do any two things this scenario
names share a prefix?* — costs nothing and would have caught it before a single agent turn.

Note the interaction with cost signalling: the ladder refuses such a target and routes to assist,
so a prefix collision converts directly into a human interruption. That is the checklist earning
its keep in the currency this ticket cares about.

---

## Added by ticket 04 (replay and determinism)

**A sixth hazard — and the first one that costs nothing to acquire, because the host repo
already maintains it.**

*Does this scenario touch a flow the target repo has declared un-mockable?*

`cumulocity-ui` tags tests with `{ tags: '@requiresBackend' }`: **134 occurrences across 57 of
200 spec files (28.5%)**, consumed by a CI switch
(`.github/workflows/cypress-build-pipeline-testing.yml:80-84`). It is a hand-applied,
CI-enforced statement by the people who own those tests that the flow cannot be faked.

Concentration is informative for this checklist: authentication dominates (SSO 11, users 9,
ignore-case login 8, trusted certificate 7, login 7, CRL 5), then microservice and application
lifecycle. `c8y-ai-agents` has no equivalent tag at all, so the signal exists in the host repo
only.

Two properties make it worth adopting:

- **It is free.** No analysis, no probe run, no model turn — a grep against a file the target
  repo already maintains. Every other hazard on this checklist is derived; this one is *read*.
- **It is a lower bound, and should be treated as one.** No lint rule enforces the tag, so
  absence is not evidence of mockability. A scenario touching a tagged area is a hazard; a
  scenario touching an untagged one is merely *not known* to be.

Interaction with cost signalling, which this ticket cares about: the tag marks flows where
setup cannot be shortcut by a `stub`, so it predicts the expensive path ticket 02 named —
clicking through the UI because no blessed move exists. This is the cheapest available
predictor of that cost, available before a single agent turn.

Acquisition belongs to the conventions scout (see ticket 04's answer, §7.1), which is where a
per-repo, human-maintained fact of this kind is already collected.

---

## Added by ticket 05 (two genres)

**The scenario contract needs no genre field.** This ticket might reasonably have designed
one — *"is this a UI spec or a contract spec?"* — since ticket 05 was charted asking whether
a human or the tool decides.

[Two genres](05-two-genres-one-pipeline.md) resolved that neither does: the contract genre is
**out of scope**, and the boundary is drawn from **IR shape** (zero DOM steps) at lint time,
never from a human's declaration. So the scenario contract stays single-genre and gains
nothing here.

**What it does gain, indirectly:** the IR can now assert on a response — two extractors,
`status` and `body.<path>`. So an Expected Outcome may legitimately be about a response
payload rather than the page (16 host spec files already write specs of that shape). A
scenario whose outcomes are *all* payload-shaped will be refused as contract-genre, which is
a hazard worth listing in this ticket's checklist: it is cheap to write and refused late-ish,
at lint time.

---

## Resolution

**There is no hazard checklist. There is an authoring interview, and it is delivered as a
skeleton scenario file.** The checkable half of this ticket evaporated under measurement:
every check it proposed either matches contract prose against a repo inventory — the exact
operation that fails — or refuses a benchmark oracle. What survives is the mechanism that
*did* work in v1, made repeatable: the author who knows the component writes the hazard into
the scenario prose, next to the step it endangers, and the model reads it there.

### The checklist's true positives are circular

Applied to the five benchmark scenarios, the six candidate hazards fire on **13 of 30
(scenario, hazard) cells — 8 true positives, 5 false**. That looks acceptable until you read
why the true ones fire. The trigger text in every well-covered cell is a warning **the author
had already written**:

- `B2:67-69` — *"(Note: the element carrying that value is addressed differently once the
  render type changes — a selector that worked in outcome 1 is not guaranteed to match
  here.)"*
- `B4:46-47` — *"(The control that opens it is labelled differently depending on whether a
  provider already exists — accommodate both labels.)"*
- `B3:74` — *"Change the "Display as" option to its other value (Grid ↔ List)."*

So the checklist detects a hazard exactly when an expert has already applied it. That is the
opposite of this ticket's stated use case — *"the human writing that document will not have
the author's context."* Meanwhile **B0 and B1 are nearly invisible to it** (1 and 2 weak cells)
and carry genuine hazards anyway: B0 mutates a `describe`-level fixture through a shallow
`Cypress._.clone` (`events.cy.ts:82-83`, while the same file uses `cloneDeep` at `:27`), and
B1 needs a byte-exact `$filter=` intercept string (`widget-asset-selector.cy.ts:43`).

**The checklist measures whether an expert wrote the scenario. It does not find hazards.**

That reframing is the resolution. The mitigation worth industrialising is not the audit — it
is the annotation.

### What the design had already dissolved

**Hazard 4 is struck.** *"Hand-building state the component can seed itself"* was expensive in
v1 for a reason the design has since removed. The groundwork names it: the agent had **no way
to shortcut data setup via a direct API call**, so even *"a group with an empty dashboard
exists"* was clicked through Playwright turn by turn. The cost was in **exploration**, not in
the emitted spec — v1's own expensive scenario already instructed `cy.createGroup`. [Ground
truth](02-ground-truth-and-setup-path.md) makes the probe a compiled Cypress spec that runs
blessed setup moves, so exploration now takes the shortcut the spec always could.

The archived diff shows the redesign cut cost in two independent ways, and only one was setup:

| change | dissolved by the design? |
|---|---|
| create a group + dashboard → reuse an existing one | **Yes** — a blessed setup move |
| add two links by hand → use the widget's seeded defaults | **No** — the widget has no "clear all" affordance |

The second is not a setup problem at all. It is *"reaching this state costs many interactions
because the component offers no cheap way there"* — which survives as an interview question,
not as hazard 4.

Struck under the retirement rule this ticket establishes: **a hazard whose cause the design
removed leaves the list, with the reason recorded.** Nothing had ever left the list before;
four tickets had only added.

### The scenario lint is empty

This ticket set out to decide *"a human reading a doc, a deterministic lint over the scenario
contract, or an LLM review pass?"* The answer is **a human, plus the IR-time lint the tool
already has.** No deterministic check over scenario *text* survives, and both deaths are
instructive.

**The blessed-move check runs on the IR, not the scenario.** *"Does every Setup line have a
blessed move?"* requires matching contract prose against a repo inventory. That is precisely
the operation hazard 6 was measured doing, and it fails (§ below). Setup prose describes state
to establish; it does not name commands, and the mapping is interpretation. The tool already
holds this check in the right place: [assist](13-assist-handoff.md) trip condition 1 fires when
the **IR** names a vocabulary entry that does not exist. That is exact, nothing is guessed, and
it still lands before any **probe run**, because authoring the IR costs no Cypress run.

**Outcome coverage also runs on the IR.** The rule this ticket first proposed — *every Expected
Outcome names a concrete value* — was measured against all five oracles and refuses four of
them:

| oracle | outcomes | carrying a literal |
|---|---|---|
| B0 | 7 | 2 |
| B1 | 4 | **0** |
| B2 | 6 | 0 |
| B3 | 3 | **0** |
| B4 | 6 | 2 |

**25 of 26 outcomes would be flagged.** And the outcomes are fine. B1's *"the widget's displayed
name field still holds exactly the configured device's name"* has no literal and is exactly
checkable, because Setup established that name — it is a **capture**. B0's *"within ±3 minutes
of now"* is [ticket 15](15-runtime-values-in-ir.md)'s `withinMinutesOfNow` comparator over a
`now()` value builder. The missing property was never *literal*; it is **anchored**, the word
this design already uses for a fabricated body.

The real defect is in the *checker*, not the scenarios. v1 matches an Expected Outcome to a
`.should(...)` by literal anchors and word overlap
(`assertionTraceChecker.ts`, `extractLiteralAnchors`), so it degrades exactly when literals are
absent. **Fix it at the source: in the IR, each assertion declares which Expected Outcome it
satisfies.** Coverage becomes exact, the text heuristic dies, and [ticket
03](03-emission-target.md)'s mandated source map already carries the machinery.

Stated cost of that move: v1's checker was independent of the model, and a declared mapping
trusts the model to map honestly. It still cannot fake *coverage*, and ticket 02's rule — no
outcome satisfied by a value traced to a `stub` in the same `it()` — becomes **easier** to
check, because you know which assertion to trace. What is lost is a weak signal against a
related-but-shallow assertion.

### The six candidate hazards, item by item

| # | hazard | disposition |
|---|---|---|
| 1 | per-render-branch selectors | **Interview question.** Needs component knowledge; the author has it. |
| 2 | value shape varies across instances | **Interview question.** |
| 3 | preview vs. saved viewport | **Interview question.** |
| 4 | hand-building seedable state | **Struck.** Cause removed; residue becomes an interview question about interaction count. |
| 5 | shared prefix among named things | **Struck as a check.** One interview question survives. |
| 6 | `@requiresBackend` | **Fact kept, matcher struck.** Consumer moves to the style decision. |

**Hazard 5 fails three ways, each measured.** The operative relation for `cy.contains` (and for
`[attr*=]`, used at `cockpitWidgets.cy.ts:1765`) is **substring, not prefix** — run over spec
text the prefix rule *misses B2's own motivating case*. On the real corpus it produces 25
candidate pairs across 19 of 141 files, of which **8 are true and 17 false: a 68% false-positive
rate**; switching to substring raises the pool to 45 pairs across 30 files. And this ticket's
causal claim was wrong: the `.first()` at `cockpitWidgets.cy.ts:1708` is applied to elements
found *inside* an already-singular `cy.contains` result and cannot disambiguate it — **fixture
ordering saves the oracle** (`dashboard-objects.json:64` before `:80`), and three other
ambiguous sites (`:1694`, `:1723`, `:1773`) carry no `.first()` at all.

Against that, [the ladder](07-selector-strategy.md) already refuses an ambiguous target,
measured against the real **collected surface**, at zero false positives. The trade is a
68%-wrong warning before any cost, versus an exact refusal one probe run later — and **assist
is a first-class supported outcome**. The ladder wins. A warning wrong two times in three, which
also misses the case it was derived from, trains a team to ignore warnings.

**Hazard 6's numbers are all confirmed exactly** — 134 occurrences, 57 of 200 spec files
(28.5%), the CI switch at `cypress-build-pipeline-testing.yml:80-84` via `@cypress/grep`, the
concentration figures, and zero tags in `c8y-ai-agents` (which has no tag mechanism at all).
**The matching is what fails.** Keyword matching over tagged file bodies gives B0 a precision of
1 in 37 (2.7%). The fairest matcher available to contract text — file path plus tagged `it()`
titles — returns **the same three files for B1, B2 and B3** and zero for B4, because the tag
inventory's vocabulary tops out at "cockpit / widget / dashboard" and never reaches "asset
properties", "data points table" or "quick links". It also reads at *file* granularity while
[the benchmark](../benchmark/README.md) fixes the oracle unit at one `it()`;
`cockpitWidgets.cy.ts` is simultaneously tagged (3 tests, at `:646`, `:2680`, `:2764`) and the
home of a fully mocked, untagged oracle at `:1687`.

And the decisive one: **B0 itself carries the tag** (`events.cy.ts:77`). A blocking hazard-6
gate would refuse the regression floor the pass bar requires. The fact is free and true; only
its proposed consumer was wrong. It stays in the **conventions file** where [replay](04-replay-and-determinism.md)
put it, read by whatever decides mocked-vs-integration style.

### The authoring interview

Seven questions, delivered as HTML comments in a **skeleton scenario file**, with the five
benchmark scenarios shipped beside it as worked examples. The author replaces each comment with
an answer or deletes it. Answers land in the prose **next to the step or outcome they concern**,
which is where B2's and B4's authors put them and why those annotations worked.

1. **Render branches.** Does any element you name render in more than one way? Name each way.
2. **Cheap state.** Can the component seed this state itself? If you must build it, say roughly
   how many interactions that takes.
3. **Value shape.** Does a value you assert on arrive in more than one shape across instances
   of the same kind of thing?
4. **Preview vs. saved.** Do you assert inside a config preview *and* on the saved component?
   They are not the same viewport.
5. **Similar names.** Do any two things you name look alike to a substring match?
6. **Formatted values.** Is a value you assert a formatted version of the underlying data —
   rounding, locale, or units?
7. **Value source.** For each Expected Outcome, where does its value come from — a literal, a
   value the scenario establishes earlier, or a time expression?

Question 6 earns its place from a defect in B2's own contract: the scenario says *"e.g.
`15.34`"* (`B2:36`), but the fixture holds `15.34432`
(`measurement-series.json:4-5`). The rendered text passes through `| number: getFractionSize()`,
which returns `'1.2-2'` (`datapoints-table.component.ts:65`) and is configurable per widget. The
contract quotes the *rendered* value as if it were the data.

Questions 1, 2 and 4 are the ones no reader of scenario text can answer. That is why this
ticket had to settle *who writes a scenario* before it could settle anything else: the author is
the person who owns the regression, and knows the component but not the tool. Under any other
audience these three hazards would have had to move into the tool, at real cost.

### Cost signalling, honestly

Scoped to signals that are free and available before any run; full cost estimation stays in the
map's fog, where it waits on benchmark data that does not exist.

This ticket first claimed a sharp free signal — the count of Setup lines with no blessed move.
**That claim does not survive §"The scenario lint is empty".** The count is exact only over the
IR, which is one cheap model turn in, not zero. What remains available from scenario text alone
is coarse: the number of Steps, and whether Steps describe interactions or navigation. Interview
question 2 asks the author directly for the interaction estimate, which is the most reliable
cheap signal here precisely because the author knows the component and a matcher does not.

Recorded as a downgrade, not a finding: the free pre-run cost signal this ticket hoped for is
weaker than charted.

### Governance

- **Admission.** A hazard enters after it is observed in a real failure.
- **Placement.** Mechanically checkable ⇒ a check. Needs human judgement ⇒ the interview.
- **Enforcement.** Only a **fact** may stop a run; a heuristic may only warn. Every blocking
  hazard is therefore already an assist trip condition, so **this ticket adds no new gate**.
- **Ownership.** General hazards are tool-owned; per-repo facts live in the conventions file.
  Hazard 6 is the worked example of the second kind.
- **Growth.** Each **assist** event is a hazard candidate; a human promotes the ones that
  recur. The **attempt log** already records why every run stopped, so the evidence stream costs
  nothing new — only the promotion step is added.

The growth rule is the one v1 measurably lacked. Its `prompts/domain-notes.md` (5,341 bytes, 8
sections) was injected into every system prompt and pleaded in its own header *"Update this file
when a new gotcha is discovered during a generation run — it is meant to accumulate."* It did
not: **two hand commits in the file's entire life**, no tool could write to it, and one of those
commits was a human generalising a widget-specific note by hand before committing. Note also
that v1 labelled the target app's house rules **"hard constraints"** and gave the domain notes a
bare heading — the advisory/blocking split already existed there, informally and undesigned.

### The scenario contract format is unchanged

Objective / Preconditions / Setup / Steps / Expected Outcomes / Style stands, with only Steps
and Expected Outcomes required to be lists. Nothing this ticket decided needs a change:

- Setup need not become a list, because the blessed-move check moved to the IR.
- Expected Outcomes is already a numbered list that v1's parser splits into an array, so an
  outcome is addressable by index for the IR's declared mapping.
- Interview prompts ride as HTML comments, which the parser already ignores — as it ignores
  unknown `##` sections, deliberately.

A dedicated "Hazards" section was considered and rejected: B2 and B4 show the annotation works
*because it sits next to the step it warns about*, and a distant section would need a new parser
consumer for no gain.

**This is the fourth consecutive ticket to leave the format alone** — after
[two genres](05-two-genres-one-pipeline.md) declined a genre field. The format has now absorbed
a genre decision, a runtime-value vocabulary, a selector ladder and an authoring interview
without a new section. That is worth recording as evidence the format is right, not as an
accident.

### Thirteen further hazards: recorded, not admitted

Measuring H1-H6 against the oracle specs surfaced **13 hazard classes none of them catches**,
among them: shallow-clone aliasing of a shared fixture; exact-match intercept query strings;
hard-coded fixture-internal ids in intercept URLs; conditional DOM branching inside a test;
fixed sleeps and `{ force: true }`; locale-dependent text selectors in the plugin; label/value
divergence in dropdowns; long custom timeouts; clock drift inside an assertion window; and
virtual-scroll off-screen rendering.

All were observed in **hand-written specs, not in failures**, so none meets the admission bar.
They are recorded with their evidence and enter, if they are real, through the assist-event
route. Bending the bar one round after setting it is how the list became folklore the first time.

Two are routed out of this ticket rather than held:

- **A `data-cy` value that is a UI copy string** is a **correction to [the selector
  ladder](07-selector-strategy.md)**, not an authoring hazard.
  `widget-config-section.component.html:10` binds `[attr.data-cy]="section.label"`, where the
  label is `gettext('Asset selection')` — consumed as `[data-cy="Asset selection"]`
  (`widget-asset-selector.cy.ts:112`) and `[data-cy="Time context"]`
  (`cockpitWidgets.cy.ts:1769`). It is locale-stable, because the raw key is bound and the
  translation applied only for display. But **it looks like rung 1 and behaves like a text
  selector**: reworded UI copy silently breaks every spec that uses it. The ladder ranks rungs
  by how well they survive a UI change, and this rung does not survive as well as its position
  claims.
- **An asserted value that is a formatted derivative of the data** becomes interview question 6.

### Answers to the five sub-questions as posed

1. **A hazard checklist?** No. An authoring interview of seven questions, in a skeleton scenario
   file. The checklist framing produced bad checks because it assumed hazards are visible in
   scenario text; measurement says they are visible only to someone who knows the component.
2. **What else is a cheap cost signal?** Less than hoped. The sharp candidate moved to the IR;
   what is left free is the author's own interaction estimate, asked directly.
3. **Who applies it?** The author, while drafting. Not a lint over the contract — no such lint
   survives — and not an LLM pass, which would spend a model turn to ask a human what the human
   could type.
4. **Advisory or blocking?** Neither, as posed. Only facts block, and every such fact is already
   an assist trip condition. The interview is advisory by construction, and its output is not
   advice but *content in the scenario*, which is why it is not ignorable in the way v1's domain
   notes were.
5. **Does the contract format need new sections?** No.

### Corrections and hand-offs

- **Corrects this ticket's own §"Added by ticket 07":** `.first()` does not save B2's oracle;
  fixture ordering does. The sentence the fifth hazard was reasoned from is wrong, and the
  hazard it produced does not survive measurement either.
- **Corrects this ticket's own §"Added by ticket 04":** hazard 6 is *"free"* only to acquire.
  Applying it is not free and not reliable, and a blocking version would refuse B0.
- **Corrects [ticket 07](07-selector-strategy.md):** a `data-cy` value bound from translatable UI
  copy sits at rung 1 but survives a UI change like a text selector. See above.
- **Clarifies [ticket 06](06-conventions-scout.md):** `@requiresBackend` stays a conventions
  fact, but its consumer is the mocked-vs-integration style decision, never a scenario matcher.
- **Requirement for [ticket 03](03-emission-target.md):** the source map gains a second duty —
  each IR assertion declares the Expected Outcome it satisfies, replacing v1's text-overlap
  anti-gaming matcher.
- **Hands [ticket 13](13-assist-handoff.md)** a second consumer for the assist packet: it is the
  evidence stream from which hazards are promoted. Also confirms trip condition 1 fires at
  IR-authoring time, before any probe run — earlier than the packet's "I tried, here is the
  failing assertion" shape assumes.
- **Adds zero IR verbs.** One IR property (an assertion's declared outcome id). No new
  vocabulary, no new extractor or comparator.
