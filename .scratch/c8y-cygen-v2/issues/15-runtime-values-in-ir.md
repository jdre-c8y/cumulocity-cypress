# Runtime values in a declarative IR: raw expressions and nesting scope

Type: grilling
Status: resolved
Blocked by: —
Assignee: jdre

## Question

Raised by [Probe mode](12-probe-mode-compiler.md), which found this by trying to compile
the **baseline** oracle rather than by inspection. Ticket 01's bar says B0 must PASS, and
the IR as settled in [Emission target](03-emission-target.md) **cannot express it**.

B0's oracle opens with a value only the runtime knows:

```ts
const newDeviceName = `${deviceName}${Cypress._.now()}`;
cy.createDevice({ name: newDeviceName });
cy.getDeviceIdByName(newDeviceName).then((deviceId: any) => {
  // the ENTIRE remainder of the test lives in here
});
```

Ticket 03 prototyped against B2 and B4. Neither needed a runtime value, so neither
exposed this. Four defects followed, all silent — the compiler emitted
`'...${Cypress._.now()}...'` inside **single quotes**, so the spec would navigate to a URL
containing a literal dollar-brace, with no error anywhere. Ticket 12's prototype
(`prototype/12-probe-mode`, `9a31ec8`, `compile2.mjs`) fixes all four and B0 now compiles
to the oracle's shape. **The fix works; the decision behind it was never argued.**

Resolve:

- **May a declarative IR hold raw TypeScript at all?** The prototype's `{ expr: '...' }`
  punches straight through the "declarative IR" premise that ticket 03 chose. By ticket
  02's own logic it needs the discipline stubs got: an **unanchored expression is arbitrary
  code the linter cannot reason about**, and it is the obvious way for an agent to escape
  every guardrail the design has built — a `.should()` whose value comes from an expression
  satisfies ticket 01's coverage check while asserting nothing.
- **If raw expressions are allowed, what anchors them?** A closed vocabulary of blessed
  expressions, by analogy with ticket 02's setup vocabulary? A whitelist of callable
  namespaces (`Cypress._`, `dayjs`)? Human approval per expression?
- **How does the IR express a nesting scope?** `captures` is not a step, it is a scope
  change. A flat step list cannot represent it. Options the prototype did not weigh:
  a nested `then:` block holding child steps; a flat list with an explicit
  `scopeStart`/`scopeEnd`; or making every capture bind for the remainder of the flow
  implicitly (what the prototype does).
- **Do fragments and outcomes still work across a scope boundary?** An outcome's
  `satisfiedBy` references a step id; if that step is inside a `.then()`, the source map
  from ticket 03 has to survive the nesting.
- **Does the ladder of preference apply here too?** Some runtime values have a blessed
  alternative — `getDeviceIdByName` is a repo helper, not an expression. Prefer a helper
  over an expression wherever one exists, by the same argument that made setup an
  enumerated vocabulary.

Cross-check against the two oracles ticket 03 used (B2, B4) to confirm no regression, and
against B0 and B1 to confirm the capability is enough.

Also carried over from ticket 12 and unfixed: the style profile emits `helperImport` for
`createDevice` / `getDeviceIdByName`, which are globally-registered Cypress commands
needing no import. That is a [Conventions scout](06-conventions-scout.md) defect, noted
there.

---

## Added by ticket 07 (selector ladder)

**Cypress aliases are a runtime binding the IR cannot express, and they are not rare.**

The corpus study in [Selector ladder](07-selector-strategy.md) found **241** literals across the
two target repos that are not selectors at all:

```ts
cy.get('c8y-data-grid--row-in-data-grid').first().as('rowInDataGrid');
cy.get('@rowInDataGrid').find('button').click();     // <- refers to a bound subject
```

`@rowInDataGrid` names a subject bound earlier in the same test. There is no candidate row for
it, no rung that could produce it, and the ladder has nothing to say about it. B2 — a mandatory
oracle — uses three (`@dataPointsListScroll`, `@auditLogs`, `@rowInDataGrid`).

This is the same shape as this ticket's `captures` question, and it should be answered with it
rather than separately:

- An alias is a **scope change with a name**, and it outlives the `.then()` nesting that `captures`
  introduces. Does one concept cover both, or are they genuinely two?
- The ladder's invariant is *no selector may enter the IR unless a probe observed it*. An alias
  reference bypasses that check by construction — it names a subject, not an element. What
  replaces the guarantee?
- `.as()` is also how the corpus does **intercept** aliases (`cy.intercept(...).as('dashboardObjects')`
  then `cy.wait('@dashboardObjects')`). Those are already a different thing from a DOM subject
  alias, and ticket 02 split `cy.intercept` into three verbs. Does the alias concept split the
  same way?

---

## Resolution

Grilling only — no prototype. The decisions below were argued against the **real** oracles
rather than the prototype's copies of them, and that is where the ticket's premise broke.

### The premise was wrong: B0 does not pass, and nobody noticed

Ticket 12 recorded that *"B0 now compiles to the oracle's shape."* That is true of a **reduced**
B0. The scenario contract lists **seven** Expected Outcomes; `B0.spec.flow.yaml` declares
**three** (ids 1, 2, 4). The four it drops are not incidental:

| outcome | what it checks | why the IR could not hold it |
| --- | --- | --- |
| 3, 5 | a time within ±3 minutes of now | reads a value **off the page**, then computes on it |
| 6 | at least one custom-data item | needed an `at least n` cardinality |
| 7 | the text holds the posted latitude and longitude | a substring test against a literal |

Ticket 01's bar says B0 must PASS, and PASS requires outcome coverage. **B0 fails today.** The
IR grows to meet the benchmark rather than the benchmark bending to meet the IR — the contract
was fixed before the design precisely so this question could not be argued the other way.

Outcome 6 needed nothing new: [Selector ladder](07-selector-strategy.md) already gave every
step a declared cardinality with an `at least n` form.

### A second silent defect: the IR called a helper that does not exist

`B0.spec.flow.yaml` contains `callRepoHelper: postEvent`. `createDevice` and
`getDeviceIdByName` are real commands in `cumulocity-ui-e2e/cypress/support/commands.ts`.
**`postEvent` is defined nowhere in either repo.** The real oracle uses
`cy.request('/event/events', 'POST', updateEvent)`.

The linter checks the *shape* of `callRepoHelper` and not whether the helper is real, so the IR
linted clean and would have failed only when Cypress ran. This is the hole ticket 02's blessed
vocabulary exists to close, and it was open.

### No raw code in the IR (Q2)

The prototype's `{ expr: '`...${Cypress._.now()}`' }` punches through the declarative premise
ticket 03 chose. An unanchored expression is arbitrary code the linter cannot reason about, and
it is the obvious escape from every guardrail the design has built.

**The IR holds no raw TypeScript.** It gets a **closed vocabulary of value builders** instead —
`now()`, `uniqueName(prefix)`, `isoTime()` and so on — by direct analogy with ticket 02's
enumerated setup vocabulary. A value the vocabulary cannot build stops and asks a human, who may
add a builder; that addition outlives the run and helps every later one.

A whitelist of namespaces (`Cypress._`, `dayjs`) was rejected: it looks cheaper but tells the
linter nothing about what a call *means*, and `Cypress._` alone hands a model an entire library.

### The vocabulary is seeded, not minimal, and it lives in the conventions file (Q9)

A small starting list would fire assist constantly. The corpus says so:

| expression | uses in `cumulocity-ui` specs |
| --- | --- |
| `dayjs(` | 327 |
| `Cypress._.now` | 178 |
| `Cypress._.clone` / `cloneDeep` | 203 |
| `Cypress._.times` | 26 |

So the scout pass that [Conventions scout](06-conventions-scout.md) already performs also mines
the repo's expressions and writes the builder list; a human reviews and commits it; every later
run reads it. No new artifact and no new machinery — the same one-time-scout shape that was
settled at charting. Ticket 08's warning applies directly: a teammate whose first scenario stops
three times concludes the tool does not work.

### Nesting is a compiler concern, not an IR concern (Q3)

The IR stays a **flat step list**. A capture binds for the remainder of the flow, and the
compiler decides where the `.then()` blocks go. Nesting is a fact about Cypress's async chain,
not a fact about the test, and a model should not have to reason about JavaScript scope to
describe one.

This also answers the ticket's fourth question for free: because step ids stay flat and unique,
an outcome's `satisfiedBy` still resolves and ticket 03's source map survives the nesting the
compiler introduces.

### Assertions split into three closed parts (Q4)

One assertion shape (`containsText`) cannot express a tolerance. Adding a verb per case would
grow the vocabulary once per oracle — the axis ticket 12 warned was unwatched.

An assertion is an **extractor**, a **comparator** and an **operand**, each from a closed list.

- extractors: `text`, `attribute`, `value`, `count`
- comparators: `equals`, `includes`, `matches`, `withinMinutesOfNow`
- operand: a literal, or a value builder

Outcome 3 becomes `extract: text, compare: withinMinutesOfNow, operand: 3`. Outcome 7 becomes
`extract: text, compare: includes, operand: 52.534925`. B2's
`.invoke('attr','title').should('equal', ...)` becomes `extract: attribute, compare: equals`.

This keeps the anti-gaming rule checkable: the linter can see that an outcome's assertion reads
from the **page** and compares against a **literal**, which is exactly what it has to prove.

### One concept: the capture (Q5)

Three corpus idioms share the `@name` syntax, and they are **one** IR concept with three
emissions:

| the test writes | the IR says | the compiler emits |
| --- | --- | --- |
| `cy.getDeviceIdByName(n).then(id => …)` | a capture of a step's value | a `.then()` block |
| `cy.get(…).as('row')`, later `cy.get('@row')` | a capture of a step's subject | `.as()` and `cy.get('@row')` |
| `cy.intercept(…).as('xhr')`, `cy.wait('@xhr')` | **not a capture** — the step id of a `stub`/`spy`/`sync` verb | an alias name the compiler invents |

Ticket 07's invariant survives untouched: **a capture names a step, never a selector**, so the
element was still found by the ladder and an alias reference cannot smuggle in an unobserved
selector — it does not contain one.

### A real API call for setup is allowed, and anchored (Q7)

B0's setup posts an event whose body mixes fixed fields from the contract, one field from a
capture, and one from a value builder. Under ticket 02's rule the tool would have to click
through the UI or ask for a new helper. The scenario contract itself sanctions `cy.request`.

**Prefer a blessed helper; fall back to a `request` verb when none exists — but anchor the
body.** Every field must trace to the scenario contract, a capture, or a value builder. Nothing
invented.

Ticket 02's anchoring rule was written for `stub`, and the reason was sharp: a wrong `stub` lets
an assertion pass against a fiction. **A real POST is not a fiction.** It creates real state, and
asserting on it is honest. So the part that transfers is the *anchoring*, not the ban.

### Correction to ticket 02: the `cy.c8yclient` ban is a house-style question

[Ground truth](02-ground-truth-and-setup-path.md) ruled `cy.c8yclient` never blessed. The corpus
disagrees with the reasoning behind that rule:

| idiom | `cumulocity-ui` | `c8y-ai-agents` |
| --- | --- | --- |
| `cy.request(` | 95 | 15 |
| `cy.c8yclient` | **0** | **37** |

The plugin repo uses it 37 times in its own hand-written specs. Refusing to emit it would make
every generated spec visibly foreign in the one target repo that prefers it, which fails the
house-style axis of ticket 01's grading. Whichever of the two a repo uses is a **conventions**
fact, not a safety fact — the safety property is anchoring, and it applies equally to both.

### Assist has one trip condition for vocabulary, not eight (Q8)

Ticket 10 named four trip conditions, ticket 12 added a fifth, and this ticket adds three more
candidates: no value builder, no blessed setup move, and a helper missing from the conventions
list. They collapse into **one**: *the IR needs a vocabulary entry that does not exist.*

[Assist handoff](13-assist-handoff.md) already describes its first condition as *"the human is
being asked to approve a new entry in the repo's setup vocabulary — a durable change that
outlives this run and benefits every later one."* That sentence covers all of them unchanged.
One condition, one packet shape, one growth mechanism — this makes ticket 13 smaller.

### The linter checks that a helper is real (Q6)

`callRepoHelper` names are checked against the enumerated helper list in the conventions file, at
**lint** time. Not at compile time: the linter exists so a bad IR is caught with no tenant and no
probe run, and a compile-time check throws that away. This turns the helper list from a
nice-to-have into a hard requirement on ticket 06.

### Cross-check against all four oracles

- **B0** — all seven outcomes expressible; setup expressible as an anchored `request`.
- **B1** — fully mocked, every value a literal. Needs nothing here; nothing here blocks it.
- **B2** — `extract: attribute, compare: equals`; three `@aliases` are captures; its counts are
  declared cardinality. No regression.
- **B4** — no runtime values at all. This ticket only adds vocabulary, so no regression.

### Known limitation: the IR cannot branch on live page state (Q10)

B2's author wrote a defensive helper — `if (!$el.hasClass('show')) { …click… }`. **No oracle
contract requires this**; B2's step 4 only says *return to the series/history section*. But the
corpus does it: `if ($…)` 32 times and `.then(($el) => …)` 99 times in `cumulocity-ui`.

Recorded as a limitation, not a capability. A conditional is the one construct that would make a
generated spec unprovable to the linter: it creates a path that never runs, so the anti-gaming
rule cannot show an outcome was checked. It is also usually avoidable — the probe already reports
what state the page is in, so the spec can act directly instead of guarding.

**Reopens if** a benchmark scenario, or a scenario a teammate actually writes, cannot be
expressed without one.

### Corrections to closed tickets

- [Probe mode](12-probe-mode-compiler.md) recorded *"B0 now compiles to the oracle's shape."* It
  compiles a B0 with three of seven outcomes, and calls a helper (`postEvent`) that does not
  exist.
- [Ground truth](02-ground-truth-and-setup-path.md)'s ban on `cy.c8yclient` is superseded: the
  transferable rule is anchoring, and the choice between `cy.request` and `cy.c8yclient` is a
  conventions fact.
