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
 * SSR contract (ADR-0003): the initial style is resolved synchronously and
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
import * as BaseValue from "@wardic/core/BaseValue"
import type * as Frame from "@wardic/core/Frame"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import type * as Drag from "@wardic/core/Drag"
import * as Override from "@wardic/core/Override"
import * as Projection from "@wardic/core/Projection"
import * as Renderer from "@wardic/core/Renderer"
import * as Supersede from "@wardic/core/Supersede"
import * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import * as Appear from "@wardic/dom/Appear"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as OwnValues from "@wardic/dom/OwnValues"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Report from "@wardic/dom/Report"
import * as Style from "@wardic/dom/Style"
import * as Svg from "@wardic/dom/Svg"
import * as Variables from "@wardic/dom/Variables"
import { mergeRefs } from "@solid-primitives/refs"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberSet from "effect/FiberSet"
import { constFalse, constUndefined, constVoid, identity, pipe } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import { Atom, AtomRegistry } from "effect/reactivity"
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  type JSX,
  on,
  onCleanup,
  untrack,
} from "solid-js"
import { fromAtom } from "./bridge.ts"
import { dragTransitionOf, type DragTrackConfig, runDragTrack } from "./drag.ts"
import { createElementStyle } from "./element-style.ts"
import { createLiveStyle, type LiveSource, type LiveStyle, readLive, serverRegistryOf, split, valuesOf } from "./live-style.ts"
import { createVariantNode, hasOwnVariants, ownOrInherited, type ServerVariantNode, serverVariantNode, startingValuesOf, startsAtAnimate } from "./variant-node.ts"
import { useLayoutMember } from "./layout.tsx"
import { type Follows, type Leg, legsOf, startingAt } from "./retarget-legs.ts"
import { enterServer, type Handoff, handoffOf, keyOf, type MountAnimation, repeatsForever, type ServerAppear, setsAnimation, startAtOf } from "./appear.ts"
import { type PresenceRecord, presenceBlocksInitial, usePresenceContext } from "./presence.tsx"
import { createHover, createPress, createWhenWanted } from "./sensors.ts"
import { useWardicAppear, useWardicGate, useWardicPositionalKeys, useWardicProjection, useWardicReducedMotion, useWardicRuntime, type WardicRuntime, type WardicServices } from "./provider.tsx"
import { isHydrating, isServer } from "./server.ts"
import { type WardicVariantContextValue, useVariantContext, WardicVariantContext } from "./variants.ts"
import type { WardConfig, WardicTransformShorthands, WardicTransition, WardicValues } from "./config.ts"

/**
 * The Layout mode a `layout` prop names (ADR-0009, *Amendment (#42)*): a mode's name, else
 * `true` (`layout`, or a node a `layoutId`, `layoutScroll` or `layoutRoot` gives).
 */
const layoutModeOf = (layout: WardConfig["layout"]): Projection.LayoutMode =>
  Option.getOrElse(Option.liftPredicate(layout, isModeName), (): Projection.LayoutMode => true)

/** Whether a `layout` prop names a Layout mode (a string), not `true` / `false`. */
const isModeName = (layout: WardConfig["layout"]): layout is Exclude<WardConfig["layout"], boolean | undefined> => Predicate.isString(layout)

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
 * A Wardic element's `style` (#130, ADR-0043): every CSS property and the transform keys (`x`,
 * `scale`, `rotate`…), each a value or a **Live value**: an `effect/reactivity` Atom, or an
 * accessor (a signal, a memo, {@link createTransform}'s). A transform key is Wardic's, composed
 * into `transform` with its own (Motion's rule: with one set, a `transform` string is dropped). A
 * key is its Base value's `style` link: while no layer of the Override stack sets it, the element
 * shows it, following a Live value on every change, and a return goes to where it is then.
 */
export type WardStyle = { readonly [K in keyof WardicValues]?: WardicValues[K] | LiveSource<number | string> | undefined }

/** Spreadable props the {@link createWard} `ward` callable returns. */
export interface WardProps {
  /**
   * Ref callback — wires the element into the spine on mount (merging any
   * user-supplied ref via `mergeRefs`).
   */
  readonly ref: (el: HTMLElement) => void
  /**
   * Reactive projected `Patch` merged with any user style, typed as
   * `JSX.CSSProperties` so `{...ward()}` spreads cleanly (the projected keys are
   * valid CSS props).
   */
  readonly style: JSX.CSSProperties
  /** `"false"` on a drag element (Motion's default, ADR-0019 *Amendment (Reorder)*); absent otherwise. */
  readonly draggable?: "false"
}

/**
 * The callable returned by {@link createWard}. Called with no args it returns
 * ward's own ref + animated style (back-compat); called with {@link WardUserProps}
 * it returns the MERGED spreadable (user ref + ward ref; user style with ward's
 * animated style on top).
 *
 * It also carries a `Provider` property (ADR-0007): `<ward.Provider>{children}</ward.Provider>`
 * publishes THIS instance's current variant NAME + transition down the tree, so
 * descendant `createWard` calls inherit the variant by name (resolving it against
 * their own `variants` map).
 */
export type Ward = ((userProps?: WardUserProps) => WardProps) & {
  /**
   * Provides this ward instance's current variant name + transition to the
   * subtree (ADR-0007 name propagation). Inheriting children resolve the name
   * against their OWN `variants`.
   */
  readonly Provider: Component<{ readonly children?: JSX.Element }>
  /**
   * The element's value for `key`, live (#130, ADR-0043 decision 5): what Wardic shows for it,
   * whoever moves it (an animation, a drag, a Live value in `style`), as a number for a transform
   * key (`x`, not its `transform`). At rest outside the gate, its `initial`, else its `style`
   * value, else a transform key's identity (`x` 0, `scale` 1). Derive from it as from any Live
   * value: `createTransform(ward.value("x"), [-150, 0, 150], [0, 1, 0])`. A value derived from it
   * and given to another key's `style` moves in the same frame. Call it where you'd create a
   * signal: one accessor per key.
   */
  readonly value: WardValue
  /**
   * The element's value for `key` as an `effect/reactivity` Atom (`FlushGate.valueOf`): set as
   * each write that changes it lands, `undefined` while the gate doesn't hold the key. For Effect
   * code and core's `LiveValue` helpers; Solid code reads {@link value}.
   */
  readonly atom: (key: string) => Atom.Atom<unknown>
}

/** {@link Ward.value}: a transform key is always a number or a string; any other key may have no value. */
export interface WardValue {
  <A extends number | string = number>(key: keyof WardicTransformShorthands): Accessor<A>
  <A extends number | string = number>(key: string): Accessor<A | undefined>
}

/**
 * Resolve an `animate`-style entry (a {@link WardicValues} map or a variant name)
 * to a clean core {@link Values} map. Both arms funnel through {@link toValues}
 * so `Override.resolve` / `Values.split` never receive `undefined`-valued keys.
 */
const resolveValues = (
  entry: WardicValues | string | undefined,
  variants: Record<string, WardicValues> | undefined,
): Values.Values => resolveEntry({ entry, variants })

// Built once, at module load: a Retarget resolves its target per element (#69).
const resolveEntry: (input: {
  readonly entry: WardicValues | string | undefined
  readonly variants: Record<string, WardicValues> | undefined
}) => Values.Values = Match.type<{ readonly entry: WardicValues | string | undefined; readonly variants: Record<string, WardicValues> | undefined }>().pipe(
  Match.when({ entry: Match.undefined }, (): Values.Values => ({})),
  Match.when({ entry: Match.string }, ({ entry, variants }) => Style.toValues(UndefinedOr.map(variants, (byName) => byName[entry]))),
  Match.orElse(({ entry }) => Style.toValues(entry as WardicValues)),
)

/** A `<Reorder>` item's additions when there are none: a plain element's. */
const NO_INTERNALS: SpineInternals = {}

/** A `ward()` call's user props when it's given none. */
const NO_USER_PROPS: WardUserProps = {}

/** A config given as a value or as an accessor, as an accessor. A config is always an object, so a function is the accessor. */
export const accessorOf = <A extends object>(config: A | Accessor<A>): Accessor<A> =>
  Bool.match(Predicate.isFunction(config), { onTrue: () => config as Accessor<A>, onFalse: () => () => config as A })

/** A transition's `delay`, 0 without one. */
const delayOf = (transition: WardicTransition | undefined): number =>
  UndefinedOr.match(transition, { onUndefined: () => 0, onDefined: ({ delay = 0 }) => delay })

/** The keys a drag of `axis` moves directly. Built once, at module load. */
const dragMovesOf: (axis: boolean | "x" | "y") => ReadonlyArray<string> = Match.type<boolean | "x" | "y">().pipe(
  Match.when("x", (): ReadonlyArray<string> => ["x"]),
  Match.when("y", (): ReadonlyArray<string> => ["y"]),
  Match.orElse((): ReadonlyArray<string> => ["x", "y"]),
)

/** Whether a start link's value takes its target's shape: both numbers, or both strings. */
const isSameKind = (value: number | string, like: number | string): boolean => Predicate.isNumber(value) === Predicate.isNumber(like)

/** The keys a drag direct-sets (ADR-0004) and a projection owns (ADR-0016). */
const TRANSLATE_KEYS: ReadonlySet<string> = new Set(["x", "y", "translateX", "translateY"])
const TRANSLATE_KEY_LIST: ReadonlyArray<string> = Arr.fromIterable(TRANSLATE_KEYS)

/** Whether a value map has any key. */
const hasKeys: Predicate.Predicate<Values.Values> = Predicate.not(Rec.isEmptyRecord)

/** Whether a leg FiberSet still holds a fiber: a leg its Retarget's token didn't reach (#200). */
const holdsFibers = (set: FiberSet.FiberSet<void, never>): boolean => {
  if (set.state._tag === "Closed") return false
  return set.state.backing.size > 0
}

/** Whether two transitions have the same keys, each holding the same value (`===`). */
const sameFields = (a: WardicTransition, b: WardicTransition): boolean => {
  const ra = a as Readonly<Record<string, unknown>>
  const rb = b as Readonly<Record<string, unknown>>
  const keys = Rec.keys(ra)
  return Bool.and(keys.length === Rec.keys(rb).length, Arr.every(keys, (key) => Bool.and(key in rb, ra[key] === rb[key])))
}

/** The Override stack resolved: the spine effect's input. */
interface Resolution {
  /** Each key's value from the highest active layer. */
  readonly resolved: Values.Values
  /** The base layer, the first link of a key's Base value (ADR-0022). */
  readonly base: Values.Values
  /** Whether a drag holds the translate keys (ADR-0004's strip). */
  readonly dragging: boolean
}

/** Options for the internal {@link runSpine} helper. */
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
 */
export interface SpineInternals {
  readonly tag?: string | undefined
  readonly dragAxis?: (() => boolean | "x" | "y") | undefined
  readonly onDragSample?: ((sample: Drag.Sample) => void) | undefined
  readonly onLayoutHandle?: ((handle: ProjectionSystem.NodeHandle) => void) | undefined
  readonly raiseWhileDragged?: boolean | undefined
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
  /**
   * Reactive extra delay (seconds) folded into the effective transition's
   * `delay` for the inherited-variant Retarget (ADR-0007 per-child stagger).
   * Read at Retarget time. Optional — omitted = no extra delay.
   */
  readonly extraDelay?: (() => number) | undefined
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
  /**
   * Whether the element's drag defaults and base style reach it with its props: a `createWard`
   * spread's `style` and attributes. Otherwise the spine sets them on the element at mount (the
   * directives, and a `wardic.create(Component)` wrap, in case its component doesn't pass them
   * on).
   */
  readonly defaultsInProps?: boolean | undefined
}

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
export function runSpine(opts: RunSpineOptions): void {
  const { canStart, cfg, defaultsInProps, el, extraDelay, gate, hydrating, id, internal = NO_INTERNALS, live, makeSink, onFrame, parent, runtime, styleOf, tag } = opts
  // The element's Appear animation, while hydrating (#48, ADR-0044 decision 6): found at mount,
  // taken over by its first Retarget that starts, and removed in its first commit.
  let handoff: Handoff | undefined
  // A `style` value read now: a Live value's current value (#130), anything else as it is.
  const readStyle = (raw: unknown): unknown => {
    if (Predicate.isUndefined(live)) return raw
    return live.read(raw)
  }

  // The nearest <AnimatePresence>, or undefined at the root (ADR-0007). When
  // present, this spine publishes its live value-map (`snapshot`) + exit target
  // (`exit`) into a presence registration; the PARENT drives the exit on leave
  // (this child is disposed). The child does NOT unregister on its own
  // onCleanup — <AnimatePresence> owns removal after the exit settles.
  const presence = usePresenceContext()

  // Whether reduced motion applies (ADR-0029), read at each Retarget.
  const reducedMotion = useWardicReducedMotion()
  const positionalKeys = useWardicPositionalKeys()

  // SSR seed: resolved purely from the config read EXACTLY ONCE (untrack — no
  // reactive dependency, must not re-seed after mount), with the inherited `initial`
  // name for a Variant child that has none (#50). Seeds the spring `from` Snapshot so
  // frame 1 flows continuously out of it (no snap).
  const initialConfig = untrack(cfg)
  // With `initial={false}` (its own, inherited, or an `<AnimatePresence initial={false}>`'s first
  // render) the seed is its `animate`, and nothing animates at mount (#134).
  const presenceBlocks = presenceBlocksInitial(presence)
  const startedAtAnimate = startsAtAnimate(initialConfig, parent, presenceBlocks)
  const initialValues = startingValuesOf(initialConfig, parent, presenceBlocks)
  // Its `initial` link in the Base-value chain and its fallback base layer, or, having started at
  // `animate`, none: those values come after `style`, as Motion's `baseTarget` (ADR-0022, #134).
  const initialLink: Values.Values = Bool.match(startedAtAnimate, { onTrue: () => ({}), onFalse: () => initialValues })
  const startedLink: Values.Values = Bool.match(startedAtAnimate, { onTrue: () => initialValues, onFalse: () => ({}) })

  // Plain (non-reactive) Snapshot ref: each key's last emitted value, a number or a
  // string, + the numeric velocities, seeded from the SSR initial (velocities 0). Used
  // to retarget from where each key is, with momentum carried across the seam
  // (ADR-0005, ADR-0024).
  const snapshot: { values: Values.Values; velocities: Record<string, number> } = {
    values: { ...initialValues },
    velocities: {},
  }

  // The transition this element's last Retarget ran on (#66): a Retarget's that has the same
  // fields is that object, so core's decode cache hits when the object is rebuilt with the same
  // values (a staggered child's, ADR-0007, or one Solid rebuilds as it reads a signal).
  let lastTransition: WardicTransition | undefined
  const reused = (transition: WardicTransition): WardicTransition =>
    Option.fromUndefinedOr(lastTransition).pipe(
      Option.filter((last) => sameFields(last, transition)),
      Option.getOrElse(() => {
        lastTransition = transition
        return transition
      }),
    )

  // Start everything once the element mounts. createEffect(on(el, ...)) re-runs
  // only when the element identity changes; the spine inner-effect lives under
  // this owner so onCleanup teardown (gate.unregister + fiber interrupts) fires
  // on unmount.
  createEffect(
    on(el, (element) => {
      if (Predicate.isUndefined(element)) return

      // Register the element with the caller-supplied sink (ADR-0006): each
      // flushed frame's Patch is committed onto it (ADR-0034). An element with `onUpdate` at mount
      // is told each committed frame (#233); any other never joins the gate's tells.
      if (hydrating === true) handoff = Option.getOrUndefined(handoffOf(element))
      const unregister = gate.register(id, releasingAppear(withOnUpdate(makeSink(element), untrack(cfg).onUpdate, cfg), handoff, element))
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
        const dragAxis = dragAxisOf(untrack(cfg), internal)
        if (Predicate.isNotUndefined(dragAxis)) applyDragDefaults(element, Style.dragDefaults(dragAxis))
      }

      // --- Base values (ADR-0022) ---------------------------------------------
      // A key with no value starts from its `style` value, else its Own value; a key no
      // layer sets any more returns to its Base value (`initial`, `style`, Own value). The
      // Own value is read from the element once per key, at first need (D3): this runs after
      // mount, so never on a server (ADR-0021). Each link is coerced to the shape of the
      // key's target (`like`).
      const ownValue = OwnValues.of(element)
      // Its Variable values (#55, ADR-0035 *Amendment (#55)*): the Key rule bound to this element,
      // added to each leg it starts, so a `var()` end blends what it resolves to here.
      const elementRules = [Variables.values(element)]
      const linksFor = (like: number | string) => ({
        style: (key: string) =>
          Option.flatMap(Option.fromUndefinedOr(styleOf), (of) =>
            Option.flatMap(OwnValues.styleValueOf(untrack(of), key), (raw) => OwnValues.valueLike(readStyle(raw), like)),
          ),
        own: (key: string) => Option.flatMap(ownValue(key), (raw) => OwnValues.valueLike(raw, like)),
      })
      const startLinkOf = (key: string, like: number | string) => BaseValue.start(key, linksFor(like))

      // --- Presence registration (ADR-0007 exit) -------------------------------
      // Under an <AnimatePresence>, publish a live record so the PARENT can drive
      // this element's exit after Solid disposes its owner. `snapshot.current` is
      // updated to the latest emitted value-map EACH FRAME (so the exit departs
      // continuously from where the element rests); `exit.current` tracks
      // cfg().exit reactively. Seed the snapshot with the SSR initial so an exit
      // that fires before any frame still has a sensible `from`. The child does
      // NOT call the disposer on its own onCleanup — <AnimatePresence> removes the
      // registration after the exit settles.
      let presenceRec: PresenceRecord | undefined
      if (Predicate.isNotUndefined(presence)) {
        const rec: PresenceRecord = {
          element,
          snapshot: { current: { ...initialValues } },
          exit: { current: Style.toValues(untrack(cfg).exit) },
          // An exit key with no value starts from its Base value's start links (ADR-0022),
          // read from the retained node at the exit.
          startOf: (key, like) => Option.getOrUndefined(Option.map(startLinkOf(key, like), (start) => start.value)),
        }
        presenceRec = rec
        presence.register(rec)
        // Keep exit.current current while the child is alive.
        createEffect(() => {
          rec.exit.current = Style.toValues(cfg().exit)
        })
      }

      // Merge an emitted frame's value-map into the presence snapshot (no-op
      // without a presence). The accumulator mirrors what the gate accumulates,
      // so the exit departs from the element's actual resting value-map.
      const recordFrame = (value: Values.Values): void => {
        if (Predicate.isNotUndefined(presenceRec)) Object.assign(presenceRec.snapshot.current, value)
      }

      // A routed key a return handed back: written by the follower from now on (#130). Set below,
      // with the follower; a return settles a tick after this runs at the earliest.
      let handBack: (key: string) => void = constVoid

      // A Retarget's returns have settled (ADR-0022, D4). A key back at its `style` value is
      // handed back to the element's style, so a later style change shows at rest and the
      // next gesture starts from it; any other key rests inline at its Base value and leaves
      // the target. A key a later Retarget took over is left alone. A routed key (#130) stays
      // in the gate, handed to the follower, which writes its value from now on.
      const settleReturns = (returns: ReadonlyArray<readonly [string, BaseValue.BaseSource]>): void => {
        // The returns still this Retarget's: a later one took over the rest.
        const settled = Arr.filter(returns, ([key, source]) => returning.get(key) === source)
        Arr.forEach(settled, ([key]) => {
          returning.delete(key)
          driven.delete(key)
        })
        const toStyle = Arr.map(Arr.filter(settled, ([, source]) => source === "style"), ([key]) => key)
        const routedNow = (key: string): boolean => UndefinedOr.match(live, { onUndefined: constFalse, onDefined: (routes) => routes.routes(key) })
        Arr.forEach(Arr.filter(toStyle, routedNow), (key) => handBack(key))
        const handedBack = Arr.filter(toStyle, Predicate.not(routedNow))
        if (Arr.isReadonlyArrayEmpty(handedBack)) return
        // The gate writes the user's current value back, as the element's `style` would
        // (ADR-0034). A key gone from the user's style by now is cleared, not restored stale.
        const restore = UndefinedOr.map(styleOf, (of) => {
          const style = untrack(of)
          return Object.fromEntries(
            Arr.map(handedBack, (key) => [key, Option.match(OwnValues.styleValueOf(style, key), { onNone: () => "", onSome: (value) => String(value) })]),
          ) as Record<string, string>
        })
        gate.release(id, handedBack, restore)
        Arr.forEach(handedBack, (key) => {
          delete snapshot.values[key]
          delete snapshot.velocities[key]
          if (Predicate.isNotUndefined(presenceRec)) delete presenceRec.snapshot.current[key]
        })
      }

      // Cold path: once per Retarget that started a key from its Base value or returned one,
      // run at the head of that Retarget's first leg (no fiber of its own: forking one per
      // element cost 10-20 µs each at a 1000-element mount).
      const baseLog = (started: Record<string, string>, returns: ReadonlyArray<readonly [string, BaseValue.BaseSource]>): Effect.Effect<void> =>
        Effect.logDebug("wardic.base: a key with no value started from, or returned to, its Base value (ADR-0022)").pipe(
          Effect.annotateLogs({ id, started, returned: Object.fromEntries(returns) }),
        )

      // Every element's values, by element, for the projection (ADR-0012 *Amendment (#137)*): a twin's
      // flight follows the translate and scale Wardic animates on its ancestors each frame.
      onCleanup(useWardicProjection().registerValues(element, () => snapshot.values))

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
      const layoutId = c0.layoutId
      // layout / layoutId / layoutScroll / layoutRoot each warrant a node; layoutAnchor
      // alone does not (it only tunes a node that already projects), but is forwarded.
      let layoutHandle: ProjectionSystem.NodeHandle | undefined
      // What every release runs on, the layout node's Release offset and the drag track's (ADR-0016, *Amendment (#140)*).
      const dragTransition = dragTransitionOf(c0.dragElastic, c0.dragTransition)
      if (c0.layout === true || Predicate.isString(c0.layout) || Predicate.isNotUndefined(layoutId) || c0.layoutScroll === true || c0.layoutRoot === true) {
        layoutHandle = useLayoutMember({
          id,
          element,
          layoutDependency: () => cfg().layoutDependency,
          transition: () => ownOrInherited(cfg().transition, parent),
          dragTransition: () => dragTransition,
          // The Layout mode, read at each layout animation's start (ADR-0009, *Amendment (#42)*).
          layoutMode: () => layoutModeOf(cfg().layout),
          // The own scale the renderer draws, from the values last written (ADR-0010 *Amendment (#8)*).
          ownScale: () => DomRenderer.ownScaleOf(snapshot.values),
          // And its own rotate and opacity, which a handover blends into (ADR-0010 *Amendment (#166)*).
          ownRotate: () => DomRenderer.ownRotateOf(snapshot.values),
          ownOpacity: () => DomRenderer.ownOpacityOf(snapshot.values),
          // The app's layout animation callbacks, read when they fire (#191, ADR-0039).
          onLayoutAnimationStart: () => cfg().onLayoutAnimationStart,
          onLayoutAnimationComplete: () => cfg().onLayoutAnimationComplete,
          ...UndefinedOr.match(layoutId, { onUndefined: () => ({}), onDefined: (twinId) => ({ layoutId: twinId }) }),
          ...Bool.match(c0.layoutScroll === true, { onTrue: () => ({ layoutScroll: true }), onFalse: () => ({}) }),
          ...Bool.match(c0.layoutRoot === true, { onTrue: () => ({ layoutRoot: true }), onFalse: () => ({}) }),
          ...UndefinedOr.match(c0.layoutAnchor, { onUndefined: () => ({}), onDefined: (anchor) => ({ layoutAnchor: anchor }) }),
          ...Bool.match(internal.raiseWhileDragged === true, { onTrue: () => ({ raiseWhileDragged: true }), onFalse: () => ({}) }),
        })
        if (Predicate.isNotUndefined(internal.onLayoutHandle)) internal.onLayoutHandle(layoutHandle)
      }

      // --- Drag track (ADR-0004) ----------------------------------------------
      // When cfg().drag is truthy, run the binding-orchestrated drag track: the
      // pointer DIRECT-SETS x/y (1:1, not sprung) while the spring keeps driving
      // every other key + whileDrag. `dragging` is the ONLY reactive piece (it
      // gates the whileDrag override + the translate-key strip below); the drag
      // CONFIG is static — read ONCE here (untrack), since drag config is a
      // document. The track's single fiber is scoped to this owner's onCleanup.
      const dragCfg = dragAxisOf(untrack(cfg), internal)
      const [dragging, setDragging] = createSignal(false)
      if (Predicate.isNotUndefined(dragCfg)) {
        const c0d = untrack(cfg)
        const trackConfig: DragTrackConfig = {
          axis: dragCfg,
          constraints: c0d.dragConstraints,
          elastic: c0d.dragElastic,
          momentum: c0d.dragMomentum,
          snapToOrigin: c0d.dragSnapToOrigin,
          propagation: c0d.dragPropagation,
          transition: dragTransition,
        }
        runDragTrack({
          runtime,
          gate,
          id,
          element,
          snapshot,
          recordFrame,
          setDragging,
          config: trackConfig,
          // ADR-0016: a drag on a LAYOUT node feeds the projection (the renderer
          // ignores a projected element's raw x/y), so the dragged item follows the
          // pointer and FLIPs to its slot on release. Free drag (no handle) is unchanged.
          ...UndefinedOr.match(layoutHandle, { onUndefined: () => ({}), onDefined: (projection) => ({ projection }) }),
          ...UndefinedOr.match(internal.dragAxis, { onUndefined: () => ({}), onDefined: (axisAt) => ({ axisAt }) }),
          ...UndefinedOr.match(internal.onDragSample, { onUndefined: () => ({}), onDefined: (onSample) => ({ onSample }) }),
        })
      }

      // Recognizers over the live element, each started the first time its `while*` target
      // appears (#87, ADR-0040), its fiber scoped to this owner's onCleanup via
      // streamToSignal -> runScoped. Until then it reads false.
      const hovered = createWhenWanted(
        () => Predicate.isNotUndefined(cfg().whileHover),
        () => createHover(element),
      )
      const pressed = createWhenWanted(
        () => Predicate.isNotUndefined(cfg().whileTap),
        () => createPress(element),
      )

      // The keys a Retarget drove, each with its last target value (its shape), and the
      // ones returning to their Base value until that return settles (ADR-0022). Both are
      // the spine effect's: a Retarget mid-return carries them again, so a return is never
      // frozen half-way, and a key that settled has left them, so a Retarget of the same
      // target (a `when` gate reopening, ADR-0007) leaves it be. The translate keys never
      // return on a projected element (the projection owns them, ADR-0016). On a drag
      // element, the keys the drag moves leave the return while it runs, so they stay where
      // it dropped them (C9) until a layer sets them again.
      const driven = new Map<string, number | string>()
      let returning = new Map<string, BaseValue.BaseSource>()
      const projected = Predicate.isNotUndefined(layoutHandle)
      const dragMoves: ReadonlyArray<string> = Bool.match(projected, {
        onTrue: (): ReadonlyArray<string> => [],
        onFalse: () => UndefinedOr.match(dragCfg, { onUndefined: (): ReadonlyArray<string> => [], onDefined: dragMovesOf }),
      })

      // Override stack (ascending priority): base (animate, or initial when no
      // animate) -> whileHover -> whileTap. Override.resolve picks the last
      // active entry per key. The memo DEPENDS on cfg() (read inside), so a
      // reactive config change recomputes target() and drives a Retarget. Pure: the
      // returns, the drag strip and every read are the spine effect's.
      const target = createMemo<Resolution>(() => {
        const c = cfg()
        // Read each field directly off the whole-config snapshot. Reactivity is
        // via cfg() itself: a signal touched inside the config accessor recomputes
        // cfg(), recomputes this memo, and drives a Retarget. `variants` is shared
        // by base + overrides.
        const animate = c.animate
        const variants = c.variants
        // Base target resolution priority (ADR-0007):
        //   (1) local `animate` (a Values map or a variant name) — overrides any
        //       inherited variant entirely;
        //   (2) else an INHERITED variant name from the parent context, resolved
        //       against THIS child's OWN `variants` (a child's "open" != its
        //       sibling's "open"); read parent.variant() here so a parent flip
        //       recomputes this memo and retargets;
        //   (3) else the SSR-seeded `initial`.
        const base = UndefinedOr.match(animate, {
          onDefined: (own) => resolveValues(own, variants),
          onUndefined: () =>
            UndefinedOr.match(
              UndefinedOr.map(parent, (p) => p.variant()),
              { onDefined: (inheritedName) => resolveValues(inheritedName, variants), onUndefined: () => initialLink },
            ),
        })
        const resolved = Override.resolve([
          { active: true, values: base },
          { active: hovered(), values: Style.toValues(c.whileHover) },
          { active: pressed(), values: Style.toValues(c.whileTap) },
          // whileDrag sits ABOVE tap (highest priority) — driven by the spring,
          // NOT stripped, so e.g. `scale: 1.1` animates while held and returns
          // after release. Read dragging() so a flip recomputes this memo; a keyboard
          // lift turns it on too (ADR-0037).
          { active: Bool.or(dragging(), Predicate.isNotUndefined(internal.lifted) && internal.lifted()), values: Style.toValues(c.whileDrag) },
        ])
        return { resolved, base, dragging: dragging() }
      })

      // The spine: on each target change, end the running legs and reseed a fresh primitive
      // from the Snapshot (velocity-preserving). Every leg runs in this element's FiberSet (#76)
      // and joins its Retarget's token: a Retarget ends the token before it starts its own legs,
      // and the element's teardown ends it and closes its Scope. Both end the legs in the calling
      // task: each leg's run leaves the loop at once, and its fiber ends Superseded, inline
      // (ADR-0027, decision 5, *Amendment (#200)*). A leg the token didn't reach is interrupted,
      // by the FiberSet's clear or the Scope's close. The same shape as the projection system's
      // end-of-task holds.
      const legScope = Scope.makeUnsafe()
      const legFibers = runtime.runSync(FiberSet.make<void, never>().pipe(Scope.provide(legScope)))
      // The running legs' token (#200, ADR-0027 *Amendment (#200)*): a Retarget ends it and starts
      // its own, so its legs are Superseded, not interrupted: off the loop at once, their fibers
      // ended normally, at about a sixth of an interrupt's cost.
      let generation = Supersede.make()
      onCleanup(() => {
        // The legs end normally first, so closing the Scope has nothing left to interrupt.
        Supersede.end(generation)
        runtime.runFork(Scope.close(legScope, Exit.void))
      })

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
          ({ resolved, base, dragging: held }) => {
            Supersede.end(generation)
            generation = Supersede.make()
            // One options object for this Retarget's legs, each joining its token.
            const runOptions = { supersede: generation }
            // A leg its token didn't reach (one not on the loop) is interrupted, as before.
            if (holdsFibers(legFibers)) runtime.runFork(FiberSet.clear(legFibers))

            // `when` start-gate (ADR-0007): when canStart() is false, freeze at the
            // snapshot (the previous legs are already interrupted) and bail; the
            // effect re-runs once the gate flips true (tracked above).
            if (Predicate.isNotUndefined(canStart) && !canStart()) {
              // Report NOT settled: a gated child sits at its snapshot, still
              // owing an animation, so it must not count as settled (afterChildren).
              if (Predicate.isNotUndefined(onFrame)) onFrame(false)
              return
            }

            // A key a Retarget drove and no layer sets now returns to its Base value
            // (ADR-0022); with none, it stays where it is (as before #47).
            const t: Values.Values = { ...resolved }
            Arr.forEach(Rec.keys(resolved), (key) => {
              if (Bool.not(projected && TRANSLATE_KEYS.has(key))) driven.set(key, resolved[key])
            })
            if (held) Arr.forEach(dragMoves, (key) => driven.delete(key))
            returning = new Map()
            // Over the Map itself: copying it into an array first costs ~20 times the walk, per element
            // per Retarget (#69's PR 4). Deleting the entry being visited is safe in a Map's iteration.
            Iter.forEach(driven, ([key, like]) => {
              // A translate key the strip below holds back returns once the drag lets go.
              if (Object.hasOwn(resolved, key) || (held && TRANSLATE_KEYS.has(key))) return
              Option.match(BaseValue.of(key, { base, initial: initialLink, started: startedLink, ...linksFor(like) }), {
                onNone: () => {
                  driven.delete(key)
                },
                onSome: (r) => {
                  t[key] = r.value
                  returning.set(key, r.source)
                },
              })
            })
            // MULTI-OWNER strip (ADR-0004): while dragging, x/y are DIRECT-SET by the
            // drag track, so strip the translate keys from the spring's target — the
            // spring must never fight the direct-set. Once dragging() is false the
            // keys re-enter normally (post-drag handoff: the spring continues x/y only
            // if `animate` sets them, from the snapshot's rested position).
            if (held) Arr.forEach(TRANSLATE_KEY_LIST, (key) => delete t[key])
            // Every key's Own value is read at its first need, before anything writes it, so a
            // return later finds the element's value, not Wardic's (ADR-0022, D3). The read is
            // kept: a later need is a lookup. A transform key reads nothing.
            Arr.forEach(Rec.keys(t), (key) => {
              if (Bool.not(Object.hasOwn(initialValues, key))) ownValue(key)
            })
            // Each key starts from its Snapshot value, coerced to its target's shape (ADR-0024,
            // D1). A key with no value yet, or one whose value can't take that shape, starts
            // from its Base value's start links, read here at its first need (ADR-0022, D3);
            // with none, it starts at its target (no motion).
            const started: Record<string, string> = {}
            Arr.forEach(Rec.keys(t), (key) => {
              const like = t[key]
              const coerced = OwnValues.valueLike(snapshot.values[key], like)
              if (Option.isSome(coerced)) {
                snapshot.values[key] = coerced.value
                return
              }
              Option.match(Option.filter(startLinkOf(key, like), (s) => isSameKind(s.value, like)), {
                onSome: (s) => {
                  snapshot.values[key] = s.value
                  started[key] = s.source
                },
                onNone: () => {
                  snapshot.values[key] = like
                  started[key] = "target"
                },
              })
            })
            const from: Values.Values = Rec.map(t, (_, key) => UndefinedOr.getOrThrow(snapshot.values[key]))
            // The keys this Retarget returns; once every leg settles, a key back at its
            // `style` value is handed back to the element's style (D4) and the rest rest inline.
            const returns = [...returning]
            // Each leg: the base-value log at the head of the first, and, once the leg's run
            // settles, a count toward settling the returns, so the per-frame handlers stay as
            // they were.
            let pendingLog = Bool.match(returns.length > 0 || Bool.not(Rec.isEmptyRecord(started)), {
              onTrue: (): Effect.Effect<void> | undefined => baseLog(started, returns),
              onFalse: constUndefined,
            })
            let legs = 0
            const legDone = Effect.sync(() => {
              if (--legs === 0) settleReturns(returns)
            })
            // A leg's end, told apart (ADR-0027, decision 7): a settle counts toward the returns;
            // a Superseded end (a Retarget, an unmount, #200) or an interruption (a leg its token
            // didn't reach) is nothing; anything else (a step or a sink that threw, the Frame loop's
            // own failure) is logged and reported (ADR-0030, decision 4), and doesn't count.
            const legEnded = (exit: Exit.Exit<unknown>): Effect.Effect<void> =>
              Exit.match(exit, {
                // A Superseded leg (#200) counts toward nothing: the next Retarget's legs settle the returns.
                onSuccess: (end) => Bool.match(Supersede.isSuperseded(end), { onTrue: () => Effect.void, onFalse: () => legDone }),
                onFailure: (cause) => Report.failure("wardic.spine: a leg failed", cause).pipe(Effect.annotateLogs({ id })),
              })
            // The element settles with its last leg (ADR-0024, D5): a string leg can outlast the
            // numeric one, so each leg's frames report, and only the last leg's settle reports done.
            let reporting = 0
            let settled = 0
            const report = (done: boolean): void => {
              if (done) settled++
              if (Predicate.isNotUndefined(onFrame)) onFrame(settled === reporting)
            }
            const leg = <R,>(program: Effect.Effect<unknown, never, R>): Effect.Effect<void, never, R> => {
              legs++
              const log = pendingLog
              pendingLog = undefined
              return UndefinedOr.match(log, {
                onUndefined: () => program,
                onDefined: (head) => Effect.andThen(head, program),
              }).pipe(Effect.onExit(legEnded), Effect.asVoid)
            }
            // Start a leg in this element's FiberSet: forked on the provider's runtime, which runs
            // it inline up to its add on the loop, so every leg started in a task is on the loop by
            // the end of that task and takes its first step at the next tick (ADR-0027 decision 5,
            // ADR-0033). Not `FiberSet.run`: forked from
            // a `runSync`, a leg would inherit that call's scheduler (ADR-0027, decision 6).
            const runLeg = <R extends WardicServices>(program: Effect.Effect<unknown, never, R>): void =>
              FiberSet.addUnsafe(legFibers, runtime.runFork(leg(program)))
            // Read transition from cfg() at retarget time so transition changes
            // apply to the next retarget. (Read inside this effect run; the effect
            // is gated on `target`, which already depends on cfg().) A child with
            // no local transition inherits the parent context's (ADR-0007).
            const baseTransition = ownOrInherited(cfg().transition, parent)
            // Fold the per-child stagger delay (ADR-0007) into the effective
            // transition.delay = base.delay + computedDelay. extraDelay() is read
            // at Retarget time so a re-snapshot before this start is reflected.
            const extra = UndefinedOr.match(extraDelay, { onUndefined: () => 0, onDefined: (delay) => delay() })
            const transition = UndefinedOr.map(
              Bool.match(extra !== 0, {
                onTrue: (): WardicTransition | undefined => ({ ...baseTransition, delay: delayOf(baseTransition) + extra }) as WardicTransition,
                onFalse: () => baseTransition,
              }),
              reused,
            )
            // The legs (#48, ADR-0044 decision 8): one pure builder, which a server render's Appear
            // animation samples too, so the two can't drift. Built here; each leg's machine is built
            // in its own fiber, so a transition core rejects (#66, ADR-0025 *Amendment (#66)*) fails
            // that leg alone, reported as any leg's failure is, while the element's other legs run on.
            // The returns to a moving Live value (#130, ADR-0043 decision 6): a number's follows it,
            // in a leg of its own, and lands on it; the rest return to where it is now. Looked for
            // only when this Retarget returns a key.
            let follow: Follows | undefined
            if (returning.size > 0 && Predicate.isNotUndefined(live)) {
              const routes = live
              follow = { keysOf: (rest) => followingOf(routes, rest, returning), targetOf: (key, start) => liveTargetOf(routes, key, start) }
            }
            const reduce = reducedMotion()
            let retargetLegs = legsOf(from, t, transition, reduce, positionalKeys, snapshot.velocities, follow)
            // The Handoff (#48, ADR-0044 decision 6): the first Retarget that starts picks the Appear
            // animation up as far in as its CSS has got, read at the legs' first tick.
            if (Predicate.isNotUndefined(handoff)) {
              const taken = handoff
              handoff = undefined
              checkHandoff(runtime, id, taken, { tag, from, to: t, transition: baseTransition, reduced: reduce, layout: isLayoutNode(untrack(cfg)) })
              const at = startAtOf(taken, baseTransition, delayOf(transition))
              retargetLegs = Arr.map(retargetLegs, (leg) => startingAt(leg, at))
            }
            reporting = retargetLegs.length
            // Each leg into its sink, in the builder's order: one dispatcher a Retarget, each sink
            // built for the leg that needs it (#69's PR 2: a Retarget is per element).
            Arr.forEach(retargetLegs, (leg: Leg): void => {
              if (leg._tag === "Follow") {
                const key = leg.key
                const out: Record<string, number> = { [key]: 0 }
                runLeg(
                  Effect.suspend(() =>
                    leg.machine().pipe(
                      Machine.run((frame) => {
                        out[key] = frame.value
                        snapshot.values[key] = frame.value
                        snapshot.velocities[key] = UndefinedOr.match(frame.velocity, { onUndefined: () => 0, onDefined: identity })
                        gate.write(id, out)
                        recordFrame(out)
                        report(frame.done)
                        return undefined
                      }, runOptions),
                    )),
                )
                return
              }
              if (leg._tag === "Numbers") {
                runLeg(
                  Effect.suspend(() =>
                    leg.machine().pipe(
                      Machine.run((frame) => {
                        // MULTI-OWNER MERGE (ADR-0004): merge the spring's keys into the snapshot
                        // rather than replacing it, so the drag's direct-set x/y survive alongside the
                        // spring's keys (drag owns x/y, spring owns the rest) and the post-drag
                        // handoff continues from the rested position.
                        snapshot.values = { ...snapshot.values, ...frame.value }
                        snapshot.velocities = { ...snapshot.velocities, ...frame.velocity }
                        gate.write(id, frame.value)
                        recordFrame(frame.value)
                        report(frame.done)
                        return undefined
                      }, runOptions),
                    )),
                )
                return
              }
              // A snap's or a blend's frames: merged into the Snapshot (ADR-0004), as the spring's are.
              const sink = (frame: Frame.Frame<Values.Values>): undefined => {
                snapshot.values = { ...snapshot.values, ...frame.value }
                gate.write(id, frame.value)
                recordFrame(frame.value)
                report(frame.done)
                return undefined
              }
              if (leg._tag === "Snap") {
                // A snapped key comes to rest, so a later spring starts it at rest.
                snapshot.velocities = { ...snapshot.velocities, ...Rec.fromEntries(Arr.map(leg.keys, (key) => [key, 0] as const)) }
                runLeg(Effect.suspend(() => leg.machine().pipe(Machine.run(sink, runOptions))))
                return
              }
              runLeg(
                Effect.suspend(leg.machine).pipe(
                  InterpolatorRegistry.withKeyRules(elementRules),
                  Effect.flatMap(Machine.run(sink, runOptions)),
                ),
              )
            })
          },
        ),
      )

      // --- Live values in `style` (#130, ADR-0043) ------------------------------
      // A routed key (a Live value, or a transform key) is its `style` link, live: while no layer of
      // the Override stack sets it, no return is running to it and no drag moves it, the element
      // follows it, written through the gate on every change. A return hands it back here when it
      // settles (`settleReturns`). The Starting style showed each one's value at render; from mount
      // the gate holds them.
      if (Predicate.isNotUndefined(live)) {
        const routes = live
        // Built at the first routed key, at mount or later: an element whose `style` routes none builds nothing.
        routes.whenRouted(() => {
          const dragHolds = Bool.and(Bool.not(projected), Predicate.isNotUndefined(dragCfg))
          // Whether something other than the follower moves `key` now.
          const owned = (key: string): boolean =>
            Bool.some([
              driven.has(key),
              Object.hasOwn(untrack(target).resolved, key),
              // The drag direct-sets both translate keys while it, and its release, run (ADR-0004).
              Bool.and(dragHolds, Bool.and(untrack(dragging), Bool.or(key === "x", key === "y"))),
            ])
          // Written as any frame is: into the gate, the Snapshot (at rest) and the presence record.
          const put = (values: Values.Values): void => {
            Arr.forEach(Rec.keys(values), (key) => {
              snapshot.values[key] = UndefinedOr.getOrThrow(values[key])
              delete snapshot.velocities[key]
            })
            gate.write(id, values)
            recordFrame(values)
          }
          handBack = (key) => {
            Option.match(Option.filter(routes.valueOf(key), isValue), {
              onNone: constVoid,
              onSome: (value) => put({ [key]: value }),
            })
          }
          // Every routed key nothing owns, with, before anything's committed, the values the Override
          // stack's keys start from, so a held start (a `when` gate) keeps showing them.
          const first = Rec.filter(routes.values(), (_, key) => Bool.not(owned(key)))
          if (hasKeys(first)) put({ ...Values.pick(snapshot.values, untrack(target).resolved), ...first })
          return {
            change: (key, value) => {
              if (Bool.or(owned(key), Bool.not(isValue(value)))) return
              put({ [key]: value as number | string })
            },
            removed: (key) => {
              if (owned(key)) return
              delete snapshot.values[key]
              delete snapshot.velocities[key]
              if (Predicate.isNotUndefined(presenceRec)) delete presenceRec.snapshot.current[key]
              // Gone from `style`: the element's own value comes back, or the key's CSS value now.
              const restore = Option.match(OwnValues.styleValueOf(UndefinedOr.match(styleOf, { onUndefined: constUndefined, onDefined: untrack }), key), {
                onNone: () => "",
                onSome: String,
              })
              gate.release(id, [key], { [key]: restore })
            },
          }
        })
        onCleanup(() => routes.stop())
      }
    }),
  )
}

/**
 * `sink` with an `onCommit` that calls the config's current `onUpdate` (#233), when the config had
 * one at mount; `sink` as it is otherwise.
 */
const withOnUpdate = (sink: FlushGate.Sink, atMount: WardConfig["onUpdate"], cfg: Accessor<WardConfig>): FlushGate.Sink => {
  // Per element at mount: most have none, and pay a check.
  if (Predicate.isUndefined(atMount)) return sink
  return {
    ...sink,
    onCommit: (latest) => {
      const onUpdate = untrack(cfg).onUpdate
      if (Predicate.isNotUndefined(onUpdate)) onUpdate(latest as Readonly<Record<string, number | string>>)
    },
  }
}


/**
 * `sink`, removing the element's Appear animation in its first commit (#48, ADR-0044 decision 6):
 * in the task that writes the engine's first frame, so no paint falls between. Without one, `sink`.
 */
const releasingAppear = (sink: FlushGate.Sink, handoff: Handoff | undefined, element: HTMLElement): FlushGate.Sink => {
  if (Predicate.isUndefined(handoff)) return sink
  const before = sink.beforeFirstCommit
  return {
    ...sink,
    beforeFirstCommit: () => {
      Appear.release(element)
      if (Predicate.isNotUndefined(before)) before()
    },
  }
}

/**
 * A Handoff whose Appear animation the server sampled from another mount animation than the
 * client's: the app rendered differently on the server, or a function it gave has no easing name.
 * Noted once (cold path, `wardic.hydration`); the client's own animation goes on from the same time.
 */
const checkHandoff = (runtime: WardicRuntime, id: string, handoff: Handoff, mount: MountAnimation): void => {
  const same = Option.exists(keyOf(mount), (key) =>
    Appear.matches(handoff.animation, { key, tag: mount.tag, infinite: repeatsForever(mount.transition), projected: mount.layout }))
  if (same) return
  runtime.runFork(
    Effect.logDebug("wardic.hydration: the server's Appear animation was sampled from another mount animation than this element's; it goes on from the same time").pipe(
      Effect.annotateLogs({ id }),
    ),
  )
}

/** The keys a Retarget returns to a Live value that's a number: each one's return follows it (#130). */
const followingOf = (routes: LiveStyle, rest: Values.Values, returning: ReadonlyMap<string, BaseValue.BaseSource>): ReadonlyArray<string> =>
  Arr.filter(Rec.keys(rest), (key) => Bool.and(returning.get(key) === "style", Bool.and(routes.isLive(key), Predicate.isNumber(rest[key]))))

/** Where `key`'s Live value is now, a number; where it last was when it's none (#130). */
const liveTargetOf = (routes: LiveStyle, key: string, start: number): (() => number) => {
  let last = start
  return () => {
    const now = Option.flatMap(routes.valueOf(key), (raw) => OwnValues.valueLike(raw, last))
    if (Option.isSome(now)) last = now.value as number
    return last
  }
}

/** Whether a value is one an element can take: a number or a string. */
const isValue = (value: unknown): value is number | string => Bool.or(Predicate.isNumber(value), Predicate.isString(value))

/**
 * Create a **Ward**, one element's motion binding (ADR-0042): spread it onto the element
 * (`<div {...ward()}>`) to drive it through Wardic's motion spine. Solid's `create*`
 * convention: it owns computations under the current owner, as `createDrag` does.
 *
 * `config` may be a plain {@link WardConfig} (back-compat) OR an
 * `Accessor<WardConfig>` for reactive config: when the accessor reads signals,
 * a change recomputes the override-stack `target()` and drives a
 * velocity-preserving Retarget through the existing Snapshot wiring. `animate` /
 * `whileHover` / `whileTap` / `transition` / `variants` are read reactively
 * through `cfg()`; `initial` is read EXACTLY ONCE at setup (`untrack`) — it is
 * the SSR/first-frame seed and must never re-seed after mount (ADR-0003).
 *
 * @param config initial/animate/whileHover/whileTap + transition (see {@link WardConfig}), or an accessor of it.
 * @returns the Ward: call it to spread onto a JSX element.
 */
export function createWard(config: WardConfig | Accessor<WardConfig>): Ward {
  return createWardWith(config, undefined)
}

/**
 * {@link createWard} with a `<Reorder>` item's additions (internal, ADR-0020; not
 * exported from the package).
 */
export function createWardWith(config: WardConfig | Accessor<WardConfig>, internal: SpineInternals = NO_INTERNALS): Ward {
  const runtime = useWardicRuntime()
  // A server render takes the lean path: the Starting style only, no spine (ADR-0021).
  if (isServer) return serverWard(config, internal)
  const gate = useWardicGate()
  // Owner-scoped, SSR/hydration-stable unique id for this element's gate entry
  // (Solid's createUniqueId, not a module counter — see ADR note / no global state).
  const id = createUniqueId()

  // Normalize to an Accessor<WardConfig>. A WardConfig is always an object,
  // so `typeof config === "function"` is a safe discriminant for the accessor.
  const cfg: Accessor<WardConfig> = accessorOf(config)

  // Its place in variant orchestration (ADR-0007, #50): what it hands its children, and,
  // as a Variant child, the ancestor it inherits from and joins (its stagger slot, its
  // `when`). Read at hook-call time (component body owner), for this instance's lifetime.
  const node = createVariantNode(cfg, useVariantContext())

  // Resolve the Renderer's PURE project once (ADR-0003: synchronous, no engine).
  const { project } = runtime.runSync(Renderer.Renderer)

  // SSR seed: resolved purely from the config read EXACTLY ONCE (untrack — no
  // reactive dependency, must not re-seed after mount), with the inherited `initial`
  // name for a Variant child that has none (#50). It's the `style` until the first
  // commit, so pre-mount render carries the initial style (no flash).
  const initialConfig = untrack(cfg)
  const initialValues = startingValuesOf(initialConfig, node.inherited, presenceBlocksInitial(usePresenceContext()))
  // A layout node's is drawn through its projection at rest, as its first commit draws it (#245).
  const layoutNode = isLayoutNode(initialConfig)
  const drawnStart = drawnAtRest(initialValues, layoutNode)

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
  const live = createLiveStyle({ registry: registryOf(runtime), onDroppedTransform: () => warnDroppedTransform(runtime, id) })
  const projectStarting = Bool.match(hydrating, { onTrue: () => DomRenderer.project, onFalse: () => project })
  const startingWith = (routed: Values.Values): Renderer.Patch =>
    Svg.splitPatchForTag(internal.tag, projectStarting(drawnAtRest({ ...routed, ...initialValues }, layoutNode))).style

  // A drag element's defaults (ADR-0019 *Amendment (Reorder)*), under the user's
  // style: `drag` is static, so they're chosen once.
  const dragAxis = dragAxisOf(untrack(cfg), internal)
  const dragDefaults = UndefinedOr.map(dragAxis, Style.dragDefaults)
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
  })

  // The element, available only after ref-mount. The spine is gated on it.
  const [el, setEl] = createSignal<HTMLElement>()

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
    parent: node.inherited,
    extraDelay: node.extraDelay,
    canStart: node.canStart,
    onFrame: node.onFrame,
    internal,
    styleOf: () => lastUserProps.style,
    live,
    // The gate commits onto the element (an svg-inner element's attribute keys as
    // attributes, ADR-0014); the hooks switch the spread's `style` (ADR-0034).
    makeSink: (element) => ({ target: element, ...elementStyle.hooks }),
    // The spread's `style` and attributes carry the drag defaults and the base style.
    defaultsInProps: true,
    hydrating,
    tag: internal.tag,
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
        ref: mergeRefs(userProps.ref, setEl),
        // Getter so spreading {...ward()} stays reactive (Solid tracks the access): the
        // Starting style over the user's until the first commit, then the user's without the
        // keys the gate holds (ADR-0034). It never changes per frame.
        get style() {
          return elementStyle.style(userProps.style)
        },
        ...seed.attrs,
        ...UndefinedOr.match(dragDefaults, { onUndefined: () => ({}), onDefined: () => Style.DRAG_DEFAULT_ATTRIBUTES }),
      }
    },
    { Provider, value: value as WardValue, atom: (key: string) => gate.valueOf(id, key) },
  )
  return ward
}

/**
 * Where `key` rests outside the gate (#130): its `initial`, else its `style` value (a Live value's
 * now), else a transform key's identity, else `undefined`.
 */
const restingOf = (key: string, initial: Values.Values, style: object | string | undefined, read: (value: unknown) => unknown): unknown =>
  Option.getOrUndefined(
    Option.fromUndefinedOr(initial[key]).pipe(
      Option.orElse((): Option.Option<unknown> => Option.flatMap(OwnValues.styleValueOf(style, key), (raw) => Option.fromNullishOr(read(raw)))),
      Option.orElse((): Option.Option<unknown> => BaseValue.transformIdentity(key)),
    ),
  )

/** A provider runtime's `AtomRegistry`, read on first need: an element with no Atom never reads it. */
export const registryOf = (runtime: WardicRuntime): (() => AtomRegistry.AtomRegistry) => {
  let registry: AtomRegistry.AtomRegistry | undefined
  return () => {
    if (Predicate.isUndefined(registry)) registry = runtime.runSync(AtomRegistry.AtomRegistry)
    return registry
  }
}

/** Log, once per element, that a `transform` string gave way to the transform keys in its `style` (#130). */
export const warnDroppedTransform = (runtime: WardicRuntime, id: string): void => {
  runtime.runFork(
    Effect.logWarning(
      "wardic.style: a `transform` string is dropped while `style` sets a transform key (x, scale, rotate…); " +
        "the keys win, as Motion's do. Give the transform as keys, or drop them",
    ).pipe(Effect.annotateLogs({ id })),
  )
}

/** A server's output Atom: nothing is written there, so it stays `undefined`. */
const NO_OUTPUT: Atom.Atom<unknown> = Atom.make<unknown>(undefined)

/**
 * Log, at debug level, the keys whose Starting style the Environment's Renderer projects
 * differently from the DOM's `project`, which rendered the server markup. Hydration keeps
 * the server's values (the Hydration hold); the Renderer's take over at the first frame.
 * Hydration only, once per element. Internal.
 */
export const flagStartingStyle = (runtime: WardicRuntime, id: string, server: Renderer.Patch, client: Renderer.Patch): void => {
  const keys = Arr.appendAll(
    Arr.filter(Rec.keys(server), (key) => String(server[key]) !== String(client[key])),
    Arr.filter(Rec.keys(client), (key) => Bool.not(key in server)),
  )
  if (Arr.isReadonlyArrayEmpty(keys)) return
  const pick = (patch: Renderer.Patch) => Object.fromEntries(keys.map((key) => [key, patch[key]]))
  runtime.runFork(
    Effect.logDebug(
      "wardic.hydration: the Environment's Renderer projects the Starting style differently from the DOM's; " +
        "hydration keeps the server's until the first frame, and an element that never animates keeps it",
    ).pipe(
      Effect.annotateLogs({ id, keys, server: pick(server), client: pick(client) }),
    ),
  )
}

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
  const c = accessorOf(config)()
  // The same names the client hands down, read once, with orchestration that does nothing
  // (#50); a Variant child's Starting style starts from its ancestor's `initial` name.
  const node = serverVariantNode(c, useVariantContext())
  const layoutNode = isLayoutNode(c)
  const seed = Style.starting(internal.tag, drawnAtRest(startingValuesOf(c, node.inherited, presenceBlocksInitial(usePresenceContext())), layoutNode))
  const dragAxis = dragAxisOf(c, internal)
  const dragDefaults = UndefinedOr.map(dragAxis, Style.dragDefaults)
  const initialValues = startingValuesOf(c, node.inherited, presenceBlocksInitial(usePresenceContext()))
  // Its Appear animation (#48, ADR-0044): its slot in the render's, and the group its Variant
  // children join when it leads one.
  const appear = serverAppearOf(c, internal.tag, initialValues, node)
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
          serverStartingStyle(internal.tag, seed.style, initialValues, parts.routed, layoutNode),
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

/** An element's Appear animation on a server (#48, ADR-0044), as `serverWard` and a component wrap use it. */
export interface ServerAppearOf {
  /** Its inline `animation`, under the user's style: none when it plays none. */
  readonly style: { readonly animation: string } | undefined
  /** The context its children read: its variant node's, with its Appear group when it leads one. */
  readonly provided: WardicVariantContextValue | undefined
  /** Rules it out once it has rendered: its user style is read when `ward()` is called. */
  readonly veto: (reason: string) => void
  /**
   * Rendered after the shell (#245): in a late chunk, and its root when no late element is around
   * it, which puts the chunk's `<style>` after itself. `state` is the render's.
   */
  readonly late: boolean
  readonly chunkRoot: boolean
  readonly state: ServerAppear | undefined
}

/** No Appear animation: a provider with `appear={false}`. */
const NO_APPEAR = (provided: WardicVariantContextValue | undefined): ServerAppearOf => ({
  style: undefined,
  provided,
  veto: constVoid,
  late: false,
  chunkRoot: false,
  state: undefined,
})

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

/**
 * An element's entry in the server render's Appear animations (#48, ADR-0044): its starting
 * values, its targets at mount (`animate`, or an inherited variant name against its `variants`),
 * its transition, and its place in its parent's group.
 */
export const serverAppearOf = (c: WardConfig, tag: string | undefined, initialValues: Values.Values, node: ServerVariantNode): ServerAppearOf =>
  UndefinedOr.match(useWardicAppear(), {
    onUndefined: () => NO_APPEAR(node.provided),
    onDefined: (state) => {
      const entered = enterServer(state, {
        appear: c.appear,
        tag,
        initial: initialValues,
        to: serverTargetOf(c, node.inherited),
        transition: ownOrInherited(c.transition, node.inherited),
        layout: isLayoutNode(c),
        group: Option.flatMap(Option.fromUndefinedOr(node.inherited), (inherited) => Option.fromUndefinedOr(inherited.appearGroup)),
        leads: hasOwnVariants(c),
        ownTransition: c.transition,
      })
      return {
        style: Option.match(entered.animation, { onNone: constUndefined, onSome: (animation) => ({ animation }) }),
        provided: Option.match(entered.group, {
          onNone: () => node.provided,
          onSome: (appearGroup) => UndefinedOr.map(node.provided, (provided): WardicVariantContextValue => ({ ...provided, appearGroup })),
        }),
        veto: entered.veto,
        late: entered.late,
        chunkRoot: entered.chunkRoot,
        state,
      }
    },
  })

/** An element's targets at mount on a server: its `animate`, else an inherited variant name resolved against its own `variants`. */
const serverTargetOf = (c: WardConfig, inherited: WardicVariantContextValue | undefined): Option.Option<Values.Values> =>
  UndefinedOr.match(c.animate, {
    onDefined: (own) => Option.some(resolveValues(own, c.variants)),
    onUndefined: () =>
      Option.map(
        Option.flatMap(Option.fromUndefinedOr(inherited), (context) => Option.fromUndefinedOr(context.variant())),
        (name) => resolveValues(name, c.variants),
      ),
  })

/** A style value read on a server: an Atom through a server's own registry, an accessor called (#130). */
const readServerStyle = (value: unknown): unknown => readLive(value, serverRegistryOf)

/**
 * A server's Starting style for an element whose `style` has routed keys (#130): the projected
 * `initial` with their values under it. With none, its Starting style as it was.
 */
export const serverStartingStyle = (
  tag: string | undefined,
  starting: Renderer.Patch,
  initialValues: Values.Values,
  routed: Readonly<Record<string, unknown>>,
  layout: boolean,
): Renderer.Patch =>
  Bool.match(Rec.isEmptyRecord(routed), {
    onTrue: () => starting,
    onFalse: () => Style.starting(tag, drawnAtRest({ ...valuesOf(routed, serverRegistryOf), ...initialValues }, layout)).style,
  })

/** Whether a config makes its element a layout node: `layout` (or a mode), or a `layoutId`. */
export const isLayoutNode = (c: WardConfig): boolean =>
  Bool.or(Bool.and(Predicate.isNotUndefined(c.layout), c.layout !== false), Predicate.isNotUndefined(c.layoutId))

/**
 * The values a layout node's Starting style is drawn from (#245, ADR-0044 *Amendment (#245)*):
 * through its projection at rest, as its first commit draws it, its own `x` and `y` left out (the
 * projection owns translate, ADR-0016). Any other element's, as they are.
 */
export const drawnAtRest = (values: Values.Values, layout: boolean): Readonly<Record<string, unknown>> =>
  Bool.match(layout, { onTrue: () => ({ ...values, [Projection.KEY]: Projection.AT_REST }), onFalse: () => values })

/** A server render's `ref`: Solid never calls it there. */
const noRef = (): void => {}

/**
 * The drag axis a spine runs with: its static `drag` config, else `true` for a
 * `<Reorder>` item (its gesture's axis comes from `dragAxis`), else none.
 */
export const dragAxisOf = (config: WardConfig, internal: SpineInternals = NO_INTERNALS): boolean | "x" | "y" | undefined =>
  Option.getOrUndefined(
    Option.orElse(Option.filter(Option.fromUndefinedOr(config.drag), (drag) => drag !== false), () =>
      Option.map(Option.fromUndefinedOr(internal.dragAxis), (): true => true)),
  )

/**
 * Set each of a drag element's defaults its inline style doesn't already set, and
 * `draggable="false"` unless it has the attribute (the commit-sink paths, at mount).
 */
const applyDragDefaults = (element: HTMLElement, defaults: Style.DragDefaults): void => {
  Arr.forEach(Rec.keys(defaults), (key) => {
    if (element.style.getPropertyValue(key) === "") element.style.setProperty(key, UndefinedOr.getOrThrow(defaults[key]))
  })
  if (!element.hasAttribute("draggable")) element.setAttribute("draggable", Style.DRAG_DEFAULT_ATTRIBUTES.draggable)
}
