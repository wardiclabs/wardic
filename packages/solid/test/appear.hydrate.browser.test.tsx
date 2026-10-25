// Appear animations, server render to hydration (#48, ADR-0044): every frame an element draws, from
// first paint through the Handoff to rest, is Wardic's own machine at that frame's time.
//
// The server's markup and head go on the page as a server render leaves them; hydration comes
// `hydrateAfter` ms later, as a page's JS would. Each frame records what each `data-k` element
// draws, read in a requestAnimationFrame callback, and the time since its CSS animation started
// (`startTime`, the timeline rAF stamps share).
//
// - AH1: a spring plays from first paint; the Handoff in the middle of it draws the machine before,
//   at and after it; the CSS animation is gone and the element rests at its target.
// - AH2: a tween handed off mid-flight, the same.
// - AH3: hydrated after the CSS ended: the element stays at its target; nothing restarts.
// - AH4: never hydrated (JS off): it plays to its end and holds it.
// - AH5: a stagger: each item from its own delay, through the Handoff.
// - AH6: when: "beforeChildren": the child waits for its parent before and after the Handoff.
// - AH7: a loop for ever, handed off in its second cycle.
// - AH8: reduced motion (`"user"`, emulated): the positional key is at its target from the first
//   frame, and opacity animates.
// - AH9: reduced motion and a stagger: each item's positional key holds its start through its delay,
//   then snaps, as the engine's snap does (the rule fills forwards).
// - AH10 (#245): an SVG circle's `cx`, `r` and `opacity` and a path's stroke dash, attributes played
//   as CSS, handed off mid-flight to the engine's attributes.
// - AH11 (#245, #363): a layout card's entrance (scale, opacity, its own y): drawn as the client draws
//   a layout node, its y on its projection's translate, from first paint; handed off mid-flight; and its next layout change
//   animates from its true box, measured past the CSS at mount.
// - AH12 (#245): a list's items streamed in a late chunk that lands before the JS: each plays its
//   CSS from the chunk's landing, staggered among the late ones, and is handed off with no step;
//   the chunk's `<style>` is gone from the list after hydration, its rules in the head; a later
//   list update leaves the items in order, nothing between them.
import * as Easing from "@wardic/core/Easing"
import * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import type * as Values from "@wardic/core/Values"
import * as Appear from "@wardic/dom/Appear"
import * as DomDefaultTransition from "@wardic/dom/DomDefaultTransition"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as References from "effect/References"
import { DomLive } from "@wardic/dom"
import { type JSX, sharedConfig } from "solid-js"
import { hydrate } from "solid-js/web"
import { commands } from "vitest/browser"
import { afterEach, describe, expect, it } from "vitest"
import { A1, A2, A3, A4, A5, A6, A7, A8, setAppearEnv } from "./appear-fixtures.tsx"
import "./browser-commands.ts"

const FILE = "./test/appear-fixtures.tsx"

/** What one element draws in one frame. */
interface Drawn {
  readonly opacity: number
  readonly x: number
  readonly y: number
  readonly rotate: number
  /** An SVG element's `cx` and `r`, and its stroke dash's first length (#245); 0 where it has none. */
  readonly cx: number
  readonly r: number
  readonly dash: number
  /** Its scale on x (no rotation), and its painted box's width and top (#245). */
  readonly scale: number
  readonly width: number
  readonly top: number
  /** Whether a CSS animation still runs on it. */
  readonly css: boolean
}

/** One frame: its rAF time, what each watched element draws, and whether hydration has run. */
interface Recorded {
  readonly at: number
  readonly hydrated: boolean
  readonly drawn: Readonly<Record<string, Drawn>>
}

interface Run {
  readonly frames: ReadonlyArray<Recorded>
  /** Each watched element's CSS animation's start, on the rAF timeline. */
  readonly startOf: Readonly<Record<string, number>>
  readonly host: HTMLElement
  /** Each watched element's inline `transform` right after `hydrate()` returned, before the first commit. */
  readonly hydratedStyle: Readonly<Record<string, string>>
}

const cleanups: Array<() => void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  await commands.emulateReducedMotion(false)
})

const drawnOf = (el: Element): Drawn => {
  const computed = getComputedStyle(el)
  // "none" isn't a matrix DOMMatrix reads; the identity is.
  const m = new DOMMatrix(computed.transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
  return {
    opacity: Number(computed.opacity),
    x: m.m41,
    y: m.m42,
    rotate: (Math.atan2(m.m12, m.m11) * 180) / Math.PI,
    cx: Number.parseFloat(computed.getPropertyValue("cx")) || 0,
    r: Number.parseFloat(computed.getPropertyValue("r")) || 0,
    dash: Number.parseFloat(computed.getPropertyValue("stroke-dasharray")) || 0,
    scale: m.m11,
    width: el.getBoundingClientRect().width,
    top: el.getBoundingClientRect().top,
    css: el.getAnimations().length > 0,
  }
}

let runs = 0

/** Server-render `name`, put it on the page with its head, hydrate after `hydrateAfter` ms (never, without), and record `forMs` of frames. */
const run = async (
  name: string,
  code: () => JSX.Element,
  options: { readonly hydrateAfter?: number; readonly forMs: number; readonly then?: { readonly afterMs: number; readonly act: () => void } },
): Promise<Run> => {
  const renderId = `${name}-${runs++}`
  const { html, head, script, error } = await commands.serverRenderPage(FILE, name, renderId)
  if (error !== "") throw new Error(`server render of ${name} failed: ${error}`)
  expect(head, "the head carries the Appear style").toContain("data-wardic-appear")
  if ((globalThis as { _$HY?: unknown })._$HY === undefined) {
    const tag = document.createElement("script")
    tag.textContent = /<script[^>]*>([\s\S]*?)<\/script>/.exec(script)?.[1] ?? ""
    document.head.append(tag)
  }
  const holder = document.createElement("div")
  holder.innerHTML = head
  const styles = [...holder.children]
  document.head.append(...styles)
  const host = document.createElement("div")
  host.innerHTML = html
  document.body.append(host)
  const watched = [...host.querySelectorAll("[data-k]")]
  let hydrated = false
  let dispose = (): void => {}
  cleanups.push(() => {
    dispose()
    host.remove()
    for (const style of styles) style.remove()
  })
  const startOf: Record<string, number> = {}
  const hydratedStyle: Record<string, string> = {}
  const frames: Array<Recorded> = []
  const begun = performance.now()
  if (options.then !== undefined) {
    const { afterMs, act } = options.then
    const timer = setTimeout(act, afterMs)
    cleanups.push(() => clearTimeout(timer))
  }
  if (options.hydrateAfter !== undefined) {
    setTimeout(() => {
      ;(globalThis as { _$HY?: { done?: boolean } })._$HY!.done = false
      sharedConfig.done = false
      dispose = hydrate(code, host, { renderId })
      hydrated = true
      for (const el of watched) hydratedStyle[(el as HTMLElement).dataset.k!] = (el as HTMLElement).style.transform
    }, options.hydrateAfter)
  }
  // Read after the frame's callbacks, the engine's tick among them (the order of rAF callbacks is
  // the order they were asked for, and the engine asks each tick): a task posted from this frame's
  // callback runs after its paint. A read that runs after the next frame has started is skipped
  // (#184's late post-paint reads): it would show that frame's values.
  let frameCount = 0
  let counting = true
  const count = (): void => {
    frameCount++
    if (counting) requestAnimationFrame(count)
  }
  requestAnimationFrame(count)
  await new Promise<void>((resolve) => {
    const frame = (now: number): void => {
      const seen = frameCount
      setTimeout(() => {
        if (frameCount !== seen) return
        const drawn: Record<string, Drawn> = {}
        for (const el of watched) {
          const k = (el as HTMLElement).dataset.k!
          Option.map(Appear.find(el), (animation) => {
            if (startOf[k] === undefined && typeof animation.startTime === "number") startOf[k] = animation.startTime
          })
          drawn[k] = drawnOf(el)
        }
        frames.push({ at: now, hydrated, drawn })
      }, 0)
      if (performance.now() - begun < options.forMs) requestAnimationFrame(frame)
      else setTimeout(resolve, 20)
    }
    requestAnimationFrame(frame)
  })
  counting = false
  return { frames, startOf, host, hydratedStyle }
}

/** Run each `<script>` under `root` as the parser would: an `innerHTML` one doesn't. */
const runScripts = (root: ParentNode): void => {
  for (const old of [...root.querySelectorAll("script")]) {
    const script = document.createElement("script")
    script.textContent = old.textContent
    old.replaceWith(script)
  }
}

/**
 * Stream `name` (#245): its head and shell on the page, its later writes (a late chunk's
 * `<template>` and the script that places it) landing `chunkAfter` ms later as the stream would,
 * and hydration `hydrateAfter` ms after the shell. Each frame finds the `data-k` elements afresh:
 * a chunk's come later.
 */
const runStreamed = async (
  name: string,
  code: () => JSX.Element,
  options: { readonly chunkAfter: number; readonly hydrateAfter: number; readonly forMs: number },
): Promise<Run> => {
  const renderId = `${name}-${runs++}`
  const { writes, script, error } = await commands.serverStreamPage(FILE, name, renderId)
  if (error !== "") throw new Error(`stream of ${name} failed: ${error}`)
  if ((globalThis as { _$HY?: unknown })._$HY === undefined) {
    const tag = document.createElement("script")
    tag.textContent = /<script[^>]*>([\s\S]*?)<\/script>/.exec(script)?.[1] ?? ""
    document.head.append(tag)
  }
  const [shell = "", ...later] = writes
  const holder = document.createElement("div")
  holder.innerHTML = /^<head>([\s\S]*?)<\/head>/.exec(shell)?.[1] ?? ""
  const styles = [...holder.children]
  document.head.append(...styles)
  const host = document.createElement("div")
  host.innerHTML = shell.replace(/^<head>[\s\S]*?<\/head>/, "")
  document.body.append(host)
  runScripts(host)
  const landed: Array<Element> = []
  let hydrated = false
  let dispose = (): void => {}
  cleanups.push(() => {
    dispose()
    host.remove()
    for (const node of [...styles, ...landed]) node.remove()
    for (const style of document.head.querySelectorAll("style[data-wardic-appear]")) style.remove()
  })
  const chunk = setTimeout(() => {
    for (const write of later) {
      const box = document.createElement("div")
      box.innerHTML = write
      for (const node of [...box.children]) {
        document.body.append(node)
        landed.push(node)
      }
      runScripts(document.body)
    }
  }, options.chunkAfter)
  cleanups.push(() => clearTimeout(chunk))
  const hydration = setTimeout(() => {
    ;(globalThis as { _$HY?: { done?: boolean } })._$HY!.done = false
    sharedConfig.done = false
    dispose = hydrate(code, host, { renderId })
    hydrated = true
  }, options.hydrateAfter)
  cleanups.push(() => clearTimeout(hydration))
  const startOf: Record<string, number> = {}
  const frames: Array<Recorded> = []
  const begun = performance.now()
  await new Promise<void>((resolve) => {
    const frame = (now: number): void => {
      setTimeout(() => {
        const drawn: Record<string, Drawn> = {}
        for (const el of host.querySelectorAll("[data-k]")) {
          const k = (el as HTMLElement).dataset.k!
          Option.map(Appear.find(el), (animation) => {
            if (startOf[k] === undefined && typeof animation.startTime === "number") startOf[k] = animation.startTime
          })
          drawn[k] = drawnOf(el)
        }
        frames.push({ at: now, hydrated, drawn })
      }, 0)
      if (performance.now() - begun < options.forMs) requestAnimationFrame(frame)
      else setTimeout(resolve, 20)
    }
    requestAnimationFrame(frame)
  })
  return { frames, startOf, host, hydratedStyle: {} }
}

/** The machine's values `seconds` in, as `Machine.startAt` draws them. */
const machineAt = (machine: Machine.Machine<Frame.Frame<Values.Values>>, seconds: number): Values.Values =>
  Machine.startAt(machine, () => Math.max(0, seconds)).start()(1 / 60).value

const tween = (from: Values.Values, to: Values.Values, options: Machine.AnimateOptions) =>
  Effect.runSync(Effect.provide(Machine.animateValues(from, to, options), DomInterpolators.layer))

/** When a machine settles, stepped as the sampler steps it: 0, then 1/60 s at a time. */
const settledAt = (machine: Machine.Machine<Frame.Frame<Values.Values>>): number => {
  const step = machine.start()
  let frame = step(0)
  let steps = 0
  while (!frame.done) {
    frame = step(Machine.CATCH_UP_DT)
    steps++
  }
  return steps * Machine.CATCH_UP_DT
}

/** Tolerances: a little over the sampler's own, for the browser's rounding. */
const TOL = { opacity: 0.012, px: 0.6, deg: 1.5, dash: 0.006 }

/** Every frame of `k` against `expected(seconds since its CSS started)`; returns how many frames came after hydration. */
const followsMachine = (
  r: Run,
  k: string,
  expected: (seconds: number) => { readonly opacity?: number; readonly x?: number; readonly y?: number; readonly rotate?: number; readonly cx?: number; readonly r?: number; readonly dash?: number },
): number => {
  const start = r.startOf[k]
  expect(start, `${k}'s CSS animation was found`).toBeDefined()
  let after = 0
  for (const frame of r.frames) {
    if (frame.at < start!) continue
    const seconds = (frame.at - start!) / 1000
    const want = expected(seconds)
    const got = frame.drawn[k]!
    const where = `${k} at ${seconds.toFixed(3)} s (${["before hydration", "hydrated"][Number(frame.hydrated)]})`
    if (want.opacity !== undefined) expect(Math.abs(got.opacity - want.opacity), `${where}: opacity ${got.opacity} vs ${want.opacity}`).toBeLessThanOrEqual(TOL.opacity)
    if (want.x !== undefined) expect(Math.abs(got.x - want.x), `${where}: x ${got.x} vs ${want.x}`).toBeLessThanOrEqual(TOL.px)
    if (want.y !== undefined) expect(Math.abs(got.y - want.y), `${where}: y ${got.y} vs ${want.y}`).toBeLessThanOrEqual(TOL.px)
    if (want.cx !== undefined) expect(Math.abs(got.cx - want.cx), `${where}: cx ${got.cx} vs ${want.cx}`).toBeLessThanOrEqual(TOL.px)
    if (want.r !== undefined) expect(Math.abs(got.r - want.r), `${where}: r ${got.r} vs ${want.r}`).toBeLessThanOrEqual(TOL.px)
    if (want.dash !== undefined) expect(Math.abs(got.dash - want.dash), `${where}: dash ${got.dash} vs ${want.dash}`).toBeLessThanOrEqual(TOL.dash)
    if (want.rotate !== undefined) {
      const diff = Math.abs((((got.rotate - want.rotate) % 360) + 540) % 360 - 180)
      expect(diff, `${where}: rotate ${got.rotate} vs ${want.rotate}`).toBeLessThanOrEqual(TOL.deg)
    }
    if (frame.hydrated) after++
  }
  return after
}

describe("Appear animations, server render to hydration (#48, ADR-0044)", () => {
  // A1's card gives no transition: each key on the DOM's Default transition (ADR-0051), y on Motion's
  // 500 / 25 spring and opacity on its 0.3 s ease, which the server samples as the client runs them.
  const lift = Machine.springValues({ y: 0 }, DomDefaultTransition.transitionFor("y", 0) as Machine.SpringOptions, { y: 40 })
  const fade = tween({ opacity: 0 }, { opacity: 1 }, DomDefaultTransition.transitionFor("opacity", 1) as Machine.AnimateOptions)
  const card = (s: number) => ({ opacity: machineAt(fade, s).opacity as number, y: machineAt(lift, s).y as number })

  it("AH1: a spring plays from first paint, and the Handoff mid-flight draws the machine before, at and after it", async () => {
    const r = await run("A1", A1, { hydrateAfter: 180, forMs: 1600 })
    const before = r.frames.filter((f) => !f.hydrated && f.drawn.card!.css)
    expect(before.some((f) => f.drawn.card!.opacity > 0.1 && f.drawn.card!.opacity < 0.95), "it moved before hydration").toBe(true)
    expect(followsMachine(r, "card", card), "frames after hydration").toBeGreaterThan(30)
    const last = r.frames.at(-1)!.drawn.card!
    expect(last.css, "the CSS animation is gone").toBe(false)
    expect(r.host.querySelector<HTMLElement>("[data-k=card]")!.style.getPropertyValue("animation")).toBe("")
    expect(last.opacity).toBeCloseTo(1, 2)
    expect(last.y).toBeCloseTo(0, 1)
  })

  it("AH2: a tween handed off mid-flight", async () => {
    const machine = tween({ opacity: 0, x: 0 }, { opacity: 1, x: 200 }, { ease: Easing.easeOut, duration: 1.2 })
    const r = await run("A3", A3, { hydrateAfter: 400, forMs: 1600 })
    expect(followsMachine(r, "slow", (s) => {
      const v = machineAt(machine, s)
      return { opacity: v.opacity as number, x: v.x as number }
    })).toBeGreaterThan(30)
    expect(r.frames.at(-1)!.drawn.slow!.x).toBeCloseTo(200, 1)
  })

  it("AH3: hydrated after the CSS ended, the element stays at its target", async () => {
    const r = await run("A1", A1, { hydrateAfter: 1300, forMs: 1800 })
    const settled = r.frames.filter((f) => f.at - r.startOf.card! > 1100)
    expect(settled.length).toBeGreaterThan(20)
    for (const f of settled) {
      expect(f.drawn.card!.opacity).toBeCloseTo(1, 2)
      expect(Math.abs(f.drawn.card!.y)).toBeLessThanOrEqual(0.1)
    }
    expect(settled.some((f) => f.hydrated)).toBe(true)
  })

  it("AH4: never hydrated (JS off), it plays to its end and holds it", async () => {
    const r = await run("A1", A1, { forMs: 1400 })
    followsMachine(r, "card", card)
    const last = r.frames.at(-1)!.drawn.card!
    expect(last.opacity).toBeCloseTo(1, 2)
    expect(last.y).toBeCloseTo(0, 1)
  })

  it("AH5: a stagger: each item from its own delay, through the Handoff", async () => {
    const r = await run("A2", A2, { hydrateAfter: 260, forMs: 1300 })
    ;["i0", "i1", "i2"].forEach((k, i) => {
      const machine = tween({ opacity: 0, x: -30 }, { opacity: 1, x: 0 }, { ease: Easing.easeOut, duration: 0.5, delay: 0.12 * i })
      expect(followsMachine(r, k, (s) => {
        const v = machineAt(machine, s)
        return { opacity: v.opacity as number, x: v.x as number }
      }), k).toBeGreaterThan(20)
    })
  })

  it("AH6: when: beforeChildren: the child waits for its parent, before and after the Handoff", async () => {
    const parent = tween({ opacity: 0 }, { opacity: 1 }, { ease: Easing.easeOut, duration: 0.3 })
    // The child starts when the parent's tween settles, stepped in 60 Hz frames as the server samples
    // it: the frame its steps' sum reaches 0.3 s (18 × 1/60 rounds just over; 30 × 1/60 for 0.5 s just under).
    const child = tween({ opacity: 0, y: 20 }, { opacity: 1, y: 0 }, { ease: Easing.easeOut, duration: 0.4, delay: settledAt(parent) })
    const r = await run("A4", A4, { hydrateAfter: 150, forMs: 1200 })
    followsMachine(r, "parent", (s) => ({ opacity: machineAt(parent, s).opacity as number }))
    expect(followsMachine(r, "child", (s) => {
      const v = machineAt(child, s)
      return { opacity: v.opacity as number, y: v.y as number }
    })).toBeGreaterThan(20)
  })

  it("AH7: a loop for ever, handed off in its second cycle", async () => {
    const r = await run("A5", A5, { hydrateAfter: 1000, forMs: 1800 })
    expect(followsMachine(r, "spin", (s) => ({ rotate: ((s % 0.8) / 0.8) * 360 }))).toBeGreaterThan(20)
    expect(r.frames.at(-1)!.drawn.spin!.css, "the engine runs it now").toBe(false)
  })

  it("AH9: reduced motion and a stagger: each item's positional key holds its start through its delay, then snaps", async () => {
    await commands.emulateReducedMotion(true)
    const r = await run("A2", A2, { hydrateAfter: 200, forMs: 1300 })
    ;["i0", "i1", "i2"].forEach((k, i) => {
      const delay = 0.12 * i
      const opacity = tween({ opacity: 0 }, { opacity: 1 }, { ease: Easing.easeOut, duration: 0.5, delay })
      // A display frame near the snap can land on either side of it: those frames don't count.
      const nearSnap = (s: number) => Math.abs(s - delay) < 0.02
      const want = (s: number) => {
        const values: { opacity: number; x?: number } = { opacity: machineAt(opacity, s).opacity as number }
        if (!nearSnap(s)) values.x = [0, -30][Number(s < delay)]!
        return values
      }
      expect(followsMachine(r, k, want), k).toBeGreaterThan(20)
    })
  })

  it("AH8: reduced motion: the positional key at its target from the first frame, opacity animating", async () => {
    await commands.emulateReducedMotion(true)
    const opacity = fade
    const r = await run("A1", A1, { hydrateAfter: 180, forMs: 1400 })
    expect(followsMachine(r, "card", (s) => ({ opacity: machineAt(opacity, s).opacity as number, y: 0 }))).toBeGreaterThan(20)
  })

  it("AH10: SVG attributes played as CSS, handed off mid-flight to the engine's attributes (#245)", async () => {
    const dot = tween({ cx: 10, r: 4, opacity: 0 }, { cx: 90, r: 16, opacity: 1 }, { ease: Easing.easeOut, duration: 1.2 })
    const line = tween({ pathLength: 0 }, { pathLength: 1 }, { ease: Easing.easeOut, duration: 1.2 })
    const r = await run("A6", A6, { hydrateAfter: 450, forMs: 1700 })
    const before = r.frames.filter((f) => !f.hydrated && f.drawn.dot!.css)
    expect(before.some((f) => f.drawn.dot!.cx > 15 && f.drawn.dot!.cx < 85), "it moved before hydration").toBe(true)
    expect(followsMachine(r, "dot", (s) => {
      const v = machineAt(dot, s)
      return { cx: v.cx as number, r: v.r as number, opacity: v.opacity as number }
    })).toBeGreaterThan(30)
    expect(followsMachine(r, "line", (s) => ({ dash: machineAt(line, s).pathLength as number }))).toBeGreaterThan(30)
    const last = r.frames.at(-1)!.drawn
    expect(last.dot!.css, "the CSS animation is gone").toBe(false)
    expect(last.dot!.cx).toBeCloseTo(90, 1)
    const circle = r.host.querySelector("circle")!
    expect(circle.getAttribute("cx"), "the engine writes the attribute").toBe("90")
    expect(r.host.querySelector("path")!.getAttribute("stroke-dasharray")).toBe("1 1")
  })

  it("AH11: a layout card drawn as a layout node from first paint, handed off, its next layout change from its true box (#245)", async () => {
    const card = tween({ opacity: 0, scale: 0.5, y: 30 }, { opacity: 1, scale: 1, y: 0 }, { ease: Easing.easeOut, duration: 1.2 })
    // The layout change, once the entrance has ended: the spacer above grows by 60 px.
    const grow = { afterMs: 1900, act: () => (globalThis as { __a7grow?: () => void }).__a7grow?.() }
    // The client's debug logs, for its Handoff's check.
    const logs: Array<string> = []
    setAppearEnv(
      Layer.mergeAll(DomLive, Logger.layer([Logger.map(Logger.formatStructured, (s) => void logs.push(String(s.message)))]), Layer.succeed(References.MinimumLogLevel, "Debug")),
    )
    cleanups.push(() => setAppearEnv(DomLive))
    const r = await run("A7", A7, { hydrateAfter: 350, forMs: 2700, then: grow })
    // The client starts it from the server's Starting style, its own y on its projection at rest (#363),
    // and its spec is the server's.
    expect(r.hydratedStyle.card, "the Starting style hydration keeps").toBe("translate3d(0px, 30px, 0px) scale(0.5, 0.5)")
    expect(logs.filter((m) => m.includes("another mount animation")), "the Handoff matched").toEqual([])
    // Its own y is drawn, on its projection's translate, before and after the Handoff (#363).
    const before = r.frames.filter((f) => !f.hydrated && f.drawn.card!.css)
    expect(before.some((f) => f.drawn.card!.scale > 0.55 && f.drawn.card!.scale < 0.95), "it moved before hydration").toBe(true)
    const start = r.startOf.card!
    const entrance = { ...r, frames: r.frames.filter((f) => f.at - start < 1700) }
    expect(followsMachine(entrance, "card", (s) => {
      const v = machineAt(card, s)
      return { opacity: v.opacity as number, y: v.y as number }
    })).toBeGreaterThan(30)
    // Its scale, through the Handoff to rest.
    for (const f of r.frames.filter((frame) => frame.at >= start && frame.at - start < 1500)) {
      const want = machineAt(card, (f.at - start) / 1000).scale as number
      expect(Math.abs(f.drawn.card!.scale - want), `scale at ${((f.at - start) / 1000).toFixed(3)} s`).toBeLessThanOrEqual(0.006)
    }
    // The layout change: the first frame it draws is where the card was, its true size, then it moves down 60 px.
    const atRest = r.frames.filter((f) => f.at - start > 1400 && f.at - start < 1700)
    expect(atRest.length).toBeGreaterThan(5)
    const rest = atRest.at(-1)!.drawn.card!
    expect(rest.width).toBeCloseTo(40, 0)
    const changed = r.frames.findIndex((f) => f.at - start > 1700 && Math.abs(f.drawn.card!.top - rest.top) > 0.5)
    expect(changed, "it moved").toBeGreaterThan(0)
    const first = r.frames[changed]!.drawn.card!
    expect(first.width, "its true size: no jump to the box the CSS drew at mount").toBeCloseTo(40, 0)
    expect(first.top - rest.top, "from where it was, not jumped").toBeLessThan(15)
    expect(r.frames.at(-1)!.drawn.card!.top - rest.top, "landing 60 px down").toBeGreaterThan(30)
  })

  it("AH12: a list's items streamed in a chunk that lands before the JS: played from the landing, handed off, the chunk's style adopted (#245)", async () => {
    const r = await runStreamed("A8", A8, { chunkAfter: 120, hydrateAfter: 650, forMs: 1500 })
    const items = ["s0", "s1", "s2"]
    for (const k of items) expect(r.startOf[k], `${k} played its CSS`).toBeDefined()
    // Each from its chunk's landing, staggered among the late ones (a fresh mount, decision 5).
    expect(Math.abs(r.startOf.s0! - r.startOf.s2!), "one chunk, one landing").toBeLessThan(20)
    const before = r.frames.filter((f) => !f.hydrated && f.drawn.s0 !== undefined && f.drawn.s0.css)
    expect(before.some((f) => f.drawn.s0!.opacity > 0.1 && f.drawn.s0!.opacity < 0.95), "it moved before hydration").toBe(true)
    items.forEach((k, i) => {
      const machine = tween({ opacity: 0, x: -30 }, { opacity: 1, x: 0 }, { ease: Easing.easeOut, duration: 0.5, delay: 0.12 * i })
      expect(followsMachine(r, k, (s) => {
        const v = machineAt(machine, s)
        return { opacity: v.opacity as number, x: v.x as number }
      }), k).toBeGreaterThan(20)
    })
    // The chunk's style: out of the list, its rules in the head.
    const list = r.host.querySelector("[data-k=list]")!
    expect(list.querySelector("style"), "no style among the items").toBeNull()
    expect([...document.head.querySelectorAll("style[data-wardic-appear]")].some((s) => s.textContent!.includes(":root{")), "its rules in the head").toBe(true)
    // A later list update: the items in order, nothing between them.
    ;(globalThis as { __a8add?: () => void }).__a8add!()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect([...list.children].map((el) => (el as HTMLElement).dataset.k)).toEqual(["s0", "s1", "s2", "s3"])
  })
})
