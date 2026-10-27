/**
 * `wardic.create(tag | Component)` HOC + the `wardic.*` motion-element proxy (ADR-0008,
 * Tier 1 headline surface).
 *
 * `wardic.create("div")` returns a Solid component that accepts the element's
 * own props PLUS Wardic's motion props (`initial` / `animate` / `whileHover` /
 * ...), wires them through {@link createWard}, and renders the underlying element
 * with the user's props passed through. The flush gate commits each frame onto the
 * element (ADR-0034). `wardic.create(Component)` is the same over the component, which
 * forwards its `ref` to its root element (#253).
 *
 * `wardic.<tag>` (e.g. `wardic.div`, `wardic.button`) is a cached shorthand for
 * `wardic.create("<tag>")` — `wardic.div === wardic.div`.
 *
 * Locked merge policy (Option A) — the merge now lives in `ward()`
 * ({@link createWard}); this HOC just forwards the user's `ref` + `style` into it:
 *   - Motion props are split off so none leak to the DOM (even ones not yet
 *     wired by {@link createWard}).
 *   - The user's `ref` AND Wardic's ref are both invoked (via `mergeRefs`).
 *   - Wardic's keys win: the Starting style goes over the user's `style` until the first
 *     commit; from then on the user's `style` is the fallback, without the keys the
 *     gate holds, which Wardic writes onto the element (ADR-0034). A reactive user
 *     `style` re-runs the spread's `style`; a frame never does.
 *
 * SSR-correct: {@link createWard} computes the Starting style synchronously, so the
 * `<Dynamic>` renders with the merged initial style on the very first render.
 *
 * REACTIVITY (component props): each motion prop is a plain VALUE, not an
 * accessor. Solid's reactive prop getters already make a component prop tracked —
 * reading `motion.animate` INSIDE {@link motionToConfig}'s config accessor
 * subscribes to whatever signals back the prop. So write a TRACKED EXPRESSION as
 * the value (`animate={open() ? { opacity: 1 } : { opacity: 0 }}`), NOT a function
 * (`animate={() => expr}` is a type error — props are values, not accessors). A
 * signal flip in that expression re-runs the config accessor and drives a Retarget.
 */
import { mergeRefs } from "@solid-primitives/refs"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import { $PROXY, type Accessor, children, type Component, createComponent, createEffect, type JSX, splitProps, untrack } from "solid-js"
import { Dynamic } from "solid-js/web"
import { wardicDirective } from "./directive.ts"
import { isServer } from "./server.ts"
import { renderServerElement, serverAppearOfWard, createWardWith, type SpineInternals, type WardStyle, type WardUserProps } from "./create-ward.tsx"
import type { WardConfig } from "./config.ts"
import { changesContext } from "./variant-tree.ts"
import { MOTION_PROPS, motionToConfig, type WardicMotionProps } from "./motion-props.ts"

export { MOTION_PROPS, motionToConfig, type WardicMotionProps } from "./motion-props.ts"

/**
 * Props for a `wardic.<tag>` element: the tag's intrinsic props + motion props, with a `style` that
 * takes the transform keys and Live values too ({@link WardStyle}, #130).
 */
export type WardicProps<Tag extends keyof JSX.IntrinsicElements> =
  // `onAnimationStart` is Motion's (#257), not the DOM's CSS `animationstart` event's, as on Motion.
  & Omit<JSX.IntrinsicElements[Tag], "style" | "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd">
  & WardicMotionProps
  & { readonly style?: WardStyle | string | undefined }

/**
 * The shape `wardic.create(Component)` requires of a wrapped component: it must
 * forward `props.ref` to its single root DOM element so the spine can wire up
 * (ADR-0008's ref-forwarding contract). All motion is committed through that
 * ref, so the wrapped component owns its own root JSX.
 */
export type WardicWrappable = { ref?: (el: HTMLElement) => void }

/**
 * A client element's config from its split-off motion props: their keys are fixed unless they're a
 * proxy (over a reactive spread), so the gesture callbacks the element wasn't given are never read
 * (#273).
 */
export const configOfMotion = (motion: WardicMotionProps): Accessor<WardConfig> => motionToConfig(motion, Bool.not($PROXY in motion))

/**
 * `wardic.create(tag | Component)` — build a motion component.
 *
 * Both are an element with a Ward on it, made by {@link createWardWith} (#253, as the Solid 2
 * binding's `create` is, ADR-0045): the Starting style in `style` until the gate's first frame
 * is committed (so on a server and in the hydration render), then the user's style (over the drag
 * defaults) without the keys the gate holds (ADR-0034).
 *   - `create("div")` (element-string): renders `<Dynamic component={tag}>`.
 *   - `create(Component)` (a component function): the wrapped component must forward `props.ref`
 *     to its single root element, where the gate commits each frame; that is the only
 *     requirement. It also gets `style` and `draggable`: one that applies `props.style` renders
 *     its Starting style on a server, and one that doesn't still animates, the drag defaults
 *     set on its element at mount (ADR-0021, decision 6). One that never forwards its ref is a
 *     clear error once mounted (ADR-0008).
 *
 * @param arg an element tag string (e.g. `"div"`) OR a component forwarding `ref`.
 * @returns a Solid component accepting the element's / component's props + motion props.
 */
export function create<Tag extends keyof JSX.IntrinsicElements>(tag: Tag): Component<WardicProps<Tag>>
export function create<P>(component: Component<P & WardicWrappable>): Component<P & WardicMotionProps>
export function create(tag: string): Component<WardicProps<keyof JSX.IntrinsicElements>>
export function create(arg: string | Component<Record<string, unknown> & WardicWrappable>): Component<Record<string, unknown>> {
  return Bool.match(Predicate.isString(arg), {
    onTrue: () => wardComponent(arg as string, { tag: arg as string }),
    onFalse: () => wardComponent(arg as Component<Record<string, unknown> & WardicWrappable>, WRAPPED),
  })
}

/** What wraps a component tells {@link createWardWith}: its component may not pass `style` on. */
const WRAPPED: SpineInternals = { defaultsOnElement: true }

/** What `wardic.create` renders: an element's tag, or the component it wraps. */
type Rendered = string | Component<Record<string, unknown> & WardicWrappable>

/**
 * `wardic.<tag>` and `wardic.create(Component)`: the element, or the wrapped component, with a
 * Ward from {@link createWardWith} spread on it, its variant context's Provider around it when it
 * changes what its children read (#50).
 */
const wardComponent =
  (component: Rendered, internal: SpineInternals): Component<Record<string, unknown>> =>
  (props) => {
    // A server render takes the lean path (ADR-0021, decision 4).
    if (isServer) return serverElement(component, internal, props)

    // 3-way split: motion props (consumed, never leak), then ref+style (merged),
    // then everything else (rest) passes through to the element or component.
    const [motion, refStyle, rest] = splitProps(props as WardicProps<keyof JSX.IntrinsicElements>, MOTION_PROPS, ["ref", "style"])

    // Reactive config accessor: motionToConfig reads each (reactive) prop getter
    // inside the accessor, so a changed `animate` / `whileHover` / `transition`
    // (a tracked expression) drives a Retarget. The tag lets an svg-inner element
    // render its Starting style's attribute keys as attributes (ADR-0021).
    const cfg = configOfMotion(motion)
    const ward = createWardWith(cfg, internal)

    // Delegate the ref + style merge entirely to ward(): it invokes both the
    // user's ref and ward's internal ref, and gives the element its `style`: the
    // Starting style over the user's, then the user's without the keys the gate
    // holds (ADR-0034).
    //
    // `style` is threaded as a LIVE GETTER, not a value read once at setup:
    // `refStyle.style` is a reactive `splitProps` getter, so a reactive user
    // `style` prop (e.g. `style={{ left: pos() }}` on a non-animated key) is
    // tracked by ward()'s reactive style getter and re-merged on change. Reading
    // it into a `const` here would freeze it at its initial value. `ref` is wired
    // once at mount (refs don't change), so it stays a one-time read.
    const forwarding = forwardingOf(component, (refStyle as { ref?: (el: HTMLElement) => void }).ref)
    const ref = forwarding.ref
    const userProps: WardUserProps = {
      ...UndefinedOr.match(ref, { onUndefined: () => ({}), onDefined: (defined) => ({ ref: defined }) }),
      get style() {
        return (refStyle as { style?: JSX.CSSProperties }).style
      },
    }

    // An element that changes what its children read renders its variant context's Provider
    // around them (#50); any other renders none (`changesContext`, decided once, as on a server).
    const element = (): JSX.Element => <Dynamic component={component} {...rest} {...ward(userProps)} />
    return Bool.match(changesContext(untrack(cfg)), {
      onFalse: () => forwarding.render(element),
      onTrue: () => <ward.Provider>{forwarding.render(element)}</ward.Provider>,
    })
  }

/** The user's ref, merged with what checks the Ward's, and how the element renders. */
interface Forwarding {
  readonly ref: ((el: HTMLElement) => void) | undefined
  readonly render: (element: () => JSX.Element) => JSX.Element
}

/** A tag's: the user's ref, and its element as it is. */
const ownElement = (element: () => JSX.Element): JSX.Element => element()

/**
 * The user's ref, and, for a wrapped component, the check that it forwards the Ward's (ADR-0008,
 * narrowed by #414): one that renders an element and forwards its ref to none of what it renders
 * leaves the gate no element to commit to, a clear error. One that renders nothing yet (a component
 * library's part that shows only while open or selected) is waited on: its element is driven when it
 * comes. Checked each time what it renders changes, inside the wrap's Provider (#50).
 */
const forwardingOf = (component: Rendered, userRef: ((el: HTMLElement) => void) | undefined): Forwarding => {
  if (Predicate.isString(component)) return { ref: userRef, render: ownElement }
  let reached: HTMLElement | undefined
  const ref = mergeRefs(userRef, (el: HTMLElement) => {
    reached = el
  })
  const render = (element: () => JSX.Element): JSX.Element => {
    const rendered = children(element)
    createEffect(() => {
      const elements = Arr.filter(rendered.toArray(), isElement)
      if (Arr.isArrayEmpty(elements)) return
      if (Arr.some(elements, (inside) => Predicate.isNotUndefined(reached) && inside.contains(reached))) return
      const name = component.name || "anonymous component"
      throw new Error(
        `wardic.create(${name}): the wrapped component rendered an element but did not forward its ref to it. ` +
          "The component must forward props.ref to a single root DOM element " +
          "(e.g. <div ref={props.ref}>...</div>). Element-only motion is wired through the ref.",
      )
    })
    return rendered as unknown as JSX.Element
  }
  return { ref, render }
}

/** Whether a rendered node is an element. */
const isElement = (node: unknown): node is Element => node instanceof Element

/** The motion props, as a set for the server path's one pass. */
const MOTION_KEYS: ReadonlySet<string> = new Set(MOTION_PROPS)

/**
 * Set each of `values` on `out` as a plain data property. A key copied from the user's props
 * may be a getter (a reactive prop like `cx={cx()}`), which an assignment can't overwrite;
 * Wardic's value wins, as `mergeProps` makes it on the client.
 */
const override = (out: Record<string, unknown>, values: Record<string, unknown>): void =>
  Arr.forEach(Rec.keys(values), (key) => {
    Object.defineProperty(out, key, { value: values[key], enumerable: true, configurable: true, writable: true })
  })

/** Everything in `props` but the motion props, `ref` and `style`, in one pass; getters stay getters. */
const passThrough = (props: Record<string, unknown>): Record<string, unknown> => {
  const descriptors = Object.getOwnPropertyDescriptors(props)
  const out: Record<string, unknown> = {}
  Arr.forEach(Rec.keys(descriptors), (key) => {
    if (MOTION_KEYS.has(key) || key === "ref" || key === "style") return
    Object.defineProperty(out, key, UndefinedOr.getOrThrow(descriptors[key]))
  })
  return out
}

/**
 * `wardic.<tag>` and `wardic.create(Component)` during a server render (ADR-0021, decisions 4 and
 * 6): the element, or the component, with its Starting style and static attributes, built in one
 * pass over the props. Solid's server `splitProps` and `mergeProps` cost most of a wrapped
 * element's server time, and none of their reactivity matters there. The client's
 * `createUniqueId` (inside `createWardWith`) and its `Dynamic` boundary are kept, so every
 * hydration key lands where the client's render puts it.
 */
const serverElement = (component: Rendered, internal: SpineInternals, props: Record<string, unknown>): JSX.Element => {
  const out = passThrough(props)
  const cfg = motionToConfig(props as WardicMotionProps)
  const ward = createWardWith(cfg, internal)
  override(out, { ...ward({ style: props.style as JSX.CSSProperties | undefined }), component })
  // The client's nesting: the element's `ward.Provider` when it changes what its children read
  // (#50), then the element; a late chunk's root then its chunk's style (#245).
  const element = (): JSX.Element => createComponent(Dynamic, out as Parameters<typeof Dynamic>[0])
  const render = (): JSX.Element =>
    Bool.match(changesContext(cfg()), {
      onFalse: element,
      onTrue: () =>
        createComponent(ward.Provider, {
          get children() {
            return element()
          },
        }),
    })
  return renderServerElement(serverAppearOfWard(ward), render)
}

/**
 * The typed `wardic` proxy: called, it's the `use:wardic` directive; `wardic.create` is the
 * HOC, and `wardic.<tag>` is a motion component for that intrinsic element (cached per tag).
 */
export type Wardic = ((el: HTMLElement, value: Accessor<WardConfig>) => void) & {
  readonly create: typeof create
} & {
  readonly [Tag in keyof JSX.IntrinsicElements]: Component<WardicProps<Tag>>
}

/**
 * `wardic` — the motion-element proxy and the `use:wardic` directive (ADR-0008 Tier 1,
 * ADR-0042): every way to make a **Wardic element** but `createWard`'s spread.
 *
 *   - `wardic(el, accessor)` -> the directive (`<div use:wardic={config}>` compiles to it).
 *   - `wardic.create(tag)` -> the HOC above.
 *   - `wardic.<tag>` (string key) -> `create(tag)`, CACHED so `wardic.div ===
 *     wardic.div` (stable component identity across reads).
 *   - any non-string/symbol key -> `undefined`.
 */
const cache = new Map<string, Component<WardicProps<keyof JSX.IntrinsicElements>>>()

export const wardic: Wardic = new Proxy(wardicDirective, {
  get(_, prop) {
    if (prop === "create") return create
    if (Predicate.isString(prop)) {
      return Option.getOrElse(Option.fromUndefinedOr(cache.get(prop)), () => {
        const c = create(prop)
        cache.set(prop, c)
        return c
      })
    }
    return undefined
  },
}) as unknown as Wardic
