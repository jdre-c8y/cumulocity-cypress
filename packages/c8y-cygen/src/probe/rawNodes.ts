/**
 * What crosses the browser/node boundary, and what happens on the far side of it.
 *
 * The browser half of the probe is deliberately dumb: it reads attributes and reports a flat
 * list of nodes with parent indices. Every reduction that matters - which attributes the ladder
 * may see, what counts as this element's own text, whether these are a repeating list - happens
 * here, in node, in code that is exercised without a browser.
 *
 * One implementation, one set of tests. A second copy of the reduction living in a browser
 * bundle would drift, and it would drift silently.
 */
import { describeElement, type ElementLike } from "./describeElement.js";
import type { CandidateRow, Visibility } from "../facts/types.js";

/** One observed element, as the browser reports it. */
export interface RawNode {
  /** Index in the array. Parents always precede their children. */
  i: number;
  /** Index of the parent within the collected subtree; -1 for the collect root. */
  parent: number;
  tag: string;
  /** Only the ladder's vocabulary is read in the browser; anything else never leaves it. */
  attrs: Record<string, string>;
  classes: string[];
  /** Raw textContent, truncated. Own text is worked out here, where it can be tested. */
  text: string;
  visibility: Visibility;
}

class RawElement implements ElementLike {
  readonly childList: RawElement[] = [];
  parentElement: RawElement | null = null;

  constructor(private readonly node: RawNode) {}

  get tagName(): string {
    return this.node.tag.toUpperCase();
  }

  getAttribute(name: string): string | null {
    return this.node.attrs[name] ?? null;
  }

  get classList(): { length: number; item(i: number): string | null } {
    const classes = this.node.classes;
    return { length: classes.length, item: (i: number) => classes[i] ?? null };
  }

  get children(): { length: number; item(i: number): ElementLike | null } {
    const kids = this.childList;
    return { length: kids.length, item: (i: number) => kids[i] ?? null };
  }

  get textContent(): string {
    return this.node.text;
  }

  get index(): number {
    return this.node.i;
  }
}

function reconstruct(nodes: RawNode[]): RawElement[] {
  const elements = nodes.map((n) => new RawElement(n));
  nodes.forEach((n, i) => {
    const parent = n.parent >= 0 ? elements[n.parent] : undefined;
    const self = elements[i] as RawElement;
    if (parent) {
      self.parentElement = parent;
      parent.childList.push(self);
    }
  });
  return elements;
}

/**
 * Turns one collected subtree into candidate rows.
 *
 * The collect root itself is not a row: it is the `within` the model already named, so nothing
 * would be learned by offering it as a target.
 */
export function rowsFromRawNodes(label: string, nodes: RawNode[]): CandidateRow[] {
  const elements = reconstruct(nodes);
  const rows: CandidateRow[] = [];
  for (const el of elements) {
    const node = nodes[el.index] as RawNode;
    if (node.parent < 0) continue;
    rows.push(describeElement(el, `${label}#${node.i}`, { visibility: node.visibility }));
  }
  return rows;
}

/** The row a provisional selector matched, keyed by the step that matched it. */
export function rowFromRawNodes(
  label: string,
  nodes: RawNode[],
  matchedIndex: number
): CandidateRow | null {
  const rows = rowsFromRawNodes(label, nodes);
  return rows.find((r) => r.id === `${label}#${matchedIndex}`) ?? null;
}
