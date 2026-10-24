/** Formatting both apps share (#296). */

const DOLLARS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })

/** A price in cents, in dollars: `$148`. */
export const formatPrice = (cents: number): string => DOLLARS.format(cents / 100)

/** Text with `backticked` code, as parts: each code part flagged, so a page can render it as `<code>`. */
export const codeParts = (text: string): ReadonlyArray<{ readonly code: boolean; readonly text: string }> =>
  text.split("`").map((part, i) => ({ code: i % 2 === 1, text: part }))
