/**
 * Solid 2's {@link Reactivity}, for the Solid-free modules the Solid 2 binding runs (#209), made
 * per ward under its owner.
 *
 * - A trigger's signal may be written from inside an owner (`ownedWrite`): Wardic's internal state,
 *   notified from the flush gate's hooks and from setup alike.
 * - A watch is an effect in a root of its own under the ward's owner, so it ends with the ward, or
 *   at its stop. Not under the computation it's made in: Solid 2 disposes a root with the
 *   computation it's made in (a 1.x root outlived it), and a `style` re-run must not end a Live
 *   value's watch. Nor detached: Solid 2 refuses a root with no owner inside an effect's apply,
 *   where a ward mounts.
 *
 * @module
 */
import { createEffect, createRoot, createSignal, type Owner, runWithOwner, untrack } from "solid-js"
import type { Reactivity } from "../../reactivity.ts"

/** Solid 2's reactive primitives, a watch made under `owner`. */
export const reactivityIn = (owner: Owner | null): Reactivity => ({
  untrack,
  trigger: () => {
    const [track, notify] = createSignal<undefined>(undefined, { equals: false, ownedWrite: true })
    return { track, notify: () => void notify(undefined) }
  },
  watch: (accessor, onChange) =>
    runWithOwner(owner, () =>
      createRoot((dispose) => {
        createEffect(accessor, (value) => {
          onChange(value)
        }, { defer: true })
        return dispose
      })),
})
