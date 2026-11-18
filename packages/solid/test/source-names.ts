// `vite.source-names.ts`'s helper (#320): a Solid primitive that takes its call's label as its `name`,
// unless its options give one. Test runs only; the rewritten calls aren't type-checked.

/** A Solid primitive, as the rewrite calls it. */
type Primitive = (...args: Array<unknown>) => unknown

/** Where each primitive takes its options. */
const OPTIONS_AT: Readonly<Record<string, number>> = {
  createMemo: 1,
  createSignal: 1,
  createOptimistic: 1,
  createEffect: 2,
  createRenderEffect: 2,
  createTrackedEffect: 1,
  createProjection: 2,
  createReaction: 1,
}

/** `fn`, named `label` where it's called with no name of its own. */
export const named =
  (label: string, primitive: string, fn: Primitive): Primitive =>
  (...args) => {
    const at = OPTIONS_AT[primitive] ?? args.length
    const options = args[at]
    if (options === undefined) {
      const filled = [...args]
      while (filled.length < at) filled.push(undefined)
      filled[at] = { name: label }
      return fn(...filled)
    }
    if (typeof options === "object" && options !== null && !("name" in options)) {
      const filled = [...args]
      filled[at] = { ...options, name: label }
      return fn(...filled)
    }
    return fn(...args)
  }
