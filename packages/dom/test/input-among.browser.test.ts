// The DOM's feeds over many targets (#665's PR 5, Q56): `pointerAmong` and `focusAmong`, one window
// listener set for every target `memberOf` names, each target told what its own feed would tell it.
//
// - IA1: enters and leaves from `pointerover` and `pointerout`: a move between a member's children tells
//   nothing; nested members each once, enters outermost first and leaves innermost first; a node no
//   member's tells nothing.
// - IA2: a down on a member's child is its down, and its inner member's first; held, its moves and its
//   release elsewhere reach it, off the target, until the release; the page-wide listeners go with it.
// - IA3: two watches with the same `memberOf` share one listener set, gone with the last; none per member.
// - IA4: a member's own focus is its own, one inside it isn't; each member on the path hears it.
import * as InputSource from "@wardic/core/InputSource"
import { expect, layer } from "@effect/vitest"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { constVoid } from "effect/Function"
import * as UndefinedOr from "effect/UndefinedOr"
import { InputDomLive } from "../src/internal/input.ts"

const pointerEvent = (type: string, init: PointerEventInit = {}): PointerEvent =>
  new PointerEvent(type, { pointerType: "mouse", isPrimary: true, pointerId: 1, bubbles: true, ...init })

/** Members `outer` (holding `inner` and a plain child) and `b`, each with a child, on the page; `memberOf` names the members. */
const page = Effect.acquireRelease(
  Effect.sync(() => {
    const root = document.createElement("div")
    const outer = document.createElement("div")
    const child = document.createElement("span")
    const inner = document.createElement("div")
    const innerChild = document.createElement("span")
    const b = document.createElement("div")
    const bChild = document.createElement("span")
    const plain = document.createElement("div")
    inner.append(innerChild)
    outer.append(child, inner)
    b.append(bChild)
    root.append(outer, b, plain)
    document.body.append(root)
    const members = new Map<unknown, string>([[outer, "outer"], [inner, "inner"], [b, "b"]])
    const memberOf = (node: unknown): unknown => UndefinedOr.match(members.get(node), { onUndefined: () => undefined, onDefined: () => node })
    const nameOf = (target: unknown): string => UndefinedOr.getOrThrow(members.get(target))
    return { root, outer, child, inner, innerChild, b, bChild, plain, memberOf, nameOf }
  }),
  ({ root }) => Effect.sync(() => root.remove()),
)

/** Count the window's `pointer*` and `focus*` listeners added and removed while it runs. */
const spyWindow = () => {
  let adds = 0
  let removes = 0
  const realAdd = window.addEventListener.bind(window)
  const realRemove = window.removeEventListener.bind(window)
  const counts = (type: string): boolean => type.startsWith("pointer") || type.startsWith("focus")
  window.addEventListener = ((...args: Parameters<typeof realAdd>) => {
    if (counts(args[0])) adds++
    return realAdd(...args)
  }) as typeof window.addEventListener
  window.removeEventListener = ((...args: Parameters<typeof realRemove>) => {
    if (counts(args[0])) removes++
    return realRemove(...args)
  }) as typeof window.removeEventListener
  return {
    adds: () => adds,
    removes: () => removes,
    restore: () => {
      window.addEventListener = realAdd
      window.removeEventListener = realRemove
    },
  }
}

layer(InputDomLive)("InputDomLive: feeds over many targets (#665)", (it) => {
  it.effect("IA1: enters and leaves from pointerover and pointerout, nested members each once", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const p = yield* page
      const heard: Array<string> = []
      const stop = UndefinedOr.getOrThrow(input.pointerAmong)(p.memberOf)(({ target, event }) => heard.push(`${event.type}:${p.nameOf(target)}`), constVoid)
      // In from the plain element, onto outer's child; then within outer, to inner.
      p.child.dispatchEvent(pointerEvent("pointerover", { relatedTarget: p.plain }))
      p.child.dispatchEvent(pointerEvent("pointerout", { relatedTarget: p.innerChild }))
      p.innerChild.dispatchEvent(pointerEvent("pointerover", { relatedTarget: p.child }))
      expect(heard).toEqual(["enter:outer", "enter:inner"])
      // Within inner: nothing. Then from inner straight to b.
      p.innerChild.dispatchEvent(pointerEvent("pointerout", { relatedTarget: p.inner }))
      p.inner.dispatchEvent(pointerEvent("pointerover", { relatedTarget: p.innerChild }))
      p.inner.dispatchEvent(pointerEvent("pointerout", { relatedTarget: p.bChild }))
      p.bChild.dispatchEvent(pointerEvent("pointerover", { relatedTarget: p.inner }))
      expect(heard).toEqual(["enter:outer", "enter:inner", "leave:inner", "leave:outer", "enter:b"])
      // Onto the plain element: b leaves, and nothing enters.
      p.bChild.dispatchEvent(pointerEvent("pointerout", { relatedTarget: p.plain }))
      p.plain.dispatchEvent(pointerEvent("pointerover", { relatedTarget: p.bChild }))
      expect(heard.slice(5)).toEqual(["leave:b"])
      stop()
    }).pipe(Effect.scoped))

  it.effect("IA2: a down on a member's child is its down; held, its moves and release elsewhere reach it until the release", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const p = yield* page
      const heard: Array<string> = []
      const stop = UndefinedOr.getOrThrow(input.pointerAmong)(p.memberOf)(
        ({ target, event }) => heard.push(`${event.type}:${p.nameOf(target)}@${event.x}${Bool.match(event.onTarget, { onTrue: () => "", onFalse: () => " off" })}`),
        constVoid,
      )
      p.innerChild.dispatchEvent(pointerEvent("pointerdown", { clientX: 1, buttons: 1 }))
      expect(heard).toEqual(["down:inner@1", "down:outer@1"])
      document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 50, buttons: 1 }))
      p.plain.dispatchEvent(pointerEvent("pointerup", { clientX: 60 }))
      expect(heard.slice(2)).toEqual(["move:inner@50 off", "move:outer@50 off", "up:inner@60 off", "up:outer@60 off"])
      // Let go: a later move reaches neither.
      yield* Effect.promise(() => Promise.resolve())
      document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 70, buttons: 0 }))
      expect(heard).toHaveLength(6)
      stop()
    }).pipe(Effect.scoped))

  it.effect("IA3: two watches with the same memberOf share one listener set, gone with the last", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const p = yield* page
      const spy = spyWindow()
      try {
        const among = UndefinedOr.getOrThrow(input.pointerAmong)
        const first = among(p.memberOf)(constVoid, constVoid)
        const second = among(p.memberOf)(constVoid, constVoid)
        expect(spy.adds(), "one set of five").toBe(5)
        first()
        expect(spy.removes()).toBe(0)
        second()
        expect(spy.removes(), "gone with the last").toBe(5)
      } finally {
        spy.restore()
      }
    }).pipe(Effect.scoped))

  it.effect("IA4: a member's own focus is its own, one inside it isn't; each member on the path hears it", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const p = yield* page
      p.inner.tabIndex = 0
      p.innerChild.tabIndex = 0
      const heard: Array<string> = []
      const stop = UndefinedOr.getOrThrow(input.focusAmong)(p.memberOf)(
        ({ target, event }) => heard.push(`${event.type}:${p.nameOf(target)}${Bool.match(event.fromTarget === true, { onTrue: () => " own", onFalse: () => "" })}`),
        constVoid,
      )
      p.inner.focus()
      p.innerChild.focus()
      p.innerChild.blur()
      expect(heard).toEqual(["focus:inner own", "focus:outer", "blur:inner own", "blur:outer", "focus:inner", "focus:outer", "blur:inner", "blur:outer"])
      stop()
    }).pipe(Effect.scoped))
})
