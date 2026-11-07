/**
 * **Features** (#511, ADR-0067): the parts of the binding an element pays for only when it needs them,
 * for the Solid 1 binding and the Solid 2 one alike. Solid-free: each binding's `WardicProvider`,
 * `LazyWardic` and elements read them through it.
 *
 * Each Feature is an Effect `Layer` (ADR-0067, *Features are Layers*): its services, built once per
 * provider into the provider's runtime's `MemoMap` (`Layer.buildWithMemoMap`), so a Layer two Features
 * share is built once, and ended with the provider. A Feature that arrives late, loaded lazily, is built
 * the same way when it arrives: the runtime, made once, needn't change. A section of the tree (its
 * `WardicProvider`, each `LazyWardic`) holds the services of the Features it has, a `Context`, joined
 * with its parent's; an element looks a Feature up there.
 *
 * @module
 */
import * as Color from "@wardic/dom/Color"
import * as Report from "@wardic/dom/Report"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { constFalse, constVoid, identity } from "effect/Function"
import * as Layer from "effect/Layer"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import * as OwnerScope from "./owner-scope.ts"
import type { Reactivity } from "./reactivity.ts"
import type { ProviderRuntime, ProviderServices, WardicServices } from "./runtime.ts"

/**
 * A **Feature**: its name, the key of the service its Layer gives (what an element looks up),
 * and that Layer, built on the provider's runtime: its Environment, its flush gate and its projection
 * options. `server` is what a server render, which builds no runtime, does with it: the
 * `colors` Feature registers its colour spaces there too, as the render reads colours; the rest do
 * nothing.
 */
export interface Feature<I = any, S = any> {
  readonly name: string
  readonly key: Context.Key<I, S>
  readonly layer: Layer.Layer<I, never, ProviderServices>
  readonly server?: (() => void) | undefined
}

/** Features as an app gives them: one, or a list, a preset's nested in it (`[domAnimation, layout]`). */
export type Features = Feature | ReadonlyArray<Features>

/** Features loaded lazily: `() => import("./features.ts").then((m) => m.domMax)`. */
export type FeatureLoad = () => Promise<Features>

/** Features given to a `WardicProvider` or a `LazyWardic`: at once, or loaded lazily. */
export type FeaturesProp = Features | FeatureLoad

/**
 * `key`'s Layer for a Feature: the Environment's service when it gives one (`@wardic/test`'s `TestLive`),
 * else `layer`, the DOM's, which a provider's `MemoMap` builds once for every Feature standing on it.
 */
// ADR-0067 decision 14 (the gestures' input) and *Amendment (#518)*, decision 5 (the scroll). A Feature
// module's call to it is marked pure, so an app that never imports the module drops `layer`.
export const fromEnvironmentOr = <I, S, R>(key: Context.Key<I, S>, layer: Layer.Layer<I, never, R>): Layer.Layer<I, never, R> =>
  Layer.unwrap(
    Effect.map(
      Effect.serviceOption(key),
      Option.match({
        onSome: (given): Layer.Layer<I, never, R> => Layer.succeed(key)(given),
        onNone: (): Layer.Layer<I, never, R> => layer,
      }),
    ),
  )

/** Features as one flat list, each once, in order. */
export const flatten = (features: Features): ReadonlyArray<Feature> => Arr.dedupeWith(flattenInto(features), (a, b) => a === b)

const flattenInto = (features: Features): ReadonlyArray<Feature> => {
  if (isFeature(features)) return [features]
  return Arr.flatMap(features as ReadonlyArray<Features>, flattenInto)
}

const isFeature = (value: Features): value is Feature => Predicate.hasProperty(value, "layer")

/** Whether a `features` prop loads lazily: a function, where Features are values. */
export const isLoad = (prop: FeaturesProp): prop is FeatureLoad => Predicate.isFunction(prop)

/** No Features. */
export const NONE: Context.Context<never> = Context.empty()

/**
 * A section of the tree's Features (#511): a `WardicProvider`'s, a `LazyWardic`'s, or an element's,
 * each its own joined with its parent's. Each binding makes its sections with its own signals.
 */
export interface FeatureSection {
  /** The services of the Features it has now. Tracked: a lazy one arriving changes it. */
  readonly services: () => Context.Context<never>
  /** Whether a lazy load of its own or a parent's is still on its way: no missing-Feature warning while one is. */
  readonly pending: () => boolean
  /** Whether it, or a section above it, is `strict`: a Complete element under it is an error in development. */
  readonly strict: boolean
}

/** Outside every provider, and above each provider's own: no Features, nothing on its way, not strict. */
export const ROOT: FeatureSection = { services: () => NONE, pending: constFalse, strict: false }

/** What a section takes from its binding: its reactivity, whether it renders on a server, and its owner's cleanup. */
export interface SectionHost {
  readonly reactivity: Reactivity
  readonly server: boolean
  readonly onCleanup: (fn: () => void) => void
}

/**
 * A section under `parent` with `prop`'s Features (#511):
 * - **Given at once**, they're built on first need, the first time an element in it asks (#51: a
 *   provider with no element under it builds nothing); a server render runs their `server` part at
 *   once, as its elements may read what it registers.
 * - **Loaded lazily** (decision 8), the load starts now on the client and they're built as they
 *   arrive, from then on; `pending` until it settles. A failed load is `report`ed, once. A server
 *   render loads nothing: it renders as it would without them.
 *
 * Its services join its own and its parent's, joined again only when either changes.
 */
export const makeSection = (
  parent: FeatureSection,
  registry: FeatureRegistry,
  prop: FeaturesProp | undefined,
  strict: boolean,
  report: (cause: Cause.Cause<unknown>) => void,
  host: SectionHost,
): FeatureSection => {
  const own = ownOf(registry, prop, report, host)
  let last: { readonly parent: Context.Context<never>; readonly own: Context.Context<never>; readonly joined: Context.Context<never> } | undefined
  const services = (): Context.Context<never> => {
    const above = parent.services()
    const mine = own.services()
    if (Predicate.isNotUndefined(last) && last.parent === above && last.own === mine) return last.joined
    const joined = Context.merge(above, mine)
    last = { parent: above, own: mine, joined }
    return joined
  }
  return { services, pending: () => own.pending() || parent.pending(), strict: strict || parent.strict }
}

/** A section's own Features: their services and whether they're on their way. */
interface Own {
  readonly services: () => Context.Context<never>
  readonly pending: () => boolean
}

const NO_OWN: Own = { services: () => NONE, pending: constFalse }

const ownOf = (registry: FeatureRegistry, prop: FeaturesProp | undefined, report: (cause: Cause.Cause<unknown>) => void, host: SectionHost): Own => {
  if (Predicate.isUndefined(prop)) return NO_OWN
  if (isLoad(prop)) return loaded(registry, prop, report, host)
  const features = flatten(prop)
  if (host.server) registry.build(features)
  let built: Context.Context<never> | undefined
  return {
    services: () =>
      UndefinedOr.match(built, {
        onDefined: identity,
        onUndefined: () => {
          built = registry.build(features)
          return built
        },
      }),
    pending: constFalse,
  }
}

/** Features loaded lazily: none until they arrive, which a trigger tells; on the client only. */
const loaded = (registry: FeatureRegistry, load: FeatureLoad, report: (cause: Cause.Cause<unknown>) => void, host: SectionHost): Own => {
  if (host.server) return NO_OWN
  const changed = host.reactivity.trigger()
  let services = NONE
  let pending = true
  let live = true
  host.onCleanup(() => {
    live = false
  })
  load().then(
    (features) => {
      if (!live) return
      services = registry.build(flatten(features))
      pending = false
      changed.notify()
    },
    (error: unknown) => {
      if (!live) return
      pending = false
      changed.notify()
      report(Cause.die(error))
    },
  )
  return {
    services: () => {
      changed.track()
      return services
    },
    pending: () => {
      changed.track()
      return pending
    },
  }
}

/**
 * A provider's Features: each built once, on first need, and every list it's asked for joined once.
 * `build` is synchronous; a Feature's Layer that can't build at once is a defect.
 */
export interface FeatureRegistry {
  /** The services of `features`, each Feature built the first time it's asked for. */
  readonly build: (features: ReadonlyArray<Feature>) => Context.Context<never>
  /** A section of exactly `features`, nothing on its way: one per list, a Complete element's (#511). */
  readonly section: (features: ReadonlyArray<Feature>) => FeatureSection
  /**
   * The services of every Feature built so far, whichever section asked: what a part of the provider
   * that brings no Feature works with when one is there (the projection system, for a presence).
   */
  readonly built: () => Context.Context<never>
  /** Logs `message` at Warning the first time `feature` is named: development's word on a missing Feature. */
  readonly warnOnce: (feature: string, message: string) => void
  /** Ends every Feature built, the provider's runtime after (a Feature's Layer may stand on it). */
  readonly dispose: () => Promise<void>
}

/** A registry's sections of exactly a list, one per list, and its warnings, one per Feature. */
const sectionsAndWarnings = (build: (features: ReadonlyArray<Feature>) => Context.Context<never>, warn: (message: string) => void) => {
  const sections = new WeakMap<ReadonlyArray<Feature>, FeatureSection>()
  const warned = new Set<string>()
  return {
    section: (features: ReadonlyArray<Feature>): FeatureSection =>
      UndefinedOr.match(sections.get(features), {
        onDefined: identity,
        onUndefined: () => {
          const services = build(features)
          const section: FeatureSection = { services: () => services, pending: constFalse, strict: false }
          sections.set(features, section)
          return section
        },
      }),
    warnOnce: (feature: string, message: string): void => {
      if (warned.has(feature)) return
      warned.add(feature)
      warn(message)
    },
  }
}

/**
 * A client provider's Features (#511): built into `runtime`'s `MemoMap` in a Scope of their own, a child
 * of the runtime's that closes before its Layers do, so a Feature ends before the Environment it stands
 * on. A list asked for again (the Complete element's every Feature) is joined once.
 */
// #618 (decision 4): the Scope was detached, closed by `dispose` before the runtime's, and a failing
// Feature finalizer skipped the runtime's disposal. A child forked after `ManagedRuntime.make`'s own
// closes first in its Scope's reverse order.
export const clientRegistry = (runtime: ProviderRuntime): FeatureRegistry => {
  const scope = OwnerScope.open(runtime)
  const built = new Map<Feature, Context.Context<never>>()
  const lists = new WeakMap<ReadonlyArray<Feature>, Context.Context<never>>()
  let all = NONE
  const one = (feature: Feature): Context.Context<never> =>
    UndefinedOr.match(built.get(feature), {
      onDefined: (services) => services,
      onUndefined: () => {
        const services = runtime.runSync(Layer.buildWithMemoMap(feature.layer, runtime.memoMap, scope)) as Context.Context<never>
        built.set(feature, services)
        all = Context.merge(all, services)
        return services
      },
    })
  const build = (features: ReadonlyArray<Feature>): Context.Context<never> =>
    UndefinedOr.match(lists.get(features), {
      onDefined: (services) => services,
      onUndefined: () => {
        const services = Arr.reduce(features, NONE, (joined, feature) => Context.merge(joined, one(feature)))
        lists.set(features, services)
        return services
      },
    })
  return {
    build,
    built: () => all,
    ...sectionsAndWarnings(build, (message) => {
      runtime.runFork(Effect.logWarning(message))
    }),
    dispose: () => disposeReported(runtime),
  }
}

/**
 * Disposes `runtime`, its Features first. A finalizer that fails is logged and reported, through the
 * `ErrorReporter`s its Environment had, once the runtime has gone, and the rest still run: the promise
 * never rejects.
 */
const disposeReported = (runtime: ProviderRuntime): Promise<void> => {
  // Read before it goes: its reporters are in it. Unbuilt, there's none, and a report is logged only.
  const context = runtime.cachedContext
  return Effect.runPromiseExit(runtime.disposeEffect).then((exit) => {
    if (Exit.isSuccess(exit)) return
    const report = Report.failure("wardic.provider: a finalizer failed as it was disposed", exit.cause)
    return Effect.runPromise(UndefinedOr.match(context, { onUndefined: () => report, onDefined: (services) => Effect.provideContext(report, services) }))
  })
}

/**
 * A server render's Features (ADR-0021): none built, as no runtime is; each one's `server` run once,
 * the first time it's asked for. Disposing disposes the unbuilt runtime, as on unmount.
 */
export const serverRegistry = (runtime: ManagedRuntime.ManagedRuntime<WardicServices, never>): FeatureRegistry => {
  const ran = new Set<Feature>()
  const build = (features: ReadonlyArray<Feature>): Context.Context<never> => {
    Arr.forEach(features, (feature) => {
      if (ran.has(feature)) return
      ran.add(feature)
      UndefinedOr.map(feature.server, (server) => server())
    })
    return NONE
  }
  // A server render says nothing: the client, rendering the same, does.
  return { build, built: () => NONE, ...sectionsAndWarnings(build, constVoid), dispose: () => runtime.dispose() }
}

/**
 * A CSS function naming a colour space only the `colors` Feature reads: `oklch()`, `oklab()`, `lab()`,
 * `lch()`, `hwb()`, and `color()` in any space but `srgb`, which the base reads.
 */
const WIDE_GAMUT = /^\s*(?:(?:oklch|oklab|lab|lch|hwb)\(|color\(\s*(?!srgb\s))/i

/**
 * The first of `values` that only the `colors` Feature would read as a colour (#511, decision 7): a
 * string naming a wide-gamut space, while no space beyond sRGB's is registered on the page.
 * `undefined` when there's none. Asked of the page, not of an element's Features: culori's spaces are
 * the page's, so one registered by any provider is read by every element (`features/colors.ts`).
 */
export const unreadColorIn = (values: Readonly<Record<string, unknown>>): string | undefined => {
  if (Color.spacesRegistered()) return undefined
  return Arr.findFirst(Object.values(values), (value): value is string => Predicate.isString(value) && WIDE_GAMUT.test(value)).pipe(Option.getOrUndefined)
}

/**
 * Development's word on a Complete element under a `strict` section (#511, ADR-0067 decision 7,
 * Motion's), naming the binding's `complete` forms and the `slim` ones to use.
 */
export const strictMessage = (complete: string, slim: string): string =>
  `wardic: a Complete element (${complete}) is rendered under a strict WardicProvider or LazyWardic. ` +
  `It brings every Feature's code with it; render the Slim element (${slim}) instead.`

/** What development's word on a missing `layout` Feature names (#511): the props that need it. */
export const LAYOUT_PROPS = "A layout prop (`layout`, `layoutId`, `layoutScroll` or `layoutRoot`)"

/**
 * Development's word on a missing Feature (#511, ADR-0067 decision 7): what needed it, its import from
 * the binding's `entry`, and where to add it. Not a Complete element, which a `strict` section makes
 * an error (#581).
 */
export const missingMessage = (feature: string, what: string, entry: string): string =>
  `wardic: ${what} needs the \`${feature}\` Feature, which no WardicProvider or LazyWardic above this element has. ` +
  `Add it: \`import { ${feature} } from "${entry}"\`, then \`<WardicProvider features={[${feature}]}>\` or \`<LazyWardic features={[${feature}]}>\`.`
