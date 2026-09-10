import {
  parseFailureLocation,
  parseRunResult,
  truncateMiddle,
} from "./cypressDriver.js";

const SPEC = "/repo/cypress/e2e/dataAndControlTeam/events.cy.ts";

const TIMING = { startedAt: "2026-09-09T10:00:00.000Z", durationMs: 42_000 };

const STACK = [
  "AssertionError: Timed out retrying after 10000ms: Expected to find element:",
  "`[data-cy=\"c8y-event-details--source-wrapper\"]`, but never found it.",
  "    at Context.eval (webpack://cumulocity-ui/./cypress/e2e/dataAndControlTeam/events.cy.ts:31:8)",
  "    at Context.<anonymous> (webpack://cumulocity-ui/./cypress/support/commands.ts:297:12)",
].join("\n");

describe("truncateMiddle", () => {
  it("leaves a short message alone", () => {
    expect(truncateMiddle("short", 100)).toBe("short");
  });

  it("keeps the head and the tail and elides the middle", () => {
    const text = `HEAD${"x".repeat(5000)}TAIL`;

    const out = truncateMiddle(text, 200);

    expect(out.startsWith("HEAD")).toBe(true);
    expect(out.endsWith("TAIL")).toBe(true);
    expect(out).toContain("characters elided");
    expect(out.length).toBeLessThan(300);
  });

  it("still truncates when the cap is smaller than the elision notice", () => {
    // slice(-0) is slice(0), which would have returned the whole string and quietly undone the
    // truncation.
    const out = truncateMiddle("x".repeat(500), 20);

    expect(out.length).toBeLessThan(500);
    expect(out).toContain("characters elided");
  });

  it("keeps the stack frames a head-first cut would have deleted", () => {
    // The frames sit at the end of the string, and the largest failures are exactly the ones
    // that most need the source-map key. Cutting head-first deletes it precisely then.
    const noise = "Expected values to match:\n" + "diff line\n".repeat(1000);
    const text = `${noise}${STACK}`;

    expect(truncateMiddle(text, 1500)).toContain("events.cy.ts:31:8");
  });
});

describe("parseFailureLocation", () => {
  it("takes the topmost frame whose file is the emitted spec", () => {
    expect(parseFailureLocation(STACK, SPEC)).toEqual({
      file: "webpack://cumulocity-ui/./cypress/e2e/dataAndControlTeam/events.cy.ts",
      line: 31,
      column: 8,
    });
  });

  it("skips a frame inside a blessed helper and still names the calling step", () => {
    const insideHelper = [
      "CypressError: cy.request() failed",
      "    at Context.<anonymous> (webpack://cumulocity-ui/./cypress/support/commands.ts:297:12)",
      "    at Context.eval (webpack://cumulocity-ui/./cypress/e2e/dataAndControlTeam/events.cy.ts:14:6)",
    ].join("\n");

    expect(parseFailureLocation(insideHelper, SPEC)?.line).toBe(14);
  });

  it("returns nothing rather than guessing when no frame names the spec", () => {
    const foreign = "Error: boom\n    at Object.x (node_modules/whatever/index.js:1:1)";

    expect(parseFailureLocation(foreign, SPEC)).toBeUndefined();
  });
});

describe("parseRunResult", () => {
  it("reports a pass", () => {
    const raw = { totalFailed: 0, runs: [{ spec: { relative: "x.cy.ts" }, tests: [] }] };

    expect(parseRunResult(raw, SPEC, TIMING).pass).toBe(true);
  });

  it("parses the location before it truncates", () => {
    const noise = "diff line\n".repeat(1000);
    const raw = {
      totalFailed: 1,
      runs: [
        {
          spec: { relative: "events.cy.ts" },
          screenshots: [
            { path: "/runs/r1/screenshots/Tests for device events -- Verify (failed).png" },
          ],
          tests: [
            {
              title: ["Tests for device events", "Verify"],
              state: "failed",
              displayError: `${noise}${STACK}`,
            },
          ],
        },
      ],
    };

    const result = parseRunResult(raw, SPEC, TIMING, 800);
    const failure = result.testFailures[0];

    expect(result.pass).toBe(false);
    expect(failure?.location?.line).toBe(31);
    expect(failure?.errorMessage.length).toBeLessThan(900);
    expect(failure?.screenshotPath).toContain("(failed).png");
  });

  it("reports a spec that would not compile as a spec failure, not a test failure", () => {
    const raw = {
      totalFailed: 0,
      runs: [{ spec: { relative: "events.cy.ts" }, error: "Webpack Compilation Error" }],
    };

    const result = parseRunResult(raw, SPEC, TIMING);

    expect(result.pass).toBe(false);
    expect(result.specFailures[0]?.errorMessage).toContain("Webpack");
  });

  it("reports a run Cypress refused to start at all", () => {
    const raw = { status: "failed", message: "Could not find a Cypress configuration file" };

    const result = parseRunResult(raw, SPEC, TIMING);

    expect(result.pass).toBe(false);
    expect(result.specFailures[0]?.errorMessage).toContain("configuration file");
  });

  it("records the wall clock, because the TTL decision needs a clock and there was none", () => {
    const raw = { totalFailed: 0, runs: [] };

    expect(parseRunResult(raw, SPEC, TIMING).durationMs).toBe(42_000);
  });
});
