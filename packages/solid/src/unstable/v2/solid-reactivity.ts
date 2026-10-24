/**
 * Solid 2's {@link Reactivity}, for the Solid-free modules the Solid 2 binding runs (#209), made
 * per ward under its owner.
 *
 * - A trigger's signal is written where Solid 2 allows a write: the flush gate's hooks, an effect's
 *   apply, an event. No internal signal is written in an owned scope but three, which say why
 *   (`ownedWrite`, #257's audit): a Variant child's registration, a ward given its element in a
 *   component's body, and a ward given its `.with()` props in a spread's run (#264).
 * - A watch is an effect in a root of its own under the ward's owner, so it ends with the ward, or
 *   at its stop. Not under the computation it's made in: Solid 2 disposes a root with the
 *   computation it's made in (a 1.x root outlived it), and a `style` re-run must not end a Live
 *   value's watch. Nor detached: Solid 2 refuses a root with no owner inside an effect's apply,
 *   where a ward mounts.
 *
 * @module
 */
import { createEffect, createRoot, createSignal, createTrackedEffect, type Owner, runWithOwner, untrack } from "solid-js"
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

const SETTLED = { name: "onSettled", ...CLIENT_ONLY }

/**
 * `onSettled` for client-only code (#209 PR 4b): Solid 2's own, a tracked effect running `callback`
 * untracked once the render has settled, made {@link CLIENT_ONLY}. Solid's takes a hydration id,
 * and a server's `onSettled` takes the same one, but code that runs on the client only has no server
 * call to take it: the keys after it would miss the server's markup. A tracked effect's declared
 * options are only `name`; it passes them to its node, as every computation does, which reads
 * `transparent` (`@solidjs/signals` rc.15 to rc.18, dev and prod builds).
 */
export const onSettledClientOnly = (callback: () => void | (() => void)): void => createTrackedEffect(() => untrack(callback), SETTLED)

/** Solid 2's reactive primitives, a watch made under `owner`. */
export const reactivityIn = (owner: Owner | null): Reactivity => ({
  untrack,
  trigger: () => {
    const [track, notify] = createSignal<undefined>(undefined, { equals: false })
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
