// What the /ssr route's hydration report expects of each element marked `data-ssr-k` (#41), as the
// Solid 1 example's, plus `ward-ref`. Its own module so the client entry can read it without loading
// the route.
import type { SsrExpected } from "@wardic/example-hand-checks/hydration-report"

export const SSR_EXPECTED: Readonly<Record<string, SsrExpected>> = {
  div: { starting: true, settledOpacity: 1 },
  spread: { starting: true, settledOpacity: 1 },
  "ward-ref": { starting: false, settledOpacity: 1, note: "ref={ward(config)}: client-only, no server Starting style" },
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
