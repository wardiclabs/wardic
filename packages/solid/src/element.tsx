/**
 * What every Wardic element's component form shares, for the Solid 1 binding (#511): `createWith`,
 * which makes `wardic.create`'s component and `w.create`'s, a Complete element's or a Slim one's by the
 * `kind` it's given, and the forms' proxy. `wardic.tsx` holds the Complete forms, `w.tsx` the Slim ones;
 * this module names no Feature, so a Slim element's app ships none it doesn't choose (ADR-0067).
 *
 * `create(tag)` returns a Solid component that accepts the element's own props PLUS Wardic's motion
 * props (`initial` / `animate` / `whileHover` / ...), wires them through {@link createWardWith}, and
 * renders the underlying element with the user's props passed through. The flush gate commits each
 * frame onto the element (ADR-0034). `create(Component)` is the same over the component, which
 * forwards its `ref` to its root element (#253).
 *
 * Locked merge policy (Option A) — the merge now lives in `ward()`
 * ({@link createWardWith}); this HOC just forwards the user's `ref` + `style` into it:
 *   - Motion props are split off so none leak to the DOM (even ones not yet
 *     wired by {@link createWardWith}).
 *   - The user's `ref` AND Wardic's ref are both invoked (via `mergeRefs`).
 *   - Wardic's keys win: the Starting style goes over the user's `style` until the first
 *     commit; from then on the user's `style` is the fallback, without the keys the
 *     gate holds, which Wardic writes onto the element (ADR-0034). A reactive user
 *     `style` re-runs the spread's `style`; a frame never does.
 *
 * SSR-correct: {@link createWardWith} computes the Starting style synchronously, so the
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
import { $PROXY, type Accessor, children, type Component, createComponent, createEffect, createRenderEffect, type JSX, sharedConfig, splitProps, untrack } from "solid-js"
import { assign, Dynamic, getNextElement, insert, spread, SVGElements, use } from "solid-js/web"
import { isServer } from "./server.ts"
import { GESTURE_KEYS } from "./gesture-callbacks.ts"
import { renderServerElement, serverAppearOfWard, createWardWith, type SpineInternals, type WardStyle, type WardUserProps } from "./create-ward.tsx"
import type { WardConfig, WardicVariantLabels } from "./config.ts"
import type { InferredMotion, TargetKey } from "./ward-keys.ts"
import { changesContext } from "./variant-tree.ts"
import { MOTION_PROPS, motionToConfig, type WardicMotionProps } from "./motion-props.ts"
import { droppedKeysOf, markWardic, routingTagOf, type WardicCreateOptions } from "./wardic-component.ts"
import { useWardicConfig } from "./wardic-config.tsx"
import { isValidPropOf } from "./wardic-config-value.ts"

export { MOTION_PROPS, motionToConfig, type WardicMotionProps } from "./motion-props.ts"

/**
 * Props for a `wardic.<tag>` element: the tag's intrinsic props + motion props `M`, with a `style`
 * that takes the transform keys and Live values too ({@link WardStyle}, #130). A `wardic.<tag>`
 * component's `M` has its keys inferred ({@link WardicComponent}).
 */
export type WardicProps<Tag extends keyof JSX.IntrinsicElements, M = WardicMotionProps> =
  // `onAnimationStart` is Motion's (#257), not the DOM's CSS `animationstart` event's, as on Motion.
  & Omit<JSX.IntrinsicElements[Tag], "style" | "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd">
  & M
  & { readonly style?: WardStyle | string | undefined }

/**
 * A `wardic.<tag>` component (#305): generic over the keys its targets set, so its `transition` takes
 * entries for those keys, `default` and `layout`, and a target's own takes them and `default`
 * ({@link InferredMotion}). A name an entry gives that the element doesn't animate is an error, and
 * completion inside a `transition` offers the keys it drives.
 */
export type WardicComponent<Tag extends keyof JSX.IntrinsicElements> = <
  K extends TargetKey = never,
  N extends string = never,
  LI extends WardicVariantLabels = never,
  LA extends WardicVariantLabels = never,
  D extends boolean | "x" | "y" = never,
>(props: WardicProps<Tag, InferredMotion<WardicMotionProps, K, N, LI, LA, D>>) => JSX.Element

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
 * `create(tag | Component)` of a form (`wardic.create`, `w.create`): a motion component, a Complete
 * element's or a Slim one's as `kind` says (#511).
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
 * `options` (#443, Motion's `motion.create` options): `forwardMotionProps` hands the motion props on
 * to what it renders as well, and `type` says what its element is for its server render and Starting
 * style ({@link WardicCreateOptions}).
 */
export function createWith(arg: string | Component<Record<string, unknown> & WardicWrappable>, options: WardicCreateOptions, kind: SpineInternals): Component<Record<string, unknown>> {
  const forward = options.forwardMotionProps === true
  const made = Bool.match(Predicate.isString(arg), {
    onTrue: () => wardComponent(arg as string, { ...kind, tag: routingTagOf(arg as string, options.type) }, forward),
    onFalse: () => wardComponent(arg as Component<Record<string, unknown> & WardicWrappable>, { ...WRAPPED, ...kind, tag: routingTagOf(undefined, options.type) }, forward),
  })
  // Marked with what it wraps (#443): `isWardicComponent`, `unwrapWardicComponent`.
  return markWardic(made, arg)
}

/** The `create` of a form: {@link createWith}'s overloads. */
export interface Create {
  <Tag extends keyof JSX.IntrinsicElements>(tag: Tag, options?: WardicCreateOptions): WardicComponent<Tag>
  // A component's stays a plain `Component`, its keys not inferred: a generic return type would stop
  // TS carrying a generic component's own type parameters through (Kobalte's `<T extends ValidComponent>`).
  <P>(component: Component<P & WardicWrappable>, options?: WardicCreateOptions): Component<P & WardicMotionProps>
  (tag: string, options?: WardicCreateOptions): Component<WardicProps<keyof JSX.IntrinsicElements>>
}

/** A form's `create`, its elements of `kind`. */
export const createOf =
  (kind: SpineInternals): Create =>
  ((arg: string | Component<Record<string, unknown> & WardicWrappable>, options: WardicCreateOptions = {}) => createWith(arg, options, kind)) as Create

/**
 * A form's proxy (`wardic`, `w`): called, it's the form's directive; `create` and the form's
 * `extras` are its properties, and `<form>.<tag>` is `create(tag)`, cached so `wardic.div ===
 * wardic.div` (stable component identity across reads). Any non-string key is `undefined`.
 */
export const formOf = <F,>(directive: (el: HTMLElement, value: Accessor<WardConfig>) => void, create: Create, extras: Readonly<Record<string, unknown>>): F => {
  const cache = new Map<string, Component<WardicProps<keyof JSX.IntrinsicElements>>>()
  return new Proxy(directive, {
    get(_, prop) {
      if (prop === "create") return create
      if (Predicate.isString(prop)) {
        if (Object.hasOwn(extras, prop)) return extras[prop]
        return Option.getOrElse(Option.fromUndefinedOr(cache.get(prop)), () => {
          const c = create(prop)
          cache.set(prop, c)
          return c
        })
      }
      return undefined
    },
  }) as unknown as F
}

/** What wraps a component tells {@link createWardWith}: its component may not pass `style` on. */
const WRAPPED: SpineInternals = { defaultsOnElement: true }

/** What a form's `create` renders: an element's tag, or the component it wraps. */
type Rendered = string | Component<Record<string, unknown> & WardicWrappable>

/** The namespace an svg tag's element is made in, as Solid's `createDynamic` makes it. */
const SVG_NAMESPACE = "http://www.w3.org/2000/svg"

/**
 * What `<Dynamic component={component}>` renders, for a form's tag or component, which never changes
 * (#525). Still a component boundary, as `Dynamic` is, so the hydration keys land where the server's
 * `Dynamic` puts them. Without `Dynamic`'s `splitProps`, which copied every prop to take `component`
 * out, and without `createDynamic`'s two memos over a component that can't change.
 */
const fixedElement = (component: Rendered): Component<Record<string, unknown>> => {
  if (Predicate.isFunction(component)) return (props) => untrack(() => component(props))
  const tag = component
  const isSvg = SVGElements.has(tag)
  return (props) => {
    const el = tagElementOf(tag, isSvg, props)
    spreadOnto(el, props, isSvg)
    return el
  }
}

/** `tag`'s element: the server's while hydrating, else a new one, as `createDynamic` makes it. */
const tagElementOf = (tag: string, isSvg: boolean, props: Record<string, unknown>): Element => {
  if (Predicate.isNotNullish(sharedConfig.context)) return getNextElement()
  if (isSvg) return document.createElementNS(SVG_NAMESPACE, tag)
  const is = untrack(() => props.is)
  if (Predicate.isString(is)) return document.createElement(tag, { is })
  return document.createElement(tag)
}

/**
 * Solid's `spread` for props whose keys are fixed (#525): their children's effect only when they have
 * children, and their ref called once, as JSX calls its own `ref`, where `spread` gives each a render
 * effect an element. A proxy's keys can change (a reactive spread), so it takes Solid's `spread`.
 */
const spreadOnto = (el: Element, props: Record<string, unknown>, isSvg: boolean): void => {
  if ($PROXY in props) {
    spread(el, props, isSvg)
    return
  }
  if ("children" in props) insert(el, () => props.children)
  untrack(() => {
    const ref = props.ref
    if (Predicate.isFunction(ref)) use(ref as (node: Element) => void, el)
  })
  const prev = {}
  createRenderEffect(() => assign(el, props, isSvg, true, prev, true))
}

/**
 * `<form>.<tag>` and `<form>.create(Component)`: the element, or the wrapped component, with a
 * Ward from {@link createWardWith} spread on it, its variant context's Provider around it when it
 * changes what its children read (#50). `forward`: its motion props are handed on too (#443).
 */
const wardComponent = (component: Rendered, internal: SpineInternals, forward: boolean): Component<Record<string, unknown>> => {
  const Rendered = fixedElement(component)
  // What an element that can never want a gesture runs with (#525): made once a form.
  const gestureless: SpineInternals = { ...internal, gestureless: true }
  return (props) => {
    // The nearest `WardicConfig`'s `isValidProp`, as the element is made (#443).
    const isValidProp = isValidPropOf(useWardicConfig())
    // A server render takes the lean path (ADR-0021, decision 4).
    if (isServer) return serverElement(component, internal, props, forward, isValidProp)

    // 3-way split: motion props (consumed, and only handed on when forwarded, #443), then ref+style
    // (merged), then everything else (rest) passes through to the element or component, but a tag's
    // props a `WardicConfig`'s `isValidProp` keeps off it.
    const [motion, refStyle, own] = splitProps(props as WardicProps<keyof JSX.IntrinsicElements>, MOTION_PROPS, ["ref", "style"])
    const dropped = droppedKeysOf(() => Object.keys(own), isValidProp, Predicate.isString(component))
    // Split again only when it keeps any off (most elements have no `isValidProp` above them).
    const rest = Bool.match(Arr.isReadonlyArrayEmpty(dropped), {
      onTrue: () => own,
      onFalse: () => splitProps(own, dropped as Array<keyof typeof own>)[1],
    })
    const handedOn = Bool.match(forward, { onTrue: () => motion, onFalse: () => NO_PROPS })

    // Reactive config accessor: motionToConfig reads each (reactive) prop getter
    // inside the accessor, so a changed `animate` / `whileHover` / `transition`
    // (a tracked expression) drives a Retarget. The tag lets an svg-inner element
    // render its Starting style's attribute keys as attributes (ADR-0021).
    const cfg = configOfMotion(motion)
    // Its keys fixed (no reactive spread) and none of them a gesture's, it can never want one (#525).
    let spineInternal = internal
    if (Bool.not($PROXY in motion)) {
      if (Bool.not(Arr.some(GESTURE_KEYS, (key) => key in motion))) spineInternal = gestureless
    }
    const ward = createWardWith(cfg, spineInternal)

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
    // The Ward's props, made once: a call spread in JSX compiles to a function source, which made
    // `mergeProps` a proxy that the spread read every key through (#525). Their `style` is a getter.
    const wardProps = ward(userProps)
    const element = (): JSX.Element => <Rendered {...handedOn} {...rest} {...wardProps} />
    return Bool.match(changesContext(untrack(cfg)), {
      onFalse: () => forwarding.render(element),
      onTrue: () => <ward.Provider>{forwarding.render(element)}</ward.Provider>,
    })
  }
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

/** No props: what an element that doesn't forward its motion props hands on of them. */
const NO_PROPS: Readonly<Record<string, never>> = {}

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

/**
 * Everything in `props` but `ref`, `style`, the motion props unless `forward`, and the keys `dropped`
 * (#443), in one pass; getters stay getters.
 */
const passThrough = (props: Record<string, unknown>, forward: boolean, dropped: ReadonlyArray<string>): Record<string, unknown> => {
  const descriptors = Object.getOwnPropertyDescriptors(props)
  const out: Record<string, unknown> = {}
  const off = new Set(dropped)
  Arr.forEach(Rec.keys(descriptors), (key) => {
    if (key === "ref" || key === "style" || off.has(key)) return
    if (MOTION_KEYS.has(key) && !forward) return
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
const serverElement = (
  component: Rendered,
  internal: SpineInternals,
  props: Record<string, unknown>,
  forward: boolean,
  isValidProp: ((key: string) => boolean) | undefined,
): JSX.Element => {
  // A tag's props `isValidProp` keeps off it, as the client's (#443): of its own, the motion props, `ref` and `style` aside.
  const ownKeys = (): ReadonlyArray<string> => Arr.filter(Object.keys(props), (key) => !MOTION_KEYS.has(key) && key !== "ref" && key !== "style")
  const out = passThrough(props, forward, droppedKeysOf(ownKeys, isValidProp, Predicate.isString(component)))
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

