# Runtime values in a declarative IR: raw expressions and nesting scope

Type: grilling
Status: open
Blocked by: —

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
