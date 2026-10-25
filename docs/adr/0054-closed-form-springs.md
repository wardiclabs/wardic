# Springs step in closed form, as Motion's

Wardic's springs integrated semi-implicit Euler in 1/240 s substeps: `Spring.step` (`Machine.spring`, `chase`, dom's layout flights, #359's `stepTimed`), `springValues`' loop written out in place, and `Easing.spring`'s own simulation. Motion's spring generator evaluates the spring's closed-form solution (`motion-dom`'s `generators/spring.ts`, at 16c6122: underdamped, critically damped and overdamped). Euler leads the exact path early on. On a 100 px move, Wardic's springs were off Motion's by up to 2.3 px in their first 100 ms: 1.6 px for Motion's 100 / 10 / 1, 2.3 px for a 0.5 s duration spring (#370, found checking #359). `Inertia`'s bounce already stepped in closed form (ADR-0016 *Amendment (#140)*).

## Decision (grilled 2026-10-25, #370)

**Every spring steps by Motion's closed form, its trig cached per spring config per frame `dt`** (Q1).
- The solution is linear in the displacement from the target `d` and the velocity `v`. So a step over a `dt` is a 2×2 matrix on them, `d' = dd·d + dv·v` and `v' = vd·d + vv·v`, which depends only on the spring and `dt` (`Spring.Exact`).
  - The physics' constants are worked out when the spring is resolved (`Resolved.exact`).
  - The matrix for the last `dt` is kept on it. Elements on one spring config share one `Resolved`, so they share one `exp`/`sin`/`cos` a frame.
  - A step is four multiplies and two adds, with no branch. The three kinds live in the matrix's refresh.
- Exact for any `dt`, from wherever the spring is: Motion's path at any frame rate, and a stall in one step.
- Measured before deciding (`.tmp/370/micro2.ts`, standalone: 1,000 springs on one spring config, a frame's `dt` each frame). In µs a frame, Euler against the closed form with its trig every call, and the closed form cached:
  - chase on Bun: 9.4, 15.3, 5.8;
  - chase on Node: 9.6, 9.5, 2.4;
  - two-key `springValues` on Bun: 19.2, 31.0, 14.6;
  - two-key `springValues` on Node: 19.6, 19.0, 4.9.
- Rejected: the closed form with no cache (Bun +63% a chase frame, standalone); keeping Euler with a README note.

Stated:
- **`Easing.spring` samples the exact solution** on its 1/240 s grid (or a duration spring's own steps, #359), in place of Euler's.
- **An overdamped spring uses the two-exponential form**, at `−decay ± freq`. Motion's `cosh`/`sinh` overflow for a large `freq·t` (it caps the argument at 300); these only underflow to 0.
- **A damping ratio within 1e-9 of 1 is critical.** At exactly 1 the underdamped formula would divide by a damped frequency of 0. Either side of the band, the formulas meet the critical one to well under a pixel (CF4).
- **A frame's velocity is the exact derivative**, so a spring rests where Motion's does. #344's thresholds are unchanged.
- **Unchanged:**
  - `MAX_DT`'s 0.5 s (ADR-0017 *Amendment (#23)*). One of the reasons it gave, the substeps' cost after a long stall, is gone. Wall time is still a separate question, and still rejected there for the projection's progress spring and **Frame time**.
  - #359's time-based rules.
  - `Inertia`.
- **No sharing between equal configs.** Two transition objects with the same values resolve to two `Resolved`s, two matrices. In Solid, an inline `transition={{ … }}` under a `<For>` is a new object per element. On the real core, that case is still faster than Euler: a chase frame went 0.021 → 0.011 ms on Bun and 0.0215 → 0.014 on Node. So the cache stays per `Resolved`, with no table of configs.

## Built

- **core:**
  - `Spring`:
    - `Exact`, `Resolved.exact`, `matrixFor`, and the refresh's three solutions;
    - `step` on the matrix: only the part of a frame past the delay moves it, as before;
    - `stepTimed` unchanged, around it.
  - `Machine.springValues`: its keys share the matrix, worked out once a frame. Its step is still written out in place.
  - `Easing.spring` samples its curve on the matrix.
  - `MAX_DT`'s note.

## Tests

- `packages/core/test/closed-form.test.ts`:
  - CF1: framer-motion 13.4.0's paths at irregular frames, to 1e-6, and its rest within 1 ms. That covers under-, critically and over-damped springs, a mass of 2, and a velocity either way.
  - CF2: frame-rate independence, and a 2 s stall's 0.5 s in one step;
  - CF3: damping 1,000,000, finite;
  - CF4: the critical band and its edges;
  - CF5: the exact velocity;
  - CF6: one config's matrix shared by runs at different `dt`s;
  - CF7: `springValues`' keys as springs of their own;
  - CF8: a delay ending mid-frame.
- `packages/core/test/time-springs.test.ts`:
  - TB2 and TB6 now hold Motion's paths to 1e-6, where they allowed Euler's 2.5 px;
  - TB6 adds a duration that isn't a whole number of 1/240 s steps.
- `packages/core/test/easing.test.ts`: `Easing.spring`'s curve against an independent closed form, sampled the same way, to 1e-9. That replaces the samples pinned at b429963.
- `packages/core/test/options.test.ts`: the resolved defaults carry `exact`.
- `packages/dom/test/appear.browser.test.ts`, HA4: a finished Appear animation holds at its end as its CSS writes it, to 1e-4 s.
  - It asserted strictly past the rule's own duration. That held only while the spring rested on a frame whose 4-decimal rounding went up.
  - The exact spring rests on frame 17, 0.28333 s, written `0.2833s`.

**Mutation-checked** with 16 single-point mutations (`.tmp/370/mutate.py`), all killed. They covered:
- each solution's matrix entries;
- the critical band;
- the damping kind;
- a matrix never refreshed;
- `step` and `springValues` ignoring a delay's partial frame;
- `Easing.spring` on 1/240 always;
- `springValues`' displacement sign;
- the decay rate.

The first two delay mutations and the `Easing.spring` one survived at first and got CF8 and TB6's odd duration.

**Cost:**

`bench:core` against main (cf54bfc):

| | Bun | Node | Chromium |
|---|---|---|---|
| `springValues/loop` | −26% | −17.5% | −40% |
| `chase/loop` | −18% | −33% | −44% |

Every other workload is within noise.
- One gate fired on the first run: Bun's `animateRepeatDelay/loop` at +8.7%. That's a tween with no spring in it. Two Bun re-runs read −2.2% and −1.3%, with `springValues/loop` at −26% and −27% and `chase/loop` at −16% both times.

`bench:solid` (resolving a spring now works out its matrix's constants, on the per-element start path) is flat on both bindings: warm mount, Retarget and unmount within −1.6% to +2.2%, and bytes per element within ±0.6%.
- The first two runs were ruled too noisy by their control page, plain `div`s that are the same code on both sides: −9.3%, then +14.0%, on a quiet host. Their tasks were flat too, within −1.4% to +2.9%.
- The third gated, with its control at −1.0%.
