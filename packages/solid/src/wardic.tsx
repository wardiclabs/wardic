/**
 * `wardic.create(tag)` HOC + the `wardic.*` motion-element proxy (ADR-0008,
 * Tier 1 headline surface).
 *
 * `wardic.create("div")` returns a Solid component that accepts the element's
 * own props PLUS Wardic's motion props (`initial` / `animate` / `whileHover` /
 * ...), wires them through {@link createWard}, and renders the underlying element
 * with the user's props passed through. The flush gate commits each frame onto the
 * element (ADR-0034).
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
import * as Renderer from "@wardic/core/Renderer"
import type * as Values from "@wardic/core/Values"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import * as Style from "@wardic/dom/Style"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constUndefined, pipe } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import { $PROXY, type Accessor, type Component, createComponent, createSignal, createUniqueId, type JSX, onMount, splitProps, untrack } from "solid-js"
import { Dynamic } from "solid-js/web"
import { wardicDirective } from "./directive.ts"
import { createElementStyle } from "./element-style.ts"
import { createLiveStyle, split } from "./live-style.ts"
import { useWardicGate, useWardicRuntime } from "./provider.tsx"
import { isHydrating, isServer } from "./server.ts"
import { renderServerElement, serverAppearOfWard, runSpine, serverAppearOf, createWardWith, type WardStyle, type WardUserProps } from "./create-ward.tsx"
import { dragAxisOf, drawnAtRest, flagStartingStyle, isLayoutNode, registryOf, serverStartingStyle, warnDroppedTransform } from "./spine.ts"
import { reactivity } from "./solid-reactivity.ts"
import type { WardConfig } from "./config.ts"
import { presenceBlocksInitial, usePresenceContext } from "./presence.tsx"
import { createVariantNode } from "./variant-node.ts"
import { changesContext, serverVariantNode, startingValuesOf } from "./variant-tree.ts"
import { setsAnimation } from "./appear.ts"
import { MOTION_PROPS, motionToConfig, type WardicMotionProps } from "./motion-props.ts"

export { MOTION_PROPS, motionToConfig, type WardicMotionProps } from "./motion-props.ts"
import { useVariantContext, WardicVariantContext } from "./variants.ts"

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
 * Two paths:
 *   - `create("div")` (element-string): renders `<Dynamic component={tag}>` through
 *     {@link createWard} — SSR-correct, the Starting style is computed synchronously
 *     for the very first render; the gate commits each frame onto the element.
 *   - `create(Component)` (a component function): the wrapped component must
 *     forward `props.ref` to its single root element; that is still the only
 *     requirement. The gate commits each frame onto that forwarded element
 *     ({@link runSpine}). Until its first frame is committed (so on a server and in
 *     the hydration render), the component also receives `style` = the user's style
 *     + the Starting style + the drag defaults, and `draggable`; then the user's
 *     style (over the drag defaults) without the keys the gate holds (ADR-0034). A
 *     component that applies `props.style` renders its Starting style on a server;
 *     one that doesn't still animates (ADR-0021, decision 6).
 *
 * @param arg an element tag string (e.g. `"div"`) OR a component forwarding `ref`.
 * @returns a Solid component accepting the element's / component's props + motion props.
 */
export function create<Tag extends keyof JSX.IntrinsicElements>(tag: Tag): Component<WardicProps<Tag>>
export function create<P>(component: Component<P & WardicWrappable>): Component<P & WardicMotionProps>
export function create(tag: string): Component<WardicProps<keyof JSX.IntrinsicElements>>
export function create(arg: string | Component<Record<string, unknown> & WardicWrappable>): Component<Record<string, unknown>> {
  // Component path (non-string arg): drive the forwarded element via a commit
  // sink (ADR-0008 + ADR-0006). The wrapped component owns its root JSX; the gate
  // commits the projected Patch onto the element it forwards its `ref` to. Until
  // the first commit, `style` carries the Starting style (ADR-0021, decision 6).
  if (!Predicate.isString(arg)) {
    const Wrapped = arg
    return (props) => {
      // A server render takes the lean path (ADR-0021).
      if (isServer) return serverComponent(Wrapped, props)

      // Split motion props (consumed, never forwarded) and the user's ref and style
      // (merged); everything else passes through to the component.
      const [motion, refStyle, rest] = splitProps(props as Record<string, unknown> & WardicMotionProps & WardicWrappable, MOTION_PROPS, ["ref", "style"])

      const runtime = useWardicRuntime()
      const gate = useWardicGate()
      const id = createUniqueId()
      const [el, setEl] = createSignal<HTMLElement>()

      // Reactive config accessor from the motion props (tracks changes ->
      // Retarget). motionToConfig reads each prop getter inside its accessor.
      const cfg = configOfMotion(motion)
      // Its place in variant orchestration (ADR-0007, #50): the context it hands the
      // component's children, and, as a Variant child, the ancestor it inherits from and joins.
      const node = createVariantNode(cfg, useVariantContext())

      // The Starting style, the drag defaults, and whether the first frame has been
      // committed: until then `style` carries the Starting style, so a component that
      // applies it renders it on a server, while hydrating and before the first frame.
      // While hydrating it's what the server rendered, the DOM's project (the Hydration
      // hold, ADR-0021 decision 2); otherwise the Environment's Renderer's.
      const config = untrack(cfg)
      const initialValues = startingValuesOf(config, node.inherited, presenceBlocksInitial(usePresenceContext()), untrack)
      // A layout node's is drawn through its projection at rest, as its first commit draws it (#245).
      const layoutNode = isLayoutNode(config)
      const projected = runtime.runSync(Renderer.Renderer).project(drawnAtRest(initialValues, layoutNode))
      const hydrating = isHydrating()
      const starting = Bool.match(hydrating, { onTrue: () => DomRenderer.project(drawnAtRest(initialValues, layoutNode)), onFalse: () => projected })
      if (hydrating) flagStartingStyle(runtime, id, starting, projected)
      const axis = dragAxisOf(config, undefined)
      const dragDefaults = UndefinedOr.map(axis, Style.dragDefaults)
      const userStyle = (): JSX.CSSProperties | string | undefined => (refStyle as { style?: JSX.CSSProperties | string }).style
      // Its routed `style` keys (#130, ADR-0043): Live values and transform keys, which the gate
      // writes from mount, and the Starting style carries until then, under `initial`'s.
      const live = createLiveStyle({ registry: registryOf(runtime), onDroppedTransform: () => warnDroppedTransform(runtime, id), reactivity })
      const projectStarting = Bool.match(hydrating, { onTrue: () => DomRenderer.project, onFalse: () => runtime.runSync(Renderer.Renderer).project })
      const startingWith = (routed: Values.Values): Renderer.Patch => projectStarting(drawnAtRest({ ...routed, ...initialValues }, layoutNode))
      const elementStyle = createElementStyle({ userStyle, starting, startingWith, live, defaults: dragDefaults, reactivity })

      // The gate commits each frame onto the forwarded element (ADR-0034). The node wires
      // the variant orchestration (ADR-0007, #50) into the spine.
      // Just before the first commit the Starting style leaves `style`: Solid removes
      // those keys and the commit writes the first frame, with no paint in between. From
      // then on `style` gives up the keys the gate holds (ADR-0034).
      runSpine({
        runtime,
        gate,
        id,
        el,
        cfg,
        parent: node.inherited,
        extraDelay: node.extraDelay,
        byName: node.names,
        canStart: node.canStart,
        bindGestures: node.bindGestures,
        onFrame: node.onFrame,
        // The user's style is the style link of a key's Base value (ADR-0022).
        styleOf: userStyle,
        live,
        makeSink: (element) => ({ target: element, ...elementStyle.hooks }),
        hydrating,
      })

      // ADR-0008 ref-forwarding contract: if the component never forwarded its
      // ref, the spine has no element to drive. Fail loudly + actionably.
      onMount(() => {
        if (Predicate.isUndefined(el())) {
          const name = Wrapped.name || "anonymous component"
          throw new Error(
            `wardic.create(${name}): the wrapped component did not forward its ref. ` +
              "The component must forward props.ref to a single root DOM element " +
              "(e.g. <div ref={props.ref}>...</div>). Element-only motion is wired through the ref.",
          )
        }
      })

      // Merge the user's ref (if any) with the spine's setter so BOTH receive
      // the forwarded element. After the first commit, `style` is the user's style
      // (over the drag defaults) without the keys the gate holds: an object, never
      // `undefined`, which would make Solid remove the whole attribute, inline styles
      // Wardic didn't write included, and never CSS text, which Solid writes as
      // `cssText` over every inline key (ADR-0034).
      const userRef = (refStyle as { ref?: (el: HTMLElement) => void }).ref
      const style = (): JSX.CSSProperties => elementStyle.style(userStyle()) as JSX.CSSProperties
      const element = (): JSX.Element => (
        <Dynamic
          component={Wrapped}
          {...rest}
          ref={mergeRefs(userRef, setEl)}
          style={style()}
          draggable={UndefinedOr.map(dragDefaults, () => Style.DRAG_DEFAULT_ATTRIBUTES.draggable)}
        />
      )
      // A wrap that changes what the component's children read renders its variant context's
      // Provider around them (#50); any other renders none.
      return Bool.match(changesContext(config), {
        onFalse: element,
        onTrue: () => <WardicVariantContext.Provider value={node.provided}>{element()}</WardicVariantContext.Provider>,
      })
    }
  }

  const tag = arg
  return (props) => {
    // A server render takes the lean path (ADR-0021, decision 4).
    if (isServer) return serverElement(tag, props)

    // 3-way split: motion props (consumed, never leak), then ref+style (merged),
    // then everything else (rest) passes through to the DOM element.
    const [motion, refStyle, rest] = splitProps(props as WardicProps<keyof JSX.IntrinsicElements>, MOTION_PROPS, ["ref", "style"])

    // Reactive config accessor: motionToConfig reads each (reactive) prop getter
    // inside the accessor, so a changed `animate` / `whileHover` / `transition`
    // (a tracked expression) drives a Retarget. The tag lets an svg-inner element
    // render its Starting style's attribute keys as attributes (ADR-0021).
    const cfg = configOfMotion(motion)
    const ward = createWardWith(cfg, { tag })

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
    const userRef = (refStyle as { ref?: (el: HTMLElement) => void }).ref
    const userProps: WardUserProps = {
      ...UndefinedOr.match(userRef, { onUndefined: () => ({}), onDefined: (ref) => ({ ref }) }),
      get style() {
        return (refStyle as { style?: JSX.CSSProperties }).style
      },
    }

    // An element that changes what its children read renders its variant context's Provider
    // around them (#50); any other renders none (`changesContext`, decided once, as on a server).
    const element = (): JSX.Element => <Dynamic component={tag} {...rest} {...ward(userProps)} />
    return Bool.match(changesContext(untrack(cfg)), {
      onFalse: element,
      onTrue: () => <ward.Provider>{element()}</ward.Provider>,
    })
  }
}

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
 * `wardic.create(Component)` during a server render (ADR-0021, decisions 4 and 6): the
 * component with `style` = the user's style + the Starting style + the drag defaults (and
 * `draggable`), and nothing else. It keeps the client's `createUniqueId` call and its
 * `Dynamic` boundary, so the hydration keys match.
 */
const serverComponent = (Wrapped: Component<Record<string, unknown> & WardicWrappable>, props: Record<string, unknown>): JSX.Element => {
  // The client's gate id: keeps every later hydration key in step.
  createUniqueId()
  const out = passThrough(props)
  const config = motionToConfig(props as WardicMotionProps)()
  // The same variant context the client provides, read once (#50).
  const node = serverVariantNode(config, useVariantContext())
  const axis = dragAxisOf(config, undefined)
  const dragDefaults = UndefinedOr.map(axis, Style.dragDefaults)
  const initial = startingValuesOf(config, node.inherited, presenceBlocksInitial(usePresenceContext()), untrack)
  // Its routed `style` keys' values join the Starting style, under `initial`'s (#130).
  const parts = split(props.style as object | string | undefined)
  // Its Appear animation (#48, ADR-0044), unless its own style sets an `animation`.
  const appear = serverAppearOf(config, undefined, initial, node)
  const ownAnimation = setsAnimation(parts.css)
  if (ownAnimation) appear.veto("its own style sets an animation")
  override(out, {
    style: pipe(
      serverStartingStyle(undefined, Style.starting(undefined, drawnAtRest(initial, isLayoutNode(config))).style, initial, parts.routed, isLayoutNode(config), untrack),
      Style.over(parts.css),
      Style.over(dragDefaults),
      Style.over(Bool.match(ownAnimation, { onTrue: constUndefined, onFalse: () => appear.style })),
    ),
    ...UndefinedOr.match(dragDefaults, { onUndefined: () => ({}), onDefined: () => ({ draggable: Style.DRAG_DEFAULT_ATTRIBUTES.draggable }) }),
    ...UndefinedOr.match(props.ref, { onUndefined: () => ({}), onDefined: (ref) => ({ ref }) }),
    component: Wrapped,
  })
  // The client's nesting: the variant context's Provider when the wrap changes what its
  // children read (#50), then the component; a late chunk's root then its chunk's style (#245).
  const element = (): JSX.Element => createComponent(Dynamic, out as Parameters<typeof Dynamic>[0])
  return renderServerElement(appear, () =>
    Bool.match(changesContext(config), {
      onFalse: element,
      onTrue: () =>
        createComponent(WardicVariantContext.Provider, {
          value: appear.provided,
          get children() {
            return element()
          },
        }),
    }))
}

/**
 * `wardic.<tag>` during a server render (ADR-0021, decision 4): the element with its
 * Starting style and static attributes, built in one pass over the props. Solid's server
 * `splitProps` and `mergeProps` cost most of a wrapped element's server time, and none of
 * their reactivity matters there. The client's `createUniqueId` (inside `createWardWith`)
 * and its `Dynamic` boundary are kept, so every hydration key lands where the client's
 * render puts it.
 */
const serverElement = (tag: string, props: Record<string, unknown>): JSX.Element => {
  const out = passThrough(props)
  const cfg = motionToConfig(props as WardicMotionProps)
  const ward = createWardWith(cfg, { tag })
  override(out, { ...ward({ style: props.style as JSX.CSSProperties | undefined }), component: tag })
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
