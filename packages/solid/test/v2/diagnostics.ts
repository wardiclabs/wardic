// The Solid 2 gate's per-test state (#320): every diagnostic it has seen, and the codes a test makes
// on purpose. `diagnostics-setup.ts` fills it, clears it before each test and judges it after; a test
// names a code it makes with `allowDiagnostic`.

/** One diagnostic the gate saw: its code, if it has one, and its first line. */
export interface Seen {
  readonly code: string | undefined
  readonly line: string
}

const allowed = new Map<string, string>()
const seen: Array<Seen> = []

/** Let `code` pass in this test, one the test makes on purpose, `why` saying so: it may come or not. */
export const allowDiagnostic = (code: string, why: string): void => {
  allowed.set(code, why)
}

/** Every diagnostic the gate has seen in this test so far, allowed or not. */
export const seenDiagnostics = (): ReadonlyArray<Seen> => [...seen]

/** The setup's: the state it fills, clears and judges. */
export const gateState = { allowed, seen }
