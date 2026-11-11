/**
 * `createWard` — the primary motion spine of the Solid binding (ADR-0005).
 *
 * This is the fixed orchestration spine the binding contract prescribes:
 *
 *   Recognizers (hover/press) -> Override stack -> Override.resolve -> reactive
 *   `target()` -> a settling primitive (spring/Retarget by default, tween for
 *   `transition.type: "tween"`) -> per-frame `gate.write(id, values)` -> the
 *   gate projects the `Patch` and commits it onto the element (ADR-0034).
 *
 * `createWard` returns a **Ward**, a callable: `<div {...ward()}>` spreads `ref` (wires
 * the element on mount, where the gate commits) and a reactive `style` getter: the
 * Starting style until the first commit, then the user's style without the keys the
 * gate holds (ADR-0034). No frame goes through Solid.
 *
 * SSR contract (ADR-0003): the Starting style is resolved synchronously and
 * purely as `project(resolveInitial(config))` — never by spinning the engine.
 * That one resolved value is the `style` until the first commit (so the server /
 * pre-mount render emits it with no flash) AND the spring's `from` Snapshot (so frame 1
 * flows continuously out of the seed). `initial` is a static map / variant name
 * (SSR-serializable) at `createWard`'s boundary; the component layer unwraps an
 * accessor `initial` once before passing it in (see {@link WardConfig.initial}).
 *
 * Scope (v0.1, this step): `initial` / `animate` / `whileHover` / `whileTap`.
 * NO variant-tree propagation, NO drag, NO exit/layout. Mixed numeric+string
 * targets are handled by routing numeric keys through `springValues` and any
 * string/color keys through `springBlend`, the same spring on a progress (both
 * writing into the same gate id) — see core's `Values.split`.
 */
import type * as Drag from "@wardic/core/Drag"
import { tapPropagates } from "./press.ts"
import * as Renderer from "@wardic/core/Renderer"
import type * as Values from "@wardic/core/Values"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as FlushGate from "@wardic/dom/FlushGate"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Style from "@wardic/dom/Style"
import * as Svg from "@wardic/dom/Svg"
import { mergeRefs } from "@solid-primitives/refs"
import * as Arr from "effect/Array"
import type * as Context from "effect/Context"
import * as Bool from "effect/Boolean"
import { constUndefined, identity, pipe } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Atom from "effect/reactivity/Atom"
import {
  type Accessor,
  type Component,
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  DEV,
  getOwner,
  type JSX,
  on,
  onCleanup,
  runWithOwner,
  untrack,
} from "solid-js"
import { type ControlsChange, controlledConfigOf, controlledElement, isAnimationControls, subscribe, uncontrolledOf, type WardicAnimationControls } from "./animation-controls.ts"
import { fromAtom, watchToSignal } from "./bridge.ts"
import { pointMapOptionOf, settingOf, type WardicConfigValue, withConfigTransition } from "./wardic-config-value.ts"
import { dragTransitionOf, type DragTrack, type DragTrackConfig, runDragTrackWith } from "./drag.ts"
import { createElementStyle } from "./element-style.ts"
import { createLiveStyle, type LiveSource, type LiveStyle, readLive, serverRegistryOf, split } from "./live-style.ts"
import { createVariantNode } from "./variant-node.ts"
import { type GestureStates, type NameOrchestration, type ServerVariantNode, serverVariantNode, startingValuesOf, startsQuiet } from "./variant-tree.ts"
import { registerAnimatable } from "./imperative.ts"
import { projectionNodeOf, useLayoutGroupId } from "./layout.tsx"
import { layoutOptionsOf, wantsLayoutNode } from "./layout-member.ts"





import { GESTURE_WORDS, hasService, serviceIn } from "./gesture-features.ts"
import { handoffOf, setsAnimation } from "./appear.ts"
import { type PresenceContextValue, presenceBlocksInitial, presenceHold, usePresenceContext } from "./presence.tsx"
import { type PresenceSeed, presenceSeedOf } from "./presence-record.ts"
import type { PresenceRecord } from "./presence-record.ts"
import { createWhenWanted, NEVER_STARTED, type Started, stateOf, type Wants } from "./sensors.ts"
import { type GestureCallbacks, gestureCallbacksOf, inViewOptionsOf, wantsFocus, wantsHover, wantsInView, wantsPan, wantsPress } from "./gesture-callbacks.ts"
import { type Feature, type FeatureRegistry, type FeatureSection, LAYOUT_PROPS, missingMessage, unreadColorIn } from "./feature.ts"
import { runWatch, useBuiltProjection, useElementFeatures, useFeatureRegistry, useWardicAppear, useWardicDefaultTransition, useWardicGate, useWardicPositionalKeys, useWardicReducedMotion, useWardicRenderer, useWardicRuntime, useWardicSkipAnimations } from "./provider.tsx"
import { useWardicConfig } from "./wardic-config.tsx"
import { transformPagePointOf } from "./wardic-config-value.ts"
import { projectionIn, type WardicRuntime } from "./runtime.ts"
import { isHydrating, isServer } from "./server.ts"
import { reactivity } from "./solid-reactivity.ts"
import {
  accessorOf,
  type Active,
  animationCallbacks,
  applyDragDefaults,
  dragAxisOf,
  dragDefaultsOf,
  claimForDrag,
  draggingWithWillChange,
  drawnAtRest,
  followTemplate,
  heldTransformFor,
  registeredValuesOf,
  flagStartingStyle,
  isLayoutNode,
  madeWith,
  type ElementSpineOptions,
  makeElementSpine,
  makeReuse,
  exitConfigOf,
  exitTargetOf,
  presenceTreeOf,
  presenceRecordOf,
  recordFrameOf,
  registryOf,
  type Resolution,
  resolutionOf,
  restingOf,
  sameResolution,
  serverStartingStyle,
  snapshotOf,
  startLinksOf,
  type Start,
  startOf,
  warnDroppedTransform,
  withOnUpdate,
  releasingAppear,
  appearEntryOf,
  type ServerAppearOf,
} from "./spine.ts"
import { type WardicVariantContextValue, useVariantContext, WardicVariantContext } from "./variants.ts"
import type { WardConfig, WardicTransformShorthands, WardicValues } from "./config.ts"
import { DragGesture, FocusGesture, HoverGesture, InViewGesture, PanGesture, PressGesture } from "./features/keys.ts"

/**
 * Optional user-supplied props passed INTO the {@link Ward} callable to be
 * merged with ward's own ref/style (Option A — ward's animated style wins).
 */
export interface WardUserProps {
  /** The user's ref callback — invoked alongside ward's internal ref. */
  readonly ref?: (el: HTMLElement) => void
  /**
   * The user's style — ward's animated keys merge ON TOP. May be a LIVE getter
   * (the `wardic.*` element layer passes one so a reactive `style` prop is
   * tracked, not frozen at setup), hence `| undefined` to allow a getter that
   * yields no style yet. Reactivity flows via the getter, not a `MaybeAccessor`.
   */
  readonly style?: WardStyle | string | undefined
}

/**
 * A Wardic element's `style`: every CSS property and the transform keys (`x`, `scale`, `rotate`…),
 * each a value, or a live value that moves the element as it changes: a signal, a memo, or
 * `createSpring`'s or `createTransform`'s. While no animation sets a key, the element shows its
 * `style` value. With a transform key set, a `transform` string is dropped, as Motion's is.
 *
 * @example <w.div style={{ x: createSpring(pointerX), opacity: 0.8 }} />
 */
// #130, ADR-0043: a key is its Base value's `style` link; while no layer of the Override stack sets
// it, the element shows it, following a Live value on every change, and a return goes to where it is.
export type WardStyle = { readonly [K in keyof WardicValues]?: WardicValues[K] | LiveSource<number | string> | undefined }

/** The props a ward spreads on its element: `{...card()}`. */
export interface WardProps {
  /** Puts the ward on the element as it mounts, beside a `ref` of your own given to `card({ ref })`. */
  // Wires the element into the spine on mount, merging the user's ref (mergeRefs).
  readonly ref: (el: HTMLElement) => void
  /** The element's style as Wardic draws it, over a `style` of your own given to `card({ style })`. */
  // The reactive projected Patch merged with the user's style, typed as JSX.CSSProperties so the
  // spread type-checks (the projected keys are CSS properties).
  readonly style: JSX.CSSProperties
  /** `"false"` on an element that drags, so a drag isn't the browser's own drag-and-drop. */
  // Motion's default, ADR-0019 Amendment (Reorder).
  readonly draggable?: "false"
}

/**
 * A ward, from `createWard` or `w.createWard`: call it for the props to spread on its element,
 * `{...card()}`, or `{...card({ ref, style })}` to keep your own. `card.value(key)` reads what the
 * element shows, and `card.Provider` hands its variants to the components under it.
 *
 * @see https://wardic.dev/reference/solid/elements/ward
 */
// With no args it returns the ward's own ref and style; with WardUserProps, the merged spreadable (the
// user's ref beside the ward's, the user's style under its animated one). `Provider` (ADR-0007)
// publishes this instance's variant name and transition down the tree.
export type Ward = ((userProps?: WardUserProps) => WardProps) & {
  /**
   * Hands this element's variants to the components under it: a child with `variants` follows its
   * names and joins its stagger, as if it were rendered inside the element.
   */
  // ADR-0007 name propagation: inheriting children resolve the name against their own `variants`.
  readonly Provider: Component<{ readonly children?: JSX.Element }>
  /**
   * What the element shows for `key` now, as an accessor: animated, dragged, or set by a live value
   * in its `style`. A transform key reads a number (`x`, not its `transform`). Derive from it as
   * from any live value: `createTransform(card.value("x"), [-150, 0, 150], [0, 1, 0])`.
   *
   * @example const x = card.value("x")
   */
  // #130, ADR-0043 decision 5. At rest outside the gate: its `initial`, else its `style` value, else a
  // transform key's identity. A value derived from it and given to another key's `style` moves in the
  // same frame. One accessor per key, made where you'd make a signal.
  readonly value: WardValue
  /** `card.value(key)` as an `effect/reactivity` Atom, for Effect code; `undefined` until the element has a value for it. */
  // FlushGate.valueOf: set as each write that changes it lands. Core's LiveValue helpers take it.
  readonly atom: (key: string) => Atom.Atom<unknown>
}

/** `card.value`'s type: a transform key always has a value; any other key may have none. */
export interface WardValue {
  <A extends number | string = number>(key: keyof WardicTransformShorthands): Accessor<A>
  <A extends number | string = number>(key: string): Accessor<A | undefined>
}

/** A `<Reorder>` item's additions when there are none: a plain element's. */
const NO_INTERNALS: SpineInternals = {}

/** What an element's gestures are wanted by: its config, and its section's Features (#511). */
interface Wanted {
  readonly config: WardConfig
  readonly services: Context.Context<never>
}

/**
 * Whether an element wants each gesture recognizer (#87, #273), its section having the gesture's
 * Feature (#511): shared by every element.
 */
const WANTS: Wants<Wanted> = {
  hover: (w) => wantsHover(w.config) && hasService(w.services, HoverGesture),
  press: (w) => wantsPress(w.config) && hasService(w.services, PressGesture),
  inView: (w) => wantsInView(w.config) && hasService(w.services, InViewGesture),
  focus: (w) => wantsFocus(w.config) && hasService(w.services, FocusGesture),
  pan: (w) => wantsPan(w.config) && hasService(w.services, PanGesture),
}

/** Each gesture a config may want, its Feature's name and key: what development's word on a missing one checks (#511). */
const GESTURE_FEATURES: ReadonlyArray<readonly [keyof typeof GESTURE_WORDS, (config: WardConfig) => boolean, Context.Key<unknown, unknown>]> = [
  ["hover", wantsHover, HoverGesture],
  ["press", wantsPress, PressGesture],
  ["inView", wantsInView, InViewGesture],
  ["focus", wantsFocus, FocusGesture],
  ["pan", wantsPan, PanGesture],
]

/** A `ward()` call's user props when it's given none. */
const NO_USER_PROPS: WardUserProps = {}

/**
 * What a `<Reorder>` item adds to the spine (ADR-0020; internal, D9: nothing in
 * {@link WardConfig}):
 *
 * - `dragAxis`: the gesture's axis, read at each drag's start and held until its end
 *   (`true` = free); it makes the element draggable without a `drag` config.
 * - `onDragSample`: each drag sample, after its projection write.
 * - `onLayoutHandle`: the projection node's handle, once registered.
 * - `raiseWhileDragged`: raise the node while dragged.
 * - `lifted`: whether a **Keyboard reorder** has the element lifted (ADR-0037): its `whileDrag`
 *   applies then too, as for a drag, with nothing else of the drag's (its `x`/`y` stay the spring's).
 * - `baseStyle`: style under the user's, above the drag defaults (the item's
 *   `touch-action`), read reactively.
 * - `tag`: the element's tag, set by `wardic.create(tag)`, so an svg-inner element's
 *   Starting style renders its attribute keys as attributes (ADR-0021; a `createWard`
 *   spread doesn't know its tag and stays all style).
 * - `brings` and `complete` (#511, ADR-0067): the Features the element brings, beside its section's,
 *   and whether it's a **Complete element**, which brings every one. None for a **Slim element**.
 */
export interface SpineInternals {
  readonly tag?: string | undefined
  /**
   * The element can never want a gesture (#525): its keys are fixed and it was given none of
   * `GESTURE_KEYS`. It starts no computation to watch for one.
   */
  readonly gestureless?: boolean | undefined
  readonly brings?: ReadonlyArray<Feature> | undefined
  readonly complete?: boolean | undefined
  /**
   * Whether the element's drag defaults go on it at mount too, for a `wardic.create(Component)`
   * wrap: its component may not pass the spread's `style` and `draggable` on (#253).
   */
  readonly defaultsOnElement?: boolean | undefined
  readonly dragAxis?: (() => boolean | "x" | "y") | undefined
  readonly onDragSample?: ((sample: Drag.Sample) => void) | undefined
  readonly onLayoutHandle?: ((handle: ProjectionSystem.NodeHandle) => void) | undefined
  readonly raiseWhileDragged?: boolean | undefined
  /** A `<Reorder>` item's: its Enter and Space are its **Keyboard reorder**'s (ADR-0037), so its press hears no keys (#427). */
  readonly keysTaken?: boolean | undefined
  readonly lifted?: Accessor<boolean> | undefined
  readonly baseStyle?: (() => JSX.CSSProperties | undefined) | undefined
}

export interface RunSpineOptions {
  /** The provider runtime the spine forks its fibers on. */
  readonly runtime: WardicRuntime
  /** The provider-owned flush gate (ADR-0006). */
  readonly gate: FlushGate.Shape
  /** SSR/hydration-stable gate id for this element's entry. */
  readonly id: string
  /** The element accessor; the spine is gated on it (started once defined). */
  readonly el: Accessor<HTMLElement | undefined>
  /** Reactive config accessor (animate / whileHover / whileTap / transition read reactively). */
  readonly cfg: Accessor<WardConfig>
  /**
   * The variant context this element inherits from (ADR-0007): its nearest ancestor's with
   * variants, for a Variant child (#50, `variant-node.ts`'s `inherited`), else `undefined`.
   * The spine reads `parent.variant()` reactively to resolve an INHERITED variant name against
   * THIS element's own `variants` (when no local `animate`), starts from `parent.initial` when
   * it has no `initial` of its own, and falls back to `parent.transition()` when this config
   * has no local transition.
   */
  readonly parent: WardicVariantContextValue | undefined
  /**
   * Called for EVERY emitted spine frame with that frame's `done` flag (ADR-0007
   * orchestration): true on the settling frame, false while moving. The owner
   * uses it to drive the `when` settle signals (a child reports to its parent's
   * registry; a parent reports its OWN settle for `beforeChildren`). Optional —
   * a root instance with no orchestration omits it.
   */
  readonly onFrame?: ((done: boolean) => void) | undefined
  /**
   * Per-Retarget reactive GATE on starting the spring (ADR-0007 `when`): when it
   * returns false the `on(target)` effect skips starting the primitive and
   * re-runs (the previous fiber is already interrupted, freezing the value at the
   * snapshot) once the accessor flips true. Optional — omitted = always start.
   * Read REACTIVELY inside the spine effect so a flip re-triggers the start.
   */
  readonly canStart?: (() => boolean) | undefined
  /** Its variant node's binding of its gesture states (#291): the names it hands its Variant children follow them. */
  readonly bindGestures?: ((states: Accessor<GestureStates>) => void) | undefined
  /**
   * Reactive extra delay (seconds) folded into the effective transition's
   * `delay` for the inherited-variant Retarget (ADR-0007 per-child stagger).
   * Read at Retarget time. Optional — omitted = no extra delay.
   */
  readonly extraDelay?: ((name: string | undefined) => number) | undefined
  /** A list's names orchestrated each on their own (#297's PR 2): the variant node's. */
  readonly byName?: NameOrchestration | undefined
  /** A `<Reorder>` item's additions (internal; see {@link SpineInternals}). */
  readonly internal?: SpineInternals | undefined
  /**
   * The surface's live user style, the `style` link of a key's Base value (ADR-0022): a
   * `createWard` spread's (the style last given to `ward(userProps)`, which is the live getter
   * on `wardic.*`), or `wardic.create(Component)`'s. Read untracked, at need: a style change
   * never Retargets on its own. Omitted on the directives, whose base is the element's own
   * value (its inline style included, read once).
   */
  readonly styleOf?: (() => object | string | undefined) | undefined
  /**
   * The element's routed `style` keys (#130, ADR-0043): its Live values and transform keys, which
   * the spine writes through the gate while nothing else owns them, and which a return follows.
   * Omitted on the directives, which have no `style` prop.
   */
  readonly live?: LiveStyle | undefined
  /**
   * Builds the {@link FlushSink} for the registered element: the element itself, plus, for a
   * surface whose `style` prop reaches it (`createWard`, `wardic.create(Component)`), the hooks
   * that switch that `style` (ADR-0034). The spine itself never reads the sink's hooks.
   */
  readonly makeSink: (el: HTMLElement) => FlushGate.Sink
  /**
   * Whether the element hydrates a server render (ADR-0021): its Appear animation, if the server
   * started one, is taken over at mount (#48, ADR-0044 decision 6). Omitted on the directives.
   */
  readonly hydrating?: boolean | undefined
  /** The element's tag, for its mount animation's spec (SVG's routing): `undefined` when it isn't known. */
  readonly tag?: string | undefined
  /** Its Features (#511), when its surface has read them already; else the spine reads them. */
  readonly features?: FeatureSection | undefined
  /**
   * Whether the element's drag defaults and base style reach it with its props: a `createWard`
   * spread's `style` and attributes. Otherwise the spine sets them on the element at mount (the
   * directives, and a `wardic.create(Component)` wrap, in case its component doesn't pass them
   * on).
   */
  readonly defaultsInProps?: boolean | undefined
  /**
   * Whether `element` comes after the last element this ward drove left the page (#414): it enters
   * fresh, as a mount does. Omitted where a ward only ever has one element (the directives).
   */
  readonly entersFresh?: ((element: HTMLElement) => boolean) | undefined
  /** Put the Starting style for `start` back on the element's `style` until its first commit (#414). */
  readonly restartStyle?: ((start: Start) => void) | undefined
  /** Its **Animation controls** (#433), when its `animate` is some: each change is its entry. */
  readonly controls?: Controls | undefined
}

/** An element's **Animation controls** on the Solid 1 binding (#433): the controls, and the change in effect, its signal. */
export interface Controls {
  readonly controls: WardicAnimationControls
  readonly change: Accessor<ControlsChange | undefined>
  readonly set: (change: ControlsChange) => void
}

/**
 * `given` with its `animate` read once (#433): **Animation controls** make each change they make its
 * entry, the config marked controlled; anything else leaves it as it is. Under a `WardicConfig`, its
 * **Config transition** is its own when it gives none (#434).
 */
export const controlledOf = (given: Accessor<WardConfig>): { readonly cfg: Accessor<WardConfig>; readonly controls: Controls | undefined } => {
  const configured = configuredOf(given, useWardicConfig())
  const animate = untrack(configured).animate
  if (Bool.not(isAnimationControls(animate))) return { cfg: configured, controls: undefined }
  const [change, set] = createSignal<ControlsChange | undefined>(undefined)
  return { cfg: () => controlledConfigOf(configured(), change()), controls: { controls: animate as WardicAnimationControls, change, set: (made) => set(() => made) } }
}

/**
 * `given` with its **Config transition** as its own when it gives none (#434, Motion's
 * `{ ...config, ...props }`), one object per change; `given` itself with no `WardicConfig` above.
 */
const configuredOf = (given: Accessor<WardConfig>, config: WardicConfigValue | undefined): Accessor<WardConfig> => {
  if (Predicate.isUndefined(config)) return given
  return createMemo(() => withConfigTransition(given(), config))
}

/** No change: an element without Animation controls. */
const NO_CHANGE: Accessor<ControlsChange | undefined> = constUndefined

/**
 * The fixed motion spine, factored out so both sink shapes share it (ADR-0006):
 *
 *   on(el) once-defined -> gate.register(id, makeSink(element)) -> recognizers
 *   (hover/press) -> override-stack memo from cfg() -> on(target) Retarget
 *   (springValues / animateValues seeded from the Snapshot ref) -> gate.write.
 *
 * The caller supplies `makeSink`: the gate commits the flushed `Patch` onto the element,
 * whichever surface owns it (ADR-0034). `initial` is read EXACTLY ONCE at setup (`untrack`) to seed the
 * spring's `from` Snapshot (ADR-0003); `animate` / `whileHover` / `whileTap` /
 * `transition` / `variants` are read reactively through `cfg()`.
 *
 * Must be called within a Solid owner (it registers `createEffect` / `onCleanup`).
 */
/**
 * Whether a ward's element waits off the page for its held child (#277, ADR-0048): its start queued
 * with the presence (`shown`, made only under one), cancelled with the effect's run.
 */
const heldBack = (presence: PresenceContextValue | undefined, element: HTMLElement, shown: (() => void) | undefined): boolean => {
  if (Predicate.isUndefined(shown)) return false
  const cancel = presenceHold(presence, element, shown)
  if (Predicate.isUndefined(cancel)) return false
  onCleanup(cancel)
  return true
}

/** A layout node on its way as its element mounted (#582): made by `arrive` if `layout` is here now. */
interface LateLayout {
  handle: ProjectionSystem.NodeHandle | undefined
  readonly arrive: () => void
}

/** An element's layout node now: made at its mount, or as `layout` arrived (#582). */
const layoutNodeOf = (atMount: ProjectionSystem.NodeHandle | undefined, later: LateLayout | undefined): ProjectionSystem.NodeHandle | undefined =>
  UndefinedOr.match(atMount, { onDefined: identity, onUndefined: () => UndefinedOr.match(later, { onDefined: (l) => l.handle, onUndefined: constUndefined }) })

export function runSpine(opts: RunSpineOptions): void {
  const { bindGestures, byName, canStart, cfg, controls, defaultsInProps, el, entersFresh, extraDelay, gate, hydrating, id, internal = NO_INTERNALS, live, makeSink, onFrame, parent, restartStyle, runtime, styleOf, tag } = opts
  // Its Features (#511, ADR-0067): its section's, and those it brings.
  const features = UndefinedOr.match(opts.features, { onDefined: identity, onUndefined: () => useElementFeatures(internal.brings, internal.complete === true) })
  // Its section's projection system, the `layout` Feature's (#511): `undefined` without it. Read now,
  // which builds the Features given to its section at once: the first element to ask builds them.
  const layoutProjection = projectionIn(untrack(features.services))
  // The provider's, once any section has built it: what its values register with.
  const builtProjection = useBuiltProjection()
  // Its Animation controls' change (#433), read with the Override stack: none without them.
  const ownChange = UndefinedOr.match(controls, { onUndefined: () => NO_CHANGE, onDefined: (c) => c.change })

  // The nearest <AnimatePresence>, or undefined at the root (ADR-0007). When
  // present, this spine publishes its live value-map (`snapshot`) + exit target
  // (`exit`) into a presence registration; the PARENT drives the exit on leave
  // (this child is disposed). The child does NOT unregister on its own
  // onCleanup — <AnimatePresence> owns removal after the exit settles.
  const presence = usePresenceContext()
  // The Layout group it's made in (#432): its `layoutId`'s namespace.
  const layoutGroup = useLayoutGroupId()

  // Whether reduced motion applies (ADR-0029), read at each Retarget.
  const reducedMotion = useWardicReducedMotion()
  // Whether its animations are skipped (#468): its nearest WardicConfig's, read as each starts.
  const skipAnimations = useWardicSkipAnimations()
  // Where its drag's and pan's points are (#443): its nearest WardicConfig's, read as each starts.
  const pagePoint = transformPagePointOf(useWardicConfig())
  const positionalKeys = useWardicPositionalKeys()
  // What a key with no transition of its own runs on (ADR-0051).
  const defaultTransition = useWardicDefaultTransition()

  // Starting style: resolved purely from the config read EXACTLY ONCE (untrack — no
  // reactive dependency, must not re-seed after mount), with the inherited `initial`
  // name for a Variant child that has none (#50). Seeds the spring `from` Snapshot so
  // frame 1 flows continuously out of it (no snap).
  const start = startOf(untrack(cfg), parent, presenceBlocksInitial(presence), untrack)
  const snapshot = snapshotOf(start)
  const reuse = makeReuse()
  // Where an element starts (#414): the ward's start, or, for one that comes after the last left the
  // page, a fresh one, as a mount after the first render's (no presence holds its `initial` back).
  // Its Snapshot goes back to it, and its Starting style comes back on until its first commit.
  const beginOf = (element: HTMLElement): Start => {
    if (Predicate.isUndefined(entersFresh)) return start
    if (Bool.not(entersFresh(element))) return start
    const fresh = startOf(untrack(cfg), parent, false, untrack)
    snapshot.values = { ...fresh.initialValues }
    snapshot.velocities = {}
    snapshot.drawnAt = {}
    if (Predicate.isNotUndefined(restartStyle)) restartStyle(fresh)
    return fresh
  }
  // The config and the user's style, as the spine reads them: untracked.
  const configNow = (): WardConfig => untrack(cfg)
  const styleNow = UndefinedOr.map(styleOf, (of) => () => untrack(of))

  // Inside a child `mode="wait"` holds off the page (#277, ADR-0048), everything starts once the child
  // is on it: `shown` ticks then, and the effect below runs again. Only under a presence: with none,
  // nothing is made or called here (a check per element at mount cost the first Retarget ~9% cold).
  let mountedOn: Accessor<HTMLElement | undefined> = el
  let shown: (() => void) | undefined
  if (Predicate.isNotUndefined(presence)) {
    const [ticked, tick] = createSignal<void>(undefined, { equals: false })
    shown = () => tick()
    mountedOn = () => {
      ticked()
      return el()
    }
  }

  // Start everything once the element mounts. createEffect(on(el, ...)) re-runs
  // only when the element identity changes; the spine inner-effect lives under
  // this owner so onCleanup teardown (gate.unregister + fiber interrupts) fires
  // on unmount.
  createEffect(
    on(mountedOn, (element) => {
      if (Predicate.isUndefined(element)) return
      // Held off the page: nothing starts until it's on it.
      if (heldBack(presence, element, shown)) return
      // Its start: the ward's, or a fresh one when it comes after the last element left (#414).
      const begin = beginOf(element)

      // Register the element with the caller-supplied sink (ADR-0006): each
      // flushed frame's Patch is committed onto it (ADR-0034). An element with `onUpdate` at mount
      // is told each committed frame (#233); any other never joins the gate's tells. While
      // hydrating, its Appear animation is found here, taken over by its first Retarget that
      // starts, and removed in its first commit (#48, ADR-0044 decision 6).
      const handoff = Bool.match(hydrating === true, { onTrue: () => Option.getOrUndefined(handoffOf(element)), onFalse: constUndefined })
      // Its Transform template (#443), drawn with its first write: the one at mount, then each other
      // one its config gives.
      const templateAtMount = untrack(cfg).transformTemplate
      let template = templateAtMount
      const registered = registeredValuesOf(templateAtMount)
      const unregister = gate.register(id, releasingAppear(withOnUpdate(makeSink(element), untrack(cfg).onUpdate, configNow), handoff, element), registered)
      onCleanup(unregister)

      // A surface whose props don't carry a drag element's defaults (ADR-0019 *Amendment
      // (Reorder)*): set each one the element's inline style doesn't already, and the
      // attribute unless it has one, once at mount.
      if (defaultsInProps !== true) {
        const base = internal.baseStyle
        if (Predicate.isNotUndefined(base)) {
          // The base style goes under the user's: a key the element's own inline style
          // sets at mount is the user's, and is never written.
          const own = new Set<string>(element.style)
          const write = (style: Record<string, unknown> | undefined): void => {
            if (Predicate.isUndefined(style)) return
            Arr.forEach(Rec.keys(style), (key) => {
              if (Bool.not(own.has(key))) element.style.setProperty(key, String(style[key]))
            })
          }
          // Written now, then on each change. Now, not in the effect's first run: that runs
          // just before this element's spine effect, whose first Retarget may read the
          // element's Own values (ADR-0022), so a list of items would alternate a write and a
          // read per item and force a style recalculation each (#47's mount measurement).
          write(untrack(base) as Record<string, unknown> | undefined)
          createEffect(on(base, (style) => write(style as Record<string, unknown> | undefined), { defer: true }))
        }
        UndefinedOr.map(dragDefaultsOf(untrack(cfg), internal), (defaults) => applyDragDefaults(element, defaults))
      }

      // Base values (ADR-0022): a key with no value starts from its `style` value, else its Own
      // value, read from the element once per key, at first need (D3).
      const links = startLinksOf(element, styleNow, live)

      // --- Presence registration (ADR-0007 exit) -------------------------------
      // Under an <AnimatePresence>, publish a live record so the PARENT can drive
      // this element's exit after Solid disposes its owner. `snapshot.current` is
      // updated to the latest emitted value-map EACH FRAME (so the exit departs
      // continuously from where the element rests); what its exit resolves from (#277: its `exit`,
      // `variants`, `custom` and transition) is kept current while it's alive, and resolved as it
      // leaves. The child does NOT call the disposer on its own
      // onCleanup — <AnimatePresence> removes the registration after the exit settles.
      let presenceRec: PresenceRecord | undefined
      // Where it starts when its child takes over from a leaver (#286): asked before its layout node
      // registers, which moves from the leaver's box, and before its first Retarget.
      let taken: PresenceSeed | undefined
      if (Predicate.isNotUndefined(presence)) {
        const exitConfig = { current: exitConfigOf(untrack(cfg), parent) }
        const rec = presenceRecordOf(element, begin, (custom, inherited) => exitTargetOf(exitConfig.current, custom, snapshot, inherited), links, presenceTreeOf(untrack(cfg)), snapshot, reducedMotion, skipAnimations)
        presenceRec = rec
        presence.register(rec)
        taken = presenceSeedOf(presence, element)
        createEffect(() => {
          exitConfig.current = exitConfigOf(cfg(), parent)
        })
      }
      const recordFrame = recordFrameOf(presenceRec)

      // Every element's values, by element, for the projection (ADR-0012 *Amendment (#137)*): a twin's
      // flight follows the translate and scale Wardic animates on its ancestors each frame.
      // None while no section has `layout`: there's no flight to follow them (#511).
      UndefinedOr.map(builtProjection(), (projection) => onCleanup(projection.registerValues(element, () => snapshot.values)))
      // Its exit is drawn through its template (#443): it rides in its presence record, whose drawn
      // values the projection reads as it leaves. A later one is written with the values it holds, so
      // the commit that may take its Starting style off holds them.
      // Nothing with none (#460): no follow, and nothing for its cleanup to run.
      if (Predicate.isNotUndefined(templateAtMount)) {
        recordFrame(registered as Values.Values)
        onCleanup(
          followTemplate(templateAtMount, () => cfg().transformTemplate, reactivity.watch, (next) => {
            template = next
            const values = { ...snapshot.values, [DomRenderer.TEMPLATE_KEY]: next }
            gate.write(id, values)
            recordFrame({ [DomRenderer.TEMPLATE_KEY]: next } as unknown as Values.Values)
          }),
        )
      }

      // --- Layout / shared-element / scroll projection (ADR-0009/0010/0012) ---
      // ONE projection node per element: `layout`, `layoutId`, and/or `layoutScroll`
      // feed the SAME node (no double registration). `layout` is a static enable
      // flag; `layoutId` (static, read once) enrols the node in the engine's
      // lead/follow stack (crossfade) and lets a twin disposed in the same task seed
      // it (a Switch, engine-side — ADR-0010 *Amendment (#13)*); `layoutScroll`
      // (static) marks it a scroll container whose scroll is folded out of its
      // descendants' boxes. All static,
      // read once — the reserved props layoutRoot/layoutAnchor remain typed-but-no-op
      // (P4).
      const c0 = untrack(cfg)
      // layout / layoutId / layoutScroll / layoutRoot each warrant a node; layoutAnchor
      // alone does not (it only tunes a node that already projects), but is forwarded.
      let layoutHandle: ProjectionSystem.NodeHandle | undefined
      // What every release runs on, the layout node's Release offset and the drag track's (ADR-0016, *Amendment (#140)*).
      const dragTransition = dragTransitionOf(c0.dragElastic, c0.dragTransition)
      // Its section's `layout` makes its node (#511): without it, its layout props do nothing, and
      // development says so once, unless `layout` is on its way.
      if (DEV && wantsLayoutNode(c0) && Predicate.isUndefined(layoutProjection) && Bool.not(untrack(features.pending))) {
        useFeatureRegistry().warnOnce("layout", missingMessage("layout", LAYOUT_PROPS, "@wardic/solid"))
      }
      // `layout` on its way (#582): its node is made as it arrives, under this owner, as Motion's is,
      // and measures from then on; nothing before it is replayed. A load that brings none gets
      // development's word then.
      let lateLayout: LateLayout | undefined
      if (wantsLayoutNode(c0)) {
        // What its node is made with, copied into this block: the closures here hold only these, so an
        // element with no layout prop keeps none of them (#551's lesson).
        const ward = {
          id,
          element,
          config: cfg,
          parent,
          snapshot,
          dragTransition,
          raiseWhileDragged: internal.raiseWhileDragged === true,
          layoutGroup,
          reducedMotion,
          skipAnimations,
          heldTransform: heldTransformFor(snapshot, templateAtMount, () => template),
        }
        const onLayoutHandle = internal.onLayoutHandle
        // Its node on `projection`, handed to a `<Reorder>` item's group; `takenNow`, where a child that
        // takes over from a leaver starts, at its mount only (#286).
        const layoutNodeOn = (projection: ProjectionSystem.Shape, takenNow: PresenceSeed | undefined): ProjectionSystem.NodeHandle => {
          const handle = projectionNodeOf(projection, layoutOptionsOf({ ...ward, taken: takenNow }))
          if (Predicate.isNotUndefined(onLayoutHandle)) onLayoutHandle(handle)
          return handle
        }
        if (Predicate.isNotUndefined(layoutProjection)) layoutHandle = layoutNodeOn(layoutProjection, taken)
        if (Predicate.isUndefined(layoutProjection) && untrack(features.pending)) {
          const owner = getOwner()
          const registry = useFeatureRegistry()
          const section = features
          const later: LateLayout = {
            handle: undefined,
            arrive: () => {
              if (Predicate.isNotUndefined(later.handle)) return
              UndefinedOr.match(projectionIn(section.services()), {
                onDefined: (arrived) => {
                  later.handle = runWithOwner(owner, () => untrack(() => layoutNodeOn(arrived, undefined)))
                },
                onUndefined: () => {
                  if (DEV && Bool.not(section.pending())) registry.warnOnce("layout", missingMessage("layout", LAYOUT_PROPS, "@wardic/solid"))
                },
              })
            },
          }
          lateLayout = later
          createComputed(later.arrive)
        }
      }

      // The app's gesture callbacks (#273, ADR-0047), each read from the config when it's called: made
      // at the first gesture that needs them, as most elements have none.
      let gestures: GestureCallbacks | undefined
      const gesturesOf = (): GestureCallbacks => {
        if (Predicate.isUndefined(gestures)) gestures = gestureCallbacksOf(runtime, id, () => untrack(cfg))
        return gestures
      }

      // --- Drag track (ADR-0004) ----------------------------------------------
      // When cfg().drag is truthy, run the binding-orchestrated drag track: the
      // pointer DIRECT-SETS x/y (1:1, not sprung) while the spring keeps driving
      // every other key + whileDrag. `dragging` is the ONLY reactive piece (it
      // gates the whileDrag override + the translate-key strip); the drag
      // CONFIG is static — read ONCE here (untrack), since drag config is a
      // document. The track's single fiber is scoped to this owner's onCleanup.
      const dragCfg = dragAxisOf(untrack(cfg), internal)
      const [dragging, setDragging] = createSignal(false)
      // Its hold on `x`/`y`, for the spine's Retargets (#340).
      let dragTrack: DragTrack | undefined
      // Its track's holder while `drag` is on its way (#551): the spine reads the track there, and
      // whether it drives the layout node (#582).
      let late: { track: DragTrack | undefined; projected: boolean } | undefined
      // Its section's `drag` Feature drives it (#511): without it, `drag` does nothing, and development
      // says so once, unless `drag` is on its way.
      const dragGesture = serviceIn(untrack(features.services), DragGesture)
      if (DEV && Predicate.isNotUndefined(dragCfg) && Predicate.isUndefined(dragGesture) && Bool.not(untrack(features.pending))) {
        useFeatureRegistry().warnOnce("drag", missingMessage("drag", GESTURE_WORDS.drag, "@wardic/solid"))
      }
      if (Predicate.isNotUndefined(dragCfg)) {
        // What the track is made with, copied into this block: a closure here holds only these, so an
        // element that never drags keeps none of them (#551).
        const axis = dragCfg
        const transition = dragTransition
        const setDrag = draggingWithWillChange(live, setDragging, element)
        const nodeAtMount = layoutHandle
        const nodeLater = lateLayout
        // It drives the layout node the element has as it's made, at mount or as `drag` arrives: a
        // node made later leaves it moving `x`/`y` (#582).
        const trackWith = (dragGesture: DragGesture["Service"]): DragTrack => {
          const projection = layoutNodeOf(nodeAtMount, nodeLater)
          const c0d = untrack(cfg)
          // Motion's `dragConstraints` (#273): a box of numbers, or a container measured against the element.
          const constraints = dragGesture.constraintsOf(c0d.dragConstraints, element, () => untrack(cfg).onMeasureDragConstraints, pagePoint)
          const trackConfig: DragTrackConfig = {
            axis,
            constraints: constraints.constraints,
            elastic: c0d.dragElastic,
            momentum: c0d.dragMomentum,
            snapToOrigin: c0d.dragSnapToOrigin,
            propagation: c0d.dragPropagation,
            directionLock: c0d.dragDirectionLock,
            transition,
            listen: c0d.dragListener,
          }
          return runDragTrackWith(dragGesture.drive, {
            runtime,
            gate,
            id,
            element,
            snapshot,
            recordFrame,
            // A drag's start turns its `style`'s will-change value on (#443).
            setDragging: setDrag,
            // A Batch member's element takes its transform from its Batch as its drag reads or writes it (#665).
            claim: claimForDrag(element),
            mapPoint: pagePoint,
            config: trackConfig,
            skipAnimations,
            container: constraints.container,
            controls: c0d.dragControls,
            // ADR-0016: a drag on a LAYOUT node feeds the projection, not its own x/y
            // (drawn on top, #363), so the dragged item follows the pointer and FLIPs to
            // its slot on release. Free drag (no handle) is unchanged.
            ...UndefinedOr.match(projection, { onUndefined: () => ({}), onDefined: (node) => ({ projection: node }) }),
            ...UndefinedOr.match(internal.dragAxis, { onUndefined: () => ({}), onDefined: (axisAt) => ({ axisAt }) }),
            // Its samples to a `<Reorder>` item's group, and to the app's drag callbacks (#273).
            onSample: UndefinedOr.match(internal.onDragSample, {
              onUndefined: () => gesturesOf().dragged,
              onDefined: (onSample) => {
                const { dragged } = gesturesOf()
                return (sample: Drag.Sample) => {
                  onSample(sample)
                  dragged(sample)
                }
              },
            }),
            onReleaseEnd: gesturesOf().released,
          })
        }
        if (Predicate.isNotUndefined(dragGesture)) dragTrack = trackWith(dragGesture)
        // `drag` on its way (#551): the track starts as it arrives, from then on, as a gesture's
        // recognizer does, under this owner; nothing before it is replayed. A load that brings none
        // gets development's word then.
        if (Predicate.isUndefined(dragGesture) && untrack(features.pending)) {
          const held: { track: DragTrack | undefined; projected: boolean } = { track: undefined, projected: false }
          late = held
          const owner = getOwner()
          const registry = useFeatureRegistry()
          const section = features
          createComputed(() => {
            if (Predicate.isNotUndefined(held.track)) return
            UndefinedOr.match(serviceIn(section.services(), DragGesture), {
              onDefined: (arrived) => {
                // A `layout` from the same load makes its node first, so the track drives it (#582).
                if (Predicate.isNotUndefined(nodeLater)) nodeLater.arrive()
                held.projected = Predicate.isNotUndefined(layoutNodeOf(nodeAtMount, nodeLater))
                held.track = runWithOwner(owner, () => untrack(() => trackWith(arrived)))
              },
              onUndefined: () => {
                if (DEV && Bool.not(section.pending())) registry.warnOnce("drag", missingMessage("drag", GESTURE_WORDS.drag, "@wardic/solid"))
              },
            })
          })
        }
      }

      // Recognizers over the live element, each started the first time its config wants it, as
      // Motion's features are (#87, ADR-0040; #273): `whileHover` or a hover callback, `whileTap` or a
      // tap callback, a pan callback. Each hover and press transition sets its layer; each event is
      // told to the app's callbacks, at the event. Their fibers are scoped to this owner's onCleanup
      // (runScoped). Until started, a layer reads false.
      // Each through its section's Feature (#511), read with the config, so one that arrives lazily
      // starts what the config wants of it from then on.
      const gestureOf = <I, S>(key: Context.Key<I, S>): S => UndefinedOr.getOrThrow(serviceIn(untrack(features.services), key))
      // An element that can never want one watches for none (#525): no computation an element.
      let started: Accessor<Started> = NEVER_STARTED
      if (internal.gestureless !== true) started = createWhenWanted(() => ({ config: cfg(), services: features.services() }), WANTS, {
        hover: () =>
          watchToSignal<boolean>(
            ({ on, onDefect }) =>
              gestureOf(HoverGesture).watch(element, {
                on: (transition) => {
                  gesturesOf().hovered(transition)
                  on(transition.active)
                },
                onDefect,
              }),
            false,
          ),
        press: () =>
          watchToSignal<boolean>(
            ({ on, onDefect }) =>
              gestureOf(PressGesture).watch(
                element,
                {
                  on: (press) => {
                    gesturesOf().pressed(press, element)
                    on(press.phase === "start")
                  },
                  onDefect,
                },
                internal.keysTaken === true,
                () => tapPropagates(untrack(cfg).propagate),
              ),
            false,
          ),
        // In view as its `viewport` says, read when it starts; each transition told to the viewport callbacks.
        inView: () =>
          watchToSignal<boolean>(
            ({ on, onDefect }) =>
              gestureOf(InViewGesture).watch(element, inViewOptionsOf(untrack(cfg).viewport), {
                on: (transition) => {
                  gesturesOf().viewed(transition)
                  on(transition.active)
                },
                onDefect,
              }),
            false,
          ),
        // Focused as the browser shows it (`:focus-visible`, Motion's `whileFocus`).
        focus: () => watchToSignal<boolean>((handlers) => gestureOf(FocusGesture).watch(element, { visible: true }, handlers), false),
        pan: () => runWatch(runtime, (onDefect) => gestureOf(PanGesture).watch(element, { on: (sample) => gesturesOf().panned(sample), onDefect }, { mapPoint: pointMapOptionOf(pagePoint) })),
      })
      if (DEV && internal.complete !== true && internal.gestureless !== true) warnMissingGestures(useFeatureRegistry(), features, cfg)

      // Its gesture states: the started recognizers, one tracked read, then each started one's state.
      // A keyboard lift turns `whileDrag` on, as a drag does (ADR-0037).
      const lifted = internal.lifted
      const active = (): Active => {
        const held = dragging()
        const layers = started()
        return {
          inView: stateOf(layers.inView),
          focused: stateOf(layers.focus),
          hovered: stateOf(layers.hover),
          pressed: stateOf(layers.press),
          dragged: Bool.or(held, Predicate.isNotUndefined(lifted) && lifted()),
          dragging: held,
        }
      }
      // The Override stack (`resolutionOf`), compared by value, as Solid 2's (#470): a reactive config
      // change, a recognizer's flip or the drag's recomputes it, and only one that resolves a new
      // target drives a Retarget. A `transition`, a callback or an option alone tells nothing, as
      // Motion's doesn't.
      const target = createMemo((): Resolution => resolutionOf(cfg(), parent, begin.initialLink, active(), snapshot, ownChange()), undefined, { equals: sameResolution })
      // A colour only the `colors` Feature reads, on a Slim element without it (#511, decision 7): said
      // once per provider, in development only, and not while a lazy load is on its way.
      if (DEV && internal.complete !== true) warnUnreadColors(useFeatureRegistry(), features, () => target().resolved)
      // Its gesture states, for the names its variant node hands down (#291): read from the gestures
      // themselves, as a gesture whose layer resolves nothing new leaves the target as it was.
      if (Predicate.isNotUndefined(bindGestures)) bindGestures(active)

      // The spine (`spine.ts`): on each target change, end the running legs and reseed a fresh
      // primitive from the Snapshot (velocity-preserving), into the gate.
      const spineOptions: ElementSpineOptions = {
        runtime,
        gate,
        id,
        element,
        tag,
        config: configNow,
        parent,
        canStart,
        extraDelay,
        byName,
        onFrame,
        reducedMotion,
        skipAnimations,
        positionalKeys,
        defaultTransition,
        start: begin,
        snapshot,
        reuse,
        links,
        styleNow,
        live,
        presence: presenceRec,
        projected: Predicate.isNotUndefined(layoutHandle),
        dragAxis: dragCfg,
        drag: dragTrack,
        handoff,
        // Motion's onAnimationStart / onAnimationComplete (#257).
        animation: animationCallbacks(runtime, id),
      }
      // A track that starts once `drag` arrives (#551) is read at each Retarget from then on: only
      // then is `drag` a getter, so an element that has it at mount, or never wants it, pays nothing.
      if (Predicate.isNotUndefined(late)) {
        const held = late
        Object.defineProperty(spineOptions, "drag", { get: () => held.track })
        // Whether that track drives the layout node (#582): until it starts, whether the element has one.
        const nodeAtMount = layoutHandle
        const nodeLater = lateLayout
        Object.defineProperty(spineOptions, "projected", {
          get: () =>
            UndefinedOr.match(held.track, { onUndefined: () => Predicate.isNotUndefined(layoutNodeOf(nodeAtMount, nodeLater)), onDefined: () => held.projected }),
        })
      }
      const spine = makeElementSpine(spineOptions)
      onCleanup(spine.dispose)
      // Its Imperative animations (#433) go through its spine while it's mounted.
      onCleanup(registerAnimatable(element, spine))
      // Its Animation controls (#433) reach it while it's mounted.
      UndefinedOr.map(controls, (c) => onCleanup(subscribe(c.controls, controlledElement(c.set, { custom: () => untrack(cfg).custom, snapshot }, spine.stop))))
      // A child back under its key starts where its leaver is drawn (#286), before its first Retarget.
      if (Predicate.isNotUndefined(taken)) spine.seed(taken)

      // The spine effect depends on BOTH `target` and `canStart` (ADR-0007 `when`):
      // Solid's `on` runs its callback under `untrack`, so the gate accessor MUST
      // be an explicit dependency for a gate flip (false -> true) to RE-RUN this
      // effect and release the held Retarget. `target` already depends on cfg() +
      // parent.variant(); adding canStart() releases the gate without restarting on
      // every frame (canStart only changes on settle-signal flips, not per frame).
      createEffect(
        on(
          () => {
            const t = target()
            // Track the gate so its flips re-run this effect (value unused).
            if (Predicate.isNotUndefined(canStart)) canStart()
            return t
          },
          spine.retarget,
        ),
      )

      // Live values in `style` (#130, ADR-0043): followed from the first routed key on.
      spine.follow({ resolved: () => untrack(target).resolved, dragging: () => untrack(dragging) })
    }),
  )
}

/**
 * Says, once per provider and gesture, that the element wants a gesture its section has no Feature for
 * (#511, ADR-0067 decision 7): outside a lazy load. Development only (its caller's `DEV`).
 */
const warnMissingGestures = (registry: FeatureRegistry, features: FeatureSection, config: Accessor<WardConfig>): void => {
  createEffect(() => {
    const c = config()
    const services = features.services()
    if (features.pending()) return
    Arr.forEach(GESTURE_FEATURES, ([name, wants, key]) => {
      if (wants(c) && Bool.not(hasService(services, key))) registry.warnOnce(name, missingMessage(name, GESTURE_WORDS[name], "@wardic/solid"))
    })
  })
}

/**
 * Says, once per provider, that a colour of the element's needs the `colors` Feature (#511, ADR-0067
 * decision 7): a value naming a wide-gamut space, while the page reads none, outside a lazy load.
 * Development only (its caller's `DEV`).
 */
const warnUnreadColors = (registry: FeatureRegistry, features: FeatureSection, values: Accessor<Values.Values>): void => {
  createEffect(() => {
    const unread = unreadColorIn(values())
    if (Predicate.isUndefined(unread) || features.pending()) return
    registry.warnOnce("colors", missingMessage("colors", `The colour \`${unread}\``, "@wardic/solid"))
  })
}


/**
 * {@link createWard} with a `<Reorder>` item's additions (internal, ADR-0020; not
 * exported from the package).
 */
export function createWardWith(config: WardConfig | Accessor<WardConfig>, internal: SpineInternals = NO_INTERNALS): Ward {
  const runtime = useWardicRuntime()
  // Its Features (#511, ADR-0067), a Complete element's every one: what they register, a server
  // render's elements read too (the `colors` Feature's spaces).
  const features = useElementFeatures(internal.brings, internal.complete === true)
  // A server render takes the lean path: the Starting style only, no spine (ADR-0021).
  if (isServer) return serverWard(config, internal)
  const gate = useWardicGate()
  // Owner-scoped, SSR/hydration-stable unique id for this element's gate entry
  // (Solid's createUniqueId, not a module counter — see ADR note / no global state).
  const id = createUniqueId()

  // Normalize to an Accessor<WardConfig>. A WardConfig is always an object,
  // so `typeof config === "function"` is a safe discriminant for the accessor. With Animation
  // controls for its `animate` (#433), each change they make is its entry.
  const { cfg, controls } = controlledOf(accessorOf(config))

  // Its place in variant orchestration (ADR-0007, #50): what it hands its children, and,
  // as a Variant child, the ancestor it inherits from and joins (its stagger slot, its
  // `when`). Read at hook-call time (component body owner), for this instance's lifetime.
  const node = createVariantNode(cfg, useVariantContext(), UndefinedOr.map(controls, (c) => c.change))

  // The Renderer's PURE project (ADR-0003: synchronous, no engine), read once by the provider (#618, M1).
  const { project } = useWardicRenderer()

  // Starting style: resolved purely from the config read EXACTLY ONCE (untrack — no
  // reactive dependency, must not re-seed after mount), with the inherited `initial`
  // name for a Variant child that has none (#50). It's the `style` until the first
  // commit, so pre-mount render carries the initial style (no flash).
  const initialConfig = untrack(cfg)
  const presence = usePresenceContext()
  const initialValues = startingValuesOf(initialConfig, node.inherited, presenceBlocksInitial(presence), untrack)
  // A layout node's is drawn through its projection at rest, as its first commit draws it (#245).
  const layoutNode = isLayoutNode(initialConfig)
  const drawnStart = drawnAtRest(initialValues, layoutNode, initialConfig.transformTemplate)

  // The Starting style: the projected SSR initial, carried by `style` until the gate's
  // first commit (ADR-0021 decision 6, ADR-0034). An svg-inner tag's attribute keys are
  // split off and set once as attributes, as the server renders them (ADR-0021); the
  // gate's commits take over at mount. While hydrating, it's what the server rendered, the
  // DOM's project (the Hydration hold, ADR-0021 decision 2): the Environment's Renderer
  // takes over at the first frame, and a different Starting style from it is noted once
  // (cold path).
  const projected = project(drawnStart)
  const hydrating = isHydrating()
  const startingPatch = Bool.match(hydrating, { onTrue: () => DomRenderer.project(drawnStart), onFalse: () => projected })
  if (hydrating) flagStartingStyle(runtime, id, startingPatch, projected)
  const seed = Svg.splitPatchForTag(internal.tag, startingPatch)

  // Its routed `style` keys (#130, ADR-0043): its Live values and transform keys, which the gate
  // writes from mount, and the Starting style carries until then, under `initial`'s.
  const live = createLiveStyle({ registry: registryOf(runtime), onDroppedTransform: () => warnDroppedTransform(runtime, id), reactivity })
  const projectStarting = Bool.match(hydrating, { onTrue: () => DomRenderer.project, onFalse: () => project })
  const startingWith = (routed: Values.Values): Renderer.Patch =>
    Svg.splitPatchForTag(internal.tag, projectStarting(drawnAtRest({ ...routed, ...initialValues }, layoutNode, initialConfig.transformTemplate))).style

  // A drag element's defaults (ADR-0019 *Amendment (Reorder)*), under the user's
  // style: `drag` is static, so they're chosen once.
  const dragDefaults = dragDefaultsOf(untrack(cfg), internal)
  const baseStyle = internal.baseStyle

  // The props `ward(userProps)` was last called with: their `style` is this element's style
  // link (ADR-0022), read untracked at need (the live getter on `wardic.*`), and its
  // fallback once the gate commits (ADR-0034).
  let lastUserProps: WardUserProps = NO_USER_PROPS
  const elementStyle = createElementStyle({
    userStyle: () => lastUserProps.style,
    starting: seed.style,
    startingWith,
    live,
    defaults: dragDefaults,
    base: baseStyle,
    reactivity,
  })

  // The element, available only after ref-mount. The spine is gated on it. Under a presence, it's
  // told as it's made (#286): its `key`, and whether it's a twin. With none, nothing is made here.
  const [el, setEl] = createSignal<HTMLElement>()
  // The last element its ref was given, and one given after that one left the page, which enters
  // fresh (#414). Read as the ref is called, before Solid inserts the element: one replacing the last
  // in the same update finds it still on the page, and carries on.
  let refd: HTMLElement | undefined
  let fresh: HTMLElement | undefined
  const refElement = (element: HTMLElement): void => {
    if (Predicate.isNotUndefined(refd) && refd !== element && Bool.not(refd.isConnected)) fresh = element
    refd = element
    setEl(element)
  }
  const setElement = madeWith(presence, refElement, initialConfig)

  // Run the shared spine: the gate commits each flushed Patch onto this element
  // (ADR-0006, ADR-0034), and the sink's hooks switch its `style`. Its variant node
  // wires the orchestration (ADR-0007, #50): the context it inherits names from, its
  // stagger delay as a Variant child, the `when` gates on its start, and its settle report.
  runSpine({
    runtime,
    gate,
    id,
    el,
    cfg,
    controls,
    parent: node.inherited,
    extraDelay: node.extraDelay,
    byName: node.names,
    canStart: node.canStart,
    bindGestures: node.bindGestures,
    onFrame: node.onFrame,
    internal,
    styleOf: () => lastUserProps.style,
    live,
    // The gate commits onto the element (an svg-inner element's attribute keys as
    // attributes, ADR-0014); the hooks switch the spread's `style` (ADR-0034).
    makeSink: (element) => ({ target: element, ...elementStyle.hooks }),
    // The spread's `style` and attributes carry the drag defaults and the base style, unless
    // they reach a wrapped component, which may not pass them on (#253).
    defaultsInProps: internal.defaultsOnElement !== true,
    hydrating,
    tag: internal.tag,
    entersFresh: (element) => element === fresh,
    restartStyle: (start) =>
      elementStyle.restart(Svg.splitPatchForTag(internal.tag, project(drawnAtRest(start.initialValues, layoutNode, untrack(cfg).transformTemplate))).style),
    features,
  })

  // `<ward.Provider>` publishes what this instance hands its children (#50): its own
  // variant context, its parent's passed through, or none.
  const Provider: Component<{ readonly children?: JSX.Element }> = (props) => (
    <WardicVariantContext.Provider value={node.provided}>{props.children}</WardicVariantContext.Provider>
  )

  // The element's value per key (#130, ADR-0043 decision 5): the gate's output while it holds the
  // key, else where the key rests, read when the accessor is (the user's style as last given, a
  // reactive `style` prop tracked).
  const restingValueOf = (key: string): unknown => restingOf(key, initialValues, lastUserProps.style, (raw) => live.read(raw))
  // One accessor a key, made on first ask: most elements ask none.
  let values: Map<string, Accessor<unknown>> | undefined
  const value = (key: string): Accessor<unknown> => {
    if (Predicate.isUndefined(values)) values = new Map()
    const known = values.get(key)
    if (Predicate.isNotUndefined(known)) return known
    const shown = fromAtom(gate.valueOf(id, key))
    const accessor = (): unknown => UndefinedOr.match(shown(), { onUndefined: () => restingValueOf(key), onDefined: identity })
    values.set(key, accessor)
    return accessor
  }

  // The callable + its `.Provider` property (ADR-0007). Object.assign keeps the
  // callable's merge API (ward() / ward({ ref, style })) intact while attaching
  // Provider as a property, and the cast aligns it with the `Ward` type.
  const ward: Ward = Object.assign(
    (userProps: WardUserProps = NO_USER_PROPS): WardProps => {
      lastUserProps = userProps
      return {
        // Merge the user's ref (if any) with ward's internal element setter so BOTH
        // are invoked with the live element on mount (Option A).
        ref: mergeRefs(userProps.ref, setElement),
        // Getter so spreading {...ward()} stays reactive (Solid tracks the access): the
        // Starting style over the user's until the first commit, then the user's without the
        // keys the gate holds (ADR-0034). It never changes per frame.
        get style() {
          return elementStyle.style(userProps.style) as JSX.CSSProperties
        },
        ...seed.attrs,
        ...UndefinedOr.match(dragDefaults, { onUndefined: () => ({}), onDefined: () => Style.DRAG_DEFAULT_ATTRIBUTES }),
      }
    },
    { Provider, value: value as WardValue, atom: (key: string) => gate.valueOf(id, key) },
  )
  return ward
}

/** A server's output Atom: nothing is written there, so it stays `undefined`. */
const NO_OUTPUT: Atom.Atom<unknown> = Atom.make<unknown>(undefined)

/**
 * {@link createWardWith} during a server render (ADR-0021, decisions 1 and 4): the element's
 * Starting style and static attributes, computed purely, and nothing else: no runtime, no
 * spine, no signals. Hydration keys must land where the client's render puts them, so it
 * makes the client's one `createUniqueId` call in the same place, and its `.Provider`
 * renders the same component nesting, with a variant context that carries the names and
 * transitions but no orchestration.
 */
const serverWard = (config: WardConfig | Accessor<WardConfig>, internal: SpineInternals = NO_INTERNALS): Ward => {
  // The client's gate id: keeps every later hydration key in step.
  createUniqueId()
  // Animation controls (#433) set nothing on a server: no entry yet, and controlled, as on the client.
  const c = uncontrolledOf(withConfigTransition(accessorOf(config)(), useWardicConfig()))
  // The same names the client hands down, read once, with orchestration that does nothing
  // (#50); a Variant child's Starting style starts from its ancestor's `initial` name.
  const node = serverVariantNode(c, useVariantContext())
  const layoutNode = isLayoutNode(c)
  const seed = Style.starting(internal.tag, drawnAtRest(startingValuesOf(c, node.inherited, presenceBlocksInitial(usePresenceContext()), untrack), layoutNode, c.transformTemplate))
  const dragDefaults = dragDefaultsOf(c, internal)
  const initialValues = startingValuesOf(c, node.inherited, presenceBlocksInitial(usePresenceContext()), untrack)
  // Its Appear animation (#48, ADR-0044): its slot in the render's, and the group its Variant
  // children join when it leads one.
  const appear = serverAppearOf(c, internal.tag, initialValues, node, startsQuiet(c, node.inherited, presenceBlocksInitial(usePresenceContext()), untrack))
  const Provider: Component<{ readonly children?: JSX.Element }> = (props) => (
    <WardicVariantContext.Provider value={appear.provided}>{props.children}</WardicVariantContext.Provider>
  )
  const read = (value: unknown): unknown => readServerStyle(value)
  let lastStyle: WardUserProps["style"]
  const ward = Object.assign(
    (userProps: WardUserProps = NO_USER_PROPS): WardProps => {
      lastStyle = userProps.style
      // Its routed keys' values join the Starting style, under `initial`'s (#130).
      const parts = split(userProps.style)
      // A style with its own `animation` keeps it: the element's Appear animation would take its place.
      const ownAnimation = setsAnimation(parts.css)
      if (ownAnimation) appear.veto("its own style sets an animation")
      return {
        ref: UndefinedOr.match(userProps.ref, { onUndefined: () => noRef, onDefined: identity }),
        style: pipe(
          serverStartingStyle(internal.tag, seed.style, initialValues, parts.routed, layoutNode, untrack, c.transformTemplate),
          Style.over(parts.css),
          Style.over(UndefinedOr.match(internal.baseStyle, { onUndefined: constUndefined, onDefined: (base) => base() })),
          Style.over(dragDefaults),
          Style.over(Bool.match(ownAnimation, { onTrue: constUndefined, onFalse: () => appear.style })),
        ) as JSX.CSSProperties,
        ...seed.attrs,
        ...UndefinedOr.match(dragDefaults, { onUndefined: () => ({}), onDefined: () => Style.DRAG_DEFAULT_ATTRIBUTES }),
      }
    },
    {
      Provider,
      value: ((key: string) => () => restingOf(key, initialValues, lastStyle, read)) as WardValue,
      atom: (): Atom.Atom<unknown> => NO_OUTPUT,
      [SERVER_APPEAR]: appear,
    },
  )
  return ward
}

/**
 * A server element's subtree, rendered inside its Appear entry (#245): a late chunk's root puts the
 * chunk's `<style>` after itself, server text its client doesn't render (the provider moves it into
 * the head before the chunk hydrates, `Appear.adoptChunks`). Per element on a server: an element in
 * the shell, most, renders as it is, with guards and no allocation.
 */
export const renderServerElement = (appear: ServerAppearOf | undefined, render: () => JSX.Element): JSX.Element => {
  if (Predicate.isUndefined(appear) || Bool.not(appear.late) || Predicate.isUndefined(appear.state)) return render()
  const state = appear.state
  const element = state.within(true, render)
  if (Bool.not(appear.chunkRoot)) return element
  return [element, () => ({ t: state.chunk() })] as unknown as JSX.Element
}

/** Where a server ward keeps its Appear entry, for the `wardic.<tag>` that renders it (#245). Internal. */
const SERVER_APPEAR = Symbol("wardic.serverAppear")

/** A server ward's Appear entry (#245); `undefined` for a client one. Internal. */
export const serverAppearOfWard = (ward: Ward): ServerAppearOf | undefined => (ward as Ward & { readonly [SERVER_APPEAR]?: ServerAppearOf })[SERVER_APPEAR]

/** {@link appearEntryOf} with this provider's Appear state (#48, ADR-0044) and its nearest `WardicConfig`'s reduced motion (#434). */
export const serverAppearOf = (c: WardConfig, tag: string | undefined, initialValues: Values.Values, node: ServerVariantNode, quiet: boolean): ServerAppearOf =>
  appearEntryOf(useWardicAppear(), c, tag, initialValues, node, quiet, settingOf(useWardicConfig()), useWardicSkipAnimations()())

/** A style value read on a server: an Atom through a server's own registry, an accessor called (#130). */
const readServerStyle = (value: unknown): unknown => readLive(value, serverRegistryOf, untrack)

/** A server render's `ref`: Solid never calls it there. */
const noRef = (): void => {}
