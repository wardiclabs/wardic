/**
 * A Discrete pair at progress `t` (ADR-0024, decision 3): `from` at 0 and below, then `to` from
 * the first frame past 0, as Motion's `mixImmediate`. On the per-frame path (ADR-0025), so a
 * statement `if` rather than a match: nothing allocated per call.
 */
export const discrete = <From, To>(from: From, to: To, t: number): From | To => {
  if (t > 0) return to
  return from
}
