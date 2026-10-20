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

/**
 * The options of every computation the binding makes (#209 PR 4a): transparent to Solid 2's
 * hydration ids. A memo or an effect otherwise takes its owner's next child id, and adopts the
 * server's serialized value while hydrating; the binding makes them on the client only (a server
 * ward is lean, ADR-0021), so the client's later ids would miss the server's markup.
 */
export const CLIENT_ONLY = { transparent: true } as const
/** {@link CLIENT_ONLY}, deferred: an effect that skips its first run. */
export const CLIENT_ONLY_DEFERRED = { transparent: true, defer: true } as const

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
        }, CLIENT_ONLY_DEFERRED)
        return dispose
      }, CLIENT_ONLY)),
})
