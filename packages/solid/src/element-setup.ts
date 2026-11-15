/**
 * What each binding's element setup does around the spine (#672): the Base-value links an element
 * starts from, its Transform template drawn, its Appear animation released at its first commit, a
 * server's starting values and its Appear entry, a drag's will-change and its claim, and the logs of a
 * dropped `transform` string and of a hydration's Starting style. Solid 1's and Solid 2's elements both
 * run them; they read the DOM, so the spine doesn't.
 *
 * @module
 */
// #672 (PR2-Q3): out of `spine.ts`, which never called them, on their way to
// `@wardic/dom/unstable/ElementSetup` once what they read has left solid (`appear.ts`, `live-style.ts`,
// the spine's `Snapshot`).
import * as BaseValue from "@wardic/core/BaseValue"
import * as Projection from "@wardic/core/Projection"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Renderer from "@wardic/core/Renderer"
import type * as Values from "@wardic/core/Values"
import type * as MeasuredPairs from "@wardic/core/unstable/MeasuredPairs"
import type * as CoreOwnValues from "@wardic/core/unstable/OwnValues"
import type * as VariableValues from "@wardic/core/unstable/VariableValues"
import type * as WardicServices from "@wardic/core/unstable/WardicServices"
import type * as Reactivity from "@wardic/core/unstable/Reactivity"
import * as Appear from "@wardic/dom/Appear"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as OwnValues from "@wardic/dom/OwnValues"
import * as Style from "@wardic/dom/Style"
import * as DomValues from "@wardic/dom/unstable/DomValues"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { constUndefined, constVoid } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import { type AppearGroup, type DomHandoff, enterServer, keyOf, type ServerAppear } from "./appear.ts"
import { type Handoff, type MountAnimation, repeatsForever } from "./appear-handoff.ts"
import type { SpineConfig, WardConfig } from "./config.ts"
import { type LiveStyle, serverRegistryOf, valuesOf } from "./live-style.ts"
import type { ValueReads } from "./runtime.ts"
import { baseLog, isLayoutNode, type Snapshot, type SpineDiagnostics, type StartLinks, tellDrag } from "./spine.ts"
import { hasOwnVariants, ownOrInherited, type ServerVariantNode, type WardicVariantContextValue } from "./variant-tree.ts"
import { type Entry, NO_VARIANT_STATE, resolveTarget, type Target, transitionOfTarget } from "./variant-target.ts"

/**
 * A mounted element's Base-value links (ADR-0022): a key with no value starts from its `style`
 * value, else its Own value. The Own value is read from the element once per key, at first need
 * (D3): after mount, so never on a server (ADR-0021). Each link is coerced to the shape of the
 * key's target (`like`). `styleNow` reads the user's style untracked; a Live value in it is read now.
 */
export const startLinksOf = (element: HTMLElement, styleNow: (() => object | string | undefined) | undefined, live: LiveStyle | undefined): StartLinks => {
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
  untrack: Reactivity.Reactivity["untrack"],
  template: WardConfig["transformTemplate"],
): Renderer.Patch =>
  Bool.match(Rec.isEmptyRecord(routed), {
    onTrue: () => starting,
    onFalse: () => Style.starting(tag, drawnAtRest({ ...valuesOf(routed, serverRegistryOf, untrack), ...initialValues }, layout, template)).style,
  })

/**
 * The values a layout node's Starting style is drawn from (#245, ADR-0044 *Amendment (#245)*):
 * through its projection at rest, as its first commit draws it, its own translate on top (#363).
 * Any other element's, as they are. A templated element's, with its Transform template (#443).
 */
export const drawnAtRest = (values: Values.Values, layout: boolean, template: WardConfig["transformTemplate"]): Readonly<Record<string, unknown>> => {
  // Per mount (#460): guards, nothing built for an element neither a layout node nor templated.
  if (Bool.not(layout)) return withTemplate(values, template)
  return withTemplate({ ...values, [Projection.KEY]: Projection.AT_REST }, template)
}

/** `values` with `template` under the renderer's reserved key, as its projection rides (#443); as they are with none. */
export const withTemplate = <V extends Readonly<Record<string, unknown>>>(values: V, template: WardConfig["transformTemplate"]): V => {
  if (Predicate.isUndefined(template)) return values
  return { ...values, [DomRenderer.TEMPLATE_KEY]: template }
}

/**
 * What an element registers with in the gate (#443): its Transform template at mount, under the
 * renderer's reserved key, drawn with its first write (a write of its own would take its Starting
 * style off early). Nothing with none.
 */
export const registeredValuesOf = (template: WardConfig["transformTemplate"]): Readonly<Record<string, unknown>> | undefined => {
  if (Predicate.isUndefined(template)) return undefined
  return { [DomRenderer.TEMPLATE_KEY]: template }
}

/**
 * What an element's projection node is held at for a Measure pass (#443, Motion's
 * `transformTemplate(values, "")`): its Transform template's, from its values now, when it had one
 * at mount. `undefined` otherwise, so a node without one pays a field read a pass.
 */
export const heldTransformFor = (
  snapshot: Snapshot,
  atMount: WardConfig["transformTemplate"],
  template: () => WardConfig["transformTemplate"],
): (() => string) | undefined => {
  if (Predicate.isUndefined(atMount)) return undefined
  return () => DomRenderer.heldTransformOf(withTemplate(snapshot.values, template()))
}

/**
 * Follow an element's Transform template after mount (#443): `write` is called with each other one
 * its config gives, and draws it at the next frame. Only for an element with one at mount, as
 * `onUpdate` (#233): its caller asks only then, so another makes nothing (#460). Returns the stop.
 */
export const followTemplate = (
  atMount: DomRenderer.TransformTemplate,
  template: () => WardConfig["transformTemplate"],
  watch: Reactivity.Reactivity["watch"],
  write: (template: WardConfig["transformTemplate"]) => void,
): (() => void) => {
  let last: WardConfig["transformTemplate"] = atMount
  return watch(template, (next) => {
    if (next === last) return
    last = next
    write(next)
  })
}

/**
 * A Handoff whose Appear animation the server sampled from another mount animation than the
 * client's: the app rendered differently on the server, or a function it gave has no easing name.
 * Noted once (cold path, `wardic.hydration`); the client's own animation goes on from the same time.
 */
const checkHandoff = (runtime: WardicServices.Runner<WardicServices.WardicServices>, id: string, handoff: Handoff, mount: MountAnimation): void => {
  // A templated element's rule is named by its stops (#443), which the client doesn't sample to check.
  if (Predicate.isNotUndefined(mount.template)) return
  const same = Option.exists(keyOf(mount), (key) =>
    Appear.matches((handoff as DomHandoff).animation, { key, tag: mount.tag, infinite: repeatsForever(mount.transition), projected: mount.layout }))
  if (same) return
  runtime.runFork(
    Effect.logDebug("wardic.hydration: the server's Appear animation was sampled from another mount animation than this element's; it goes on from the same time").pipe(
      Effect.annotateLogs({ id }),
    ),
  )
}

/**
 * Development's diagnostics (#746): what a binding gives the spine under its Solid's `DEV`. Referenced
 * nowhere else, so a production build, whose binding never gives it, drops it and what it calls.
 */
// #672: here, where the DOM's Handoff is, so the spine reads no Animation; given under `DEV` alone.
export const SPINE_DIAGNOSTICS: SpineDiagnostics = { checkHandoff, baseLog }

// The DOM's ports, where an element's Environment gives none (#672, PR2-Q4): `DomLive` doesn't, so
// only an app that animates an element ships them, through these.

/** An element's reads of its values: its Environment's, else the DOM's. */
export interface ElementValueReads {
  readonly ownValues: CoreOwnValues.Shape
  readonly measuredPairs: MeasuredPairs.Shape
  readonly variableValues: VariableValues.Shape
}

/** The DOM's, for an Environment that gives none: `DomLive`'s. */
const DOM_VALUE_READS: ElementValueReads = { ownValues: DomValues.ownValues, measuredPairs: DomValues.measuredPairs, variableValues: DomValues.variableValues }

/** `given`, else the DOM's `dom`. */
const orDom = <A>(given: A | undefined, dom: A): A => {
  if (Predicate.isUndefined(given)) return dom
  return given
}

/** Each other Environment's reads, the DOM's in its gaps, made at its first element. */
// Module state (#460, Q7): one record per provider's reads, held weakly by them.
const filled = new WeakMap<ValueReads, ElementValueReads>()

/**
 * An element's reads of its values (PR2-Q6): its Environment's, the DOM's where it gives none. One
 * record a provider, made at its first element: an element reads it with one context read, and makes
 * nothing.
 */
export const valueReadsOf = (given: ValueReads): ElementValueReads => {
  // Per element at mount (#540): statements. `DomLive` gives none: the DOM's, with no lookup.
  if (Bool.and(Predicate.isUndefined(given.ownValues), Bool.and(Predicate.isUndefined(given.measuredPairs), Predicate.isUndefined(given.variableValues)))) return DOM_VALUE_READS
  const kept = filled.get(given)
  if (Predicate.isNotUndefined(kept)) return kept
  const reads: ElementValueReads = {
    ownValues: orDom(given.ownValues, DomValues.ownValues),
    measuredPairs: orDom(given.measuredPairs, DomValues.measuredPairs),
    variableValues: orDom(given.variableValues, DomValues.variableValues),
  }
  filled.set(given, reads)
  return reads
}

/**
 * A binding's `setDragging`, turning the element's will-change value on as a drag starts (#443,
 * Motion's): `"transform"`, as its drag draws `x` and `y`. Its spine hears each start and end too, for
 * a Batch member's `x` and `y` (#665's PR 4).
 */
export const draggingWithWillChange = (live: LiveStyle | undefined, setDragging: (on: boolean) => void, element: Element): ((on: boolean) => void) => {
  const set = UndefinedOr.match(live, {
    onUndefined: () => setDragging,
    onDefined: (style) => (on: boolean) => {
      if (on) UndefinedOr.map(style.willChange(), (turnOn) => turnOn())
      setDragging(on)
    },
  })
  return (on) => {
    set(on)
    tellDrag(element, on)
  }
}

/**
 * A drag track's `claim` for `element` (#665's PR 4): told before the drag reads where the element
 * rests or writes `x`/`y`, so a Batch member's element takes its transform from its Batch first.
 */
export const claimForDrag = (element: Element): (() => void) => () => tellDrag(element, true)

/** Log, once per element, that a `transform` string gave way to the transform keys in its `style` (#130). */
export const warnDroppedTransform = (runtime: WardicServices.Runner<WardicServices.WardicServices>, id: string): void => {
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
export const flagStartingStyle = (runtime: WardicServices.Runner<WardicServices.WardicServices>, id: string, server: Renderer.Patch, client: Renderer.Patch): void => {
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
 * its transition, its place in its parent's group, and its nearest `WardicConfig`'s reduced motion
 * (#434). `state` is the provider's, `undefined` with `appear={false}`: each binding reads it from its
 * own context.
 */
export const appearEntryOf = (
  state: ServerAppear | undefined,
  c: SpineConfig,
  tag: string | undefined,
  initialValues: Values.Values,
  node: ServerVariantNode,
  quiet: boolean,
  reducedMotion: ReducedMotion.Config | undefined,
  skipAnimations = false,
): ServerAppearOf =>
  UndefinedOr.match(state, {
    onUndefined: () => NO_APPEAR_ENTRY(node.provided),
    onDefined: (state) => {
      // The target's own transition (#277) drives its mount animation, and its orchestration.
      const target = serverTargetOf(c, node.inherited)
      const own = Option.getOrUndefined(Option.flatMap(target, (t) => Option.fromUndefinedOr(t.transition)))
      const entered = enterServer(state, {
        appear: c.appear,
        tag,
        initial: initialValues,
        to: Option.map(target, (t) => t.values),
        keyframes: Option.getOrUndefined(Option.flatMap(target, (t) => Option.fromUndefinedOr(t.keyframes))),
        quiet,
        transition: transitionOfTarget(own, ownOrInherited(c.transition, node.inherited)),
        layout: isLayoutNode(c),
        template: c.transformTemplate,
        group: Option.flatMap(Option.fromUndefinedOr(node.inherited), (inherited) => Option.fromUndefinedOr(appearGroupOf(inherited))),
        leads: hasOwnVariants(c),
        ownTransition: transitionOfTarget(own, c.transition),
        reducedMotion,
        skipAnimations,
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

/**
 * The Appear group a Variant child joins, its parent's: the variant context carries it opaque, and
 * only {@link appearEntryOf} writes it, so it's always one.
 */
// #672 (PR4-Q4): the one read of the variant context's `appearGroup` as the sampler's type.
const appearGroupOf = (context: WardicVariantContextValue): AppearGroup | undefined => context.appearGroup as AppearGroup | undefined

/**
 * An element's target at mount on a server: its `animate`, else an inherited variant name resolved
 * against its own `variants`, a dynamic one with its `custom` and no values yet (#277).
 */
export const serverTargetOf = (c: SpineConfig, inherited: WardicVariantContextValue | undefined): Option.Option<Target> =>
  UndefinedOr.match(c.animate as Entry, {
    onDefined: (own) => Option.some(resolveTarget(own, c.variants, c.custom, NO_VARIANT_STATE)),
    onUndefined: () =>
      Option.map(
        Option.flatMap(Option.fromUndefinedOr(inherited), (context) => Option.fromUndefinedOr(context.variant())),
        (name) => resolveTarget(name, c.variants, c.custom, NO_VARIANT_STATE),
      ),
  })
