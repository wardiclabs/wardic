// `Probe.scroll` in a real browser (#234, ADR-0043 *Amendment (#233, #234)*): a container's scroll as
// an Atom, set within its events.
//
// - PS1: set inside the scroll event: a reader hears it before `dispatchEvent` returns, and the
//   values are the container's position, range and progress.
// - PS2: the page's scroll is the window's event, and its scroller's numbers.
// - PS3: a container's resize changes its range, and the Atom with it (a ResizeObserver delivery).
// - PS4: a target's progress through its offsets, each edge kind resolved as Motion resolves it:
//   names, fractions, px, %, vh, a lone edge, more than two stops, and the presets.
// - PS5: one listener set a container: two readers add one `scroll` listener, and the last one
//   out removes it.
// - PS6: an unchanged scroll isn't set again: its readers hear nothing.
import * as Probe from "@wardic/core/Probe"
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import { AtomRegistry } from "effect/reactivity"
import * as Scope from "effect/Scope"
import { ProbeDomLive } from "../src/internal/probe.ts"

const TestLayer = Layer.provideMerge(ProbeDomLive, AtomRegistry.layer)

/** A 200 × 100 scroll box holding a 1000px-tall column, an 80px-tall target at 400px down it. */
const scene = () => {
  const box = document.createElement("div")
  box.style.cssText = "position: relative; width: 200px; height: 100px; overflow: auto"
  const column = document.createElement("div")
  column.style.cssText = "position: relative; width: 600px; height: 1000px"
  const target = document.createElement("div")
  target.style.cssText = "position: absolute; left: 0; top: 400px; width: 50px; height: 80px"
  column.append(target)
  box.append(column)
  document.body.append(box)
  return { box, target, remove: () => box.remove() }
}

/** Scroll `box` to `top` and fire its event at once, as a synthetic dispatch runs its listeners. */
const scrollTo = (box: HTMLElement, top: number): void => {
  box.scrollTop = top
  box.dispatchEvent(new Event("scroll"))
}

layer(TestLayer)("Probe.scroll (#234)", (it) => {
  it.effect("PS1: set inside the scroll event, with the container's position, range and progress", () =>
    Effect.gen(function* () {
      const s = scene()
      const probe = yield* Probe.Probe
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      const atom = yield* probe.scroll({ container: s.box }).pipe(Scope.provide(scope))
      const heard: Array<number> = []
      const stop = registry.subscribe(atom, (v) => void heard.push(v.y.current))
      scrollTo(s.box, 450)
      expect(heard, "within the dispatch, not a scheduler hop later").toEqual([450])
      expect(registry.get(atom)).toEqual({
        x: { current: 0, length: 400, progress: 0 },
        y: { current: 450, length: 900, progress: 0.5 },
      })
      stop()
      yield* Scope.close(scope, Exit.void)
      s.remove()
    }))

  it.effect("PS2: the page's scroll is the window's event and its scroller's numbers", () =>
    Effect.gen(function* () {
      const tall = document.createElement("div")
      tall.style.cssText = "height: 3000px"
      document.body.append(tall)
      const probe = yield* Probe.Probe
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      const atom = yield* probe.scroll().pipe(Scope.provide(scope))
      const page = document.scrollingElement as Element
      window.scrollTo(0, 600)
      window.dispatchEvent(new Event("scroll"))
      const length = page.scrollHeight - page.clientHeight
      expect(registry.get(atom).y).toEqual({ current: 600, length, progress: 600 / length })
      window.scrollTo(0, 0)
      yield* Scope.close(scope, Exit.void)
      tall.remove()
    }))

  it.effect("PS3: a container's resize changes its range, and the Atom with it", () =>
    Effect.gen(function* () {
      const s = scene()
      const probe = yield* Probe.Probe
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      const atom = yield* probe.scroll({ container: s.box }).pipe(Scope.provide(scope))
      expect(registry.get(atom).y.length).toBe(900)
      s.box.style.height = "200px"
      // The ResizeObserver delivers after layout, in the next rendering update.
      yield* Effect.promise(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      expect(registry.get(atom).y.length).toBe(800)
      yield* Scope.close(scope, Exit.void)
      s.remove()
    }))

  it.effect("PS4: a target's progress through its offsets, each edge resolved as Motion resolves it", () =>
    Effect.gen(function* () {
      const s = scene()
      const probe = yield* Probe.Probe
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      // The target sits at 400 and is 80 tall; the box shows 100.
      const read = (offset: Probe.ScrollOffset | undefined, top: number) =>
        Effect.gen(function* () {
          const options: Probe.ScrollOptions = Object.assign({ container: s.box, target: s.target }, offset !== undefined && { offset })
          const atom = yield* probe.scroll(options).pipe(Scope.provide(scope))
          scrollTo(s.box, top)
          return registry.get(atom).y.progress
        })
      // "start end" → "end start": from 400 − 100 = 300 to 400 + 80 = 480.
      const through: Probe.ScrollOffset = ["start end", "end start"]
      expect(yield* read(through, 300)).toBe(0)
      expect(yield* read(through, 390)).toBeCloseTo(0.5, 9)
      expect(yield* read(through, 480)).toBe(1)
      expect(yield* read(through, 600), "clamped past the last stop").toBe(1)
      // No offset with a target: All, from the target's start at the box's start (400) to its end at the box's end (380)...
      // descending, so read reversed as Motion's interpolate reads it: 380 → 1, 400 → 0.
      expect(yield* read(undefined, 390)).toBeCloseTo(0.5, 9)
      // Fractions, px, %, a lone px edge (against the container's start), vh.
      expect(yield* read([[0, 0], [1, 0]], 440)).toBeCloseTo(0.5, 9) // 400 → 480
      expect(yield* read(["0px 0px", "80px 0px"], 440)).toBeCloseTo(0.5, 9)
      expect(yield* read(["0% 0%", "100% 0%"], 440)).toBeCloseTo(0.5, 9)
      expect(yield* read(["-50px", "50px"], 400)).toBeCloseTo(0.5, 9) // 350 → 450
      // 400 → 400 + 10vh, read where the box landed (a scroll position snaps to whole pixels).
      const vh = document.documentElement.clientHeight / 100
      const atVh = yield* read(["0px 0px", "0px -10vh"], Math.round(400 + 5 * vh))
      expect(atVh).toBeCloseTo((s.box.scrollTop - 400) / (10 * vh), 9)
      // Three stops: 0, 0.5, 1 at 300, 340, 480.
      expect(yield* read(["start end", "40px end", "end start"], 340)).toBeCloseTo(0.5, 9)
      expect(yield* read(["start end", "40px end", "end start"], 410)).toBeCloseTo(0.75, 9)
      // Presets: Enter runs while the target comes in, 300 → 380.
      expect(yield* read(Probe.ScrollOffsets.Enter, 340)).toBeCloseTo(0.5, 9)
      expect(yield* read(Probe.ScrollOffsets.Exit, 440)).toBeCloseTo(0.5, 9) // 400 → 480
      yield* Scope.close(scope, Exit.void)
      s.remove()
    }))

  it.effect("PS5: one listener set a container, removed with its last reader", () =>
    Effect.gen(function* () {
      const s = scene()
      const added: Array<string> = []
      const removed: Array<string> = []
      const add = s.box.addEventListener.bind(s.box)
      const remove = s.box.removeEventListener.bind(s.box)
      s.box.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions) => {
        added.push(type)
        add(type, listener, options)
      }) as typeof s.box.addEventListener
      s.box.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: EventListenerOptions) => {
        removed.push(type)
        remove(type, listener, options)
      }) as typeof s.box.removeEventListener
      const probe = yield* Probe.Probe
      const a = yield* Scope.make()
      const b = yield* Scope.make()
      yield* probe.scroll({ container: s.box }).pipe(Scope.provide(a))
      yield* probe.scroll({ container: s.box, target: s.target }).pipe(Scope.provide(b))
      expect(added).toEqual(["scroll"])
      yield* Scope.close(a, Exit.void)
      expect(removed, "still read").toEqual([])
      yield* Scope.close(b, Exit.void)
      expect(removed).toEqual(["scroll"])
      s.remove()
    }))

  it.effect("PS6: an unchanged scroll isn't set again", () =>
    Effect.gen(function* () {
      const s = scene()
      const probe = yield* Probe.Probe
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      const atom = yield* probe.scroll({ container: s.box }).pipe(Scope.provide(scope))
      let heard = 0
      const stop = registry.subscribe(atom, () => void heard++)
      scrollTo(s.box, 100)
      s.box.dispatchEvent(new Event("scroll"))
      window.dispatchEvent(new Event("resize"))
      expect(heard).toBe(1)
      stop()
      yield* Scope.close(scope, Exit.void)
      s.remove()
    }))
})
