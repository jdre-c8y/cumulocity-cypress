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
