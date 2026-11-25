/**
 * What Wardic reports while a test's code runs (#979): each failure's message, as its log line names it,
 * read from Effect's logger on `console.log`, a task waited first for a forked report to log.
 */
export const reportsDuring = async (run: () => void | Promise<void>): Promise<ReadonlyArray<string>> => {
  const said: Array<string> = []
  const log = console.log
  console.log = (...args: Array<unknown>) => void said.push(args.map(String).join(" "))
  try {
    await run()
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    console.log = log
  }
  return said.flatMap((line) => line.match(/wardic\.\w+: [a-z' ]+failed/g) ?? [])
}
