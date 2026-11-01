/**
 * Core's `dual` (#460, Q8): Effect's `dual`, one function called data-first (`Machine.map(m, f)`)
 * or data-last (`m.pipe(Machine.map(f))`), without Effect's allocation on every call.
 *
 * Effect's two-argument wrapper keeps its first argument for the data-last closure it may return,
 * so V8 gives every call a context for it, data-first calls too, unless TurboFan has inlined the
 * wrapper into its caller. Its other forms read `arguments`, which an unoptimized or Maglev caller
 * makes an object of. In Node, 34–42 B a data-first call, 104 B for `Bool.or` under Maglev, where
 * most of a binding's per-leg code runs. Here the data-last closure is made by a helper, and the
 * two forms are told apart without `arguments`, so a data-first call allocates nothing in any tier;
 * a data-last call allocates its closure.
 *
 * - **By the first argument:** `dual(isMachine, body)`, for an operation whose data-first form
 *   starts with its module's type and whose data-last form doesn't (`Machine.withSpan`'s optional
 *   options, `Machine.run`'s). Up to three arguments after it.
 * - **By arity:** `dual(2, body)` or `dual(3, body)`, for an operation whose last argument is never
 *   `undefined`: a call with it `undefined` reads as data-last.
 */
import * as Predicate from "effect/Predicate"

/** A last argument that wasn't passed: a data-last call. */
const ABSENT: unique symbol = Symbol.for("@wardic/core/dual/absent")

// Effect's own constraint, so a declared overload set types the result, as it does with Effect's `dual`.
type Body = (...args: Array<any>) => any

/** The data-last closures, made here so the wrappers below keep nothing a call could allocate. */
const lastOf1 = (body: Function, a: unknown) => (self: unknown) => body(self, a)
const lastOf2 = (body: Function, a: unknown, b: unknown) => (self: unknown) => body(self, a, b)
const lastOf3 = (body: Function, a: unknown, b: unknown, c: unknown) => (self: unknown) => body(self, a, b, c)

const byFirst = (isSelf: (first: unknown) => boolean, body: Function) =>
  function (first: unknown, a?: unknown, b?: unknown, c?: unknown): unknown {
    if (isSelf(first)) return body(first, a, b, c)
    return lastOf3(body, first, a, b)
  }

const byArity2 = (body: Function) =>
  function (a: unknown, b: unknown = ABSENT): unknown {
    if (b !== ABSENT) return body(a, b)
    return lastOf1(body, a)
  }

const byArity3 = (body: Function) =>
  function (a: unknown, b: unknown, c: unknown = ABSENT): unknown {
    if (c !== ABSENT) return body(a, b, c)
    return lastOf2(body, a, b)
  }

/**
 * `body`, callable data-first or data-last: told apart by `isSelf` on the first argument, or by
 * `arity`, the data-first form's argument count, its last argument never `undefined`.
 */
export const dual: {
  <DataLast extends Body, DataFirst extends Body>(arity: Parameters<DataFirst>["length"] & (2 | 3), body: DataFirst): DataLast & DataFirst
  <DataLast extends Body, DataFirst extends Body>(isSelf: (first: unknown) => boolean, body: DataFirst): DataLast & DataFirst
} = (form: 2 | 3 | ((first: unknown) => boolean), body: Function): never => {
  if (Predicate.isFunction(form)) return byFirst(form, body) as never
  if (form === 2) return byArity2(body) as never
  return byArity3(body) as never
}
