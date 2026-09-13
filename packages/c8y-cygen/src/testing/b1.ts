/**
 * B1 as fixtures: the mid tier, and the first oracle that mocks anything.
 *
 * B0 proves the loop. B1 proves the intercept vocabulary, and it is built the same way - the
 * probe payloads are the source and the facts document is derived from them by the code a real
 * run uses, so the fixture cannot drift from what a probe actually produces.
 *
 * The network exchanges are the new half. They are shaped on what Cockpit really asks for when
 * it resolves a group's dashboards, including the `$filter=` expression that must be matched to
 * the character, because a fixture that smooths that over would prove nothing.
 */
import fs from "node:fs";
import { packagePath } from "../support/assets.js";
import { parseConventions, resolveForSpecPath } from "../conventions/loadConventions.js";
import { parseScenarioContract } from "../contract/scenarioContract.js";
import { rowsFromRawNodes, type RawNode } from "../probe/rawNodes.js";
import { splitUrl } from "../probe/readFacts.js";
import type { EffectiveConventions } from "../conventions/types.js";
import type { ScenarioContract } from "../contract/scenarioContract.js";
import type { FactsDocument, ObservedRequest } from "../facts/types.js";
import type { IrDocument } from "../ir/types.js";

export const B1_CONTRACT_PATH =
  "cypress/e2e/appEnablementTeam/widget-asset-selector.scenario.md";
export const B1_SPEC_PATH = "cypress/e2e/appEnablementTeam/widget-asset-selector.cy.ts";

/** The names the contract itself uses. Every mutation below has to trace to one of these. */
export const B1_GROUP_NAME = "e2eWidgetGroup";
export const B1_DEVICE_NAME = "e2eDevice";
export const B1_GROUP_ID = "12345";
export const B1_DASHBOARD_ID = "98765";
export const B1_DEVICE_ID = "2000";

/** The query Cockpit really issues to find a group's dashboards. Nobody guesses this. */
export const B1_DASHBOARD_FILTER =
  `$filter=((has('c8y_Dashboard!group!${B1_GROUP_ID}')) or (has('c8y_Dashboard!type!c8y_DeviceGroup')) or ((c8y_Dashboard.deviceType eq true) and (c8y_Dashboard.deviceTypeValue eq 'c8y_DeviceGroup')))`;

export function b1Conventions(): EffectiveConventions {
  const file = packagePath("conventions", "cumulocity-ui.conventions.yaml");
  return resolveForSpecPath(parseConventions(fs.readFileSync(file, "utf8"), file), B1_SPEC_PATH);
}

export function b1Contract(): ScenarioContract {
  const file = packagePath("scenarios", "B1-asset-selector-retains-device.scenario.md");
  return parseScenarioContract(fs.readFileSync(file, "utf8"), B1_CONTRACT_PATH);
}

function node(i: number, parent: number, tag: string, over: Partial<RawNode> = {}): RawNode {
  return { i, parent, tag, attrs: {}, classes: [], text: "", visibility: "visible", ...over };
}

/** The dashboard as it renders before anything is opened. */
const DASHBOARD_NODES: RawNode[] = [
  node(0, -1, "c8y-dashboard"),
  node(1, 0, "div", {
    attrs: { "data-cy": "c8y-title--title-outlet" },
    text: B1_GROUP_NAME,
  }),
  node(2, 0, "button", { attrs: { "data-cy": "c8y-widget-dashboard--edit-widgets" } }),
  node(3, 0, "button", { attrs: { "data-cy": "c8y-dashboard-child--settings" } }),
];

/** The widget configuration form, open. */
const CONFIG_NODES: RawNode[] = [
  node(0, -1, "c8y-widget-config"),
  node(1, 0, "button", { attrs: { "data-cy": "widgets-dashboard--Edit-widget" } }),
  node(2, 0, "div", { attrs: { "data-cy": "Asset selection" } }),
  node(3, 2, "span", { classes: ["chip"], text: B1_DEVICE_NAME }),
  // The device's name lives here and nowhere else on this surface - as the input's value, not
  // as anyone's text. Until the probe reported a value, an `extract: "value"` assertion against
  // this row was an assertion no fact could justify, and the linter now says so.
  node(4, 0, "input", { attrs: { title: "Name" }, value: B1_DEVICE_NAME }),
  node(5, 0, "button", { attrs: { "data-cy": "widget-config--save-widget" } }),
  node(6, 0, "button", { attrs: { "data-cy": "c8y-widgets-dashboard--save" } }),
];

/** What the watcher records while Cockpit boots the group's dashboard. */
function exchanges(): ObservedRequest[] {
  const origin = "https://t.example.c8y.io";
  const raw = [
    {
      url: `${origin}/inventory/managedObjects?query=${encodeURIComponent(B1_DASHBOARD_FILTER)}&pageSize=1000`,
      body: {
        managedObjects: [
          {
            id: B1_DASHBOARD_ID,
            name: "realDashboard",
            c8y_Dashboard: {
              children: {
                "3413512173": {
                  componentId: "Asset Properties",
                  id: "3413512173",
                  title: "Asset Properties",
                  config: { device: { name: "realDevice", id: "9999" } },
                },
              },
              columns: 24,
            },
          },
        ],
        statistics: { pageSize: 1000, currentPage: 1 },
      },
    },
    {
      url: `${origin}/inventory/managedObjects/${B1_GROUP_ID}`,
      body: { id: B1_GROUP_ID, name: "realGroup", type: "c8y_DeviceGroup", c8y_IsDeviceGroup: {} },
    },
    {
      url: `${origin}/inventory/managedObjects/${B1_DEVICE_ID}`,
      body: { id: B1_DEVICE_ID, name: "realDevice", c8y_IsDevice: {} },
    },
    {
      url: `${origin}/inventory/managedObjects/${B1_GROUP_ID}/childAssets?pageSize=5`,
      body: {
        references: [{ managedObject: { id: B1_DEVICE_ID, name: "realDevice" } }],
        statistics: { pageSize: 5, currentPage: 1 },
      },
    },
  ];
  return raw.map((r, i) => {
    const { pathname, query } = splitUrl(r.url);
    return {
      id: `dashboard.network#${i}`,
      method: "GET",
      url: r.url,
      pathname,
      ...(query ? { query } : {}),
      status: 200,
      body: r.body,
    };
  });
}

export function b1Facts(): FactsDocument {
  return {
    version: 1,
    runId: "fixture",
    tenantUrl: "https://t.example.c8y.io",
    appVersion: "1020.0.0",
    complete: true,
    requests: exchanges(),
    provisionalMatches: [],
    surfaces: [
      {
        label: "dashboard",
        within: "c8y-dashboard",
        observedAt: "2026-09-09T09:00:00.000Z",
        rows: rowsFromRawNodes("dashboard", DASHBOARD_NODES),
      },
      {
        label: "config",
        within: "c8y-widget-config",
        observedAt: "2026-09-09T09:00:05.000Z",
        rows: rowsFromRawNodes("config", CONFIG_NODES),
      },
    ],
  };
}

/**
 * The spec-mode IR for B1, with all four Expected Outcomes covered.
 *
 * Worth reading for what it does NOT contain: no response body, no selector, and no `$filter=`
 * string the model typed. Every one of those comes out of the facts document.
 */
export function b1Ir(): IrDocument {
  const openConfig = (n: number) => [
    {
      id: `edit-widgets-${n}`,
      click: {
        target: {
          resolved: "cy.get('[data-cy=\"c8y-widget-dashboard--edit-widgets\"]')",
          fromRow: "dashboard#2",
        },
      },
    },
    {
      id: `settings-${n}`,
      click: {
        target: {
          resolved: "cy.get('[data-cy=\"c8y-dashboard-child--settings\"]')",
          fromRow: "dashboard#3",
        },
      },
    },
    {
      id: `edit-widget-${n}`,
      click: {
        target: {
          resolved: "cy.get('[data-cy=\"widgets-dashboard--Edit-widget\"]')",
          fromRow: "config#1",
        },
      },
    },
  ];
  const save = (n: number) => [
    {
      id: `save-widget-${n}`,
      click: {
        target: {
          resolved: "cy.get('[data-cy=\"widget-config--save-widget\"]')",
          fromRow: "config#5",
        },
      },
    },
    {
      id: `save-dashboard-${n}`,
      click: {
        target: {
          resolved: "cy.get('[data-cy=\"c8y-widgets-dashboard--save\"]')",
          fromRow: "config#6",
        },
      },
    },
  ];
  const nameFieldHolds = (id: string) => ({
    id,
    assert: {
      target: { resolved: "cy.get('[title=\"Name\"]')", fromRow: "config#4" },
      extract: "value" as const,
      compare: "equals" as const,
      operand: { ref: "deviceName" },
    },
  });

  return {
    version: 1,
    meta: {
      contract: B1_CONTRACT_PATH,
      suite: "Asset Properties Widget - Device Selection",
      title: "Verify asset properties widget retains correct device selection",
      style: "mocked",
    },
    vars: {
      groupName: B1_GROUP_NAME,
      deviceName: B1_DEVICE_NAME,
      deviceId: B1_DEVICE_ID,
    },
    steps: [
      {
        id: "serve-dashboard",
        stub: {
          route: {
            pathname: "/inventory/managedObjects",
            query: { query: B1_DASHBOARD_FILTER, pageSize: "1000" },
          },
          fromRequest: "dashboard.network#0",
          mutations: [
            {
              path: "managedObjects.0.c8y_Dashboard.children.3413512173.config.device.name",
              value: { ref: "deviceName" },
            },
            // The id as well as the name. Mutating only the name left the widget configured
            // with the observed tenant's device 9999 while the only device stubbed was 2000,
            // so the widget would resolve its device against the real tenant and 404. Nothing
            // catches this: each literal is anchored to the contract, and no rule asks whether
            // the set of stubs is consistent with itself.
            {
              path: "managedObjects.0.c8y_Dashboard.children.3413512173.config.device.id",
              value: { ref: "deviceId" },
            },
          ],
        },
      },
      {
        id: "serve-group",
        stub: {
          route: { method: "GET", url: `/inventory/managedObjects/${B1_GROUP_ID}*` },
          fromRequest: "dashboard.network#1",
          mutations: [{ path: "name", value: { ref: "groupName" } }],
        },
      },
      {
        id: "serve-device",
        stub: {
          // Globbed, like every sibling stub. The contract's Setup asks for the device "by id
          // both with and without `withChildren=true`", and Cypress matches a string URL
          // exactly unless it carries glob characters - so the bare path missed the variant the
          // contract explicitly names, and that request fell through to the tenant.
          route: { method: "GET", url: `/inventory/managedObjects/${B1_DEVICE_ID}*` },
          fromRequest: "dashboard.network#2",
          mutations: [{ path: "name", value: { ref: "deviceName" } }],
        },
      },
      {
        id: "serve-children",
        stub: {
          route: { method: "GET", url: `/inventory/managedObjects/${B1_GROUP_ID}/childAssets?**` },
          fromRequest: "dashboard.network#3",
          mutations: [{ path: "references.0.managedObject.name", value: { ref: "deviceName" } }],
        },
      },
      {
        id: "open-dashboard",
        visit: {
          path: `/apps/cockpit/index.html#/group/${B1_GROUP_ID}/dashboard/${B1_DASHBOARD_ID}`,
        },
      },
      {
        id: "title-shows-group",
        assert: {
          target: {
            resolved: "cy.get('[data-cy=\"c8y-title--title-outlet\"]')",
            fromRow: "dashboard#1",
          },
          extract: "text",
          compare: "includes",
          operand: { ref: "groupName" },
        },
      },
      ...openConfig(1),
      {
        id: "chip-shows-device",
        assert: {
          // What the ladder derives, not what a person would write. The chip carries no
          // data-cy - which is why the hand-written oracle reaches it with
          // `.parent().find('.chip, .tag')` - so the ladder identifies it by its own text.
          target: { resolved: "cy.contains('span', 'e2eDevice')", fromRow: "config#3" },
          extract: "text",
          compare: "includes",
          operand: { ref: "deviceName" },
        },
      },
      {
        id: "chip-hides-group",
        assert: {
          target: { resolved: "cy.contains('span', 'e2eDevice')", fromRow: "config#3" },
          extract: "text",
          compare: "includes",
          negate: true,
          operand: { ref: "groupName" },
        },
      },
      ...save(1),
      nameFieldHolds("name-after-first-save"),
      ...openConfig(2),
      ...save(2),
      nameFieldHolds("name-after-second-save"),
    ] as IrDocument["steps"],
    outcomes: [
      {
        id: 1,
        text: "The dashboard page shows the group's name in its title.",
        satisfiedBy: ["title-shows-group"],
      },
      {
        id: 2,
        text: "the asset selector shows the device and not the group",
        satisfiedBy: ["chip-shows-device", "chip-hides-group"],
      },
      {
        id: 3,
        text: "after the first save the name field still holds the device name",
        satisfiedBy: ["name-after-first-save"],
      },
      {
        id: 4,
        text: "after the second save the name field still holds the device name",
        satisfiedBy: ["name-after-second-save"],
      },
    ],
  };
}

/**
 * B1 as the model would author it on iteration 1: the route is known, nothing else is.
 *
 * No stub, because the linter refuses one in a probe IR and should - a probe that serves its own
 * fiction records it. The probe walks the real application, the collect points flush the network
 * traffic that walk produced, and only the turn after that can write an intercept.
 */
export function b1ProbeIr(): IrDocument {
  const ir = b1Ir();
  return {
    ...ir,
    steps: [
      {
        id: "open-dashboard",
        visit: {
          path: `/apps/cockpit/index.html#/group/${B1_GROUP_ID}/dashboard/${B1_DASHBOARD_ID}`,
        },
      },
      { id: "collect-dashboard", collect: { label: "dashboard", within: "c8y-dashboard" } },
      {
        id: "edit-widgets",
        click: { target: { provisional: { tag: "button", text: "Edit widgets" } } },
      },
      { id: "collect-config", collect: { label: "config", within: "c8y-widget-config" } },
    ],
    outcomes: ir.outcomes.map((o) => ({ ...o, satisfiedBy: ["collect-config"] })),
  };
}
