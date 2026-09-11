import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyRegistry,
  draftConventionsYaml,
  mineConventions,
  mineReachIndex,
  normaliseRoute,
  registryProbeSpec,
} from "./scout.js";
import { parseConventions } from "./loadConventions.js";

const HOST_SPEC = `
describe('Tests for device events', { tags: ['@deviceManagementTeam', '@dataAndControlTeam'] }, () => {
  beforeEach(() => {
    cy.login(Cypress.env('username'), Cypress.env('password'));
  });

  it('shows an event', () => {
    const name = \`e2eDevice\${Cypress._.now()}\`;
    cy.createDevice({ name });
    cy.request('/event/events', 'POST', { time: dayjs().format('YYYY-MM-DDTHH:mm:ssZ') });
    cy.visitAndWaitUntilPageLoad('apps/devicemanagement/index.html#/events', false);
    cy.visitAndWaitUntilPageLoad('/apps/devicemanagement/index.html#/events', false);
  });
});
`;

const PLUGIN_SPEC = `
describe('providers', () => {
  it('adds one', () => {
    const path = \`/apps/administration/?remotes=\${Cypress.env('remotes')}\`;
    cy.getAuth('admin').login();
    cy.visitAndWaitForSelector(path);
    cy.c8yclient(c => c.inventory.list());
    cy.c8yclientf(c => c.inventory.delete(1));
  });
});
`;

function repoWith(files: Record<string, string>): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cygen-scout-"));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(repo, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return repo;
}

describe("the deterministic miner", () => {
  it("counts specs and tags per directory, because the tag follows the directory", () => {
    const repo = repoWith({
      "cypress/e2e/dataAndControlTeam/events.cy.ts": HOST_SPEC,
      "cypress/e2e/platformTeam/settings.cy.ts": "describe('x', () => {});",
    });

    const mined = mineConventions(repo);

    expect(mined.specFiles).toBe(2);
    expect(mined.placement.directories["dataAndControlTeam"]).toEqual({
      specs: 1,
      tag: "['@deviceManagementTeam', '@dataAndControlTeam']",
    });
    expect(mined.placement.directories["platformTeam"]?.tag).toBeNull();
  });

  it("reads the API-setup idiom off what the repo writes, not off a rule", () => {
    // Which of cy.request and cy.c8yclient a repo uses is a conventions fact. The safety
    // property is anchoring, and it applies to both.
    const host = mineConventions(repoWith({ "cypress/e2e/a/x.cy.ts": HOST_SPEC }));
    const plugin = mineConventions(repoWith({ "cypress/e2e/a/x.cy.ts": PLUGIN_SPEC }));

    expect(host.apiSetup.prefer).toBe("request");
    expect(plugin.apiSetup.prefer).toBe("c8yclient");
  });

  it("seeds the value-builder candidates from measured use", () => {
    const mined = mineConventions(repoWith({ "cypress/e2e/a/x.cy.ts": HOST_SPEC }));

    expect(mined.valueBuilderCandidates["Cypress._.now()"]).toBe(1);
    expect(mined.valueBuilderCandidates["dayjs("]).toBe(1);
    expect(mined.valueBuilderCandidates["Cypress.env("]).toBe(2);
  });

  it("lists every command the specs call, which the registry probe then has to account for", () => {
    const mined = mineConventions(repoWith({ "cypress/e2e/a/x.cy.ts": HOST_SPEC }));

    expect(mined.calledCommands).toContain("createDevice");
    expect(mined.calledCommands).toContain("visitAndWaitUntilPageLoad");
  });

  it("finds the repo's own formatter config, and treats none as a real answer", () => {
    const withConfig = mineConventions(
      repoWith({ "cypress/e2e/a/x.cy.ts": HOST_SPEC, ".prettierrc.yaml": "singleQuote: true\n" })
    );
    const without = mineConventions(repoWith({ "cypress/e2e/a/x.cy.ts": HOST_SPEC }));

    expect(withConfig.formatter.configFound).toBe(".prettierrc.yaml");
    expect(without.formatter.configFound).toBeNull();
  });
});

describe("the reachability index", () => {
  it("merges a route whose only difference is a leading slash", () => {
    // That inconsistency alone merged the host repo's top route from 67 hits to 148.
    expect(normaliseRoute("apps/devicemanagement/index.html#/events")).toBe(
      normaliseRoute("/apps/devicemanagement/index.html#/events")
    );
  });

  it("keys navigations by route and records which specs prove them", () => {
    const repo = repoWith({ "cypress/e2e/a/events.cy.ts": HOST_SPEC });

    const index = mineReachIndex(repo);

    expect(index.routes[0]?.uses).toBe(2);
    expect(index.routes[0]?.specs).toEqual(["cypress/e2e/a/events.cy.ts"]);
    expect(index.generated).toBe(true);
  });

  it("counts the navigations a literal scan cannot resolve", () => {
    // In the plugin repo every navigation is a bound variable, so a literal scan finds nothing.
    // That is a measured input to the assumption that provisional selectors are well seeded.
    const index = mineReachIndex(repoWith({ "cypress/e2e/a/x.cy.ts": PLUGIN_SPEC }));

    expect(index.routes).toHaveLength(0);
    expect(index.unresolvedNavigations).toBe(1);
  });
});

describe("the registry probe", () => {
  it("reads what is callable on cy, not a registry internal", () => {
    // Cypress 15 removed both Cypress.Commands._commands and Cypress.Commands.getAll(), and a
    // probe built on either returned zero commands while reporting success.
    const spec = registryProbeSpec("/tmp/commands.json");

    expect(spec).toContain("Object.keys(cy)");
    expect(spec).toContain("typeof cy[key] === 'function'");
    expect(spec).not.toContain("_commands");
    expect(spec).toContain('cy.writeFile("/tmp/commands.json"');
  });

  it("asserts nothing, because its only product is the command list", () => {
    expect(registryProbeSpec("/tmp/x.json")).not.toContain(".should(");
  });
});

describe("classifyRegistry", () => {
  const withSupport = {
    cypressVersion: "15.8.1",
    supportFileLoaded: true,
    count: 4,
    names: ["get", "click", "createDevice", "verifyDownload"],
  };
  const stock = {
    cypressVersion: "15.8.1",
    supportFileLoaded: false,
    count: 2,
    names: ["get", "click"],
  };

  it("keeps everything callable, because that is what the linter checks a helper against", () => {
    expect(classifyRegistry(withSupport, stock).commands.map((c) => c.name)).toEqual([
      "get",
      "click",
      "createDevice",
      "verifyDownload",
    ]);
  });

  it("separates what this repo registers, by diffing against a stock cy", () => {
    // The difference between the two runs is exactly the repo surface - including a command
    // registered by a third party side effect, which no grep can place.
    expect(classifyRegistry(withSupport, stock).registered).toEqual([
      "createDevice",
      "verifyDownload",
    ]);
  });

  it("claims nothing about provenance without the stock baseline", () => {
    expect(classifyRegistry(withSupport).registered).toEqual([]);
    expect(classifyRegistry(withSupport).commands).toHaveLength(4);
  });
});

describe("the draft conventions file", () => {
  it("leaves the safety boundary empty for a human to fill in", () => {
    const mined = mineConventions(repoWith({ "cypress/e2e/a/x.cy.ts": HOST_SPEC }));

    const draft = draftConventionsYaml(mined, {
      cypressVersion: "14.5.4",
      count: 2,
      commands: [{ name: "createDevice" }, { name: "login" }],
    });

    expect(draft).toContain("blessed: []  # <- a human fills this in");
    expect(draft).toContain("      - createDevice");
    expect(draft).toContain("source: probe");
  });

  it("says plainly when the registry probe has not been run", () => {
    const mined = mineConventions(repoWith({ "cypress/e2e/a/x.cy.ts": HOST_SPEC }));

    expect(draftConventionsYaml(mined, null)).toContain("RUN THE REGISTRY PROBE");
  });

  it("produces something the loader can parse, so a draft is reviewable as a file", () => {
    const mined = mineConventions(repoWith({ "cypress/e2e/a/x.cy.ts": HOST_SPEC }));
    const draft = draftConventionsYaml(mined, {
      cypressVersion: "14.5.4",
      count: 1,
      commands: [{ name: "createDevice" }],
    });

    expect(parseConventions(draft, "draft.yaml").repo).toBe(mined.repo);
  });
});
