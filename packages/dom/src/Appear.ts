/**
 * Appear animations (#48, ADR-0044): a server-rendered mount animation played in CSS from first
 * paint, which the engine takes over at mount, the **Handoff**. The DOM's half, for any binding:
 *
 * - **On a server:** `keyframes` samples a spec (the element's mount animation, built with core's
 *   machines) into one `@keyframes` rule, cached across requests; a render's `sheet` gives each
 *   element a slot, whose `animation` goes in its inline style, and writes the head's `<style>`
 *   text once the render has defined each slot's timing.
 * - **At mount:** `find` the element's animation, check it `matches` the client's own spec, start
 *   the run `elapsedOf` it in (`Machine.startAt`), and `release` the element in the task that
 *   writes the engine's first frame.
 *
 * `@wardic/dom/Appear` (ADR-0041).
 */
export {
  adoptChunks,
  animationOf,
  CHUNK_ATTRIBUTE,
  chunkStyle,
  delayOf,
  elapsedOf,
  find,
  keyframes,
  type Keyframes,
  matches,
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
