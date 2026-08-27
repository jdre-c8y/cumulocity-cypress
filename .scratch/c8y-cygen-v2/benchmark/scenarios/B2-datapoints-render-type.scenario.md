<!-- Benchmark id: B2 (hazard tier, oracle mode, mocked style)
     Oracle: cumulocity-ui/cypress/e2e/appEnablementTeam/cockpitWidgets.cy.ts:1687
             "Verify that a change in configuration applies to a view"
     cost 11 · 24 assertions · 3 cy.intercept (aliased) · repo fixtures · describe + imported helpers

     THE HAZARD ORACLE. Carries both v1-documented hazard classes, with a reference:
       (1) the assertion selector CHANGES with the render mode
           default/Minimum: verifyTimelineValue('[data-label*="e2eSeries"] .text-truncate')
           after Maximum:    verifyTimelineValue('.text-truncate')
       (2) a count assertion across a state change: have.length 3 -> have.length 1
           (the "expected N, found 1" shape that points nowhere near its cause) -->

# Scenario: Data points table reflects render-type and time-context changes made in its configuration

## Objective

Verify that changes made in a Data Points Table widget's configuration — narrowing the
selected series, switching the widget's time context, and changing a series' render type
— are each reflected in the rendered widget view afterwards.

## Preconditions

- An authenticated session against the target tenant.
- The Cockpit app is reachable, with a home dashboard at `/apps/cockpit/index.html#/`
  that already contains a "Data points table" widget.

## Setup

All data is mocked from repo fixtures; nothing is created in the tenant.

- The home dashboard's inventory objects resolve from a fixture, and the widget is
  configured with two series on the same measurement fragment — e.g.
  `c8y_TemperatureMeasurement → e2eSeries` and `c8y_TemperatureMeasurement → e2eSeries2`,
  both in `°C`.
- The measurement series endpoint resolves from a fixture such that every rendered
  timeline value is the same known value (e.g. `15.34`), so an assertion on the value is
  stable regardless of which aggregate is displayed.
- The device referenced by the widget resolves by id to a known name.
- *(`mocked` style: intercept the dashboard-objects inventory query, the
  `/measurement/measurements/series*` call, and the device-by-ids inventory query,
  serving existing repo fixtures where they exist rather than inventing new ones. Alias
  the dashboard and series intercepts and wait on them after navigation — the widget
  renders before its data arrives otherwise.)*

## Steps

1. Log in.
2. Navigate to the Cockpit home dashboard and wait for the dashboard and series data to
   load.
3. Note the initial state of the widget: which series columns it shows, and the value
   rendered in the first timeline row.
4. Open the widget's configuration. Set its time context to `Widget` (rather than
   inheriting the dashboard's), then return to the series/history section.
5. Uncheck the second series, leaving only the first selected.
6. Change the first series' render type to `Maximum` and save the widget.
7. Note the value rendered in the first timeline row again.
8. Reopen the widget configuration and change the first series' render type to
   `Minimum and maximum`, then save.
9. Note the widget's final rendered state.

## Expected Outcomes

1. Initially the widget shows three column labels — a device column and both series
   labels with their unit — and the first timeline row renders the known value.
2. Initially the widget exposes the dashboard-level auto-refresh control.
3. After saving with render type `Maximum`, the first timeline row still renders the
   known value. *(Note: the element carrying that value is addressed differently once
   the render type changes — a selector that worked in outcome 1 is not guaranteed to
   match here.)*
4. After switching the widget to its own time context, the dashboard-level auto-refresh
   control is no longer present, and a widget-level date/time context picker is.
5. After unchecking the second series, the widget shows exactly **one** series column
   label, and it is the first series' label with its unit.
6. After saving with render type `Minimum and maximum`, the first timeline row renders
   **two** values, both equal to the known value.

## Style

`mocked` — the scenario is about configuration propagating into the view; real
measurement data would make the value assertions unstable.
