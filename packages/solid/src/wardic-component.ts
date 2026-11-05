/**
 * What both bindings' `wardic.create` shares, Solid-free (#443): its options (Motion's `motion.create`
 * options, `forwardMotionProps` and `type`), the mark it sets on what it makes (Motion's
 * `motionComponentSymbol`), and the `WardicConfig` `isValidProp` filter on a tag's own props.
 *
 * @module
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"

/** `wardic.create`'s options (Motion's `motion.create(Component, options)`). */
export interface WardicCreateOptions {
  /**
   * Hand the motion props on to what it renders as well (Motion's `forwardMotionProps`): a wrapped
   * component gets `animate`, `whileHover` and the rest beside the Ward's spread, and a tag gets them as
   * attributes, as Motion's does. They still drive the element. Default `false`.
   */
  readonly forwardMotionProps?: boolean | undefined
  /**
   * What its element is, for its server render and its Starting style (Motion's `type`): `"svg"`, an
   * element inside an `<svg>`, whose attribute keys (`d`, `cx`, `pathLength`…) render as attributes;
   * `"html"`, every key as style. Left out, a tag's own name decides, and a wrapped component's
   * element is HTML. In the browser, the element itself decides, as it always has.
   */
  readonly type?: "svg" | "html" | undefined
}

/**
 * The tag a wrapped component's svg-inner element routes its keys by when its own tag isn't known:
 * every svg-inner element routes them alike (ADR-0014).
 */
const SVG_INNER = "g"

/**
 * The tag an element's server render and Starting style route its keys by (#443): `type`'s over its
 * own (`undefined` for a wrapped component). `"svg"` keeps a known tag, which says which SVG element.
 */
export const routingTagOf = (tag: string | undefined, type: WardicCreateOptions["type"]): string | undefined => {
  if (type === "html") return undefined
  if (type === "svg") return UndefinedOr.match(tag, { onUndefined: () => SVG_INNER, onDefined: identity })
  return tag
}

/**
 * The mark on every component `wardic.create` and `wardic.<tag>` make (#443, Motion's
 * `motionComponentSymbol`), holding the tag or the component it wraps. Registered, so both bindings,
 * and two copies of the package, read each other's.
 */
const WARDIC_COMPONENT: unique symbol = Symbol.for("@wardic/solid/component")

/** A component function, as {@link unwrapWardicComponent} gives it back, whichever Solid it's for. */
export type AnyComponentFunction = (props: never) => unknown

/** `component`, marked as made by `wardic.create` from `wraps` (#443). */
export const markWardic = <C extends object>(component: C, wraps: string | AnyComponentFunction): C =>
  Object.defineProperty(component, WARDIC_COMPONENT, { value: wraps })

/**
 * Whether `component` is a Wardic element's component: one that `w.<tag>`, `wardic.<tag>` or
 * `wardic.create` made, on either binding. Motion's `isMotionComponent`.
 *
 * @example
 * isWardicComponent(wardic.div) // true
 * @see https://wardic.dev/reference/solid/utilities/component-checks
 */
// #443.
export const isWardicComponent = (component: unknown): boolean => Predicate.hasProperty(component, WARDIC_COMPONENT)

/**
 * What a Wardic element's component wraps: its tag, `"div"` for `wardic.div`, or the component given to
 * `wardic.create`; `undefined` for anything else. Motion's `unwrapMotionComponent`.
 *
 * @see https://wardic.dev/reference/solid/utilities/component-checks
 */
// #443.
export const unwrapWardicComponent = (component: unknown): string | AnyComponentFunction | undefined => {
  if (Bool.not(isWardicComponent(component))) return undefined
  return (component as { readonly [WARDIC_COMPONENT]: string | AnyComponentFunction })[WARDIC_COMPONENT]
}

/**
 * The keys of a tag's own props (`keysOf`: the motion props, `ref` and `style` split off) that a
 * `WardicConfig`'s `isValidProp` keeps from the element (#443, Motion's `filterProps`): each that
 * doesn't start with `on` and that it says isn't valid. None without one, or for a wrapped component,
 * which gets every prop, as Motion's does; `keysOf` isn't read then. Decided for the keys it has as
 * it's made.
 */
export const droppedKeysOf = (keysOf: () => ReadonlyArray<string>, isValidProp: ((key: string) => boolean) | undefined, isTag: boolean): ReadonlyArray<string> => {
  if (Predicate.isUndefined(isValidProp)) return Arr.empty()
  if (Bool.not(isTag)) return Arr.empty()
  // `&&`, not `Bool.and`: `isValidProp` is asked of no `on` key, as Motion asks it.
  return Arr.filter(keysOf(), (key) => !key.startsWith("on") && !isValidProp(key))
}
