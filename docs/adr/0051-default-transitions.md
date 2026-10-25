# Default transitions: Motion's by value, picked by the Environment

With no transition, Wardic ran every value on one spring, 170 / 26 (`retarget-legs.ts`'s `NO_TRANSITION`). Motion picks a default by value (`.reference/motion` at `16c6122`, `motion-dom/src/animation/utils/default-transitions.ts`, `getDefaultTransition`):

| value | Motion's default |
|---|---|
| a transform but a scale (`x`, `y`, `rotate`…) | a spring, 500 / 25, `restSpeed` 10 |
| `scale`, `scaleX`, `scaleY` | a spring, 550, damped 2·√550 toward 0 (critically), else 30; `restSpeed` 10 |
| anything else (opacity, colours, a box's size, a filter) | a 0.3 s tween on `cubic-bezier(0.25, 0.1, 0.35, 1)` |
| more than two keyframes | a 0.8 s keyframes tween |

So an opacity fade with no transition sprang for most of a second in Wardic and eased for 0.3 s in Motion; an `x` move was 170 / 26 against 500 / 25. Beside it, two of Motion's rules for a transition that is given differed too:
- **No `type`.** Motion runs a transition with fields but no `type` as a tween, `easeOut`, 0.3 s unless given (`JSAnimation`'s `type = keyframes`), even `{ stiffness: 300 }`. Wardic ran it as a spring, and `{ duration: 0.5 }` was a type error, ignored at run time.
- **Missing fields.** Motion fills a spring's from `springDefaults`, 100 / 10 / 1 (a damping ratio of 0.5: `{ type: "spring" }` bounces), and a tween's easing with `animateMotionValue`'s `easeOut`. Wardic filled core's `Machine` defaults, 170 / 26 / 1 and linear.

Split from #344 (ADR-0050, Q4), as #357.

## Decisions (grilled 2026-10-25, #357)

1. **Motion's default by value** (Q1). A key whose transition isn't defined runs on its value's default, in every animation: `animate`, the `while*` props, an exit, variants. "Not defined" is Motion's `isTransitionDefined`, on the transition the key resolves to (#301: its entry, else `default`, else the own fields): none, or one with only the orchestration and `delay`. Wardic's reduced-motion opt-out and a target's `inherit` don't define one either. Wardic has no keyframe arrays, so Motion's 0.8 s keyframes default has nothing to apply to.
   - Rejected: one spring for everything, recorded as a divergence; Motion's springs for the transforms only.
2. **The Environment picks it** (Q2). The user: "different environments could have different defaults". Core defines the contract, `DefaultTransition` (a key and its target to a transition: a scale needs to see a target of 0), and `@wardic/dom` provides Motion's table, `DomDefaultTransition.layer`, in `DomLive`.
   - Rejected: a core function keyed on core's transform names (they're core's own, but a terminal Environment's defaults needn't be a browser's); the table in each binding.
3. **Core's fallback is one spring** (Q3). `DefaultTransition.oneSpring` runs every key on the spring defaults (170 / 26), naming no key. The Test Environment provides it, so headless tests and their frame counts stay put; only `DomLive` changes.
   - Rejected: no fallback, every Environment writing its own; Motion's table in the Test Environment too.
4. **No `type`: layout's rule** (Q4, ADR-0009 *Amendment (#171)* rule 7). A spring field (`stiffness`, `damping`, `mass`, `velocity`, `restDelta`, `restSpeed`) makes it a spring; anything else, a tween with the fields given. `{ duration: 0.5 }` is a 0.5 s tween, as Motion's; `{ stiffness: 300 }` stays a spring, where Motion would quietly tween it. The types take a tween's fields without `type`.
   - Rejected: Motion's literal rule (no `type` is a tween, a spring field ignored); keeping "no `type` is a spring".
5. **A typed transition's missing fields are Motion's, filled in the binding** (Q5): a spring's 100 / 10 / 1, a tween's `easeOut`, for a value and for a layout animation (`transition.layout`). Core's `Machine` keeps its own documented defaults, 170 / 26 and linear, for direct callers and Q3's one spring.
   - Rejected: changing core's `Machine` defaults (every direct caller and core frame count with them); keeping Wardic's as a divergence.
6. **A repeat defines a transition** (Q6). Motion counts `repeat`, `repeatType` and `repeatDelay` as orchestration, so `{ repeat: Infinity }` on `rotate` repeats its default spring. Wardic's springs don't repeat (`repeat` is a tween's field), so by Q4 that's a 0.3 s `easeOut` tween, repeated, for every value. It differs from Motion only for a transform with a repeat and nothing else, and is recorded as a divergence.
   - Rejected: Motion's rule with springs that repeat (new in core); Motion's rule with a spring default that runs once.
7. **Two follow-ups filed** (Q7): #359, Motion's duration-based springs (`bounce`, `visualDuration`, `duration` on a spring); #360, Motion's `ease` field and its names. *#360 is ADR-0052: the field is `ease` now, and the fills here are written with it (`Easing.easeOut`, `ease: [0.25, 0.1, 0.35, 1]`).*
8. **The examples take Motion's look** (Q8). The storefront and the README keep their animations without a transition, so they show the new defaults; a transition is pinned only where the new default reads wrong, with a comment. Tests about something else get explicit transitions, so their frame counts don't depend on the default.
   - The one pinned: the storefront FAQ's chevron (both apps). A rotate's 500 / 25 swung it to about 200° before it settled at 180°; it now flips on `{ duration: 0.2 }`, a tween eased out by Q4, and starts at its target with `initial={false}`, so the answer open on page load doesn't turn its chevron then (the user, on #362).

Defaults, stated:
- Both Solid bindings, as `retarget-legs.ts` is theirs.
- A field set to `undefined` gives nothing: `{ duration: undefined }` defines no transition (Motion's `for…in` would count it).
- **A not-defined transition keeps its `delay`** (a stagger's among it, ADR-0007) **and its reduced-motion opt-out,** laid over each key's default.
- **`type: "tween"` wins over a spring field;** `type: "spring"` over a tween's.
- **A layout animation keeps rule 7's default:** one that defines no transition, a `delay` alone, runs Motion's 0.45 s layout tween with that delay (ADR-0009 *Amendment (#171)*). A defined one follows Q4 and Q5, so `{ duration: 0.6 }` is a 0.6 s tween eased out and `{ type: "spring" }` is 100 / 10, as Motion's.
- **The drag release is unchanged:** it runs on the drag transition (ADR-0016 *Amendment (#140)*).
- **An Appear animation** (ADR-0044) samples each key's default as the client runs it: the server reads `DomDefaultTransition` directly, as it reads `DomPositionalKeys`.
- **Reduced motion** (ADR-0029) is unchanged: the positional keys snap, holding their default's delay, and the rest animate on theirs (a fade becomes the 0.3 s ease).

## Built

- **`@wardic/core/DefaultTransition`**: the `DefaultTransition` service (`transitionFor(key, target)`), its `Transition` (a spring or a tween, typed), and `oneSpring`, whose `ONE_SPRING` is `{ type: "spring" }`. An answer is one object per answer, so keys that share it share a leg and core's decode cache (#66) hits.
- **`@wardic/dom/DomDefaultTransition`**: `transitionFor`, Motion's table over core's transform names (`ReducedMotion.isTransform`), and its `layer`, merged into `DomLive`. `@wardic/test`'s Environment provides `oneSpring`.
- **The Solid runtime** reads the service once with the Positional keys, and passes it with them: the spine's options, the presence's, and `legsOf`.
- **`retarget-legs.ts`**:
  - `runOf(transition)` is a transition as its legs run it, worked out once per transition object (a `WeakMap`): `undefined` when it defines none, else a spring or a tween with Motion's missing fields (`MOTION_SPRING`, `EASE_OUT`).
  - `legsOf` resolves each key's transition (#301), then runs a defined one as before. One that defines none asks the Environment for each key's default, and the keys that share one go on one transition's legs. When every key has the same default, as nearly every element's do (a fade, a move), it builds no grouping.
  - `SPRING_FIELDS` is shared with `layout-member.ts`, whose layout transition is `runOf`'s or, defining none, Motion's layout tween.
- **The types**: `WardicTransition`'s and `WardicValueTransition`'s tween arm takes `type?: "tween"`.

## Tests

- `packages/solid/test/default-transition.ssr.test.tsx`, each leg's frames against core's machine on the transition it should run:
  - DT1: with the DOM's defaults, x and y on one 500 / 25 spring, a scale on 550 / 30, an opacity and a colour on one 0.3 s ease;
  - DT2: a scale toward 0 never dips below 0, and two scales run on two springs;
  - DT3: `{}`, the orchestration alone and an `undefined` field define none; a `delay` holds each default; the reduced-motion opt-out goes with them;
  - DT4: a value's entry leaves the other keys on their defaults; `default` with a `delay` alone delays each;
  - DT5: no `type`: a tween's field makes a tween eased out, a spring field a spring with 10 / 1, a repeat a tween;
  - DT6: `{ type: "spring" }` is 100 / 10 / 1 and overshoots; a typed tween eases out unless it gives an easing;
  - DT7: core's `oneSpring` runs every key on 170 / 26, as before;
  - DT8: `runOf` per object.
- `packages/dom/test/default-transition.node.test.ts` (DD1–DD4): Motion's table, one object per answer, the layer, and `oneSpring`.
- `default-transition.browser.test.tsx`, on Solid 1 and Solid 2 (DTB1, DTB2): on `DomLive`, an opacity with no transition lands 0.3 s in and an x overshoots; an exit with none goes about 0.3 s after.
- `layout-transition.browser.test.tsx`, LTS5: a layout `{ duration: 0.6 }` lands at 0.6 s, eased out; `{ type: "spring" }` overshoots its slot.
- The Appear hydrate tests (AH1, AH8) now follow the defaults their card samples, on both bindings, and the tween fixtures their `easeOut`. `appear.ssr.test.tsx`: AR18, an opacity with no transition samples the 0.3 s ease; AR7, a forever repeat with no `type` is a tween's infinite cycle.
- **Mutation-checked** with 20 single-point mutations (`.tmp/357/mutate.py`), all killed: among them `delay` or the opt-out defining a transition, a spring field beating `type: "tween"`, the old "no `type` is a spring", core's spring fields or a linear tween filled in, an `undefined` field defining one, the fast path taken for mixed defaults, a delay or the opt-out not carried, the DOM table's three rows, the runtime, an exit or a Solid 2 ward on one spring, a layout transition unfilled, and Appear's repeat check and its defaults. Appear's defaults first survived: only the hydrate tests saw them, so AR18 pins them in Node.
- **Tests about something else were pinned**, with a comment: string keys sharing a spring's progress (SK1–SK10), the frame loop's leg counts, the cold start's step sizes, M2's scale, and tweens written for linear. Two were races the change exposed: GW7 exited a frame before its entry landed (an eased-out tween paints "1" then), and IF1 waited for "near", then asserted "on". Three tests wrote Motion's `ease: "linear"`, which Wardic never read (#360): they now say `easing: Easing.linear`.

## Cost

`bench:solid` (N = 1,000, against main at e5acdaa) animates an opacity and a colour with no transition, so with this change head and base run different animations. It was run twice:
- **Pinned**, both pages on `{ type: "spring", stiffness: 170, damping: 26 }`, so both sides run the same spring and only the resolution differs. Every warm task is within ±2% on both bindings (Solid 1: mount +1.7%, Retarget −0.3%; Solid 2: Retarget +1.7%), and bytes per element per round are +0.4% on each: a run object per transition object, and the page writes a fresh literal per element. The noise control read +5.9% with a wide spread, as #355's run did on this host, so the timings are within noise but not gated by it.
- **Unpinned**, the page as it is, which users with no transition now get: Retarget −28% (Solid 1) and −27% (Solid 2), mount −10% and −8%, at-rest Retarget −19% and −20%, and bytes −26% on each. The opacity and the colour now run one 0.3 s tween leg where they ran a spring's two (numbers, and strings blended), and the tween lands sooner. The noise control was clean (−0.1%).

`bench:core` doesn't move: no machine, stepper or per-frame path changed.
