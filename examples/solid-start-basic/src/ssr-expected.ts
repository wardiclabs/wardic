// What the /ssr route's hydration report expects of each element marked `data-ssr-k`
// (#41). Its own module so the client entry can read it without loading the route.

/** What the report expects of each `data-ssr-k` element. */
export interface SsrExpected {
  /** The server paints the Starting style on this element (else, by design, it doesn't). */
  readonly starting: boolean
  /** The settled opacity, if it animates. */
  readonly settledOpacity?: number
  /**
   * The opacity it holds from the server's paint on (`initial={false}`, #134): the server
   * paints it there, and it never moves after hydration.
   */
  readonly holds?: number
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
  held: { starting: true, settledOpacity: 0.5, holds: 0.5, note: "initial={false}: at its animate from the server's paint on" },
  "held-variant": { starting: true, settledOpacity: 0.5, holds: 0.5, note: "takes initial={false} from its parent" },
  "held-presence": { starting: true, settledOpacity: 0.5, holds: 0.5, note: "toggle it: a later entry fades in" },
  "reduced-motion": { starting: false, note: "false on the server; the live preference after mount" },
}
