import * as Probe from "@wardic/core/Probe"
import * as ScrollSource from "@wardic/core/ScrollSource"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { Atom, AtomRegistry } from "effect/reactivity"
import * as Feeds from "./feeds.ts"

const ZERO_BOUNDS: Probe.Bounds = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }
const VIEWPORT = { width: 1024, height: 768 }
/** A page that doesn't scroll: no range, and progress 1, as Motion reads a container with none. */
const STILL_SCROLL: ScrollSource.Scroll = { x: { current: 0, length: 0, progress: 1 }, y: { current: 0, length: 0, progress: 1 } }

/** A scripted in-view boolean as the Probe reports it, with no platform record. */
const toIntersection = (intersecting: boolean): Probe.Intersection => ({ intersecting })

/** Options for the static test Probe. */
// visible: #443 (`pageVisible` until #610). scroll: #234, a `ScrollSource` of its own since #518.
// intersection, an Input feed: #318.
export interface Options {
  readonly bounds?: Probe.Bounds
  readonly viewport?: { readonly width: number; readonly height: number }
  readonly prefersReducedMotion?: boolean
  /** Whether the Environment is shown: `true` when left out. */
  readonly visible?: boolean
  /** Every container's scroll, as the `ScrollSource` gives it: a page that doesn't scroll when left out. */
  readonly scroll?: ScrollSource.Scroll
  /**
   * Script of intersection (in-view) booleans replayed by `observeIntersection`, an **Input feed**
   * that ends after it. Mirrors the InputSource test harness: omitted (or empty) means it
   * emits nothing and ends.
   */
  readonly intersection?: ReadonlyArray<boolean>
}

/**
 * A static Probe: fixed bounds/viewport. `observeIntersection` replays the
 * optional `intersection` script to each subscriber (empty by default, so it
 * emits nothing); `observeResize` stays empty. With it, a `ScrollSource`
 * whose every container reads `scroll`, as the Probe's `scroll` did until #518.
 */
export const layer = (options: Options = {}): Layer.Layer<Probe.Probe | ScrollSource.ScrollSource> => {
  const { intersection = [], scroll = STILL_SCROLL } = options
  return Layer.mergeAll(
    Layer.succeed(Probe.Probe, {
      ...fixed(options),
      observeIntersection: () => Feeds.script(Arr.map(intersection, toIntersection)),
    }),
    scrollLayer(Atom.make(scroll)),
  )
}

/** Both Probes' fixed part: the bounds, the viewport, the preference and the page's visibility, each defaulted, and no resizes. */
const fixed = ({ bounds = ZERO_BOUNDS, viewport = VIEWPORT, prefersReducedMotion = false, visible = true }: Options) => ({
  measure: () => Effect.sync(() => bounds),
  viewport: Atom.make(viewport),
  prefersReducedMotion: Atom.make(prefersReducedMotion),
  visible: Atom.make(visible),
  observeResize: () => Stream.empty,
})

/** One scroll Atom for every container, target and offset (#234). */
const scrollLayer = (scroll: Atom.Atom<ScrollSource.Scroll>): Layer.Layer<ScrollSource.ScrollSource> =>
  Layer.succeed(ScrollSource.ScrollSource, { scroll: () => Effect.succeed(scroll) })

/**
 * A push-based Probe for tests that need to interleave intersection
 * (in-view/out-of-view) transitions with other effects on their own schedule —
 * mirroring {@link TestInput.pushable}. `observeIntersection(target)` subscribes
 * to a hub, so every subscriber sees the same transitions and only
 * events pushed *after* a subscription is live reach it. `pushIntersection`
 * doesn't yield: a subscriber handles the transition inside the push,
 * as `TestInput.pushable`'s do. `pushScroll` sets the scroll every container reads,
 * through the Environment's registry, as a scroll event would.
 * measure/viewport/prefersReducedMotion/observeResize behave as in {@link layer}.
 */
// The hub: #318. No yield: ADR-0032. Scroll: #234.
export const pushable = (options: Options = {}): Effect.Effect<{
  readonly layer: Layer.Layer<Probe.Probe | ScrollSource.ScrollSource>
  readonly pushIntersection: (inView: boolean) => Effect.Effect<void>
  readonly pushScroll: (scroll: ScrollSource.Scroll) => Effect.Effect<void, never, AtomRegistry.AtomRegistry>
}> =>
  Effect.sync(() => {
    const intersections = Feeds.hub<Probe.Intersection>()
    const { scroll = STILL_SCROLL } = options
    const scrollAtom = Atom.make(scroll)
    return {
      layer: Layer.mergeAll(Layer.succeed(Probe.Probe, { ...fixed(options), observeIntersection: () => intersections.feed }), scrollLayer(scrollAtom)),
      pushIntersection: (inView: boolean) => intersections.push(toIntersection(inView)),
      pushScroll: (next: ScrollSource.Scroll) => AtomRegistry.AtomRegistry.use((registry) => Effect.sync(() => registry.set(scrollAtom, next))),
    }
  })
