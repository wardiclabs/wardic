# Inertia transitions: `type: "inertia"` on any value

Motion's transitions take `type: "inertia"` (`.reference/motion` at `16c6122`, `generators/inertia.ts`):
- **It ignores the target.** A value glides from where it is (`keyframes[0]`) at its velocity (its own, or the transition's `velocity`), and rests at `origin + power × velocity`, through `modifyTarget`, springing back to `min` / `max` past one. With no velocity it stays.
- **A value that isn't a number** runs the generator on a 0→100 progress mixed between its two ends (`JSAnimation.ts:133`): at velocity 0 it stays where it is; with a velocity it stops `power × velocity`% of the way, past its target.
- **Its units are Motion's:** `timeConstant` in milliseconds (325), `power` 0.8, the bounce 500 / 10, `restDelta` 0.5.

Wardic's core had the machine, `Inertia` (ADR-0016, *Amendment (#140)*), which a drag's release runs on (`dragTransition`), but a transition was a spring or a tween. #435 is one of 1.0's Motion-parity gaps (#426).

## Decisions (grilled 2026-10-29, #435)

1. **Motion's: the target is ignored** (Q1: A). Each number glides from where it's drawn, at its velocity (its own, #464, or the transition's `velocity`), and rests `power × velocity` on, through `modifyTarget`, held within `min` / `max`. With no velocity it stays where it is, and the Retarget lands at once, told as one whose keys are already there (#448). A later Retarget to the same target starts nothing for it (#325), as Motion's protected key.
   - Rejected: B, the target as where it rests: an exponential ease-out under Motion's name, which a tween can do.
2. **A key that isn't a number runs on its Default transition** (Q2: B, ADR-0051), as if the transition defined none for it: a colour, or a length with units, eases to its target, its `delay`, reduced-motion opt-out and `skipAnimations` kept, while the numbers glide. A difference from Motion, whose progress mixer leaves it where it is, or past its target.
   - Rejected: A, Motion's progress glide; C, landing at once.

**Defaults, stated:**
- **The types:** a third arm on a transition and on a key's entry, `WardicInertia`: `type: "inertia"`, `velocity`, `power`, `timeConstant` (milliseconds, as Motion's and `dragTransition`'s), `bounceStiffness`, `bounceDamping`, `restDelta`, `restSpeed`, `modifyTarget`, `min`, `max` and `delay`. No `repeat`. Its defaults are Motion's generator's, core's already.
- **Where it runs:** wherever a transition does: `animate`, variants, the `while*` targets, exits, Animation controls and `createAnimate`. A return following a moving Live value (#130) runs on its Default transition, as a non-number does: it has a value to land on.
- **Keyframes:** two stops glide from the first, as Motion's `keyframes[0]`; more than two fail as a spring's do (ADR-0058, Motion's two-keyframe invariant).
- **Reduced motion and `skipAnimations`** (#468) land a key where its glide would rest (`Inertia.restOf`), not at its target.
- **A layout animation** under it runs on Motion's default layout tween, after its delay: a projection's progress has no velocity to glide on (Motion's lands it at once, by its progress mixer).
- **A sequence's Segment** under it runs on the Segment tween: a glide has no time to place on a timeline.
- **A server's Appear animation** samples it as the client runs it: with no velocity nothing moves.

## Built

- **Core** (`Machine.ts`): `inertiaValues(from, options, velocity)`, inertia on a bag of numbers, one glide per key from its start at its velocity (else `options.velocity`, else 0), after `options.delay`, each Frame with a per-key velocity, as `springValues`'. `InertiaValuesOptions` is `InertiaOptions` with `velocity` and `delay`.
- **The transition** (`config.ts`): `WardicInertia`, the third arm of `WardicTransitionWith` and `WardicValueTransition`; #305's option names take its fields (`ward-keys.ts`). Exported from both bindings.
- **The legs** (`retarget-legs.ts`):
  - `runOf` makes an inertia `Run` (`InertiaRun`), Motion's `timeConstant` as seconds.
  - `legsOn` splits an inertia's keys (`inertiaLegsOn`): numbers glide (`inertiaLegsWith`, one `Numbers` leg on `inertiaValues`, from each key's own velocity unless the transition gives one); every other key, and a following return, runs on its Default transition, on the transition's fields that define none (`definingNone`).
  - A skipped key's end (`endOfLeg`) and a reduced positional key's are `Inertia.restOf`, from the transition's velocity, else its own.
  - Keyframes of more than two stops fail, the error naming an inertia.
- **Layout** (`layout-member.ts`): an inertia `layout` transition is the default layout tween, its delay kept (`defaultLayoutAfter`).
- **Sequences** (`imperative.ts`): an inertia Segment runs on the Segment tween.
- **An editor's completions** (`ward-keys.ts`): a `wardic.*` element's inferred `transition` (#305) had `NoInfer` around the whole of it. With two arms, an editor offered what both share, a tween's `duration` among them; with a third that has none, it lost them (IC1, IC5, CI1). `NoInfer` now wraps the entries alone, the part that names the inferred keys, so the transition is a plain union of arms, and an editor offers each arm's options. A transition still gives the keys no names of its own (IK1).

## Tests

- **Core** (`inertia.test.ts`): IV1, each key of `inertiaValues` stepping as `Machine.inertia` does, from its own velocity else the options'; IV2, a delay held, and a key with no velocity resting where it starts.
- **The legs** (`retarget-legs.ssr.test.tsx`): IN1, a number gliding past its target at its own velocity, the transition's over it, and staying with none; IN2, a colour on its Default transition, its delay kept; IN3, `timeConstant` in milliseconds; IN4, reduced motion and `skipAnimations` landing a key where its glide rests (from the transition's velocity too), and more than two Keyframes failing.
- **Solid 1** (`inertia.browser.test.tsx`, IT1–IT5): a glide past its target bouncing back to `max`, told start and complete, and one with no velocity staying; a spring's velocity carried into a glide; a colour beside a glide easing to its target; `createAnimate`; a layout animation on the default tween.
- **Solid 2** (`v2/inertia.browser.test.tsx`, ITV1): a ward's glide bouncing back to `max`, `next("settled")` at its rest.
- **Mutation-checked** (`.tmp/435/mutate.py`, run alone): twelve single-point mutations, each caught: inertia read as a tween; `timeConstant` taken as seconds; a non-number gliding, or losing its delay; the key's own velocity or the transition's ignored; a skipped or reduced inertia landing at its target; many Keyframes gliding; a layout inertia passed to the projection; `inertiaValues` ignoring its delay or a key's own velocity. The transition's velocity on the skip and reduced paths survived at first; IN4 gives one now.

**Found:** a mount that starts at its `animate` (`initial={false}`, or an `initial` the same as `animate`) runs a key at its target when its transition gives a velocity, where Motion animates nothing at that first render (`blockInitialAnimation`, `animation-state.ts`). #448's rule skips such a key only when its transition gives none, as Motion's at-target check does after its first render. Older than this, and a spring's `velocity` meets it too; an inertia with a `velocity` shows it plainly (it glides at mount). IT1 and IT3 gave their inertia from the change on. Filed as #475, and fixed by it (ADR-0005, *Amendment (#475)*): IT1 gives its inertia from mount again.

**Bench:** `bun run bench:solid` (N = 1,000, against main at e328c70): passed. The page runs no inertia, so this is what every other element pays: an inertia check in `runOf` and `legsOn`. Warm: Solid 1 mount +0.1%, Retarget −0.6%, rest Retarget +0.8%, unmount −0.1%; Solid 2 −0.8%, −0.8%, +0.2%, −1.6%. Bytes ±0.2%; retained and the layout scenes flat.

