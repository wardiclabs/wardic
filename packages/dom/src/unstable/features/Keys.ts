/**
 * Every Feature's key (#548, ADR-0067 *Amendment (#548)*): the services an element's code looks up,
 * apart from the Features themselves, whose Layers bring a gesture's or the colour spaces' code. Every
 * page's elements import these; only a page whose section has a Feature imports its module. The
 * `layout` Feature's key is dom's `ProjectionSystem`, beside {@link ProjectionNodes}, its element code's.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR6-Q1): solid's `features/keys.ts`, moved to dom with the Features, for
// every DOM binding.
import type * as DragRecognizer from "@wardic/core/DragRecognizer"
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as Probe from "@wardic/core/Probe"
import type * as Recognizer from "@wardic/core/Recognizer"
import * as ProjectionSystem from "../../ProjectionSystem.ts"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { LazyArg } from "effect/Function"
import type * as Scope from "effect/Scope"
import type * as DragConstraints from "../DragConstraints.ts"
import type * as DragTrack from "../DragTrack.ts"
import type * as LayoutMember from "../LayoutMember.ts"
import type * as WardicServices from "@wardic/core/unstable/WardicServices"

/** The `hover` Feature's service: an element's hover watched, over the gestures' input. */
export class HoverGesture extends /*#__PURE__*/ Context.Service<
  HoverGesture,
  { readonly watch: (target: unknown, handlers: Recognizer.HoverHandlers) => Effect.Effect<void, never, Scope.Scope> }
>()("@wardic/dom/unstable/HoverGesture") {}

/** The `press` Feature's service: an element's presses watched (`Press`), over the gestures' input. */
export class PressGesture extends /*#__PURE__*/ Context.Service<
  PressGesture,
  {
    readonly watch: (
      element: unknown,
      handlers: InputFeed.Handlers<Recognizer.PressEvent>,
      keysTaken?: boolean,
      propagates?: LazyArg<boolean>,
    ) => Effect.Effect<void, never, Scope.Scope>
  }
>()("@wardic/dom/unstable/PressGesture") {}

/** The `focus` Feature's service: an element's focus watched, over the gestures' input. */
export class FocusGesture extends /*#__PURE__*/ Context.Service<
  FocusGesture,
  { readonly watch: (target: unknown, options: Recognizer.FocusOptions, handlers: InputFeed.Handlers<boolean>) => Effect.Effect<void, never, Scope.Scope> }
>()("@wardic/dom/unstable/FocusGesture") {}

/** The `inView` Feature's service: an element's intersections watched, over the Environment's Probe. */
export class InViewGesture extends /*#__PURE__*/ Context.Service<
  InViewGesture,
  {
    readonly watch: (
      target: unknown,
      options: Recognizer.InViewOptions,
      handlers: InputFeed.Handlers<Recognizer.ViewEdge>,
    ) => Effect.Effect<void, never, Scope.Scope | Probe.Probe>
  }
>()("@wardic/dom/unstable/InViewGesture") {}

/** The `pan` Feature's service: an element's pans watched, over the gestures' input. */
export class PanGesture extends /*#__PURE__*/ Context.Service<
  PanGesture,
  {
    readonly watch: (
      target: unknown,
      handlers: InputFeed.Handlers<DragRecognizer.PanSample>,
      options?: DragRecognizer.PanOptions,
    ) => Effect.Effect<void, never, Scope.Scope>
  }
>()("@wardic/dom/unstable/PanGesture") {}

/** What an element hands the drag Feature: the track's options, its watches and responses run on its provider. */
export interface DragRun extends Omit<DragTrack.DragTrackOptions, "watch" | "fork"> {
  readonly watch: (track: (onDefect: InputFeed.OnDefect) => Effect.Effect<void, never, Scope.Scope | WardicServices.WardicServices>) => void
  readonly fork: (response: Effect.Effect<void, never, WardicServices.WardicServices>) => void
}

/**
 * The `drag` Feature's service: an element's drag track driven over the gestures' input, and its
 * `dragConstraints` read (a box, or a container measured against the element).
 */
export class DragGesture extends /*#__PURE__*/ Context.Service<
  DragGesture,
  {
    readonly drive: (run: DragRun) => DragTrack.DragTrack
    readonly constraintsOf: typeof DragConstraints.trackConstraintsOf
  }
>()("@wardic/dom/unstable/DragGesture") {}

/** The `colors` Feature's service: that the page reads every CSS colour space. */
export class Colors extends /*#__PURE__*/ Context.Service<Colors, true>()("@wardic/dom/unstable/Colors") {}

/**
 * The `layout` Feature's element code (#746, ADR-0067 *Amendment (#746)*, decision 9), beside the
 * projection system it builds: what makes a Wardic element's **Projection node**, its options from its
 * config and its registration, so an app without `layout` ships neither.
 */
export class ProjectionNodes extends /*#__PURE__*/ Context.Service<
  ProjectionNodes,
  {
    /** A ward's node options, from its config (`LayoutMember`'s `layoutOptionsOf`). */
    readonly optionsOf: (ward: LayoutMember.WardLayout) => LayoutMember.CreateProjectionNodeOptions
    /** What its node registers with the projection system (`LayoutMember`'s `registrationOf`). */
    readonly registrationOf: (opts: LayoutMember.CreateProjectionNodeOptions) => ProjectionSystem.RegisterNodeOptions
  }
>()("@wardic/dom/unstable/ProjectionNodes") {}

// #672: the readers of a section's layout services, out of solid's runtime.ts, with the keys they read.
/** The projection system among `services`, the `layout` Feature's (#511), or `undefined` when they hold none. */
export const projectionIn = (services: Context.Context<never>): ProjectionSystem.Shape | undefined =>
  Option.getOrUndefined(Context.getOption(services as Context.Context<ProjectionSystem.ProjectionSystem>, ProjectionSystem.ProjectionSystem))

/**
 * The `layout` Feature's element code in `services` (#746): what makes a Wardic element's node on its
 * projection system. Read where an element makes its node, from Features {@link projectionIn} found
 * `layout` in, which give both.
 */
export const projectionNodesIn = (services: Context.Context<never>): ProjectionNodes["Service"] =>
  Context.get(services as Context.Context<ProjectionNodes>, ProjectionNodes)
