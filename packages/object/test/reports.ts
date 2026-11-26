/**
 * What Wardic reports while a test's code runs (#977): each failure's message, as its log line names it,
 * from Effect's default logger (`console.log`, or `console.error` logging to stderr), a task waited first
 * for a forked report to log. Object's, three's and Solid's tests share it.
 */
export const reportsDuring = async (run: () => unknown): Promise<ReadonlyArray<string>> => reportsIn(await saidDuring(run))

/** Each failure's message in `said`, as its log line names it. */
export const reportsIn = (said: ReadonlyArray<string>): ReadonlyArray<string> => said.flatMap((line) => line.match(/wardic\.\w+: [\w' ]*?failed/g) ?? [])

/** Every line logged while a test's code runs, its causes with it (#981), a task waited first for a forked report to log. */
export const saidDuring = async (run: () => unknown): Promise<ReadonlyArray<string>> => {
  const said: Array<string> = []
  const keep = { log: console.log, error: console.error }
  const hear = (...args: Array<unknown>): void => void said.push(args.map(String).join(" "))
  console.log = hear
  console.error = hear
  try {
    await run()
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    Object.assign(console, keep)
  }
  return said
}
