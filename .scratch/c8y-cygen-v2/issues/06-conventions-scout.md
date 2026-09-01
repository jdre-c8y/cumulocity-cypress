# Conventions scout: what it captures, and its output format

Type: prototype
Status: open
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
