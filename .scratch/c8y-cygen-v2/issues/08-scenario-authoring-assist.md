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
