# Heal granularity: what is the unit of recovery?

Type: grilling
Status: open
Blocked by: 10

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
