<!-- Benchmark id: B4 (plugin tier, oracle mode, integration style)
     Oracle: c8y-ai-agents/cypress/e2e/no-llm/provider-management.cy.ts:9
             "should add a global provider and be able to modify it"
     cost 17 · 17 assertions · 0 intercepts · self-contained

     THE SELECTOR-LADDER ORACLE. The plugin's own components carry little [data-cy], so
     this is the only tier that forces the lower rungs of the ladder:
       regex text content   cy.get("button").contains(/Change provider|Add global provider/)
       custom element tag   cy.get("c8yai-provider-modal", { timeout: 60_000 })
       attribute selector   cy.get("c8yai-provider-modal input[name='model']")
       [data-cy]            only on ngx-components ('select--dropdown-menu') and a few
                            plugin elements ('agent--global-provider-name')
     Third hazard variant: a STATE-DEPENDENT LABEL. The same control reads "Add global
     provider" before a provider exists and "Change provider" after. -->

# Scenario: A global AI provider can be added and then changed to a different provider

## Objective

Verify that a global LLM provider can be configured in the AI Agent Manager, that the
saved provider and model are reflected in the plugin's action bar, and that the provider
can then be replaced with a different one whose details replace the first.

## Preconditions

- An authenticated session against the target tenant, as an administrator.
- The `ai-plugins` remote is deployed to the tenant, and the plugin is loaded into the
  Administration app via its remotes query parameter:
  `/apps/administration/?remotes={"ai-plugins":["AiManagerModule","aiChatWidgetProviders"]}`
  (in this repo the value comes from `Cypress.env('remotes')`).
- The cookie banner is suppressed.

## Setup

- The `ui.ai-agent-manager` feature must be enabled. Mock it as enabled rather than
  changing tenant configuration.
- No global provider needs to pre-exist. The scenario is written to tolerate either
  starting state — see Expected Outcome 1.
- No API keys are needed for real LLM calls; this scenario never invokes a model, so
  dummy key values are correct and intended.

## Steps

1. Log in and navigate to the Administration app with the plugin's remote loaded.
2. Open "AI Agent Manager" from the navigator.
3. Open the global-provider dialog. *(The control that opens it is labelled differently
   depending on whether a provider already exists — accommodate both labels.)*
4. In the dialog, select `anthropic` as the provider, set the model to a known value
   (e.g. `claude-haiku-4-5`), enter a dummy API key, and confirm.
5. Read the provider name and model shown in the action bar.
6. Open the global-provider dialog again — at this point a provider exists, so its
   label is the "change" variant.
7. Select `Google Generative AI` as the provider, set the model to a known value
   (e.g. `gemini-2.5-flash-lite`), enter a dummy API key, and confirm.
8. Read the provider name and model shown in the action bar again.

## Expected Outcomes

1. The AI Agent Manager view loads, and a control to add or change the global provider
   is visible.
2. The provider dialog becomes visible after the control is used. *(It can take a long
   time to appear — allow well beyond the default command timeout.)*
3. After confirming the first provider, the dialog closes and is no longer present.
4. The action bar shows the provider name containing `anthropic` and the model containing
   `claude-haiku-4-5`.
5. After confirming the second provider, the dialog closes and is no longer present.
6. The action bar shows the provider name containing `google` and the model containing
   `gemini-2.5-flash-lite` — the first provider's details are gone, not shown alongside.

## Style

`integration` — the provider is genuinely persisted and read back through the plugin's
own action bar; mocking that round-trip would remove the thing under test. API keys are
dummy values, so no external LLM call occurs.

**Teardown note:** this scenario leaves a global provider configured in the tenant. A
generated spec should not depend on the tenant starting clean (Outcome 1 accommodates
either state), but the exploration phase must account for having mutated shared tenant
configuration.
