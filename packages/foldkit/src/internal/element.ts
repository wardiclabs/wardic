/**
 * A mounted `w.*` element (ADR-0071): its spine on the shared one (core's `unstable/Spine`), registered
 * with its Provider's gate at insert, inside the patch (P2); its Starting style, rendered by the view,
 * switched to the user's style in its first commit, as a Solid element's is (ADR-0034); and its
 * **Delivery** (decision 20): each later render's config reaches it through its `wardic` property's
 * setter, where it Retargets when the targets resolve differently from the last ones (#470).
 *
 * @module
 */
import * as Spine from "@wardic/core/unstable/Spine"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as Report from "@wardic/dom/Report"
import * as Style from "@wardic/dom/Style"
import * as ElementSetup from "@wardic/dom/unstable/ElementSetup"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Ward from "../Ward.ts"
import { deliveredTo, installSetter, patchTouched } from "./delivery.ts"
import { reactivity } from "./reactivity.ts"
import type { Provider } from "./services.ts"
import { DEV } from "@wardic/foldkit/internal/dev"

/** An element's config as the spine reads it: what the view delivered, with its merged `style`. */
export type Config = Ward.Config & WardConfig.SpineConfig

/** No config: an element the view gave nothing, which rests where it is. */
const NO_CONFIG: Config = {}

/** The config delivered to an element, or none. */
export const configOf = (delivered: unknown): Config => {
  if (Predicate.isUndefined(delivered)) return NO_CONFIG
  return delivered as Config
}

/** What a Retarget throwing inside the patch is reported as: contained at the binding's edge (decision 13), the element left where it is. */
const RETARGET_FAILED = "wardic.retarget: a w.* element's Retarget failed; it stays where it is"

/** No gesture is on (slice 3 brings them): every entry of the Override stack but the base off. */
const NO_ACTIVE: Spine.Active = { inView: false, focused: false, hovered: false, pressed: false, dragged: false, dragging: false }

// Module state (#460, Q7): an id counter, only ever compared for distinctness.
let ids = 0

/**
 * Development's diagnostics for the spine (#746, ADR-0067 *Amendment (#746)*, decision 6): given under
 * `DEV` alone, so a production build ships none of their code.
 */
const devDiagnostics = (): Spine.SpineDiagnostics | undefined => {
  if (DEV) return ElementSetup.SPINE_DIAGNOSTICS
  return undefined
}

/**
 * The element's Starting style, rendered by the view: the user's `style` with its `initial` on top,
 * projected together, so a transform key of each joins one `transform` (#791, Q7). What `w.*` and the
 * bundle render in their one `h.Style`, stringified for Foldkit's style module.
 */
export const startingStyleOf = (tag: string | undefined, config: Config): Style.Style =>
  Style.starting(tag, { ...styleRecordOf(config.style), ...initialValuesOf(config) }).style

/** The user's `style` as a record: what `w.Style` and `h.Style` gave, merged by the builder. */
const styleRecordOf = (style: Config["style"]): Readonly<Record<string, unknown>> => {
  if (Predicate.isUndefined(style)) return {}
  if (Predicate.isString(style)) return {}
  return style as Readonly<Record<string, unknown>>
}

/** The values an element starts at: its `initial`'s (or its `animate`'s, with `initial: false`). */
const initialValuesOf = (config: Config) => Spine.startOf(config, undefined, false, reactivity.untrack).initialValues

/** `patch`'s values as Foldkit's style module takes them: strings. */
export const stringified = (patch: Style.Style): Record<string, string> => Rec.map(patch, (value) => String(value))

/**
 * Switch the element from its Starting style to the user's, in its first commit (ADR-0034): each key the
 * Starting style set is put back to the user's projected value, or removed, so the gate reads that as
 * the key's own value and restores it when it lets the key go. Foldkit's style module rewrites a key
 * only when the view changes it, so the switch holds until the view does.
 */
const switchToUserStyle = (element: HTMLElement, tag: string, starting: ReadonlyArray<string>, config: Config): void => {
  const user = Style.starting(tag, styleRecordOf(config.style)).style
  Arr.forEach(starting, (key) => {
    UndefinedOr.match(user[key], {
      onUndefined: () => element.style.removeProperty(key),
      onDefined: (value) => element.style.setProperty(key, String(value)),
    })
  })
}

/**
 * Mount a `w.*` element on `provider`: its spine, its gate registration and its Delivery's setter. `paused`
 * says whether DevTools replay has the view (decision 34): every animation lands at once under it.
 * Returns the release: the element's teardown, run at its Mount's destroy, before Foldkit removes it.
 */
export const mountElement = (provider: Provider, element: HTMLElement, paused: () => boolean): (() => void) => {
  const tag = element.localName
  let config = configOf(deliveredTo(element))
  const configNow = (): Config => config
  // Where it starts (ADR-0003), read once: the config the view rendered it with.
  const start = Spine.startOf(config, undefined, false, reactivity.untrack)
  const snapshot = Spine.snapshotOf(start)
  const id = `wardic-foldkit-${ids++}`
  // The keys its Starting style set, switched to the user's in its first commit.
  const startingKeys = Rec.keys(Style.starting(tag, ElementSetup.drawnAtRest(start.initialValues, false, undefined)).style)
  const sink: FlushGate.Sink = { target: element, beforeFirstCommit: () => switchToUserStyle(element, tag, startingKeys, config) }
  const unregister = provider.gate.register(id, sink)
  // The user's style now, for its Base values (ADR-0022): the config's, as the view last delivered it.
  const styleNow = (): object | string | undefined => config.style
  const links = ElementSetup.startLinksOf(element, styleNow, undefined)
  const spine = Spine.makeElementSpine({
    runtime: provider.runtime,
    gate: provider.gate,
    id,
    element,
    tag,
    config: configNow,
    parent: undefined,
    canStart: undefined,
    extraDelay: undefined,
    onFrame: undefined,
    reducedMotion: provider.reducedMotion,
    skipAnimations: paused,
    positionalKeys: provider.positionalKeys,
    defaultTransition: provider.defaultTransition,
    ownValues: provider.valueReads.ownValues,
    measuredPairs: provider.valueReads.measuredPairs,
    variableValues: provider.valueReads.variableValues,
    start,
    snapshot,
    reuse: Spine.makeReuse(),
    links,
    styleNow,
    live: undefined,
    builtFeatures: provider.registry.built,
    presence: undefined,
    projected: false,
    dragAxis: undefined,
    handoff: undefined,
    diagnostics: devDiagnostics(),
  })
  // The Override stack resolved (ADR-0007), compared by value (#470): a delivery that resolves the same
  // targets tells nothing, as a `transition` change alone doesn't in Motion.
  let last: Spine.Resolution | undefined
  const retarget = (): void => {
    const next = Spine.resolutionOf(config, undefined, start.initialLink, NO_ACTIVE, snapshot, undefined)
    if (Predicate.isNotUndefined(last) && Spine.sameResolution(last, next)) return
    last = next
    spine.retarget(next)
  }
  // Its Delivery (decision 20): each render's fresh config, inside the patch, Retargets at once (#791, Q14).
  // A defect there is Foldkit's patch's otherwise, which would stop the whole app (decision 13): reported,
  // and the element stays where it is.
  const uninstall = installSetter(element, (delivered) => {
    config = configOf(delivered)
    try {
      retarget()
    } catch (error) {
      provider.runtime.runFork(Report.failure(RETARGET_FAILED, Cause.die(error)))
    }
    patchTouched()
  })
  // Its first Retarget, at mount: from `initial` to `animate`.
  retarget()
  return () => {
    uninstall()
    spine.dispose()
    unregister()
  }
}
