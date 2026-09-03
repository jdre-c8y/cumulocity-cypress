# Conventions scout: what it captures, and its output format

Type: prototype
Status: resolved
Blocked by: 03

## Question

Settled during charting: a one-time automated scout pass per target repo *writes* a
conventions file, a human reviews and commits it, and every later run reads that static
file. Never re-derive conventions live per run — that was v1's unpredictable-cost trap.

What remains is the content and the shape. Conventions genuinely diverge between the two
known targets, so this is not hypothetical:

|                  | `cumulocity-ui`                          | `c8y-ai-agents`                                        |
|------------------|------------------------------------------|--------------------------------------------------------|
| Auth             | `cy.login(user, pass, ...)` + `cy.session()` | `cy.getAuth("admin").login()`, `cy.disableCookieBanner()` |
| Layout           | `cypress/e2e/<team>Team/`                | `cypress/e2e/{llm,no-llm,contracts}/`                  |
| Feature flags    | —                                        | `cy.mockFeatureAsEnabled("ui.ai-agent-manager")`       |
| Plugin loading   | n/a                                      | `/apps/administration/?remotes=${Cypress.env("remotes")}` |
| Extras           | visual snapshots under `cypress/snapshots/` | `cypress-visual-regression`, `retries: { runMode: 2 }`, pact fixtures |

Resolve:

1. **What must the file capture** to make a generated spec indistinguishable from a
   hand-written one in that repo? Candidates: auth/login idiom, spec file location and
   naming, import style, precondition idioms, fixture conventions, selector habits,
   custom commands and helpers available, viewport/timeout defaults, teardown idiom.
2. **What format?** It is read by an agent every run and reviewed by humans
   occasionally — those pull in different directions. Committed markdown, or structured
   (YAML/JSON) with a schema like `c8yscrn`'s?
3. **Where does it live** — in the target repo (travels with the conventions it
   describes, but requires write access to someone else's repo) or in `c8y-cygen`
   (self-contained, but goes stale invisibly)?
4. **How is staleness detected?** A conventions file that silently drifts from a repo
   that has moved on produces alien specs and erodes trust fast.
5. Does the scout output feed the *prompt*, or a deterministic code path, or both?

Prototype by hand-writing the file for **both** repos. Two concrete instances will
expose what the format actually needs far faster than designing the schema first.

## Context from resolved tickets

[Emission target](03-emission-target.md) chose (c) — an IR compiled to house-style
TypeScript — which makes this ticket's output **load-bearing rather than advisory.** The
compiler reads a per-repo style profile; if that profile is wrong, the generated spec is
wrong, not merely unidiomatic.

The prototype (branch `prototype/03-emission-target`) contains a working two-repo profile
at `c-hybrid/styles.json` covering navigation idiom, quote preference, indent, whether
`describe` carries tags, and helper import path. Two findings for this ticket's capture set:

- **A quote *preference* is not enough.** A profile naming `"` as preferred made the
  compiler emit `cy.get("[data-cy="…"]")`, which does not parse. The profile must feed a
  real string emitter, so what it captures is a *default*, not a rule.
- **Auth and setup idioms belong in the profile, not the IR.** B4's
  `cy.disableCookieBanner()` and `cy.getAuth("admin").login()` are repo facts;
  `cy.mockFeatureAsEnabled("ui.ai-agent-manager")` is scenario-specific. That line has to
  be drawn explicitly, and this ticket is where.

---

## Scope grown by ticket 02 (ground truth)

The scout no longer captures style alone. It produces **one reviewable artifact per repo**
carrying three payloads, because all three have identical economics — mined once, reviewed
by a human, read statically by every later run, and stale in exactly the same way:

1. **Style profile** (original scope; load-bearing under ticket 03's compiler).
2. **Reachability index** — extracted lexically by route and component tag from the repo's
   existing specs: the proven navigation sequences, the wait idioms, which request each
   step waits on. `cumulocity-ui`'s 154-spec corpus makes this rich; `c8y-ai-agents`'
   11 specs make it thin, and the generator must behave the same either way. Read as
   **priors, always verified live** — never copied unverified. Embeddings were considered
   and rejected: against 154 files the route string is a near-perfect key.
3. **Blessed setup vocabulary** — the closed, per-repo list of moves that count as setup.
   This is the load-bearing one, because ticket 02 made it the primary cost lever in the
   design: a precondition with no blessed move can only be established by clicking through
   the UI.

Facts ticket 02 hands this ticket for payload 3:

- The published library already supplies pairs — `createUser`/`deleteUser`,
  `createGlobalRole`/`deleteGlobalRoles`, `assignUserRoles`/`clearUserRoles` — plus
  `getAuth`/`login`/`oauthLogin`/`useAuth`, `getCurrentTenant`, `getTenantId`,
  `setLanguage`, `visitAndWaitToFinishLoading`. The create/delete pairing *is* the
  "reset only what you created" rule already encoded; the scout's output format should
  preserve the pairing, not flatten it to a list.
- `cumulocity-ui` adds repo-local moves: `createDevice` (60 uses), `createMockedDevice`
  (49), `mockMOsPerCurrentPage` (29), `createTenant`, `getDeviceIdByName`.
  `c8y-ai-agents` adds essentially only `mockFeatureAsEnabled`.
- **`cy.c8yclient` and `cy.retryRequest` must never be blessed** — arbitrary
  authenticated REST with no paired teardown. Detecting and excluding them is a scout
  requirement, not an afterthought.
- Some blessed moves fabricate in ways the agent may not re-derive: `createMockedDevice`
  synthesises `self: 'https://someTenant.stage.c8y.io/…'`, a hostname no real tenant
  returns. The artifact must therefore mark each move as *real-state* or *fabricating*,
  since ticket 02's rule 3 permits fabrication only via a blessed helper or by recorded
  mutation of an observed response.

Open for this ticket: whether the three payloads are one file or three, and whether the
scout is one pass or three. Ticket 02 only fixes that they share an artifact, a review,
and a lifetime.

---

## Defect found by ticket 12

The style profile as prototyped emits `helperImport` for **every** `callRepoHelper` name.
That is wrong for `cumulocity-ui`: `createDevice`, `getDeviceIdByName`, `createMockedDevice`
and friends are **globally-registered Cypress commands** (`Cypress.Commands.add` in
`cypress/support/commands.ts`), not module exports — they need no import at all. Only some
helpers are importable (e.g. `cypress/support/helpers/*`).

So the profile must distinguish, per helper, between **globally registered** and
**module-imported**, and the scout has to detect which. Left unfixed in ticket 12's
prototype deliberately, so it lands here rather than being quietly patched.

---

## Added by ticket 15 (runtime values)

**Three hard requirements, not suggestions.** [Runtime values](15-runtime-values-in-ir.md) made
the conventions file load-bearing for correctness, not just for house style. Each of these is
something the linter must be able to check without a tenant.

1. **Enumerate the repo's real Cypress commands.** Prototype 12's B0 called
   `callRepoHelper: postEvent`. That command exists nowhere in either repo — the real oracle
   uses `cy.request('/event/events','POST', …)`. The IR linted clean and would have failed only
   at run time. The linter must check every `callRepoHelper` name against this list, so the list
   must be complete and machine-readable.

2. **Carry the value-builder vocabulary.** The IR holds no raw TypeScript, so every runtime value
   comes from a closed vocabulary. The scout pass mines the repo's specs for the expressions they
   actually use and writes the list; a human reviews and commits it. Seeding matters — in
   `cumulocity-ui` alone, `dayjs(` appears 327 times, `Cypress._.now` 178, and
   `Cypress._.clone`/`cloneDeep` 203. A minimal starting list would fire assist constantly, which
   is the adoption failure [Scenario authoring](08-scenario-authoring-assist.md) warns about.

3. **Declare the repo's API-setup idiom.** `cumulocity-ui` uses `cy.request` 95 times and
   `cy.c8yclient` zero. `c8y-ai-agents` uses `cy.request` 15 times and `cy.c8yclient` **37**.
   Ticket 15 overturned ticket 02's blanket ban on `c8yclient` on exactly this evidence: which
   one a repo uses is a conventions fact, and emitting the wrong one fails ticket 01's house-style
   grade in the one repo that prefers it.

Also still open here, carried from ticket 12: the style profile emits `helperImport` for
`createDevice` and `getDeviceIdByName`, which are globally-registered Cypress commands needing no
import. Requirement 1 above would have caught this too.

---

## Answer

Prototype: branch `prototype/06-conventions-scout` (`f439eb6`). Two hand-written profiles, a
deterministic miner, the enumeration probe (shape only, never run), the helper linter, a
reachability-index miner, and the regression corpus ticket 03 made mandatory. Corpus 7/7,
schema 7/7 rejection cases, both profiles valid.

### Two artifacts, not one

Ticket 02 put three payloads in one artifact because all three are "mined once, reviewed by a
human, read statically, and stale in exactly the same way". The last clause is false, and the
difference is what splits the file:

| payload | stale means | noticed by |
| --- | --- | --- |
| style + blessed vocabulary | a foreign spec; a linter that approves a deleted helper | nobody, until run time |
| reachability index | a bad prior, one provisional misses | the next probe run |

The first two are correctness and fail silently. The third is a **performance hint verified
live by construction**. They also differ in size (10 lines vs 192 routes), in review standard
(line-by-line vs not at all), and in key (helper name vs route). So: a reviewed
**`conventions.yaml`**, and a generated **reach index** that is a cache. One scout pass, two
outputs.

### The five questions

1. **Captures** — placement, formatter invocation, three command sets, the API-setup idiom, a
   seeded value-builder vocabulary, call-shape idioms, and for a plugin the host path and
   `remotes` value. **Not** quote style or indent.
2. **Format** — YAML with a JSON Schema, matching the IR's existing `flow.schema.json`.
   Comments carry the *why* beside each blessed move, which is what makes review possible.
3. **Where** — the target repo. The generated spec lands there anyway, so a human with write
   access is in the loop by construction; and the file can be updated by the same PR that
   adds a command, with that repo's CI re-running the miner.
4. **Staleness** — no machinery of its own. The miner is deterministic and cheap, so staleness
   is *re-run and diff the mined half*. The library half is a version-string compare.
5. **Prompt or code path** — both, split by payload. Style → compiler only, never shown to the
   model. Blessed vocabulary, builders, API idiom → the model's static preamble, prefix-cached
   per ticket 10. Reachability → looked up by route, never dumped.

### `available` != `blessed` != `idiomatic`

The prototyped profile had one set of helpers. Three are needed, and they have three
consumers. In `cumulocity-ui` the whole `cumulocity-cypress` administration surface —
`createUser`, `deleteUser`, `createGlobalRole`, `assignUserRoles`, `getAuth`, `c8yclient` and
eight more — is registered and has **zero call sites across 190 specs**. Ticket 02 blessed
those create/delete pairs because the pairing encodes the reset rule. It does, and nobody in
that repo has ever written one; emitting it is correct and visibly foreign, which fails ticket
01's house-style axis.

The split also gives the linter two verdicts instead of one. *Not real* is a bug in the IR.
*Real but unblessed* is ticket 13's first trip condition. Collapsing them would send a human
to approve a hallucination.

### The list is probed, not grepped (and this corrects a claim made mid-ticket)

Multi-line-aware lexical extraction is complete for `cumulocity-cypress`'s own source — 34/34,
zero computed, against 16/34 for a single-line regex. It is **not** complete for a target repo.
Six commands `cumulocity-ui`'s specs call cannot be placed by any grep, including
`cy.verifyDownload` (14 uses), which arrives through
`require('cy-verify-downloads').addCustomCommand()` with no `Cypress.Commands.add` in the repo
at all. An incomplete list turns lint failures into run-time failures — the `postEvent` hole,
reopened from the other side.

A throwaway spec that dumps the registry after the support file loads is exact by
construction, the same inversion ticket 12 made for selectors. It also resolves the three
double-registrations (`login`, `acceptCookieBanner`, `getTenantId` — repo over library, with
**incompatible** signatures, so a merged list emits the wrong arity). Cost: the scout needs a
tenant, which a grep would not. Worth it, because this list is what makes ticket 15's check
sound. **`postEvent` now fails at lint time with no tenant and no probe run.**

### Style is mostly not ours to record

Ticket 12 found that a quote *preference* produced `cy.get("[data-cy="…"]")`, which does not
parse, and concluded the profile must feed a real string emitter because what it holds is "a
default, not a rule". Prettier already implements that rule. One canonical input through each
repo's own prettier produced each repo's real house quoting — including flipping the quote
when the content would need escaping — with **zero profile fields**.

The prototype recorded `"` for `c8y-ai-agents` as a preference. It is not one: that repo has
`.prettierrc` files under `packages/*`, none covering `cypress/`, and `lint-staged` runs
`eslint` only. Nothing formats the directory, so it sat at prettier's defaults.
`formatter.configFound: null` is a real value. What the profile records is *which formatter to
run and from where*, not what it should decide.

### The defect ticket 12 left here, resolved — and it was ternary

`binding` is `global` | `import` | `inline`. `cumulocity-ui`'s `createDevice` and
`getDeviceIdByName` are globally registered and need no import, which was ticket 12's defect.
The third case is `c8y-ai-agents`: helpers defined inside a `describe` body and never exported
— `deleteDevice`, `removeAgent`, `resetProvider` — callable neither through `cy.` nor by
import. `createDevice`/`deleteDevice` are duplicated verbatim across two spec files, which is
what `inline` costs. The compiler must emit the source.

### Overrides are load-bearing, not polish

Per repo, with directory-glob overrides. `c8y-ai-agents/cypress/e2e/contracts/` uses **fixed
literal names where every other directory uses a timestamp**, because a pact key must be
byte-stable. A profile offering `valueBuilders` per *repo* hands the model `uniqueName` there
and produces a spec that **passes its first run and fails every one after** — worse than
failing outright. Hence `overrides[].valueBuilders.deny`.

### `kind:` is proposed by the scout, approved by a human

The Q1 carve-out, implemented: fabricating iff the body writes a response inside an intercept;
real-state iff it issues a request whose result is consumed; follow the call graph one hop.
15/15 agree with the hand-classification. Two corrections were needed on the way, and the
remaining miss is the important one: `createTenant` creates real tenant state by **driving the
product** — visit, type, click Save, no API call — so every lexical signal is silent and the
naive answer is `neither`. That is wrong in the dangerous direction, because `neither` pairs
no teardown. It is escalated as `real-state?  NEEDS HUMAN REVIEW`. Ticket 02's setup/SUT
boundary is exactly what a lexical rule cannot see.

### Found by trying: the reachability index seeds nothing in the plugin repo

Ticket 02 settled that "against 154 files the route string is a near-perfect key". Measured:

| | `cumulocity-ui` | `c8y-ai-agents` |
| --- | --- | --- |
| navigations from a literal | 965 | **0** |
| from a bound variable | 4 | **34** |
| distinct routes | 192 | **2** |

The key works in the host repo, after normalising a leading-slash inconsistency that alone
merges the top route from 67 to 148. In the plugin repo a literal scan finds **nothing** —
every navigation is `` const path = `/apps/administration/?remotes=${…}` `` — and even
resolved there are **2 routes for 11 specs**. This is a measured input to the map's `≤3 probe
runs` assumption, which rests on provisional selectors being well seeded.

### Corrections to closed tickets

- **Ticket 02.** `cy.visitAndWaitToFinishLoading` is in its blessed list and exists nowhere.
  Its source is a stale `@example` in `cumulocity-cypress@1.1.5`'s own
  `lib/commands/general.d.ts`, on the declaration of the command that replaced it. Second
  phantom after `postEvent`, and unlike `postEvent` it was **read, not invented** — so the
  scout must extract from registration sites only, never JSDoc or `.d.ts`.
- **Ticket 15.** Its `cy.c8yclient` = 37 is two commands added together: `cy.c8yclient(` 22
  plus `cy.c8yclientf(` 15. The conclusion survives, but all 15 `c8yclientf` calls are
  *teardown*, uniformly `{ ignorePact: true, failOnStatusCode: false }`.
- **This ticket, mid-session.** I claimed multi-line lexical extraction was sound. It is sound
  for the library's own source and not for a target repo. See above.

### Raised elsewhere

- **Ticket 09.** Only 27 of 190 `cumulocity-ui` spec files have any `afterEach`; 7 create real
  devices with no `DELETE` at all. In `c8y-ai-agents` CI provisions a fresh tenant per suite,
  so residual state dies with the tenant. Ticket 02's "reset only what you created" is
  stricter than either repo's practice.
- **Ticket 05.** `contracts/` is a different genre *inside one repo*: 0 `cy.visit`, 0 `cy.get`,
  a one-line `beforeEach`, assertions on `response.status`.
- **Ticket 15.** `const currentTime = Cypress._.now()` is bound once and reused across names
  — 54 bindings, one shape alone 36 times. A builder result that is captured, not re-called.
