import { emitCallRepoHelper, emitString, type EmitContext } from "./emit.js";
import { b0Conventions } from "../testing/b0.js";

const ctx = (): EmitContext => ({
  conventions: b0Conventions(),
  runtime: new Set<string>(),
});

/** Valid is the whole bar: the repo's own formatter decides which quote survives. */
function parses(expression: string): boolean {
  try {
    new Function(`return ${expression};`);
    return true;
  } catch {
    return false;
  }
}

describe("emitting a string the page supplied", () => {
  it("prefers single quotes for a plain value, which is what the corpus writes", () => {
    expect(emitString("Location update")).toBe("'Location update'");
  });

  it("keeps a double quote inside single quotes rather than escaping it", () => {
    expect(emitString('[data-cy="c8y-sv"]')).toBe(`'[data-cy="c8y-sv"]'`);
  });

  it("emits a value carrying a newline as something that parses", () => {
    // A two-line label read off the page has no quote and no backslash, so it took the
    // single-quote branch and emitted an unterminated string literal - a spec-level failure
    // with no step location, on a metered run.
    const emitted = emitString("Device offline\nLast seen 3h ago");

    expect(parses(emitted)).toBe(true);
    expect(new Function(`return ${emitted};`)()).toBe("Device offline\nLast seen 3h ago");
  });

  it.each([
    ["a tab", "col\tvalue"],
    ["a carriage return", "one\r\ntwo"],
    ["a NUL", "a\u0000b"],
    ["a backslash", "C:\\Users\\x"],
    ["both quote kinds", `he said "it's here"`],
    ["a dollar-brace that is not a reference", "cost: ${}"],
  ])("emits %s as something that parses, and reads back unchanged", (_label, value) => {
    const emitted = emitString(value);

    expect(parses(emitted)).toBe(true);
    expect(new Function(`return ${emitted};`)()).toBe(value);
  });
});

describe("emitting a blessed move", () => {
  function withShape(shape: string, name = "shapedMove"): EmitContext {
    const conventions = b0Conventions();
    return {
      conventions: {
        ...conventions,
        commands: {
          ...conventions.commands,
          blessed: [
            ...conventions.commands.blessed,
            { name, binding: "global", signature: `${name}()`, callShape: shape } as never,
          ],
        },
      },
      runtime: new Set<string>(),
    };
  }

  it("substitutes the placeholders a call shape declares", () => {
    const emitted = emitCallRepoHelper({ name: "shapedMove", args: ["admin"] }, withShape("cy.getAuth({0}).login()"));

    expect(emitted).toBe("cy.getAuth('admin').login();");
  });

  it("substitutes nothing rather than shipping the placeholder when there are no args", () => {
    // The zero-arg early return emitted the shape verbatim, so `{0}` reached the spec.
    const emitted = emitCallRepoHelper({ name: "shapedMove" }, withShape("cy.getAuth({0}).login()"));

    expect(emitted).toBe("cy.getAuth().login();");
  });

  it("leaves a shape with no placeholders alone", () => {
    expect(emitCallRepoHelper({ name: "shapedMove" }, withShape("cy.disableGainsight()"))).toBe(
      "cy.disableGainsight();"
    );
  });

  it("falls back to cy.<name>(args) when the move declares no shape", () => {
    expect(emitCallRepoHelper({ name: "createDevice", args: ["x"] }, ctx())).toBe(
      "cy.createDevice('x');"
    );
  });
});
