/**
 * Which Cypress call a `fill` becomes, read off the row a probe observed.
 *
 * This is the ladder's move applied to interaction. The ladder stops the model authoring a
 * selector by deriving one from an observed row; this stops the model authoring an interaction
 * by deriving the call from the same row. The IR says *put this value in that control*, and the
 * observed `tag` and `attrs.type` say whether that is a `.select`, a `.check` or a `.type`.
 *
 * It is why there is one verb and not four. A `type` verb and a `select` verb would put the
 * choice back where it cannot be checked: `.type()` on a `<select>` throws, and only the facts
 * know which one the element is.
 *
 * The linter and the compiler both ask this exact function, for the reason every rule in this
 * codebase lives in one place - a lint pass followed by a compiler throw ends the run instead
 * of costing a turn, and a metered run is the expensive way to learn what the facts already say.
 */
import type { CandidateRow } from "../facts/types.js";
import type { IrValue } from "../ir/types.js";

export type FillCall =
  /** `.select(v)` - Cypress fires the change event itself. */
  | { call: "select" }
  /** `.check()` or `.uncheck()`. Carries no value: the checked state IS the value. */
  | { call: "check"; checked: boolean }
  /** `.clear().type(v)`. Always clears - see `chooseFillCall`. */
  | { call: "type" };

/** Why this row and this value cannot be a fill. The text is the diagnostic, both halves use it. */
export interface FillRefusal {
  refuse: string;
}

export function isRefusal(x: FillCall | FillRefusal): x is FillRefusal {
  return "refuse" in x;
}

/**
 * What the emitted call can do with this value.
 *
 * A `ref` or a `builder` is scalar-shaped by assumption: nothing here knows what it resolves to
 * at run time, and a name bound to an object is a defect the value builders' own vocabulary
 * already refuses. An `object` or a `list` is not scalar-shaped by construction, and neither is
 * `null` - there is no call that puts one of those in a text box.
 */
function shapeOf(value: IrValue): "boolean" | "scalar" | "neither" {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string" || typeof value === "number") return "scalar";
  if (value === null) return "neither";
  if ("ref" in value || "builder" in value) return "scalar";
  return "neither";
}

const describe = (value: IrValue): string => JSON.stringify(value) ?? String(value);

/**
 * The table, and every refusal that keeps it honest.
 *
 * **Always `.clear()` before `.type()`.** Measured over the corpus: 673 clears against 1058
 * types, so a human clears about two thirds of the time and the other third is typing into a
 * field they already know is empty. A generated spec cannot know that, and appending to whatever
 * the form happened to hold is the failure that looks like a flake.
 *
 * A refusal here is not a gap in the vocabulary to be worked around. It is the facts saying the
 * model picked the wrong row, and the message says which row and what kind of element it needs.
 */
export function chooseFillCall(row: CandidateRow, value: IrValue): FillCall | FillRefusal {
  const tag = row.tag.toLowerCase();
  const type = (row.attrs.type ?? "").toLowerCase();
  const shape = shapeOf(value);
  const at = `row '${row.id}'`;

  const needsScalar = (): FillRefusal | null => {
    if (shape === "scalar") return null;
    return {
      refuse:
        shape === "boolean"
          ? `${at} is a <${tag}> that holds text, and the value is the boolean ${describe(value)}. ` +
            `true and false are for a checkbox or a radio, where they mean checked and unchecked.`
          : `${at} is a <${tag}> that holds text, and ${describe(value)} is not something a field ` +
            `can hold. Give it a string, a number, a capture or a value builder.`,
    };
  };

  if (tag === "select") {
    const wrong = needsScalar();
    if (wrong) return wrong;
    if (value === "") {
      return { refuse: `${at} is a <select> and the value is empty. Name the option to choose.` };
    }
    return { call: "select" };
  }

  if (tag === "input" && (type === "checkbox" || type === "radio")) {
    if (shape !== "boolean") {
      return {
        refuse:
          `${at} is an <input type="${type}">, and the emitted call is .check() or .uncheck() - ` +
          `so the value is a literal true or false, not ${describe(value)}. A reference would ` +
          `emit one of the two calls unconditionally, which is not what the IR would be saying.`,
      };
    }
    if (type === "radio" && value === false) {
      return {
        refuse:
          `${at} is a radio button, and a radio is never unchecked on its own - Cypress refuses ` +
          `.uncheck() on one. Fill the radio that should be chosen instead.`,
      };
    }
    return { call: "check", checked: value as boolean };
  }

  if (tag === "input" && type === "file") {
    return {
      refuse:
        `${at} is a file input, and uploading a file is .selectFile(), which this tool does not ` +
        `have. It is a real gap - 40 uses across 9% of the corpus - and a human decides whether ` +
        `to add it. See ticket 18.`,
    };
  }

  if (tag === "input" || tag === "textarea") {
    const wrong = needsScalar();
    if (wrong) return wrong;
    if (value === "") {
      return {
        refuse:
          `${at} would emit .type(''), which Cypress refuses. A fill already clears the field ` +
          `first, so an empty value asks for nothing.`,
      };
    }
    return { call: "type" };
  }

  return {
    refuse:
      `${at} is a <${tag}>, which holds no value. A fill needs an <input>, a <textarea> or a ` +
      `<select>. If this is a custom control that only looks like one, click the element that ` +
      `opens it and fill the real control underneath.`,
  };
}
