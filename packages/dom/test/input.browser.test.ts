import * as InputFeed from "@wardic/core/InputFeed"
import * as InputSource from "@wardic/core/InputSource"
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { constVoid } from "effect/Function"
import * as Fiber from "effect/Fiber"
import * as Match from "effect/Match"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as Option from "effect/Option"
import { InputDomLive, keyOf } from "../src/internal/input.ts"
import { makeFocusable } from "../src/internal/keyboard-press.ts"

/** Hand the scheduler a fixed budget of turns so async steps settle. */
const drain = Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true })

/**
 * Fork a collector draining a shared Stream into a Ref. The forked subscriber's
 * listener attaches asynchronously (subscriber fiber → RcMap.get → lookup →
 * forked pump → fromEventListener), so we `drain` once to let it become live
 * before the test dispatches. `collect(n)` drains, then returns what arrived;
 * `close` interrupts (dropping the ref-count) and drains so finalizers run.
 */
const subscribeIn = <A>(stream: Stream.Stream<A>) =>
  Effect.gen(function* () {
    const received = yield* Ref.make<ReadonlyArray<A>>([])
    const fiber = yield* Effect.forkChild(
      Stream.runForEach(stream, (a) => Ref.update(received, (xs) => [...xs, a])),
    )
    yield* drain
    return {
      collect: (_n: number) => drain.pipe(Effect.andThen(Ref.get(received))),
      close: Fiber.interrupt(fiber).pipe(Effect.andThen(drain)),
    }
  })

/** Wrap an EventTarget to count add/removeEventListener calls (ref-counting). */
const spyTarget = <T extends EventTarget>(target: T) => {
  let adds = 0
  let removes = 0
  const realAdd = target.addEventListener.bind(target)
  const realRemove = target.removeEventListener.bind(target)
  target.addEventListener = ((...args: Parameters<typeof realAdd>) => {
    adds++
    return realAdd(...args)
  }) as typeof target.addEventListener
  target.removeEventListener = ((...args: Parameters<typeof realRemove>) => {
    removes++
    return realRemove(...args)
  }) as typeof target.removeEventListener
  return { adds: () => adds, removes: () => removes }
}

// `layer()` provides InputDomLive to every test in the suite and memoizes it,
// so we don't re-provide it per test. Each test uses a FRESH element, so the
// shared RcMaps key distinct entries — no cross-test interference even though
// the layer is shared.
layer(InputDomLive)("InputDomLive", (it) => {
  it.effect("pointer maps down/move/up: type, coords, pressed, pointerId", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = document.createElement("div")
      const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))

      el.dispatchEvent(new PointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1, pointerId: 2 }))
      el.dispatchEvent(new PointerEvent("pointermove", { clientX: 7, clientY: 8, buttons: 1, pointerId: 2 }))
      el.dispatchEvent(new PointerEvent("pointerup", { clientX: 9, clientY: 10, buttons: 0, pointerId: 2 }))

      const events = yield* sub.collect(3)
      expect(events.map((e) => ({ type: e.type, x: e.x, y: e.y, pressed: e.pressed, pointerId: e.pointerId }))).toEqual([
        { type: "down", x: 5, y: 6, pressed: true, pointerId: 2 },
        { type: "move", x: 7, y: 8, pressed: true, pointerId: 2 },
        { type: "up", x: 9, y: 10, pressed: false, pointerId: 2 },
      ])
      yield* sub.close
    }))

  it.effect("pointer maps cancel/enter/leave phases", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = document.createElement("div")
      const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))

      el.dispatchEvent(new PointerEvent("pointerenter"))
      el.dispatchEvent(new PointerEvent("pointerleave"))
      el.dispatchEvent(new PointerEvent("pointercancel"))

      expect((yield* sub.collect(3)).map((e) => e.type)).toEqual(["enter", "leave", "cancel"])
      yield* sub.close
    }))

  it.effect("focus maps focus/blur", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = document.createElement("div")
      el.tabIndex = 0
      document.body.appendChild(el)
      const sub = yield* subscribeIn(InputFeed.toStream(input.focus(el)))

      el.focus()
      el.blur()

      expect((yield* sub.collect(2)).map((e) => e.type)).toEqual(["focus", "blur"])
      yield* sub.close
      el.remove()
    }))

  it.effect("keyboard(target) maps keydown/keyup at the target and inside it, with repeat and whether it came from the target (#43)", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = document.createElement("div")
      const child = document.createElement("input")
      el.appendChild(child)
      document.body.appendChild(el)
      const sub = yield* subscribeIn(InputFeed.toStream(input.keyboard(el)))

      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", repeat: false, bubbles: true }))
      child.dispatchEvent(new KeyboardEvent("keyup", { key: "b", code: "KeyB", repeat: true, bubbles: true }))
      // A key elsewhere on the page isn't the target's.
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", bubbles: true }))

      const events = yield* sub.collect(2)
      expect(events.map((e) => ({ type: e.type, key: e.key, repeat: e.repeat, fromTarget: e.fromTarget }))).toEqual([
        { type: "down", key: "up", repeat: false, fromTarget: true },
        { type: "up", key: "other", repeat: true, fromTarget: false },
      ])
      yield* sub.close
      el.remove()
    }))

  it.effect("I18: keys reach the targets they pass through innermost first, whatever order those subscribed in (#439)", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const outer = document.createElement("div")
      const inner = document.createElement("div")
      outer.appendChild(inner)
      document.body.appendChild(outer)
      const log: Array<string> = []
      // The outer one subscribes first: a listener of its own on the window would hear a key first.
      const offOuter = input.keyboard(outer)((e) => log.push(`outer ${e.type} ${e.fromTarget}`), constVoid)
      const offInner = input.keyboard(inner)((e) => log.push(`inner ${e.type} ${e.fromTarget}`), constVoid)
      inner.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      outer.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }))
      offInner()
      inner.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      offOuter()
      inner.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      expect(log).toEqual(["inner down true", "outer down false", "outer up true", "outer down false"])
      outer.remove()
    }))

  it.effect("I19: focus(target) tells its own focus and blur, and those inside it with fromTarget false (#439), each from its focusin or focusout (#460)", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const outer = document.createElement("div")
      outer.tabIndex = 0
      const inner = document.createElement("button")
      outer.appendChild(inner)
      document.body.appendChild(outer)
      const log: Array<string> = []
      const off = input.focus(outer)((e) => log.push(`${e.type} ${e.fromTarget} ${(e.raw as Event).type}`), constVoid)
      inner.focus()
      outer.focus()
      inner.focus()
      inner.blur()
      off()
      expect(log).toEqual([
        "focus false focusin",
        "blur false focusout",
        "focus true focusin",
        "blur true focusout",
        "focus false focusin",
        "blur false focusout",
      ])
      outer.remove()
    }))

  it.effect("a held pointer's page-wide release says whether it landed on the target or inside it (#257)", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = document.createElement("div")
      const child = document.createElement("span")
      el.appendChild(child)
      document.body.appendChild(el)
      const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
      const pointer = (type: string, at: EventTarget): void => {
        at.dispatchEvent(new PointerEvent(type, { pointerId: 1, isPrimary: true, buttons: Match.value(type).pipe(Match.when("pointerdown", () => 1), Match.orElse(() => 0)), bubbles: true }))
      }
      // Released on a child: on the target. Released on the page: not.
      pointer("pointerdown", el)
      pointer("pointerup", child)
      pointer("pointerdown", el)
      pointer("pointerup", document.body)
      const seen = yield* sub.collect(4)
      expect(seen.map((e) => `${e.type} ${e.onTarget}`)).toEqual(["down true", "up true", "down true", "up false"])
      yield* sub.close
      el.remove()
    }))

  it.effect("KA1: a key says what its own target does with Enter and Space (#427), and carries the DOM's event", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const host = document.createElement("div")
      const make = (html: string): HTMLElement => {
        const wrap = document.createElement("div")
        wrap.innerHTML = html
        host.appendChild(wrap)
        return wrap.firstElementChild as HTMLElement
      }
      const targets: ReadonlyArray<readonly [string, HTMLElement]> = [
        ["div", make("<div tabindex='0'></div>")],
        ["button", make("<button>b</button>")],
        ["checkbox", make("<input type='checkbox'>")],
        ["text field", make("<input type='text'>")],
        ["textarea", make("<textarea></textarea>")],
        ["select", make("<select><option>a</option></select>")],
        ["summary", make("<details><summary>s</summary></details>").firstElementChild as HTMLElement],
        ["link", make("<a href='#x'>a</a>")],
        ["anchor with no href", make("<a>a</a>")],
        ["editable", make("<div contenteditable='true'></div>")],
      ]
      document.body.appendChild(host)
      const seen: Array<string> = []
      const raws: Array<unknown> = []
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(InputFeed.toStream(input.keyboard(host)), (e) =>
          Effect.sync(() => {
            seen.push(`${e.key} ${e.action}`)
            raws.push(e.raw)
          })),
      )
      yield* drain
      const sent: Array<KeyboardEvent> = []
      for (const [, el] of targets) {
        for (const key of ["Enter", " "]) {
          const ev = new KeyboardEvent("keydown", { key, bubbles: true })
          sent.push(ev)
          el.dispatchEvent(ev)
        }
      }
      yield* drain
      const at = (i: number): string => `${targets[i]![0]}: ${seen[2 * i]}, ${seen[2 * i + 1]}`
      expect(targets.map((_, i) => at(i))).toEqual([
        "div: enter none, space none",
        "button: enter activate, space activate",
        "checkbox: enter activate, space activate",
        "text field: enter activate, space type",
        "textarea: enter type, space type",
        "select: enter activate, space activate",
        "summary: enter activate, space activate",
        "link: enter activate, space none",
        "anchor with no href: enter none, space none",
        "editable: enter type, space type",
      ])
      expect(raws, "each key's own event").toEqual(sent)
      yield* Fiber.interrupt(fiber)
      host.remove()
    }))

  it("KA2: makeFocusable gives tabindex 0 to an HTML element that doesn't take focus, and leaves the rest (#427; every case, #709)", () => {
    const html = (markup: string): Element => {
      const wrap = document.createElement("div")
      wrap.innerHTML = markup
      return wrap.firstElementChild!
    }
    const cases: ReadonlyArray<readonly [string, Element]> = [
      ["div", html("<div></div>")],
      ["li", html("<ul><li></li></ul>").firstElementChild!],
      ["anchor with no href", html("<a>a</a>")],
      ["button", html("<button></button>")],
      ["link", html("<a href='#x'>a</a>")],
      ["input", html("<input>")],
      ["select", html("<select></select>")],
      ["textarea", html("<textarea></textarea>")],
      ["summary", html("<details><summary>s</summary></details>").firstElementChild!],
      ["iframe", html("<iframe></iframe>")],
      ["area", html("<map name='m'><area href='#x'></map>").firstElementChild!],
      ["area with no href", html("<map name='n'><area></map>").firstElementChild!],
      ["editable", html("<div contenteditable='true'></div>")],
      ["inside an editable", html("<div contenteditable='true'><span>s</span></div>").firstElementChild!],
      ["anchor with no href, editable", html("<a contenteditable='true'>a</a>")],
      ["anchor with no href, inside an editable", html("<div contenteditable='true'><a>a</a></div>").firstElementChild!],
      ["given tabindex -1", html("<div tabindex='-1'></div>")],
      ["given tabindex 0", html("<div tabindex='0'></div>")],
      ["svg", document.createElementNS("http://www.w3.org/2000/svg", "rect")],
    ]
    // Each at its root in the page: one inside a wrapper (a summary, an area, an editable's child) goes in with it.
    const roots = cases.map(([, el]) => el.parentElement ?? el)
    for (const root of roots) document.body.appendChild(root)
    for (const [, el] of cases) makeFocusable(el)
    // Not an element: left as it is, nothing thrown.
    for (const notElement of [undefined, null, 1, "div", {}, () => {}, document.createTextNode("t")]) makeFocusable(notElement)
    expect(cases.map(([name, el]) => `${name}: ${el.getAttribute("tabindex")}`)).toEqual([
      "div: 0",
      "li: 0",
      "anchor with no href: 0",
      "button: null",
      "link: null",
      "input: null",
      "select: null",
      "textarea: null",
      "summary: null",
      "iframe: null",
      "area: null",
      "area with no href: 0",
      "editable: null",
      "inside an editable: null",
      "anchor with no href, editable: null",
      "anchor with no href, inside an editable: null",
      "given tabindex -1: -1",
      "given tabindex 0: 0",
      "svg: null",
    ])
    for (const root of roots) root.remove()
  })

  it("keyOf names the browser's keys in core's names, and every other key other (#43)", () => {
    const keys = [" ", "Enter", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "a", "Tab", "Spacebar", "Esc", "PageDown"]
    expect(keys.map(keyOf)).toEqual(["space", "enter", "escape", "left", "right", "up", "down", "home", "end", "other", "other", "other", "other", "other"])
  })

  it.effect("keyboard(target) runs after the page's handlers and inside the dispatch: it sees their preventDefault as handled, and its own handle() counts (#43)", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = document.createElement("div")
      document.body.appendChild(el)
      // The app's handlers: one on the element, one delegated to the document, as Solid's are.
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") ev.preventDefault()
      })
      const onDocument = (ev: KeyboardEvent): void => {
        if (ev.key === "Escape") ev.preventDefault()
      }
      document.addEventListener("keydown", onDocument)
      const seen: Array<{ key: InputSource.Key; handled: boolean }> = []
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(InputFeed.toStream(input.keyboard(el)), (e) =>
          Effect.sync(() => {
            seen.push({ key: e.key, handled: e.handled })
            if (e.key === "space") e.handle()
          })),
      )
      yield* drain

      const space = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true })
      el.dispatchEvent(space)
      // Handled inside the dispatch: seen before dispatchEvent returned, and its handle() prevented the default.
      expect(seen.map((s) => s.key)).toEqual(["space"])
      expect(space.defaultPrevented).toBe(true)
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }))
      expect(seen).toEqual([
        { key: "space", handled: false },
        { key: "enter", handled: true },
        { key: "escape", handled: true },
        { key: "other", handled: false },
      ])
      yield* Fiber.interrupt(fiber).pipe(Effect.andThen(drain))
      document.removeEventListener("keydown", onDocument)
      el.remove()
    }))

  it.effect("ref-counting: two subscribers to pointer(sameEl) attach one listener-set; removed after last closes", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = document.createElement("div")
      const spy = spyTarget(el)

      const a = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
      const b = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))

      // One listener-set: 6 pointer event types attached exactly once, shared by
      // both subscribers (not 12). No removals yet.
      expect(spy.adds()).toBe(6)
      expect(spy.removes()).toBe(0)

      // Both subscribers see the same event off the one shared listener-set.
      el.dispatchEvent(new PointerEvent("pointerdown", { clientX: 1, clientY: 2, buttons: 1 }))
      expect((yield* a.collect(1)).map((e) => e.type)).toEqual(["down"])
      expect((yield* b.collect(1)).map((e) => e.type)).toEqual(["down"])

      // First leaves: ref-count >= 1, listeners stay. Last leaves: all removed.
      yield* a.close
      expect(spy.removes()).toBe(0)
      yield* b.close
      expect(spy.removes()).toBe(6)
    }))
})

// A Held pointer (ADR-0019, #31): a pointer that went down on the target keeps
// delivering its moves, release and cancel to `pointer(target)` wherever they land,
// until it is released. The DOM adds page-wide (window, capture-phase) listeners inside
// the down's dispatch and removes them at the release: move, up, cancel, and down,
// which ends a hold whose release was lost (decision 7). Page-wide events are dispatched
// on `document.body`; the target is attached to the document, so a window listener
// sees the events dispatched on it too.

/** A synthetic pointer event shaped like a real mouse's: primary, bubbling. */
const pointerEvent = (type: string, init: PointerEventInit = {}): PointerEvent =>
  new PointerEvent(type, { pointerType: "mouse", isPrimary: true, pointerId: 1, bubbles: true, ...init })

/** Count the window's capture-phase `pointer*` listeners added and removed while it runs. */
const spyWindowPointer = () => {
  let adds = 0
  let removes = 0
  const realAdd = window.addEventListener.bind(window)
  const realRemove = window.removeEventListener.bind(window)
  const counts = (type: string, options: unknown): boolean =>
    type.startsWith("pointer") &&
    (options === true || (typeof options === "object" && options !== null && (options as AddEventListenerOptions).capture === true))
  window.addEventListener = ((...args: Parameters<typeof realAdd>) => {
    if (counts(args[0], args[2])) adds++
    return realAdd(...args)
  }) as typeof window.addEventListener
  window.removeEventListener = ((...args: Parameters<typeof realRemove>) => {
    if (counts(args[0], args[2])) removes++
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

/** A fresh target attached to the document; removed when the test's scope closes. */
const attachedTarget = Effect.acquireRelease(
  Effect.sync(() => {
    const el = document.createElement("div")
    document.body.append(el)
    return el
  }),
  (el) => Effect.sync(() => el.remove()),
)

layer(InputDomLive)("InputDomLive: Held pointer", (it) => {
  it.effect("I1: a pointer that went down on the target keeps its moves, release and cancel", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = yield* attachedTarget
      const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1 }))
      document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 300, buttons: 1 }))
      document.body.dispatchEvent(pointerEvent("pointerup", { clientX: 310 }))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1, pointerId: 2 }))
      document.body.dispatchEvent(pointerEvent("pointercancel", { clientX: 320, pointerId: 2 }))
      const events = yield* sub.collect(5)
      expect(events.map((e) => `${e.type}@${e.x}`)).toEqual(["down@0", "move@300", "up@310", "down@0", "cancel@320"])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I2: a held pointer's move on the target itself arrives once", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = yield* attachedTarget
      const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1 }))
      el.dispatchEvent(pointerEvent("pointermove", { clientX: 5, buttons: 1 }))
      el.dispatchEvent(pointerEvent("pointerup", { clientX: 5 }))
      const events = yield* sub.collect(3)
      expect(events.map((e) => e.type)).toEqual(["down", "move", "up"])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I3: a page-wide move in the down's own task arrives (the listeners are added inside its dispatch)", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = yield* attachedTarget
      const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1 }))
      document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 200, buttons: 1 }))
      const events = yield* sub.collect(2)
      expect(events.map((e) => `${e.type}@${e.x}`)).toEqual(["down@0", "move@200"])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I4: the release, a cancel or a move with no button pressed ends it", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      for (const ending of ["pointerup", "pointercancel", "pointermove"] as const) {
        const el = yield* attachedTarget
        const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
        el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1 }))
        document.body.dispatchEvent(pointerEvent(ending, { clientX: 100, buttons: 0 }))
        document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 200, buttons: 0 }))
        const events = yield* sub.collect(2)
        const kind = Match.value(ending).pipe(Match.when("pointerup", () => "up"), Match.when("pointercancel", () => "cancel"), Match.orElse(() => "move"))
        expect(events.map((e) => `${e.type}@${e.x}`), `ended by a ${ending}`).toEqual(["down@0", `${kind}@100`])
        yield* sub.close
      }
    }).pipe(Effect.scoped))

  it.effect("I5: page-wide listeners only while a pointer is held", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = yield* attachedTarget
      const spy = spyWindowPointer()
      try {
        const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
        expect(spy.adds(), "none at subscribe").toBe(0)
        el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1 }))
        yield* sub.collect(1)
        expect(spy.adds(), "move, up, cancel and down at the down").toBe(4)
        document.body.dispatchEvent(pointerEvent("pointerup", { clientX: 0 }))
        yield* sub.collect(2)
        expect(spy.removes(), "all four at the release").toBe(4)
        yield* sub.close
      } finally {
        spy.restore()
      }
    }).pipe(Effect.scoped))

  it.effect("I6: two held pointers share one page-wide set until both are released", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = yield* attachedTarget
      const spy = spyWindowPointer()
      try {
        const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
        el.dispatchEvent(pointerEvent("pointerdown", { buttons: 1, pointerId: 1 }))
        el.dispatchEvent(pointerEvent("pointerdown", { buttons: 1, pointerId: 2, isPrimary: false }))
        yield* sub.collect(2)
        expect(spy.adds(), "one set for both").toBe(4)
        document.body.dispatchEvent(pointerEvent("pointerup", { pointerId: 1 }))
        yield* sub.collect(3)
        expect(spy.removes(), "kept while pointer 2 is held").toBe(0)
        document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 50, buttons: 1, pointerId: 2, isPrimary: false }))
        document.body.dispatchEvent(pointerEvent("pointerup", { pointerId: 2, isPrimary: false }))
        const events = yield* sub.collect(5)
        expect(events.map((e) => `${e.type}#${e.pointerId}`)).toEqual(["down#1", "down#2", "up#1", "move#2", "up#2"])
        expect(spy.removes(), "removed at the last release").toBe(4)
        yield* sub.close
      } finally {
        spy.restore()
      }
    }).pipe(Effect.scoped))

  it.effect("I7: a real pointer's kind, button and primary are mapped from the DOM event, in core's names (#189)", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = yield* attachedTarget
      const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
      el.dispatchEvent(pointerEvent("pointerdown", { pointerType: "pen", isPrimary: false, button: 2, buttons: 2 }))
      el.dispatchEvent(pointerEvent("pointerup", { pointerType: "pen", isPrimary: false, button: 2, buttons: 0 }))
      const events = yield* sub.collect(2)
      expect(events.map((e) => ({ type: e.type, kind: e.kind, button: e.button, primary: e.primary, pressed: e.pressed }))).toEqual([
        { type: "down", kind: "pen", button: "secondary", primary: false, pressed: true },
        { type: "up", kind: "pen", button: "secondary", primary: false, pressed: false },
      ])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I8: a pointer that never went down on the target doesn't reach it from the page", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = yield* attachedTarget
      const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
      el.dispatchEvent(pointerEvent("pointerdown", { buttons: 1, pointerId: 1 }))
      document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 70, buttons: 1, pointerId: 3 }))
      document.body.dispatchEvent(pointerEvent("pointerup", { pointerId: 3 }))
      const events = yield* sub.collect(1)
      expect(events.map((e) => `${e.type}#${e.pointerId}`)).toEqual(["down#1"])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I10: a page-wide press after a lost release ends the hold; a press on the target arrives after it", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = yield* attachedTarget
      const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1 }))
      document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 40, buttons: 1 }))
      // The release is lost; the same pointer presses elsewhere on the page.
      document.body.dispatchEvent(pointerEvent("pointerdown", { clientX: 300, buttons: 1 }))
      document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 320, buttons: 1 }))
      // Later it presses the target itself.
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 5, buttons: 1 }))
      const events = yield* sub.collect(4)
      expect(events.map((e) => `${e.type}@${e.x}/${e.pressed}`)).toEqual(["down@0/true", "move@40/true", "move@40/false", "down@5/true"])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I9: two subscribers share one target listener-set and one page-wide set", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = yield* attachedTarget
      const target = spyTarget(el)
      const page = spyWindowPointer()
      try {
        const a = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
        const b = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
        el.dispatchEvent(pointerEvent("pointerdown", { buttons: 1 }))
        document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 90, buttons: 1 }))
        expect((yield* a.collect(2)).map((e) => e.type)).toEqual(["down", "move"])
        expect((yield* b.collect(2)).map((e) => e.type)).toEqual(["down", "move"])
        expect(target.adds(), "one target listener-set").toBe(6)
        expect(page.adds(), "one page-wide set while held").toBe(4)
        yield* a.close
        expect(page.removes(), "kept while a subscriber remains").toBe(0)
        yield* b.close
        expect(target.removes(), "the target's set goes with the last subscriber").toBe(6)
        expect(page.removes(), "and so does the page-wide set").toBe(4)
      } finally {
        page.restore()
      }
    }).pipe(Effect.scoped))
})

// A scroll during a hold (ADR-0019, *Amendment (Reorder)*): while a pointer is held, the
// DOM reports scrolls of the target's scrollable ancestors and of its window, and core's
// InputSource.heldPointer turns each into a move of the held pointer shifted by the scroll, so
// a drag stays under the pointer. Nothing listens for scroll at rest.

/** Count the window's `scroll` listeners added and removed while it runs (any phase). */
const spyWindowScroll = () => {
  let adds = 0
  let removes = 0
  const realAdd = window.addEventListener.bind(window)
  const realRemove = window.removeEventListener.bind(window)
  window.addEventListener = ((...args: Parameters<typeof realAdd>) => {
    if (args[0] === "scroll") adds++
    return realAdd(...args)
  }) as typeof window.addEventListener
  window.removeEventListener = ((...args: Parameters<typeof realRemove>) => {
    if (args[0] === "scroll") removes++
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

/** Wait for the next Refresh frame: scroll events are dispatched in its rendering steps. */
const nextFrame = Effect.promise(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

/** A 100 px tall `overflow: auto` container holding 400 px of content, and a target inside it. */
const scrolledTarget = Effect.acquireRelease(
  Effect.sync(() => {
    const container = document.createElement("div")
    container.style.cssText = "position:relative;width:200px;height:100px;overflow:auto"
    const content = document.createElement("div")
    content.style.cssText = "height:400px"
    const el = document.createElement("div")
    el.style.cssText = "width:50px;height:50px"
    content.append(el)
    container.append(content)
    document.body.append(container)
    return { container, el }
  }),
  ({ container }) => Effect.sync(() => container.remove()),
)

layer(InputDomLive)("InputDomLive: a scroll during a hold", (it) => {
  it.effect("I11: no scroll listener at rest, and none from a plain move", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const spy = spyWindowScroll()
      try {
        const { el } = yield* scrolledTarget
        const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
        el.dispatchEvent(pointerEvent("pointermove", { buttons: 0 }))
        yield* sub.collect(1)
        expect(spy.adds()).toBe(0)
        yield* sub.close
      } finally {
        spy.restore()
      }
    }).pipe(Effect.scoped))

  it.effect("I12: a held pointer's container scrolled 60 px arrives as a move shifted 60 px", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const { container, el } = yield* scrolledTarget
      const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1 }))
      el.dispatchEvent(pointerEvent("pointermove", { clientX: 5, clientY: 6, buttons: 1 }))
      container.scrollTop += 60
      yield* nextFrame
      const events = yield* sub.collect(3)
      expect(events.map((e) => `${e.type}@${e.x},${e.y}`)).toEqual(["down@5,6", "move@5,6", "move@5,66"])
      expect(events[2]!.pressed).toBe(true)
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I13: the window scrolled 60 px while a pointer is held arrives as a shifted move", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const tall = document.createElement("div")
      tall.style.cssText = "height:4000px"
      document.body.append(tall)
      try {
        const { el } = yield* scrolledTarget
        const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
        el.dispatchEvent(pointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1 }))
        el.dispatchEvent(pointerEvent("pointermove", { clientX: 5, clientY: 6, buttons: 1 }))
        window.scrollBy(0, 60)
        yield* nextFrame
        const events = yield* sub.collect(3)
        expect(events.map((e) => `${e.type}@${e.x},${e.y}`)).toEqual(["down@5,6", "move@5,6", "move@5,66"])
        yield* sub.close
      } finally {
        window.scrollTo(0, 0)
        tall.remove()
      }
    }).pipe(Effect.scoped))

  it.effect("I14: a scroll of a container the target isn't in reports nothing", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const { el } = yield* scrolledTarget
      const other = yield* scrolledTarget
      const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1 }))
      el.dispatchEvent(pointerEvent("pointermove", { clientX: 5, clientY: 6, buttons: 1 }))
      other.container.scrollTop += 60
      yield* nextFrame
      expect((yield* sub.collect(2)).map((e) => e.type)).toEqual(["down", "move"])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I15: the two scroll listeners come with the hold and go at its release", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const spy = spyWindowScroll()
      try {
        const { el } = yield* scrolledTarget
        const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
        el.dispatchEvent(pointerEvent("pointerdown", { buttons: 1 }))
        expect(spy.adds(), "one capture-phase listener for element scrolls, one for the window's own").toBe(2)
        expect(spy.removes()).toBe(0)
        document.body.dispatchEvent(pointerEvent("pointerup", { buttons: 0 }))
        expect(spy.removes()).toBe(2)
        yield* sub.close
      } finally {
        spy.restore()
      }
    }).pipe(Effect.scoped))

  it.effect("I17: inside a plain position:fixed element, neither the page's scroll nor an outer container's moves the pointer; the fixed element's own does", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const tall = document.createElement("div")
      tall.style.cssText = "height:4000px"
      document.body.append(tall)
      try {
        const { container, el: anchor } = yield* scrolledTarget
        // A fixed scrolling panel inside the scrolled container, holding the target.
        const panel = document.createElement("div")
        panel.style.cssText = "position:fixed;left:300px;top:0;width:100px;height:100px;overflow:auto"
        const panelContent = document.createElement("div")
        panelContent.style.cssText = "height:400px"
        const el = document.createElement("div")
        el.style.cssText = "width:50px;height:50px"
        panelContent.append(el)
        panel.append(panelContent)
        anchor.after(panel)
        const sub = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
        el.dispatchEvent(pointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1 }))
        el.dispatchEvent(pointerEvent("pointermove", { clientX: 5, clientY: 6, buttons: 1 }))
        container.scrollTop += 60
        window.scrollBy(0, 60)
        yield* nextFrame
        panel.scrollTop += 30
        yield* nextFrame
        const events = yield* sub.collect(3)
        expect(events.map((e) => `${e.type}@${e.x},${e.y}`)).toEqual(["down@5,6", "move@5,6", "move@5,36"])
        yield* sub.close
      } finally {
        window.scrollTo(0, 0)
        tall.remove()
      }
    }).pipe(Effect.scoped))

  it.effect("I16: two subscribers to one element share one pair of scroll listeners", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const spy = spyWindowScroll()
      try {
        const { container, el } = yield* scrolledTarget
        const a = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
        const b = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
        el.dispatchEvent(pointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1 }))
        el.dispatchEvent(pointerEvent("pointermove", { clientX: 5, clientY: 6, buttons: 1 }))
        expect(spy.adds()).toBe(2)
        container.scrollTop += 60
        yield* nextFrame
        expect((yield* a.collect(3)).map((e) => `${e.type}@${e.y}`)).toEqual(["down@6", "move@6", "move@66"])
        expect((yield* b.collect(3)).map((e) => `${e.type}@${e.y}`)).toEqual(["down@6", "move@6", "move@66"])
        yield* a.close
        yield* b.close
      } finally {
        spy.restore()
      }
    }).pipe(Effect.scoped))

  it.effect("I20: a down adoptPointer hands a target reaches its adoptable feed alone, not its plain one (#431, #507)", () =>
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const el = document.createElement("div")
      document.body.append(el)
      try {
        const plain = yield* subscribeIn(InputFeed.toStream(input.pointer(el)))
        const adoptable = yield* subscribeIn(InputFeed.toStream(InputSource.adoptablePointerOf(input, el)))
        const handed = input.adoptPointer(el, pointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1 }))
        expect(Option.map(handed, (h) => h.adopted), "handed as adopted").toEqual(Option.some(true))
        expect((yield* plain.collect(1)).map((e) => e.type), "the plain feed subscribes no adoption").toEqual([])
        expect((yield* adoptable.collect(1)).map((e) => `${e.type} ${String(e.adopted)}`), "the adoptable feed hears it").toEqual(["down true"])
        yield* plain.close
        yield* adoptable.close
      } finally {
        el.remove()
      }
    }).pipe(Effect.scoped))

  it.effect("I21: two Environments on a page don't hear each other's adopted downs (#618)", () =>
    Effect.gen(function* () {
      const mine = yield* InputSource.InputSource
      // Another Environment's input, built apart from this suite's.
      const theirs = yield* InputSource.InputSource.pipe(Effect.provide(Layer.fresh(InputDomLive)))
      const el = document.createElement("div")
      document.body.append(el)
      try {
        const adoptable = yield* subscribeIn(InputFeed.toStream(InputSource.adoptablePointerOf(mine, el)))
        theirs.adoptPointer(el, pointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1 }))
        expect((yield* adoptable.collect(1)).map((e) => e.type), "the other's adoption isn't heard here").toEqual([])
        mine.adoptPointer(el, pointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1 }))
        expect((yield* adoptable.collect(1)).map((e) => e.type), "its own is").toEqual(["down"])
        yield* adoptable.close
      } finally {
        el.remove()
      }
    }).pipe(Effect.scoped))
})
