/**
 * The lab's Wardic environment: the real browser environment (`DomLive`) plus the
 * timeline's tracer and Wardic's spans (`WardicSpans`, #746), so every `wardic.*` span
 * the provider's runtime creates is recorded.
 *
 * No `setImmediate` polyfill is installed here or anywhere in the module graph.
 * Whether Effect runs on `setImmediate` is decided once, before any module
 * evaluates, by the inline script in `index.html` (`?scheduler=microtask`).
 *
 * @module
 */
import { DomLive, WardicSpans } from "@wardic/dom"
import type { WardicEnv } from "#binding"
import * as Layer from "effect/Layer"
import type { Timeline } from "./probe/timeline.ts"

/**
 * Builds the environment for `WardicProvider`: `DomLive` merged with the
 * timeline's `Tracer` layer and `WardicSpans`, without which Wardic opens no spans.
 * The `WardicEnv` annotation is a compile-time check that the merge still satisfies
 * the provider.
 */
export const makeLabEnv = (timeline: Timeline): WardicEnv => Layer.mergeAll(DomLive, timeline.layer, WardicSpans)
