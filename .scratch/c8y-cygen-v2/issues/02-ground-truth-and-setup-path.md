# Ground truth: where does it come from, and what must go through the UI?

Type: grilling
Status: resolved
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

---

## Answer

Resolved by grilling, four rounds. Two decisions in one: **where ground truth comes
from** (a pipeline) and **where the setup/SUT line falls** (a rule). They turned out to
be less entangled than the ticket assumed — the first is about what the *generator*
learns, the second about what the *generated spec* does.

### Vocabulary this decision fixes

These terms are load-bearing for every later ticket. (A repo `CONTEXT.md` is deferred by
the user; until it exists, this section is the glossary.)

- **Surface** — what is on the page in a given application state: candidate elements and
  their selectors, the requests fired, the response shapes. A *dump*. Deterministic.
- **Reachability** — the interaction sequence that moves the application from its
  established precondition to that state. A *search*. The only thing that may need a
  model in the loop.
- **Probe / probe mode** — the same IR compiled with the dump back-end instead of the
  spec back-end: it navigates, establishes state and records surface, emitting no
  assertions.
- **Facts file** — the probe's validated output; the input to IR authoring.
- **Candidate table** — the reduced representation the model is shown in place of DOM.
- **Blessed setup vocabulary** — the per-repo, human-reviewed, closed list of moves that
  count as setup.

### 1. Ground truth splits into Surface and Reachability

The ticket treated ground truth as one substance, which is why "which of three sources"
looked like the question. It is two substances with costs an order of magnitude apart.

v1's own tool surface (`src/browser/browserTools.ts`, branch `c8y-e2e-generation-agents`,
`f4ebd74`) splits exactly on this line:

| surface — no decision needed | reachability — decision needed |
| --- | --- |
| `snapshot`, `listDataCy`, `captureNetwork` | `navigate`, `click`, `type` |

Half of v1's tool surface was pure dumping, and **every call to it cost an LLM turn**.
That is the largest single cost defect identified so far, and it is structural, not a
tuning problem.

- **Surface is harvested deterministically.** No model, ever.
- **Reachability is answered in priority order:** committed reachability index first
  (see 3), residual agentic exploration only for what the index does not cover.

### 2. One runtime: the probe is a Cypress spec, compiled from the same IR

**Decision: Q6(b) + Q10(b).** The harvester is not a standalone browser driver. It is a
Cypress spec, compiled from the *same IR* as the output, through a second compiler
back-end.

Rejected: standalone Playwright/CDP (v1's approach). Two reasons, the second decisive:

- **Fidelity gap.** v1 learned facts in one browser under bespoke auth
  (`src/auth/authSession.ts`, 144 lines) and emitted code for a different browser under
  different auth. Both hand-patches the human had to make on v1's hard scenario were
  selector/assertion bugs — the exact class a fidelity gap produces. This is a live
  suspect for why v1 disappointed.
- **A Playwright harvester cannot execute a blessed setup move**, because those are
  `cy.*` commands. Under the setup rule below that is not an inconvenience; it makes the
  approach unable to establish preconditions at all without re-implementing the house's
  entire setup library.

Because probe and spec compile from one IR, the reachability the tool verified is the
reachability it ships — "worked when I explored, fails in the spec" stops being possible.
It also gives ticket 11 its diagnostic primitive nearly free: to re-examine a failing
assertion, recompile the same IR in probe mode.

**Facts leave the browser through our own task** (`Q11(b)`): `packages/c8y-cygen`
registers a `c8y:cygen:facts` task in its own Cypress plugin, following the public
pattern `configureC8yPlugin` already establishes with `c8ypact:save`. No modification of
`cumulocity-cypress` — consistent with the packaging constraint. Node-side schema
validation at this boundary is required: a malformed facts file is the input to every
downstream decision and would otherwise fail silently.

**Facts are an ephemeral build artifact** (`Q16(a)`) — gitignored, cached by
(route, precondition), reused across runs and heals. Not committed. The committed,
human-reviewed surface stays at exactly two artifacts: the conventions/reachability index
and the spec. This makes healing require a reachable tenant, which is precisely what
ticket 04 is holding.

### 3. The existing spec corpus is a first-class source

**Decision: Q2(b) + Q9(c).** `cumulocity-ui` has 200 e2e specs (154 excluding the 46
documentation-screenshot ones) that already encode known-good reachability for much of the
app. They are read as **priors, always verified live** — never copied unverified.

Retrieval is a **pre-built index**, extracted lexically by route and component tag, and it
lives in the conventions-scout artifact rather than in a separate mechanism: identical
economics, identical staleness risk, identical review requirement. Ticket 06 grows
accordingly.

This degrades gracefully by design. `cumulocity-ui` gets rich priors; `c8y-ai-agents`
(11 specs) gets thin ones; the generator behaves the same either way.

### 4. The model is shown a candidate table, never DOM

**Decision: Q12(c).** For each element that could plausibly be acted on or asserted
against: ladder-ranked selector, tag, `data-cy`, role, accessible name, visible text,
visibility — plus the network calls observed in that state.

Ticket 03 settled that the agent emits IR referencing selectors rather than writing code,
so the model never needs to *read* DOM; it needs to *choose*. That enables the invariant:

> **No selector may appear in the IR unless a probe observed it.**

Mechanically checkable by the linter. It converts hallucinated selectors — a failure v1
hit and a human had to hand-patch — from discouraged to impossible.

### 5. `cy.intercept` is three verbs, not one

**Decision: Q3.** Measured across the 154 e2e specs: **1133 `cy.intercept` call sites**,
but only **63 specs stub** a response (`fixture:`/`body:`), against **810 `cy.wait('@alias')`**
versus **131 numeric sleeps**. Overwhelmingly, `intercept` in this house is a
*synchronisation* primitive, not a mock.

The IR therefore has three distinct verbs:

| verb | job | classification |
| --- | --- | --- |
| `stub` | fabricate a response | **setup** |
| `spy` | observe a call in order to assert on it | **thing under test** |
| `sync` | alias a route so a later wait can block on it | neither — waiting vocabulary |

Separate verbs, not one verb with a mode flag: a wrong `sync` makes a spec flaky, a wrong
`stub` makes it **pass against a fiction**. Collapsing them lets the agent slide silently
from syncing to fabricating, and no linter could catch it.

### 6. The setup/SUT line — the ticket's central question

**There is no principled line.** The line asked for does not exist in the abstract, and
the evidence says so plainly: the house's own answer is neither principle nor pure
judgment but a small library of blessed helpers that encode the decision once, per data
type. What replaces it is a **mechanical** rule in three parts, stated to be applied by a
generator without a human:

1. **Setup is enumerated, not inferred.** A step is setup *iff* it uses a move in the
   repo's **blessed setup vocabulary** — a per-repo, human-reviewed, closed list.
   Everything else — every navigation, click, type, and every assertion — is the thing
   under test and goes through the UI.
2. **The vocabulary is closed at generation time** (`Q4(c)`). The agent may not invent a
   setup move. A precondition with no blessed move leaves exactly two options and no
   third: establish it through the UI, or propose a new blessed move to the human-assist
   path. **`cy.c8yclient` is never blessed** — arbitrary authenticated REST with no
   paired teardown is the single most dangerous capability in the library.
3. **Fabrication must be anchored** (`Q14(c)`). A `stub` body must either be produced by a
   blessed helper, or **derived by recorded mutation from a response the probe actually
   observed**, with the mutation explicit in the IR. A body invented from nothing is not
   emittable.

**Where the risk binds** — the ticket asked to say. At exactly one place: an **unanchored
`stub`**. It does *not* bind at real REST creation (that produces genuine state) and it
does *not* bind at `spy` or `sync` intercepts (they change nothing). Containment is rule 3
plus the anti-gaming invariant:

> **No Expected Outcome may be satisfied by an assertion whose value traces to a `stub`
> in the same `it()`.** Spy-satisfied outcomes remain legal — "the app sends `PUT` with
> this payload" is a legitimate outcome.

This is the anti-gaming rule ticket 01's guardrail needs, and it is only checkable because
of ticket 03's source map from assertions back to IR steps. Without it, the cheapest route
to green is to stub the value about to be asserted — the most rewarding wrong move in the
system, and one that yields a *passing* spec, so nothing else would ever catch it.

**Corroborating evidence, not invented for this ticket:** `cumulocity-cypress` exposes its
setup commands in create/delete pairs — `createUser`/`deleteUser`,
`createGlobalRole`/`deleteGlobalRoles`, `assignUserRoles`/`clearUserRoles`. The blessed
vocabulary was *already* built around "reset only what you created".

Counter-evidence that shaped rule 3 rather than being ignored: `cy.createMockedDevice`
(49 call sites) synthesises `self: 'https://someTenant.stage.c8y.io/…'` — a hostname no
real tenant returns. Blessed fabrication that would fail the derivation test. That is
exactly why the blessed set exists as an escape valve rather than the rule being
"never fabricate".

### 7. Preconditions: always establish; reset only your own footprint

- **`Q5(a)` — always establish a known state**, resetting if needed. The tolerate-both
  pattern that `c8y-ai-agents`' `provider-management.cy.ts` uses
  (`.contains(/Change provider|Add global provider/)`) is *not* reproduced by the
  generator. B4 remains a valid oracle; its regex is now understood as a symptom of
  observing one ambient state and later discovering the other.
- **`Q7(c)` — reset is per `it()`, lives in the spec, and covers only state the spec
  itself created.** The tool never resets state it did not make. This is the only option
  that keeps generated specs indistinguishable from hand-written ones (the benchmark
  grades flow equivalence) and keeps them standalone-runnable, and it bounds ticket 09's
  teardown problem to the finite blessed vocabulary.
- **`Q8(a)` — exploration establishes the same precondition the spec will**, before any
  observation. Otherwise every harvested fact is state-contingent. `Q8(c)` — deliberate
  re-observation from a second state to detect state-dependence — is **reserved**, opt-in
  per scenario, and is the only mechanism that would automatically catch the "same
  element, different `[data-cy]` per render branch" hazard. Ticket 07 decides when it
  fires.

### 8. Ruling on the ticket's three candidate sources

| candidate | ruling |
| --- | --- |
| **Agentic browser exploration** | Survives, **confined to residual reachability**. Never surface. Never what the reachability index already answers. |
| **Deterministic non-LLM harvest** | **Primary source**, realised as the probe spec's dump rather than as a standalone scraper. |
| **`c8yctrl` proxy recording** | **Not part of acquisition.** A Cypress probe obtains network ground truth from `cy.intercept` in the same run. Its value collapses to *replay* and defers wholly to ticket 04. |

The `c8yctrl` demotion is a larger move than the ticket anticipated and was flagged as
such before confirmation.

### Cost consequence to carry forward

`Q4(c)` and `Q5(a)` interact: setup is a closed vocabulary *and* state must always be
established, so a precondition with no blessed move can only be established by clicking
through the UI — the most expensive path available. This is not a contradiction; it is the
system's cost curve. **The blessed vocabulary is the primary cost lever in the whole
design, and growing it is how the tool gets cheaper over time.** In `c8y-ai-agents`, where
the blessed set is nearly empty, early runs will be expensive by construction.

Related, and promoted from a groundwork tip to a design constraint by `Q5(a)`: *"testing a
component's own default/seeded state was far cheaper and more reliable than hand-building
state through the UI."* Under always-establish, a scenario whose precondition **is** the
default state costs near zero to establish. That is now a scenario-selection criterion —
ticket 08.

### Pre-registered falsification criterion

`Q6(b)` buys fidelity with latency: a probe "turn" is a whole Cypress run, not a
millisecond CDP call.

> **If any benchmark scenario needs more than ~3 probe runs to reach a complete facts set,
> reopen Q6** and reconsider the hybrid (Playwright for cheap poking, Cypress probe to
> confirm before facts enter the IR).

Registered now so it is honored rather than quietly moved — as B4's criterion was in
ticket 03.

### Facts later tickets depend on

1. `cumulocity-ui`: 238 `.cy.ts` files — 38 component, 200 e2e, of which 46 are
   documentation-screenshots. The working corpus is **154**.
2. 1133 `cy.intercept` call sites; 63 of 154 specs stub; 810 alias waits vs 131 numeric
   sleeps; 88 `cy.request`; `createDevice` 60, `createMockedDevice` 49,
   `mockMOsPerCurrentPage` 29.
3. `cumulocity-cypress@1.1.5` command surface: `getAuth`, `login`, `oauthLogin`,
   `useAuth`, `createUser`, `deleteUser`, `createGlobalRole`, `deleteGlobalRoles`,
   `assignUserRoles`, `clearUserRoles`, `getCurrentTenant`, `getTenantId`,
   `getShellVersion`, `getSystemVersion`, `c8yclient`, `retryRequest`, `setLanguage`,
   `toDate`, `toISODate`, `compareDates`, `visitAndWaitToFinishLoading`.
4. `configureC8yPlugin` registers node tasks under the `c8y:*` / `c8ypact:*` namespaces,
   including `c8ypact:save` — the public precedent for a spec writing structured
   artifacts to node.
5. v1 used Playwright with a bespoke 144-line auth session; its six browser tools split
   3/3 between surface and reachability.
6. `c8y-ai-agents` has 11 specs, 5 of them contract specs under `cypress/e2e/contracts/`,
   and essentially no data-setup library beyond `mockFeatureAsEnabled` and
   `getAuth().login()`.
