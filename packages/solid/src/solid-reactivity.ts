/**
 * Solid 1's {@link Reactivity}, for the Solid-free modules the Solid 1 binding runs (#209).
 *
 * @module
 */
import { createComputed, createRoot, createSignal, on, untrack } from "solid-js"
import type { Reactivity } from "./reactivity.ts"

export const reactivity: Reactivity = {
  untrack,
  trigger: () => {
    const [track, notify] = createSignal(undefined, { equals: false })
    return { track, notify: () => notify() }
  },
  // A Solid 1 root isn't disposed with the owner it's made under.
  watch: (accessor, onChange) =>
    createRoot((dispose) => {
      createComputed(on(accessor, onChange, { defer: true }))
      return dispose
    }),
}
