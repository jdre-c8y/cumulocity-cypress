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
