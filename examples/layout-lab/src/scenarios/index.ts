/**
 * The scenario registry, in display order: scenarios 1-10, then free-play.
 *
 * @module
 */
import { freePlay } from "./free-play.tsx"
import { s1 } from "./s1-click-layout-dependency.tsx"
import { s10 } from "./s10-sibling-resize-mid-flight.tsx"
import { s2 } from "./s2-ro-content-growth.tsx"
import { s3 } from "./s3-app-ro-signal.tsx"
import { s4 } from "./s4-raf-change.tsx"
import { s5 } from "./s5-animation-complete.tsx"
import { s6 } from "./s6-io-callback.tsx"
import { s7 } from "./s7-layout-id-switch.tsx"
import { s8 } from "./s8-effect-in-gate-batch.tsx"
import { s9 } from "./s9-cold-spring.tsx"
import type { ScenarioDef } from "./types.ts"

/** Every scenario the lab mounts: s1-s10, then free-play. */
export const scenarios: ReadonlyArray<ScenarioDef> = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, freePlay]
