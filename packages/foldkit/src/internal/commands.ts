/**
 * How Commands get Wardic's services (ADR-0071, decisions 9, 26 and 31; *Amendment (#791)*, PR 3): the
 * seam that differs on Foldkit's preview. On 0.170, the `Wardic` service is the **Handle**, which
 * `wardic.resources` gives a program's Commands, and the two Effects over it: `animate`, an
 * **Imperative animation** of an element or a **Sequence**, under an **Animation scope** when given
 * (#798), and `provide`, which runs an Effect on the Provider's services. Either builds the Provider when none is live, and counts itself in as a member while it
 * runs, so the Provider doesn't close under it.
 *
 * @module
 */
import type * as ScrollSource from "@wardic/core/ScrollSource"
import * as WardicConfigValue from "@wardic/core/unstable/WardicConfigValue"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Imperative from "@wardic/dom/unstable/Imperative"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { constVoid } from "effect/Function"
import * as Layer from "effect/Layer"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Render from "foldkit/render"
import type * as Feature from "@wardic/dom/unstable/Feature"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import { hintFrameUnless } from "./delivery.ts"
import { type Layout, layoutOf } from "./layout.ts"
import { type AnimationScope, watchOf } from "./scope.ts"
import { joined, providerFor, type Provider, reducedMotionUnder, type State, stateOf } from "./services.ts"

/** The mark of a Handle, as the `Wardic` service carries it: what its Effects reach the Handle's state through. */
export const HANDLE: unique symbol = Symbol.for("@wardic/foldkit/Handle")

/** A Handle as the `Wardic` service holds it: a mark, so a Command's Effect types no builder. */
export interface HandleRef {
  readonly [HANDLE]: true
}

/** The Wardic service: a program's **Handle**, which `wardic.resources` gives its Commands. */
export class Wardic extends Context.Service<Wardic, HandleRef>()("@wardic/foldkit/Wardic") {}

/** The Layer a program's `resources` takes, giving its Commands the Handle (decision 9): read when built, so the Handle can hold it. */
export const resourcesOf = (handle: () => HandleRef): Layer.Layer<Wardic> => Layer.sync(Wardic)(handle)

/** What `animate` ends with: whether every key landed, or a later animation took its keys (#791, Q21). */
export interface AnimationEnd {
  readonly landed: boolean
}

/** `animate` found nothing to animate: a selector matching no element under the root, or an empty list. */
export class AnimationFailed extends Data.TaggedError("AnimationFailed")<{
  readonly subject: string
}> {}

/** `animateLayout` found no layout to animate: the Handle has no `layout` Feature (`Features.layout`). */
export class LayoutFailed extends Data.TaggedError("LayoutFailed")<{
  readonly reason: "no-layout-feature"
}> {}

/** What a Command's Effect is a member of: the Handle's Provider, built when none is live, and the count out. */
const member: () => Effect.Effect<Member, never, Wardic> = Effect.fnUntraced(function* () {
  const handle = yield* Wardic
  const state = stateOf(handle)
  const provider = yield* providerFor(state, undefined, undefined)
  // A member while it runs: the Provider stays up until it ends.
  return { state, provider, left: joined(state, provider, undefined) }
})

/** What `animateLayout` takes: dom's options, less `onSettled`, which the Effect's success is. */
export type AnimateLayoutOptions = Omit<ProjectionSystem.AnimateLayoutOptions, "onSettled">

/** No options: a change animated from the last pass's boxes. */
const FROM_LAST_PASS: AnimateLayoutOptions = { from: "lastPass" }

/**
 * A **Declared layout change** (ADR-0071, decision 26; ADR-0038; Motion's `animateLayout`): what a
 * Command runs after the Model change that moved the layout elements, under either trigger, and the
 * only trigger beside `w.LayoutDependency` under `layoutTrigger: "declared"`. It waits for the
 * render's commit (Foldkit's `Render.afterCommit`), then asks for a Measure pass from the boxes the
 * last pass kept (`from: "lastPass"`, the default: the change is on the page by then), and succeeds
 * once every layout animation the pass started has ended, at once if none. Fails with
 * {@link LayoutFailed} when the Handle has no `layout` Feature. Wrap it in `Command.define`, with
 * `resources: wardic.resources` on the program.
 */
export const animateLayout: (options?: AnimateLayoutOptions) => Effect.Effect<void, LayoutFailed, Wardic> = Effect.fnUntraced(function* (options) {
  const { state, provider, left } = yield* member()
  const layout = layoutOf(provider, state)
  if (Predicate.isUndefined(layout)) {
    left()
    return yield* Effect.fail(new LayoutFailed({ reason: "no-layout-feature" }))
  }
  yield* Render.afterCommit
  return yield* settling(state, provider, layout, left, { ...FROM_LAST_PASS, ...options })
})

/** The change's pass, and its settling as the Effect's success; its interruption leaves the member. */
const settling = (state: State, provider: Provider, layout: Layout, left: () => void, options: AnimateLayoutOptions): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    const run = (): void => {
      layout.projection.animateLayout(constVoid, {
        ...options,
        onSettled: () => {
          left()
          resume(Effect.void)
        },
      })
    }
    // A View Transition's render (decision 33): the change lands as an Instant change of the layout, settled at once.
    if (state.transitioning) {
      state.transitioning = false
      layout.projection.instant(run)
      return Effect.sync(left)
    }
    // The pass's first step paints in this frame (decision 32): the Command resumed inside it, after the commit.
    hintFrameUnless(provider.loop, provider.paused)
    run()
    return Effect.sync(left)
  })

/** How many elements `subject` names, under `root`: a selector's matches, an element, or a list's members. */
const countOf = (subject: Imperative.WardicAnimationSubject, root: Element | undefined): number => {
  if (Predicate.isNullish(subject)) return 0
  if (Predicate.isString(subject)) return UndefinedOr.match(root, { onUndefined: () => document, onDefined: (el): ParentNode => el }).querySelectorAll(subject).length
  if (Predicate.hasProperty(subject, "nodeType")) return 1
  if (Predicate.isIterable(subject)) return Arr.fromIterable(subject).length
  return (subject as ArrayLike<Element>).length
}

/** `subject` as an error names it. */
const nameOf = (subject: Imperative.WardicAnimationSubject): string => {
  if (Predicate.isString(subject)) return subject
  if (Predicate.isNullish(subject)) return String(subject)
  return "an element list"
}

/**
 * What a Command's animations run on: the Provider's services, as a Solid animation scope's, under the
 * Handle's `config` (decision 22): its `reducedMotion` and `skipAnimations`, read as each animation starts.
 */
const envOf = (state: State, provider: Provider): Imperative.AnimateEnv => ({
  runtime: provider.runtime,
  gate: provider.gate,
  reducedMotion: reducedMotionUnder(provider, state.rootConfig),
  skipAnimations: WardicConfigValue.skipAnimationsOf(state.rootConfig),
  positionalKeys: provider.positionalKeys,
  defaultTransition: provider.defaultTransition,
  ownValues: provider.valueReads.ownValues,
  measuredPairs: provider.valueReads.measuredPairs,
  variableValues: provider.valueReads.variableValues,
})

/** What a Command's animation options carry on Foldkit: the scope the binding's, `onComplete` the Effect's success, so neither reaches dom. */
// #798, Q8: the scope an option on both forms. `onComplete?: never`, as before: the Effect succeeds in its place.
interface Scoped {
  readonly onComplete?: never
  readonly scope?: AnimationScope | undefined
}

/** What `animate` takes with a subject: dom's options, less `onComplete`, which the Effect's success is, and the **Animation scope** its selectors resolve under. */
// An intersection, not an `Omit`: dom's options are a union of transitions, which `Omit` spreads past
// what TypeScript represents (TS2590).
export type AnimateOptions = Imperative.WardicAnimateOptions & Scoped

/** A sequence (Motion's `animate(sequence)`): Segments of elements, function Segments and labels, laid out in time. No Batch Segment: Foldkit has no Batch. */
// #798, Q6. dom's sequence less its Batch Segment, which the type says as the doc does.
export type Sequence = ReadonlyArray<Exclude<Imperative.WardicSegment, Imperative.WardicBatchSegment>>

/** What `animate` takes with a sequence: dom's options, less `onComplete`, which the Effect's success is, and the scope. */
export type SequenceOptions = Imperative.WardicSequenceOptions & Scoped

/** `AnimationFailed`'s subject for a sequence none of whose Segments found anything (#798, Q15). */
const SEQUENCE = "a sequence"

/** The scope `options` name, or none. */
const scopeIn = (options: Scoped | undefined): AnimationScope | undefined => UndefinedOr.map(options, (given) => given.scope)

/** `options` as dom takes them: the scope, the binding's own, left out. Typed loosely, since dom's option types are unions `Omit` spreads past what TypeScript represents. */
const withoutScope = (options: Scoped): Readonly<Record<string, unknown>> => {
  const { scope: _scope, ...rest } = options as Scoped & Readonly<Record<string, unknown>>
  return rest
}

/**
 * Where a Command's selectors resolve (#798, Q8): under the scope's element; with no scope, under the
 * `w.Provider()` element, else the document (`undefined`); none for a scope whose element isn't
 * mounted, which finds nothing before any element is looked at.
 */
const insideOf = (provider: Provider, scope: AnimationScope | undefined): Option.Option<Element | undefined> =>
  UndefinedOr.match(scope, { onUndefined: () => Option.some(provider.root), onDefined: (given) => Option.fromUndefinedOr(given.element()) })

/** What a Command's Effect is a member of: the Handle's state and Provider, and the count out. */
interface Member {
  readonly state: State
  readonly provider: Provider
  readonly left: () => void
}

/**
 * `animate`'s two forms (Motion's `animate`, as `useAnimate` gives it): a subject to values, or a
 * sequence. Each an Effect for a Command, succeeding once the animation ends with whether it landed,
 * failing with {@link AnimationFailed} when nothing finds anything to animate, and stopped by its
 * fiber's interruption.
 */
// #798, Q6: one interface, the form told by dom's `isSequence`.
export interface Animate {
  // ADR-0071, decision 26; #791 Q21; #798 Q8 for the scope.
  /**
   * An **Imperative animation** of `subject`: an element, a selector resolved under `options.scope`'s
   * element, else the `w.Provider()` element, else the document, or a list of elements, to `values` on
   * `options`' transition. A Wardic element animates through its own spine, latest wins, as Motion's; a
   * plain element through a spine of its own. Fails when the subject finds nothing, a scope not mounted
   * included. Wrap it in `Command.define`, with `resources: wardic.resources` on the program.
   */
  (subject: Imperative.WardicAnimationSubject, values: WardConfig.WardicVariant, options?: AnimateOptions): Effect.Effect<AnimationEnd, AnimationFailed, Wardic>
  // #798, Q6 and Q15. Motion's `animate(sequence)`.
  /**
   * A **Sequence**: its Segments laid out in time, labels and `at` among them, played as one animation
   * under `options`. Fails when the whole sequence animates nothing: every Segment of elements found
   * none and no function Segment is in it; a Segment that finds nothing beside ones that do is skipped.
   */
  (sequence: Sequence, options?: SequenceOptions): Effect.Effect<AnimationEnd, AnimationFailed, Wardic>
}

/** `animate` (above): the form told by what it's given, as dom's own `animate` tells it. */
export const animate: Animate = ((first: Imperative.WardicAnimationSubject | Sequence, second?: WardConfig.WardicVariant | SequenceOptions, third?: AnimateOptions) => {
  if (Imperative.isSequence(first)) {
    const options = second as SequenceOptions | undefined
    return commanded(scopeIn(options), (under) => Arr.some(first, (segment) => Imperative.segmentAnimates(segment, under)), SEQUENCE, (run) =>
      (run as unknown as RunSequence)(first, UndefinedOr.map(options, withoutScope) as Imperative.WardicSequenceOptions | undefined))
  }
  return commanded(scopeIn(third), (under) => countOf(first, under) > 0, nameOf(first), (run) =>
    (run as unknown as RunSubject)(first, second as WardConfig.WardicVariant, UndefinedOr.map(third, withoutScope) as Imperative.WardicAnimateOptions | undefined))
}) as Animate

/**
 * A Command's animation of either form: a member of the Handle's Provider while it runs (a member
 * from before anything is looked at, so a Provider built for one that finds nothing is left again at
 * once), its selectors' root under `scope`, `finds` asked of that root, nothing found failing as
 * `named`, and `start` run on dom's scoped `animate`.
 */
const commanded: (
  scope: AnimationScope | undefined,
  finds: (under: Element | undefined) => boolean,
  named: string,
  start: (run: Imperative.WardicAnimate) => Imperative.WardicPlaybackControls,
) => Effect.Effect<AnimationEnd, AnimationFailed, Wardic> = Effect.fnUntraced(function* (scope, finds, named, start) {
  const held = yield* member()
  const inside = insideOf(held.provider, scope)
  if (Option.isNone(inside)) {
    held.left()
    return yield* Effect.fail(new AnimationFailed({ subject: named }))
  }
  if (Bool.not(finds(inside.value))) {
    held.left()
    return yield* Effect.fail(new AnimationFailed({ subject: named }))
  }
  return yield* running(held, inside.value, scope, start)
})

/** dom's `animate` in its subject form, named plainly: its overloads' union is more than TypeScript represents at a call. */
type RunSubject = (subject: Imperative.WardicAnimationSubject, target: WardConfig.WardicVariant, options?: Imperative.WardicAnimateOptions) => Imperative.WardicPlaybackControls

/** dom's `animate` in its sequence form, named plainly. */
type RunSequence = (sequence: Sequence, options?: Imperative.WardicSequenceOptions) => Imperative.WardicPlaybackControls

/**
 * The animation `start` runs on dom's scoped `animate`, until it ends: its end as the Effect's success,
 * its interruption as its stop. With a `scope`, the scope's watch is told each start and end too
 * (Q7): what its element's release stops, each then ending with `landed: false` (Q19).
 */
const running = (held: Member, under: Element | undefined, scope: AnimationScope | undefined, start: (run: Imperative.WardicAnimate) => Imperative.WardicPlaybackControls): Effect.Effect<AnimationEnd> =>
  Effect.callback<AnimationEnd>((resume) => {
    const controls = MutableRef.make(Option.none<Imperative.WardicPlaybackControls>())
    const watch = Imperative.alsoTold(
      {
        started: (made) => {
          MutableRef.set(controls, Option.some(made))
        },
        ended: (_made, landed) => {
          held.left()
          resume(Effect.succeed({ landed }))
        },
      },
      UndefinedOr.map(scope, watchOf),
    )
    start(Imperative.scopedAnimate(envOf(held.state, held.provider), () => under, watch))
    return Effect.sync(() => {
      Option.map(MutableRef.get(controls), (made) => made.stop())
      held.left()
    })
  })

/**
 * The services the Handle's Features give an Effect under {@link provide}, beside the Provider's own:
 * the `scroll` Feature's `ScrollSource`, which `LiveValue.scroll` asks for (#795).
 */
export type FeatureServices = ScrollSource.ScrollSource

/**
 * `effect` run on the Provider's services (ADR-0071, the grill's Q23), and its Features' (#795): how a
 * Command makes a derived Live value (`LiveValue.spring`, `follow`, `velocity`, `scroll`). The Scope
 * is the caller's: a `ManagedResource`'s `acquire`, whose Scope Foldkit closes when its Model condition
 * drops, or an `Effect.scoped` that ends with the Command. The Provider is held while that Scope
 * lives. `LiveValue.scroll` asks for the `scroll` Feature's service: give the Handle `Features.scroll`,
 * or the Effect dies on the service it's missing.
 */
export const provide: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Feature.ProviderServices | FeatureServices> | Wardic | Scope.Scope> = Effect.fnUntraced(
  function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
    const { provider, left } = yield* member()
    yield* Effect.addFinalizer(() => Effect.sync(left))
    // The Features' services beside the Provider's: what the Handle's Features have built, as Solid's
    // `createScroll` reads the `ScrollSource` from the Features its provider brought.
    const services = Context.merge(provider.context, provider.features.services()) as Context.Context<Feature.ProviderServices | FeatureServices>
    return yield* Effect.provideContext(effect, services)
  },
)
