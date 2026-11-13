/**
 * `createScroll`'s values (#234, #240), for both bindings: four Atoms, one a value, each for the value's
 * life, set from the scroll of the elements there now and described as deriving as it does
 * (`LiveValue.derivesAs`), so an element's `style` follows them where they're set and runs them as
 * Timeline values. Solid-free: each binding reads its elements in its own effect.
 *
 * @module
 */
import * as LiveValue from "@wardic/core/LiveValue"
import * as Arr from "effect/Array"
import * as Atom from "effect/reactivity/Atom"
import type * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Rec from "effect/Record"
import type { Timelines } from "./timelines.ts"

/** `createScroll`'s four values, by name. */
export const SCROLL_KEYS = ["scrollX", "scrollY", "scrollXProgress", "scrollYProgress"] as const

/** A `createScroll`'s four Atoms, by name. */
export type ScrollAtoms = Readonly<Record<(typeof SCROLL_KEYS)[number], Atom.Writable<number>>>

/** The four Atoms, each 0 until a scroll sets it, held in `registry` until `onCleanup` runs. */
export const scrollAtomsOf = (registry: AtomRegistry.AtomRegistry, onCleanup: (fn: () => void) => void): ScrollAtoms => {
  const outs = Rec.fromIterableWith(SCROLL_KEYS, (key) => [key, Atom.make(0)] as const) as ScrollAtoms
  Arr.forEach(SCROLL_KEYS, (key) => onCleanup(registry.mount(outs[key])))
  return outs
}

// Module state (#460, Q7): an Atom no scroll describes, for values whose elements have gone. Never set.
const NO_SCROLL: Atom.Atom<number> = Atom.make(0)

/**
 * `outs` set from `values`, the scroll of the elements there now: each described as deriving as its value
 * does and read at once (a derived Atom tracks the scroll only once it's read). `timelines` is told, as
 * the elements following them may have shown them before they were described. Gives the stop.
 */
export const followScroll = (registry: AtomRegistry.AtomRegistry, outs: ScrollAtoms, values: LiveValue.ScrollValues, timelines: Timelines["Service"]): (() => void) => {
  const stops = Arr.map(SCROLL_KEYS, (key) => {
    LiveValue.derivesAs(outs[key], values[key])
    return registry.subscribe(values[key], (v) => registry.set(outs[key], v), { immediate: true })
  })
  timelines.described()
  return () => Arr.forEach(stops, (stop) => stop())
}

/**
 * `outs`, their elements gone (an accessor's ref back to `undefined`), described as no scroll's: they hold
 * their values, which the gate draws, and `timelines` is told, so no Timeline value draws the old scroll.
 */
export const letGoScroll = (outs: ScrollAtoms, timelines: Timelines["Service"]): void => {
  Arr.forEach(SCROLL_KEYS, (key) => LiveValue.derivesAs(outs[key], NO_SCROLL))
  timelines.described()
}
