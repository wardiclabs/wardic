/**
 * How Commands get Wardic's services (ADR-0071, decisions 9, 26 and 31; *Amendment (#791)*, PR 3): the
 * seam that differs on Foldkit's preview. On 0.170, the `Wardic` service is the **Handle**, which
 * `wardic.resources` gives a program's Commands, and the two Effects over it: `animate`, an
 * **Imperative animation** of an element, and `provide`, which runs an Effect on the Provider's
 * services. Either builds the Provider when none is live, and counts itself in as a member while it
 * runs, so the Provider doesn't close under it.
 *
 * @module
 */
import * as WardicConfigValue from "@wardic/core/unstable/WardicConfigValue"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Imperative from "@wardic/dom/unstable/Imperative"
import * as Arr from "effect/Array"
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
const member = Effect.fnUntraced(function* () {
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

/** What `animate` takes: dom's options, less `onComplete`, which the Effect's success is. */
// An intersection, not an `Omit`: dom's options are a union of transitions, which `Omit` spreads past
// what TypeScript represents (TS2590).
export type AnimateOptions = Imperative.WardicAnimateOptions & { readonly onComplete?: never }

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

/**
 * An **Imperative animation** of `subject` (ADR-0071, decision 26; Motion's `animate`): an element, a
 * selector resolved under the `w.Provider()` element, else the document, or a list of elements, to
 * `values` on `options`' transition. Succeeds once it ends, with whether it landed; fails with
 * {@link AnimationFailed} when the subject finds nothing; interrupting its fiber stops it where it is.
 * A Wardic element animates through its own spine, latest wins, as Motion's; a plain element through
 * a spine of its own. Wrap it in `Command.define`, with `resources: wardic.resources` on the program.
 */
export const animate: (subject: Imperative.WardicAnimationSubject, values: WardConfig.WardicVariant, options?: AnimateOptions) => Effect.Effect<AnimationEnd, AnimationFailed, Wardic> = Effect.fnUntraced(
  function* (subject, values, options) {
    // A member from before its subject is checked: a Provider built for a subject that finds nothing is
    // left again at once, not kept up with no member.
    const { state, provider, left } = yield* member()
    const root = provider.root
    if (countOf(subject, root) === 0) {
      left()
      return yield* Effect.fail(new AnimationFailed({ subject: nameOf(subject) }))
    }
    return yield* running(state, provider, root, left, subject, values, options)
  },
)

/** `scopedAnimate`'s element form, named plainly: its overloads' union is more than TypeScript represents at a call. */
type Run = (subject: Imperative.WardicAnimationSubject, target: WardConfig.WardicVariant, options?: AnimateOptions) => Imperative.WardicPlaybackControls

/** The animation, run until it ends: its end as the Effect's success, its interruption as its stop. */
const running = (state: State, provider: Provider, root: Element | undefined, left: () => void, subject: Imperative.WardicAnimationSubject, values: WardConfig.WardicVariant, options: AnimateOptions | undefined): Effect.Effect<AnimationEnd> =>
  Effect.callback<AnimationEnd>((resume) => {
    const controls = MutableRef.make(Option.none<Imperative.WardicPlaybackControls>())
    const run = Imperative.scopedAnimate(envOf(state, provider), () => root, {
      started: (made) => {
        MutableRef.set(controls, Option.some(made))
      },
      ended: (_made, landed) => {
        left()
        resume(Effect.succeed({ landed }))
      },
    }) as unknown as Run
    run(subject, values, options)
    return Effect.sync(() => {
      Option.map(MutableRef.get(controls), (made) => made.stop())
      left()
    })
  })

/**
 * `effect` run on the Provider's services (ADR-0071, the grill's Q23): how a Command makes a derived
 * Live value (`LiveValue.spring`, `follow`, `velocity`, `scroll`). The Scope is the caller's: a
 * `ManagedResource`'s `acquire`, whose Scope Foldkit closes when its Model condition drops, or an
 * `Effect.scoped` that ends with the Command. The Provider is held while that Scope lives.
 */
export const provide: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Feature.ProviderServices> | Wardic | Scope.Scope> = Effect.fnUntraced(
  function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
    const { provider, left } = yield* member()
    yield* Effect.addFinalizer(() => Effect.sync(left))
    return yield* Effect.provideContext(effect, provider.context)
  },
)
