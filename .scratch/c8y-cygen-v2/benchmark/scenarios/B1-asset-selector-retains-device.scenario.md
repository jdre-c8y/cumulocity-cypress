<!-- Benchmark id: B1 (mid tier — intercept-writing, oracle mode, mocked style)
     Oracle: cumulocity-ui/cypress/e2e/appEnablementTeam/widget-asset-selector.cy.ts:69
             "Verify asset properties widget retains correct device selection"
     cost 10 · 10 assertions · 5 cy.intercept · self-contained (no shared helper interactions) -->

# Scenario: Asset Properties widget retains its configured device across repeated config saves

## Objective

Verify that an Asset Properties widget already configured with a specific device keeps
that device selected — and keeps displaying it — after its configuration is opened and
saved without any changes, twice in a row.

## Preconditions

- An authenticated session against the target tenant.
- The Cockpit app is reachable at `/apps/cockpit/index.html`.

## Setup

All state for this scenario is mocked; nothing is created in the tenant.

- A device group exists with a known id and name (e.g. id `12345`, name `e2eWidgetGroup`),
  carrying `c8y_IsDeviceGroup` and `type: 'c8y_DeviceGroup'`.
- A device exists with a known id and name (e.g. id `2000`, name `e2eDevice`), carrying
  `c8y_IsDevice` and a `c8y_ActiveAlarmsStatus` of one critical alarm.
- The group has a dashboard (e.g. id `98765`) whose `c8y_Dashboard` already contains a
  single child widget of `componentId: 'Asset Properties'`, whose `config.device` is
  `{ name: <device name>, id: <device id> }`.
- The group's child-assets listing returns exactly that one device.
- *(`mocked` style: serve all of the above via `cy.intercept` — the group by id, the
  dashboard via the inventory `$filter=` query that Cockpit issues when resolving
  dashboards for a group, the device by id both with and without `withChildren=true`,
  and the group's `childAssets` listing. The exact `$filter=` query string and the
  response envelope shape — `managedObjects`, `references`, `statistics` — must be
  discovered from real traffic during exploration, not guessed; a near-miss on the
  filter string means the intercept never fires and the page loads empty.)*

## Steps

1. Log in.
2. Navigate to the group's dashboard:
   `/apps/cockpit/index.html#/group/{groupId}/dashboard/{dashboardId}`.
3. Enter widget-edit mode, open the widget's settings, and open its edit form.
4. Inspect which device the asset selector currently shows.
5. Save the widget configuration without changing anything, then save the dashboard.
6. Repeat steps 3 and 5 once more — open the configuration and save again, still with no
   changes.

## Expected Outcomes

1. The dashboard page shows the group's name in its title.
2. On first opening the widget configuration, the asset selector shows the configured
   device's name, and does **not** show the group's name.
3. After the first save, the widget's displayed name field still holds exactly the
   configured device's name.
4. After the second open-and-save cycle, the widget's displayed name field still holds
   exactly the configured device's name.

## Style

`mocked` — the whole scenario is about client-side config round-tripping; no tenant
mutation is required or wanted.
