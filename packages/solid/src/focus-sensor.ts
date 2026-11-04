/**
 * `createFocus` (#548): in a module of its own, so it brings the `focus` Feature only to an app that uses it,
 * and on the pages that do (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type { Accessor } from "solid-js"
import { watchToSignal } from "./bridge.ts"
import type { Feature } from "./feature.ts"
import { focus } from "./features/focus.ts"
import { FocusGesture } from "./features/keys.ts"
import { serviceOf } from "./gesture-features.ts"
import { useBrought } from "./provider.tsx"

/** What it brings (ADR-0067 decision 12): its gesture's Feature, whatever its section has (#511). */
const FOCUS: ReadonlyArray<Feature> = [focus]

/**
 * `true` while `target` is focused, `false` once blurred. Wraps the core focus
 * watch (#318); `false` until the first transition.
 */
export const createFocus = (target: unknown): Accessor<boolean> => {
  const services = useBrought(FOCUS)
  return watchToSignal<boolean>((handlers) => serviceOf(services(), FocusGesture).watch(target, {}, handlers), false)
}
