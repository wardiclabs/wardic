/**
 * Scenario controls shared by the scenarios that take options (free play and
 * scenario 7, and the drag scenarios' "lose the next release" toggle): a labelled
 * select, a labelled checkbox, and the row and note styles around them.
 *
 * @module
 */
import type { JSX } from "#binding"
import { For } from "solid-js"

/** One select option: the value used in the trigger label, and its display text. */
export interface Option<T extends string> {
  readonly value: T
  readonly label: string
}

/**
 * The value in `options` that equals `value`, or `fallback` when none does. Turns a
 * select's untyped string back into its union type.
 */
const pick = <T extends string>(options: ReadonlyArray<Option<T>>, value: string, fallback: T): T =>
  options.find((o) => o.value === value)?.value ?? fallback

/** The controls row. */
export const CONTROLS_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-wrap": "wrap",
  gap: "12px",
}

/** One labelled control: the label text above its select. */
const CONTROL_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  gap: "2px",
  color: "var(--lab-muted)",
  "font-size": "12px",
}

/** An always-shown note. Static text, so changing a select never reflows the page. */
export const NOTE_STYLE: JSX.CSSProperties = {
  margin: "0",
  "max-width": "320px",
  color: "var(--lab-muted)",
  "font-size": "12px",
}

/**
 * A labelled select over `options`. Every prop is a static value: the View passes
 * `value={signal()}`, and Solid's prop getter keeps it reactive.
 */
export const Select = <T extends string>(props: {
  readonly label: string
  readonly name: string
  readonly options: ReadonlyArray<Option<T>>
  readonly value: T
  readonly onChange: (value: T) => void
}): JSX.Element => (
  <label style={CONTROL_STYLE}>
    {props.label}
    <select name={props.name} onChange={(e) => props.onChange(pick(props.options, e.currentTarget.value, props.value))}>
      <For each={props.options}>
        {(o) => (
          <option value={o.value} selected={props.value === o.value}>
            {o.label}
          </option>
        )}
      </For>
    </select>
  </label>
)

/** One labelled checkbox: the box, then its text. */
const CHECKBOX_STYLE: JSX.CSSProperties = {
  display: "flex",
  gap: "6px",
  "align-items": "center",
  "font-size": "12px",
}

/**
 * A labelled checkbox. Every prop is a static value: the View passes
 * `checked={signal()}`, and Solid's prop getter keeps it reactive.
 */
export const Checkbox = (props: {
  readonly label: string
  readonly name: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}): JSX.Element => (
  <label style={CHECKBOX_STYLE}>
    <input type="checkbox" name={props.name} checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} />
    {props.label}
  </label>
)
