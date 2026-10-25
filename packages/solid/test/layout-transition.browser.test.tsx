// A layout animation's transition (#171, ADR-0009 *Amendment (#171)*), in real paint: Motion's
// default, a 0.45 s tween, with no `transition`; Motion's `layout` key; and a `delay` alone keeping
// the default tween. Timed by the frames' own timestamps.
//
// - LTS1: no transition: a layout move lands at 0.45 s, and never steps back. Before #171 it was a
//   170/26 spring, still creeping past 0.6 s.
// - LTS2: the `layout` key gives layout its own transition over the element's.
// - LTS3: a `delay` alone keeps the default tween, held first; a spring field makes it a spring.
// - LTS4 (#301): with no `layout` entry, `default` drives layout over the own fields; a `layout` entry
//   wins over `default`.
// - LTS5 (#357, ADR-0051): with no `type`, a tween's field makes a tween, eased out as Motion's;
//   `{ type: "spring" }` is Motion's 100 / 10, which overshoots (core's 170 / 26 didn't).
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import { createSignal, For } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { EASE_OUT } from "../src/retarget-legs.ts"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

/** Each element's `left` as painted, and the frame's time, just after each of the next `n` frames from `act`. */
const paintsAfter = (act: () => void, read: () => ReadonlyArray<number>, n: number): Promise<Array<{ readonly t: number; readonly lefts: ReadonlyArray<number> }>> =>
  new Promise((resolve) => {
    const out: Array<{ t: number; lefts: ReadonlyArray<number> }> = []
    let acted = false
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      if (acted) out.push({ t: performance.now(), lefts: read() })
      else act()
      acted = true
      if (out.length >= n) return resolve(out)
      requestAnimationFrame(() => ch.port2.postMessage(undefined))
    }
    requestAnimationFrame(() => ch.port2.postMessage(undefined))
  })

/** Boxes on `transitions`, each moving 200 px right when `moved` flips; their painted lefts after the flip. */
const flight = async (transitions: ReadonlyArray<WardicTransition | undefined>, frames = 60) => {
  const [moved, setMoved] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", height: `${transitions.length * 60}px` }}>
        <For each={transitions}>
          {(transition, i) => (
            <wardic.div
              data-box
              layout
              layoutDependency={moved()}
              {...UndefinedOr.match(transition, { onUndefined: () => ({}), onDefined: (defined) => ({ transition: defined }) })}
              style={{ position: "absolute", top: `${i() * 60}px`, left: Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" }), width: "40px", height: "40px", background: "teal" }}
            />
          )}
        </For>
      </div>
    </WardicProvider>
  ))
  for (let i = 0; i < 5; i++) await raf()
  const boxes = Array.from(container.querySelectorAll("[data-box]"))
  const origin = boxes[0]!.getBoundingClientRect().left
  const samples = await paintsAfter(() => setMoved(true), () => boxes.map((b) => b.getBoundingClientRect().left - origin), frames)
  return samples
}

type Sample = { readonly t: number; readonly lefts: ReadonlyArray<number> }

/** The samples' mean frame interval, ms. */
const frameOf = (samples: ReadonlyArray<Sample>): number => (samples.at(-1)!.t - samples[0]!.t) / (samples.length - 1)

/** When box `i` first moved: the frame before its first moved sample, ms (a frame before the first sample when that's it). */
const startOf = (samples: ReadonlyArray<Sample>, i: number): number => {
  const start = samples.findIndex((s) => s.lefts[i]! > 0.01)
  if (start === 0) return samples[0]!.t - frameOf(samples)
  return samples[start - 1]!.t
}

/** How long box `i` took to land on its destination, 200 px on, from when it first moved, s. */
const landedAfter = (samples: ReadonlyArray<Sample>, i: number): number => {
  const land = samples.findIndex((s) => Math.abs(s.lefts[i]! - 200) < 0.01)
  return (samples[land]!.t - startOf(samples, i)) / 1000
}

it("LTS1: with no transition, a layout move lands at 0.45 s and never steps back", async () => {
  const samples = await flight([undefined])
  const lefts = samples.map((s) => s.lefts[0]!)
  expect(landedAfter(samples, 0), "lands at 0.45 s, s").toBeGreaterThan(0.4)
  expect(landedAfter(samples, 0), "lands at 0.45 s, s").toBeLessThan(0.5)
  for (let i = 1; i < lefts.length; i++) expect(lefts[i]!, `frame ${i}: never back`).toBeGreaterThanOrEqual(lefts[i - 1]! - 1e-6)
})

it("LTS2: the `layout` key gives layout its own transition over the element's", async () => {
  const slow: WardicTransition = { type: "spring", stiffness: 20, damping: 10 }
  const samples = await flight([{ ...slow, layout: { type: "tween", duration: 0.2 } }, slow])
  expect(landedAfter(samples, 0), "its layout key's 0.2 s tween, s").toBeLessThan(0.25)
  const at = samples.findIndex((s) => Math.abs(s.lefts[0]! - 200) < 1e-3)
  expect(samples[at + 6]!.lefts[1]!, "the element's slow spring, still on its way").toBeLessThan(195)
})

it("LTS3: a delay alone keeps the default tween, held first; a spring field makes it a spring", async () => {
  const samples = await flight([{ delay: 0.15 }, { stiffness: 300, damping: 30 }])
  const sprung = samples.findIndex((s) => s.lefts[1]! > 0.01)
  expect((startOf(samples, 0) - startOf(samples, 1)) / 1000, "held about 0.15 s first, s").toBeGreaterThan(0.12)
  expect(landedAfter(samples, 0), "then the default tween's 0.45 s").toBeGreaterThan(0.4)
  expect(landedAfter(samples, 0), "then the default tween's 0.45 s").toBeLessThan(0.5)
  // A spring's first step is a few percent of the move; the default tween's eases in under one.
  expect(samples[sprung]!.lefts[1]! / 200, "a spring's first step").toBeGreaterThan(0.02)
})

it("LTS4: with no layout entry, default drives layout over the own fields; a layout entry wins over default (#301)", async () => {
  const slow: WardicTransition = { type: "spring", stiffness: 20, damping: 10 }
  const samples = await flight([{ ...slow, default: { type: "tween", duration: 0.2 } }, { type: "tween", duration: 0.2, default: slow, layout: { type: "tween", duration: 0.2 } }, { type: "tween", duration: 0.2, default: slow }])
  expect(landedAfter(samples, 0), "default's 0.2 s tween, s").toBeLessThan(0.25)
  expect(landedAfter(samples, 1), "its layout entry's 0.2 s tween, s").toBeLessThan(0.25)
  const at = samples.findIndex((s) => Math.abs(s.lefts[0]! - 200) < 1e-3)
  expect(samples[at + 6]!.lefts[2]!, "default's slow spring, not the own 0.2 s").toBeLessThan(195)
})

it("LTS5: no type and a tween's field: a tween eased out; { type: \"spring\" }: Motion's 100 / 10, past its slot (#357)", async () => {
  const samples = await flight([{ duration: 0.6 }, { type: "spring" }])
  expect(landedAfter(samples, 0), "a 0.6 s tween, s").toBeGreaterThan(0.55)
  expect(landedAfter(samples, 0), "a 0.6 s tween, s").toBeLessThan(0.67)
  // Eased out: an eighth of the way in it has gone near a fifth (`easeOut(0.125)` is 0.19), where
  // the default layout ease has gone 0.04. Its start is known to a frame, so give a frame's worth.
  const start = startOf(samples, 0)
  const early = samples.find((s) => s.t - start >= 75)!
  const x = (early.t - start) / 600
  expect(early.lefts[0]! / 200, `at ${x.toFixed(3)} of the way in`).toBeGreaterThan(EASE_OUT(x) - 0.06)
  expect(Math.max(...samples.map((s) => s.lefts[1]!)), "Motion's bouncy spring, past its slot").toBeGreaterThan(215)
})
