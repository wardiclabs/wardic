/**
 * How `run.ts` reports each workload, from the names each side ran (#74). A workload both sides
 * ran is gated. One side alone can't be gated:
 * - **`<name>/loop` only head ran** (a base from before ADR-0027) is reported against the base's
 *   `<name>`, the same Primitive as one fiber per element;
 * - **any other workload only head ran** is new (`animateComplex` against a base from before #65);
 * - **a workload only the base ran** was dropped, and still gets a line.
 */
export type Row =
  | { readonly kind: "gated"; readonly workload: string }
  | { readonly kind: "loop"; readonly workload: string; readonly fibers: string }
  | { readonly kind: "new"; readonly workload: string }
  | { readonly kind: "dropped"; readonly workload: string }

const LOOP = "/loop"

/** Every workload's row: head's in head's order, then the dropped ones in the base's. */
export const rowsOf = (base: ReadonlyArray<string>, head: ReadonlyArray<string>): ReadonlyArray<Row> => {
  const inBase = new Set(base)
  const inHead = new Set(head)
  const rowOf = (workload: string): Row => {
    if (inBase.has(workload)) return { kind: "gated", workload }
    const fibers = workload.slice(0, -LOOP.length)
    if (workload.endsWith(LOOP) && inBase.has(fibers)) return { kind: "loop", workload, fibers }
    return { kind: "new", workload }
  }
  const dropped = base.filter((workload) => !inHead.has(workload))
  return [...head.map(rowOf), ...dropped.map((workload): Row => ({ kind: "dropped", workload }))]
}
