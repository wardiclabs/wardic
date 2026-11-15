/**
 * What each binding's element setup does around the spine (#672): the Base-value links an element
 * starts from, its Transform template drawn, its Appear animation released at its first commit, and a
 * server's starting values. Solid 1's and Solid 2's elements both run them; they read the DOM, so the
 * spine doesn't.
 *
 * @module
 */
// #672 (PR2-Q3): out of `spine.ts`, which never called them, on their way to
// `@wardic/dom/unstable/ElementSetup` once what they read has left solid (`appear.ts`, `live-style.ts`,
// the spine's `Snapshot`).
import * as BaseValue from "@wardic/core/BaseValue"
import * as Projection from "@wardic/core/Projection"
import type * as Renderer from "@wardic/core/Renderer"
import type * as Values from "@wardic/core/Values"
import type * as WardicServices from "@wardic/core/unstable/WardicServices"
import type * as Reactivity from "@wardic/core/unstable/Reactivity"
import * as Appear from "@wardic/dom/Appear"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as OwnValues from "@wardic/dom/OwnValues"
import * as Style from "@wardic/dom/Style"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import { type DomHandoff, type Handoff, keyOf, type MountAnimation, repeatsForever } from "./appear.ts"
import type { WardConfig } from "./config.ts"
import { type LiveStyle, serverRegistryOf, valuesOf } from "./live-style.ts"
import { baseLog, type Snapshot, type SpineDiagnostics, type StartLinks } from "./spine.ts"

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
