/**
 * B0 as fixtures, from one source.
 *
 * The probe payloads are the source; the facts document and the row ids the IR names are derived
 * from them by the same code the real run uses. Hand-writing the facts separately would let the
 * fixture drift from what a probe actually produces, which is the one thing a fixture must not do.
 */
import fs from "node:fs";
import { packagePath } from "../support/assets.js";
import { parseConventions, resolveForSpecPath } from "../conventions/loadConventions.js";
import { parseScenarioContract } from "../contract/scenarioContract.js";
import { rowsFromRawNodes, type RawNode } from "../probe/rawNodes.js";
import type { EffectiveConventions } from "../conventions/types.js";
import type { ScenarioContract } from "../contract/scenarioContract.js";
import type { FactsDocument } from "../facts/types.js";
import type { IrDocument } from "../ir/types.js";
import type { ProbePayload } from "../probe/readFacts.js";

export const B0_CONTRACT_PATH = "cypress/e2e/dataAndControlTeam/events.scenario.md";
export const B0_SPEC_PATH = "cypress/e2e/dataAndControlTeam/events.cy.ts";
export const B0_DEVICE_NAME = "e2eDeviceToTestEvents1757404800000";

export function b0Conventions(): EffectiveConventions {
  const file = packagePath("conventions", "cumulocity-ui.conventions.yaml");
  return resolveForSpecPath(
    parseConventions(fs.readFileSync(file, "utf8"), file),
    B0_SPEC_PATH
  );
}

export function b0Contract(): ScenarioContract {
  const file = packagePath("scenarios", "B0-events-details.scenario.md");
  return parseScenarioContract(fs.readFileSync(file, "utf8"), B0_CONTRACT_PATH);
}

function node(
  i: number,
  parent: number,
  tag: string,
  over: Partial<RawNode> = {}
): RawNode {
  return {
    i,
    parent,
    tag,
    attrs: {},
    classes: [],
    text: "",
    visibility: "visible",
    ...over,
  };
}

const EVENTS_PAGE_NODES: RawNode[] = [
  node(0, -1, "c8y-device-events"),
  node(1, 0, "c8y-tabs-outlet"),
  node(2, 0, "ul"),
  node(3, 2, "li", {
    attrs: { "data-cy": "c8y-events-list--timeline-item" },
    text: "Location update",
  }),
];

const EVENT_DETAIL_NODES: RawNode[] = [
  node(0, -1, "c8y-event-details"),
  node(1, 0, "div", {
    attrs: { "data-cy": "c8y-event-details--source-wrapper" },
    text: B0_DEVICE_NAME,
  }),
  node(2, 0, "div", {
    attrs: { "data-cy": "c8y-event-details--time-wrapper" },
    text: "2026-09-09T09:00:00Z",
  }),
  node(3, 0, "div", {
    attrs: { "data-cy": "c8y-event-details--type-wrapper" },
    text: "c8y_LocationUpdate",
  }),
  node(4, 0, "div", {
    attrs: { "data-cy": "c8y-event-details--creation-time-wrapper" },
    text: "2026-09-09T09:00:00Z",
  }),
  node(5, 0, "ul"),
  node(6, 5, "li", {
    attrs: { "data-cy": "event-details-custom-data-item" },
    text: "c8y_Position",
  }),
  node(7, 0, "div", {
    attrs: { "data-cy": "event-details-custom-data" },
    text: "lat 52.534925 lng 17.582658",
  }),
];

/**
 * What one probe run writes: two collect points and one provisional match, on one linear flow.
 * That is why B0 needs one probe run and not two.
 */
export function b0ProbePayloads(): ProbePayload[] {
  return [
    {
      kind: "collect",
      label: "events-page",
      within: "c8y-device-events",
      observedAt: "2026-09-09T09:00:00.000Z",
      nodes: EVENTS_PAGE_NODES,
    },
    {
      kind: "provisional",
      stepId: "open-first-event",
      label: "open-first-event",
      within: "c8y-device-events",
      observedAt: "2026-09-09T09:00:01.000Z",
      matchCount: 1,
      matchedIndex: 3,
      nodes: EVENTS_PAGE_NODES,
    },
    {
      kind: "collect",
      label: "event-detail",
      within: "c8y-event-details",
      observedAt: "2026-09-09T09:00:02.000Z",
      nodes: EVENT_DETAIL_NODES,
    },
  ];
}

export function b0Facts(): FactsDocument {
  const surfaces = b0ProbePayloads().map((p) => ({
    label: p.label,
    within: p.within ?? null,
    cacheKey: `${p.label}@1`,
    observedAt: p.observedAt,
    rows: rowsFromRawNodes(p.label, p.nodes),
  }));
  const provisional = b0ProbePayloads().filter((p) => p.kind === "provisional");
  return {
    version: 1,
    runId: "fixture",
    tenantUrl: "https://tenant.example.c8y.io",
    appVersion: "1020.0.0",
    complete: true,
    requests: [],
    surfaces,
    provisionalMatches: provisional.map((p) => ({
      stepId: p.stepId ?? p.label,
      matchCount: p.matchCount ?? 0,
      surfaceLabel: p.label,
      row:
        rowsFromRawNodes(p.label, p.nodes).find(
          (r) => r.id === `${p.label}#${p.matchedIndex}`
        ) ?? null,
    })),
  };
}

/** The spec-mode IR for B0, with all seven Expected Outcomes covered. */
export function b0Ir(): IrDocument {
  return {
    version: 1,
    meta: {
      contract: B0_CONTRACT_PATH,
      suite: "Tests for device events",
      title: "Verify the event for a device shows respective event details",
      style: "integration",
    },
    vars: {
      deviceName: { builder: "uniqueName", args: { prefix: "e2eDeviceToTestEvents" } },
    },
    steps: [
      {
        id: "make-device",
        callRepoHelper: {
          name: "createDevice",
          args: [{ object: { name: { ref: "deviceName" } } }],
        },
        undo: { idFrom: "deviceId" },
      },
      {
        id: "get-device-id",
        captures: "deviceId",
        callRepoHelper: { name: "getDeviceIdByName", args: [{ ref: "deviceName" }] },
      },
      {
        id: "post-event",
        request: {
          method: "POST",
          url: "/event/events",
          body: {
            object: {
              source: { object: { id: { ref: "deviceId" } } },
              type: "c8y_LocationUpdate",
              text: "Location update",
              c8y_Position: { object: { lat: 52.534925, lng: 17.582658 } },
              time: { builder: "isoTime" },
            },
          },
        },
      },
      {
        id: "open-events",
        visit: { path: "/apps/devicemanagement/index.html#/device/${deviceId}/events" },
      },
      {
        id: "tabs-visible",
        settle: {
          target: { resolved: "cy.get('c8y-tabs-outlet')", fromRow: "events-page#1" },
          state: "visible",
        },
      },
      {
        id: "open-first-event",
        click: {
          target: {
            resolved: "cy.get('[data-cy=\"c8y-events-list--timeline-item\"]')",
            fromRow: "events-page#3",
          },
        },
      },
      {
        id: "check-source",
        assert: {
          target: {
            resolved: "cy.get('[data-cy=\"c8y-event-details--source-wrapper\"]')",
            fromRow: "event-detail#1",
          },
          extract: "text",
          compare: "includes",
          operand: { ref: "deviceName" },
        },
      },
      {
        id: "check-time",
        assert: {
          target: {
            resolved: "cy.get('[data-cy=\"c8y-event-details--time-wrapper\"]')",
            fromRow: "event-detail#2",
          },
          extract: "text",
          compare: "withinMinutesOfNow",
          operand: 3,
        },
      },
      {
        id: "check-type",
        assert: {
          target: {
            resolved: "cy.get('[data-cy=\"c8y-event-details--type-wrapper\"]')",
            fromRow: "event-detail#3",
          },
          extract: "text",
          compare: "includes",
          operand: "c8y_LocationUpdate",
        },
      },
      {
        id: "check-creation-time",
        assert: {
          target: {
            resolved: "cy.get('[data-cy=\"c8y-event-details--creation-time-wrapper\"]')",
            fromRow: "event-detail#4",
          },
          extract: "text",
          compare: "withinMinutesOfNow",
          operand: 3,
        },
      },
      {
        id: "check-custom-data-items",
        settle: {
          target: {
            resolved: "cy.get('[data-cy=\"event-details-custom-data-item\"]')",
            fromRow: "event-detail#6",
          },
          state: "exists",
          cardinality: { atLeast: 1 },
        },
      },
      {
        id: "check-latitude",
        assert: {
          target: {
            resolved: "cy.get('[data-cy=\"event-details-custom-data\"]')",
            fromRow: "event-detail#7",
          },
          extract: "text",
          compare: "includes",
          operand: "52.534925",
        },
      },
      {
        id: "check-longitude",
        assert: {
          target: {
            resolved: "cy.get('[data-cy=\"event-details-custom-data\"]')",
            fromRow: "event-detail#7",
          },
          extract: "text",
          compare: "includes",
          operand: "17.582658",
        },
      },
    ],
    outcomes: [
      { id: 1, text: "event tab view visible before interacting", satisfiedBy: ["tabs-visible"] },
      { id: 2, text: "details show the source wrapper with the device name", satisfiedBy: ["check-source"] },
      { id: 3, text: "details show a time within 3 minutes of now", satisfiedBy: ["check-time"] },
      { id: 4, text: "details show the type c8y_LocationUpdate", satisfiedBy: ["check-type"] },
      { id: 5, text: "details show a creation time within 3 minutes of now", satisfiedBy: ["check-creation-time"] },
      { id: 6, text: "details show at least one custom-data item", satisfiedBy: ["check-custom-data-items"] },
      { id: 7, text: "custom-data text includes the posted latitude and longitude", satisfiedBy: ["check-latitude", "check-longitude"] },
    ],
  };
}

/** B0 as the model would author it on iteration 1: the route is known, no selector is. */
export function b0ProbeIr(): IrDocument {
  const ir = b0Ir();
  return {
    ...ir,
    steps: [
      ir.steps[0] as never,
      ir.steps[1] as never,
      ir.steps[2] as never,
      ir.steps[3] as never,
      { id: "collect-page", collect: { label: "events-page", within: "c8y-device-events" } },
      {
        id: "open-first-event",
        click: {
          target: { provisional: { within: "c8y-device-events", tag: "li", nth: 0 } },
        },
      },
      { id: "collect-detail", collect: { label: "event-detail", within: "c8y-event-details" } },
    ],
    outcomes: ir.outcomes.map((o) => ({ ...o, satisfiedBy: ["collect-detail"] })),
  };
}
