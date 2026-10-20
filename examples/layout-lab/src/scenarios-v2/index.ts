/**
 * The scenarios on the Solid 2 binding (#209 PR 5): `#scenarios` under the `solid2` condition, as
 * `bun dev:v2` builds the lab. Solid 1's (`../scenarios/index.ts`) with the same ids, their Views
 * written for `@wardic/solid/unstable/v2` and Solid 2.
 *
 * @module
 */
import type { ScenarioDef } from "../scenarios/types.ts"
import { freePlay } from "./free-play.tsx"
import { s1 } from "./s1-click-layout-dependency.tsx"
import { s10 } from "./s10-sibling-resize-mid-flight.tsx"
import { s11 } from "./s11-drag-slot-moves.tsx"
import { s12 } from "./s12-drag-children.tsx"
import { s13 } from "./s13-drag-release.tsx"
import { s14 } from "./s14-reorder.tsx"
import { s15 } from "./s15-base-values.tsx"
import { s16 } from "./s16-crossfade.tsx"
import { s17 } from "./s17-declared-layout-change.tsx"
import { s2 } from "./s2-ro-content-growth.tsx"
import { s3 } from "./s3-app-ro-signal.tsx"
import { s4 } from "./s4-raf-change.tsx"
import { s5 } from "./s5-animation-complete.tsx"
import { s6 } from "./s6-io-callback.tsx"
import { s7 } from "./s7-layout-id-switch.tsx"
import { s8 } from "./s8-effect-in-gate-batch.tsx"
import { s9 } from "./s9-cold-spring.tsx"

/** Every Solid 2 scenario, in display order. */
export const scenarios: ReadonlyArray<ScenarioDef> = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, freePlay]
