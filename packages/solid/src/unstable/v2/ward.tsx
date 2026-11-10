/**
 * `ward(config)`: a **Ward** on Solid 2 (`@wardic/solid/unstable/v2`, #209, ADR-0045). It puts one
 * element's motion on the Solid 1 binding's spine (`../../spine.ts`): the same Override stack,
 * Retarget, Base values and flush gate (ADR-0005, ADR-0022, ADR-0034), wired into Solid 2.
 *
 * A ward is a ref that carries its props:
 *
 * ```tsx
 * const card = ward({ animate: () => ({ x: open() ? 100 : 0 }) }) // in the component's body
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
 * - **Its config is read once, each key through an accessor where it changes** (or getters, as a
 *   component's props are): `ward({ animate: () => ({ … }) })`. A whole config as one accessor,
 *   `ward(() => ({ … }))`, throws, naming that form.
 * - **It mounts in an effect.** Every primitive is made at setup, under the ward's owner. The ref,
 *   called during render, sets the element; an effect's apply mounts it (registers it with the
 *   gate, builds its spine) and Retargets on each change of its target or of its `when` gate.
 *   Solid 2's apply has no owner, so what a mount makes (a Live value's watch) is made under the
 *   ward's.
 * - **Its target is compared by value** (`sameResolution`), as the Solid 1 binding's is (#470): a
 *   `style` or `transition` change in its config doesn't Retarget, as Motion's doesn't; a new variant
 *   name does, and so does a gesture layer that sets something turning on or off.
 * - **Given to a component** (#349, ADR-0046 *Amendment (#349)*): a Wardic component's `wardRef`
 *   takes a ward, and drives its element with a ward of its own for each element, its *driving
 *   ward*: on this one's config, variant node and lifecycle, under the component's presence and with
 *   its tag. This one follows its driver (`read`, `atom`, a `next`'s gestures) while its element is
 *   mounted, one at a time, and is never mounted itself. `ward(config, { parent })` names its
 *   variant parent when it's made outside the tree. A ward on two elements on the page at once,
 *   given or spread, throws.
 * - **Presence and layout** (PR 2 of #209): under an `<AnimatePresence>` the mount registers its exit
 *   record, kept current from its config's `exit`; a `layout`, `layoutId`, `layoutScroll` or
 *   `layoutRoot` element registers one projection node (`layout-member.ts`), re-measured when its
 *   `layoutDependency` changes. A layout node's Starting style is drawn through its projection at
 *   rest, as its first commit draws it (#245).
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import type * as InputFeed from "@wardic/core/InputFeed"
import { tapPropagates } from "../../press.ts"
import * as Report from "@wardic/dom/Report"
import * as Renderer from "@wardic/core/Renderer"
import type * as Values from "@wardic/core/Values"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Style from "@wardic/dom/Style"
import * as Svg from "@wardic/dom/Svg"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import type * as Context from "effect/Context"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import { constFalse, constTrue, constUndefined, constVoid, identity, pipe } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Atom from "effect/reactivity/Atom"
import { isServer, type JSX, useHead } from "@solidjs/web"
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  DEV,
  getOwner,
  isHydrating,
  type Owner,
  onCleanup,
  runWithOwner,
  type Signal,
  untrack,
} from "solid-js"
import type { WardConfig as SharedWardConfig, WardicValues } from "../../config.ts"
import { MOTION_PROPS_V2, type SolidOneCallback } from "../../motion-props.ts"
import * as OwnerScope from "../../owner-scope.ts"





import { GESTURE_WORDS, serviceIn } from "../../gesture-features.ts"
import { inViewOptionsOf } from "../../gesture-callbacks.ts"
import { projectionIn, type WardicServices } from "../../runtime.ts"
import type { WardCheckedConfig, WardKey, WardValueOf } from "../../ward-keys.ts"
import { createElementStyle } from "../../element-style.ts"
import { createLiveStyle, type LiveSource, readLive, serverRegistryOf, split } from "../../live-style.ts"
import { dragTransitionOf } from "../../drag-transition.ts"
import { layoutOptionsOf, registrationOf, wantsLayoutNode } from "../../layout-member.ts"
import { useLayoutGroupId } from "./layout.tsx"
import { registerAnimatable } from "../../imperative.ts"
import { type ControlsChange, controlledConfigOf, controlledElement, isAnimationControls, subscribe, uncontrolledOf, type WardicAnimationControls } from "../../animation-controls.ts"
import { settingOf, type WardicConfigValue } from "../../wardic-config-value.ts"
import { type PresenceSeed, presenceBlocksInitial, presenceHold, presenceSeedOf } from "../../presence-record.ts"
import { handoffOf, setsAnimation } from "../../appear.ts"
import {
  appearEntryOf,
  applyDragDefaults,
  dragAxisOf,
  dragDefaultsOf,
  draggingWithWillChange,
  drawnAtRest,
  followTemplate,
  heldTransformFor,
  registeredValuesOf,
  type ElementSpine,
  type ElementSpineOptions,
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
import { inheritedContext, serverVariantNode, startsAtAnimate, startsQuiet, type WardicVariantContextValue } from "../../variant-tree.ts"
import { followAtom } from "./bridge.ts"
import {
  appearStyle,
  useWardicAppear,
  useWardicGate,
  useWardicPositionalKeys,
  useWardicDefaultTransition,
  useBuiltProjection,
  useWardicReducedMotion,
  useWardicRenderer,
  useWardicRuntime,
  useWardicSkipAnimations,
  useElementFeatures,
  useFeatureRegistry,
} from "./provider.tsx"
import { type Feature, type FeatureRegistry, type FeatureSection, LAYOUT_PROPS, missingMessage, unreadColorIn } from "../../feature.ts"
import { CLIENT_ONLY, CLIENT_ONLY_DEFERRED, CLIENT_ONLY_SYNC, CLIENT_ONLY_SYNC_DEFERRED, reactivityIn } from "./solid-reactivity.ts"
import { useWardicConfig } from "./wardic-config.tsx"
import { pointMapOptionOf, transformPagePointOf } from "../../wardic-config-value.ts"
import { configView, type Fixed, type PerKey, type PerKeyApart } from "./config-view.ts"
import { Lifecycle, type WardEvent, type WardEvents, type WardPressInfo, type WardSettled } from "./lifecycle.ts"
import { neverLands, NO_EVENTS, serverWhen } from "./waiters.ts"
import { usePresenceContext } from "./presence.tsx"
import { createVariantNode, useVariantContext, type VariantNode, WardicVariantContext } from "./variant-node.ts"
import type { DragTrack } from "../../drag-track.ts"
import { DragGesture, FocusGesture, HoverGesture, InViewGesture, PanGesture, PressGesture } from "../../features/keys.ts"

/**
 * A Wardic element's `style`: every CSS property and the transform keys (`x`,
 * `scale`, `rotate`…), each a value or a **Live value**: an `effect/reactivity` Atom, or an
 * accessor, uncalled (a signal, a memo, a ward's `read(key)`). A called value is a resting value:
 * the element shows it at rest, and a return goes to where it is then. A Live value reading
 * `undefined` (a ward's `read(key)` for a key with no value) leaves the key where it is.
 */
export type WardStyle = { readonly [K in keyof WardicValues]?: WardicValues[K] | LiveSource<number | string | undefined> | undefined }

/** A ward's config values: the element's motion, and its `style`. */
export interface WardConfigValues extends Omit<SharedWardConfig, SolidOneCallback> {
  /**
   * The element's style: Wardic's animated keys go over it, and a key no layer of the Override
   * stack sets returns to it. Its Live values are followed through the gate.
   */
  readonly style?: WardStyle | string | undefined
}

/**
 * The config keys whose values are functions: read as they are, never called as accessors (#259).
 * `dragConstraints`' function is its container's accessor (#273), read at each measure; a
 * `transformTemplate` is called by the renderer (#443).
 */
type WardCallbackKey = "onUpdate" | "dragConstraints" | "onMeasureDragConstraints" | "transformTemplate" | "onBeforeLayoutMeasure" | "onLayoutMeasure"

/**
 * A ward's config: each key a value, or an accessor of it, read per key. A getter,
 * a store's property or a component's prop is tracked as it's read, and an accessor is called as
 * it's read, so a change re-runs only what reads that key; a plain value is a constant. `initial`,
 * `drag` and its settings, and `layout` and the rest of its keys are read once, at setup.
 */
export type WardConfig = PerKey<WardConfigValues, WardCallbackKey>

/**
 * A ward's config `C` with its transitions' entries checked against the keys each drives. A wrapper that hands its config on takes `config: WardChecked<C>` for its own
 * `<const C extends WardConfig>`, and passes `C` on: `ward<C>(config)`.
 */
export type WardChecked<C> = WardCheckedConfig<C, PerKeyApart<WardConfigValues, WardCallbackKey>>

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
  "propagate",
  "dragDirectionLock",
  "dragControls",
  "dragListener",
  "onMeasureDragConstraints",
  "transition",
  "exit",
  "layout",
  "layoutDependency",
  "layoutId",
  "layoutScroll",
  "layoutRoot",
  "layoutAnchor",
  "layoutCrossfade",
  "onUpdate",
  "transformTemplate",
  "onBeforeLayoutMeasure",
  "onLayoutMeasure",
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

/**
 * The target memo's comparison (#337): {@link sameResolution}, and a change when there's nothing to
 * compare with. Solid 2 calls a memo's `equals` with no previous value when the memo was made inside
 * an action's transaction, as a ward an optimistic write makes is, before anything has committed.
 */
const sameTarget = (a: Resolution | undefined, b: Resolution | undefined): boolean => {
  if (Predicate.isUndefined(a)) return false
  if (Predicate.isUndefined(b)) return false
  return sameResolution(a, b)
}

/** A ward's config read per key (#259). */
const WARD_VIEW = configView<WardConfigValues>(WARD_KEYS, ["onUpdate", "dragConstraints", "onMeasureDragConstraints", "transformTemplate", "onBeforeLayoutMeasure", "onLayoutMeasure"])

/** `config` read per key (#259), for a read outside a ward: a `wardic.<tag>`'s props at setup. Internal. */
export const wardConfigView = (config: WardConfig): WardConfigValues => WARD_VIEW.of(config)

/** A config given whole as an accessor, which the Solid 2 binding no longer reads (#259). */
const WHOLE_ACCESSOR =
  "ward(config) takes its config as an object, read per key (#259): make a key reactive with an accessor " +
  "(`ward({ animate: () => ({ x: x() }) })`), a getter, a store or a component's props, not the whole config " +
  "(`ward(() => ({ … }))`)."

/**
 * {@link Ward.read}: completion offers the keys its config animates, and any other
 * key is accepted; a transform key reads a number, any other the type its config gives it.
 */
export interface WardRead<C> {
  <K extends WardKey<C>>(key: K): Accessor<WardValueOf<C, K & string>>
}

/** The props a spread of a {@link Ward} applies. */
/**
 * What {@link Ward.with} takes (the Solid 1 ward's `ward({ ref, style })`): the element's own
 * `ref` and `style`, given where the ward is spread.
 */
export interface WardWithProps {
  /** Called with the element beside the ward's own ref: a `ref` written after the spread would replace it. */
  readonly ref?: ((element: HTMLElement) => void) | ReadonlyArray<(element: HTMLElement) => void> | undefined
  /** Laid over the config's `style`, key by key: a Live value in it is followed as one in the config is. */
  readonly style?: WardStyle | string | undefined
}

/** What a ward's spread gives its element: the ward itself as its `ref`, and its `style`. */
export interface WardProps {
  /** The ward: Solid calls it with the element. */
  readonly ref: (element: HTMLElement) => void
  /**
   * The element's style: the Starting style over the config's `style` until the gate's first
   * commit, then the config's `style` without the keys the gate holds. Never per frame.
   */
  readonly style: JSX.CSSProperties
}

/**
 * A ward's mark (#349): what tells a ward given to a component's `wardRef` from a function handed the
 * component's own ward. Internal: its value is the ward's {@link WardShare}.
 */
export const WARD: unique symbol = Symbol("wardic.ward")

/** Any ward, whatever its config: what `wardRef` takes in, and `parent`. */
export interface AnyWard {
  readonly [WARD]: unknown
}

/**
 * A ward's own state, read by the members it shares with every other ward (#525): what they need of
 * it, and each member's closure once made.
 */
interface WardState {
  readonly shared: () => WardShare
  readonly Provider: (props: { readonly children?: JSX.Element }) => JSX.Element
  readonly read: (key: string) => Accessor<unknown>
  readonly atom: (key: string) => Atom.Atom<unknown>
  readonly with: (own: WardWithProps) => WardProps
  readonly lifecycle: Lifecycle
  settled: Accessor<WardSettled | undefined> | undefined
  tapped: Accessor<WardPressInfo | undefined> | undefined
  next: (<E extends WardEvent>(name: E) => Promise<WardEvents[E]>) | undefined
  each: (<E extends WardEvent>(name: E) => AsyncIterable<WardEvents[E]>) | undefined
  when: (<E extends WardEvent>(name: E) => Accessor<WardEvents[E]>) | undefined
}

/** Where a ward keeps its {@link WardState}: on itself, not enumerable, so a spread never sees it. */
const WARD_STATE: unique symbol = Symbol("wardic.wardState")

/** A ward's {@link WardState}. */
const stateOf = (ward: object): WardState => (ward as { readonly [WARD_STATE]: WardState })[WARD_STATE]

/**
 * The members every client ward shares (#525): one prototype over `Function.prototype`, so a ward is
 * still a function, Solid's ref. Each is a getter: its closure is made at its first read and kept on
 * that ward, so one taken off the ward still works and one never read is never made. A ward was
 * given each as its own property, a descriptor and most a closure apiece, in one `defineProperties` a
 * ward: the line a Solid 2 mount spent most in. A ward keeps `ref`, `style` and its attributes as its
 * own, enumerable, as a spread and `Object.keys` read them.
 */
const WARD_MEMBER_KEYS: PropertyDescriptorMap = {
  [WARD]: {
    get(this: object): WardShare {
      return stateOf(this).shared()
    },
  },
  Provider: {
    get(this: object): WardState["Provider"] {
      return stateOf(this).Provider
    },
  },
  read: {
    get(this: object): WardState["read"] {
      return stateOf(this).read
    },
  },
  atom: {
    get(this: object): WardState["atom"] {
      return stateOf(this).atom
    },
  },
  with: {
    get(this: object): WardState["with"] {
      return stateOf(this).with
    },
  },
  settled: {
    get(this: object): Accessor<WardSettled | undefined> {
      const state = stateOf(this)
      if (Predicate.isNotUndefined(state.settled)) return state.settled
      const lifecycle = state.lifecycle
      state.settled = () => lifecycle.read()
      return state.settled
    },
  },
  tapped: {
    get(this: object): Accessor<WardPressInfo | undefined> {
      const state = stateOf(this)
      if (Predicate.isNotUndefined(state.tapped)) return state.tapped
      const lifecycle = state.lifecycle
      state.tapped = () => lifecycle.tapped()
      return state.tapped
    },
  },
  next: {
    get(this: object): NonNullable<WardState["next"]> {
      const state = stateOf(this)
      if (Predicate.isNotUndefined(state.next)) return state.next
      const lifecycle = state.lifecycle
      const next = <E extends WardEvent>(name: E): Promise<WardEvents[E]> => lifecycle.wait(name)
      state.next = next
      return next
    },
  },
  each: {
    get(this: object): NonNullable<WardState["each"]> {
      const state = stateOf(this)
      if (Predicate.isNotUndefined(state.each)) return state.each
      const lifecycle = state.lifecycle
      const each = <E extends WardEvent>(name: E): AsyncIterable<WardEvents[E]> => lifecycle.each(name)
      state.each = each
      return each
    },
  },
  when: {
    get(this: object): NonNullable<WardState["when"]> {
      const state = stateOf(this)
      if (Predicate.isNotUndefined(state.when)) return state.when
      const lifecycle = state.lifecycle
      const when = <E extends WardEvent>(name: E): Accessor<WardEvents[E]> => lifecycle.when(name)
      state.when = when
      return when
    },
  },
}

/** {@link WARD_MEMBER_KEYS} on one prototype over `Function.prototype`. */
const WARD_MEMBERS: object = /*#__PURE__*/ Object.create(Function.prototype, WARD_MEMBER_KEYS)

/** `ward(config, options)`'s options. */
export interface WardOptions {
  /**
   * Its variant parent, for a ward made outside the tree its element renders in: it
   * inherits that ward's variant names and transition, and joins its stagger and `when`, as an
   * element rendered under it would. Stagger counts children in the order they're made. Left out,
   * it's the one where the ward is made. A ward given to a component with none, under another
   * variant parent it would inherit from, is an error.
   */
  readonly parent?: AnyWard | undefined
}

/**
 * One element's motion binding: a ref carrying its props (see the module). Spread it, give it to
 * `ref` (alone, or in an array with your own), or give it to a Wardic component's `wardRef`.
 */
export interface Ward<C extends WardConfig = WardConfig> extends WardProps, AnyWard {
  /** Mounts the ward on `element`: Solid calls it as a ref. */
  (element: HTMLElement): void
  /**
   * Its spread's props alone: what Solid 2's `merge` reads when the ward is spread, calling it
   * as a function source. Only `ref`, `style` and the Starting style's attributes, on no prototype, so
   * none of the ward's own names (`name`, `length`, `read`, `next`…) shadows the element's props.
   */
  (previous?: unknown): WardProps
  /**
   * Hands this element's variant context to the subtree: its Variant children
   * inherit its variant name and transition, and join its stagger and `when`.
   */
  readonly Provider: (props: { readonly children?: JSX.Element }) => JSX.Element
  /**
   * The element's value for `key`, as an accessor: what Wardic shows
   * for it, whoever moves it, as a number for a transform key (`x`, not its `transform`). At rest
   * outside the gate, its `initial`, else its `style` value, else a transform key's identity. One
   * accessor a key, made at the first ask. Read, not `value` (the Solid 1 ward's name): a spread
   * would give it to `<li>`'s and `<input>`'s `value`. Its keys are typed from the config.
   */
  readonly read: WardRead<C>
  /** The element's value for `key` as an `effect/reactivity` Atom, `undefined` while the gate doesn't hold the key. */
  readonly atom: <K extends WardKey<C>>(key: K) => Atom.Atom<WardValueOf<C, K & string> | undefined>
  /**
   * The element's last landing, as an async value: `undefined` before the first,
   * ready from its first read, and pending while a Retarget runs, keeping the last landing meanwhile.
   * `isPending(() => card.settled())` is "animating"; `card.settled()?.definition` is what landed:
   * the variant name `animate` changed to, else the target values. Solid 1's
   * `onAnimationStart` / `onAnimationComplete` have no place here.
   */
  readonly settled: Accessor<WardSettled | undefined>
  /**
   * The element's last tap, as an async value, as {@link settled} is its last
   * landing: `undefined` before the first, ready from its first read, and pending while a press is
   * held, from a pointer or a key (a **Keyboard press**), keeping the last tap meanwhile. So
   * `isPending(() => card.tapped())` is "pressed". A tap resolves it to the tap's event (its `point`,
   * its `input`, its element); a cancel, or a press a drag took over, keeps the last tap. Its first read
   * asks for the press, as `next("tap")` does: the ward runs its recognizer, and its element is made
   * focusable.
   *
   * ```tsx
   * <button {...send}>{isPending(() => send.tapped()) ? "Release to send" : "Send"}</button>
   * ```
   */
  readonly tapped: Accessor<WardPressInfo | undefined>
  /**
   * A promise of the element's next `name` after the call, to `await` in a handler
   * or an action:
   * - `"settled"`: its next landing. A Retarget the next one interrupts doesn't land; it waits for
   *   one that does.
   * - `"hoverStart"`, `"hoverEnd"`, `"pressStart"`, `"tap"`, `"tapCancel"`: Motion's hover and tap
   *   events, with the pointer's `point` in the viewport. A press a drag took over is neither a
   *   tap nor a cancel.
   * - `"hover"`: the pointer over the element while it's hovered, its start (after
   *   `"hoverStart"`) and each move, as `"drag"` is a drag's. Wardic's own: Motion's hover has only
   *   a start and an end.
   * - `"dragStart"`, `"drag"` (its start and each move), `"dragEnd"`: a drag's, with its `point`,
   *   `offset`, `delta` and `velocity`; `"dragTransitionEnd"`, its release at rest. A ward that
   *   doesn't drag never has one.
   * - `"panSessionStart"` (with its `point`), `"panStart"`, `"pan"`, `"panEnd"`: a pan's, as a
   *   drag's. A pan moves nothing; once started, a press it took over is neither a tap nor a cancel.
   *
   * A gesture's event starts its recognizer, if its `while*` hasn't. Rejected with a
   * `DOMException` named `"AbortError"` once the ward is disposed.
   */
  readonly next: <E extends WardEvent>(name: E) => Promise<WardEvents[E]>
  /**
   * Every `name` from the call on, as an async iterable, for a `for await`: each step waits as
   * `next(name)` does, so one that comes while its body runs is missed; the loop ends once the ward is
   * disposed, with no `AbortError`. To act on each one in an effect, use {@link when}: a memo over
   * `each` misses one between its steps, and on a page rendered on the server it needs
   * `ssrSource: "client"` and a `<Loading>`.
   */
  readonly each: <E extends WardEvent>(name: E) => AsyncIterable<WardEvents[E]>
  /**
   * Every `name`, as a memo for an effect: pending until the first, so the effect runs at each
   * one and never before, typed as the event, on any page (no `ssrSource`, no `<Loading>`). It hears
   * each one as it's told, so none is lost between steps; several in one flush run the effect once,
   * with the latest. A failure (`"settled"`'s) goes to the effect's `error` arm
   * (`createEffect(card.when("settled"), { effect, error })`); without one, Solid logs it and skips
   * the run. Read it in an effect, not in the element's own JSX, whose region it would wait on. Call
   * it in a component's body, as `createMemo`.
   *
   * ```tsx
   * const card = ward({ drag: "x" })
   * createEffect(card.when("dragEnd"), (release) => {
   *   if (Math.abs(release.offset.x) >= 120) dismiss(release.offset.x < 0 ? "left" : "right")
   * })
   * ```
   */
  readonly when: <E extends WardEvent>(name: E) => Accessor<WardEvents[E]>
  /**
   * The ward's props with the element's own (the Solid 1 ward's `ward({ ref, style })`): its
   * `ref` called beside the ward's, and its `style` over the config's, key by key. For a style made
   * after the ward, a value derived from the ward's own:
   *
   * ```tsx
   * const swipe = ward({ drag: "x", dragSnapToOrigin: true })
   * const opacity = createTransform(swipe.read("x"), [-150, 0, 150], [0, 1, 0])
   * <div {...swipe.with({ style: { opacity } })} />
   * ```
   *
   * The latest call's props are the element's. A spread runs it again on every run of the element's
   * props, which makes nothing new: a ward is made once.
   */
  readonly with: (props: WardWithProps) => WardProps
}

/** What a `wardic.*` component or a `<Reorder>` item adds to a ward. Internal. */
/**
 * The config keys that want a gesture on Solid 2 (#525), as the ward's `wants*` read them: an element
 * given none, its keys fixed, is `gestureless`. Pan is wanted only through the lifecycle.
 */
export const GESTURE_KEYS = ["whileHover", "whileTap", "whileInView", "whileFocus"] as const

export interface WardInternals {
  /** Its tag, so an SVG element's attribute keys render as attributes. */
  readonly tag?: string | undefined
  /**
   * Its config can never want a gesture (#525): its keys are fixed and it was given none of
   * `GESTURE_KEYS`. It watches for a late one only from its first want through its lifecycle (a
   * `next("tap")`), so a Feature that arrives lazily still starts it.
   */
  readonly gestureless?: boolean | undefined
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
  /** A `<Reorder>` item's: its Enter and Space are its **Keyboard reorder**'s (ADR-0037), so its press hears no keys (#427). */
  readonly keysTaken?: boolean | undefined
  /** A `<Reorder>` item's: whether a **Keyboard reorder** has it lifted (ADR-0037), which turns its `whileDrag` on. */
  readonly lifted?: Accessor<boolean> | undefined
  /** A `<Reorder>` item's base style (its `touch-action`), under the user's style, over the drag defaults. */
  readonly baseStyle?: (() => object | undefined) | undefined
  /**
   * Told the element at mount, and how to run a watch in its watch Scope (#379), with the ward's
   * `onDefect`: closed at the unmount. What it returns is called at unmount.
   */
  readonly onMount?: ((element: HTMLElement, watch: (make: (onDefect: InputFeed.OnDefect) => Effect.Effect<void, never, Scope.Scope | WardicServices>) => void) => () => void) | undefined
  /** Values fixed over the config's, read as its own are: a `<Reorder>` item's `layout`, its Layout mode. */
  readonly fixed?: Fixed<WardConfigValues> | undefined
  /** A `<Reorder>` item's group, which `Reorder.Item` checks a given item against (#349). */
  readonly group?: unknown
  /** The component it's made for, named in its errors (#349). */
  readonly name?: string | undefined
  /** Its variant parent, given (`ward(config, { parent })`, #349). */
  readonly parent?: AnyWard | undefined
  /**
   * The ward given to the component this one drives an element for (#349): its config, variant node
   * and lifecycle are this one's, and it follows this one's element while it's mounted.
   */
  readonly share?: WardShare | undefined
  /** The Features it brings beside its section's (#511): a Complete element's every one. None for a Slim element. */
  readonly brings?: ReadonlyArray<Feature> | undefined
  /** Whether it's a **Complete element** (#511): an error in development under a `strict` section. */
  readonly complete?: boolean | undefined
}


/**
 * What a ward shares with the wards a component given it makes, one an element (#349). Internal:
 * a ward's {@link WARD} value.
 */
export interface WardShare {
  /** Its config, as it was given. */
  readonly config: WardConfig
  /** Its config at setup: what a component reads of it (its Provider, the parent check). */
  readonly setup: WardConfigValues
  /** What made it adds (a `<Reorder>` item's), and its parent. */
  readonly internal: WardInternals
  /** The variant context it was made under, or its given parent's. */
  readonly parent: WardicVariantContextValue | undefined
  /** Whether its parent was given (`ward(config, { parent })`). */
  readonly chosen: boolean
  /**
   * Whether it carries its variants (#398): its config sets `variants` or `inherit`. One that doesn't
   * is a **Listening ward**: the element it's given to builds its own variant node from its own
   * props, where it renders or under the chosen parent.
   */
  readonly carries: boolean
  /** What its `.Provider` hands down: a child's `parent` given as this ward. */
  readonly provided: WardicVariantContextValue | undefined
  /** The **Layout group** it was made in (#432): its `layoutId`'s namespace, on whatever element it's given to. */
  readonly layoutGroup: string | undefined
  /** Its variant node, on the client: a driving ward's. */
  readonly node: VariantNode | undefined
  /** Its lifecycle, on the client: a driving ward's, so `settled`, `next` and `each` hear it. */
  readonly lifecycle: Lifecycle | undefined
  /**
   * A driving ward's element mounted: this ward follows it until the returned release. One at a
   * time: `name` (the component) is in the error a second one throws.
   */
  readonly drive: (driver: Driver, name: string) => () => void
}

/** A ward driving an element for a given ward (#349): what the given ward's `read`, `atom` and `next` follow. */
export interface Driver {
  /** Start the recognizers a `next` now asks for, on its element. */
  readonly wanted: () => void
  /** Its `read(key)`'s Atom: what it shows for `key`. */
  readonly readAtom: (key: string) => Atom.Atom<unknown>
  /** Its `atom(key)`: the gate's output for `key`. */
  readonly atom: (key: string) => Atom.Atom<unknown>
}

/** A ward's share, or `undefined` for anything else (a function handed a component's own ward). */
export const shareOf = (value: unknown): WardShare | undefined => {
  if (Bool.not(Predicate.hasProperty(value, WARD))) return undefined
  return (value as Record<typeof WARD, WardShare>)[WARD]
}

/** A ward driving an element while another is: a ward drives one element at a time (#349's Q5). */
const secondElement = (name: string): string =>
  `${name}: this ward is already on another element. A ward drives one element at a time: make one for each element, ` +
  "in the <For> callback or a component of its own, rather than giving or spreading the same one twice."

/** Whether `other` is an element other than `el` still on the page (#349's Q5). */
const stillOn = (other: HTMLElement | undefined, el: HTMLElement | undefined): boolean => {
  if (Predicate.isUndefined(other)) return false
  return Bool.and(other !== el, other.isConnected)
}

/** What a ward's errors call it: the component it drives an element for, else `ward(config)`. */
const nameOf = (internal: WardInternals): string => UndefinedOr.match(internal.name, { onUndefined: () => "ward(config)", onDefined: identity })

/** What a Slim element tells its ward: it brings no Feature of its own (#511). */
export const SLIM: WardInternals = {}
/** A ward's internals from `ward()`'s options: its chosen parent, if any. */
export const internalsOf = (options: WardOptions | undefined, kind: WardInternals): WardInternals => {
  if (Predicate.isUndefined(options)) return kind
  if (Predicate.isUndefined(options.parent)) return kind
  return { ...kind, parent: options.parent }
}

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
 * Says, once per provider, that a colour of the element's needs the `colors` Feature (#511, ADR-0067
 * decision 7): a value naming a wide-gamut space, while the page reads none, outside a lazy load.
 * Development only (its caller's `DEV`).
 */
const warnUnreadColors = (registry: FeatureRegistry, features: FeatureSection, values: () => Values.Values): void => {
  createEffect(
    () => {
      if (features.pending()) return undefined
      return unreadColorIn(values())
    },
    (unread) => {
      if (Predicate.isUndefined(unread)) return
      registry.warnOnce("colors", missingMessage("colors", `The colour \`${unread}\``, "@wardic/solid/unstable/v2"))
    },
    CLIENT_ONLY,
  )
}

/** Whether a config carries its variants (#398): it sets `variants` or `inherit`. */
const carriesVariants = (config: WardConfigValues): boolean => Bool.or(Predicate.isNotUndefined(config.variants), Predicate.isNotUndefined(config.inherit))

/** A child made with `{ parent }` naming a Listening ward (#398's Q10). */
const LISTENING_PARENT =
  "ward(config, { parent }): the parent given carries no variants (no `variants` or `inherit` in its ward({ … })): it only listens, " +
  "and its element's props hold its variants, so a child can't join it by `{ parent }` (#398). Render the child inside that " +
  "ward's element, where it joins through the tree, or put the variants in the parent's ward({ … })."

/**
 * The **Layout group** a ward's `layoutId` goes in (#432): the one it's made in, as its presence and
 * variant parent are; a driving ward's is its given ward's, where that was made, unless the element's
 * own props set the `layoutId` (#398), which is then the element's.
 */
const layoutGroupFor = (share: WardShare | undefined, fixed: WardInternals["fixed"]): string | undefined => {
  if (Predicate.isUndefined(share)) return useLayoutGroupId()
  if (Bool.and(Predicate.isNotUndefined(fixed), Predicate.hasProperty(fixed, "layoutId"))) return useLayoutGroupId()
  return share.layoutGroup
}

/**
 * The variant context a ward is made under (#349): a driving ward's given ward's, else its given
 * parent's, else the one around it. A driving ward for a Listening ward (#398) takes the one around
 * its element instead, unless the ward's parent was chosen: its element builds its own node there.
 */
const variantParentOf = (internal: WardInternals): WardicVariantContextValue | undefined => {
  const share = internal.share
  if (Predicate.isNotUndefined(share)) {
    if (Bool.or(share.carries, share.chosen)) return share.parent
    return useVariantContext()
  }
  const parent = shareOf(internal.parent)
  if (Predicate.isNotUndefined(parent)) {
    if (Bool.not(parent.carries)) throw new Error(LISTENING_PARENT)
    return parent.provided
  }
  return useVariantContext()
}

/**
 * A ward's variant node: a driving ward's is its given ward's (#349), unless that ward listens
 * (#398), when its element builds its own from its props; any other ward's is its own, made now.
 */
const nodeFor = (
  share: WardShare | undefined,
  cfg: () => WardConfigValues,
  config: WardConfigValues,
  parent: WardicVariantContextValue | undefined,
  change: Accessor<ControlsChange | undefined> | undefined,
): VariantNode => {
  if (Predicate.isNotUndefined(share)) {
    const node = share.node
    if (Predicate.isNotUndefined(node)) {
      if (share.carries) return node
    }
  }
  return createVariantNode(cfg, config, parent, change)
}

/** A ward's **Animation controls** (#433): the controls, its view with each change as its entry, and the change in effect. */
interface Controls {
  readonly controls: WardicAnimationControls
  readonly view: WardConfigValues
  readonly change: Accessor<ControlsChange | undefined>
  readonly set: (change: ControlsChange) => void
}

/** No change: a ward without Animation controls. */
const NO_CHANGE: Accessor<ControlsChange | undefined> = constUndefined

/**
 * A ward's config with its `animate` read once, at setup (#433): **Animation controls** make each change
 * they make its entry, over the rest of its keys as given, the view marked controlled; anything else, none.
 */
const controlsOf = (given: WardConfigValues, animate: WardConfigValues["animate"]): Controls | undefined => {
  if (Bool.not(isAnimationControls(animate))) return undefined
  const [change, setChange] = createSignal<ControlsChange | undefined>(undefined)
  const view = Object.create(given, {
    animate: { enumerable: true, get: () => UndefinedOr.map(change(), (made) => made.definition) },
    controlled: { enumerable: true, value: true },
  }) as WardConfigValues
  return { controls: animate as WardicAnimationControls, view, change, set: (made) => setChange(() => made) }
}

/**
 * `view` with its **Config transition** as its own when it gives none (#434, Motion's
 * `{ ...config, ...props }`), read per read as its keys are; `view` itself with no `WardicConfig` above.
 */
const configuredView = (view: WardConfigValues, config: WardicConfigValue | undefined): WardConfigValues => {
  if (Predicate.isUndefined(config)) return view
  return Object.create(view, {
    transition: { enumerable: true, get: () => UndefinedOr.match(view.transition, { onUndefined: config.transition, onDefined: identity }) },
  }) as WardConfigValues
}

/**
 * Whether a node's `when` gate lets a Retarget start (ADR-0007), as a memo, so only a flip of it
 * re-runs what reads it. A plain node's gate never shuts (its `canStart` is `constTrue`), so it has
 * none (#525).
 */
const gateOf = (node: { readonly canStart: () => boolean }): Accessor<boolean> => {
  if (node.canStart === constTrue) return constTrue
  return createMemo(() => node.canStart(), CLIENT_ONLY)
}

/** A ward's lifecycle: a driving ward's is its given ward's (#349), any other its own, made now. */
const lifecycleFor = (share: WardShare | undefined, owner: Owner | null, want: () => void): Lifecycle => {
  const shared = UndefinedOr.map(share, lifecycleOfShare)
  if (Predicate.isNotUndefined(shared)) return shared
  return new Lifecycle(owner, want)
}
const lifecycleOfShare = (share: WardShare): Lifecycle | undefined => share.lifecycle
/** A mount's element. */
const elementOfMount = (m: { readonly element: HTMLElement }): HTMLElement => m.element

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
 * The keys a ward reads as it goes, through its target or its style (#257 item 1): one still loading
 * when the ward is made holds its region until it lands. Any other key is fixed at setup.
 */
const LOADS_AS_IT_GOES: ReadonlySet<string> = new Set(["animate", "whileHover", "whileTap", "whileFocus", "whileInView", "whileDrag", "transition", "style", "custom"])

/** A ward's setup key still loading when it's made (#257 item 1). */
const loadingAtSetup = (key: string): string =>
  `ward(config): \`${key}\` was still loading when the ward was made. A ward reads it once, when it's made: give it a value, or make the ward once its data is in.`

/** A ward that starts at its `animate`, still loading when it's made (#257 item 1). */
const STARTS_AT_PENDING =
  "ward(config): `animate` was still loading when the ward was made, and with `initial={false}` a ward starts there. Give it an `initial`, or make the ward once its data is in."

/** A name list standing for an `animate` still loading at setup, on a ward with `variants` (#257 item 1). */
const LOADING_NAMES: ReadonlyArray<string> = []

/**
 * The config setup reads: a key still loading that setup fixes is an error (#257 item 1). A loading
 * `animate` names the ward's own variants when it has `variants` (what it can name), and is a target
 * of values otherwise: setup reads it only to tell which.
 */
const configAtSetup = (setup: { readonly config: WardConfigValues; readonly pending: ReadonlyArray<string> }): WardConfigValues => {
  if (setup.pending.length === 0) return setup.config
  const fixed = Arr.findFirst(setup.pending, (key) => Bool.not(LOADS_AS_IT_GOES.has(key)))
  if (Option.isSome(fixed)) throw new Error(loadingAtSetup(fixed.value))
  const config = setup.config
  if (Bool.and(Arr.contains(setup.pending, "animate"), Predicate.isNotUndefined(config.variants))) return { ...config, animate: LOADING_NAMES as NonNullable<WardConfigValues["animate"]> }
  return config
}

/**
 * Elements a ward has left in this task: a ward mounting one is {@link REMADE}. Cleared once, at the
 * task's end, by one microtask however many leave (#259: one a ward cost 0.2 ms an unmount of 1,000).
 */
// Module state (#460, Q7): the page's one end-of-task batch: cleared by one microtask at the task's end.
const justLeft = new Set<Element>()
const forgetJustLeft = (): void => justLeft.clear()

/** {@link ward} with a `wardic.<tag>`'s additions. Internal. */
/**
 * Makes a mounted element's layout node with `arrive` if it was on its way as the element mounted and
 * `services` has `layout` now (#582). A module's function, not a ward's: a ward makes none.
 */
const layoutArrivedIn = (arrive: ((projection: ProjectionSystem.Shape) => void) | undefined, services: Context.Context<never>): void => {
  UndefinedOr.map(arrive, (make) => UndefinedOr.map(projectionIn(services), make))
}

export function wardWith(config: WardConfig, internal: WardInternals): Ward {
  if (Predicate.isFunction(config)) throw new Error(WHOLE_ACCESSOR)
  const runtime = useWardicRuntime()
  // Its Features (#511, ADR-0067), a Complete element's every one: what they register, a server
  // render's elements read too (the `colors` Feature's spaces).
  const features = useElementFeatures(internal.brings, internal.complete === true)
  // A server render takes the lean path: the Starting style only, no spine (ADR-0021).
  if (isServer) return serverWard(config, internal)
  const gate = useWardicGate()
  // Its section's projection system, the `layout` Feature's (#511): `undefined` without it. Read now,
  // which builds the Features given to its section at once: the first element to ask builds them.
  const layoutProjection = projectionIn(untrack(features.services))
  // The provider's, once any section has built it: what its values register with.
  const builtProjection = useBuiltProjection()
  const reducedMotion = useWardicReducedMotion()
  // Whether its animations are skipped (#468): its nearest WardicConfig's, read as each starts.
  const skipAnimations = useWardicSkipAnimations()
  // Where its drag's and pan's points are (#443): its nearest WardicConfig's, read as each starts.
  const pagePoint = transformPagePointOf(useWardicConfig())
  const positionalKeys = useWardicPositionalKeys()
  const defaultTransition = useWardicDefaultTransition()
  const owner = getOwner()
  const reactivity = reactivityIn(owner)
  const registry = registryOf(runtime)
  // SSR/hydration-stable: the server ward makes the same one call.
  const id = createUniqueId()
  // Its config, read per key where it's read (#259): a change re-runs only what reads the key. With
  // Animation controls for its `animate` (#433), read once, each change they make is its entry.
  // Under a `WardicConfig`, its Config transition is its own when it gives none (#434).
  const asGiven = configuredView(WARD_VIEW.of(config, internal.fixed), useWardicConfig())
  // The config at setup, a plain copy read untracked: what setup reads, the keys read once among it.
  // A key still loading (#257 item 1) is left out of it: one the ward reads as it goes holds its
  // region until it lands; one setup fixes is an error, naming it. Its `animate` there tells
  // Animation controls; one still loading is none.
  const givenSetup = WARD_VIEW.setupOf(asGiven)
  const controls = controlsOf(asGiven, givenSetup.config.animate)
  const view = UndefinedOr.match(controls, { onUndefined: () => asGiven, onDefined: (c) => c.view })
  const cfg = (): WardConfigValues => view
  const setup = UndefinedOr.match(controls, { onUndefined: () => givenSetup, onDefined: () => WARD_VIEW.setupOf(view) })
  const initialConfig = UndefinedOr.match(controls, { onUndefined: () => configAtSetup(setup), onDefined: () => controlledConfigOf(configAtSetup(setup), undefined) })
  // Its Animation controls' change (#433), read with the Override stack: none without them.
  const ownChange = UndefinedOr.match(controls, { onUndefined: () => NO_CHANGE, onDefined: (c) => c.change })

  // A ward a component was given (#349), whose element this one drives: its variant node and its
  // lifecycle are that ward's, so its children, stagger and `next` readers are where it was made.
  const share = internal.share
  // Its place in variant orchestration (ADR-0007, #50): where it's made, its given parent's (#349),
  // or its given ward's.
  const parent = variantParentOf(internal)
  const node = nodeFor(share, cfg, initialConfig, parent, UndefinedOr.map(controls, (c) => c.change))

  // The nearest <AnimatePresence> (ADR-0007), or none.
  const presence = usePresenceContext()
  // The Layout group its `layoutId` goes in (#432): where it's made, or a given ward's.
  const layoutGroup = layoutGroupFor(share, internal.fixed)

  // The values it starts from, read once (ADR-0003): its `initial`, or the one it inherits, or its
  // `animate` with `initial={false}` (its own, inherited, or its presence's first render, #134).
  const presenceBlocks = presenceBlocksInitial(presence)
  if (Bool.and(Arr.contains(setup.pending, "animate"), startsAtAnimate(initialConfig, node.inherited, presenceBlocks))) throw new Error(STARTS_AT_PENDING)
  const start = startOf(initialConfig, node.inherited, presenceBlocks, untrack)
  // Read once by the provider (#618, M1).
  const { project } = useWardicRenderer()

  // The Starting style: the projected `initial`, carried by `style` until the gate's first commit
  // (ADR-0021 decision 6, ADR-0034); an svg-inner tag's attribute keys as attributes. While
  // hydrating, what the server rendered, the DOM's project (the Hydration hold). A layout node's is
  // drawn through its projection at rest, as its first commit draws it (#245).
  const layoutNode = isLayoutNode(initialConfig)
  const drawnStart = drawnAtRest(start.initialValues, layoutNode, initialConfig.transformTemplate)
  const projected = project(drawnStart)
  const hydrating = isHydrating()
  const startingPatch = Bool.match(hydrating, { onTrue: () => DomRenderer.project(drawnStart), onFalse: () => projected })
  if (hydrating) flagStartingStyle(runtime, id, startingPatch, projected)
  const seed = Svg.splitPatchForTag(internal.tag, startingPatch)

  // Its drag axis and a drag element's defaults (ADR-0004, ADR-0019 *Amendment (Reorder)*), under
  // the user's style: `drag` is read once, as on the Solid 1 binding.
  const dragAxis = dragAxisOf(initialConfig, internal)
  const dragDefaults = dragDefaultsOf(initialConfig, internal)

  // Its routed `style` keys (#130, ADR-0043), and its `style`, switched by the gate's hooks.
  const live = createLiveStyle({ registry: registryOf(runtime), onDroppedTransform: () => warnDroppedTransform(runtime, id), reactivity })
  const projectStarting = Bool.match(hydrating, { onTrue: () => DomRenderer.project, onFalse: () => project })
  // The element's style (#264): the config's, with the latest `.with()` style over it, key by key.
  // `.with()` runs in the spread's computation, an owned scope: it tells `read(key)` through a
  // signal written there (`ownedWrite`), and never `style`, whose spread would run `.with` again.
  let given: WardWithProps = NO_WITH
  // Made at the first `read(key)` or `.with()`: most elements call neither.
  let withCalls: Signal<undefined> | undefined
  const withCallsOf = (): Signal<undefined> => {
    if (Predicate.isUndefined(withCalls)) withCalls = runWithOwner(owner, () => createSignal(undefined, { equals: false, ownedWrite: true }))
    return withCalls
  }
  const userStyle = (): WardStyle | string | undefined => withStyleOver(cfg().style, given.style)
  const elementStyle = createElementStyle({
    userStyle,
    starting: seed.style,
    startingWith: (routed: Values.Values): Renderer.Patch =>
      Svg.splitPatchForTag(internal.tag, projectStarting(drawnAtRest({ ...routed, ...start.initialValues }, layoutNode, initialConfig.transformTemplate))).style,
    live,
    defaults: dragDefaults,
    base: internal.baseStyle,
    reactivity,
  })

  const snapshot = snapshotOf(start)
  const reuse = makeReuse()
  // Where its element starts (#414): the ward's start, or a fresh one for an element given after the
  // last one left the page, as a mount after the first render's (no presence holds its `initial`
  // back). Its Snapshot goes back to it, and its Starting style comes back on until its first commit.
  let begun = start
  const beginFresh = (): void => {
    // The config now, a plain copy read untracked, as setup reads it: this runs in the mount effect.
    const now = WARD_VIEW.setupOf(view).config
    begun = startOf(now, node.inherited, false, untrack)
    snapshot.values = { ...begun.initialValues }
    snapshot.velocities = {}
    snapshot.drawnAt = {}
    elementStyle.restart(Svg.splitPatchForTag(internal.tag, project(drawnAtRest(begun.initialValues, layoutNode, now.transformTemplate))).style)
  }
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

  // Its layout node (ADR-0009): the projection system it registers one with, decided at setup, as
  // `layout` is read once, and what a release runs on, its Release offset (ADR-0016, *Amendment
  // (#140)*). Its section's `layout` makes its node (#511): without it, its layout props do nothing,
  // and development says so once, unless `layout` is on its way.
  const wantsNode = wantsLayoutNode(initialConfig)
  if (DEV && wantsNode && Predicate.isUndefined(layoutProjection) && Bool.not(untrack(features.pending))) {
    useFeatureRegistry().warnOnce("layout", missingMessage("layout", LAYOUT_PROPS, "@wardic/solid/unstable/v2"))
  }
  const layoutNodes = Bool.match(wantsNode, { onTrue: () => layoutProjection, onFalse: constUndefined })
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
  // target memo and re-ran the effect, EFFECT_WRITES_OWN_SOURCE). With none recorded there's nothing
  // to compare, so the element isn't read: its arrival doesn't re-run the target memo (#320).
  const gestures = (): Gestures => {
    const g = gestureState()
    if (g === NO_GESTURES) return g
    if (g.element === element()) return g
    return NO_GESTURES
  }
  const dragging = (): boolean => gestures().dragging
  // The keys these read are `GESTURE_KEYS` (#525).
  const wantsHover = (): boolean => Predicate.isNotUndefined(cfg().whileHover)
  const wantsPress = (): boolean => Predicate.isNotUndefined(cfg().whileTap)
  const wantsInView = (): boolean => Predicate.isNotUndefined(cfg().whileInView)
  const wantsFocus = (): boolean => Predicate.isNotUndefined(cfg().whileFocus)

  // The Override stack, compared by value: a change that resolves the same target doesn't Retarget.
  // A keyboard lift turns `whileDrag` on, as a drag does (ADR-0037).
  const lifted = UndefinedOr.match(internal.lifted, { onUndefined: () => constFalse, onDefined: identity })
  // The target reads the lift through a boundary (#666): an item with no `whileDrag` of its own
  // resolves the same lifted or not (a dragged parent's name hands down with its own drag on), so
  // every lift and drop re-ran its target for nothing. A Reorder item's alone: no other ward lifts.
  const liftedLayer = UndefinedOr.match(internal.lifted, {
    onUndefined: () => constFalse,
    onDefined: (isLifted) => createMemo(() => Predicate.isNotUndefined(cfg().whileDrag) && isLifted(), CLIENT_ONLY),
  })
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
          dragged: Bool.or(g.dragging, liftedLayer()),
          dragging: g.dragging,
        },
        snapshot,
        ownChange(),
      )
    },
    { equals: sameTarget, transparent: true },
  )
  // A colour only the `colors` Feature reads, on a Slim element without it (#511, decision 7): said
  // once per provider, in development only, and not while a lazy load is on its way.
  // eslint-disable-next-line solid/reactivity -- read inside the warning's effect, where it tracks
  if (DEV && internal.complete !== true) warnUnreadColors(useFeatureRegistry(), features, () => target().resolved)
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
  // The ward driving an element for this one, given to a component (#349): its `read`, `atom` and
  // `next` follow that element. Followed through an Atom made at the first `read`, `atom` or drive.
  let driver: Driver | undefined
  let driven: Atom.Writable<Driver | undefined> | undefined
  const drivenAtom = (): Atom.Writable<Driver | undefined> => {
    if (Predicate.isNotUndefined(driven)) return driven
    const atom = Atom.make<Driver | undefined>(driver)
    runWithOwner(owner, () => onCleanup(registry().mount(atom)))
    driven = atom
    return atom
  }

  // A driving ward's are its given ward's (#349), whose `next` starts them on the element it drives.
  const lifecycle = lifecycleFor(share, owner, () => {
    watchLateGestures()
    UndefinedOr.map(mounted, startRecognizers)
    UndefinedOr.map(driver, (d) => d.wanted())
  })


  // The mounted element: registered with the gate, its layout node, its spine built over it, and how
  // to run a watch in its watch Scope (#318, #379): its gesture watches and its drag track.
  interface Mounted {
    readonly element: HTMLElement
    readonly spine: ElementSpine
    /** Its layout node: made at mount, or as `layout` arrives (#582), which writes it here. */
    layout: ProjectionSystem.NodeHandle | undefined
    /** Makes its layout node on a `layout` that arrived after it mounted (#582); absent unless one was on its way. */
    readonly arriveLayout: ((projection: ProjectionSystem.Shape) => void) | undefined
    readonly watch: (watch: Effect.Effect<void, never, Scope.Scope | WardicServices>) => void
    /** Starts its drag track with a `drag` that arrived after it mounted (#551); absent unless one was on its way. */
    readonly startDrag: ((gesture: DragGesture["Service"]) => void) | undefined
    hover: boolean
    press: boolean
    pan: boolean
    inView: boolean
    focus: boolean
    readonly dispose: () => void
  }
  /** A handler's throw, reported as a fiber's failure is (ADR-0030, decision 4); the watch goes on. */
  const onDefect = (cause: Cause.Cause<never>): void => {
    runtime.runFork(Report.failure("wardic.ward: a gesture handler failed", cause))
  }
  // The provider's Features, for development's word on a missing one (#511).
  const featureRegistry = useFeatureRegistry()
  /**
   * A gesture's service when the element `wanted` it: its section's Feature's (#511), `undefined`
   * without it, which development says once, unless it's on its way.
   */
  const gestureIn = <I, S>(services: Context.Context<never>, name: keyof typeof GESTURE_WORDS, key: Context.Key<I, S>, wanted: boolean): S | undefined => {
    if (Bool.not(wanted)) return undefined
    const service = serviceIn(services, key)
    if (DEV && Predicate.isUndefined(service) && Bool.not(untrack(features.pending))) {
      featureRegistry.warnOnce(name, missingMessage(name, GESTURE_WORDS[name], "@wardic/solid/unstable/v2"))
    }
    return service
  }
  /**
   * Start the hover, press and pan recognizers its config or a `next` now wants, each once a mount:
   * each hover or press transition sets its gesture layer, and every event is told to the lifecycle
   * for `next` (#257, #273).
   */
  const startRecognizers = (m: Mounted): void => {
    // Each through its section's Feature (#511), read as it starts: one that arrives lazily starts from
    // then on, as the effect below runs this again.
    const services = untrack(features.services)
    const hover = gestureIn(services, "hover", HoverGesture, Bool.or(untrack(wantsHover), lifecycle.wantsHover))
    if (Predicate.isNotUndefined(hover) && Bool.not(m.hover)) {
      m.hover = true
      m.watch(
        hover.watch(m.element, {
          on: (transition) => {
            setGesture(m.element, "hovered", transition.active)
            lifecycle.hovered(transition, m.element)
          },
          // Each move while it's hovered, for `hover` (#397): told only to a `next` or `when` that asked.
          onMove: (event) => lifecycle.hoverMoved(event, m.element),
          onDefect,
        }),
      )
    }
    const press = gestureIn(services, "press", PressGesture, Bool.or(untrack(wantsPress), lifecycle.wantsPress))
    if (Predicate.isNotUndefined(press) && Bool.not(m.press)) {
      m.press = true
      m.watch(
        press.watch(
          m.element,
          {
            on: (press) => {
              setGesture(m.element, "pressed", press.phase === "start")
              lifecycle.pressed(press, m.element)
            },
            onDefect,
          },
          internal.keysTaken === true,
          () => tapPropagates(untrack(cfg).propagate),
        ),
      )
    }
    // A pan sets no layer: only a `next` wants it (#273).
    const pan = gestureIn(services, "pan", PanGesture, lifecycle.wantsPan)
    if (Predicate.isNotUndefined(pan) && Bool.not(m.pan)) {
      m.pan = true
      m.watch(pan.watch(m.element, { on: (sample) => lifecycle.panned(sample, m.element), onDefect }, { mapPoint: pointMapOptionOf(pagePoint) }))
    }
    // In view as its `viewport` says, read when it starts (#273).
    const inView = gestureIn(services, "inView", InViewGesture, Bool.or(untrack(wantsInView), lifecycle.wantsInView))
    if (Predicate.isNotUndefined(inView) && Bool.not(m.inView)) {
      m.inView = true
      m.watch(
        inView.watch(m.element, inViewOptionsOf(untrack(cfg).viewport), {
          on: (transition) => {
            setGesture(m.element, "inView", transition.active)
            lifecycle.viewed(transition)
          },
          onDefect,
        }),
      )
    }
    // Focused as the browser shows it (`:focus-visible`, #273).
    const focus = gestureIn(services, "focus", FocusGesture, untrack(wantsFocus))
    if (Predicate.isNotUndefined(focus) && Bool.not(m.focus)) {
      m.focus = true
      m.watch(focus.watch(m.element, { visible: true }, { on: (focused) => setGesture(m.element, "focused", focused), onDefect }))
    }
  }
  let mounted: Mounted | undefined
  // The last two elements given to its ref, for a second one still on the page as it mounts (#349's Q5).
  let refdLast: HTMLElement | undefined
  let refdBefore: HTMLElement | undefined
  // One given after the last one left the page, which enters fresh (#414). Read as the ref is called,
  // before Solid inserts it: one replacing the last in the same update finds it still on the page.
  let fresh: HTMLElement | undefined
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
  // A driving ward's lifecycle is its given ward's, which outlives the element (#349).
  onCleanup(() => {
    unmount()
    if (Predicate.isUndefined(share)) lifecycle.dispose()
  })

  const mount = (el: HTMLElement): Mounted => {
    if (justLeft.has(el)) throw new Error(REMADE)
    // The ward a component was given follows this element while it's mounted (#349): one at a time.
    let undrive: (() => void) | undefined
    if (Predicate.isNotUndefined(share)) {
      undrive = share.drive(
        {
          wanted: () => {
            UndefinedOr.map(mounted, startRecognizers)
          },
          readAtom: (key) => readEntry(key).atom,
          atom: (key) => gate.valueOf(id, key),
        },
        nameOf(internal),
      )
    }
    // The gate commits each frame onto the element (ADR-0006, ADR-0034); the hooks switch its
    // `style`. An element with `onUpdate` at mount is told each committed frame (#233). While
    // hydrating, its Appear animation is found here, taken over by its first Retarget that starts,
    // and removed in its first commit (the Handoff, ADR-0044 decision 6).
    const handoff = Bool.match(hydrating, { onTrue: () => Option.getOrUndefined(handoffOf(el)), onFalse: constUndefined })
    // Its Transform template (#443), drawn with its first write: the one at mount, then each other one
    // its config gives.
    const templateAtMount = configNow().transformTemplate
    let template = templateAtMount
    const registered = registeredValuesOf(templateAtMount)
    const unregister = gate.register(id, releasingAppear(withOnUpdate({ target: el, ...elementStyle.hooks }, configNow().onUpdate, configNow), handoff, el), registered)
    // Its values, for the projection's flights (ADR-0012 *Amendment (#137)*).
    // None while no section has `layout`: there's no flight to follow them (#511).
    const unregisterValues = UndefinedOr.match(builtProjection(), { onUndefined: () => constVoid, onDefined: (projection) => projection.registerValues(el, () => snapshot.values) })
    const links = startLinksOf(el, styleNow, live)
    // Its exit record, under an <AnimatePresence>: the presence removes it once the exit settles.
    const presenceRecord = UndefinedOr.map(presence, (registrar) => {
      const record = presenceRecordOf(el, begun, (custom, inherited) => exitTargetOf(exitConfig.current, custom, snapshot, inherited), links, presenceTreeOf(initialConfig), snapshot, reducedMotion, skipAnimations)
      registrar.register(record)
      return record
    })
    const recordFrame = recordFrameOf(presenceRecord)
    // Its exit is drawn through its template (#443): it rides in its presence record, whose drawn values
    // the projection reads as it leaves. A later one is written with the values it holds, so the commit
    // that may take its Starting style off holds them.
    // Nothing with none (#460): no follow.
    let unfollowTemplate: () => void = constVoid
    if (Predicate.isNotUndefined(templateAtMount)) {
      recordFrame(registered as Values.Values)
      unfollowTemplate = followTemplate(templateAtMount, () => view.transformTemplate, reactivity.watch, (next) => {
        template = next
        gate.write(id, { ...snapshot.values, [DomRenderer.TEMPLATE_KEY]: next })
        recordFrame({ [DomRenderer.TEMPLATE_KEY]: next } as unknown as Values.Values)
      })
    }
    // Where it starts when its child takes over from a leaver (#286): asked before its layout node
    // registers, which moves from the leaver's box, and before its first Retarget.
    const taken = presenceSeedOf(presence, el)
    // Its one projection node (ADR-0009, ADR-0010), its own `x`/`y` drawn on top of it (#363).
    // Its layout animations' starts and landings, and its drag's release at rest, go to the lifecycle,
    // for `next("layoutStart")`, `next("layoutComplete")` and `next("dragTransitionEnd")` (#257, #273):
    // Solid 2 has no props for them.
    let layout: ProjectionSystem.NodeHandle | undefined
    // A `<Reorder>` item's group registers the node, until the unmount.
    let handedOver: (() => void) | undefined
    // `layout` on its way as it mounted (#582): its node is made as it arrives (`arriveLayout`), as
    // Motion's is, and measures from then on; nothing before it is replayed.
    let arriveLayout: ((projection: ProjectionSystem.Shape) => void) | undefined
    if (wantsNode) {
      // `takenNow`: where a child that takes over from a leaver starts, at its mount only (#286).
      const layoutNodeOn = (projection: ProjectionSystem.Shape, takenNow: PresenceSeed | undefined): void => {
        const started = (): void => lifecycle.layoutStarted()
        const completed = (): void => lifecycle.layoutCompleted()
        const released = (): void => lifecycle.released()
        const handle = projection.register(
          registrationOf({
            ...layoutOptionsOf({
              id,
              element: el,
              config: configNow,
              parent: node.inherited,
              snapshot,
              dragTransition,
              raiseWhileDragged: internal.raiseWhileDragged === true,
              taken: takenNow,
              layoutGroup,
              reducedMotion,
              skipAnimations,
              heldTransform: heldTransformFor(snapshot, templateAtMount, () => template),
            }),
            onLayoutAnimationStart: () => started,
            onLayoutAnimationComplete: () => completed,
            // Its drag's Release offset at rest, for `next("dragTransitionEnd")` (#273).
            onReleaseEnd: () => released,
          }),
        )
        layout = handle
        handedOver = UndefinedOr.map(internal.onLayoutHandle, (onHandle) => onHandle(handle))
      }
      // Its section's `layout` as it mounts: had at setup, or arrived since (#582).
      const now = UndefinedOr.match(layoutNodes, { onDefined: identity, onUndefined: () => projectionIn(untrack(features.services)) })
      if (Predicate.isNotUndefined(now)) layoutNodeOn(now, taken)
      if (Predicate.isUndefined(layout)) {
        arriveLayout = (projection) => {
          if (Predicate.isNotUndefined(layout)) return
          layoutNodeOn(projection, undefined)
          // A plain field, not a getter: a getter of its own on every record gave each its own shape (#582).
          m.layout = layout
        }
      }
    }
    // Its watch Scope (#318, #379, ADR-0055): its gesture watches and its drag track run in it, each
    // subscribed at once with no fiber of its own, until the unmount closes it. Made at the first
    // watch: a ward with no gesture makes and closes none.
    let watchScope: Scope.Closeable | undefined
    const watchIn = (watch: Effect.Effect<void, never, Scope.Scope | WardicServices>): void => {
      if (Predicate.isUndefined(watchScope)) watchScope = OwnerScope.open(runtime)
      runtime.runSync(watch.pipe(Scope.provide(watchScope)))
    }
    if (internal.defaultsOnElement === true) UndefinedOr.map(dragDefaults, (defaults) => applyDragDefaults(el, defaults))
    // The drag track (ADR-0004): the pointer direct-sets `x`/`y` while the spring drives the rest and
    // `whileDrag`; on a layout node it feeds the projection (ADR-0016).
    const locked = initialConfig.dragDirectionLock === true
    // Its section's `drag` Feature drives it (#511): without it, `drag` does nothing, and development
    // says so once, unless `drag` is on its way.
    const dragGesture = gestureIn(untrack(features.services), "drag", DragGesture, Predicate.isNotUndefined(dragAxis))
    // Whether its track drives its layout node (ADR-0016): the node it has as the track is made, at
    // mount or as `drag` arrives; a node made later leaves it moving `x`/`y` (#582).
    let dragProjected = false
    const driveDrag = (gesture: DragGesture["Service"]): DragTrack => {
      const axis = UndefinedOr.getOrThrow(dragAxis)
      dragProjected = Predicate.isNotUndefined(layout)
      // Motion's `dragConstraints` (#273): a box of numbers, or a container measured against the element.
      const constraints = gesture.constraintsOf(initialConfig.dragConstraints, el, () => untrack(cfg).onMeasureDragConstraints, pagePoint)
      return gesture.drive({
        watch: (track) => watchIn(track(onDefect)),
        fork: (response) => void runtime.runFork(response),
        gate,
        id,
        element: el,
        snapshot,
        recordFrame,
        // A drag's start turns its `style`'s will-change value on (#443).
        setDragging: draggingWithWillChange(live, (on: boolean) => setGesture(el, "dragging", on), el),
        mapPoint: pagePoint,
        skipAnimations,
        config: {
          axis,
          constraints: constraints.constraints,
          elastic: initialConfig.dragElastic,
          momentum: initialConfig.dragMomentum,
          snapToOrigin: initialConfig.dragSnapToOrigin,
          propagation: initialConfig.dragPropagation,
          directionLock: initialConfig.dragDirectionLock,
          transition: dragTransition,
          listen: initialConfig.dragListener,
        },
        container: constraints.container,
        controls: initialConfig.dragControls,
        ...UndefinedOr.match(layout, { onUndefined: () => ({}), onDefined: (projectionNode) => ({ projection: projectionNode }) }),
        ...UndefinedOr.match(internal.dragAxis, { onUndefined: () => ({}), onDefined: (axisAt) => ({ axisAt }) }),
        // Its samples to a `<Reorder>` item's group, and to the lifecycle for `next("dragStart")` (#257)
        // and, with a direction lock, `next("directionLock")` (#273).
        onSample: UndefinedOr.match(internal.onDragSample, {
          onUndefined: () => (sample: Drag.Sample) => lifecycle.dragged(sample, locked, el),
          onDefined: (onSample) => (sample: Drag.Sample) => {
            onSample(sample)
            lifecycle.dragged(sample, locked, el)
          },
        }),
        // Its release at rest, for `next("dragTransitionEnd")` (#273).
        onReleaseEnd: () => lifecycle.released(),
      })
    }
    let dragTrack = UndefinedOr.map(dragGesture, driveDrag)
    const spineOptions: ElementSpineOptions = {
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
      skipAnimations,
      positionalKeys,
      defaultTransition,
      start: begun,
      snapshot,
      reuse,
      links,
      styleNow,
      live,
      presence: presenceRecord,
      projected: Predicate.isNotUndefined(layout),
      dragAxis,
      drag: dragTrack,
      handoff,
      animation: lifecycle,
    }
    // A `drag` on its way as it mounted (#551): its track starts as the Feature arrives (`startDrag`),
    // and the spine reads it at each Retarget from then on. Only then is `drag` a getter, so an
    // element that has it at mount, or never wants it, pays nothing.
    let startDrag: ((gesture: DragGesture["Service"]) => void) | undefined
    if (Predicate.isNotUndefined(dragAxis) && Predicate.isUndefined(dragTrack) && untrack(features.pending)) {
      Object.defineProperty(spineOptions, "drag", { get: () => dragTrack })
      // Whether that track drives the layout node (#582): until it starts, whether the element has one.
      Object.defineProperty(spineOptions, "projected", {
        get: () => UndefinedOr.match(dragTrack, { onUndefined: () => Predicate.isNotUndefined(layout), onDefined: () => dragProjected }),
      })
      startDrag = (gesture) => {
        if (Predicate.isUndefined(dragTrack)) dragTrack = driveDrag(gesture)
      }
    }
    const spine = makeElementSpine(spineOptions)
    // A child back under its key starts where its leaver is drawn (#286), before its first Retarget.
    if (Predicate.isNotUndefined(taken)) spine.seed(taken)
    // Live values in `style` (#130, ADR-0043): followed from the first routed key on.
    spine.follow({ resolved: () => untrack(target).resolved, dragging: () => untrack(dragging) })
    // Its Imperative animations (#433) go through its spine while it's mounted, and its Animation controls reach it.
    const unregisterAnimatable = registerAnimatable(el, spine)
    const unsubscribe = UndefinedOr.match(controls, {
      onUndefined: () => constVoid,
      onDefined: (c) => subscribe(c.controls, controlledElement(c.set, { custom: () => untrack(() => view.custom), snapshot }, spine.stop)),
    })
    const m: Mounted = {
      element: el,
      spine,
      layout,
      arriveLayout,
      watch: watchIn,
      startDrag,
      hover: false,
      press: false,
      pan: false,
      inView: false,
      focus: false,
      dispose: () => {
        if (Predicate.isNotUndefined(undrive)) undrive()
        UndefinedOr.map(mountedHook, (end) => end())
        unregisterAnimatable()
        unsubscribe()
        spine.dispose()
        // Its gesture watches' and drag track's listeners go, a running release stops, and their spans end.
        UndefinedOr.map(watchScope, (scope) => OwnerScope.close(runtime, scope, "wardic.ward: a finalizer failed"))
        // The group lets go of the node before it's disposed.
        UndefinedOr.map(handedOver, (release) => release())
        UndefinedOr.map(layout, (node) => node.dispose())
        unfollowTemplate()
        unregisterValues()
        unregister()
      },
    }
    startRecognizers(m)
    const mountedHook = UndefinedOr.map(internal.onMount, (onMount) => onMount(el, (make) => watchIn(make(onDefect))))
    return m
  }

  // A `while*` target set after mount starts its recognizer then (#87, ADR-0040). Its compute reads
  // the two keys, so only their changes re-run it (#259).
  // Its section's Features are read there too, so a gesture's arriving lazily starts it (#511): each
  // start checks what's wanted.
  // An element whose config can never want one (`gestureless`, #525) makes it at its first want
  // through its lifecycle instead: no computation an element until then.
  let watchingLate = false
  const watchLateGestures = (): void => {
    if (watchingLate) return
    watchingLate = true
    runWithOwner(owner, () =>
      createEffect(
        () => ({ wanted: Bool.some([wantsHover(), wantsPress(), wantsInView(), wantsFocus()]), services: features.services() }),
        () => {
          UndefinedOr.map(mounted, startRecognizers)
        },
        CLIENT_ONLY_SYNC_DEFERRED,
      ),
    )
  }
  if (internal.gestureless !== true) watchLateGestures()

  // `layout` on its way (#582): an element mounted before it arrives makes its node then, as its
  // gestures and drag start theirs; a load that brings none gets development's word then.
  if (Bool.and(wantsNode, Predicate.isUndefined(layoutProjection)) && untrack(features.pending)) {
    createEffect(
      () => ({ services: features.services(), pending: features.pending() }),
      // Its apply returns nothing: a function returned there would be its cleanup.
      ({ services, pending }) => {
        UndefinedOr.map(mounted, (m) => layoutArrivedIn(m.arriveLayout, services))
        if (DEV && Predicate.isUndefined(projectionIn(services)) && Bool.not(pending)) {
          featureRegistry.warnOnce("layout", missingMessage("layout", LAYOUT_PROPS, "@wardic/solid/unstable/v2"))
        }
      },
      CLIENT_ONLY_DEFERRED,
    )
  }

  // A `drag` on its way (#551): an element mounted before it arrives starts its track then, as its
  // gestures' recognizers do, and nothing before it is replayed; a load that brings none gets
  // development's word then.
  if (Predicate.isNotUndefined(dragAxis) && untrack(features.pending)) {
    createEffect(
      () => ({ services: features.services(), pending: features.pending() }),
      // Its apply returns nothing: a function returned there would be its cleanup.
      ({ services, pending }) => {
        UndefinedOr.match(serviceIn(services, DragGesture), {
          // A `layout` from the same load makes its node first, so the track drives it (#582).
          onDefined: (gesture) =>
            UndefinedOr.map(mounted, (m) => {
              layoutArrivedIn(m.arriveLayout, services)
              UndefinedOr.map(m.startDrag, (start) => start(gesture))
            }),
          onUndefined: () => {
            if (DEV && Bool.not(pending)) featureRegistry.warnOnce("drag", missingMessage("drag", GESTURE_WORDS.drag, "@wardic/solid/unstable/v2"))
          },
        })
      },
      CLIENT_ONLY_DEFERRED,
    )
  }

  // A `layoutDependency` change re-measures its layout node (not at mount: it measures as it registers).
  // Only a change of its value: a memo, since a Solid 2 effect applies on every re-run of its compute,
  // and `cfg()` is re-read on any of the config's changes (a `style` change re-measured, #209 PR 5's lab).
  // Its node may be made as `layout` arrives (#582), so it's read at each change.
  if (wantsNode) {
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
  const open = gateOf(node)

  // Mount, then Retarget on each change of the target or of the `when` gate: both are read here,
  // so a gate's flip re-runs it and releases a held Retarget. Only once the ref has given the
  // element (#320): until then the effect reads nothing else, so the target is first resolved with
  // its element, once, and a config that lands before the element (an async one) doesn't run it.
  createEffect(
    () => {
      const el = element()
      if (Predicate.isUndefined(el)) return undefined
      return { el, resolution: target(), open: open(), shown: ticked() }
    },
    (mounting) => {
      if (Predicate.isUndefined(mounting)) return
      const { el, resolution } = mounting
      if (Predicate.isUndefined(mounted) || mounted.element !== el) {
        // Another element it was spread on, or the one it's on, still on the page: a ward drives one
        // element at a time (#349's Q5). One the page has let go of is left behind.
        if (Bool.or(stillOn(refdBefore, el), stillOn(UndefinedOr.map(mounted, elementOfMount), el))) throw new Error(secondElement("ward(config)"))
        refdBefore = undefined
        // Held off the page: nothing starts until it's on it.
        if (heldBack(el)) return
        // A new element starts with no gesture on, read from its gesture state (#257's audit).
        unmount()
        // One that came after the last left the page enters fresh (#414).
        if (el === fresh) beginFresh()
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
    CLIENT_ONLY_SYNC,
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
  let reads: Map<string, ReadEntry> | undefined
  const readEntry = (key: string): ReadEntry => {
    if (Predicate.isUndefined(reads)) reads = new Map()
    const known = reads.get(key)
    if (Predicate.isNotUndefined(known)) return known
    const output = gate.valueOf(id, key)
    const following = drivenAtom()
    const entry = runWithOwner(owner, (): ReadEntry => {
      const resting = createMemo(() => {
        withCallsOf()[0]()
        return restingOf(key, start.initialValues, userStyle(), (raw) => live.read(raw))
      }, CLIENT_ONLY)
      const restingAtom = Atom.make<unknown>(untrack(resting))
      onCleanup(registry().mount(restingAtom))
      createEffect(
        resting,
        (value) => {
          registry().set(restingAtom, value)
        },
        CLIENT_ONLY_DEFERRED,
      )
      const own = Atom.make((get) => UndefinedOr.match(get(output), { onUndefined: () => get(restingAtom), onDefined: identity }))
      // Given to a component (#349): what the element it drives shows, while it's there.
      const atom = Atom.make((get) => UndefinedOr.match(get(following), { onUndefined: () => get(own), onDefined: (d) => get(d.readAtom(key)) }))
      return { accessor: followAtom(registry(), atom), atom }
    })
    reads.set(key, entry)
    return entry
  }
  const read = (key: string): Accessor<unknown> => readEntry(key).accessor
  // Its `atom(key)`: the gate's output, or, given to a component (#349), the one of the element it drives.
  const atomOf = (key: string): Atom.Atom<unknown> => {
    const own = gate.valueOf(id, key)
    const following = drivenAtom()
    return Atom.make((get) => UndefinedOr.match(get(following), { onUndefined: () => get(own), onDefined: (d) => get(d.atom(key)) }))
  }

  // The element's style, read where it renders. The keys still loading at setup (#257 item 1) are
  // read there too, with the target, so its region holds until they land and Solid retries it: the
  // Retarget reads `transition` as it starts, untracked, which a pending one would throw out of.
  // After that a refetch keeps the last value (Solid holds the previous one), and holds nothing.
  const holdWhileLoading: () => void = Bool.match(setup.pending.length === 0, {
    onTrue: () => constVoid,
    onFalse: () => {
      const config = cfg() as unknown as Readonly<Record<string, unknown>>
      // Client-only, so transparent to hydration ids as every computation of the binding's is (#618).
      const loaded = createMemo((): true => {
        Arr.forEach(setup.pending, (key) => void config[key])
        target()
        return true
      }, CLIENT_ONLY)
      return () => {
        loaded()
      }
    },
  })
  const renderedStyle = (): JSX.CSSProperties => {
    holdWhileLoading()
    return elementStyle.style(userStyle()) as JSX.CSSProperties
  }

  // The ward: a ref, and its own props. Under a presence, its element is told to it as it's made
  // (#286): its `key`, and whether it's a twin.
  // What it shares with a component it's given to (#349), made when one asks.
  let shared: WardShare | undefined
  const sharedNow = (): WardShare => {
    if (Predicate.isNotUndefined(shared)) return shared
    /**
     * A ward driving an element for this one, given to a component (#349): followed until the release,
     * its `read` and `atom` Atoms reading the driver's. One at a time, and not while this one is on an
     * element of its own (#349's Q5).
     */
    const drive = (next: Driver, name: string): (() => void) => {
      if (Bool.or(Predicate.isNotUndefined(driver), stillOn(UndefinedOr.map(mounted, elementOfMount), undefined))) throw new Error(secondElement(name))
      driver = next
      UndefinedOr.map(driven, (atom) => registry().set(atom, next))
      return () => {
        if (driver !== next) return
        driver = undefined
        UndefinedOr.map(driven, (atom) => registry().set(atom, undefined))
      }
    }
    shared = {
      config,
      setup: initialConfig,
      internal,
      parent,
      chosen: Predicate.isNotUndefined(internal.parent),
      carries: carriesVariants(initialConfig),
      provided: node.provided,
      layoutGroup,
      node,
      lifecycle,
      drive,
    }
    return shared
  }

  const setMade = madeWith(presence, setElement, initialConfig)
  const self = ((value?: unknown): WardProps | undefined => {
    if (isElement(value)) {
      const last = refdLast
      if (Predicate.isNotUndefined(last)) {
        if (last !== value) {
          refdBefore = last
          if (Bool.not(last.isConnected)) fresh = value
        }
      }
      refdLast = value
      setMade(value)
      return undefined
    }
    return spreadNow()
  }) as Ward
  // What a spread of the ward reads (#495): its spread's props alone, made at its first spread, so a
  // ward given only to `ref` makes none, and a Reorder item's keyboard attributes are in it.
  let spread: WardProps | undefined
  // Its `style` and its attributes as descriptors, made once (#460): its own keys, its spread and each
  // `.with()` share them.
  const styleKey: PropertyDescriptor = { get: renderedStyle, enumerable: true }
  const attributes = attributeKeysOf(seed.attrs, Predicate.isNotUndefined(dragDefaults))
  const spreadNow = (): WardProps => {
    if (Predicate.isUndefined(spread)) spread = spreadOfWard(self, { value: self, enumerable: true }, styleKey, attributes)
    return spread
  }
  // Its members are the ones every ward shares (#525), reading this state: its own are `ref`, `style`
  // and its attributes.
  const state: WardState = {
    shared: sharedNow,
    Provider,
    read,
    atom: atomOf,
    with: (own: WardWithProps): WardProps => {
      given = own
      withCallsOf()[1](undefined)
      return spreadPropsOf({ ref: { value: withRef(own.ref, self), enumerable: true }, style: styleKey, ...attributes })
    },
    lifecycle,
    settled: undefined,
    tapped: undefined,
    next: undefined,
    each: undefined,
    when: undefined,
  }
  Object.setPrototypeOf(self, WARD_MEMBERS)
  Object.defineProperties(self, {
    [WARD_STATE]: { value: state },
    ref: { value: self, enumerable: true },
    style: styleKey,
    ...attributes,
  })
  return self
}

/** A key's `read`: its accessor, and the Atom it follows. */
interface ReadEntry {
  readonly accessor: Accessor<unknown>
  readonly atom: Atom.Atom<unknown>
}

/** No `.with()` props: the config's style alone. */
const NO_WITH: WardWithProps = {}

/** The last `.with()` merge, by its two styles: `style` reads it more than once a run. */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const withMerges = new WeakMap<object, { readonly own: unknown; readonly merged: WardStyle | string | undefined }>()

/**
 * The config's `style` with a `.with()` style over it, key by key (#264, `Style.over`): the config's
 * as it is with none. One merge for the same two styles, so the element's Live values see one object.
 */
const withStyleOver = (own: WardStyle | string | undefined, extra: WardStyle | string | undefined): WardStyle | string | undefined => {
  if (Predicate.isUndefined(extra)) return own
  if (Predicate.isString(extra)) return Style.over(extra, own) as WardStyle
  return Option.getOrElse(
    Option.map(Option.filter(Option.fromUndefinedOr(withMerges.get(extra)), (known) => known.own === own), (known) => known.merged),
    () => {
      const merged = Style.over(extra, own) as WardStyle
      withMerges.set(extra, { own, merged })
      return merged
    },
  )
}

/** A `.with()` ref beside the ward's own: the user's first, as `refsOf` orders them. */
const withRef = (user: WardWithProps["ref"], self: Ward): ((element: HTMLElement) => void) => {
  if (Predicate.isUndefined(user)) return self
  const refs = Arr.ensure(user) as ReadonlyArray<(element: HTMLElement) => void>
  return (element) => {
    Arr.forEach(refs, (ref) => ref(element))
    self(element)
  }
}

/**
 * The Starting style's attributes, and a drag element's default ones when it `drags`, as a ward's own
 * keys: enumerable, so a spread applies them. Made once a ward (#460), into one map.
 */
const attributeKeysOf = (attrs: Readonly<Record<string, unknown>>, drags: boolean): PropertyDescriptorMap => {
  const keys: PropertyDescriptorMap = {}
  addAttributeKeys(keys, attrs)
  if (drags) addAttributeKeys(keys, Style.DRAG_DEFAULT_ATTRIBUTES)
  return keys
}

/** Each of `attrs` as an enumerable key, into `keys`: a later one wins a key both set. */
const addAttributeKeys = (keys: PropertyDescriptorMap, attrs: Readonly<Record<string, unknown>>): void =>
  Arr.forEach(Object.keys(attrs), (key) => {
    keys[key] = { value: attrs[key], enumerable: true }
  })

/**
 * A spread's props, reaching no name but their own (#495): what a ward, its `.with()` or a Reorder group
 * hands an element's spread, and nothing else. Solid 2's `merge` calls a function source and reads each key off
 * what it returns with `in`, so a ward that returned itself shadowed the element's props with its own
 * names (`name`, `length`, `read`, `next`…), and an object with a prototype would with
 * `Object.prototype`'s (`constructor`, `toString`).
 */
export const spreadPropsOf = <P = WardProps,>(descriptors: PropertyDescriptorMap): P => Object.defineProperties(new SpreadProps(), descriptors) as P

/**
 * What a spread's props are made from (#495): a constructor whose prototype has no prototype and no
 * names, so its objects reach none but their own. An `Object.create(null)` would too, but V8 keeps it
 * in dictionary mode: 217 bytes each in Node 24, against 49 (`.tmp/495/spreadmem.mjs`).
 */
const SpreadProps = function SpreadProps(): void {} as unknown as new () => object
SpreadProps.prototype = Object.create(null)

/** The props a Reorder item adds to its ward's spread (#495): its keyboard attributes. Only items have them. */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const SPREAD_EXTRAS = new WeakMap<object, PropertyDescriptorMap>()

/**
 * `ward` with `descriptors` defined on it and added to its spread (#495), for a ward that carries props
 * of its own kind (a Reorder item's keyboard attributes). Before the ward's first spread.
 */
export const withSpreadProps = <W extends object>(ward: W, descriptors: PropertyDescriptorMap): W => {
  SPREAD_EXTRAS.set(ward, descriptors)
  return Object.defineProperties(ward, descriptors)
}

/** A ward's spread: its `ref`, `style` and attributes, and what {@link withSpreadProps} added, on no prototype. Made at its first spread (#460: one map). */
const spreadOfWard = (ward: object, ref: PropertyDescriptor, style: PropertyDescriptor, attributes: PropertyDescriptorMap): WardProps => {
  const extras = SPREAD_EXTRAS.get(ward)
  if (Predicate.isUndefined(extras)) return spreadPropsOf({ ref, style, ...attributes })
  return spreadPropsOf({ ref, style, ...attributes, ...extras })
}

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
  const view = configuredView(WARD_VIEW.of(config, internal.fixed), useWardicConfig())
  // A key still loading (#257 item 1): one setup fixes is the client's error here too. One the ward
  // reads as it goes is read again, throwing Solid's `NotReadyError`: a server waits for it and
  // renders the component again, so its region streams once the data is in, Appear and all.
  // Both are checked before the read that waits.
  const setup = WARD_VIEW.setupOf(view)
  // Animation controls (#433) set nothing on a server: no entry yet, and controlled, as on the client.
  const atSetup = uncontrolledOf(configAtSetup(setup))
  // Where it's made, its given parent's, or its given ward's (#349).
  const parent = variantParentOf(internal)
  const presenceBlocks = presenceBlocksInitial(usePresenceContext())
  if (Bool.and(Arr.contains(setup.pending, "animate"), startsAtAnimate(atSetup, inheritedContext(atSetup, parent), presenceBlocks))) throw new Error(STARTS_AT_PENDING)
  const c = uncontrolledOf(WARD_VIEW.snapshotOf(view))
  const node = serverVariantNode(c, parent)
  const initialValues = startOf(c, node.inherited, presenceBlocks, untrack).initialValues
  const layoutNode = isLayoutNode(c)
  const seed = Style.starting(internal.tag, drawnAtRest(initialValues, layoutNode, c.transformTemplate))
  // Its Appear animation (#48, ADR-0044): its slot in the render's, and the group its Variant
  // children join when it leads one.
  const appear = appearEntryOf(useWardicAppear(), c, internal.tag, initialValues, node, startsQuiet(c, node.inherited, presenceBlocks, untrack), settingOf(useWardicConfig()), useWardicSkipAnimations()())
  // A late chunk's root (#245): the chunk's Appear rules go through the head registry, read once
  // the chunk has rendered and streamed with it as a head patch. A late element under another late
  // one registers too: the first read writes the batch, and any other finds it written and adds no
  // tag, so Solid 1's `within` (which kept a chunk to one `<style>` node) isn't needed.
  if (appear.chunkRoot) UndefinedOr.map(appear.state, (state) => useHead(appearStyle(state.chunkCss, state.nonce)))
  const Provider = (props: { readonly children?: JSX.Element }): JSX.Element => (
    <WardicVariantContext value={contextOf(appear.provided)}>{props.children}</WardicVariantContext>
  )
  // Its routed keys' values join the Starting style, under `initial`'s (#130); a `<Reorder>` item's
  // base style, a drag element's defaults, then its Appear slot go under the user's style. A user
  // style with its own `animation` keeps it, over the slot, and the slot is left undefined.
  const dragDefaults = dragDefaultsOf(c, internal)
  // The element's style for its user style: the config's, or a `.with()` style over it (#264).
  const styleFor = (user: WardStyle | string | undefined): JSX.CSSProperties => {
    const parts = split(user)
    if (setsAnimation(parts.css)) appear.veto("its own style sets an animation")
    return pipe(
      serverStartingStyle(internal.tag, seed.style, initialValues, parts.routed, layoutNode, untrack, c.transformTemplate),
      Style.over(parts.css),
      Style.over(UndefinedOr.match(internal.baseStyle, { onUndefined: constUndefined, onDefined: (base) => base() })),
      Style.over(dragDefaults),
      Style.over(appear.style),
    ) as JSX.CSSProperties
  }
  const style = styleFor(c.style)
  let given: WardWithProps = NO_WITH
  const attributes = attributeKeysOf(seed.attrs, Predicate.isNotUndefined(dragDefaults))
  // A spread of it reads its spread's props alone, made at its first spread, as the client's (#495).
  let spread: WardProps | undefined
  const self = ((): WardProps => {
    if (Predicate.isUndefined(spread)) spread = spreadOfWard(self, { value: noRef, enumerable: true }, { value: style, enumerable: true }, attributes)
    return spread
  }) as Ward
  // What it shares with a component it's given to (#349): a server's component renders its own.
  const shared: WardShare = {
    config,
    setup: atSetup,
    internal,
    parent,
    chosen: Predicate.isNotUndefined(internal.parent),
    carries: carriesVariants(atSetup),
    provided: appear.provided,
    layoutGroup: useLayoutGroupId(),
    node: undefined,
    lifecycle: undefined,
    drive: () => constVoid,
  }
  Object.defineProperties(self, {
    [WARD]: { value: shared },
    ref: { value: noRef, enumerable: true },
    style: { value: style, enumerable: true },
    ...attributes,
    Provider: { value: Provider },
    read: { value: (key: string) => () => restingOf(key, initialValues, withStyleOver(c.style, given.style), readServerStyle) },
    atom: { value: (): Atom.Atom<unknown> => NO_OUTPUT },
    // Nothing animates on a server: nothing has landed, and nothing will.
    settled: { value: constUndefined },
    // Nothing is pressed on a server either.
    tapped: { value: constUndefined },
    next: { value: neverLands },
    each: { value: () => NO_EVENTS },
    when: { value: serverWhen },
    // The element's own style over the config's, rendered in its Starting style (#264).
    with: {
      value: (own: WardWithProps): WardProps => {
        given = own
        return spreadPropsOf({
          ref: { value: noRef, enumerable: true },
          style: { value: styleFor(withStyleOver(c.style, own.style)), enumerable: true },
          ...attributes,
        })
      },
    },
  })
  return self
}

/** A server render's `ref`: Solid never calls it there. */
const noRef = constUndefined


