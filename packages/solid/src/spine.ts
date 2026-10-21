/**
 * The motion spine's Retarget (ADR-0005), Solid-free (#209): what an element does from its mount on
 * when its target changes, for the Solid 1 binding (`create-ward.tsx`'s `runSpine`) and the Solid 2
 * one (`unstable/v2/ward.tsx`) alike. A binding mounts the element, resolves its Override stack
 * reactively ({@link resolutionOf}), and calls {@link ElementSpine.retarget} on each change, read
 * where its Solid doesn't track; everything a Retarget does is here:
 *
 *   end the running legs -> carry the keys no layer sets back to their Base values (ADR-0022) ->
 *   start each key from its Snapshot (ADR-0024) -> take over an Appear animation (ADR-0044) ->
 *   build the legs (`retarget-legs.ts`) and run each into the gate -> `gate.write`.
 *
 * With it, the helpers both bindings' Wards share: the Starting values, the Base values' start links,
 * the sink wrappers, and what a server render reads.
 *
 * @module
 */
import * as BaseValue from "@wardic/core/BaseValue"
import type * as Frame from "@wardic/core/Frame"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Machine from "@wardic/core/Machine"
import * as Override from "@wardic/core/Override"
import * as Projection from "@wardic/core/Projection"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Renderer from "@wardic/core/Renderer"
import * as Supersede from "@wardic/core/Supersede"
import * as Values from "@wardic/core/Values"
import * as Appear from "@wardic/dom/Appear"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as OwnValues from "@wardic/dom/OwnValues"
import * as Report from "@wardic/dom/Report"
import * as Style from "@wardic/dom/Style"
import * as Variables from "@wardic/dom/Variables"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Equivalence from "effect/Equivalence"
import * as Exit from "effect/Exit"
import * as FiberSet from "effect/FiberSet"
import { constFalse, constUndefined, constVoid, identity } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import { AtomRegistry } from "effect/reactivity"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import { enterServer, type Handoff, keyOf, type MountAnimation, repeatsForever, type ServerAppear, startAtOf } from "./appear.ts"
import type { WardConfig, WardicAnimationDefinition, WardicTransition, WardicValues } from "./config.ts"
import { type LiveStyle, serverRegistryOf, valuesOf } from "./live-style.ts"
import type { PresenceRecord } from "./presence-record.ts"
import type { Accessor, Reactivity } from "./reactivity.ts"
import { type Follows, type Leg, legsOf, startingAt } from "./retarget-legs.ts"
import type { WardicRuntime, WardicServices } from "./runtime.ts"
import { hasOwnVariants, nameOf, ownOrInherited, type ServerVariantNode, startingValuesOf, startsAtAnimate, type WardicVariantContextValue } from "./variant-tree.ts"

/**
 * Resolve an `animate`-style entry (a {@link WardicValues} map or a variant name)
 * to a clean core {@link Values} map. Both arms funnel through `Style.toValues`
 * so `Override.resolve` / `Values.split` never receive `undefined`-valued keys.
 */
export const resolveValues = (
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

/** A config given as a value or as an accessor, as an accessor. A config is always an object, so a function is the accessor. */
export const accessorOf = <A extends object>(config: A | Accessor<A>): Accessor<A> =>
  Bool.match(Predicate.isFunction(config), { onTrue: () => config as Accessor<A>, onFalse: () => () => config as A })

/** A transition's `delay`, 0 without one. */
export const delayOf = (transition: WardicTransition | undefined): number =>
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

/** The Override stack resolved: a Retarget's input. */
export interface Resolution {
  /** Each key's value from the highest active layer. */
  readonly resolved: Values.Values
  /** The base layer, the first link of a key's Base value (ADR-0022). */
  readonly base: Values.Values
  /** Whether a drag holds the translate keys (ADR-0004's strip). */
  readonly dragging: boolean
  /** The variant name the base layer resolved: its own `animate`'s, else the one it inherits; none for a values map. */
  readonly variant: string | undefined
}

/** Two values maps with the same keys, each holding the same value. Built once, at module load. */
const sameValues: Equivalence.Equivalence<Values.Values> = Rec.makeEquivalence(Equivalence.strictEqual<number | string>())

/**
 * Whether two resolutions are the same target (#209): the same values for the same keys, in the
 * base layer and resolved, the same drag, and the same variant name. Motion's rule: a config that
 * resolves to the same values doesn't animate (a `transition` change applies from the next
 * change), and a new variant name does, even to the same values. The Solid 2 binding's target memo
 * compares with it, so a `style` or `transition` change in a ward's config doesn't Retarget.
 */
export const sameResolution = (a: Resolution, b: Resolution): boolean =>
  Bool.every([a.dragging === b.dragging, a.variant === b.variant]) && sameValues(a.resolved, b.resolved) && sameValues(a.base, b.base)

/** Motion's `definition` of an animation (#257): a variant name, or its target values. */
export type AnimationDefinition = string | Values.Values

/**
 * A Retarget's `definition`, as Motion's `onAnimationStart` / `onAnimationComplete` hand it over
 * (#257): the variant name its base layer resolved, when that name differs from the last started
 * Retarget's (`previous`), else the target's values. Motion's definition is per animation type: a
 * new `animate` variant animates as its name, and a gesture turning on or off as values (its own,
 * or the keys it leaves falling back), so a variant's name is only told when the variant changed.
 */
export const definitionOf = (resolution: Resolution, previous: string | undefined): AnimationDefinition =>
  UndefinedOr.match(resolution.variant, {
    onUndefined: (): AnimationDefinition => resolution.resolved,
    onDefined: (name) => Bool.match(name === previous, { onTrue: (): AnimationDefinition => resolution.resolved, onFalse: () => name }),
  })

/**
 * What a Retarget tells its binding (#257): that it started, and that its last leg settled. Each is
 * handed the Retarget's resolution, the variant name the last started Retarget resolved before it
 * (for {@link definitionOf}), and the config it read.
 */
export interface AnimationHooks {
  /** A Retarget started its legs (the `when` gate let it); with no leg, it settles at once. */
  readonly started: (resolution: Resolution, previous: string | undefined, config: WardConfig) => void
  /** That Retarget's last leg settled: not for one the next Retarget superseded, nor one a leg's failure cut off. */
  readonly settled: (resolution: Resolution, previous: string | undefined, config: WardConfig) => void
}

/**
 * Solid 1's animation callbacks (#257, Motion's props): each Retarget's start and settle told to the
 * config's `onAnimationStart` / `onAnimationComplete`, with its `definition`, as the Retarget read
 * the config. A callback that throws is reported, and the element animates on. The Solid 2 binding's
 * config has neither: it hands the same facts over as async values.
 */
export const animationCallbacks = (runtime: WardicRuntime, id: string): AnimationHooks => {
  const call =
    (name: "onAnimationStart" | "onAnimationComplete") =>
    (resolution: Resolution, previous: string | undefined, config: WardConfig): void => {
      const callback = config[name]
      if (Predicate.isUndefined(callback)) return
      try {
        callback(definitionOf(resolution, previous) as WardicAnimationDefinition)
      } catch (defect) {
        runtime.runFork(Report.failure(`wardic.spine: ${name} failed`, Cause.die(defect)).pipe(Effect.annotateLogs({ id })))
      }
    }
  return { started: call("onAnimationStart"), settled: call("onAnimationComplete") }
}

/** Which layers of the Override stack are active now, as the binding reads them. */
export interface Active {
  readonly hovered: boolean
  readonly pressed: boolean
  /** A drag, or a **Keyboard reorder**'s lift (ADR-0037): `whileDrag` applies. */
  readonly dragged: boolean
  /** A drag: the translate keys are the drag's (ADR-0004). */
  readonly dragging: boolean
}

/**
 * The Override stack resolved (ascending priority): base (animate, or initial when no animate) ->
 * whileHover -> whileTap -> whileDrag. `Override.resolve` picks the last active entry per key. Pure:
 * a binding computes it in a memo, so a config change, an inherited variant name's
 * (`parent.variant()`, read only when there's no `animate`) or a layer's drives a Retarget.
 */
export const resolutionOf = (
  c: WardConfig,
  parent: WardicVariantContextValue | undefined,
  initialLink: Values.Values,
  active: Active,
): Resolution => {
  const variants = c.variants
  // Base target resolution priority (ADR-0007):
  //   (1) local `animate` (a Values map or a variant name) — overrides any
  //       inherited variant entirely;
  //   (2) else an INHERITED variant name from the parent context, resolved
  //       against THIS child's OWN `variants` (a child's "open" != its
  //       sibling's "open"); read parent.variant() here so a parent flip
  //       recomputes the memo and retargets;
  //   (3) else the SSR-seeded `initial`.
  const variant = UndefinedOr.match(c.animate, { onDefined: nameOf, onUndefined: () => UndefinedOr.map(parent, (p) => p.variant()) })
  const base = UndefinedOr.match(c.animate, {
    onDefined: (own) => resolveValues(own, variants),
    onUndefined: () => UndefinedOr.match(variant, { onDefined: (inheritedName) => resolveValues(inheritedName, variants), onUndefined: () => initialLink }),
  })
  const resolved = Override.resolve([
    { active: true, values: base },
    { active: active.hovered, values: Style.toValues(c.whileHover) },
    { active: active.pressed, values: Style.toValues(c.whileTap) },
    // whileDrag sits ABOVE tap (highest priority) — driven by the spring,
    // NOT stripped, so e.g. `scale: 1.1` animates while held and returns
    // after release.
    { active: active.dragged, values: Style.toValues(c.whileDrag) },
  ])
  return { resolved, base, dragging: active.dragging, variant }
}

/** The values an element starts from, read once at setup (ADR-0003, #134). */
export interface Start {
  /** Its Starting style's values: its `initial` (own or inherited, #50), or its `animate` when it starts there. */
  readonly initialValues: Values.Values
  /** Its `initial` link in the Base-value chain and its fallback base layer: none when it started at `animate`. */
  readonly initialLink: Values.Values
  /** When it started at `animate`, those values, which come after `style` (Motion's `baseTarget`, ADR-0022). */
  readonly startedLink: Values.Values
}

/**
 * An element's {@link Start}, from its config read once and the context it inherits from. With
 * `initial={false}` (its own, inherited, or an `<AnimatePresence initial={false}>`'s first render)
 * it starts at its `animate`, and nothing animates at mount (#134).
 */
export const startOf = (
  config: WardConfig,
  parent: WardicVariantContextValue | undefined,
  presenceBlocks: boolean,
  untrack: Reactivity["untrack"],
): Start => {
  const startedAtAnimate = startsAtAnimate(config, parent, presenceBlocks)
  const initialValues = startingValuesOf(config, parent, presenceBlocks, untrack)
  return {
    initialValues,
    initialLink: Bool.match(startedAtAnimate, { onTrue: () => ({}), onFalse: () => initialValues }),
    startedLink: Bool.match(startedAtAnimate, { onTrue: () => initialValues, onFalse: () => ({}) }),
  }
}

/**
 * The Snapshot: each key's last emitted value, a number or a string, and the numeric velocities.
 * A Retarget starts each key from where it is, with momentum carried across the seam (ADR-0005,
 * ADR-0024). Plain, not reactive; a drag writes its `x`/`y` into it too (ADR-0004).
 */
export interface Snapshot {
  values: Values.Values
  velocities: Record<string, number>
}

/** A Snapshot seeded from the Starting values, velocities 0, so frame 1 flows out of the seed (no snap). */
export const snapshotOf = (start: Start): Snapshot => ({ values: { ...start.initialValues }, velocities: {} })

/**
 * The transition a Retarget runs on (#66): the element's last one when the new one has the same
 * fields, so core's decode cache hits when the object is rebuilt with the same values (a staggered
 * child's, ADR-0007, or one Solid rebuilds as it reads a signal). One per element.
 */
export const makeReuse = (): ((transition: WardicTransition) => WardicTransition) => {
  let lastTransition: WardicTransition | undefined
  return (transition) =>
    Option.fromUndefinedOr(lastTransition).pipe(
      Option.filter((last) => sameFields(last, transition)),
      Option.getOrElse(() => {
        lastTransition = transition
        return transition
      }),
    )
}

/**
 * A mounted element's Base-value links (ADR-0022): a key with no value starts from its `style`
 * value, else its Own value. The Own value is read from the element once per key, at first need
 * (D3): after mount, so never on a server (ADR-0021). Each link is coerced to the shape of the
 * key's target (`like`). `styleNow` reads the user's style untracked; a Live value in it is read now.
 */
export const startLinksOf = (element: HTMLElement, styleNow: (() => object | string | undefined) | undefined, live: LiveStyle | undefined) => {
  const ownValue = OwnValues.of(element)
  // A `style` value read now: a Live value's current value (#130), anything else as it is.
  const readStyle = (raw: unknown): unknown => {
    if (Predicate.isUndefined(live)) return raw
    return live.read(raw)
  }
  const linksFor = (like: number | string) => ({
    style: (key: string) =>
      Option.flatMap(Option.fromUndefinedOr(styleNow), (now) =>
        Option.flatMap(OwnValues.styleValueOf(now(), key), (raw) => OwnValues.valueLike(readStyle(raw), like)),
      ),
    own: (key: string) => Option.flatMap(ownValue(key), (raw) => OwnValues.valueLike(raw, like)),
  })
  const startLinkOf = (key: string, like: number | string) => BaseValue.start(key, linksFor(like))
  return { ownValue, linksFor, startLinkOf }
}

/** {@link startLinksOf}'s links. */
export type StartLinks = ReturnType<typeof startLinksOf>

/**
 * An element's presence record (ADR-0007 exit): seeded with its Starting values, so an exit that
 * fires before any frame still has a `from`, and its `exit` ref, which the ward keeps current. An exit key with no value starts
 * from its Base value's start links (ADR-0022), read from the retained node at the exit.
 */
export const presenceRecordOf = (element: HTMLElement, start: Start, exit: { current: Values.Values }, links: StartLinks): PresenceRecord => ({
  element,
  snapshot: { current: { ...start.initialValues } },
  exit,
  startOf: (key, like) => Option.getOrUndefined(Option.map(links.startLinkOf(key, like), (s) => s.value)),
})

/**
 * Merge an emitted frame's value-map into a presence record's snapshot (nothing without one). It
 * mirrors what the gate accumulates, so an exit departs from the element's actual resting value-map.
 */
export const recordFrameOf = (presence: PresenceRecord | undefined): ((value: Values.Values) => void) => (value) => {
  if (Predicate.isNotUndefined(presence)) Object.assign(presence.snapshot.current, value)
}

/** What {@link makeElementSpine} reads. */
export interface ElementSpineOptions {
  /** The provider runtime the legs fork on. */
  readonly runtime: WardicRuntime
  /** The provider-owned flush gate (ADR-0006). */
  readonly gate: FlushGate.Shape
  /** The element's gate id. */
  readonly id: string
  /** The mounted element. */
  readonly element: HTMLElement
  /** Its tag, for a Handoff's check (SVG's routing): `undefined` when it isn't known. */
  readonly tag: string | undefined
  /** Its config now, read where the binding doesn't track. */
  readonly config: () => WardConfig
  /** The variant context it inherits names and its default transition from (`variant-tree.ts`). */
  readonly parent: WardicVariantContextValue | undefined
  /** Whether a Retarget may start now (ADR-0007 `when`); omitted, always. */
  readonly canStart: (() => boolean) | undefined
  /** Its stagger delay in seconds, read at each Retarget (ADR-0007); omitted, none. */
  readonly extraDelay: (() => number) | undefined
  /** Told every frame whether it has settled (ADR-0007 orchestration). */
  readonly onFrame: ((done: boolean) => void) | undefined
  /** Whether reduced motion applies (ADR-0029), read at each Retarget. */
  readonly reducedMotion: () => boolean
  /** Which keys reduced motion Snaps (ADR-0036). */
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  readonly start: Start
  readonly snapshot: Snapshot
  readonly reuse: (transition: WardicTransition) => WardicTransition
  readonly links: StartLinks
  /** The user's style now, read untracked: a key's `style` link (ADR-0022). */
  readonly styleNow: (() => object | string | undefined) | undefined
  /** Its routed `style` keys (#130, ADR-0043). */
  readonly live: LiveStyle | undefined
  /** Its presence record, under an `<AnimatePresence>`. */
  readonly presence: PresenceRecord | undefined
  /** Whether a projection node owns its translate keys (ADR-0016). */
  readonly projected: boolean
  /** Its drag axis, `undefined` without a drag (ADR-0004). */
  readonly dragAxis: boolean | "x" | "y" | undefined
  /** Its Appear animation, while hydrating (#48, ADR-0044 decision 6). */
  readonly handoff: Handoff | undefined
  /** Told each Retarget's start and settle (#257); omitted, nothing is told. */
  readonly animation?: AnimationHooks | undefined
}

/** What the follower reads of the element's Override stack and drag, untracked. */
export interface FollowNow {
  readonly resolved: () => Values.Values
  readonly dragging: () => boolean
}

/** A mounted element's spine. */
export interface ElementSpine {
  /** A Retarget toward `resolution`: called by the binding on each change of its target, untracked. */
  readonly retarget: (resolution: Resolution) => void
  /** Follow the element's Live values in `style` (#130), from its first routed key on. */
  readonly follow: (now: FollowNow) => void
  /** The element's teardown: following stops, and the legs end. */
  readonly dispose: () => void
}

/**
 * A mounted element's spine: its Retarget, the returns to its Base values, the follower of its
 * Live values, and its legs' lifetime. Every leg runs in the element's FiberSet (#76) and joins its
 * Retarget's token: a Retarget ends the token before it starts its own legs, and {@link
 * ElementSpine.dispose} ends it and closes its Scope. Both end the legs in the calling task: each
 * leg's run leaves the loop at once, and its fiber ends Superseded, inline (ADR-0027, decision 5,
 * *Amendment (#200)*). A leg the token didn't reach is interrupted, by the FiberSet's clear or the
 * Scope's close. The same shape as the projection system's end-of-task holds.
 */
export const makeElementSpine = (options: ElementSpineOptions): ElementSpine => {
  const { animation, canStart, config, element, extraDelay, gate, id, links, live, onFrame, parent, positionalKeys, presence, projected, runtime, snapshot, start, styleNow, tag } = options
  const { initialLink, initialValues, startedLink } = start
  const { linksFor, ownValue, startLinkOf } = links
  let handoff = options.handoff
  // Its Variable values (#55, ADR-0035 *Amendment (#55)*): the Key rule bound to this element,
  // added to each leg it starts, so a `var()` end blends what it resolves to here.
  const elementRules = [Variables.values(element)]
  const recordFrame = recordFrameOf(presence)

  // A routed key a return handed back: written by the follower from now on (#130). Set by
  // `follow`; a return settles a tick after it runs at the earliest.
  let handBack: (key: string) => void = constVoid

  // The keys a Retarget drove, each with its last target value (its shape), and the
  // ones returning to their Base value until that return settles (ADR-0022). Both are
  // the spine's: a Retarget mid-return carries them again, so a return is never
  // frozen half-way, and a key that settled has left them, so a Retarget of the same
  // target (a `when` gate reopening, ADR-0007) leaves it be. The translate keys never
  // return on a projected element (the projection owns them, ADR-0016). On a drag
  // element, the keys the drag moves leave the return while it runs, so they stay where
  // it dropped them (C9) until a layer sets them again.
  const driven = new Map<string, number | string>()
  let returning = new Map<string, BaseValue.BaseSource>()
  const dragMoves: ReadonlyArray<string> = Bool.match(projected, {
    onTrue: (): ReadonlyArray<string> => [],
    onFalse: () => UndefinedOr.match(options.dragAxis, { onUndefined: (): ReadonlyArray<string> => [], onDefined: dragMovesOf }),
  })

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
    const restore = UndefinedOr.map(styleNow, (now) => {
      const style = now()
      return Object.fromEntries(
        Arr.map(handedBack, (key) => [key, Option.match(OwnValues.styleValueOf(style, key), { onNone: () => "", onSome: (value) => String(value) })]),
      ) as Record<string, string>
    })
    gate.release(id, handedBack, restore)
    Arr.forEach(handedBack, (key) => {
      delete snapshot.values[key]
      delete snapshot.velocities[key]
      if (Predicate.isNotUndefined(presence)) delete presence.snapshot.current[key]
    })
  }

  // Cold path: once per Retarget that started a key from its Base value or returned one,
  // run at the head of that Retarget's first leg (no fiber of its own: forking one per
  // element cost 10-20 µs each at a 1000-element mount).
  const baseLog = (started: Record<string, string>, returns: ReadonlyArray<readonly [string, BaseValue.BaseSource]>): Effect.Effect<void> =>
    Effect.logDebug("wardic.base: a key with no value started from, or returned to, its Base value (ADR-0022)").pipe(
      Effect.annotateLogs({ id, started, returned: Object.fromEntries(returns) }),
    )

  const legScope = Scope.makeUnsafe()
  const legFibers = runtime.runSync(FiberSet.make<void, never>().pipe(Scope.provide(legScope)))
  // The running legs' token (#200, ADR-0027 *Amendment (#200)*): a Retarget ends it and starts
  // its own, so its legs are Superseded, not interrupted: off the loop at once, their fibers
  // ended normally, at about a sixth of an interrupt's cost.
  let generation = Supersede.make()
  // The variant name the last started Retarget resolved, for its successor's `definition` (#257).
  let lastVariant: string | undefined

  const retarget = (resolution: Resolution): void => {
    const { resolved, base, dragging: held } = resolution
    Supersede.end(generation)
    generation = Supersede.make()
    // One options object for this Retarget's legs, each joining its token.
    const runOptions = { supersede: generation }
    // A leg its token didn't reach (one not on the loop) is interrupted, as before.
    if (holdsFibers(legFibers)) runtime.runFork(FiberSet.clear(legFibers))

    // `when` start-gate (ADR-0007): when canStart() is false, freeze at the
    // snapshot (the previous legs are already interrupted) and bail; the
    // binding retargets once the gate flips true.
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
    // spring must never fight the direct-set. Once dragging is false the
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
    // The variant the Retarget before this one resolved, set once this one starts (#257).
    let previous: string | undefined
    const legDone = Effect.sync(() => {
      if (--legs !== 0) return
      settleReturns(returns)
      // The Retarget settled with its last leg (#257): told once the gate has flushed its last frame,
      // so the element shows where it landed.
      if (Predicate.isNotUndefined(animation)) gate.afterFlush(() => animation.settled(resolution, previous, c))
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
    // The transition, read at Retarget time so a change applies to the next Retarget. A child
    // with no local transition inherits the parent context's (ADR-0007).
    const c = config()
    const baseTransition = ownOrInherited(c.transition, parent)
    // Fold the per-child stagger delay (ADR-0007) into the effective
    // transition.delay = base.delay + computedDelay. extraDelay() is read
    // at Retarget time so a re-snapshot before this start is reflected.
    const extra = UndefinedOr.match(extraDelay, { onUndefined: () => 0, onDefined: (delay) => delay() })
    const transition = UndefinedOr.map(
      Bool.match(extra !== 0, {
        onTrue: (): WardicTransition | undefined => ({ ...baseTransition, delay: delayOf(baseTransition) + extra }) as WardicTransition,
        onFalse: () => baseTransition,
      }),
      options.reuse,
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
    const reduce = options.reducedMotion()
    let retargetLegs = legsOf(from, t, transition, reduce, positionalKeys, snapshot.velocities, follow)
    // The Handoff (#48, ADR-0044 decision 6): the first Retarget that starts picks the Appear
    // animation up as far in as its CSS has got, read at the legs' first tick.
    if (Predicate.isNotUndefined(handoff)) {
      const taken = handoff
      handoff = undefined
      checkHandoff(runtime, id, taken, { tag, from, to: t, transition: baseTransition, reduced: reduce, layout: isLayoutNode(c) })
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
    // The Retarget started, its legs on their way (#257); with none, it settled at once.
    previous = lastVariant
    lastVariant = resolution.variant
    if (Predicate.isNotUndefined(animation)) {
      animation.started(resolution, previous, c)
      if (retargetLegs.length === 0) animation.settled(resolution, previous, c)
    }
  }

  // --- Live values in `style` (#130, ADR-0043) ------------------------------
  // A routed key (a Live value, or a transform key) is its `style` link, live: while no layer of
  // the Override stack sets it, no return is running to it and no drag moves it, the element
  // follows it, written through the gate on every change. A return hands it back here when it
  // settles (`settleReturns`). The Starting style showed each one's value at render; from mount
  // the gate holds them.
  const follow = (now: FollowNow): void => {
    if (Predicate.isUndefined(live)) return
    const routes = live
    // Built at the first routed key, at mount or later: an element whose `style` routes none builds nothing.
    routes.whenRouted(() => {
      const dragHolds = Bool.and(Bool.not(projected), Predicate.isNotUndefined(options.dragAxis))
      // Whether something other than the follower moves `key` now.
      const owned = (key: string): boolean =>
        Bool.some([
          driven.has(key),
          Object.hasOwn(now.resolved(), key),
          // The drag direct-sets both translate keys while it, and its release, run (ADR-0004).
          Bool.and(dragHolds, Bool.and(now.dragging(), Bool.or(key === "x", key === "y"))),
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
      if (hasKeys(first)) put({ ...Values.pick(snapshot.values, now.resolved()), ...first })
      return {
        change: (key, value) => {
          if (Bool.or(owned(key), Bool.not(isValue(value)))) return
          put({ [key]: value as number | string })
        },
        removed: (key) => {
          if (owned(key)) return
          delete snapshot.values[key]
          delete snapshot.velocities[key]
          if (Predicate.isNotUndefined(presence)) delete presence.snapshot.current[key]
          // Gone from `style`: the element's own value comes back, or the key's CSS value now.
          const restore = Option.match(OwnValues.styleValueOf(UndefinedOr.match(styleNow, { onUndefined: constUndefined, onDefined: (style) => style() }), key), {
            onNone: () => "",
            onSome: String,
          })
          gate.release(id, [key], { [key]: restore })
        },
      }
    })
  }

  const dispose = (): void => {
    if (Predicate.isNotUndefined(live)) live.stop()
    // The legs end normally first, so closing the Scope has nothing left to interrupt.
    Supersede.end(generation)
    runtime.runFork(Scope.close(legScope, Exit.void))
  }

  return { retarget, follow, dispose }
}

/**
 * `sink` with an `onCommit` that calls the config's current `onUpdate` (#233), when the config had
 * one at mount; `sink` as it is otherwise. `config` reads it untracked.
 */
export const withOnUpdate = (sink: FlushGate.Sink, atMount: WardConfig["onUpdate"], config: () => WardConfig): FlushGate.Sink => {
  // Per element at mount: most have none, and pay a check.
  if (Predicate.isUndefined(atMount)) return sink
  return {
    ...sink,
    onCommit: (latest) => {
      const onUpdate = config().onUpdate
      if (Predicate.isNotUndefined(onUpdate)) onUpdate(latest as Readonly<Record<string, number | string>>)
    },
  }
}

/**
 * `sink`, removing the element's Appear animation in its first commit (#48, ADR-0044 decision 6):
 * in the task that writes the engine's first frame, so no paint falls between. Without one, `sink`.
 */
export const releasingAppear = (sink: FlushGate.Sink, handoff: Handoff | undefined, element: HTMLElement): FlushGate.Sink => {
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
 * Where `key` rests outside the gate (#130): its `initial`, else its `style` value (a Live value's
 * now), else a transform key's identity, else `undefined`.
 */
export const restingOf = (key: string, initial: Values.Values, style: object | string | undefined, read: (value: unknown) => unknown): unknown =>
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

/** An element's Appear animation on a server (#48, ADR-0044), as both bindings' server wards and component wraps use it. */
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
const NO_APPEAR_ENTRY = (provided: WardicVariantContextValue | undefined): ServerAppearOf => ({
  style: undefined,
  provided,
  veto: constVoid,
  late: false,
  chunkRoot: false,
  state: undefined,
})

/**
 * An element's entry in the server render's Appear animations (#48, ADR-0044): its starting
 * values, its targets at mount (`animate`, or an inherited variant name against its `variants`),
 * its transition, and its place in its parent's group. `state` is the provider's, `undefined` with
 * `appear={false}`: each binding reads it from its own context.
 */
export const appearEntryOf = (
  state: ServerAppear | undefined,
  c: WardConfig,
  tag: string | undefined,
  initialValues: Values.Values,
  node: ServerVariantNode,
): ServerAppearOf =>
  UndefinedOr.match(state, {
    onUndefined: () => NO_APPEAR_ENTRY(node.provided),
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
export const serverTargetOf = (c: WardConfig, inherited: WardicVariantContextValue | undefined): Option.Option<Values.Values> =>
  UndefinedOr.match(c.animate, {
    onDefined: (own) => Option.some(resolveValues(own, c.variants)),
    onUndefined: () =>
      Option.map(
        Option.flatMap(Option.fromUndefinedOr(inherited), (context) => Option.fromUndefinedOr(context.variant())),
        (name) => resolveValues(name, c.variants),
      ),
  })

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
  untrack: Reactivity["untrack"],
): Renderer.Patch =>
  Bool.match(Rec.isEmptyRecord(routed), {
    onTrue: () => starting,
    onFalse: () => Style.starting(tag, drawnAtRest({ ...valuesOf(routed, serverRegistryOf, untrack), ...initialValues }, layout)).style,
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

/** What a `<Reorder>` item adds to an element's drag: its gesture's axis, read at each drag's start. */
interface DragInternals {
  readonly dragAxis?: (() => boolean | "x" | "y") | undefined
}

/** A plain element's drag internals: none. */
const NO_DRAG_INTERNALS: DragInternals = {}

/**
 * The drag axis a spine runs with: its static `drag` config, else `true` for a
 * `<Reorder>` item (its gesture's axis comes from `dragAxis`), else none.
 */
export const dragAxisOf = (config: WardConfig, internal: DragInternals = NO_DRAG_INTERNALS): boolean | "x" | "y" | undefined =>
  Option.getOrUndefined(
    Option.orElse(Option.filter(Option.fromUndefinedOr(config.drag), (drag) => drag !== false), () =>
      Option.map(Option.fromUndefinedOr(internal.dragAxis), (): true => true)),
  )

/**
 * Set each of a drag element's defaults its inline style doesn't already set, and
 * `draggable="false"` unless it has the attribute (the commit-sink paths, at mount).
 */
export const applyDragDefaults = (element: HTMLElement, defaults: Style.DragDefaults): void => {
  Arr.forEach(Rec.keys(defaults), (key) => {
    if (element.style.getPropertyValue(key) === "") element.style.setProperty(key, UndefinedOr.getOrThrow(defaults[key]))
  })
  if (!element.hasAttribute("draggable")) element.setAttribute("draggable", Style.DRAG_DEFAULT_ATTRIBUTES.draggable)
}
