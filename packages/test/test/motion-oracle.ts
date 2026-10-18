/**
 * Motion's timing, as an oracle for `Machine.animate` and `Machine.keyframes` (#226, ADR-0028
 * *Amendment (#226)*): where a Motion animation is `t` seconds in, by `JSAnimation.tick`'s iteration
 * math and the keyframes generator (motion-dom 13.3.0). Both are one time across every pass, gap and
 * Segment, which the composites now are too.
 *
 * Checked against Motion itself: `new JSAnimation({ …, autoplay: false }).sample(ms)` over a grid of
 * times and every combination of `repeat`, `repeatDelay`, `repeatType` and `delay`, with an
 * asymmetric easing, matched these to 1e-13 (`.tmp/226/check-oracle.ts` on the bench box; `.tmp` is
 * gitignored).
 */

/** `animate`'s options, as Motion's `JSAnimation` reads them, in seconds. */
export interface RunOptions {
  readonly duration: number
  readonly delay: number
  readonly repeat: number
  readonly repeatDelay: number
  readonly repeatType: "loop" | "reverse" | "mirror"
  readonly easing: (t: number) => number
}

/** A two-stop generator's value `elapsed` seconds in: Motion's keyframes generator over `[from, to]`. */
const tweenAt = (elapsed: number, from: number, to: number, o: RunOptions): number =>
  from + (to - from) * o.easing(Math.min(Math.max(elapsed / o.duration, 0), 1))

/** Where a run from `from` to `to` is `t` seconds in: `JSAnimation.tick` (motion-dom 13.3.0, `:122-221`). */
export const motionRunAt = (t: number, from: number, to: number, o: RunOptions): number => {
  const time = t - o.delay
  if (time < 0) return from
  const resolvedDuration = o.duration + o.repeatDelay
  const totalDuration = resolvedDuration * (o.repeat + 1) - o.repeatDelay
  let elapsed = time
  let mirrored = false
  if (o.repeat !== 0) {
    const progress = Math.min(time, totalDuration) / resolvedDuration
    let iteration = Math.floor(progress)
    let iterationProgress = progress % 1
    if (iterationProgress === 0 && progress >= 1) iterationProgress = 1
    if (iterationProgress === 1) iteration--
    iteration = Math.min(iteration, o.repeat + 1)
    if (iteration % 2 === 1) {
      if (o.repeatType === "reverse") {
        iterationProgress = 1 - iterationProgress
        if (o.repeatDelay !== 0) iterationProgress -= o.repeatDelay / resolvedDuration
      } else if (o.repeatType === "mirror") {
        mirrored = true
      }
    }
    elapsed = Math.min(Math.max(iterationProgress, 0), 1) * resolvedDuration
  }
  if (mirrored) return tweenAt(elapsed, to, from, o)
  return tweenAt(elapsed, from, to, o)
}

/** Whether a run is done `t` seconds in: Motion's, once its whole time has passed. */
export const motionRunDone = (t: number, o: RunOptions): boolean =>
  t - o.delay >= (o.duration + o.repeatDelay) * (o.repeat + 1) - o.repeatDelay

/**
 * Where keyframes through `stops` are `t` seconds into `duration` (after `delay`): Motion's keyframes
 * generator with its default offsets, evenly spaced, and one easing for every Segment.
 */
export const motionKeyframesAt = (t: number, stops: ReadonlyArray<number>, duration: number, delay: number, easing: (t: number) => number): number => {
  const progress = Math.min(Math.max((t - delay) / duration, 0), 1)
  const segments = stops.length - 1
  const i = Math.min(Math.floor(progress * segments), segments - 1)
  const local = progress * segments - i
  const a = stops[i] as number
  const b = stops[i + 1] as number
  return a + (b - a) * easing(local)
}
