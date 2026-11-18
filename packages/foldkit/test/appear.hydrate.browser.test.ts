// Appear animations, server render to hydration, the Foldkit binding (#794, PR 3; ADR-0044; ADR-0071
// decision 35 and its *Amendment (#794)*): a page the server rendered (PR 1, PR 2) plays each element's
// mount animation from the first paint, and `wardic.hydrate` hands it to the element's ward at hydration
// without a flicker: the chunk moved into the head, the hydration render keeping each element's running
// animation, and its Mount taking it over where the CSS has got (the Handoff). Foldkit renders the
// hydration about half a second after `hydrate` is called, in the middle of each fixture's 1.2 s entrance.
//
// - H1: the Hydration hold: the server's markup is hydratable (its root stamped, the chunk first among the
//   Provider element's children) and the client keeps it: the chunk is in the head and gone from the root,
//   the server's nodes are the ones on the page (nothing rebuilt, no mismatch word), the card moved before
//   hydration, and after it the CSS animation and the inline `animation` are gone and the card rests at
//   its target. `IS_SERVER` reads false in the browser, true on the server load (the chunk proves it).
// - H2: P14's trace: every frame from first paint through the Handoff to rest is Wardic's own machine at
//   that frame's time; nothing goes back to the Starting style.
// - H3: a stagger: a variant parent's items each from their own delay, through the Handoff (ADR-0007).
// - H4: reduced motion (`"user"`, emulated): the positional key is at its target from the first frame,
//   and opacity animates through the Handoff (ADR-0029).
// - H5: `Wardic.make({ appear: false })`: no chunk, no slot, the card at its Starting style until
//   hydration, then its entrance by the engine; `w.Appear(false)` on one element beside one that plays:
//   it waits for the script while the other moves, and enters once hydrated.
// - H6: a layout box (`w.Layout()`) entering from first paint, handed off, and its next layout change
//   from its true box: the Measure pass at its mount reads past the CSS transform (ADR-0044 *Amendment
//   (#245)*), so the move starts where it was, at its true size.
// - H7: an element the first Model change adds after hydration names no slot (no dead declaration) and
//   enters by the engine.
// - H8: a reorder after hydration: the keyed items move with no slot named and nothing restarts (Q9).
import * as Easing from "@wardic/core/Easing"
import * as Machine from "@wardic/core/Machine"
import type * as Values from "@wardic/core/Values"
import * as Appear from "@wardic/dom/Appear"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { commands } from "vitest/browser"
import { afterEach, describe, expect, it } from "vitest"
import { IS_SERVER } from "@wardic/foldkit/internal/server"
import { followsMachine, machineAt, type Recorded, recordFrames } from "../../solid/test/appear-frames.ts"
import { until } from "../../solid/test/browser-helpers.ts"
import { tagsOf } from "../../solid/test/markup.ts"
import { ADDED, CARD, KEYED, LAYOUT, LIST, OFF, STILL } from "./hydrate-fixtures.ts"
import { cleanups, runHydrated } from "./hydrate.ts"

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  await commands.emulateReducedMotion(false)
})

/** Click the page's `#id`: the fixture's button, which sends its Message (the page holds one fixture at a time). */
const click = (id: string) => (): void => {
  document.querySelector<HTMLElement>(`#${id}`)!.click()
}

/** A tween's machine, as the server samples it and the client runs it. */
const tween = (from: Values.Values, to: Values.Values, options: Machine.AnimateOptions) =>
  Effect.runSync(Effect.provide(Machine.animateValues(from, to, options), DomInterpolators.layer))

/** The card's entrance: a 1.2 s tween on `easeOut`, the tween's default. */
const slow = tween({ opacity: 0, x: 0 }, { opacity: 1, x: 200 }, { ease: Easing.easeOut, duration: 1.2 })

const cardAt = (s: number): { readonly opacity: number; readonly x: number } => {
  const v = machineAt(slow, s)
  return { opacity: v.opacity as number, x: v.x as number }
}

describe("Appear animations, server render to hydration, the Foldkit binding (#794)", () => {
  it("H1: the Hydration hold: the chunk moves into the head, the server's nodes are kept, and the card is handed off and lands", async () => {
    const r = await runHydrated("CARD", CARD, { forMs: 1800 })
    expect(IS_SERVER, "the browser reads the client's half").toBe(false)
    expect(r.html, "the server's render is hydratable").toContain("data-foldkit-app=")
    expect(r.html, "the chunk is the Provider element's first child").toMatch(new RegExp(`<div[^>]*id="root"[^>]*><style ${Appear.CHUNK_ATTRIBUTE}`))
    expect(r.root.querySelector(`style[${Appear.CHUNK_ATTRIBUTE}]`), "the chunk left the root").toBeNull()
    expect(document.head.querySelector("style[data-wardic-appear]"), "its rules are in the head").not.toBeNull()
    expect(r.hydrated(), "the hydration render ran").toBe(true)
    const card = r.host.querySelector<HTMLElement>("[data-k=card]")!
    expect(r.before.includes(card), "the server's card is the one on the page").toBe(true)
    expect(r.warned.filter((line) => line.includes("did not match")), "no mismatch").toEqual([])
    const before = r.frames.filter((f) => !f.hydrated && f.drawn.card!.css)
    expect(before.some((f) => f.drawn.card!.x > 5 && f.drawn.card!.x < 195), "it moved before hydration").toBe(true)
    expect(r.frames.filter((f) => f.hydrated).length, "frames after hydration").toBeGreaterThan(30)
    const last = r.frames.at(-1)!.drawn.card!
    expect(last.css, "the CSS animation is gone").toBe(false)
    expect(card.style.getPropertyValue("animation"), "the inline animation is gone").toBe("")
    expect(last.opacity).toBeCloseTo(1, 2)
    expect(last.x).toBeCloseTo(200, 1)
  })

  it("H2: every frame through the Handoff is the machine's at that time, never back to the Starting style", async () => {
    const r = await runHydrated("CARD", CARD, { forMs: 1800 })
    expect(followsMachine(r, "card", cardAt), "frames after hydration").toBeGreaterThan(30)
    let highest = -1
    for (const frame of r.frames) {
      expect(frame.drawn.card!.x, `x at ${frame.at}`).toBeGreaterThanOrEqual(highest - 0.6)
      highest = Math.max(highest, frame.drawn.card!.x)
    }
  })

  it("H3: a stagger: each item from its own delay, through the Handoff", async () => {
    const r = await runHydrated("LIST", LIST, { forMs: 1800 })
    ;["i0", "i1", "i2"].forEach((k, i) => {
      const machine = tween({ opacity: 0, x: -30 }, { opacity: 1, x: 0 }, { ease: Easing.easeOut, duration: 1, delay: 0.12 * i })
      expect(followsMachine(r, k, (s) => {
        const v = machineAt(machine, s)
        return { opacity: v.opacity as number, x: v.x as number }
      }), k).toBeGreaterThan(20)
    })
  })

  it("H4: reduced motion: the positional key at its target from the first frame, opacity animating", async () => {
    await commands.emulateReducedMotion(true)
    const fade = tween({ opacity: 0 }, { opacity: 1 }, { ease: Easing.easeOut, duration: 1.2 })
    const r = await runHydrated("CARD", CARD, { forMs: 1800 })
    expect(followsMachine(r, "card", (s) => ({ opacity: machineAt(fade, s).opacity as number, x: 200 }))).toBeGreaterThan(30)
  })

  it("H5: appear: false plays nothing before the script, and w.Appear(false) keeps one element waiting beside one that plays", async () => {
    const off = await runHydrated("OFF", OFF, { forMs: 1800 })
    expect(off.html, "no chunk").not.toContain(Appear.CHUNK_ATTRIBUTE)
    expect(off.html, "no slot").not.toContain("animation:")
    const held = off.frames.filter((f) => !f.hydrated)
    expect(held.length).toBeGreaterThan(5)
    for (const f of held) {
      expect(f.drawn.card!.opacity, "at its Starting style until hydration").toBe(0)
      expect(f.drawn.card!.css).toBe(false)
    }
    expect(off.frames.some((f) => f.hydrated && f.drawn.card!.opacity > 0.1 && f.drawn.card!.opacity < 0.95), "it enters once hydrated").toBe(true)
    const last = off.frames.at(-1)!.drawn.card!
    expect(last.opacity).toBeCloseTo(1, 2)
    expect(last.x).toBeCloseTo(200, 1)
    // The page holds one hydrated fixture at a time: the first leaves before the second renders.
    for (const cleanup of cleanups.splice(0)) cleanup()
    const still = await runHydrated("STILL", STILL, { forMs: 1800 })
    const served = Option.getOrThrow(Arr.findFirst(tagsOf(still.html), (tag) => tag.attrs.id === "still"))
    expect(served.style.animation, "the still one names no slot").toBeUndefined()
    const before = still.frames.filter((f) => !f.hydrated)
    expect(before.some((f) => f.drawn.card!.x > 5), "the card plays before hydration").toBe(true)
    for (const f of before) expect(f.drawn.still!.opacity, "the still one waits for the script").toBe(0)
    expect(still.frames.at(-1)!.drawn.still!.opacity, "and enters once hydrated").toBeCloseTo(1, 2)
    expect(still.frames.at(-1)!.drawn.card!.x).toBeCloseTo(200, 1)
  })

  it("H6: a layout box drawn from first paint, handed off, and its next layout change from its true box", async () => {
    const box = tween({ opacity: 0, y: 40 }, { opacity: 1, y: 0 }, { ease: Easing.easeOut, duration: 1.2 })
    const r = await runHydrated("LAYOUT", LAYOUT, { forMs: 2700, then: { afterMs: 1900, act: click("move") } })
    const before = r.frames.filter((f) => !f.hydrated && f.drawn.box!.css)
    expect(before.some((f) => f.drawn.box!.y > 2 && f.drawn.box!.y < 38), "it moved before hydration").toBe(true)
    const start = r.startOf.box!
    const entrance = { ...r, frames: r.frames.filter((f) => f.at - start < 1700) }
    expect(followsMachine(entrance, "box", (s) => {
      const v = machineAt(box, s)
      return { opacity: v.opacity as number, y: v.y as number }
    })).toBeGreaterThan(30)
    // The layout change: the first frame it draws is where the box was, its true size, then it moves down 60 px.
    const atRest = r.frames.filter((f) => f.at - start > 1400 && f.at - start < 1700)
    expect(atRest.length).toBeGreaterThan(5)
    const rest = atRest.at(-1)!.drawn.box!
    expect(rest.width).toBeCloseTo(40, 0)
    const changed = r.frames.findIndex((f) => f.at - start > 1700 && Math.abs(f.drawn.box!.top - rest.top) > 0.5)
    expect(changed, "it moved").toBeGreaterThan(0)
    const first = r.frames[changed]!.drawn.box!
    expect(first.width, "its true size: no jump to the box the CSS drew at mount").toBeCloseTo(40, 0)
    expect(first.top - rest.top, "from where it was, not jumped").toBeLessThan(15)
    expect(r.frames.at(-1)!.drawn.box!.top - rest.top, "landing 60 px down").toBeGreaterThan(30)
  })

  it("H7: an element the first Model change adds after hydration names no slot and enters by the engine", async () => {
    let late: ReadonlyArray<Recorded> = []
    let watching: Promise<void> = Promise.resolve()
    const add = (): void => {
      click("add")()
      watching = (async () => {
        await until(() => document.querySelector("[data-k=late]") !== null, 2000, "the late element renders")
        late = await recordFrames({ page: document, watched: [document.querySelector("[data-k=late]")!], forMs: 700, hydrated: () => true, startOf: {} })
      })()
    }
    const r = await runHydrated("ADDED", ADDED, { forMs: 2400, then: { afterMs: 1500, act: add } })
    await watching
    const el = r.host.querySelector<HTMLElement>("[data-k=late]")!
    expect(el.style.getPropertyValue("animation"), "no slot named").toBe("")
    expect(late.length).toBeGreaterThan(10)
    expect(late.every((f) => !f.drawn.late!.css), "no CSS animation").toBe(true)
    expect(late.some((f) => f.drawn.late!.opacity > 0.05 && f.drawn.late!.opacity < 0.95), "the engine's entrance").toBe(true)
    expect(late.at(-1)!.drawn.late!.opacity).toBeCloseTo(1, 2)
    expect(r.frames.at(-1)!.drawn.card!.x, "the card rests").toBeCloseTo(200, 1)
  })

  it("H8: a reorder after hydration moves the keyed items with no slot named, and nothing restarts", async () => {
    const r = await runHydrated("KEYED", KEYED, { forMs: 2200, then: { afterMs: 1400, act: click("reorder") } })
    const items = [...r.host.querySelectorAll<HTMLElement>("#list > li")]
    expect(items.map((li) => li.id), "reordered").toEqual(["item-c", "item-b", "item-a"])
    for (const li of items) {
      expect(li.style.getPropertyValue("animation"), `${li.id} names no slot`).toBe("")
      expect(li.getAnimations().length, `${li.id} runs no CSS animation`).toBe(0)
    }
    const begun = r.frames[0]!.at
    const after = r.frames.filter((f) => f.at - begun > 1500)
    expect(after.length).toBeGreaterThan(20)
    for (const f of after) {
      for (const k of ["a", "b", "c"]) {
        expect(f.drawn[k]!.opacity, `${k} at ${((f.at - begun) / 1000).toFixed(3)} s`).toBeCloseTo(1, 2)
        expect(f.drawn[k]!.css, `${k} restarted`).toBe(false)
      }
    }
  })
})
