/**
 * `wardic.create(tag)` HOC + the `wardic.*` motion-element proxy (ADR-0008,
 * Tier 1 headline surface).
 *
 * `wardic.create("div")` returns a Solid component that accepts the element's
 * own props PLUS Wardic's motion props (`initial` / `animate` / `whileHover` /
 * ...), wires them through {@link useWardic}, and renders the underlying element
 * with the user's props passed through. The flush gate commits each frame onto the
 * element (ADR-0034).
 *
 * `wardic.<tag>` (e.g. `wardic.div`, `wardic.button`) is a cached shorthand for
 * `wardic.create("<tag>")` — `wardic.div === wardic.div`.
 *
 * Locked merge policy (Option A) — the merge now lives in `ward()`
 * ({@link useWardic}); this HOC just forwards the user's `ref` + `style` into it:
 *   - Motion props are split off so none leak to the DOM (even ones not yet
 *     wired by {@link useWardic}).
 *   - The user's `ref` AND Wardic's ref are both invoked (via `mergeRefs`).
 *   - Wardic's keys win: the Starting style goes over the user's `style` until the first
 *     commit; from then on the user's `style` is the fallback, without the keys the
 *     gate holds, which Wardic writes onto the element (ADR-0034). A reactive user
 *     `style` re-runs the spread's `style`; a frame never does.
 *
 * SSR-correct: {@link useWardic} computes the Starting style synchronously, so the
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
import type * as Drag from "@wardic/core/Drag"
import * as Renderer from "@wardic/core/Renderer"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import * as Style from "@wardic/dom/Style"
import * as Bool from "effect/Boolean"
import { pipe } from "effect/Function"
import { type Accessor, type Component, createComponent, createSignal, createUniqueId, type JSX, onMount, splitProps, untrack } from "solid-js"
import { Dynamic } from "solid-js/web"
import { createElementStyle } from "./element-style.ts"
import { useWardicGate, useWardicRuntime } from "./provider.tsx"
import { isHydrating, isServer } from "./server.ts"
import {
  dragAxisOf,
  flagStartingStyle,
  runSpine,
  useWardicWith,
  type WardicConfig,
  type WardicDragTransition,
  type WardicTransition,
  type WardicValues,
  type WardUserProps,
} from "./use-wardic.tsx"
import { presenceBlocksInitial, usePresenceContext } from "./presence.tsx"
import { changesContext, createVariantNode, serverVariantNode, startingValuesOf } from "./variant-node.ts"
import { useVariantContext, WardicVariantContext } from "./variants.ts"

/**
 * Every motion prop the HOC consumes off the props object so it never leaks to
 * the DOM. A subset (`initial` / `animate` / `variants` / `whileHover` /
 * `whileTap` / `transition`) is wired into {@link useWardic} today; the rest
 * (`whileFocus` / `whileInView` / `exit` / `drag` / `dragConstraints` /
 * `layout` / `layoutId`) are accepted + split now but NOT yet wired (a
 * follow-up) — they are intentionally consumed so they don't render as DOM
 * attributes. Shared with `<Reorder>`'s item (internal, not a package export).
 */
export const MOTION_PROPS = [
  "initial",
  "animate",
  "variants",
  "inherit",
  "whileHover",
  "whileTap",
  "whileFocus",
  "whileInView",
  "exit",
  "drag",
  "whileDrag",
  "dragConstraints",
  "dragElastic",
  "dragMomentum",
  "dragSnapToOrigin",
  "dragTransition",
  "dragPropagation",
  "layout",
  "layoutDependency",
  "layoutId",
  "layoutScroll",
  "layoutRoot",
  "layoutAnchor",
  "onLayoutAnimationStart",
  "onLayoutAnimationComplete",
  "transition",
] as const

/**
 * The motion props a `wardic.*` element accepts, on top of the element's own
 * intrinsic props.
 *
 * REACTIVITY (step 21f): each field is a plain VALUE — the SAME static type as the
 * matching {@link WardicConfig} field, NO `MaybeAccessor`. Reactivity is supplied
 * by Solid's reactive prop getters, not by per-prop accessors: a `wardic.*`
 * element's props are getters, so reading `motion.animate` INSIDE the config
 * accessor {@link motionToConfig} builds tracks whatever signals back the prop.
 * Write a TRACKED EXPRESSION as the value (`animate={open() ? a : b}`), NOT a
 * function — passing `animate={() => ...}` is a type error here (props are values).
 */
export interface WardicMotionProps {
  /** The seed: a values map, a `variants` name, or `false` to start at `animate` with no mount animation (#134). */
  readonly initial?: WardicValues | string | false
  readonly animate?: WardicValues | string
  readonly variants?: Record<string, WardicValues>
  /** `false` keeps a `variants` element out of its ancestors' variants (#50, Motion's `inherit`). */
  readonly inherit?: boolean
  readonly whileHover?: WardicValues
  readonly whileTap?: WardicValues
  readonly transition?: WardicTransition
  /** Accepted + split now; not yet wired (follow-up). */
  readonly whileFocus?: WardicValues
  /** Accepted + split now; not yet wired (follow-up). */
  readonly whileInView?: WardicValues
  /**
   * The exit target — the state this element animates toward when it leaves an
   * `<AnimatePresence>` (ADR-0007). Wired through to the spine's presence
   * registration; the parent `<AnimatePresence>` drives the exit on leave.
   */
  readonly exit?: WardicValues
  /**
   * Enable dragging (ADR-0004). `true` = free; `"x"`/`"y"` = axis-locked. While
   * held (and during the release tail) the drag DIRECT-SETS `x`/`y` (1:1 with the
   * pointer); the spring keeps driving every other key + {@link whileDrag}. The
   * element gets Motion's drag defaults (`touch-action` for its axis, no text
   * selection, `draggable="false"`; ADR-0019 *Amendment (Reorder)*), which its own
   * `style` overrides.
   */
  readonly drag?: boolean | "x" | "y"
  /**
   * Target merged in (highest priority) while dragging. Driven by the spring (NOT
   * stripped) so e.g. `scale: 1.1` animates while held and returns after release.
   */
  readonly whileDrag?: WardicValues
  /**
   * Constrain the element's `x`/`y` to a static numeric box (per axis), whichever gesture moved it
   * there; a Fling springs back to an edge it would cross. Only when `drag` is on.
   */
  readonly dragConstraints?: Drag.Bounds
  /** Rubber-band resistance past {@link dragConstraints}: 0 a hard clamp, with a wall for a bounce. Default 0.35. */
  readonly dragElastic?: number
  /** Fling on release (default `true`); `false` releases with no velocity. Only when `drag` is on. */
  readonly dragMomentum?: boolean
  /** Spring `x`/`y` back to the origin on release, on {@link dragTransition}. Only when `drag` is on. */
  readonly dragSnapToOrigin?: boolean
  /**
   * What the release runs on (Motion's `dragTransition`): Motion's inertia, its options over
   * Motion's defaults, `timeConstant` in milliseconds. Only when `drag` is on.
   */
  readonly dragTransition?: WardicDragTransition
  /**
   * `true`: the drag takes no Drag claim, so a draggable ancestor drags with it (Motion's
   * `dragPropagation`). Only when `drag` is on.
   */
  readonly dragPropagation?: boolean
  /**
   * Enable layout FLIP (ADR-0005). Under a `<LayoutGroup>` sibling reflow is
   * animated too; standalone, only this element's own size/`layoutDependency`
   * change is observed. Read once, at mount; a **Layout mode** (`"position"`, `"size"`,
   * `"x"`, `"y"`, `"preserve-aspect"`; ADR-0009, *Amendment (#42)*) animates part of the
   * change, read at each layout animation's start.
   */
  readonly layout?: boolean | "position" | "size" | "preserve-aspect" | "x" | "y"
  /**
   * A value/signal whose change re-measures this element and plays a FLIP
   * (framer-motion's prop name + semantics). Only consulted when `layout` is on.
   */
  readonly layoutDependency?: unknown
  /**
   * Shared-element (cross-element) FLIP key (ADR-0005, framer-motion `layoutId`
   * parity). An element entering with the same `layoutId` a prior element left
   * animates FROM that prior element's box. Works with NO `<LayoutGroup>` — the
   * registry is provided at the `WardicProvider` root by default. Composes with
   * `layout`/`layoutDependency` and `animate` (FLIP keys merge + project once).
   */
  readonly layoutId?: string
  /** Scroll container (ADR-0012): its scroll is folded out of descendants' layout animations. */
  readonly layoutScroll?: boolean
  /** Stable projection sub-root (ADR-0013): self-snaps, bounds its subtree, persistent relative anchor. */
  readonly layoutRoot?: boolean
  /**
   * Relative-projection anchor (ADR-0013): where in its relativeParent this element
   * anchors (0–1 per axis, default top-left). `false` forces absolute projection.
   */
  readonly layoutAnchor?: { readonly x: number; readonly y: number } | false
  /**
   * Called when a layout animation of this element starts (#191, ADR-0039, Motion's prop): at the
   * frame where it takes its first step, after that frame is painted. A restart fires it again;
   * restarts in one task are one. A handover's is the new Lead's. No call when nothing animates (a
   * `layoutRoot`'s snap, a Layout mode with nothing to move). Read when it fires.
   */
  readonly onLayoutAnimationStart?: () => void
  /**
   * Called when a layout animation of this element lands on its own (#191, ADR-0039, Motion's prop):
   * at the frame it lands. Not for one a restart interrupted, a window resize finished early, or an
   * unmount cut off, so a start isn't always followed by a complete; `animateLayout`'s `onSettled`
   * reports a change's end however it went. Read when it fires.
   */
  readonly onLayoutAnimationComplete?: () => void
}

/** Props for a `wardic.<tag>` element: the tag's intrinsic props + motion props. */
export type WardicProps<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & WardicMotionProps

/**
 * Build a reactive `Accessor<WardicConfig>` from a split-off `motion` props
 * object (step 21f — the reactivity boundary).
 *
 * Each motion prop is a plain VALUE (the same static type as the matching
 * {@link WardicConfig} field). The returned accessor reads each prop DIRECTLY off
 * the `motion` object inside the accessor body. Because `motion` is a Solid
 * split-props object whose fields are reactive getters, reading `motion.animate`
 * here subscribes to whatever signal backs the prop — so a tracked expression
 * (`animate={open() ? a : b}`) re-runs this config accessor on a flip and drives a
 * Retarget. NO `access()`/unwrapping: Solid's prop getters already do the tracking.
 *
 * Keys are only assigned when the value is defined — exactOptionalPropertyTypes
 * forbids an explicit `undefined` on the optional config fields, and an absent key
 * is exactly how the hook reads "no field".
 */
export const motionToConfig =
  (motion: WardicMotionProps): Accessor<WardicConfig> =>
  () => {
    const config: { -readonly [K in keyof WardicConfig]: WardicConfig[K] } = {}
    // Read each (reactive) prop getter inside the accessor so it tracks.
    const initial = motion.initial
    const animate = motion.animate
    const whileHover = motion.whileHover
    const whileTap = motion.whileTap
    const transition = motion.transition
    const variants = motion.variants
    const inherit = motion.inherit
    const exit = motion.exit
    const drag = motion.drag
    const whileDrag = motion.whileDrag
    const dragConstraints = motion.dragConstraints
    const dragElastic = motion.dragElastic
    const dragMomentum = motion.dragMomentum
    const dragSnapToOrigin = motion.dragSnapToOrigin
    const dragTransition = motion.dragTransition
    const dragPropagation = motion.dragPropagation
    const layout = motion.layout
    const layoutDependency = motion.layoutDependency
    const layoutId = motion.layoutId
    const layoutScroll = motion.layoutScroll
    const layoutRoot = motion.layoutRoot
    const layoutAnchor = motion.layoutAnchor
    const onLayoutAnimationStart = motion.onLayoutAnimationStart
    const onLayoutAnimationComplete = motion.onLayoutAnimationComplete
    if (initial !== undefined) config.initial = initial
    if (animate !== undefined) config.animate = animate
    if (whileHover !== undefined) config.whileHover = whileHover
    if (whileTap !== undefined) config.whileTap = whileTap
    if (transition !== undefined) config.transition = transition
    if (variants !== undefined) config.variants = variants
    if (inherit !== undefined) config.inherit = inherit
    if (exit !== undefined) config.exit = exit
    if (drag !== undefined) config.drag = drag
    if (whileDrag !== undefined) config.whileDrag = whileDrag
    if (dragConstraints !== undefined) config.dragConstraints = dragConstraints
    if (dragElastic !== undefined) config.dragElastic = dragElastic
    if (dragMomentum !== undefined) config.dragMomentum = dragMomentum
    if (dragSnapToOrigin !== undefined) config.dragSnapToOrigin = dragSnapToOrigin
    if (dragTransition !== undefined) config.dragTransition = dragTransition
    if (dragPropagation !== undefined) config.dragPropagation = dragPropagation
    if (layout !== undefined) config.layout = layout
    if (layoutDependency !== undefined) config.layoutDependency = layoutDependency
    if (layoutId !== undefined) config.layoutId = layoutId
    if (layoutScroll !== undefined) config.layoutScroll = layoutScroll
    if (layoutRoot !== undefined) config.layoutRoot = layoutRoot
    if (layoutAnchor !== undefined) config.layoutAnchor = layoutAnchor
    if (onLayoutAnimationStart !== undefined) config.onLayoutAnimationStart = onLayoutAnimationStart
    if (onLayoutAnimationComplete !== undefined) config.onLayoutAnimationComplete = onLayoutAnimationComplete
    return config
  }

/**
 * The shape `wardic.create(Component)` requires of a wrapped component: it must
 * forward `props.ref` to its single root DOM element so the spine can wire up
 * (ADR-0008's ref-forwarding contract). All motion is committed through that
 * ref, so the wrapped component owns its own root JSX.
 */
export type WardicWrappable = { ref?: (el: HTMLElement) => void }

/**
 * `wardic.create(tag | Component)` — build a motion component.
 *
 * Two paths:
 *   - `create("div")` (element-string): renders `<Dynamic component={tag}>` through
 *     {@link useWardic} — SSR-correct, the Starting style is computed synchronously
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
  if (typeof arg !== "string") {
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
      const cfg = motionToConfig(motion)
      // Its place in variant orchestration (ADR-0007, #50): the context it hands the
      // component's children, and, as a Variant child, the ancestor it inherits from and joins.
      const node = createVariantNode(cfg, useVariantContext())

      // The Starting style, the drag defaults, and whether the first frame has been
      // committed: until then `style` carries the Starting style, so a component that
      // applies it renders it on a server, while hydrating and before the first frame.
      // While hydrating it's what the server rendered, the DOM's project (the Hydration
      // hold, ADR-0021 decision 2); otherwise the Environment's Renderer's.
      const config = untrack(cfg)
      const initialValues = startingValuesOf(config, node.inherited, presenceBlocksInitial(usePresenceContext()))
      const projected = runtime.runSync(Renderer.Renderer).project(initialValues)
      const hydrating = isHydrating()
      const starting = hydrating ? DomRenderer.project(initialValues) : projected
      if (hydrating) flagStartingStyle(runtime, id, starting, projected)
      const axis = dragAxisOf(config, undefined)
      const dragDefaults = axis !== undefined ? Style.dragDefaults(axis) : undefined
      const userStyle = (): JSX.CSSProperties | string | undefined => (refStyle as { style?: JSX.CSSProperties | string }).style
      const elementStyle = createElementStyle({ userStyle, starting, defaults: dragDefaults })

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
        canStart: node.canStart,
        onFrame: node.onFrame,
        // The user's style is the style link of a key's Base value (ADR-0022).
        styleOf: userStyle,
        makeSink: (element) => ({ target: element, ...elementStyle.hooks }),
      })

      // ADR-0008 ref-forwarding contract: if the component never forwarded its
      // ref, the spine has no element to drive. Fail loudly + actionably.
      onMount(() => {
        if (el() === undefined) {
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
      const style = (): JSX.CSSProperties => elementStyle.style(userStyle())
      const element = (): JSX.Element => (
        <Dynamic
          component={Wrapped}
          {...rest}
          ref={mergeRefs(userRef, setEl)}
          style={style()}
          draggable={dragDefaults !== undefined ? Style.DRAG_DEFAULT_ATTRIBUTES.draggable : undefined}
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
    const cfg = motionToConfig(motion)
    const ward = useWardicWith(cfg, { tag })

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
      ...(userRef !== undefined ? { ref: userRef } : {}),
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
const override = (out: Record<string, unknown>, values: Record<string, unknown>): void => {
  for (const key in values) Object.defineProperty(out, key, { value: values[key], enumerable: true, configurable: true, writable: true })
}

/** Everything in `props` but the motion props, `ref` and `style`, in one pass; getters stay getters. */
const passThrough = (props: Record<string, unknown>): Record<string, unknown> => {
  const descriptors = Object.getOwnPropertyDescriptors(props)
  const out: Record<string, unknown> = {}
  for (const key in descriptors) {
    if (MOTION_KEYS.has(key) || key === "ref" || key === "style") continue
    Object.defineProperty(out, key, descriptors[key]!)
  }
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
  const dragDefaults = axis !== undefined ? Style.dragDefaults(axis) : undefined
  const initial = startingValuesOf(config, node.inherited, presenceBlocksInitial(usePresenceContext()))
  override(out, {
    style: pipe(Style.starting(undefined, initial).style, Style.over(props.style as JSX.CSSProperties | string | undefined), Style.over(dragDefaults)),
    ...(dragDefaults !== undefined ? { draggable: Style.DRAG_DEFAULT_ATTRIBUTES.draggable } : {}),
    ...(props.ref !== undefined ? { ref: props.ref } : {}),
    component: Wrapped,
  })
  // The client's nesting: the variant context's Provider when the wrap changes what its
  // children read (#50), then the component.
  const element = (): JSX.Element => createComponent(Dynamic, out as Parameters<typeof Dynamic>[0])
  return Bool.match(changesContext(config), {
    onFalse: element,
    onTrue: () =>
      createComponent(WardicVariantContext.Provider, {
        value: node.provided,
        get children() {
          return element()
        },
      }),
  })
}

/**
 * `wardic.<tag>` during a server render (ADR-0021, decision 4): the element with its
 * Starting style and static attributes, built in one pass over the props. Solid's server
 * `splitProps` and `mergeProps` cost most of a wrapped element's server time, and none of
 * their reactivity matters there. The client's `createUniqueId` (inside `useWardicWith`)
 * and its `Dynamic` boundary are kept, so every hydration key lands where the client's
 * render puts it.
 */
const serverElement = (tag: string, props: Record<string, unknown>): JSX.Element => {
  const out = passThrough(props)
  const cfg = motionToConfig(props as WardicMotionProps)
  const ward = useWardicWith(cfg, { tag })
  override(out, { ...ward({ style: props.style as JSX.CSSProperties | undefined }), component: tag })
  // The client's nesting: the element's `ward.Provider` when it changes what its children read
  // (#50), then the element.
  const element = (): JSX.Element => createComponent(Dynamic, out as Parameters<typeof Dynamic>[0])
  return Bool.match(changesContext(cfg()), {
    onFalse: element,
    onTrue: () =>
      createComponent(ward.Provider, {
        get children() {
          return element()
        },
      }),
  })
}

/**
 * The typed `wardic` proxy: `wardic.create` is the HOC, and `wardic.<tag>` is a
 * motion component for that intrinsic element (cached per tag).
 */
export type Wardic = {
  readonly create: typeof create
} & {
  readonly [Tag in keyof JSX.IntrinsicElements]: Component<WardicProps<Tag>>
}

/**
 * `wardic` — the motion-element proxy (ADR-0008 Tier 1).
 *
 *   - `wardic.create(tag)` -> the HOC above.
 *   - `wardic.<tag>` (string key) -> `create(tag)`, CACHED so `wardic.div ===
 *     wardic.div` (stable component identity across reads).
 *   - any non-string/symbol key -> `undefined`.
 */
const cache = new Map<string, Component<WardicProps<keyof JSX.IntrinsicElements>>>()

export const wardic: Wardic = new Proxy({ create } as Wardic, {
  get(target, prop) {
    if (prop === "create") return target.create
    if (typeof prop === "string") {
      let c = cache.get(prop)
      if (c === undefined) {
        c = create(prop)
        cache.set(prop, c)
      }
      return c
    }
    return undefined
  },
}) as Wardic
