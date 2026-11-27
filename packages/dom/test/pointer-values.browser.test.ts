// dom's `PointerValues` (#833): the pointer over an element as Live values, at its own seam.
//
// - PV1: a mouse's move sets the place, the progress, the box's size and `inside` within the event's dispatch.
// - PV2: a leave turns `inside` off and keeps the place; a finger's move counts only when asked.
// - PV3: the Scope's close takes the listeners off: a move after it sets nothing.
// - PV4 (#979, row 14; ADR-0074): a dependent of `x` that throws: every value is still set at each move,
//   and it's reported once a run of throws, with its key, again after a clean move.
import { expect, layer } from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Logger from "effect/Logger"
import * as References from "effect/References"
import { AtomRegistry } from "effect/reactivity"
import * as Scope from "effect/Scope"
import { afterEach } from "vitest"
import { pointer } from "@wardic/dom/unstable/PointerValues"

// A failed case leaves its pad: the body is reset for the next.
afterEach(() => {
  document.body.innerHTML = ""
})

/** A 200 × 100 pad at (100, 100). */
const pad = (): { readonly element: HTMLElement; readonly remove: () => void } => {
  const element = document.createElement("div")
  element.style.cssText = "position: absolute; left: 100px; top: 100px; width: 200px; height: 100px"
  document.body.append(element)
  return { element, remove: () => element.remove() }
}

/** A pointer event of `type` at the viewport point, from a pointer of `pointerType`, dispatched on `element`. */
const dispatch = (element: Element, type: string, clientX: number, clientY: number, pointerType = "mouse"): void => {
  element.dispatchEvent(new PointerEvent(type, { clientX, clientY, pointerType, bubbles: true }))
}

layer(AtomRegistry.layer)("PointerValues (#833)", (it) => {
  it.effect("PV1: a mouse's move sets the place, the progress, the box's size and inside within the dispatch", () =>
    Effect.gen(function* () {
      const scene = pad()
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      const values = yield* pointer(scene.element).pipe(Scope.provide(scope))
      const heard: Array<number> = []
      const stop = registry.subscribe(values.xProgress, (at) => void heard.push(at))
      expect(registry.get(values.inside)).toBe(false)
      dispatch(scene.element, "pointermove", 150, 125)
      expect(heard, "within the dispatch, not a scheduler hop later").toEqual([0.25])
      expect(registry.get(values.x)).toBe(50)
      expect(registry.get(values.y)).toBe(25)
      expect(registry.get(values.yProgress)).toBe(0.25)
      expect(registry.get(values.width)).toBe(200)
      expect(registry.get(values.height)).toBe(100)
      expect(registry.get(values.inside)).toBe(true)
      stop()
      yield* Scope.close(scope, Exit.void)
      scene.remove()
    }))

  it.effect("PV2: a leave turns inside off and keeps the place; a finger's move counts only when asked", () =>
    Effect.gen(function* () {
      const scene = pad()
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      const values = yield* pointer(scene.element).pipe(Scope.provide(scope))
      dispatch(scene.element, "pointerenter", 150, 125)
      dispatch(scene.element, "pointerleave", 150, 125)
      expect(registry.get(values.inside)).toBe(false)
      expect(registry.get(values.x), "the place stays where the pointer left").toBe(50)
      // A finger: not among the default types.
      dispatch(scene.element, "pointermove", 250, 125, "touch")
      expect(registry.get(values.x)).toBe(50)
      expect(registry.get(values.inside)).toBe(false)
      const touched = yield* pointer(scene.element, { types: ["touch"] }).pipe(Scope.provide(scope))
      dispatch(scene.element, "pointerdown", 250, 125, "touch")
      expect(registry.get(touched.x), "a finger's press places it, when asked").toBe(150)
      expect(registry.get(touched.xProgress)).toBe(0.75)
      expect(registry.get(touched.inside)).toBe(true)
      yield* Scope.close(scope, Exit.void)
      scene.remove()
    }))

  it.effect("PV3: the Scope's close takes the listeners off", () =>
    Effect.gen(function* () {
      const scene = pad()
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Scope.make()
      const values = yield* pointer(scene.element).pipe(Scope.provide(scope))
      dispatch(scene.element, "pointermove", 150, 125)
      expect(registry.get(values.xProgress)).toBe(0.25)
      yield* Scope.close(scope, Exit.void)
      dispatch(scene.element, "pointermove", 250, 125)
      expect(registry.get(values.xProgress), "nothing heard after the close").toBe(0.25)
      scene.remove()
    }))

  it.effect("PV4 (#979, row 14): a dependent of x that throws: every value still set, reported once a run with its key", () =>
    Effect.gen(function* () {
      const logged: Array<{ readonly message: string; readonly key: unknown }> = []
      const logger = Logger.make(({ message, fiber }) => {
        logged.push({ message: String((message as ReadonlyArray<unknown>)[0]), key: fiber.getRef(References.CurrentLogAnnotations).key })
      })
      yield* Effect.gen(function* () {
        const scene = pad()
        const registry = yield* AtomRegistry.AtomRegistry
        const scope = yield* Scope.make()
        const values = yield* pointer(scene.element).pipe(Scope.provide(scope))
        const stop = registry.subscribe(values.x, (x) => {
          if (Arr.contains([50, 70, 110], x)) throw new Error(`x's dependent threw at ${x}`)
        })
        const seen: Array<string> = []
        // x: 50 and 70 throw, 90 is clean, 110 throws again.
        Arr.forEach([150, 170, 190, 210], (clientX) => {
          dispatch(scene.element, "pointermove", clientX, 125)
          const v = (atom: Parameters<typeof registry.get>[0]): unknown => registry.get(atom)
          seen.push([v(values.x), v(values.y), v(values.xProgress), v(values.yProgress), v(values.width), v(values.height), v(values.inside)].join(" "))
        })
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)))
        expect(seen, "every value set at each move").toEqual(["50 25 0.25 0.25 200 100 true", "70 25 0.35 0.25 200 100 true", "90 25 0.45 0.25 200 100 true", "110 25 0.55 0.25 200 100 true"])
        const failed = Arr.filter(logged, ({ message }) => message === "wardic.pointer: its dependent failed")
        expect(failed, "once for 50 and 70, again for 110 after 90's clean move").toHaveLength(2)
        expect(Arr.map(failed, ({ key }) => key), "its key").toEqual(["x", "x"])
        stop()
        yield* Scope.close(scope, Exit.void)
        scene.remove()
      }).pipe(Effect.provide(Logger.layer([logger])))
    }))
})
