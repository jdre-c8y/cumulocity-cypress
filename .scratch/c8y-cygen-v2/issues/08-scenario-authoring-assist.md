# Scenario authoring: hazard checklist and cost signalling

Type: grilling
Status: open
Blocked by: 01

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
