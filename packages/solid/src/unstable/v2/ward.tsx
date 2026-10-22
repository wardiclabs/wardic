/**
 * `ward(config)`: a **Ward** on Solid 2 (`@wardic/solid/unstable/v2`, #209, ADR-0045). It puts one
 * element's motion on the Solid 1 binding's spine (`../../spine.ts`): the same Override stack,
 * Retarget, Base values and flush gate (ADR-0005, ADR-0022, ADR-0034), wired into Solid 2.
 *
 * A ward is a ref that carries its props:
 *
 * ```tsx
 * const card = ward(() => ({ animate: { x: open() ? 100 : 0 } }))  // in the component's body
 * <div {...card} />                                                // its Starting style in server HTML
 * <div ref={ward({ animate: { opacity: 1 } })} />                  // client-only: no Starting style
 * ```
 *
 * - **It's made once per element, then spread**: in a component's body, a `<For>` callback, a root.
 *   Solid 2 runs a spread's expression again on every run of the element's props, so
 *   `{...ward(config)}` makes a new ward for the same element each time: the second one to mount
 *   it throws, naming the fix. A `ref`'s expression is run with the element's, so
 *   `ref={ward(config)}` is fine inline.
 * - **Its props are its own keys.** `ref` (the ward), `style` (a getter) and the Starting style's
 *   attributes are enumerable, so a spread applies them; `Provider`, `read` and `atom` aren't.
 *   Solid 2's `merge` reads a function source through a memo, calling it with its previous value,
 *   so a ward called with anything but an element returns itself.
 * - **Its config is read once**, or through an accessor (or getters, as a component's props are):
 *   `ward(() => ({ … }))` for one that changes.
 * - **It mounts in an effect.** Every primitive is made at setup, under the ward's owner. The ref,
 *   called during render, sets the element; an effect's apply mounts it (registers it with the
 *   gate, builds its spine) and Retargets on each change of its target or of its `when` gate.
 *   Solid 2's apply has no owner, so what a mount makes (a Live value's watch) is made under the
 *   ward's.
 * - **Its target is compared by value** (`sameResolution`): a `style` or `transition` change in its
 *   config doesn't Retarget, as Motion's doesn't; a new variant name does.
 * - **Presence and layout** (PR 2 of #209): under an `<AnimatePresence>` the mount registers its exit
 *   record, kept current from its config's `exit`; a `layout`, `layoutId`, `layoutScroll` or
 *   `layoutRoot` element registers one projection node (`layout-member.ts`), re-measured when its
 *   `layoutDependency` changes. A layout node's Starting style is drawn through its projection at
 *   rest, as its first commit draws it (#245).
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import * as Recognizer from "@wardic/core/Recognizer"
import * as Renderer from "@wardic/core/Renderer"
import type * as Values from "@wardic/core/Values"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Style from "@wardic/dom/Style"
import * as Svg from "@wardic/dom/Svg"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { constFalse, constUndefined, identity, pipe } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import { Atom } from "effect/reactivity"
import { isServer, type JSX, useHead } from "@solidjs/web"
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  getOwner,
  isHydrating,
  onCleanup,
  runWithOwner,
  untrack,
} from "solid-js"
import type { WardConfig as SharedWardConfig, WardicValues } from "../../config.ts"
import { MOTION_PROPS_V2, type SolidOneCallback } from "../../motion-props.ts"
import { trackConstraintsOf } from "../../drag-constraints.ts"
import { inViewOptionsOf } from "../../gesture-callbacks.ts"
import { driveDragTrack } from "../../drag-track.ts"
import { reported, type WardicServices } from "../../runtime.ts"
import type { WardKey, WardValueOf } from "../../ward-keys.ts"
import { createElementStyle } from "../../element-style.ts"
import { createLiveStyle, type LiveSource, readLive, serverRegistryOf, split } from "../../live-style.ts"
import { dragTransitionOf } from "../../drag-transition.ts"
import { layoutOptionsOf, registrationOf, wantsLayoutNode } from "../../layout-member.ts"
import { presenceBlocksInitial, presenceHold, presenceSeedOf } from "../../presence-record.ts"
import { handoffOf, setsAnimation } from "../../appear.ts"
import {
  appearEntryOf,
  applyDragDefaults,
  dragAxisOf,
  drawnAtRest,
  type ElementSpine,
  flagStartingStyle,
  isLayoutNode,
  makeElementSpine,
  makeReuse,
  exitConfigOf,
  exitTargetOf,
  presenceTreeOf,
  NO_EXIT_CONFIG,
  madeWith,
  presenceRecordOf,
  recordFrameOf,
  registryOf,
  releasingAppear,
  type Resolution,
  resolutionOf,
  restingOf,
  sameResolution,
  serverStartingStyle,
  snapshotOf,
  startLinksOf,
  startOf,
  warnDroppedTransform,
  withOnUpdate,
} from "../../spine.ts"
import { serverVariantNode, type WardicVariantContextValue } from "../../variant-tree.ts"
import { followAtom } from "./bridge.ts"
import {
  appearStyle,
  useWardicAppear,
  useWardicGate,
  useWardicPositionalKeys,
  useWardicProjection,
  useWardicReducedMotion,
  useWardicRuntime,
} from "./provider.tsx"
import { CLIENT_ONLY, CLIENT_ONLY_DEFERRED, reactivityIn } from "./solid-reactivity.ts"
import { configView, type Fixed, type PerKey } from "./config-view.ts"
import { Lifecycle, type WardEvent, type WardEvents, type WardSettled } from "./lifecycle.ts"
import { usePresenceContext } from "./presence.tsx"
import { createVariantNode, useVariantContext, WardicVariantContext } from "./variant-node.ts"

/**
 * A Wardic element's `style` (#130, ADR-0043): every CSS property and the transform keys (`x`,
 * `scale`, `rotate`…), each a value or a **Live value**: an `effect/reactivity` Atom, or an
 * accessor, uncalled (a signal, a memo, a ward's `read(key)`). A called value is a resting value:
 * the element shows it at rest, and a return goes to where it is then. A Live value reading
 * `undefined` (a ward's `read(key)` for a key with no value) leaves the key where it is.
 */
export type WardStyle = { readonly [K in keyof WardicValues]?: WardicValues[K] | LiveSource<number | string | undefined> | undefined }

/** A ward's config values (ADR-0042): the element's motion, and its `style`. */
export interface WardConfigValues extends Omit<SharedWardConfig, SolidOneCallback> {
  /**
   * The element's style: Wardic's animated keys go over it, and a key no layer of the Override
   * stack sets returns to it (ADR-0022). Its Live values are followed through the gate (#130).
   */
  readonly style?: WardStyle | string | undefined
}

/**
 * The config keys whose values are functions: read as they are, never called as accessors (#259).
 * `dragConstraints`' function is its container's accessor (#273), read at each measure.
 */
type WardCallbackKey = "onUpdate" | "dragConstraints" | "onMeasureDragConstraints"

/**
 * A ward's config (ADR-0042, #259): each key a value, or an accessor of it, read per key. A getter,
 * a store's property or a component's prop is tracked as it's read, and an accessor is called as
 * it's read, so a change re-runs only what reads that key; a plain value is a constant. `initial`,
 * `drag` and its settings, and `layout` and the rest of its keys are read once, at setup.
 */
export type WardConfig = PerKey<WardConfigValues, WardCallbackKey>

/** Every key a ward reads, its callbacks among them. */
const WARD_KEYS = [
  "initial",
  "animate",
  "variants",
  "custom",
  "inherit",
  "whileHover",
  "whileTap",
  "whileInView",
  "whileFocus",
  "viewport",
  "drag",
  "whileDrag",
  "dragConstraints",
  "dragElastic",
  "dragMomentum",
  "dragSnapToOrigin",
  "dragTransition",
  "dragPropagation",
  "dragDirectionLock",
  "onMeasureDragConstraints",
  "transition",
  "exit",
  "layout",
  "layoutDependency",
  "layoutId",
  "layoutScroll",
  "layoutRoot",
  "layoutAnchor",
  "onUpdate",
  "appear",
  "style",
  "key",
] as const satisfies ReadonlyArray<keyof WardConfigValues>
/** Types only: a key `WardConfigValues` gains and {@link WARD_KEYS} misses fails here. */
type UnreadKey = Exclude<keyof WardConfigValues, (typeof WARD_KEYS)[number]>
const everyKeyRead: [UnreadKey] extends [never] ? true : UnreadKey = true
void everyKeyRead
/**
 * Types only: a Solid 2 motion prop no ward key reads fails here (#273: `whileInView` and
 * `whileFocus` were split off the element and dropped).
 */
type UnreadProp = Exclude<(typeof MOTION_PROPS_V2)[number], (typeof WARD_KEYS)[number]>
const everyPropRead: [UnreadProp] extends [never] ? true : UnreadProp = true
void everyPropRead

/** A ward's config read per key (#259). */
const WARD_VIEW = configView<WardConfigValues>(WARD_KEYS, ["onUpdate", "dragConstraints", "onMeasureDragConstraints"])

/** `config` read per key (#259), for a read outside a ward: a `wardic.<tag>`'s props at setup. Internal. */
export const wardConfigView = (config: WardConfig): WardConfigValues => WARD_VIEW.of(config)

/** A config given whole as an accessor, which the Solid 2 binding no longer reads (#259). */
const WHOLE_ACCESSOR =
  "ward(config) takes its config as an object, read per key (#259): make a key reactive with an accessor " +
  "(`ward({ animate: () => ({ x: x() }) })`), a getter, a store or a component's props, not the whole config " +
  "(`ward(() => ({ … }))`)."

/**
 * {@link Ward.read} (#209 PR 3's Q4): completion offers the keys its config animates, and any other
 * key is accepted; a transform key reads a number, any other the type its config gives it.
 */
export interface WardRead<C> {
  <K extends WardKey<C>>(key: K): Accessor<WardValueOf<C, K & string>>
}

/** The props a spread of a {@link Ward} applies. */
export interface WardProps {
  /** The ward: Solid calls it with the element. */
  readonly ref: (element: HTMLElement) => void
  /**
   * The element's style: the Starting style over the config's `style` until the gate's first
   * commit, then the config's `style` without the keys the gate holds (ADR-0034). Never per frame.
   */
  readonly style: JSX.CSSProperties
}

/**
 * One element's motion binding: a ref carrying its props (see the module). Spread it, or give it
 * to `ref` (alone, or in an array with your own).
 */
export interface Ward<C extends WardConfig = WardConfig> extends WardProps {
  /** Mounts the ward on `element`: Solid calls it as a ref. */
  (element: HTMLElement): void
  /** The ward itself, as a spread's `merge` reads it. */
  (previous?: unknown): Ward<C>
  /**
   * Hands this element's variant context to the subtree (ADR-0007, #50): its Variant children
   * inherit its variant name and transition, and join its stagger and `when`.
   */
  readonly Provider: (props: { readonly children?: JSX.Element }) => JSX.Element
  /**
   * The element's value for `key`, as an accessor (#130, ADR-0043 decision 5): what Wardic shows
   * for it, whoever moves it, as a number for a transform key (`x`, not its `transform`). At rest
   * outside the gate, its `initial`, else its `style` value, else a transform key's identity. One
   * accessor a key, made at the first ask. Read, not `value` (the Solid 1 ward's name): a spread
   * would give it to `<li>`'s and `<input>`'s `value`. Its keys are typed from the config.
   */
  readonly read: WardRead<C>
  /** The element's value for `key` as an `effect/reactivity` Atom, `undefined` while the gate doesn't hold the key. */
  readonly atom: <K extends WardKey<C>>(key: K) => Atom.Atom<WardValueOf<C, K & string> | undefined>
  /**
   * The element's last landing (#257, ADR-0046), as an async value: `undefined` before the first,
   * ready from its first read, and pending while a Retarget runs, keeping the last landing meanwhile.
   * `isPending(() => card.settled())` is "animating"; `card.settled()?.definition` is what landed:
   * the variant name `animate` changed to, else the target values. Solid 1's
   * `onAnimationStart` / `onAnimationComplete` have no place here.
   */
  readonly settled: Accessor<WardSettled | undefined>
  /**
   * A promise of the element's next `name` after the call (#257, ADR-0046), to `await` in a handler
   * or an action:
   * - `"settled"`: its next landing. A Retarget the next one interrupts doesn't land; it waits for
   *   one that does.
   * - `"hoverStart"`, `"hoverEnd"`, `"pressStart"`, `"tap"`, `"tapCancel"`: Motion's hover and tap
   *   events, with the pointer's `point` in the viewport. A press a drag took over is neither a
   *   tap nor a cancel.
   * - `"dragStart"`, `"drag"` (its start and each move), `"dragEnd"`: a drag's, with its `point`,
   *   `offset`, `delta` and `velocity`; `"dragTransitionEnd"`, its release at rest. A ward that
   *   doesn't drag never has one.
   * - `"panSessionStart"` (with its `point`), `"panStart"`, `"pan"`, `"panEnd"`: a pan's (#273), as a
   *   drag's. A pan moves nothing; once started, a press it took over is neither a tap nor a cancel.
   *
   * A gesture's event starts its recognizer, if its `while*` hasn't. Rejected with a
   * `DOMException` named `"AbortError"` once the ward is disposed.
   */
  readonly next: <E extends WardEvent>(name: E) => Promise<WardEvents[E]>
  /**
   * Every `name` from the call on, as an async iterable (#257), for `for await`: each step waits
   * as `next(name)` does, so one that comes while the loop's body runs is missed. The loop ends
   * once the ward is disposed, with no `AbortError`.
   *
   * ```tsx
   * for await (const release of card.each("dragEnd")) {
   *   if (Math.abs(release.offset.x) >= 120) await dismiss(release.offset.x < 0 ? "left" : "right")
   * }
   * ```
   */
  readonly each: <E extends WardEvent>(name: E) => AsyncIterable<WardEvents[E]>
}

/** What a `wardic.*` component or a `<Reorder>` item adds to a ward. Internal. */
export interface WardInternals {
  /** Its tag, so an SVG element's attribute keys render as attributes. */
  readonly tag?: string | undefined
  /**
   * Set a drag element's defaults on the element at mount: a `wardic.create(Component)` wrap's,
   * whose component may not pass `style` and `draggable` on (as on the Solid 1 binding).
   */
  readonly defaultsOnElement?: boolean | undefined
  /**
   * A `<Reorder>` item's drag (ADR-0019 *Amendment (Reorder)*, ADR-0020): the gesture's axis, read
   * at each drag's start and held until its end (`true` = free); it makes the element draggable
   * with no `drag` in its config.
   */
  readonly dragAxis?: (() => boolean | "x" | "y") | undefined
  /** A `<Reorder>` item's: each drag sample, after its projection write. */
  readonly onDragSample?: ((sample: Drag.Sample) => void) | undefined
  /** A `<Reorder>` item's: its projection node's handle, once registered; what it returns is called at unmount. */
  readonly onLayoutHandle?: ((handle: ProjectionSystem.NodeHandle) => () => void) | undefined
  /** A `<Reorder>` item's: its node raised while dragged. */
  readonly raiseWhileDragged?: boolean | undefined
  /** A `<Reorder>` item's: whether a **Keyboard reorder** has it lifted (ADR-0037), which turns its `whileDrag` on. */
  readonly lifted?: Accessor<boolean> | undefined
  /** A `<Reorder>` item's base style (its `touch-action`), under the user's style, over the drag defaults. */
  readonly baseStyle?: (() => object | undefined) | undefined
  /** Told the element at mount; what it returns is called at unmount. */
  readonly onMount?: ((element: HTMLElement) => () => void) | undefined
  /** Values fixed over the config's, read as its own are: a `<Reorder>` item's `layout`, its Layout mode. */
  readonly fixed?: Fixed<WardConfigValues> | undefined
}

const NO_INTERNALS: WardInternals = {}

/**
 * Which gesture layers are on, and on which element: one value, so the target memo reads one signal
 * for the three (#259), recorded on its element, so a ward moved to another reads none there.
 */
interface Gestures {
  readonly element: HTMLElement | undefined
  readonly inView: boolean
  readonly focused: boolean
  readonly hovered: boolean
  readonly pressed: boolean
  readonly dragging: boolean
}
const NO_GESTURES: Gestures = { element: undefined, inView: false, focused: false, hovered: false, pressed: false, dragging: false }
/** A gesture layer of {@link Gestures}. */
type GestureLayer = "inView" | "focused" | "hovered" | "pressed" | "dragging"

/** Whether a ward's call is Solid applying it as a ref. */
const isElement = (value: unknown): value is HTMLElement => Predicate.hasProperty(value, "nodeType")

/** A context value as Solid 2's context takes it: `null` for none. */
const contextOf = (value: WardicVariantContextValue | undefined): WardicVariantContextValue | null => Option.getOrNull(Option.fromUndefinedOr(value))

/**
 * A ward: `config` read per key (#259), each key a value, or an accessor of it, a getter, a store's
 * property or a component's prop (`ward(props)`). Call it where you'd make a signal, in a component
 * or a root, under a `WardicProvider`. Its config's type is kept, so `read` and `atom` complete the
 * keys it animates.
 */
export function ward<const C extends WardConfig>(config: C): Ward<C> {
  return wardWith(config, NO_INTERNALS) as Ward<C>
}

/**
 * A ward mounting an element another ward left in the same task: a spread's expression
 * (`{...ward(config)}`), which Solid 2 runs again on every run of the element's props, making a new
 * ward each time.
 */
const REMADE =
  "ward(config) made a new ward for an element another ward just left: Solid 2 runs a spread's expression " +
  "(`<div {...ward(config)} />`) again on every run of the element's props. Make it once, in the component's body, " +
  "and spread that: `const card = ward(config)` then `<div {...card} />`. Or give it to `ref={ward(config)}`, client-only."

/**
 * Elements a ward has left in this task: a ward mounting one is {@link REMADE}. Cleared once, at the
 * task's end, by one microtask however many leave (#259: one a ward cost 0.2 ms an unmount of 1,000).
 */
const justLeft = new Set<Element>()
const forgetJustLeft = (): void => justLeft.clear()

/** {@link ward} with a `wardic.<tag>`'s additions. Internal. */
export function wardWith(config: WardConfig, internal: WardInternals): Ward {
  if (Predicate.isFunction(config)) throw new Error(WHOLE_ACCESSOR)
  const runtime = useWardicRuntime()
  // A server render takes the lean path: the Starting style only, no spine (ADR-0021).
  if (isServer) return serverWard(config, internal)
  const gate = useWardicGate()
  const projection = useWardicProjection()
  const reducedMotion = useWardicReducedMotion()
  const positionalKeys = useWardicPositionalKeys()
  const owner = getOwner()
  const reactivity = reactivityIn(owner)
  // SSR/hydration-stable: the server ward makes the same one call.
  const id = createUniqueId()
  // Its config, read per key where it's read (#259): a change re-runs only what reads the key.
  const view = WARD_VIEW.of(config, internal.fixed)
  const cfg = (): WardConfigValues => view
  // The config at setup, a plain copy read untracked: what setup reads, the keys read once among it.
  const initialConfig = WARD_VIEW.snapshotOf(view)

  // Its place in variant orchestration (ADR-0007, #50).
  const node = createVariantNode(cfg, initialConfig, useVariantContext())

  // The nearest <AnimatePresence> (ADR-0007), or none.
  const presence = usePresenceContext()

  // The values it starts from, read once (ADR-0003): its `initial`, or the one it inherits, or its
  // `animate` with `initial={false}` (its own, inherited, or its presence's first render, #134).
  const start = startOf(initialConfig, node.inherited, presenceBlocksInitial(presence), untrack)
  const { project } = runtime.runSync(Renderer.Renderer)

  // The Starting style: the projected `initial`, carried by `style` until the gate's first commit
  // (ADR-0021 decision 6, ADR-0034); an svg-inner tag's attribute keys as attributes. While
  // hydrating, what the server rendered, the DOM's project (the Hydration hold). A layout node's is
  // drawn through its projection at rest, as its first commit draws it (#245).
  const layoutNode = isLayoutNode(initialConfig)
  const drawnStart = drawnAtRest(start.initialValues, layoutNode)
  const projected = project(drawnStart)
  const hydrating = isHydrating()
  const startingPatch = Bool.match(hydrating, { onTrue: () => DomRenderer.project(drawnStart), onFalse: () => projected })
  if (hydrating) flagStartingStyle(runtime, id, startingPatch, projected)
  const seed = Svg.splitPatchForTag(internal.tag, startingPatch)

  // Its drag axis and a drag element's defaults (ADR-0004, ADR-0019 *Amendment (Reorder)*), under
  // the user's style: `drag` is read once, as on the Solid 1 binding.
  const dragAxis = dragAxisOf(initialConfig, internal)
  const dragDefaults = UndefinedOr.map(dragAxis, Style.dragDefaults)

  // Its routed `style` keys (#130, ADR-0043), and its `style`, switched by the gate's hooks.
  const live = createLiveStyle({ registry: registryOf(runtime), onDroppedTransform: () => warnDroppedTransform(runtime, id), reactivity })
  const projectStarting = Bool.match(hydrating, { onTrue: () => DomRenderer.project, onFalse: () => project })
  const userStyle = (): WardStyle | string | undefined => cfg().style
  const elementStyle = createElementStyle({
    userStyle,
    starting: seed.style,
    startingWith: (routed: Values.Values): Renderer.Patch =>
      Svg.splitPatchForTag(internal.tag, projectStarting(drawnAtRest({ ...routed, ...start.initialValues }, layoutNode))).style,
    live,
    defaults: dragDefaults,
    base: internal.baseStyle,
    reactivity,
  })

  const snapshot = snapshotOf(start)
  const reuse = makeReuse()
  const configNow = (): WardConfigValues => view
  const styleNow = (): WardStyle | string | undefined => untrack(userStyle)

  // What its exit resolves from under an <AnimatePresence> (#277: its `exit`, `variants`, `custom` and
  // transition), kept current while it's alive: the presence resolves it as the ward leaves (ADR-0007).
  const exitConfig = { current: NO_EXIT_CONFIG }
  if (Predicate.isNotUndefined(presence)) {
    // Its inherited transition is read untracked here: the effect keeps it current.
    exitConfig.current = untrack(() => exitConfigOf(initialConfig, node.inherited))
    createEffect(
      () => exitConfigOf(cfg(), node.inherited),
      (config) => {
        exitConfig.current = config
      },
      CLIENT_ONLY_DEFERRED,
    )
  }

  // Its layout node (ADR-0009): whether it has one, decided at setup, as `layout` is read once, and
  // what a release runs on, its Release offset (ADR-0016, *Amendment (#140)*).
  const layoutMember = wantsLayoutNode(initialConfig)
  const dragTransition = dragTransitionOf(initialConfig.dragElastic, initialConfig.dragTransition)

  // The element, set by the ref during render. Its write is the one a ward makes in an owned scope: a
  // ward called with its element in a component's body (WT2), not given to `ref`.
  const [element, setElement] = createSignal<HTMLElement | undefined>(undefined, { ownedWrite: true })

  // Its gesture layers' states (ADR-0005), one signal for the three, so the target reads one (#259),
  // each recorded on its element: the hover and press recognizers, each started on its element the
  // first time its `while*` target is set (#87, ADR-0040), and the drag's. A write that changes
  // nothing keeps the same object.
  const [gestureState, setGestureState] = createSignal<Gestures>(NO_GESTURES)
  /** Set `layer` on `el`: a state recorded on another element starts again from none. */
  const setGesture = (el: HTMLElement, layer: GestureLayer, on: boolean): void => {
    setGestureState((g) => {
      if (g.element !== el) return Bool.match(on, { onTrue: (): Gestures => ({ ...NO_GESTURES, element: el, [layer]: true }), onFalse: () => g })
      if (g[layer] === on) return g
      return { ...g, [layer]: on }
    })
  }
  // The layers on the element mounted now: a state recorded on one the ward has left reads as none, so
  // a move resets nothing by writing (#257's audit: the reset, written in the mount's effect, fed the
  // target memo and re-ran the effect, EFFECT_WRITES_OWN_SOURCE).
  const gestures = (): Gestures => {
    const g = gestureState()
    if (g.element === element()) return g
    return NO_GESTURES
  }
  const dragging = (): boolean => gestures().dragging
  const wantsHover = (): boolean => Predicate.isNotUndefined(cfg().whileHover)
  const wantsPress = (): boolean => Predicate.isNotUndefined(cfg().whileTap)
  const wantsInView = (): boolean => Predicate.isNotUndefined(cfg().whileInView)
  const wantsFocus = (): boolean => Predicate.isNotUndefined(cfg().whileFocus)

  // The Override stack, compared by value: a change that resolves the same target doesn't Retarget.
  // A keyboard lift turns `whileDrag` on, as a drag does (ADR-0037).
  const lifted = UndefinedOr.match(internal.lifted, { onUndefined: () => constFalse, onDefined: identity })
  const target = createMemo<Resolution>(
    () => {
      const g = gestures()
      return resolutionOf(
        cfg(),
        node.inherited,
        start.initialLink,
        {
          inView: g.inView,
          focused: g.focused,
          hovered: g.hovered,
          pressed: g.pressed,
          dragged: Bool.or(g.dragging, lifted()),
          dragging: g.dragging,
        },
        snapshot,
      )
    },
    { equals: sameResolution, transparent: true },
  )
  // Its gesture states, for what its variant node hands down (#291): bound at setup, before its
  // children read them. Read from the gestures themselves, not the target: a gesture whose layer
  // resolves to nothing new leaves the target as it was (`sameResolution`), but is on all the same.
  // Only a provider has one: a guard, so other wards make nothing here.
  const bindGestures = node.bindGestures
  if (Predicate.isNotUndefined(bindGestures)) {
    // eslint-disable-next-line solid/reactivity -- read inside the variant node's gestures memo, where it tracks
    bindGestures(() => {
      const g = gestures()
      return { inView: g.inView, focused: g.focused, hovered: g.hovered, pressed: g.pressed, dragged: Bool.or(g.dragging, lifted()) }
    })
  }

  // Its Retargets' starts and landings (#257, ADR-0046): `settled()` and `next("settled")`, each with
  // the gesture layers its target was resolved with.
  // A gesture's event asked for starts its recognizer on the mounted element (and on later mounts).
  const lifecycle = new Lifecycle(owner, () => {
    UndefinedOr.map(mounted, startRecognizers)
  })


  // The mounted element: registered with the gate, its layout node, its spine built over it, and the
  // fibers of its recognizers and drag track.
  interface Mounted {
    readonly element: HTMLElement
    readonly spine: ElementSpine
    readonly layout: ProjectionSystem.NodeHandle | undefined
    readonly fibers: Array<Fiber.Fiber<unknown, unknown>>
    hover: boolean
    press: boolean
    pan: boolean
    inView: boolean
    focus: boolean
    readonly dispose: () => void
  }
  /** Run a recognizer's or the drag track's fiber on the provider's runtime, for the mount's life. */
  const runFor = (m: { readonly fibers: Array<Fiber.Fiber<unknown, unknown>> }, effect: Effect.Effect<void, unknown, WardicServices>): void => {
    m.fibers.push(runtime.runFork(reported(effect)))
  }
  /** A recognizer's values into `on`. */
  const recognized = <A,>(stream: Stream.Stream<A, never, WardicServices>, on: (value: A) => void): Effect.Effect<void> =>
    Stream.runForEach(stream, (value) => Effect.sync(() => on(value))) as Effect.Effect<void>
  /**
   * Start the hover, press and pan recognizers its config or a `next` now wants, each once a mount:
   * each hover or press transition sets its gesture layer, and every event is told to the lifecycle
   * for `next` (#257, #273).
   */
  const startRecognizers = (m: Mounted): void => {
    if (Bool.and(Bool.or(untrack(wantsHover), lifecycle.wantsHover), Bool.not(m.hover))) {
      m.hover = true
      runFor(
        m,
        recognized(Recognizer.hoverEvents(m.element), (transition) => {
          setGesture(m.element, "hovered", transition.active)
          lifecycle.hovered(transition)
        }),
      )
    }
    if (Bool.and(Bool.or(untrack(wantsPress), lifecycle.wantsPress), Bool.not(m.press))) {
      m.press = true
      runFor(
        m,
        recognized(Recognizer.pressEvents(m.element), (press) => {
          setGesture(m.element, "pressed", press.phase === "start")
          lifecycle.pressed(press)
        }),
      )
    }
    // A pan sets no layer: only a `next` wants it (#273).
    if (Bool.and(lifecycle.wantsPan, Bool.not(m.pan))) {
      m.pan = true
      runFor(m, recognized(Recognizer.pan(m.element), (sample) => lifecycle.panned(sample)))
    }
    // In view as its `viewport` says, read when it starts (#273).
    if (Bool.and(Bool.or(untrack(wantsInView), lifecycle.wantsInView), Bool.not(m.inView))) {
      m.inView = true
      runFor(
        m,
        recognized(Recognizer.inViewEvents(m.element, inViewOptionsOf(untrack(cfg).viewport)), (transition) => {
          setGesture(m.element, "inView", transition.active)
          lifecycle.viewed(transition)
        }),
      )
    }
    // Focused as the browser shows it (`:focus-visible`, #273).
    if (Bool.and(untrack(wantsFocus), Bool.not(m.focus))) {
      m.focus = true
      runFor(m, recognized(Recognizer.focus(m.element, { visible: true }), (focused) => setGesture(m.element, "focused", focused)))
    }
  }
  let mounted: Mounted | undefined
  // Inside a child `mode="wait"` holds off the page (#277, ADR-0048), it mounts once the child is on
  // it: `shown` ticks then, and the mount effect, which reads `ticked`, runs again. Only under a
  // presence: with none, its compute calls a no-op and makes nothing. `held` cancels the wait.
  let ticked: () => undefined = constUndefined
  let shown: (() => void) | undefined
  if (Predicate.isNotUndefined(presence)) {
    const [read, tick] = createSignal<undefined>(undefined, { equals: false })
    ticked = read
    shown = () => tick(undefined)
  }
  let held: (() => void) | undefined
  const unhold = (): void => {
    if (Predicate.isUndefined(held)) return
    held()
    held = undefined
  }
  /** Whether `el` waits off the page for its held child: its mount queued with the presence. */
  const heldBack = (el: HTMLElement): boolean => {
    unhold()
    if (Predicate.isUndefined(shown)) return false
    held = presenceHold(presence, el, shown)
    return Predicate.isNotUndefined(held)
  }
  const unmount = (): void => {
    unhold()
    if (Predicate.isUndefined(mounted)) return
    const left = mounted.element
    mounted.dispose()
    mounted = undefined
    if (justLeft.size === 0) queueMicrotask(forgetJustLeft)
    justLeft.add(left)
  }
  // Its element's mount goes, and its lifecycle's waits are rejected (#257): one cleanup.
  onCleanup(() => {
    unmount()
    lifecycle.dispose()
  })

  const mount = (el: HTMLElement): Mounted => {
    if (justLeft.has(el)) throw new Error(REMADE)
    // The gate commits each frame onto the element (ADR-0006, ADR-0034); the hooks switch its
    // `style`. An element with `onUpdate` at mount is told each committed frame (#233). While
    // hydrating, its Appear animation is found here, taken over by its first Retarget that starts,
    // and removed in its first commit (the Handoff, ADR-0044 decision 6).
    const handoff = Bool.match(hydrating, { onTrue: () => Option.getOrUndefined(handoffOf(el)), onFalse: constUndefined })
    const unregister = gate.register(id, releasingAppear(withOnUpdate({ target: el, ...elementStyle.hooks }, configNow().onUpdate, configNow), handoff, el))
    // Its values, for the projection's flights (ADR-0012 *Amendment (#137)*).
    const unregisterValues = projection.registerValues(el, () => snapshot.values)
    const links = startLinksOf(el, styleNow, live)
    // Its exit record, under an <AnimatePresence>: the presence removes it once the exit settles.
    const presenceRecord = UndefinedOr.map(presence, (registrar) => {
      const record = presenceRecordOf(el, start, (custom, inherited) => exitTargetOf(exitConfig.current, custom, snapshot, inherited), links, presenceTreeOf(initialConfig), snapshot)
      registrar.register(record)
      return record
    })
    // Where it starts when its child takes over from a leaver (#286): asked before its layout node
    // registers, which moves from the leaver's box, and before its first Retarget.
    const taken = presenceSeedOf(presence, el)
    // Its one projection node (ADR-0009, ADR-0010), whose own `x`/`y` the projection then owns (ADR-0016).
    // Its layout animations' starts and landings, and its drag's release at rest, go to the lifecycle,
    // for `next("layoutStart")`, `next("layoutComplete")` and `next("dragTransitionEnd")` (#257, #273):
    // Solid 2 has no props for them.
    const layout = Bool.match(layoutMember, {
      onTrue: () => {
        const started = (): void => lifecycle.layoutStarted()
        const completed = (): void => lifecycle.layoutCompleted()
        const released = (): void => lifecycle.released()
        return projection.register(
          registrationOf({
            ...layoutOptionsOf({ id, element: el, config: configNow, parent: node.inherited, snapshot, dragTransition, raiseWhileDragged: internal.raiseWhileDragged === true, taken }),
            onLayoutAnimationStart: () => started,
            onLayoutAnimationComplete: () => completed,
            // Its drag's Release offset at rest, for `next("dragTransitionEnd")` (#273).
            onReleaseEnd: () => released,
          }),
        )
      },
      onFalse: constUndefined,
    })
    // A `<Reorder>` item's group registers the node, until the unmount.
    const handedOver = UndefinedOr.map(layout, (handle) => UndefinedOr.map(internal.onLayoutHandle, (onHandle) => onHandle(handle)))
    const fibers: Array<Fiber.Fiber<unknown, unknown>> = []
    if (internal.defaultsOnElement === true) UndefinedOr.map(dragDefaults, (defaults) => applyDragDefaults(el, defaults))
    // The drag track (ADR-0004): the pointer direct-sets `x`/`y` while the spring drives the rest and
    // `whileDrag`; on a layout node it feeds the projection (ADR-0016).
    const locked = initialConfig.dragDirectionLock === true
    // Motion's `dragConstraints` (#273): a box of numbers, or a container measured against the element.
    const constraints = trackConstraintsOf(initialConfig.dragConstraints, el, () => untrack(cfg).onMeasureDragConstraints)
    UndefinedOr.map(dragAxis, (axis) =>
      driveDragTrack({
        run: (track) => runFor({ fibers }, track),
        gate,
        id,
        element: el,
        snapshot,
        recordFrame: recordFrameOf(presenceRecord),
        setDragging: (on: boolean) => setGesture(el, "dragging", on),
        config: {
          axis,
          constraints: constraints.constraints,
          elastic: initialConfig.dragElastic,
          momentum: initialConfig.dragMomentum,
          snapToOrigin: initialConfig.dragSnapToOrigin,
          propagation: initialConfig.dragPropagation,
          directionLock: initialConfig.dragDirectionLock,
          transition: dragTransition,
        },
        container: constraints.container,
        ...UndefinedOr.match(layout, { onUndefined: () => ({}), onDefined: (projectionNode) => ({ projection: projectionNode }) }),
        ...UndefinedOr.match(internal.dragAxis, { onUndefined: () => ({}), onDefined: (axisAt) => ({ axisAt }) }),
        // Its samples to a `<Reorder>` item's group, and to the lifecycle for `next("dragStart")` (#257)
        // and, with a direction lock, `next("directionLock")` (#273).
        onSample: UndefinedOr.match(internal.onDragSample, {
          onUndefined: () => (sample: Drag.Sample) => lifecycle.dragged(sample, locked),
          onDefined: (onSample) => (sample: Drag.Sample) => {
            onSample(sample)
            lifecycle.dragged(sample, locked)
          },
        }),
        // Its release at rest, for `next("dragTransitionEnd")` (#273).
        onReleaseEnd: () => lifecycle.released(),
      }))
    const spine = makeElementSpine({
      runtime,
      gate,
      id,
      element: el,
      tag: internal.tag,
      config: configNow,
      parent: node.inherited,
      canStart: node.canStart,
      extraDelay: node.extraDelay,
      byName: node.names,
      onFrame: node.onFrame,
      reducedMotion,
      positionalKeys,
      start,
      snapshot,
      reuse,
      links,
      styleNow,
      live,
      presence: presenceRecord,
      projected: Predicate.isNotUndefined(layout),
      dragAxis,
      handoff,
      animation: lifecycle,
    })
    // A child back under its key starts where its leaver is drawn (#286), before its first Retarget.
    if (Predicate.isNotUndefined(taken)) spine.seed(taken)
    // Live values in `style` (#130, ADR-0043): followed from the first routed key on.
    spine.follow({ resolved: () => untrack(target).resolved, dragging: () => untrack(dragging) })
    const m: Mounted = {
      element: el,
      spine,
      layout,
      fibers,
      hover: false,
      press: false,
      pan: false,
      inView: false,
      focus: false,
      dispose: () => {
        UndefinedOr.map(mountedHook, (end) => end())
        spine.dispose()
        Arr.forEach(fibers, (fiber) => runtime.runFork(Fiber.interrupt(fiber)))
        // The group lets go of the node before it's disposed.
        UndefinedOr.map(handedOver, (release) => release())
        UndefinedOr.map(layout, (node) => node.dispose())
        unregisterValues()
        unregister()
      },
    }
    startRecognizers(m)
    const mountedHook = UndefinedOr.map(internal.onMount, (onMount) => onMount(el))
    return m
  }

  // A `while*` target set after mount starts its recognizer then (#87, ADR-0040). Its compute reads
  // the two keys, so only their changes re-run it (#259).
  createEffect(
    () => Bool.some([wantsHover(), wantsPress(), wantsInView(), wantsFocus()]),
    (wanted) => {
      if (wanted) UndefinedOr.map(mounted, startRecognizers)
    },
    CLIENT_ONLY_DEFERRED,
  )

  // A `layoutDependency` change re-measures its layout node (not at mount: it measures as it registers).
  // Only a change of its value: a memo, since a Solid 2 effect applies on every re-run of its compute,
  // and `cfg()` is re-read on any of the config's changes (a `style` change re-measured, #209 PR 5's lab).
  if (layoutMember) {
    const dependency = createMemo(() => cfg().layoutDependency, CLIENT_ONLY)
    createEffect(
      dependency,
      () => {
        UndefinedOr.map(UndefinedOr.map(mounted, (m) => m.layout), (node) => node.notify())
      },
      CLIENT_ONLY_DEFERRED,
    )
  }

  // Whether the `when` gate lets a Retarget start (ADR-0007), as a memo: an element with variants of
  // its own reads its `when` off its config, and only a flip of the gate may re-run the effect.
  const open = createMemo(() => node.canStart(), CLIENT_ONLY)

  // Mount, then Retarget on each change of the target or of the `when` gate: both are read here,
  // so a gate's flip re-runs it and releases a held Retarget.
  createEffect(
    () => ({ el: element(), resolution: target(), open: open(), shown: ticked() }),
    ({ el, resolution }) => {
      if (Predicate.isUndefined(el)) return
      if (Predicate.isUndefined(mounted) || mounted.element !== el) {
        // Held off the page: nothing starts until it's on it.
        if (heldBack(el)) return
        // A new element starts with no gesture on, read from its gesture state (#257's audit).
        unmount()
        // Its config is read at mount (its layout node's options, its `onUpdate`, its spine's) through
        // the per-key view (#259): untracked, so said, as the Retarget below.
        mounted = untrack(() => mount(el))
      }
      // The spine reads the variant context (its gates, its stagger, what it inherits) at the
      // Retarget, once: untracked, so said (Solid 2's dev build warns of a reactive read in an
      // effect's apply, STRICT_READ_UNTRACKED). The effect's compute is what re-runs it.
      const spine = mounted.spine
      untrack(() => spine.retarget(resolution))
    },
    CLIENT_ONLY,
  )

  // `<card.Provider>` hands down what this element hands its children (#50).
  const Provider = (props: { readonly children?: JSX.Element }): JSX.Element => (
    <WardicVariantContext value={contextOf(node.provided)}>{props.children}</WardicVariantContext>
  )

  // The element's value per key (#130, ADR-0043 decision 5): the gate's output while it holds the
  // key, else where the key rests. One accessor a key, made on first ask, under the ward's owner. It
  // carries its Atom (#209 PR 3's Q2): a `style` given it follows the Atom, set at the gate's write,
  // so a key derived from it paints in the same frame. Where the key rests is Solid's (the user's
  // style), mirrored into an Atom of its own.
  const registry = registryOf(runtime)
  let reads: Map<string, Accessor<unknown>> | undefined
  const read = (key: string): Accessor<unknown> => {
    if (Predicate.isUndefined(reads)) reads = new Map()
    const known = reads.get(key)
    if (Predicate.isNotUndefined(known)) return known
    const output = gate.valueOf(id, key)
    const accessor = runWithOwner(owner, () => {
      const resting = createMemo(() => restingOf(key, start.initialValues, userStyle(), (raw) => live.read(raw)), CLIENT_ONLY)
      const restingAtom = Atom.make<unknown>(untrack(resting))
      onCleanup(registry().mount(restingAtom))
      createEffect(
        resting,
        (value) => {
          registry().set(restingAtom, value)
        },
        CLIENT_ONLY_DEFERRED,
      )
      return followAtom(registry(), Atom.make((get) => UndefinedOr.match(get(output), { onUndefined: () => get(restingAtom), onDefined: identity })))
    })
    reads.set(key, accessor)
    return accessor
  }

  // The ward: a ref, and its own props. Under a presence, its element is told to it as it's made
  // (#286): its `key`, and whether it's a twin.
  const setMade = madeWith(presence, setElement, initialConfig)
  const self = ((value?: unknown): Ward | undefined => {
    if (isElement(value)) {
      setMade(value)
      return undefined
    }
    return self
  }) as Ward
  Object.defineProperties(self, {
    ref: { value: self, enumerable: true },
    style: { get: (): JSX.CSSProperties => elementStyle.style(userStyle()) as JSX.CSSProperties, enumerable: true },
    ...attributesOf(seed.attrs),
    ...attributesOf(UndefinedOr.match(dragDefaults, { onUndefined: () => ({}), onDefined: () => Style.DRAG_DEFAULT_ATTRIBUTES })),
    Provider: { value: Provider },
    read: { value: read },
    atom: { value: (key: string) => gate.valueOf(id, key) },
    settled: { value: () => lifecycle.read() },
    next: { value: <E extends WardEvent>(name: E) => lifecycle.wait(name) },
    each: { value: <E extends WardEvent>(name: E) => lifecycle.each(name) },
  })
  return self
}

/** The Starting style's attributes as a ward's own keys: enumerable, so a spread applies them. */
const attributesOf = (attrs: Readonly<Record<string, unknown>>): PropertyDescriptorMap =>
  Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, { value, enumerable: true }]))

/** A server's output Atom: nothing is written there, so it stays `undefined`. */
const NO_OUTPUT: Atom.Atom<unknown> = Atom.make<unknown>(undefined)

/** A style value read on a server: an Atom through a server's own registry, an accessor called (#130). */
const readServerStyle = (value: unknown): unknown => readLive(value, serverRegistryOf, untrack)

/**
 * {@link wardWith} during a server render (ADR-0021, decisions 1 and 4): the element's Starting
 * style and attributes, computed purely, and nothing else: no runtime, no spine, no signals. It
 * makes the client's one `createUniqueId` call, so later hydration keys land where the client's
 * render puts them, and its `.Provider` renders the same nesting, with the same names and inert
 * orchestration. No Appear animation yet (PR 4 of #209).
 */
const serverWard = (config: WardConfig, internal: WardInternals): Ward => {
  createUniqueId()
  const c = WARD_VIEW.snapshotOf(WARD_VIEW.of(config, internal.fixed))
  const node = serverVariantNode(c, useVariantContext())
  const initialValues = startOf(c, node.inherited, presenceBlocksInitial(usePresenceContext()), untrack).initialValues
  const layoutNode = isLayoutNode(c)
  const seed = Style.starting(internal.tag, drawnAtRest(initialValues, layoutNode))
  // Its Appear animation (#48, ADR-0044): its slot in the render's, and the group its Variant
  // children join when it leads one.
  const appear = appearEntryOf(useWardicAppear(), c, internal.tag, initialValues, node)
  // A late chunk's root (#245): the chunk's Appear rules go through the head registry, read once
  // the chunk has rendered and streamed with it as a head patch. A late element under another late
  // one registers too: the first read writes the batch, and any other finds it written and adds no
  // tag, so Solid 1's `within` (which kept a chunk to one `<style>` node) isn't needed.
  if (appear.chunkRoot) UndefinedOr.map(appear.state, (state) => useHead(appearStyle(state.chunkCss)))
  const Provider = (props: { readonly children?: JSX.Element }): JSX.Element => (
    <WardicVariantContext value={contextOf(appear.provided)}>{props.children}</WardicVariantContext>
  )
  // Its routed keys' values join the Starting style, under `initial`'s (#130); a `<Reorder>` item's
  // base style, a drag element's defaults, then its Appear slot go under the user's style. A user
  // style with its own `animation` keeps it, over the slot, and the slot is left undefined.
  const parts = split(c.style)
  if (setsAnimation(parts.css)) appear.veto("its own style sets an animation")
  const dragDefaults = UndefinedOr.map(dragAxisOf(c, internal), Style.dragDefaults)
  const style = pipe(
    serverStartingStyle(internal.tag, seed.style, initialValues, parts.routed, layoutNode, untrack),
    Style.over(parts.css),
    Style.over(UndefinedOr.match(internal.baseStyle, { onUndefined: constUndefined, onDefined: (base) => base() })),
    Style.over(dragDefaults),
    Style.over(appear.style),
  ) as JSX.CSSProperties
  const self = ((): Ward => self) as Ward
  Object.defineProperties(self, {
    ref: { value: noRef, enumerable: true },
    style: { value: style, enumerable: true },
    ...attributesOf(seed.attrs),
    ...attributesOf(UndefinedOr.match(dragDefaults, { onUndefined: () => ({}), onDefined: () => Style.DRAG_DEFAULT_ATTRIBUTES })),
    Provider: { value: Provider },
    read: { value: (key: string) => () => restingOf(key, initialValues, c.style, readServerStyle) },
    atom: { value: (): Atom.Atom<unknown> => NO_OUTPUT },
    // Nothing animates on a server: nothing has landed, and nothing will.
    settled: { value: constUndefined },
    next: { value: neverLands },
    each: { value: () => NO_EVENTS },
  })
  return self
}

/** A server render's `ref`: Solid never calls it there. */
const noRef = constUndefined

/** A server's `next`: nothing happens there, and nothing disposes it. */
const neverLands = (): Promise<never> => new Promise<never>(constUndefined)

/** A server's `each`: nothing happens there, so it ends at once. */
const NO_EVENTS: AsyncIterable<never> = {
  [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ value: undefined, done: true as const }) }),
}
