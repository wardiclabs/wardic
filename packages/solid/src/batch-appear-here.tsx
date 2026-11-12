/**
 * A Batch's Appear animation (#706, ADR-0044 *Amendment (#706)*) as Solid 1 renders it: its server plan
 * under the provider and config around it, and its Handoff's part of the Batch's env. Shared by
 * `createBatch` and `Reorder.BatchGroup`.
 *
 * @module
 */
import { DEV } from "solid-js"
import { batchKeyOf } from "./appear.ts"
import { type BatchEnv, type BatchServerAppear, batchServerAppearOf } from "./batch.ts"
import { useWardicAppear, useWardicSkipAnimations } from "./provider.tsx"
import { isHydrating } from "./server.ts"
import { useWardicConfig } from "./wardic-config.tsx"

/** A Batch's server plan for its members' Appear animation, under the provider and config around it. */
export const batchServerAppearHere = (): BatchServerAppear => batchServerAppearOf(useWardicAppear(), useWardicConfig(), useWardicSkipAnimations()())

/**
 * A Batch's Handoff's part of its env: whether it hydrates, and, in development alone, the key each
 * member's rule is checked against (Q9), out of a production build.
 */
export const batchHandoffHere = (): Pick<BatchEnv, "hydrating" | "appearKeyOf"> => {
  if (DEV) return { hydrating: isHydrating(), appearKeyOf: batchKeyOf }
  return { hydrating: isHydrating() }
}
