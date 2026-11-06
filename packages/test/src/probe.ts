import * as Probe from "@wardic/core/Probe"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { Atom, AtomRegistry } from "effect/reactivity"
import * as Feeds from "./feeds.ts"

const ZERO_BOUNDS: Probe.Bounds = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }
const VIEWPORT = { width: 1024, height: 768 }
/** A page that doesn't scroll: no range, and progress 1, as Motion reads a container with none. */
const STILL_SCROLL: Probe.Scroll = { x: { current: 0, length: 0, progress: 1 }, y: { current: 0, length: 0, progress: 1 } }

/** A scripted in-view boolean as the Probe reports it, with no platform record. */
const toIntersection = (intersecting: boolean): Probe.Intersection => ({ intersecting })

/** Options for the static test Probe. */
// pageVisible: #443. scroll: #234. intersection, an Input feed: #318.
export interface Options {
  readonly bounds?: Probe.Bounds
  readonly viewport?: { readonly width: number; readonly height: number }
  readonly prefersReducedMotion?: boolean
  /** Whether the page is shown: `true` when left out. */
  readonly pageVisible?: boolean
  /** Every container's scroll, as `scroll` gives it: a page that doesn't scroll when left out. */
  readonly scroll?: Probe.Scroll
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
 * emits nothing); `observeResize` stays empty.
 */
export const layer = (options: Options = {}): Layer.Layer<Probe.Probe> => {
  const { intersection = [], scroll = STILL_SCROLL } = options
  return Layer.succeed(Probe.Probe, {
    ...fixed(options, Atom.make(scroll)),
    observeIntersection: () => Feeds.script(Arr.map(intersection, toIntersection)),
  })
}

/**
 * Both Probes' fixed part: the bounds, the viewport, the preference and the page's visibility, each defaulted, no resizes,
 * and one scroll Atom for every container, target and offset (#234).
 */
const fixed = ({ bounds = ZERO_BOUNDS, viewport = VIEWPORT, prefersReducedMotion = false, pageVisible = true }: Options, scroll: Atom.Atom<Probe.Scroll>) => ({
  measure: () => Effect.sync(() => bounds),
  viewport: Atom.make(viewport),
  prefersReducedMotion: Atom.make(prefersReducedMotion),
  pageVisible: Atom.make(pageVisible),
  scroll: () => Effect.succeed(scroll),
  observeResize: () => Stream.empty,
})

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
  readonly layer: Layer.Layer<Probe.Probe>
  readonly pushIntersection: (inView: boolean) => Effect.Effect<void>
  readonly pushScroll: (scroll: Probe.Scroll) => Effect.Effect<void, never, AtomRegistry.AtomRegistry>
}> =>
  Effect.sync(() => {
    const intersections = Feeds.hub<Probe.Intersection>()
    const { scroll = STILL_SCROLL } = options
    const scrollAtom = Atom.make(scroll)
    return {
      layer: Layer.succeed(Probe.Probe, { ...fixed(options, scrollAtom), observeIntersection: () => intersections.feed }),
      pushIntersection: (inView: boolean) => intersections.push(toIntersection(inView)),
      pushScroll: (next: Probe.Scroll) => AtomRegistry.AtomRegistry.use((registry) => Effect.sync(() => registry.set(scrollAtom, next))),
    }
  })
