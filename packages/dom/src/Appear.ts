/**
 * Appear animations: a mount animation a server renders as CSS, played from the first paint, before any
 * code runs, which the engine takes over at mount from where it has got to. The DOM's half, for any
 * binding:
 * - **On a server:** `keyframes` samples an element's spec, its mount animation built with core's
 *   machines, into one `@keyframes` rule, cached across requests. A render's `sheet` gives each element a
 *   slot, whose `animation` goes in its inline style, and writes the head's `<style>` once every slot's
 *   timing is defined.
 * - **At mount:** `find` the element's animation, check it `matches` the client's own spec, start the run
 *   `elapsedOf` it in (`Machine.startAt`), and `release` the element in the task that writes the engine's
 *   first frame.
 * - **A Batch's members** (#706): `batchKeyframes` samples one rule for every member on one set of
 *   transitions, each member's own values read from custom properties; a sheet's `batch` gives them one
 *   slot, and each member its style. At the Handoff, `findAll` reads every member's animation in one call,
 *   each `matchesBatch` the client's key, and its change starts `elapsedOf` it in (`Batch.retarget`'s
 *   `startAt`).
 *
 * @example
 * import * as Appear from "@wardic/dom/Appear"
 *
 * // On a server, a sheet a render:
 * const render = Appear.sheet()
 * const slot = render.slot()
 * slot.define({ spec, delay: 0 }) // `slot.animation` goes in the element's style, `render.css()` in the head
 * // At mount:
 * const elapsed = Option.map(Appear.find(element), Appear.elapsedOf)
 */
// #48, ADR-0044: the **Handoff**. `@wardic/dom/Appear` (ADR-0041).
export {
  adoptChunks,
  animationOf,
  batchKeyframes,
  type BatchKeyframes,
  type BatchSlot,
  type BatchSpec,
  CHUNK_ATTRIBUTE,
  chunkStyle,
  delayOf,
  elapsedOf,
  find,
  findAll,
  keyframes,
  type Keyframes,
  matches,
  matchesBatch,
  MAX_SECONDS,
  nameOf,
  pending,
  type Play,
  PREFIX,
  release,
  sheet,
  type Sheet,
  type Slot,
  type Spec,
} from "./internal/appear.ts"
