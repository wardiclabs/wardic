// What the /ssr route's hydration report expects of each element marked `data-ssr-k`
// (#41). Its own module so the client entry can read it without loading the route.

/** What the report expects of each `data-ssr-k` element. */
export interface SsrExpected {
  /** The server paints the Starting style on this element (else, by design, it doesn't). */
  readonly starting: boolean
  /** The settled opacity, if it animates. */
  readonly settledOpacity?: number
  /** Why a row is special, shown in the report. */
  readonly note?: string
}

export const SSR_EXPECTED: Readonly<Record<string, SsrExpected>> = {
  div: { starting: true, settledOpacity: 1 },
  spread: { starting: true, settledOpacity: 1 },
  "card-root": { starting: true, settledOpacity: 1 },
  "card-ref": { starting: false, settledOpacity: 1, note: "applies no style: no server Starting style (ADR-0021 decision 6)" },
  "card-inner": { starting: true, note: "style on an inner element: it shows the Starting style until the first frame" },
  drag: { starting: true, settledOpacity: 1, note: "drag it along x" },
  reorder: { starting: false, note: "drag an item to reorder" },
  circle: { starting: true, settledOpacity: 1 },
  presence: { starting: true, settledOpacity: 1, note: "toggle it: it exits, then enters" },
  layout: { starting: true, settledOpacity: 1, note: "resize it: a layout animation" },
  "reduced-motion": { starting: false, note: "false on the server; the live preference after mount" },
}
