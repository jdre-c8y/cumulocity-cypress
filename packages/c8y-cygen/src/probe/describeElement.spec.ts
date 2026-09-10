import {
  ancestorsOf,
  attrsOf,
  classesOf,
  describeElement,
  isActionable,
  ownTextOf,
  repeatOf,
  type ElementLike,
} from "./describeElement.js";

interface FakeSpec {
  tag: string;
  attrs?: Record<string, string>;
  classes?: string[];
  text?: string;
  children?: FakeSpec[];
}

function build(spec: FakeSpec, parent: ElementLike | null = null): ElementLike {
  const classes = spec.classes ?? [];
  const children: ElementLike[] = [];
  const el: ElementLike = {
    tagName: spec.tag.toUpperCase(),
    getAttribute: (n) => spec.attrs?.[n] ?? null,
    classList: { length: classes.length, item: (i) => classes[i] ?? null },
    children: { length: 0, item: (i) => children[i] ?? null },
    parentElement: parent,
    textContent: null,
  };
  for (const child of spec.children ?? []) children.push(build(child, el));
  Object.defineProperty(el.children, "length", { get: () => children.length });
  Object.defineProperty(el, "textContent", {
    get: () =>
      (spec.text ?? "") + children.map((c) => c.textContent ?? "").join(""),
  });
  return el;
}

const painting = { visibility: "visible" } as const;

describe("describeElement", () => {
  it("carries only the ladder's attribute vocabulary", () => {
    const el = build({
      tag: "div",
      attrs: {
        "data-cy": "event-details-custom-data",
        title: "Custom data",
        href: "/events/1",
        c8yicon: "chevron",
        value: "42",
      },
    });

    expect(attrsOf(el)).toEqual({ dataCy: "event-details-custom-data", title: "Custom data" });
  });

  it("drops the volatile framework classes a selector must never rest on", () => {
    const el = build({
      tag: "li",
      classes: ["list-group-item", "ng-star-inserted", "ng-untouched", "active"],
    });

    expect(classesOf(el)).toEqual(["list-group-item"]);
  });

  it("reads the element's own text, not its subtree's", () => {
    // A wrapper carrying the whole panel's text would match every contains and make the
    // ladder's uniqueness measurement meaningless.
    const wrapper = build({
      tag: "div",
      children: [{ tag: "span", text: "lat 52.534925" }, { tag: "span", text: "lng 17.582658" }],
    });

    expect(ownTextOf(wrapper)).toBe("");
    expect(ownTextOf(wrapper.children.item(0) as ElementLike)).toBe("lat 52.534925");
  });

  it("lists ancestors root first, keeping a custom tag's own text and dropping a div's", () => {
    const root = build({
      tag: "c8y-event-details",
      text: "Details",
      children: [{ tag: "div", text: "noise", children: [{ tag: "span", text: "leaf" }] }],
    });
    const div = root.children.item(0) as ElementLike;
    const leaf = div.children.item(0) as ElementLike;

    expect(ancestorsOf(leaf)).toEqual([
      { tag: "c8y-event-details", text: "Details" },
      { tag: "div" },
    ]);
  });

  it("measures a repeating list rather than guessing at one", () => {
    const list = build({
      tag: "ul",
      children: [
        { tag: "li", attrs: { "data-cy": "row" } },
        { tag: "li", attrs: { "data-cy": "row" } },
        { tag: "li", attrs: { "data-cy": "other" } },
      ],
    });

    expect(repeatOf(list.children.item(1) as ElementLike)).toEqual({
      siblingsLike: 2,
      index: 1,
    });
    expect(repeatOf(list.children.item(2) as ElementLike)).toEqual({
      siblingsLike: 1,
      index: 0,
    });
  });

  it("marks what a person can act on, which is the one judgement the summary carries", () => {
    expect(isActionable(build({ tag: "button" }))).toBe(true);
    expect(isActionable(build({ tag: "div", attrs: { role: "tab" } }))).toBe(true);
    expect(isActionable(build({ tag: "div" }))).toBe(false);
  });

  it("produces a row the ladder can search", () => {
    const list = build({
      tag: "c8y-event-details",
      children: [
        { tag: "div", attrs: { "data-cy": "c8y-event-details--type-wrapper" }, text: "c8y_LocationUpdate" },
      ],
    });

    expect(describeElement(list.children.item(0) as ElementLike, "detail#0", painting)).toEqual({
      id: "detail#0",
      ancestors: [{ tag: "c8y-event-details" }],
      tag: "div",
      attrs: { dataCy: "c8y-event-details--type-wrapper" },
      classes: [],
      text: "c8y_LocationUpdate",
      visibility: "visible",
      actionable: false,
      repeat: { siblingsLike: 1, index: 0 },
    });
  });
});
