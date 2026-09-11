import { parseScenarioContract, ContractParseError } from "./scenarioContract.js";

const B0 = `<!-- SALVAGED VERBATIM from v1. Oracle: events.cy.ts:75
     ## Not A Heading — this lives inside a comment -->

# Scenario: Device event appears with correct details in the event timeline

> A blockquote note that is not a section.

## Objective

Verify that an event posted for a device shows up with the correct details.

## Preconditions

- An authenticated session against the target tenant (OAI-Secure login).
- The device management app is reachable at \`/apps/devicemanagement/index.html\`.

## Setup

- Ensure a device exists with a known, unique name.
- Ensure exactly one event exists for that device, with known field values:
  - \`type\`: \`c8y_LocationUpdate\`

## Steps

1. Log in.
2. Navigate to the device's events page.

## Expected Outcomes

1. The device's event tab view is visible before interacting with the timeline.
2. The opened event's details show the source/device wrapper containing the device's
   name.
3. The opened event's details show a time value within ±3 minutes of "now" (UTC).

## Notes For The Interview

<!-- Q: which timeline item? A: the first, there is only one. -->
Anything at all may live here.

## Style

\`mocked\` (default target for the MVP proof-of-loop)
`;

describe("parseScenarioContract", () => {
  it("reads the six sections and the scenario title", () => {
    const c = parseScenarioContract(B0, "/repo/cypress/e2e/team/events.scenario.md");

    expect(c.title).toBe(
      "Device event appears with correct details in the event timeline"
    );
    expect(c.objective).toContain("shows up with the correct details");
    expect(c.preconditions).toContain("OAI-Secure login");
    expect(c.setup).toContain("c8y_LocationUpdate");
    expect(c.steps).toContain("Navigate to the device's events page");
    expect(c.contractPath).toBe("/repo/cypress/e2e/team/events.scenario.md");
  });

  it("indexes Expected Outcomes by their written number, joining continuation lines", () => {
    const c = parseScenarioContract(B0, "x.scenario.md");

    expect(c.outcomes.map((o) => o.id)).toEqual([1, 2, 3]);
    expect(c.outcomes[1]?.text).toBe(
      "The opened event's details show the source/device wrapper containing the device's name."
    );
  });

  it("reads Style as a bare token, ignoring the prose that follows it", () => {
    expect(parseScenarioContract(B0, "x.scenario.md").style).toBe("mocked");
  });

  it("keeps unknown sections verbatim instead of failing on them", () => {
    const c = parseScenarioContract(B0, "x.scenario.md");

    expect(c.passthrough.map((s) => s.heading)).toEqual(["Notes For The Interview"]);
    expect(c.passthrough[0]?.body).toContain("which timeline item?");
  });

  it("does not mistake a '##' inside an HTML comment for a section heading", () => {
    const c = parseScenarioContract(B0, "x.scenario.md");

    expect(c.passthrough.map((s) => s.heading)).not.toContain(
      "Not A Heading — this lives inside a comment"
    );
  });

  it("reads the it-level tags the author declared", () => {
    // Measured across 203 spec files: @requiresBackend correlates with neither real-state calls
    // nor integration style (44%, worse than chance). It is a human judgement about the
    // scenario, so it comes from the author's contract and is never derived or guessed.
    const withTags = `${B0}\n\n## Tags\n\n- \`@requiresBackend\`\n- \`@slow\`\n`;

    expect(parseScenarioContract(withTags, "x.scenario.md").tags).toEqual([
      "@requiresBackend",
      "@slow",
    ]);
  });

  it("gives no tags when the author declared none, rather than guessing one", () => {
    expect(parseScenarioContract(B0, "x.scenario.md").tags).toEqual([]);
  });

  it("takes a comma-separated Tags line as well as a list", () => {
    const inline = `${B0}\n\n## Tags\n\n@requiresBackend, @slow\n`;

    expect(parseScenarioContract(inline, "x.scenario.md").tags).toEqual([
      "@requiresBackend",
      "@slow",
    ]);
  });

  it("ignores prose above the list, so a section can explain itself", () => {
    const withProse = `${B0}\n\n## Tags\n\nGrep tags for the emitted it(). Nothing derives them.\n\n- \`@requiresBackend\`\n`;

    expect(parseScenarioContract(withProse, "x.scenario.md").tags).toEqual(["@requiresBackend"]);
  });

  it("refuses to silently drop a tag the author did not bullet", () => {
    // The list-wins rule was meant to let prose explain the section. It also meant a tag typed
    // without a dash vanished, which is the exact silent-wrong-lane failure this section exists
    // to prevent.
    const mixed = `${B0}\n\n## Tags\n\n@requiresBackend\n- \`@slow\`\n`;

    expect(() => parseScenarioContract(mixed, "x.scenario.md")).toThrow(/list item/);
  });

  it("reads a Tags section that holds only an HTML comment as declaring none", () => {
    // The module promises HTML comments pass through untouched. This was the one parser that
    // threw on them, so a contract explaining why it has no tags could not be parsed at all.
    const commented = `${B0}\n\n## Tags\n\n<!-- asked the team: no tag, the default lane -->\n`;

    expect(parseScenarioContract(commented, "x.scenario.md").tags).toEqual([]);
  });

  it("refuses a tag that is not a grep tag, because a typo picks the wrong CI lane", () => {
    const bad = `${B0}\n\n## Tags\n\n- requiresBackend\n`;

    expect(() => parseScenarioContract(bad, "x.scenario.md")).toThrow(/@/);
  });

  it("refuses a contract with no Expected Outcomes, because nothing could be scored", () => {
    const noOutcomes = "# Scenario: x\n\n## Objective\n\ndo a thing\n";

    expect(() => parseScenarioContract(noOutcomes, "x.scenario.md")).toThrow(
      ContractParseError
    );
  });

  it("refuses a Style value outside the two the design knows", () => {
    const odd = B0.replace("`mocked` (default", "`recorded` (default");

    expect(() => parseScenarioContract(odd, "x.scenario.md")).toThrow(/recorded/);
  });

  it("treats a missing Style section as unstated rather than as an error", () => {
    const noStyle = B0.slice(0, B0.indexOf("## Style"));

    expect(parseScenarioContract(noStyle, "x.scenario.md").style).toBeNull();
  });
});
