/**
 * `wardic.create(tag)` HOC + the `wardic.*` motion-element proxy (ADR-0008,
 * Tier 1 headline surface).
 *
 * `wardic.create("div")` returns a Solid component that accepts the element's
 * own props PLUS Wardic's motion props (`initial` / `animate` / `whileHover` /
 * ...), wires them through {@link useWardic}, and renders the underlying element
 * with the user's props passed through and Wardic's animated style merged on top.
 *
 * `wardic.<tag>` (e.g. `wardic.div`, `wardic.button`) is a cached shorthand for
 * `wardic.create("<tag>")` — `wardic.div === wardic.div`.
 *
 * Locked merge policy (Option A) — the merge now lives in `ward()`
 * ({@link useWardic}); this HOC just forwards the user's `ref` + `style` into it:
 *   - Motion props are split off so none leak to the DOM (even ones not yet
 *     wired by {@link useWardic}).
 *   - The user's `ref` AND Wardic's ref are both invoked (via `mergeRefs`).
 *   - The user's static `style` is the base; Wardic's animated style is merged
 *     ON TOP (animated keys win, other user keys preserved). Reactive: the
 *     spread `{...ward(...)}` re-runs as Wardic's style signal changes.
 *
 * SSR-correct: {@link useWardic} seeds the initial style synchronously, so the
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
import type { DragBounds } from "@wardic/core"
import { type Accessor, type Component, createSignal, createUniqueId, type JSX, onMount, splitProps } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useWardicGate, useWardicRuntime } from "./provider.tsx"
import {
  runSpine,
  useWardic,
  type WardicConfig,
  type WardicTransition,
  type WardicValues,
  type WardUserProps,
} from "./use-wardic.tsx"
import { useVariantContext } from "./variants.ts"

/**
 * Every motion prop the HOC consumes off the props object so it never leaks to
 * the DOM. A subset (`initial` / `animate` / `variants` / `whileHover` /
 * `whileTap` / `transition`) is wired into {@link useWardic} today; the rest
 * (`whileFocus` / `whileInView` / `exit` / `drag` / `dragConstraints` /
 * `layout` / `layoutId`) are accepted + split now but NOT yet wired (a
 * follow-up) — they are intentionally consumed so they don't render as DOM
 * attributes.
 */
const MOTION_PROPS = [
  "initial",
  "animate",
  "variants",
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
  "layout",
  "layoutDependency",
  "layoutId",
  "layoutScroll",
  "layoutRoot",
  "layoutAnchor",
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
  readonly initial?: WardicValues | string
  readonly animate?: WardicValues | string
  readonly variants?: Record<string, WardicValues>
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
   * pointer); the spring keeps driving every other key + {@link whileDrag}.
   */
  readonly drag?: boolean | "x" | "y"
  /**
   * Target merged in (highest priority) while dragging. Driven by the spring (NOT
   * stripped) so e.g. `scale: 1.1` animates while held and returns after release.
   */
  readonly whileDrag?: WardicValues
  /** Constrain the drag to a static numeric box (per axis). Only when `drag` is on. */
  readonly dragConstraints?: DragBounds
  /** Rubber-band resistance past {@link dragConstraints} (0 = hard clamp, default). */
  readonly dragElastic?: number
  /** Fling on release under decay (default `true`). Only when `drag` is on. */
  readonly dragMomentum?: boolean
  /** Spring `x`/`y` back to the origin on release (overrides momentum). Only when `drag` is on. */
  readonly dragSnapToOrigin?: boolean
  /**
   * Enable layout FLIP (ADR-0005). Under a `<LayoutGroup>` sibling reflow is
   * animated too; standalone, only this element's own size/`layoutDependency`
   * change is observed. Static field — a plain boolean.
   */
  readonly layout?: boolean
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
  /**
   * PLANNED — requires the parent-relative projection tree (a future phase);
   * currently a NO-OP. Reserved for Motion-parity API shape.
   */
  readonly layoutScroll?: boolean
  /**
   * PLANNED — requires the parent-relative projection tree (a future phase);
   * currently a NO-OP. Reserved for Motion-parity API shape.
   */
  readonly layoutRoot?: boolean
  /**
   * PLANNED — requires the parent-relative projection tree (a future phase);
   * currently a NO-OP. Reserved for Motion-parity API shape.
   */
  readonly layoutAnchor?: { readonly x: number; readonly y: number }
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
const motionToConfig =
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
    const exit = motion.exit
    const drag = motion.drag
    const whileDrag = motion.whileDrag
    const dragConstraints = motion.dragConstraints
    const dragElastic = motion.dragElastic
    const dragMomentum = motion.dragMomentum
    const dragSnapToOrigin = motion.dragSnapToOrigin
    const layout = motion.layout
    const layoutDependency = motion.layoutDependency
    const layoutId = motion.layoutId
    if (initial !== undefined) config.initial = initial
    if (animate !== undefined) config.animate = animate
    if (whileHover !== undefined) config.whileHover = whileHover
    if (whileTap !== undefined) config.whileTap = whileTap
    if (transition !== undefined) config.transition = transition
    if (variants !== undefined) config.variants = variants
    if (exit !== undefined) config.exit = exit
    if (drag !== undefined) config.drag = drag
    if (whileDrag !== undefined) config.whileDrag = whileDrag
    if (dragConstraints !== undefined) config.dragConstraints = dragConstraints
    if (dragElastic !== undefined) config.dragElastic = dragElastic
    if (dragMomentum !== undefined) config.dragMomentum = dragMomentum
    if (dragSnapToOrigin !== undefined) config.dragSnapToOrigin = dragSnapToOrigin
    if (layout !== undefined) config.layout = layout
    if (layoutDependency !== undefined) config.layoutDependency = layoutDependency
    if (layoutId !== undefined) config.layoutId = layoutId
    // layoutScroll / layoutRoot / layoutAnchor are PLANNED no-ops: split off the
    // MOTION_PROPS so they never leak to the DOM, but not forwarded to config
    // (they have no spine effect yet — a future projection-tree phase).
    return config
  }

/**
 * The shape `wardic.create(Component)` requires of a wrapped component: it must
 * forward `props.ref` to its single root DOM element so the spine can wire up
 * (ADR-0008's ref-forwarding contract). All motion is delivered through that
 * ref (a commit sink), so the wrapped component owns its own root JSX.
 */
export type WardicWrappable = { ref?: (el: HTMLElement) => void }

/**
 * `wardic.create(tag | Component)` — build a motion component.
 *
 * Two paths:
 *   - `create("div")` (element-string): renders `<Dynamic component={tag}>` with
 *     a SIGNAL sink ({@link useWardic}) — SSR-correct, the initial style is
 *     seeded synchronously on the very first render.
 *   - `create(Component)` (a component function): the wrapped component must
 *     forward `props.ref` to its single root element. Motion is driven through a
 *     COMMIT sink ({@link runSpine}) writing onto that forwarded element. Because
 *     the commit happens post-mount via the ref, this path FORFEITS SSR-correct
 *     `initial` (the first frame may flash) — consistent with ADR-0003's
 *     post-mount boundary. Use the element-string path for SSR-correct initial.
 *
 * @param arg an element tag string (e.g. `"div"`) OR a component forwarding `ref`.
 * @returns a Solid component accepting the element's / component's props + motion props.
 */
export function create<Tag extends keyof JSX.IntrinsicElements>(tag: Tag): Component<WardicProps<Tag>>
export function create<P>(component: Component<P & WardicWrappable>): Component<P & WardicMotionProps>
export function create(tag: string): Component<WardicProps<keyof JSX.IntrinsicElements>>
export function create(arg: string | Component<Record<string, unknown> & WardicWrappable>): Component<Record<string, unknown>> {
  // Component path (non-string arg): drive the forwarded element via a commit
  // sink (ADR-0008 + ADR-0006). The wrapped component owns its root JSX, so
  // there is NO style prop — the gate commits the projected Patch onto the
  // element the component forwards its `ref` to.
  if (typeof arg !== "string") {
    const Wrapped = arg
    return (props) => {
      // Split motion props (consumed, never forwarded) and the user's ref (merged
      // with the spine's setter); everything else passes through to the component.
      const [motion, refRest, rest] = splitProps(props as Record<string, unknown> & WardicMotionProps & WardicWrappable, MOTION_PROPS, ["ref"])

      const runtime = useWardicRuntime()
      const gate = useWardicGate()
      const id = createUniqueId()
      const [el, setEl] = createSignal<HTMLElement>()

      // Reactive config accessor from the motion props (tracks changes ->
      // Retarget). motionToConfig reads each prop getter inside its accessor.
      const cfg = motionToConfig(motion)

      // COMMIT sink: the gate runs Renderer.commit(target, patch) on the
      // provider runtime, driving the forwarded element directly each frame.
      // `parent` wires variant-name inheritance (ADR-0007) into the base target.
      runSpine({
        runtime,
        gate,
        id,
        el,
        cfg,
        parent: useVariantContext(),
        makeSink: (element) => ({ kind: "commit", target: element }),
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
      // the forwarded element. NO style prop — the commit sink drives it.
      const userRef = (refRest as { ref?: (el: HTMLElement) => void }).ref
      return <Dynamic component={Wrapped} {...rest} ref={mergeRefs(userRef, setEl)} />
    }
  }

  const tag = arg
  return (props) => {
    // 3-way split: motion props (consumed, never leak), then ref+style (merged),
    // then everything else (rest) passes through to the DOM element.
    const [motion, refStyle, rest] = splitProps(props as WardicProps<keyof JSX.IntrinsicElements>, MOTION_PROPS, ["ref", "style"])

    // Reactive config accessor: motionToConfig reads each (reactive) prop getter
    // inside the accessor, so a changed `animate` / `whileHover` / `transition`
    // (a tracked expression) drives a Retarget.
    const ward = useWardic(motionToConfig(motion))

    // Delegate the ref + style merge entirely to ward(): it invokes both the
    // user's ref and ward's internal ref, and merges the user's style with ward's
    // animated style (animated keys win — Option A).
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

    return <Dynamic component={tag} {...rest} {...ward(userProps)} />
  }
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
