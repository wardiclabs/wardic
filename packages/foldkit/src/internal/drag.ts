/**
 * A `w.*` element's drag (#793, PR 2; ADR-0004; ADR-0071 decision 23): dom's drag track, driven by the
 * binding (the `drag` Feature's `drive`), started the first time a delivery wants it (`w.Drag` while
 * `Features.drag` is built) and kept, in a Scope of the element's own on the provider, closed at the
 * release. Its options are read as it starts (Q6): a changed one wants a new key. Its defaults are
 * written then (Q10; ADR-0019 *Amendment (Reorder)*), under the element's own inline style, and it
 * drives the layout node the element has then (ADR-0016). What the spine reads of it (its axis, its
 * track, whether it drives a projection) sits on the spine's options, written as the track starts: the
 * spine reads each where it uses it. A drag wanted without its Feature is inert, and warned once in
 * development.
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as Spine from "@wardic/core/unstable/Spine"
import type * as Values from "@wardic/core/Values"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as DragDefaults from "@wardic/dom/unstable/DragDefaults"
import * as DragTrack from "@wardic/dom/unstable/DragTrack"
import * as DragTransition from "@wardic/dom/unstable/DragTransition"
import * as ElementSetup from "@wardic/dom/unstable/ElementSetup"
import * as GestureFeatures from "@wardic/dom/unstable/GestureFeatures"
import type * as LiveStyle from "@wardic/dom/unstable/LiveStyle"
import * as OwnerScope from "@wardic/dom/unstable/OwnerScope"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import * as Keys from "@wardic/dom/unstable/features/Keys"
import * as MutableRef from "effect/MutableRef"
import * as Predicate from "effect/Predicate"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import type { View } from "./element.ts"
import { featureIn, type Provider, reporterOf, warnMissing } from "./services.ts"

/** What the spine reads of an element's drag (ADR-0004, #340): on its options, written as the track starts. */
export interface SpineDragOptions {
  dragAxis: boolean | "x" | "y" | undefined
  drag: Spine.SpineDrag | undefined
  projected: boolean
}

/** What an element's drag is made with. */
export interface DragOptions {
  readonly provider: Provider
  readonly element: HTMLElement
  /** The element's id, for a report. */
  readonly id: string
  /** The element's config now, as its last delivery gave it: the drag's options read as the track starts, the measure's function at each measure. */
  readonly config: () => Pick<View, "drag" | "dragListener" | "dragConstraints" | "dragControls" | "onMeasureDragConstraints" | keyof DragTrack.DragOptions | "dragTransition">
  /** The spine's Snapshot, which the drag reads and writes `x`/`y` through. */
  readonly snapshot: Spine.Snapshot
  readonly recordFrame: (value: Values.Values) => void
  readonly live: LiveStyle.LiveStyle
  /** The element's spine options: what the spine reads of the drag. */
  readonly spine: SpineDragOptions
  /** The element's layout node now: the track's projection as it starts (ADR-0016). */
  readonly layoutNode: () => ProjectionSystem.DragHandle | undefined
  /** A Reorder item's axis, read at each gesture's start in place of `Drag`'s (ADR-0020): the group's, once the item has joined it; `undefined` for any other element. Read as the track starts. */
  readonly itemAxis: () => (() => true | "x" | "y") | undefined
  /** The nearest `w.Config`'s `transformPagePoint` (Q9), read at each down. */
  readonly pagePoint: () => WardConfig.WardicTransformPoint | undefined
  readonly skipAnimations: () => boolean
  /** Told as the drag takes `x`/`y`, and as it hands them back. */
  readonly onDragging: (on: boolean) => void
  /** Each sample, after the track's write: the element's drag callbacks. */
  readonly onSample: (sample: Drag.Sample) => void
  /** The release came to rest on its own. */
  readonly onReleaseEnd: () => void
}

/** An element's drag (above). */
export interface ElementDrag {
  /** Start the track if the config wants it and the Feature is here, once: at mount, at each delivery, and as a Feature arrives. */
  readonly check: () => void
  /** Close the track's Scope: at the element's release. */
  readonly dispose: () => void
}

/** The track's end that failed, at the element's release. */
const END_FAILED = "wardic.drag: the track's end failed"

/** A watch's own handler threw, dom's, past the app's callbacks. */
const WATCH_FAILED = "wardic.drag: a watch's handler failed"

/** An element's drag (above): nothing started until `check` wants it. */
export const dragOf = (opts: DragOptions): ElementDrag => {
  const { provider, element, id, spine, config } = opts
  const scope = MutableRef.make<Scope.Closeable | undefined>(undefined)
  const report = reporterOf(provider, id)
  const onDefect: InputFeed.OnDefect = (cause) => report(WATCH_FAILED, cause)
  /** The track, from this delivery's options: its defaults written first, its Scope the element's own. */
  const start = (service: Keys.DragGesture["Service"], axis: boolean | "x" | "y", axisAt: (() => true | "x" | "y") | undefined): void => {
    const c = config()
    UndefinedOr.map(DragDefaults.dragDefaultsOf(c, { dragAxis: axisAt }), (defaults) => DragDefaults.applyDragDefaults(element, defaults))
    const constraints = service.constraintsOf(c.dragConstraints, element, () => config().onMeasureDragConstraints, opts.pagePoint)
    const projection = opts.layoutNode()
    const owner = OwnerScope.open(provider.runtime)
    MutableRef.set(scope, owner)
    const track = service.drive({
      watch: (track) => provider.runtime.runSync(track(onDefect).pipe(Scope.provide(owner))),
      fork: (response) => void provider.runtime.runFork(response),
      gate: provider.gate,
      id,
      element,
      snapshot: opts.snapshot,
      recordFrame: opts.recordFrame,
      // A drag's start turns its `style`'s will-change value on (#443).
      setDragging: ElementSetup.draggingWithWillChange(opts.live, opts.onDragging, element),
      claim: ElementSetup.claimForDrag(element),
      config: DragTrack.trackConfigOf(c, axis, constraints.constraints, DragTransition.dragTransitionOf(c.dragElastic, c.dragTransition)),
      // A drag on a layout node feeds the projection (ADR-0016): it follows the pointer and FLIPs to its slot on release.
      projection,
      axisAt,
      onSample: opts.onSample,
      onReleaseEnd: opts.onReleaseEnd,
      skipAnimations: opts.skipAnimations,
      container: constraints.container,
      controls: c.dragControls,
      mapPoint: opts.pagePoint,
    })
    spine.dragAxis = axis
    spine.drag = track
    spine.projected = Predicate.isNotUndefined(projection)
  }
  return {
    check: () => {
      if (Predicate.isNotUndefined(MutableRef.get(scope))) return
      // A Reorder item drags on its group's axis, read at each gesture's start: `true` to the spine (ADR-0020).
      const axisAt = opts.itemAxis()
      const axis = DragDefaults.dragAxisOf(config(), { dragAxis: axisAt })
      if (Predicate.isUndefined(axis)) return
      UndefinedOr.match(featureIn(provider, Keys.DragGesture), { onUndefined: () => warnMissing(provider, "drag", GestureFeatures.GESTURE_WORDS.drag), onDefined: (service) => start(service, axis, axisAt) })
    },
    dispose: () => UndefinedOr.map(MutableRef.get(scope), (owner) => OwnerScope.close(provider.runtime, owner, END_FAILED)),
  }
}
