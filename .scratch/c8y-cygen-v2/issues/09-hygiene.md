# Hygiene: output location, abandoned attempts, and tenant-data teardown

Type: grilling
Status: open
Blocked by: —

## Question

Short ticket, real decisions. These are only bugs if a second person uses the tool — and
the audience is team adoption, so they are adoption blockers on the route, not polish.

Three v1 gaps, each observed:

1. **No canonical output location and no cleanup of abandoned attempts.** Repeated runs
   against one scenario left **three separate spec files with the same test title** in
   the target app repo, one of them a literal `it('debug', ...)` leftover probe. Decide:
   where does a generated spec land (derived from the conventions file of ticket 06?),
   what happens on a re-run against the same scenario — overwrite, version, refuse? —
   and how are failed attempts cleaned up rather than abandoned in place?
2. **Orphaned tenant data from the exploration phase.** The generated spec's own
   setup/teardown discipline was solid; the *exploration* phase's real, tenant-touching
   actions had no equivalent, leaving stray groups and dashboards behind. Decide the
   teardown contract for exploration. Note the asymmetry: exploration is exploratory, so
   it cannot always know in advance what it will create — does it need a transaction log
   of created entities, a tagging convention, or a scoped throwaway area?
3. **Debug/probe artifacts.** The `it('debug')` leftover was not a generation-logic bug
   but a lifecycle gap. Should probe activity be structurally incapable of reaching the
   target repo — e.g. written only to a scratch area until it passes the guardrail?

Also settle: does a generation run touch the target repo's git state at all (branch,
commit, leave dirty), or only write files and let the human handle version control?
