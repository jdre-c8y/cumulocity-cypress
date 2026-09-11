import {
  parseConventions,
  resolveForSpecPath,
  ConventionsError,
} from "./loadConventions.js";

const MINIMAL = `
schemaVersion: 1
repo: demo
placement:
  specRoot: cypress/e2e
  suffix: .cy.ts
  directories:
    platformTeam: { specs: 29, tag: '@platformTeam' }
    dataAndControlTeam: { specs: 42, tag: ['@deviceManagementTeam', '@dataAndControlTeam'] }
    documentation-screenshots: { specs: 46, tag: null }
formatter: { run: ['node_modules/.bin/prettier', '--write', '{file}'], configFound: null }
commands:
  available: { source: probe, generated: true, names: [login, createDevice] }
  blessed:
    - { name: login, binding: global, kind: real-state, role: auth }
  idiomatic: { auth: "cy.login()" }
valueBuilders:
  - { id: now, emit: "Cypress._.now()" }
  - { id: uniqueName, emit: "\`{prefix}\${Cypress._.now()}\`" }
idioms:
  beforeEach: ["cy.login()"]
overrides:
  - match: cypress/e2e/contracts/**
    why: a pact key must be byte-stable, so a timestamped name passes once and fails forever after
    valueBuilders: { deny: [uniqueName] }
  - match: cypress/e2e/documentation-screenshots/**
    why: screenshot capture, not assertion
    generate: false
`;

describe("parseConventions", () => {
  it("accepts a well-formed file", () => {
    expect(parseConventions(MINIMAL, "demo.yaml").repo).toBe("demo");
  });

  it("refuses a command list that was grepped rather than probed", () => {
    const grepped = MINIMAL.replace("source: probe", "source: grep");

    expect(() => parseConventions(grepped, "demo.yaml")).toThrow(ConventionsError);
  });

  it("refuses an import-bound helper that says nothing about where to import it from", () => {
    const bad = MINIMAL.replace(
      "{ name: login, binding: global, kind: real-state, role: auth }",
      "{ name: login, binding: import, kind: real-state }"
    );

    expect(() => parseConventions(bad, "demo.yaml")).toThrow(/importFrom/);
  });

  it("refuses an inline-bound helper with no source, because the compiler must emit it", () => {
    const bad = MINIMAL.replace(
      "{ name: login, binding: global, kind: real-state, role: auth }",
      "{ name: login, binding: inline, kind: real-state, definedIn: x.cy.ts }"
    );

    expect(() => parseConventions(bad, "demo.yaml")).toThrow(/source/);
  });

  it("refuses a blessed move that is not in the available list", () => {
    const bad = MINIMAL.replace(
      "names: [login, createDevice]",
      "names: [createDevice]"
    );

    expect(() => parseConventions(bad, "demo.yaml")).toThrow(/login/);
  });

  it("refuses a blessed move the file itself records as a phantom", () => {
    const bad = MINIMAL.replace(
      "names: [login, createDevice]",
      "names: [login, createDevice, postEvent]\n    knownPhantoms: [{ name: postEvent, why: invented by a model }]"
    ).replace(
      "- { name: login, binding: global, kind: real-state, role: auth }",
      "- { name: login, binding: global, kind: real-state, role: auth }\n    - { name: postEvent, binding: global, kind: real-state }"
    );

    expect(() => parseConventions(bad, "demo.yaml")).toThrow(/postEvent/);
  });
});

describe("the directory tag table", () => {
  const withTag = (tag: string): string =>
    MINIMAL.replace("platformTeam: { specs: 29, tag: '@platformTeam' }", `platformTeam: { specs: 29, tag: ${tag} }`);

  it("refuses a tag with no leading @, which would emit a lane nobody greps", () => {
    expect(() => parseConventions(withTag("'platformTeam'"), "demo.yaml")).toThrow();
  });

  it("refuses a tag that is not a string at all", () => {
    // This used to reach the compiler and die there as `value.includes is not a function`,
    // naming neither the file nor the key.
    expect(() => parseConventions(withTag("42"), "demo.yaml")).toThrow();
  });

  it("accepts null, which is a real answer for a directory that tags nothing", () => {
    expect(() => parseConventions(withTag("null"), "demo.yaml")).not.toThrow();
  });
});

describe("resolveForSpecPath", () => {
  const conventions = parseConventions(MINIMAL, "demo.yaml");

  it("leaves an ordinary directory alone", () => {
    const e = resolveForSpecPath(conventions, "cypress/e2e/platformTeam/x.cy.ts");

    expect(e.generate).toBe(true);
    expect(e.effectiveValueBuilders.map((b) => b.id)).toEqual(["now", "uniqueName"]);
    expect(e.appliedOverrides).toEqual([]);
  });

  it("derives the describe tags from the directory, which the scout already mined", () => {
    // Choosing the directory chooses the grep tag. Nothing derives "dataAndControlTeam" from a
    // scenario about events, so the author chose it; the tag follows from that choice and is
    // not a judgement the model should be making.
    expect(
      resolveForSpecPath(conventions, "cypress/e2e/dataAndControlTeam/events.cy.ts").suiteTags
    ).toEqual(["@deviceManagementTeam", "@dataAndControlTeam"]);
  });

  it("accepts a directory that carries a single tag rather than a list", () => {
    expect(
      resolveForSpecPath(conventions, "cypress/e2e/platformTeam/x.cy.ts").suiteTags
    ).toEqual(["@platformTeam"]);
  });

  it("gives no tags for a directory the corpus tags with none", () => {
    expect(
      resolveForSpecPath(conventions, "cypress/e2e/documentation-screenshots/x.cy.ts").suiteTags
    ).toEqual([]);
  });

  it("gives no tags for a directory the scout never saw, rather than inventing one", () => {
    expect(
      resolveForSpecPath(conventions, "cypress/e2e/brandNewTeam/x.cy.ts").suiteTags
    ).toEqual([]);
  });

  it("gives no tags to a spec that sits directly under the spec root", () => {
    // The scout keys directories by the first path segment, which for a root-level spec is the
    // file name - so without this a spec inherits a "directory" tag mined from one unrelated file.
    expect(resolveForSpecPath(conventions, "cypress/e2e/loose.cy.ts").suiteTags).toEqual([]);
  });

  it("survives a trailing slash on specRoot rather than silently dropping every tag", () => {
    const withSlash = parseConventions(
      MINIMAL.replace("specRoot: cypress/e2e", "specRoot: cypress/e2e/"),
      "demo.yaml"
    );

    expect(
      resolveForSpecPath(withSlash, "cypress/e2e/platformTeam/x.cy.ts").suiteTags
    ).toEqual(["@platformTeam"]);
  });

  it("removes a builder a directory denies", () => {
    const e = resolveForSpecPath(conventions, "cypress/e2e/contracts/mcp.cy.ts");

    expect(e.effectiveValueBuilders.map((b) => b.id)).toEqual(["now"]);
    expect(e.deniedValueBuilders).toEqual(["uniqueName"]);
  });

  it("reports a directory that is out of scope for generation", () => {
    const e = resolveForSpecPath(
      conventions,
      "cypress/e2e/documentation-screenshots/x.cy.ts"
    );

    expect(e.generate).toBe(false);
  });

  it("matches an override on the repo-relative path however the caller spelled it", () => {
    const e = resolveForSpecPath(conventions, "./cypress/e2e/contracts/mcp.cy.ts");

    expect(e.deniedValueBuilders).toEqual(["uniqueName"]);
  });
});
