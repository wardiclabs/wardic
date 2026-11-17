/**
 * Foldkit's `Reactivity` port (ADR-0071, decision 17): a host with no reactive graph. Accessors are
 * getters over the latest config each element received; `watch` keeps its last value and re-reads
 * once per patch, in the patch's microtask (`delivery.ts`), firing on `!Equal.equals`; `untrack` is a
 * plain call. One registry for every watch (P17: a child whose config is the same reference gets no
 * delivery, so it hears its parent only through a global re-check).
 *
 * @module
 */
import type * as Reactivity from "@wardic/core/unstable/Reactivity"
import * as Equal from "effect/Equal"
import { constVoid } from "effect/Function"
import * as Iter from "effect/Iterable"

/** A watch: its accessor, its last value, and what a change calls. */
interface Watch {
  readonly accessor: () => unknown
  readonly onChange: (value: unknown) => void
  last: unknown
}

// Module state (#460, Q7): the page's watches across providers, re-read once a patch.
const watches = new Set<Watch>()

/** Re-read every watch, firing each whose value changed by `Equal.equals` (P17). */
export const recheck = (): void =>
  Iter.forEach(watches, (watch) => {
    const now = watch.accessor()
    if (Equal.equals(watch.last, now)) return
    watch.last = now
    watch.onChange(now)
  })

/** The port. */
export const reactivity: Reactivity.Reactivity = {
  untrack: (fn) => fn(),
  trigger: () => ({ track: constVoid, notify: recheck }),
  watch: (accessor, onChange) => {
    const watch: Watch = { accessor, onChange: onChange as (value: unknown) => void, last: accessor() }
    watches.add(watch)
    return () => {
      watches.delete(watch)
    }
  },
}
