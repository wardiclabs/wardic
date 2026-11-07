// The DOM's `ScrollSource` in a real browser (#234, ADR-0043 *Amendment (#233, #234)*; the Probe's
// `scroll` until #518): a container's scroll as an Atom, set within its events.
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
// - PS8: a container's content grows with the scroll still: its range and progress follow, a frame
//   later (#239, the ResizeObserver's delivery).
// - PS9: the page with a body sized to the window: a child added, then grown, moves its range; with
//   a body of its content's height, text added straight to it does.
// - PS10: a target moves as content above it grows, and resizes on its own: its progress follows.
// - PS11: a child added after the reader started is watched, a removed one changes the range, a
//   reader whose target is a child leaves it watched as it goes, the last reader out disconnects both
//   observers, and an idle container is never read.
// - PS12 (#395): a target in a `position: static` container reads the progress the same layout gives
//   with a positioned one: straight in it, in a positioned wrapper, under static ancestors, with
//   `<body>` the offset parent, in a table cell (a positioned target's chain leaves at an ancestor
//   above the container's own offset parent), a fixed target (from the viewport in either, Motion's),
//   on x, and an SVG shape. The positioned one's own is
//   pinned to the box; the page keeps its document offsets, a border on `<html>` not taken off.
// - PS13 (#618): a container its last reader let go of, its element off the page, is collected: the
//   map of containers (`SharedSource.counted` since #518) keeps no element it has released.
import * as ScrollSource from "@wardic/core/ScrollSource"
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import { AtomRegistry } from "effect/reactivity"
import * as Scope from "effect/Scope"
import * as DomScrollSource from "../src/DomScrollSource.ts"
import * as ScrollOffset from "../src/ScrollOffset.ts"
import { commands } from "vitest/browser"
import "./browser-commands.ts"

const TestLayer = Layer.provideMerge(DomScrollSource.layer, AtomRegistry.layer)

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

/**
 * #395's layouts, each with its container at `position`: a 200 × 100 box with a 7px border and 11px
 * padding, 333px of content above an 80px target (on x, beside it), the box 150px into a parent.
 */
const STATIC_LAYOUTS: Record<string, { readonly axis: "x" | "y"; readonly html: (position: string) => string }> = {
  "straight in it": {
    axis: "y",
    html: (position) =>
      `<main style="position: relative; padding: 5px"><div data-box style="position: ${position}; width: 200px; height: 100px; overflow: auto; border: 7px solid; padding: 11px; margin-top: 150px"><div style="height: 333px"></div><div data-target style="height: 80px"></div><div style="height: 600px"></div></div></main>`,
  },
  "in a positioned wrapper": {
    axis: "y",
    html: (position) =>
      `<main style="position: relative; padding: 5px"><div data-box style="position: ${position}; width: 200px; height: 100px; overflow: auto; border: 7px solid; padding: 11px; margin-top: 150px"><div style="height: 333px"></div><div style="position: relative; margin-top: 40px; padding-top: 9px"><div data-target style="height: 80px"></div></div><div style="height: 600px"></div></div></main>`,
  },
  "under static ancestors": {
    axis: "y",
    html: (position) =>
      `<main style="position: relative; padding: 5px"><div style="padding: 23px; border: 3px solid"><div style="margin-left: 17px"><div data-box style="position: ${position}; width: 200px; height: 100px; overflow: auto; border: 7px solid; padding: 11px; margin-top: 150px"><div style="height: 333px"></div><div data-target style="height: 80px"></div><div style="height: 600px"></div></div></div></div></main>`,
  },
  "with <body> the offset parent": {
    axis: "y",
    html: (position) =>
      `<div style="padding: 13px"><div data-box style="position: ${position}; width: 200px; height: 100px; overflow: auto; border: 7px solid; padding: 11px; margin-top: 150px"><div style="height: 333px"></div><div data-target style="height: 80px"></div><div style="height: 600px"></div></div></div>`,
  },
  "in a table cell, the target in a positioned wrapper": {
    axis: "y",
    html: (position) =>
      `<main style="position: relative; padding: 5px"><table style="border-spacing: 6px; margin-top: 30px"><tr><td style="padding: 9px"><div data-box style="position: ${position}; width: 200px; height: 100px; overflow: auto; border: 7px solid; padding: 11px; margin-top: 150px"><div style="height: 333px"></div><div style="position: relative; padding-top: 9px"><div data-target style="height: 80px"></div></div><div style="height: 600px"></div></div></td></tr></table></main>`,
  },
  "a fixed target, measured from the viewport in either": {
    axis: "y",
    html: (position) =>
      `<main style="position: relative; padding: 5px"><div data-box style="position: ${position}; width: 200px; height: 100px; overflow: auto; border: 7px solid; padding: 11px; margin-top: 150px"><div style="height: 333px"></div><div data-target style="position: fixed; top: 50px; left: 0; width: 50px; height: 80px"></div><div style="height: 600px"></div></div></main>`,
  },
  "on x": {
    axis: "x",
    html: (position) =>
      `<main style="position: relative; padding: 5px"><div data-box style="position: ${position}; display: flex; width: 100px; height: 200px; overflow: auto; border: 7px solid; padding: 11px; margin-left: 150px"><div style="flex: none; width: 333px"></div><div data-target style="flex: none; width: 80px"></div><div style="flex: none; width: 600px"></div></div></main>`,
  },
  "an SVG shape": {
    axis: "y",
    html: (position) =>
      `<main style="position: relative; padding: 5px"><div data-box style="position: ${position}; width: 200px; height: 100px; overflow: auto; border: 7px solid; padding: 11px; margin-top: 150px"><div style="height: 333px"></div><div><svg width="100" height="200" style="display: block"><rect data-target y="40" width="50" height="80"></rect></svg></div><div style="height: 600px"></div></div></main>`,
  },
}

/** `n` animation frames: a ResizeObserver delivers in the frame after a change's layout. */
const frames = (n: number) =>
  Effect.promise(() => new Promise<void>((resolve) => {
    const next = (left: number): void => {
      if (left === 0) return resolve()
      requestAnimationFrame(() => next(left - 1))
    }
    next(n)
  }))

/** Scroll `box` to `top` and fire its event at once, as a synthetic dispatch runs its listeners. */
const scrollTo = (box: HTMLElement, top: number): void => {
  box.scrollTop = top
  box.dispatchEvent(new Event("scroll"))
}

layer(TestLayer)("ScrollSource on the DOM (#234)", (it) => {
  it.effect("PS1: set inside the scroll event, with the container's position, range and progress", () =>
    Effect.gen(function* () {
      const s = scene()
      const source = yield* ScrollSource.ScrollSource
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      const atom = yield* source.scroll({ container: s.box }).pipe(Scope.provide(scope))
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
      const source = yield* ScrollSource.ScrollSource
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      const atom = yield* source.scroll().pipe(Scope.provide(scope))
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
      const source = yield* ScrollSource.ScrollSource
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      const atom = yield* source.scroll({ container: s.box }).pipe(Scope.provide(scope))
      expect(registry.get(atom).y.length).toBe(900)
      // Past the observers' first delivery (#239), so only the resize below is read.
      yield* frames(3)
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
      const source = yield* ScrollSource.ScrollSource
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      // The target sits at 400 and is 80 tall; the box shows 100.
      const read = (offset: ScrollOffset.ScrollOffset | undefined, top: number) =>
        Effect.gen(function* () {
          const options: ScrollSource.Options = Object.assign({ container: s.box, target: s.target }, offset !== undefined && { offset })
          const atom = yield* source.scroll(options).pipe(Scope.provide(scope))
          scrollTo(s.box, top)
          return registry.get(atom).y.progress
        })
      // "start end" → "end start": from 400 − 100 = 300 to 400 + 80 = 480.
      const through: ScrollOffset.ScrollOffset = ["start end", "end start"]
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
      expect(yield* read(ScrollOffset.Enter, 340)).toBeCloseTo(0.5, 9)
      expect(yield* read(ScrollOffset.Exit, 440)).toBeCloseTo(0.5, 9) // 400 → 480
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
      const source = yield* ScrollSource.ScrollSource
      const a = yield* Scope.make()
      const b = yield* Scope.make()
      yield* source.scroll({ container: s.box }).pipe(Scope.provide(a))
      yield* source.scroll({ container: s.box, target: s.target }).pipe(Scope.provide(b))
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
      const source = yield* ScrollSource.ScrollSource
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      const atom = yield* source.scroll({ container: s.box }).pipe(Scope.provide(scope))
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

  it.effect("PS8: a container's content grows with the scroll still: its range and progress follow", () =>
    Effect.gen(function* () {
      const s = scene()
      const column = s.box.firstElementChild as HTMLElement
      const source = yield* ScrollSource.ScrollSource
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      const atom = yield* source.scroll({ container: s.box }).pipe(Scope.provide(scope))
      // An observer delivers once as it starts: past that, only a change reads anything.
      yield* frames(3)
      scrollTo(s.box, 450)
      expect(registry.get(atom).y).toEqual({ current: 450, length: 900, progress: 0.5 })
      // The browser's own scroll event for that scrollTop comes a frame later: past it too.
      yield* frames(3)
      column.style.height = "1900px"
      yield* frames(2)
      expect(registry.get(atom).y, "no scroll event: the content's resize").toEqual({ current: 450, length: 1800, progress: 0.25 })
      yield* Scope.close(scope, Exit.void)
      s.remove()
    }))

  it.effect("PS9: the page with a body sized to the window: a child added, then grown, moves its range", () =>
    Effect.gen(function* () {
      const html = document.documentElement
      const before = { html: html.style.height, body: document.body.style.height }
      html.style.height = "100%"
      document.body.style.height = "100%"
      const source = yield* ScrollSource.ScrollSource
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      const atom = yield* source.scroll().pipe(Scope.provide(scope))
      const page = document.scrollingElement as Element
      const tall = document.createElement("div")
      tall.style.cssText = "height: 3000px"
      document.body.append(tall)
      yield* frames(2)
      expect(registry.get(atom).y.length, "a child added after the reader started").toBe(page.scrollHeight - page.clientHeight)
      const added = registry.get(atom).y.length
      expect(added).toBeGreaterThan(2000)
      tall.style.height = "4000px"
      yield* frames(2)
      expect(registry.get(atom).y.length - added, "that child grown").toBe(1000)
      tall.remove()
      // A body of its content's height that grows by text alone: only the body's own box shows it.
      html.style.height = before.html
      document.body.style.height = before.body
      yield* frames(3)
      const grown = registry.get(atom).y.length
      const text = document.createTextNode("")
      document.body.append(text)
      yield* frames(3)
      text.textContent = Array.from({ length: 400 }, () => "line").join(" \n")
      document.body.style.whiteSpace = "pre"
      yield* frames(3)
      expect(registry.get(atom).y.length, "text added straight to the body").toBe(page.scrollHeight - page.clientHeight)
      expect(registry.get(atom).y.length).toBeGreaterThan(grown)
      yield* Scope.close(scope, Exit.void)
      text.remove()
      document.body.style.whiteSpace = ""
    }))

  it.effect("PS10: a target moves as content above it grows, and resizes on its own: its progress follows", () =>
    Effect.gen(function* () {
      // A column of auto height: a spacer, then the target, then filler.
      const box = document.createElement("div")
      box.style.cssText = "position: relative; width: 200px; height: 100px; overflow: auto"
      const column = document.createElement("div")
      const spacer = document.createElement("div")
      spacer.style.height = "300px"
      const target = document.createElement("div")
      target.style.cssText = "width: 50px; height: 80px"
      const filler = document.createElement("div")
      filler.style.height = "600px"
      column.append(spacer, target, filler)
      box.append(column)
      document.body.append(box)
      const source = yield* ScrollSource.ScrollSource
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      // "start end" → "end start": from where the target's top meets the box's bottom to where its bottom meets the box's top.
      const atom = yield* source.scroll({ container: box, target, offset: ["start end", "end start"] }).pipe(Scope.provide(scope))
      yield* frames(3)
      scrollTo(box, 290)
      // 200 → 380 (300 − 100 to 300 + 80): 290 is halfway.
      expect(registry.get(atom).y.progress).toBeCloseTo(0.5, 9)
      yield* frames(3)
      spacer.style.height = "390px"
      yield* frames(2)
      // 290 → 470: 290 is at its start.
      expect(registry.get(atom).y.progress, "moved down by what grew above it").toBeCloseTo(0, 9)
      // A target in a column of fixed height: its own resize, with nothing else moving.
      column.style.height = "1000px"
      yield* frames(2)
      scrollTo(box, 380)
      expect(registry.get(atom).y.progress).toBeCloseTo(0.5, 9)
      yield* frames(3)
      target.style.height = "260px"
      yield* frames(2)
      // 290 → 650: 380 is a quarter of the way.
      expect(registry.get(atom).y.progress, "the target's own resize").toBeCloseTo(0.25, 9)
      yield* Scope.close(scope, Exit.void)
      box.remove()
    }))

  it.effect("PS11: a child added later is watched, a removed one changes the range, the last reader out disconnects both observers, an idle container is never read", () =>
    Effect.gen(function* () {
      const s = scene()
      const source = yield* ScrollSource.ScrollSource
      const registry = yield* AtomRegistry.AtomRegistry
      const disconnects = { resize: 0, mutation: 0 }
      const resizeDisconnect = ResizeObserver.prototype.disconnect
      const mutationDisconnect = MutationObserver.prototype.disconnect
      ResizeObserver.prototype.disconnect = function () {
        disconnects.resize++
        return resizeDisconnect.call(this)
      }
      MutationObserver.prototype.disconnect = function () {
        disconnects.mutation++
        return mutationDisconnect.call(this)
      }
      const scope = yield* Scope.make()
      const atom = yield* source.scroll({ container: s.box }).pipe(Scope.provide(scope))
      let heard = 0
      const stop = registry.subscribe(atom, () => void heard++)
      yield* frames(6)
      expect(heard, "idle: nothing read changes").toBe(0)
      const late = document.createElement("div")
      late.style.height = "500px"
      s.box.append(late)
      yield* frames(2)
      expect(registry.get(atom).y.length, "the added child's height").toBe(1400)
      late.style.height = "900px"
      yield* frames(2)
      expect(registry.get(atom).y.length, "the added child is watched").toBe(1800)
      late.remove()
      yield* frames(2)
      expect(registry.get(atom).y.length, "its removal").toBe(900)
      // A second reader whose target is one of the children: its going leaves the child watched.
      const column = s.box.firstElementChild as HTMLElement
      const second = yield* Scope.make()
      yield* source.scroll({ container: s.box, target: column }).pipe(Scope.provide(second))
      yield* Scope.close(second, Exit.void)
      yield* frames(2)
      column.style.height = "1500px"
      yield* frames(2)
      expect(registry.get(atom).y.length, "the child still watched for the first reader").toBe(1400)
      stop()
      yield* Scope.close(scope, Exit.void)
      expect(disconnects).toEqual({ resize: 1, mutation: 1 })
      ResizeObserver.prototype.disconnect = resizeDisconnect
      MutationObserver.prototype.disconnect = mutationDisconnect
      s.remove()
    }))

  it.effect("PS12: a target in a static container reads the progress a positioned one gives (#395)", () =>
    Effect.gen(function* () {
      const source = yield* ScrollSource.ScrollSource
      const registry = yield* AtomRegistry.AtomRegistry
      const through: ScrollOffset.ScrollOffset = ["start end", "end start"]
      /** The progress at each of `at` with the layout's container at `position`. */
      const progressOf = (layout: (typeof STATIC_LAYOUTS)[string], position: string, at: ReadonlyArray<number>) =>
        Effect.gen(function* () {
          const host = document.createElement("div")
          host.innerHTML = layout.html(position)
          document.body.append(host)
          const box = host.querySelector<HTMLElement>("[data-box]")
          const target = host.querySelector("[data-target]")
          if (box === null || target === null) return yield* Effect.die("no box or target")
          const scope = yield* Scope.make()
          const atom = yield* source.scroll({ container: box, target, offset: through, axis: layout.axis }).pipe(Scope.provide(scope))
          const read = at.map((to) => {
            if (layout.axis === "x") box.scrollLeft = to
            else box.scrollTop = to
            box.dispatchEvent(new Event("scroll"))
            return registry.get(atom)[layout.axis].progress
          })
          yield* Scope.close(scope, Exit.void)
          host.remove()
          return read
        })
      const at = [0, 150, 300]
      // The positioned box's own, pinned: the target is 11 + 333 = 344 into the box's padding edge, and
      // the box shows 122 (100 and its padding), so "start end" → "end start" runs 222 → 424.
      expect(yield* progressOf(STATIC_LAYOUTS["straight in it"]!, "relative", at)).toEqual([0, 0, (300 - 222) / 202])
      // A fixed target, from the viewport (Motion's): 50 down it, so "start end" → "end start" runs −72 → 130.
      expect(yield* progressOf(STATIC_LAYOUTS["a fixed target, measured from the viewport in either"]!, "relative", at)).toEqual([72 / 202, 1, 1])
      for (const [name, layout] of Object.entries(STATIC_LAYOUTS)) {
        const positioned = yield* progressOf(layout, "relative", at)
        const still = yield* progressOf(layout, "static", at)
        expect(positioned.some((p) => p > 0 && p < 1), `${name}: a scroll through the target`).toBe(true)
        expect(still, `${name}: static reads as positioned`).toEqual(positioned)
      }
      // The page keeps its document offsets: a border on <html> isn't taken off, as it would be a box's.
      document.documentElement.style.border = "5px solid"
      const target = document.createElement("div")
      target.style.cssText = "margin-top: 1500px; height: 80px"
      const tail = document.createElement("div")
      tail.style.cssText = "height: 3000px"
      document.body.append(target, tail)
      const scope = yield* Scope.make()
      const atom = yield* source.scroll({ target, offset: ["start start", "end start"] }).pipe(Scope.provide(scope))
      const top = target.getBoundingClientRect().top + window.scrollY
      window.scrollTo(0, Math.round(top + 40))
      window.dispatchEvent(new Event("scroll"))
      expect(registry.get(atom).y.progress, "the page's target from its document top").toBeCloseTo((window.scrollY - top) / 80, 9)
      window.scrollTo(0, 0)
      yield* Scope.close(scope, Exit.void)
      target.remove()
      tail.remove()
      document.documentElement.style.border = ""
    }))

  it.effect("PS13: a released container's element isn't kept (#618)", () =>
    Effect.gen(function* () {
      const source = yield* ScrollSource.ScrollSource
      // Each read in a call of its own, so no local of the test's holds its element after.
      const readAndRelease = Effect.fnUntraced(function* () {
        const s = scene()
        const scope = yield* Scope.make()
        yield* source.scroll({ container: s.box, target: s.target }).pipe(Scope.provide(scope))
        yield* Scope.close(scope, Exit.void)
        s.remove()
        return new WeakRef(s.box)
      })
      const refs = [yield* readAndRelease(), yield* readAndRelease(), yield* readAndRelease()]
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)))
      yield* Effect.promise(() => commands.collectGarbage())
      expect(refs.filter((ref) => ref.deref() !== undefined).length, "every released container collected").toBe(0)
    }))
})
