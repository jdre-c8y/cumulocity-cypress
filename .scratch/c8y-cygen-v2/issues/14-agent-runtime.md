# Agent runtime and cache-breakpoint strategy

Type: research
Status: open
Blocked by: —

## Question

Graduated from fog by [Loop shape](10-loop-shape.md), which changed the question
materially. Under `Q3(b)` an iteration is a **short-lived, stateless session** reading
artifacts from disk, with a large static prefix (house rules read live from the target
repo, domain notes, the conventions index) and a small variable suffix (current IR, facts,
last diagnostic, attempt log).

That shape makes the runtime choice narrower and the cache question sharper.

- **Which runtime executes one iteration?** Anthropic Tool Runner (what v1 used), the
  Agent SDK, or Claude Code subagents. The surviving tool surface is small — `run_cypress`,
  `read_file`, `stage_fixture` — so the deciding factors are how the cache breakpoint is
  controlled, how images (failure screenshots) are attached, and how cleanly a session can
  be started and torn down per iteration.
- **Where does the cache breakpoint sit** given the static/variable split above? v1 moved
  breakpoints across accumulating attempts (`moveMessageCacheBreakpoint`); a stateless loop
  wants a fixed breakpoint at the end of the static prefix instead.
- **Does the TTL question still matter?** Ticket 10 established that prompt caching is
  **prefix-keyed, not session-keyed**, so the expensive preamble caches across separate
  iterations regardless. v1's late 1-hour-TTL fix was never empirically re-validated and
  was already only a reasoned hypothesis; ticket 10's correction may have made it moot.
  Confirm or retire it — do not carry it forward unexamined.
- **What is the actual cost profile** of the resulting call shape: large cached prefix,
  small uncached suffix, a handful of tool calls, one or two images?

Resolvable by a `/research` subagent against current Anthropic documentation plus the v1
implementation on branch `c8y-e2e-generation-agents`. Findings go to a throwaway
`research/agent-runtime` branch.
