/**
 * `wardic.create(tag | Component)` HOC + the `wardic.*` motion-element proxy (ADR-0008,
 * Tier 1 headline surface): the **Complete element**'s component forms, every Feature brought with it
 * (#511, ADR-0067), as Motion's `motion` is. The forms' shared code, and how a component is made, is
 * `element.tsx`'s; `w.tsx` holds the Slim element's forms.
 *
 * `wardic.<tag>` (e.g. `wardic.div`, `wardic.button`) is a cached shorthand for
 * `wardic.create("<tag>")` — `wardic.div === wardic.div`.
 *
 * `wardic.create`'s options (#443, Motion's): `forwardMotionProps` hands the motion props on too, and
 * `type` says what its element is for its server render. Every component made is marked
 * (`isWardicComponent`), and a `WardicConfig`'s `isValidProp` keeps a tag's props off its element.
 */
import type { Accessor, JSX } from "solid-js"
import { runDirective } from "./directive.ts"
import { COMPLETE } from "./complete.ts"
import type { WardConfig } from "./config.ts"
import { type Create, createOf, formOf, type WardicComponent } from "./element.tsx"

export { MOTION_PROPS, motionToConfig, type WardicMotionProps } from "./motion-props.ts"
export { configOfMotion, type Create, type WardicComponent, type WardicProps, type WardicWrappable } from "./element.tsx"

/**
 * `wardic.create(tag | Component)` — build a motion component, a **Complete element** (#511): the
 * forms' `create` (`element.tsx`'s `createWith`), bringing every Feature.
 *
 * @param arg an element tag string (e.g. `"div"`) OR a component forwarding `ref`.
 * @returns a Solid component accepting the element's / component's props + motion props.
 */
export const create: Create = createOf(COMPLETE)

/**
 * The `use:wardic` directive: drive `el` through Wardic's motion spine, a Complete element. An arrow
 * function, so the `wardic` Proxy over it has no non-configurable `prototype` to keep.
 */
const wardicDirective = (el: HTMLElement, value: Accessor<WardConfig>): void => runDirective(el, value, COMPLETE)

/**
 * The typed `wardic` proxy: called, it's the `use:wardic` directive; `wardic.create` is the
 * HOC, and `wardic.<tag>` is a motion component for that intrinsic element (cached per tag).
 */
export type Wardic = ((el: HTMLElement, value: Accessor<WardConfig>) => void) & {
  readonly create: typeof create
} & {
  readonly [Tag in keyof JSX.IntrinsicElements]: WardicComponent<Tag>
}

/**
 * `wardic` — the motion-element proxy and the `use:wardic` directive (ADR-0008 Tier 1,
 * ADR-0042): every way to make a Complete **Wardic element** but `createWard`'s spread.
 *
 *   - `wardic(el, accessor)` -> the directive (`<div use:wardic={config}>` compiles to it).
 *   - `wardic.create(tag)` -> the HOC above.
 *   - `wardic.<tag>` (string key) -> `create(tag)`, CACHED so `wardic.div ===
 *     wardic.div` (stable component identity across reads).
 *   - any non-string/symbol key -> `undefined`.
 */
export const wardic: Wardic = formOf<Wardic>(wardicDirective, create, {})
