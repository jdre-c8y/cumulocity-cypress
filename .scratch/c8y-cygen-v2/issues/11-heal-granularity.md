# Heal granularity: what is the unit of recovery?

Type: grilling
Status: open
Blocked by: — (10 resolved)

## Question

Graduated from fog once [Emission target](03-emission-target.md) settled. That decision
established the patch surface — **recovery operates on IR field paths, not on
TypeScript** — which turns a vague question ("re-derive or patch?") into a sharp one
about units.

The prototype demonstrated the mechanics concretely: under a real B2 failure, the fix was
`steps[7].useFragment.with.selector`, a single addressable field, applicable without a
model writing code and re-validatable by schema plus linter before any tenant round-trip.

Resolve:

1. **What is the unit?** Options: re-emit the whole IR from the facts; patch one step;
   re-run one fragment; re-gather ground truth for one selector and patch. These are not
   exclusive — the answer may be a ladder that escalates.
2. **How is escalation bounded?** v1 re-ran whole self-heal attempts and silently
   exhausted its budget three times. What stops a patch loop from cycling — a per-step
   attempt cap, a distinct-diagnostic requirement, a total budget?
3. **What does the patcher receive?** The prototype's finding is that a text diagnostic
   alone was mostly guessing in v1; the *why* was only ever visible in the Cypress
   screenshot. So: diagnostic text, screenshot, the IR step, and what else — the
   harvested facts for that selector? the DOM at failure?
4. **When does it stop and ask a human?** The assist path is a supported outcome. What
   condition triggers it — attempts exhausted, the same diagnostic twice, a diagnostic
   class known to be unfixable without eyes?
5. **Does a patch invalidate validation state?** After patching one field, does the whole
   IR re-validate, or just the touched step? Cheap either way, but the answer affects
   whether the guardrail is re-checked on every patch.

**Hard dependency, carried from ticket 03:** all of this requires a **source map from
emitted assertions back to IR steps**. Cypress reports failures against compiled output,
so without that map a diagnostic cannot name a field path and this ticket's entire premise
collapses back to string-matching. Treat the source map as a given requirement, not an
option — but this ticket should state what it must contain.

---

## Constraints from ticket 10 (loop shape)

Ticket 10 settled *when* recovery happens; this ticket owns *what it inspects and changes*.

- **`Q9(c)`: patch directly on the first failure, re-probe on the second.** So this ticket
  does not decide whether to re-probe — it decides what a re-probe looks at (the failing
  step only, the whole flow, or the state at the point of failure) and what the patch is
  allowed to touch.
- **The diagnostic's content is this ticket's to specify.** v1's `CypressRunResult` carried
  `{ title[], errorMessage, screenshotPath? }` with `MAX_ERROR_MESSAGE_CHARS = 3000` and
  `MAX_SCREENSHOTS_PER_RETRY = 2`. Ticket 03's source map adds the field v1 lacked —
  **which IR step failed**. Whether that is enough, and what else a failure must carry, is
  the core question here.
- **Sessions are stateless (`Q3(b)`) and read an append-only attempt log (`Q7(b)`).** A
  patch is therefore authored by a session that never saw the reasoning that produced the
  bug — only what the log records about it. What the log must capture per attempt for a
  patch to be well-founded is partly this ticket's problem and partly ticket 13's.
- **Budget is ≤6 Cypress runs total, ≤3 of them probes.** Healing shares that budget with
  acquisition; a heal strategy that needs more than about two attempts does not fit.
- **The linter is the stop condition (`Q8(b)`)**, so a patch that breaks the
  observed-selector invariant fails locally and costs no run. Recovery can therefore be
  attempted freely as long as it lints — the metered resource is the run, not the attempt.
