/**
 * `createHover` (#548): in a module of its own, so it brings the `hover` Feature only to an app that uses it,
 * and on the pages that do (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type { Accessor } from "solid-js"
import { watchToSignal } from "./bridge.ts"
import type { Feature } from "./feature.ts"
import { hover } from "./features/hover.ts"
import { HoverGesture } from "./features/keys.ts"
import { serviceOf } from "./gesture-features.ts"
import { useBrought } from "./provider.tsx"

/** What it brings (ADR-0067 decision 12): its gesture's Feature, whatever its section has (#511). */
const HOVER: ReadonlyArray<Feature> = [hover]

/**
 * `true` while the pointer is inside `target`, `false` once it leaves. Wraps the
 * core hover watch (#318); `false` until the first transition.
 */
export const createHover = (target: unknown): Accessor<boolean> => {
  const services = useBrought(HOVER)
  return watchToSignal<boolean>(({ on, onDefect }) => serviceOf(services(), HoverGesture).watch(target, { on: (transition) => on(transition.active), onDefect }), false)
}
