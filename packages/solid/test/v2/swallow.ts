// Solid 2's dev build reports a diagnostic code to the console and its diagnostics channel; the
// browser projects fail a test on any (diagnostics-setup.ts). A test of a case Solid warns about on
// purpose swallows that one code: kept off the console, and named to the gate (#320).
import { allowDiagnostic } from "./diagnostics.ts"

/** Swallow one Solid diagnostic code for the rest of the test: the console's warns and errors, before the diagnostics gate sees them. */
export const swallow = (code: string): { readonly seen: () => number; readonly restore: () => void } => {
  allowDiagnostic(code, "the test swallows it")
  const warn = console.warn
  const error = console.error
  let seen = 0
  const filter =
    (to: (...args: Array<unknown>) => void) =>
    (...args: Array<unknown>): void => {
      const message = String(args[0])
      if (message.startsWith(`[${code}]`)) seen++
      if (message.includes(`[${code}]`)) return
      to(...args)
    }
  console.warn = filter(warn)
  console.error = filter(error)
  return {
    seen: () => seen,
    restore: () => {
      console.warn = warn
      console.error = error
    },
  }
}
