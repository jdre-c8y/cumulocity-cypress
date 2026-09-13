/**
 * Reduces one observed element to one candidate row.
 *
 * The model is never shown DOM. It is shown a summary of these rows, and the ladder searches
 * the rows themselves - so this is where the ban list is enforced: an attribute with no field
 * here is invisible to the ladder by construction, not by documentation.
 *
 * Written against a structural view of an element rather than the DOM types, so the reduction
 * can be exercised without a browser. The probe passes real elements.
 */
import type { AncestorDescriptor, CandidateRow, RowAttrs, Visibility } from "../facts/types.js";

export interface ElementLike {
  tagName: string;
  getAttribute(name: string): string | null;
  readonly classList: { readonly length: number; item(i: number): string | null };
  readonly children: { readonly length: number; item(i: number): ElementLike | null };
  parentElement: ElementLike | null;
  textContent: string | null;
  /** Present on the elements that hold one - input, textarea, select - and on nothing else. */
  value?: string;
  /** Position in the probe's payload, for the elements that came from one. See `AncestorDescriptor.node`. */
  readonly index?: number;
}

/** Everything the reduction needs to know about how the element is painted. */
export interface Painting {
  visibility: Visibility;
}

/** The ladder's whole attribute vocabulary. Nothing else has anywhere to go. */
const ATTRS: [keyof RowAttrs, string][] = [
  ["dataCy", "data-cy"],
  ["name", "name"],
  ["formControlName", "formcontrolname"],
  ["id", "id"],
  ["role", "role"],
  ["ariaLabel", "aria-label"],
  ["title", "title"],
  ["placeholder", "placeholder"],
  ["type", "type"],
];

/**
 * Exported because the ladder has to know where a text was cut: a cut text is a prefix of the
 * real one, which the plain `contains` idiom tolerates and an anchored one cannot.
 */
export const MAX_TEXT = 80;
const MAX_ANCESTORS = 8;

/**
 * Longer than a name, an id, an email or a URL; shorter than a body of prose. A value past this
 * is dropped whole rather than clipped, because an equality written against a clipped value is
 * a spec that fails for a reason nothing in the facts explains.
 */
export const MAX_VALUE = 120;

/**
 * What the element holds. Never an attribute: for a databound input the attribute is stale.
 *
 * A password is refused here as well as in the browser. The browser half is the layer that can
 * be bypassed - a hand-written payload, a replayed facts file - and a credential reaching a
 * prompt is not the kind of mistake a single guard should be enough for.
 */
export function valueOf(el: ElementLike): string | undefined {
  if (el.getAttribute("type") === "password") return undefined;
  const v = el.value;
  if (typeof v !== "string" || v === "" || v.length > MAX_VALUE) return undefined;
  return v;
}

/**
 * Angular sprays volatile state classes onto everything. A selector built from one is a
 * selector that breaks when the form is touched, so they never reach a row.
 */
const VOLATILE_CLASS = /^(ng-|cdk-|c8y-ng-|mat-ripple|is-active$|active$|open$|show$|collapsed$|focus$|hover$)/;

export function classesOf(el: ElementLike): string[] {
  const out: string[] = [];
  for (let i = 0; i < el.classList.length; i++) {
    const c = el.classList.item(i);
    if (c && !VOLATILE_CLASS.test(c)) out.push(c);
  }
  return out.sort();
}

export function attrsOf(el: ElementLike): RowAttrs {
  const attrs: RowAttrs = {};
  for (const [key, html] of ATTRS) {
    const value = el.getAttribute(html);
    if (value !== null && value !== "") attrs[key] = value;
  }
  return attrs;
}

/**
 * The element's own visible text, normalised and capped. A wrapper carrying the whole panel's
 * text would match every `contains` and make the ladder's uniqueness measurement meaningless.
 *
 * `textContent` here is the element's OWN text, not its subtree's - the browser half reads it
 * off the direct text children, which is the only place it can be read exactly. This used to
 * subtract each child's text from the parent's instead, and that could not work: the browser
 * truncated parent and child independently at 200 characters, so on any large subtree neither
 * string contained the other and the subtraction silently did nothing.
 */
export function ownTextOf(el: ElementLike): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

const isCustomTag = (t: string): boolean =>
  /^c8y/.test(t) || (t.includes("-") && !t.startsWith("ng-"));

const ACTIONABLE_TAGS = new Set(["a", "button", "input", "select", "textarea", "label"]);

export function isActionable(el: ElementLike): boolean {
  const tag = el.tagName.toLowerCase();
  if (ACTIONABLE_TAGS.has(tag)) return true;
  const role = el.getAttribute("role");
  if (role && ["button", "link", "tab", "menuitem", "option", "checkbox"].includes(role)) {
    return true;
  }
  return el.getAttribute("tabindex") !== null;
}

export function ancestorsOf(el: ElementLike): AncestorDescriptor[] {
  const chain: AncestorDescriptor[] = [];
  let current = el.parentElement;
  while (current && chain.length < MAX_ANCESTORS) {
    const tag = current.tagName.toLowerCase();
    const dataCy = current.getAttribute("data-cy");
    const id = current.getAttribute("id");
    const classes = classesOf(current);
    const text = ownTextOf(current);
    const descriptor: AncestorDescriptor = { tag };
    if (current.index !== undefined) descriptor.node = current.index;
    if (dataCy) descriptor.dataCy = dataCy;
    if (id) descriptor.id = id;
    if (classes.length > 0) descriptor.classes = classes;
    // A custom tag's OWN text only. Widening this to its whole subtree would offer scopes no
    // probe verified - an outer tag's textContent is most of the page. The narrow reading costs
    // a longer path or a refusal, never a wrong selector.
    //
    // B2 was named as the thing that would force this question, and it has: Cypress matches
    // `contains` against the element's whole subtree text, so a scope built from own text is an
    // under-count, and an *anchored* scope built from it would match nothing at all. The answer
    // is still the narrow reading here - the ladder anchors a leaf and never a scope (ticket 18
    // Q2), and the scope B2 needs is ticket 17's anchored-scope rung, which reaches the element
    // carrying the text and walks out to the component holding it.
    if (text && isCustomTag(tag)) descriptor.text = text;
    chain.push(descriptor);
    current = current.parentElement;
  }
  // Root first, so a path reads outermost to innermost the way it is written.
  return chain.reverse();
}

/** The element's own leaf descriptor, for measuring a repeating list. */
function leafKey(el: ElementLike): string {
  const attrs = attrsOf(el);
  if (attrs.dataCy) return `[data-cy=${attrs.dataCy}]`;
  const tag = el.tagName.toLowerCase();
  const classes = classesOf(el);
  return classes.length > 0 ? `${tag}.${classes.join(".")}` : tag;
}

/**
 * Many neighbours sharing this element's own leaf descriptor. The only place a position is a
 * legal rung, and the probe measures it rather than anyone guessing it.
 */
export function repeatOf(el: ElementLike): { siblingsLike: number; index: number } {
  const parent = el.parentElement;
  if (!parent) return { siblingsLike: 1, index: 0 };
  const key = leafKey(el);
  let siblingsLike = 0;
  let index = 0;
  for (let i = 0; i < parent.children.length; i++) {
    const sibling = parent.children.item(i);
    if (!sibling || leafKey(sibling) !== key) continue;
    if (sibling === el) index = siblingsLike;
    siblingsLike += 1;
  }
  return { siblingsLike: Math.max(siblingsLike, 1), index };
}

const valuePart = (el: ElementLike): { value?: string } => {
  const value = valueOf(el);
  return value === undefined ? {} : { value };
};

export function describeElement(
  el: ElementLike,
  id: string,
  painting: Painting
): CandidateRow {
  return {
    id,
    ancestors: ancestorsOf(el),
    tag: el.tagName.toLowerCase(),
    attrs: attrsOf(el),
    classes: classesOf(el),
    text: ownTextOf(el),
    ...valuePart(el),
    visibility: painting.visibility,
    actionable: isActionable(el),
    repeat: repeatOf(el),
  };
}
