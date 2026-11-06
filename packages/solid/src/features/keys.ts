/**
 * Every Feature's key (#548, ADR-0067 *Amendment (#548)*): the services an element's code looks up,
 * apart from the Features themselves, whose Layers bring a gesture's or the colour spaces' code. Every
 * page's elements import these; only a page whose section has a Feature imports its module. The
 * `layout` Feature's key is dom's `ProjectionSystem`.
 *
 * @module
 */
import type * as DragRecognizer from "@wardic/core/DragRecognizer"
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as Probe from "@wardic/core/Probe"
import type * as Recognizer from "@wardic/core/Recognizer"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type { LazyArg } from "effect/Function"
import type * as Scope from "effect/Scope"
import type { trackConstraintsOf } from "../drag-constraints.ts"
import type { DragTrack, DragTrackOptions } from "../drag-track.ts"
import type { WardicServices } from "../runtime.ts"

/** The `hover` Feature's service: an element's hover watched, over the gestures' input. */
export class HoverGesture extends /*#__PURE__*/ Context.Service<
  HoverGesture,
  { readonly watch: (target: unknown, handlers: Recognizer.HoverHandlers) => Effect.Effect<void, never, Scope.Scope> }
>()("@wardic/solid/HoverGesture") {}

/** The `press` Feature's service: an element's presses watched (`press.ts`), over the gestures' input. */
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
>()("@wardic/solid/PressGesture") {}

/** The `focus` Feature's service: an element's focus watched, over the gestures' input. */
export class FocusGesture extends /*#__PURE__*/ Context.Service<
  FocusGesture,
  { readonly watch: (target: unknown, options: Recognizer.FocusOptions, handlers: InputFeed.Handlers<boolean>) => Effect.Effect<void, never, Scope.Scope> }
>()("@wardic/solid/FocusGesture") {}

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
>()("@wardic/solid/InViewGesture") {}

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
>()("@wardic/solid/PanGesture") {}

/** What an element hands the drag Feature: the track's options, its watches and responses run on its provider. */
export interface DragRun extends Omit<DragTrackOptions, "watch" | "fork"> {
  readonly watch: (track: (onDefect: InputFeed.OnDefect) => Effect.Effect<void, never, Scope.Scope | WardicServices>) => void
  readonly fork: (response: Effect.Effect<void, never, WardicServices>) => void
}

/**
 * The `drag` Feature's service: an element's drag track driven over the gestures' input, and its
 * `dragConstraints` read (a box, or a container measured against the element).
 */
export class DragGesture extends /*#__PURE__*/ Context.Service<
  DragGesture,
  {
    readonly drive: (run: DragRun) => DragTrack
    readonly constraintsOf: typeof trackConstraintsOf
  }
>()("@wardic/solid/DragGesture") {}

/** The `colors` Feature's service: that the page reads every CSS colour space. */
export class Colors extends /*#__PURE__*/ Context.Service<Colors, true>()("@wardic/solid/Colors") {}
