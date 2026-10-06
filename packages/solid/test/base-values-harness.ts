// Shared by the base-value browser tests (#47, ADR-0022): painted-value reads, a per-frame
// recorder tagged by phase, and a hover-then-leave gesture with Playwright's real mouse.
import type { JSX } from "solid-js"
import "./browser-commands.ts"
import { until } from "./browser-helpers.ts"
import { centreOf, mouse, type Pt, sampleFrames, settle, wait } from "./reorder-harness.tsx"

export const sheet = document.createElement("style")
sheet.textContent = `
  .bv-half { opacity: 0.5; }
  .bv-third { opacity: 0.3; }
  .bv-fifth { opacity: 0.2; }
  .bv-shrunk { transform: scale(0.5); }
`
document.head.append(sheet)

export const BOX: JSX.CSSProperties = { position: "absolute", left: "120px", top: "120px", width: "100px", height: "100px", background: "rgb(0, 0, 255)" }
export const PARK: Pt = { x: 5, y: 5 }

/** The painted uniform scale: the computed transform matrix's x-axis length, 1 for none. */
export const scaleOf = (el: Element): number => {
  const t = getComputedStyle(el).transform
  if (t === "" || t === "none") return 1
  const m = /^matrix(3d)?\(([^)]+)\)$/.exec(t)
  if (m === null) return Number.NaN
  const v = m[2]!.split(",").map(Number)
  return Math.hypot(v[0]!, v[1]!)
}
/** The painted opacity. */
export const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)
/** The painted translateX (the computed matrix's e). */
export const translateXOf = (el: Element): number => {
  const t = getComputedStyle(el).transform
  if (t === "" || t === "none") return 0
  const v = /\(([^)]+)\)/.exec(t)![1]!.split(",").map(Number)
  return t.startsWith("matrix3d") ? v[12]! : v[4]!
}
/** The painted translateY (the computed matrix's f). */
export const translateYOf = (el: Element): number => {
  const t = getComputedStyle(el).transform
  if (t === "" || t === "none") return 0
  const v = /\(([^)]+)\)/.exec(t)![1]!.split(",").map(Number)
  return t.startsWith("matrix3d") ? v[13]! : v[5]!
}

/** Sample `read(el)` after every painted frame, tagged with the phase current at that frame. */
export const recorder = (el: Element, read: (el: Element) => number) => {
  let phase = "rest"
  const s = sampleFrames(() => ({ phase, v: read(el) }))
  return {
    set phase(p: string) {
      phase = p
    },
    stop: () => s.stop().map((f) => f.v),
  }
}
export const valuesIn = (frames: ReadonlyArray<{ phase: string; v: number }>, phase: string): Array<number> =>
  frames.filter((f) => f.phase === phase).map((f) => f.v)
export const min = (xs: ReadonlyArray<number>): number => Math.min(...xs)
export const max = (xs: ReadonlyArray<number>): number => Math.max(...xs)
export const last = (xs: ReadonlyArray<number>): number => xs[xs.length - 1]!

export const hover = (el: Element): Promise<void> => mouse.move(centreOf(el))
export const leave = (): Promise<void> => mouse.move(PARK)

/** Hover `el` until `read` reaches `reached`, then leave until it's back within 0.004 of `base`. */
export const hoverAndLeave = async (el: Element, read: (el: Element) => number, reached: (v: number) => boolean, base: number) => {
  const rec = recorder(el, read)
  await settle()
  rec.phase = "hover"
  await hover(el)
  await until(() => reached(read(el)), 3000)
  await wait(100)
  rec.phase = "leave"
  await leave()
  await until(() => Math.abs(read(el) - base) < 0.004, 3000)
  await settle()
  return rec.stop()
}

