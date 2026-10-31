# Live values

#130 gives Wardic a **Live value**: a value the user moves themselves, given in an element's `style` (CONTEXT.md). Motion has one in `useMotionValue`, `useTransform` and `useSpring`. Wardic's differs in one rule: the user's value is an input that Wardic never writes into. The element's own values come out through a separate output.

It lands in two PRs. The first adds core's `LiveValue` module and the gate's per-key outputs. The second adds the Solid surface, the transform keys in `style`, and returns that follow a moving value.

## Why

- **Motion lets a user put a value they move into `style`:** `<motion.div style={{ x, opacity }} />`. Wardic had no equivalent, and `style` didn't even take a transform key: the Base value never read one from `style` (`styleValueOf` skipped them), so a transform key's base was always its identity.
- **#79 settled the order for a static `style`:** while any entry of the Override stack sets a key, the element shows Wardic's value, and `style` is the key's fallback (ADR-0022, ADR-0034). A value that moves needed an order too, and a name.
- **In Motion there's one value, and it's the key's value.** `animate`, gestures and drag write into the same object (`VisualElement.addValue`, `value.start(…)`), so a user's `.set()` during an animation is overwritten by its next frame.

## Decisions (grilled 2026-10-18, Q1–Q8 all A)

1. **A live fallback, not a shared value (Q1).** A value in `style` is the key's `style` link (ADR-0022), live. While an entry of the Override stack sets the key, the entry wins. When none does, the element follows the value on every change, and a gesture that lets go returns the key to where the value is then.
   - **One rule for `style`, static or live:** the Override stack and the Base value stay the only model.
   - **Scroll-linked `opacity` under `whileHover` composes:** the hover wins, and on release the key returns to the scroll value. Under a shared value, the hover would overwrite the scroll value, and the scroll would overwrite the hover, every frame.
   - **The swipe card** (`drag="x"`, with `opacity` following `x`) reads drag's `x` through the output (decision 5) instead of sharing it.
   - **Other frameworks get the same rule.** It lives in core and dom, below the bindings. React still needs a value object that changes without re-renders, but as an input that Wardic never writes into. Foldkit (the Elm architecture) would take an Effect source; a shared mutable value Wardic writes into would go against its messages-only model.
   - Rejected: Motion's shared value. It ports Motion code line for line, but it makes `style` an override for those keys, against #79's rule, and lets a derived value fight a gesture.
2. **The shared form is an `effect/reactivity` `Atom` (Q2),** as core's other live data is (`Probe.viewport`, `Probe.prefersReducedMotion`). Every binding accepts an Atom in `style`, and also its framework's native reactive value (a Solid accessor or signal now). The output is an Atom too, and the helpers that derive one live value from another live in core, over Atoms.
   - **Measured, 1,000 live values each changed once a frame and forwarded to a sink** (µs a frame for all 1,000; `.tmp/130/live-cost.ts`):

     | form | Bun | Node |
     |---|---|---|
     | Solid signal → computation | 35–39 | 64 |
     | `Atom` → registry subscription | 29 | 23–24 |
     | Solid signal → `createMemo` → computation | 84 | 155 |
     | `Atom` → derived `Atom` → subscription | 180–191 | 161–166 |

     At worst about 0.2 ms of a 16.7 ms frame, so cost doesn't decide the form. A derived Atom tracks its source only once it has been read: subscribed without `{ immediate: true }`, it never fired, and that first measurement read impossibly cheap.
   - **The registry de-duplicates by identity:** an equal number or the same object doesn't notify; a new object does, even when it's structurally equal.
   - Rejected: Solid accessors only (the bindings would drift into three shapes, with nothing derived in core); Atoms only (a Solid user would wrap every signal).
3. **The name is Live value (Q3).** "Motion value" is Motion's name, for a value the engine writes into, which this isn't. The glossary's two "a Snapshot is a motion value" lines now say "a cached value", and the Hydration hold switches to its "client values", so "live" means one thing.
4. **`style` takes the transform keys, static or live (Q4).** `x`, `y`, `scale`, `rotate` and the rest are `style` links like any CSS key: `style={{ x: 100 }}` rests at 100, and a gesture that moves `x` returns there. Wardic composes them into `transform` with its own keys, through the gate. A user's own `transform` string applies only while no transform key is set. With both, the keys win (Motion's rule), with a warning logged once per element. As built (PR 2), the gate holds `transform` while a transform key is set, so Solid's `style` never writes the string, and it shows again once no key is. `styleValueOf` reads the transform keys from PR 2 on, when the binding keeps them in the gate; until then an `x` handed back to `style` at rest would have dropped to 0.
5. **The output is the element's value per key, on request (Q5).** `FlushGate.valueOf(id, key)` is an Atom of the element's value for the key. It holds the value before the Renderer projects it (`x` as a number), is `undefined` before the key's first write and after its release or the element's unregister, and is one Atom for an id and a key, made on first ask. A key nobody reads costs nothing; an element with no output pays one `undefined` check per write.
   - **Set at the write, not the commit (PR 2).** PR 1 set it at each commit. The swipe card showed why that's wrong: an opacity derived from `x` was written after the frame's flush, and painted a frame behind. Set as each write lands, a value derived from it is written into the gate before the frame's commit, and commits with it.
   - **The binding's** `ward.value(key)` reads it as an accessor, and covers a key at rest outside the gate: its `initial`, else its `style` value, else a transform key's identity. `ward.atom(key)` is the gate's Atom as it is, for Effect code.
   - Rejected for now: Motion's `onUpdate(latest)`, a callback with every value each frame. It's a follow-up for porting code that uses it.
6. **A return to a moving Live value follows it (Q6).** A spring return reads its target afresh each frame (`Machine.chase`'s step), and a tween return eases toward the current value, so it lands exactly on it. On settle the key goes back to the Live value with no jump. This is PR 2.
   - **As built:** a spring return is a chase that settles, ending at its first Frame at rest on the value. One to a value that never stops moving (a looping or time-driven value) chases it with a spring's lag until it slows. A tween return is the transition's tween on a progress, the key at `from + (value − from) × progress` each frame, so it lands on the value at its end.
   - **A string key** (a colour a `createTransform` maps) returns to where its value is when the return starts, and the follower takes it from there; a value that moved meanwhile jumps there at the hand-back.
   - **Reduced motion** snaps a positional key to where its value is at the snap, then follows it.
   - Rejected: aiming at the value when the return starts (a snap at hand-back during a fast scroll); no return animation for a live key.
7. **Two helpers, in core, over Atoms (Q7):** `LiveValue.transform` and `LiveValue.spring`, wrapped in Solid as `createTransform` and `createSpring` (PR 2).
   - **`transform(source, input, output, { clamp })`** maps ranges, each pair of outputs blended through the `InterpolatorRegistry` (resolved once), so colours and unit strings map as `animate` blends them. Clamped by default, as Motion's `useTransform` is.
   - **`spring(source, options)`** starts where its source is. From each change on, a `Machine.chase` toward the source runs on the Frame loop until it rests there: the run then ends (superseded, ADR-0027 *Amendment (#200)*), and the next change starts another from where it rests. A change mid-flight keeps the run it's on, chasing the new value with its velocity. The run and the subscription end with the Scope. Measured: 1,000 live springs on the loop cost 117–119 µs a frame, against 59–61 µs for the same 1,000 chase runs, so about 0.06 µs a spring per frame for the Atom read and write.
   - Follow-ups: `velocity`, `scroll` (needs a scroll source in the Environment) and `time`.
8. **This ADR, in two PRs (Q8).** ADR-0022 (the Base value) and ADR-0034 (the gate) point here.

## Consequences

- **`FlushGateServices` gains `AtomRegistry`.** `DomLive` provides it already. A binding that builds its own gate provides one, and the gate's own tests got one.
- **Motion code ports with one change:** a value Wardic animates is read from its output (`ward.value("x")`), not shared.
- **The order is the same in every binding,** since it lives below them.
- **A routed key never goes through Solid's `style`** (PR 2): a value that changes every frame runs one computation per key, not the element's `style`. The Starting style carries their values, under `initial`'s, so a server render and hydration show them.
- **`createTransform` moved** from `sensors.ts` to `live-value.ts`, and kept its function form beside Motion's ranges form.
- **An Atom is mounted in the registry, never kept alive.** PR 1's `LiveValue.spring` and gate outputs used `Atom.keepAlive`, whose node never leaves the registry: 1,000 made and unsubscribed left 1,000 nodes. Mounted for their lifetime, none is left (`.tmp/130/keepalive.ts`).

## Pinned by

- `packages/test/test/live-value.test.ts`:
  - TR1–TR5 (`transform`): a blend between stops, clamped ends, `clamp: false`, unit strings, a subscriber per change, and the length checks;
  - SP1–SP5 (`spring`): idle until its source moves; a run Frame for Frame `Machine.spring`'s that ends at rest; a change mid-flight keeping its run and velocity; a new run after a rest; a Scope close ending both.
- `packages/dom/test/gate.node.test.ts` GV1–GV6 (`valueOf`): `undefined` before the first commit, then the value before projection; one notification per change; `undefined` after a release and after an unregister; asked before the element registers; no change to an element with no output.
- **Mutations,** each caught: the gate never setting an output (GV1, GV3, GV4); `spring` not ending its run at rest (SP2, SP4); `transform` ignoring `clamp` (TR1). Dropping the gate's unchanged-value check is not caught, and needs no test: the registry ignores an equal value anyway, so the check only saves a `set`.
- **PR 2:**
  - `packages/solid/test/live-values.browser.test.tsx` LF1–LF11, LF14–LF16: a transform key at rest from the Starting style on, under `initial`; an accessor followed each next frame with no run of Solid's `style`; an Atom; a hover over a moving value, its spring return with no jump, landing on it and followed after; a tween return landing on a moving value; the `transform` string; `ward.value("x")` and an opacity derived from it in the same painted frame; `createSpring` and a colour `createTransform`; a key gone from `style` let go; an animation winning over a Live value until it lets go; `ward.value` at rest; a Variant child held by `when` keeping its starting opacity; the warning, once; a Live value given after mount, followed from then on.
  - `live-values.ssr.test.tsx` LF12–LF13: the server's Starting style with a transform key, a Live value and an Atom under `initial`, and `ward.value` there. Hydration fixture F23: the same through hydration (HY1–HY6).
  - `gate.node.test.ts` GV1 and GV3 (the output at the write), GV7 (a derived write commits in the same flush); `live-value.test.ts` TR6 (`interpolate`); `base-value.node.test.ts` D9 (transform keys read).
  - The lab's `test/live-board.test.ts`: scenario 18's lines.
  - **Mutations** (`.tmp/130b`), each caught: the follower never writing (LF2–LF5, LF7, LF8, LF10); a settled return releasing a routed key (LF4, LF5, LF10); no return following (LF4, LF5); outputs set at the commit (LF7, GV1); a Starting style without the routed keys (LF1, LF2); no starting values at mount (LF14); a key gone from `style` never released (LF9); a key first routed after mount never starting the follower (LF16); Solid's `style` keeping the routed keys (LF1); the `style` link not reading a Live value (LF4, LF5, LF10). Not dropping the `transform` string isn't observable, as the gate holds `transform`, so the drop was removed and only the warning is kept (LF15).

## Implementation

**PR 1** (core and dom): `packages/core/src/LiveValue.ts`; `FlushGate.valueOf` in `packages/dom/src/internal/gate.ts`, with `inert`'s; the glossary's Live value.
- **Measured:** `bench:solid` against main `6632187`, 11 reps, warm: every task within ±1% (mount −0.5%, Retarget −0.1%, at rest −1.0%, unmount +0.5%, bytes −0.2%), so the gate's check for outputs costs nothing measurable.
- **Gates:** typecheck, lint, unit (1136), browser (1017), and the lab's tsc and vitest (208). The lab's drives on a restarted 5173 are as #226's.

**PR 2** (solid and dom): `packages/solid/src/live-style.ts` (the routed keys: found in each style the element is given, read, watched from mount), the spine's follower and following returns in `create-ward.tsx`, `ward.value` and `ward.atom`, `live-value.ts` (`createTransform`, `createSpring`), `LiveValue.interpolate`; dom's `styleValueOf` reading the transform keys and the gate setting outputs at the write. The lab's scenario 18, *live values*: the swipe card, a scroll-linked opacity under a hover or a press (a phone, where touch never hovers, presses it), a slider with an animation held over it, and a spring following it, judged on `follows`, `wins`, `returns` and `same frame` (`lab/live-board.ts`). Its stage is the lab's default 320px wide, with the slider and Hold under it, so a phone shows every cell (`.tmp/130/touch18.ts` drives it by touch).
- **Measured:** `bench:solid` against main `7301c39`, 11 reps, warm, at `9d10859`: mount +1.3% [−0.2% – +1.9%], Retarget −0.3%, at rest −0.3%, unmount +2.7% [+0.5% – +4.8%], bytes +1.4%: an element that routes no key pays about what it did. The first build paid mount +4.1%, Retarget +1.8% and bytes +3.3%, for closures every element built and every Retarget made whether or not anything was routed: the follower is now built at the first routed key, a Retarget looks for following returns only when it returns a key, and `LiveStyle`'s methods are on a shared prototype. Unmount moved between −2.0% and +2.7% across the four runs, with no change on its path between them. `bench:solid --live` (at `3152242`; what came after touches only the mount): 1,000 elements each following one signal in `style`, against 1,000 plain divs binding it, 11 reps: the set's JS 0.30 ms against 0.26 (+15%), and the frame from its first rAF callback to after its paint 1.61 ms against 1.33 (+21%), so about 0.3 µs an element a frame over Solid writing the style itself.
- **Gates:** typecheck, lint, unit (1146), browser (1037, the hydration project's included), and the lab's tsc and vitest (214). The lab's drives on a restarted 5173 are as PR 1's, and scenario 18's (`.tmp/130/drive18.ts`, real pointer and scroll input) passes every line of its 8 runs.

## Amendment (#233, #234): scroll, velocity, time, and `onUpdate`

ADR-0043's follow-ups (decisions 5 and 7), grilled together 2026-10-19, Q1–Q8 all A. Motion read at framer-motion 13.4.0 / motion-dom 13.3.0.

1. **Scroll is an Environment reading, `Probe.scroll(options)` (Q1):** an Atom per scroll container (the page by default) holding each axis's position, scroll length and progress.
   - **Written inside the container's `scroll` event,** and on a window or container resize, which changes the range. A value derived from it is written into the gate before the frame's commit and paints in the frame that shows the scroll: #45's pattern for `viewport`.
   - **One listener set a container,** however many read it, held while a reader's Scope is: a plain ref-counted map, not `SharedSource`, whose forked pump would set the Atom a task after the event.
   - **No compositor path:** Motion hands `scroll` to a native `ScrollTimeline` where it can; Wardic draws everything through the gate. Measured, and kept until after v0.1, in *Note (#240)*.
   - Rejected: a `Stream` (every Live value helper and `style` takes Atoms); the binding alone (React or Foldkit would each rebuild it, and core couldn't derive from it).
2. **Motion's four values (Q2):** `LiveValue.scroll({ container, target, offset, axis })` gives `scrollX`, `scrollY`, `scrollXProgress` and `scrollYProgress`, each derived from `Probe.scroll`'s Atom; Solid's `createScroll` gives them as accessors (PR 2). A Solid container or target can be an accessor, since a ref arrives at mount; until it does the values read 0, as Motion's do while a ref is pending.
3. **`target` and `offset` in full (Q3):** Motion's syntax, its named edges (`start`, `center`, `end`), fractions, `px`, `%`, `vw` and `vh`, a lone edge, more than two stops, and the presets (`Enter`, `Exit`, `Any`, `All`). With a `target` and no `offset`, `All`; `axis` (default `"y"`) is the axis they resolve on, the other keeping the container's plain progress.
   - **The syntax is the DOM's alone** (decided on review, 2026-10-19, A): core's `ScrollOptions.offset` is `unknown`, an offset in the Environment's own terms, passed through as `container` and `target` are. `@wardic/dom/ScrollOffset` types Motion's syntax and holds the presets, beside the DOM's resolution, which reads its layout (a target's offsets up to the container, the viewport). A binding types its helper's `offset` from it. The first build typed and documented the syntax in core, names and CSS units included; nothing DOM- or CSS-specific belongs in core, as #158 and #160 settled for `var()` and colours, and a native Environment has no `vh`.
   - Rejected: a neutral offset model in core (fractions, distances and viewport shares), which the DOM would translate Motion's strings into: more to design, and the viewport share is still read at measure time; all of scroll in dom, which would undo decision 1.
4. **Velocity per frame, on the Frame loop (Q4):** `LiveValue.velocity(source)`, 0 to begin with. A change starts a run that sets, each tick, the source's change since the end of the tick before over the tick's `dt` (clamped at `MAX_DT`, as every run's step is); the first tick with no change sets 0 and ends the run.
   - **"The end of the tick before"** is read by an `afterTick` hook. A run started inside a tick (a velocity of a value another run moves) takes its first step at the next one, and measured from its own last read it counted two frames' change over one `dt`: acceleration read 7200 where 3600 was right (VE3).
   - Velocity is a value too: `velocity(velocity(x))` is acceleration, Motion's own example.
   - Rejected: the time between a source's last two changes (no fall to 0 without a timer, spikes from several events in a frame); a trailing window, as a drag's release velocity (lags Motion's).
5. **`time` is milliseconds of wall time (Q5):** `LiveValue.time()`, a run that never settles, adding each tick's `dt` as the Clock gives it, unclamped, so a hidden tab's minutes count in full, as Motion's `useTime`'s do. It keeps the Clock ticking every frame while it exists. Milliseconds, so `useTransform(time, [0, 4000], [0, 360])` ports as it is.
6. **`onUpdate` as Motion's (Q6):** a sink's `onCommit(latest)` is called once per frame in which the gate committed the element, after every commit of that frame, with its values before projection; PR 2 gives it to the Solid surface as `onUpdate`.
   - **`latest` is one object per element, reused:** valid during the call, copied to keep; a key the gate let go of leaves it.
   - **A Measure pass's commit is told at the frame flush after it,** so a frame tells each element once; the write that made the commit scheduled that flush.
   - **A throw is reported,** and the others are still told. A write it makes is the next frame's.
7. **The lab (Q7):** a new scenario 19, *scroll-linked* (a progress bar, a reveal through `target` and `offset`, a skew from scroll velocity, a spinner on `time`, an `onUpdate` line), and scenario 18's scroll cell on a real `createScroll` (PR 2).
8. **This Amendment, in two PRs (Q8):** PR 1 core and dom, PR 2 the Solid surface, the lab and the README.

### Consequences

- **`Probe` gains `scroll`:** every Environment provides it. The DOM's sets it in its events; `TestProbe`'s holds one Atom for every container, `pushable`'s `pushScroll` sets it.
- **dom gains `ScrollOffset`:** Motion's offset syntax and its presets, the type a binding's `scroll` helper takes for `offset`.
- **`FlushSink` gains `onCommit`:** an element without one pays a property check per commit.
- **`LiveValue.spring` builds a run only after a rest** (a change while one runs costs a check), as `velocity` does: the first `velocity` rebuilt its run on every change while running and cost 351 µs a frame at 1,000.

### Pinned by

- `packages/dom/test/scroll.browser.test.ts` PS1–PS6: set inside the event, with the container's numbers; the page's, from the window's event; a container's resize; a target's progress through each kind of offset, as Motion resolves it; one listener set a container, removed with its last reader; an unchanged scroll not set again.
- `packages/test/test/live-value.test.ts` PS7 (the four values), VE1–VE4 (velocity: idle at 0, per tick and ending at rest, acceleration, the Scope), TI1–TI2 (time: wall time unclamped, the Scope).
- `packages/dom/test/gate.node.test.ts` GC1–GC5 (once per flush after every commit, not without a commit, a Measure pass's at the frame flush, one reused object without released keys, a throw reported with the others told).
- **Against Motion** (`.tmp/234/offsets-diff.ts`): framer-motion's `scroll()` and `Probe.scroll` on one box, 14 offset definitions (none, a target with none, names, fractions, the presets, `px` and `%`, `vh`, lone edges, three stops, an offset without a target, the `x` axis), each at 61 scroll positions: the largest difference 1.1e-16.
- **Mutations** (`.tmp/234`), each caught: the scroll set a microtask after its event (PS1, PS2, PS4, PS6); a target's inset ignored (PS4); a listener set per reader (PS5); an unchanged scroll set again (PS6); a container's resize unobserved (PS3); velocity from the run's own last read (VE3); velocity never ending at rest (VE2); time clamped as an animation's step (TI1); `onCommit` told inside the commit loop (GC1, GC3); a released key left in `latest` (GC4); one throw stopping the rest (GC5); `scrollY` read from the x axis (PS7). A Measure pass requesting a frame flush for its tell isn't observable (its write already did), so it was removed.

### Implementation

**PR 1** (core and dom): `Probe`'s `scroll` contract in core; `packages/dom/src/ScrollOffset.ts` and `packages/dom/src/internal/scroll.ts`; `LiveValue.scroll`, `velocity` and `time`; `onCommit` in `packages/dom/src/internal/gate.ts`; `TestProbe`'s `scroll` and `pushScroll`.
- **Measured** (`.tmp/234/velocity-cost.ts`, per frame on the Frame loop, 1,000, Bun, median of 400 warm frames):
  - 1,000 velocities of moving sources: 135 µs, the sources' own sets 26 of it: about 0.11 µs a velocity a frame. Idle while the loop ticks for something else: no cost beyond their `afterTick` hooks, below the sets' control. Setting up 1,000: 13–15 ms.
  - One `time`: 4 µs a frame; 1,000: 62 µs.
  - `LiveValue.spring` with the guard, against main: 130 µs a frame at 1,000 on both.
  - The gate's flush of 1,000 elements, each written every frame (`.tmp/234/gate-flush.ts`, the hook's check on every commit): 8.4–8.6 µs against main's 8.5–9.2.
- **Gates:** typecheck, lint, unit (1160), browser (1043, hydration included), and the lab's tsc and vitest (216). The lab's drives on a restarted 5173 are as before, scenario 18's included.

**PR 2** (solid and the lab): `createScroll`, `createVelocity` and `createTime` in `packages/solid/src/live-value.ts`; `onUpdate` on `WardConfig` and `wardic.*`, given to the gate as the sink's `onCommit` in `runSpine` (`withOnUpdate`), so every surface, `use:wardic` and a Reorder item included, has it.
- **`createScroll`** reads a `container` or `target` given as an accessor (a ref) in an effect: 0s until it's there, as Motion's are while a ref is pending, and a new element is followed, the old one let go. Its `offset` is typed by `@wardic/dom/ScrollOffset`. Each of the four derived Atoms is subscribed `{ immediate: true }`: a derived Atom tracks its source only once read.
- **Whether an element reports through `onUpdate`** is read at mount; the function is read at each call, so a config that hands over a new one is followed. An element without one never joins the gate's tells.
- **On a server,** the three helpers read 0 and run nothing (ADR-0021).
- **The lab:** scenario 19, *scroll-linked*: a progress bar on `scrollYProgress` reporting through `onUpdate` (**follows**, **updates**), a card revealed through `["start end", "end start"]` (**follows**), a skew from `createVelocity(scrollY)` (**moves**, **settles**), and a spinner on `createTime()` (**ticks**), the four new lines in `lab/live-board.ts`. Scenario 18's scroll cell reads a real `createScroll`. Both fit a 390px phone. The velocity skew stands back up the frame after the scroll stops, as Motion's `useVelocity` reads 0 then: Motion's own skew demo smooths it with a spring, which `createSpring(createVelocity(scrollY))` gives.
- **Pinned by:** `packages/solid/test/scroll-velocity-time.browser.test.tsx` SL1–SL5 (a container's scroll and a value derived from it in the frame of the scroll; a target's progress through the DOM's offsets; a ref accessor, then a new element; velocity at rest, moving and stopped; time and its owner) and OU1–OU2 (`onUpdate` once a frame with every value before it's drawn, in one object; not on a frame that changed nothing; the config's current function); `live-values.ssr.test.tsx` SL6 (0s on a server); the lab's `test/live-board.test.ts` (the four new lines).
- **Mutations,** each caught: `onUpdate` never wired (OU1, OU2); read once at mount (OU2, after it was tightened: its first form called a function that read a signal itself, so a stale one passed); the derived scroll Atoms never read (SL1–SL3); a container accessor read once (SL3); `target` dropped (SL2); a server reading a velocity's source (SL6); time never running (SL5).
- **Driven** (`.tmp/234/drive19.ts`, wheel bursts, and a phone's finger drags with `touch`): every line of scenario 19's 10 runs passes either way; the spinner reads 89.9° and 90.0° a second against its 90.
- **Measured:** `bench:solid` against main `9496f31`, 11 reps, warm, at `a3591e9`: mount +0.1%, Retarget −0.5%, at rest −0.8%, unmount +1.5%, bytes +0.0%, inside an A/A run's spread on the same host that day (main against main: +0.7%, +1.2%, +0.2%, −0.9%, +0.4%). The plain-divs control read −7% both times, so the runner called each run too noisy: it read the same A/A, so it's the host's that day, not either side's. A first build's mount read +2.1% [−1.0% – +2.9%] with `onUpdate`'s check at mount a match; as a guard it reads level.
- **Gates:** typecheck, lint, unit (1165), browser (1050, hydration included), and the lab's tsc and vitest (220). The lab's drives on a restarted 5173 are as before; scenarios 18 and 19 pass every line, by mouse and by touch.

## Amendment (#239): a scroll follows its content's size

Grilled 2026-10-19, Q1–Q3 all A. `Probe.scroll` read the range on a `scroll`, a window `resize` and a resize of the container's own box. Content that grew or shrank with the scroll still changed the range, and a target's offsets, and nothing read them until the next scroll. A list that loaded more rows kept its progress bar where the old length put it.

1. **Always on, through observers (Q1).** The DOM's `Probe.scroll` watches the content's size itself; core's contract is unchanged, and there's no option.
   - **Motion's `trackContentSize`** reads `scrollWidth` and `scrollHeight` every frame, opt-in. A read every frame keeps the frame loop awake while any scroll is followed, and can force a layout early; off by default, content changes go unread unless an app asks.
   - **What it costs:** nothing while nothing changes. A change is read after its layout, in the `ResizeObserver`'s delivery, after that frame's commit, so a value derived from it paints a frame later. A scroll still paints in its own frame.
   - **What it misses:** overflow no watched box shows, such as an absolutely positioned descendant hanging out of the content.
2. **What's watched (Q2), one `ResizeObserver` per container, shared by its readers and disconnected with the last:**
   - an element container's own box, as before, and its direct children: a deep change resizes the direct child it sits in;
   - the page's: `document.body` and its direct children (a body sized to the window doesn't grow with what overflows it; text straight in the body grows only the body);
   - children kept as they come and go by a `MutationObserver` on the content's child list, which also reads once on each change, since a removed child resizes nothing still watched;
   - each reader's target, while that reader reads: a target that resizes inside content of a fixed size moves its offsets. Each box is counted by the reasons it's watched for, so a target that's also a child stays watched when its reader goes.
3. **Proven and delivered (Q3):** one PR, with the browser tests, mutations and scenario 19's "Add rows" below.

### Pinned by

- `packages/dom/test/scroll.browser.test.ts`:
  - **PS8:** a container's content grows with the scroll still; its range and progress follow a frame later.
  - **PS9:** the page with a body sized to the window: a child added, then grown; with a body of its content's height, text added straight to it.
  - **PS10:** a target moved by what grew above it, and resized on its own in a column of fixed height.
  - **PS11:**
    - a child added after the reader started, then grown and removed;
    - a second reader whose target is a child, gone, leaving the child watched;
    - both observers disconnected with the last reader;
    - an idle container never read.
  - **PS3** now waits past the observers' first delivery, which had read the resize for it.

  PS8 and PS10 at first passed on main too: setting `scrollTop` queues the browser's own `scroll` event a frame later, which re-read the grown content. They now wait past it, and all four fail on main.
- **Mutations,** each caught:
  - the children unwatched (PS8, PS10, PS11);
  - no `MutationObserver` (PS9, PS11);
  - no read on a removal (PS11);
  - the page's body unwatched (PS9);
  - a reader's target unwatched (PS10);
  - a box unwatched as soon as one reason goes (PS11);
  - the observers never disconnected (PS11);
  - the container's own box unwatched (PS3).
- **The lab, scenario 19:** "Add rows" grows the box's content by a direct child with its scroll still. Its **resizes** line holds the bar to the box's own progress, read from the box each frame: on it within two frames of the change (the observer's frame late, and one more), then staying there. The lab's `test/live-board.test.ts` covers the line. Driven (`.tmp/239/drive19.ts`, by mouse and by touch): every run is on it one frame after the change, and the other cells' lines still pass.

## Note (#240): measured, and left on the main thread until after v0.1

Decided 2026-10-19 (#240, Q1 A: measure first; Q2 A: defer). Decision 1 of the *Amendment (#233, #234)* stands: Wardic draws every scroll-linked value through the gate.

- **What it costs:** a browser scrolls on the compositor where it can, and a scroll-linked value set in the `scroll` event is drawn with the main thread's next frame. Measured against a CSS scroll-driven animation on the same scroll, in the same composited frame (Chromium 147, CDP screencast, touch flings and wheel notches):
  - **one frame behind** with an idle main thread, in mobile emulation and on a desktop at DPR 2;
  - **up to three frames behind** with the main thread blocked 50 ms out of every 100;
  - **no gap** on a desktop at DPR 1, where Chrome scrolls the box on the main thread, so both stall together.
  
  Firefox 148 has no `animation-timeline`, so it had nothing to compare against. A phone (Chrome 155 on Android, about 72 Hz) showed nothing the lab can judge: the bar matched the main thread's scroll in every frame it drew, Busy on or off.
- **Motion is the same** for most scroll-linked values. It hands only `opacity`, `clipPath`, `filter`, `transform` and `backgroundColor` bound to a progress, or to a range `useTransform` of one, to a native `ScrollTimeline` or `ViewTimeline`. Its own `scaleX: scrollYProgress` progress bar draws on the main thread, as Wardic's does.
- **Why not now:** a timeline-run value is a WAAPI handoff, which `docs/plans/v0.1.md` defers to after v0.1 in full. It is the simplest case of one: no retarget and no velocity, only a pure function of the scroll, so `ward.value` and `onUpdate` could compute it from `Probe.scroll` instead of reading it back. The plan's WAAPI entry names it as the first eligible case, and #240 holds what it would cover.
- **The yardstick:** scenario 19's orange bar is that CSS animation, run with the scroll itself, under Wardic's progress bar. Its Busy toggle blocks the main thread 50 ms out of every 100. Fling the box and watch the gap. #240's comment holds the screencast script that measured it.
- **The lab's lines** skip frames read late in **moves** and **updates** too. A run whose moving (or told) frames were mostly read late isn't judged on them: a busy main thread's run leaves too little to judge. Covered in the lab's `test/live-board.test.ts`.

## Amendment (#257 item 7): no writable Live value; Motion's `jump` and `skipInitialAnimation`

#257 item 7 asked whether a Live value should be one an app can both derive and `set`, as Solid 2's writable memo (`createSignal(fn)`) is: a write lands at once, and the next change of what it derives from re-derives it. Motion's equivalent is a `useSpring` value: it follows a source, and its own `set` and `jump` move it too.

**Grilled 2026-10-23:**
1. **No writable Live value (Q1: A).** The two cases the issue names are covered already. A probe checked both (Chromium, `.tmp/257-7/`):
   - **A spring's target, derived and set,** is a writable memo given to `createSpring`, which follows any accessor:
     ```tsx
     const [target, setTarget] = createSignal(() => (open() ? 300 : 0))
     const x = createSpring(target)
     setTarget(150)   // springs to 150; open()'s next change springs to its value
     ```
     A write sprang there over 13 frames, and a change of `open()` after it sprang to the derived value.
   - **A value a drag writes and a layer follows** is the ward's own: the drag writes its `x`, and `card.read("x")` gives it, by this ADR's rule that Wardic never writes into a value it's given. A layer given `read("x")` painted in the card's frame in 37 of 37 moving frames. A writable memo over `read("x")` was a frame behind in 31 of 37, as anything through Solid 2 is (ADR-0045, PR 3b): a value derived from a ward's stays on its Atom.
   - **Rejected:** a Wardic writable value in Motion's `useMotionValue` shape (B), a second spelling of Solid's writable memo whose only gain, the ward's frame, `read` and `createTransform` give already; and every helper giving a `[value, set]` pair (C), which breaks their types and, for a spring, is a jump.
2. **`createSpring` gets Motion's two snaps (Q2: A), on both bindings.**
   - **`jump(value)`** on the accessor it gives (`SpringAccessor`, still an accessor): the spring is set there at once, not as motion. Its run ends with no velocity, and it rests there until its source next changes, then springs from there. That's a writable memo's rule, applied to the spring's own value. Core's `LiveValue.jump(atom, value)` jumps a spring's output, or any writable Atom of the user's; any other Atom is a defect.
   - **`skipInitialAnimation: true`:** the source's first change is a jump, and only the changes after it spring. Motion added it for a scroll the browser restores after mount, which a scroll-linked spring would otherwise glide to.
   - **On a server,** `jump` does nothing, and the user's accessor is wrapped, not given one.
   - **Rejected:** only `skipInitialAnimation` (B), which leaves a reset without a glide impossible; neither (C).
3. **A velocity reads 0 across a jump (Q3: A),** as Motion's does: Motion keeps a value's velocity on the value, and its `jump` resets it. Wardic's `createVelocity` reads a value's change each frame, so a jump from 300 to 0 would read about −18,000 px/s for that frame, and a skew driven by it would flicker. Core keeps who hears each Atom's jumps, per registry: a spring, of its own output, to end its run, and a `velocity`, of its source, to read the jump's frame from where it jumped to. Rejected: the one-frame spike, documented (B).

**Built:**
- **Core:**
  - `LiveValue.SpringOptions`: `Machine.SpringOptions` and `skipInitialAnimation`.
  - `LiveValue.jump` (dual); the jump listeners in a `WeakMap` by registry, then by Atom, so a registry or an Atom gone takes its listeners with it.
  - `spring` and `velocity` listen; a jump tells its listeners, then sets the Atom.
- **Solid 1 and Solid 2:** `createSpring` gives a `SpringAccessor`, with `jump` run on the provider's runtime.
  - Solid 1's helpers now carry their Atom, as Solid 2's do (ADR-0045, PR 3b), and take a carried Atom as their source. A `createVelocity` of a spring then reads the spring's own Atom, which hears its jumps. A mirror of the accessor would read a jump as motion.
  - The shared `SpringAccessor`, `springAccessorOf` and `serverSpringOf` live in `live-style.ts`, beside `carry`.
- **The README:** `jump` and `skipInitialAnimation` under Solid 1's Live values; under Solid 2's, the writable memo as a spring's target, and a value derived from a ward's kept on its Atom.

**Pinned by:**
- `v2/live-values.browser.test.tsx`:
  - **LV13:** a writable memo as `createSpring`'s source: a write, then a change of what it derives from, each sprung to.
  - **LV14:** `jump` at rest (nothing painted between; it rests there; velocity 0 throughout), then the next change sprung from the jump; mid-flight (every frame after it at the jump; no velocity of the wrong sign); and mid-flight with the source changed in the same task (sprung from the jump, overdamped, so a velocity kept across it would overshoot).
  - **LV15:** `skipInitialAnimation`: the first change lands at once with velocity 0; the next springs.
  - **LV16:** `LiveValue.jump` on a user's own Atom: a velocity of it reads 0, where a plain set reads motion; a derived Atom is a defect.
- `live-values.browser.test.tsx` **LF17** (`jump` at rest and mid-flight, with the velocity of the spring) and **LF18** (`skipInitialAnimation`), on Solid 1.
- `v2/server.ssr.test.tsx` **SV19** and `live-values.ssr.test.tsx` **SL7:** on a server, the source's value, `jump` doing nothing, and the source accessor left alone.

**Mutation-checked:** twelve single-point mutations, all caught:
- a jump leaving the spring's run going (LV14, LF17), keeping its velocity (LV14), or leaving it marked running (LV14, LF17);
- a velocity ignoring jumps (LV14–LV16), or no listener told at all (LV14–LV16);
- a jump never setting the Atom (LV14–LV16), or allowed on a derived one (LV16);
- `skipInitialAnimation` ignored, or every change a jump (LV15, LF18);
- Solid 1's helpers not carrying their Atom, or not taking a carried one (LF17);
- a server's spring giving the user's own accessor a `jump` (SL7).

## Amendment (#395, 2026-10-26): a target in a static container

A `createScroll` with a `container` and a `target` measured where the target sits along its offset chain, as Motion's `calcInset` does (`insetOf` in `@wardic/dom`'s `internal/scroll.ts`). A `position: static` container is no offset parent, so the chain passed it, and the inset came out too large by the container's own offset. The progress read low, silently. The storefront's lookbook (#388) read 0 where 0.145 was due, so its parallax moved 4.5 px over a 400 px scroll instead of 49 px. Grilled 2026-10-26 (#395).

**Motion** (13.4.0, `scrollInfo`; `on-scroll-handler.ts:43–55` at `16c6122`) reads the same wrong progress. In development it warns once: *"Please ensure that the container has a non-static position…"*.

**The probe** (`.tmp/395/probe.ts`, Chromium 147 and Firefox 148, identical): a static panel, a positioned control, a positioned wrapper, static ancestors, and `<body>` as the offset parent.
- Inside a static container, `offsetTop` doesn't change with the container's scroll.
- The chain overshoots by the container's offset: 514 against a true 344.
- Taking that offset, and the container's border, off where the chain leaves the container gives the true inset in every layout.

**Decision** (Q1: A): **Wardic measures a static container correctly, and warns of nothing.** A static container reads what a positioned one gives, in both bindings, since `createScroll` reads `@wardic/dom`'s scroll source. That's a deliberate divergence from Motion, which reads wrong and warns. Code from Motion that already sets `position: relative` sees no change.
- Rejected: B, Motion's warning only, with the progress still wrong; C, both, warning of nothing wrong.

**Built:**
- `insetOf` checks each element the chain arrives at. Outside the container, the chain has passed it: `fromContainer` takes off the container's own offset to that element (`offsetTo`, along the container's chain) and its border (`clientTop` / `clientLeft`).
- The check sits in the function's early-return guard, not in a match at each step. As a match, it made a positioned container's read per scroll event 9% slower: 8.2 to 9.0 µs, in a temporary browser test of 20,000 reads with a target three wrappers deep. Now it reads in the same 8.2 µs as on main. A static one reads in 10.5 µs, where main took 11.5 µs to read it wrong.
- **A chain that ends** (`null`) isn't counted as leaving. A fixed target measures from the viewport, and the page's targets from the document, as in Motion, in any container. A page exemption, written first, was then dead code and was taken out (M5).

**Pinned by** `packages/dom/test/scroll.browser.test.ts` **PS12** (Chromium; run once in Firefox too). For each layout, a static container reads the progress the same layout gives with `position: relative`:
- the target straight in it, as in the issue;
- the target in a positioned wrapper;
- static ancestors in between;
- `<body>` as the offset parent;
- a table cell, with a positioned target, whose chain leaves at an ancestor above the container's own offset parent;
- a fixed target;
- the x axis;
- an SVG shape.

The positioned control's own progress is pinned to the box geometry, and so is the fixed target's (from the viewport). The page keeps its document offsets: a border on `<html>` isn't taken off.

**Mutation-checked** (`.tmp/395/mutate.py`). The six on the final code all fail PS12:
- no correction;
- either border kept;
- the container's offset taken one step only;
- a correction inside the container;
- a chain's end corrected.

On the way, M7 found that correcting a chain's end made a fixed target read differently in a static container than in a positioned one; it now reads the same in both.

## Amendment (#440, 2026-10-30): a transform's `mixer`, and descending ranges as Motion's

Grilled on #440 (Q1 A, Q2 A). `ease` was already there (#360); `mixer` wasn't, and a descending range of three stops or more mapped wrong (`[100, 50, 0] → [0, 1, 0]` gave `1` everywhere; two stops worked by accident).

- **`mixer`, Motion's** (Q1: A): `(from, to) => (t) => value`, made once per stretch when the transform is built, read through the stretch's `ease` (Motion's `pipe(easing, mixer)`). It takes the place of the `InterpolatorRegistry` for that transform's outputs, so with one they can be any type (`LiveValue.MixedTransformOptions<O>`, a second overload of `interpolate`, `transform` and both bindings' `createTransform`); without one they stay `number | string`, through the registry. Rejected: a registry codec handed to the transform; a per-call `(from, to, t) => value`.
- **Motion's mapping, ported** (Q2: A, and the defaults): `interpolate` follows `motion-dom`'s `interpolate`, measured against Motion 14.6's `transform`:
  - **a descending range** is mapped reversed, both arrays, so its `ease`, a list too, goes to the reversed stretches, each curve running toward the higher input: `easeIn` on `[1, 0] → [0, 100]` gives `37.81, 68.46, 90.65` at 0.75, 0.5, 0.25. Rejected: `ease` as written; keeping "input ascends" as an error.
  - **one stop** gives its output, and two equal outputs that output (one stop had been a defect);
  - **a stretch's search** is Motion's, the first that ends above the input, else the last, and **a stretch of no length** gives its second output at or past it (Motion's `progress` of a zero span is 1), the first one its first output before it (`isZeroDeltaRange`); it had given `NaN`;
  - **`clamp`** holds the input to the range, as Motion's, not each stretch's progress.
- **Where it runs:** both bindings, and a server, where a mixer needs no registry.
- **Pinned by:** `packages/test/test/live-value.test.ts` TR5 (one stop), TR7 (the mixer per stretch, `ease` first, any type), TR8–TR10 (descending ranges, their `ease`, Motion's edge cases, all at Motion's measured numbers); `transform-mixer.browser.test.tsx` TX1–TX3 and `v2/transform-mixer.browser.test.tsx` TXV1–TXV2 (into `style`); `v2/server.ssr.test.tsx` SV13 (a mixer and a descending range on a server).
- **Mutation-checked** (`.tmp/440/mutate.py`, run alone): 12 single-point mutations, 11 caught.
  - Caught: the mixer ignored, or the bindings dropping the options (TR7, TX1, TXV1, SV13); no `ease` (TR7, TR9, ME6); a descending range not reversed, or its `ease` list reversed too (TR8, TR9, TX3, TXV2); one stop a defect (TR5); no clamp, a zero span's progress 0, no first output before a zero first stretch (TR10, TR1, TR6).
  - A first run found the equal-outputs shortcut unpinned, as a number blend of `4` to `4` is `4`; TR10 now gives equal objects through a counting mixer, which Motion never makes.
  - **Equivalent:** the old stretch search (the last starting at or below the input). For any range in order, ascending or descending, it picks the same stretch as Motion's, zero-length ones and stops included; they part only for an input out of order (`[0, 10, 5, 20]`), which Motion's docs rule out.


## Amendment (#441, 2026-10-30): `createFollowValue`, Motion's follower, and `createSpring` its spring case

Grilled on #441 (Q1–Q5 A, Q6 B). Motion's `useFollowValue(source, transition)` follows a value on any transition, and `useSpring` is `useFollowValue(source, { type: "spring", ...options })`. Wardic had only `createSpring`. Measured on Motion 14.6 (the installed `motion-dom`, whose follower is its own `follow()`; `.reference/motion` is 13.x) in Node with a manual clock (`.tmp/441/441-probe*.mjs`). At 60 Hz Motion rounds each frame's time to a whole millisecond, so the numbers that pin it are taken at exact 20 ms frames (`441-probe-50hz.mjs`), where Wardic's match to three decimals.

- **`createFollowValue(source, transition)` on both bindings, `createSpring` its spring case** (Q1: A): core's `LiveValue.follow`, with `LiveValue.spring` its spring case. Both give a `FollowAccessor` with `jump`; `SpringAccessor` is its name for a spring. CONTEXT: **Follow value**, not "follower", which is a Shared layout twin. Rejected: `createFollow`, the one helper not Motion's name with `create`; `createSpring` taking any transition.
- **Motion's follower's defaults, `createSpring` included** (Q2: A): it spreads a transition over `{ type: "spring", restDelta: 0.001, restSpeed: 0.01 }`, so no `type` is a spring, and a spring takes `springDefaults`' 100 / 10 / 1 for the physics it leaves out, unless it's set by time (#359: a time field and no physics); `type: "tween"` is its generator's 0.3 s `easeInOut`. `{ duration: 0.5, ease: "easeOut" }` is a time-based spring, its `ease` unread. **Behaviour change:** `createSpring(x)` was core's 170 / 26, resting by distance (#344): no overshoot, at rest at frame 40 of a 0 → 100 move at 60 Hz. It's now Motion's: a peak of 116.3, at rest within 0.001 at about 2.3 s. A spring that gives its physics but no rest thresholds rests later, below a pixel (the storefront's 380 / 32: frame 47, from 28). Rejected: Wardic's `transition` rules (`{ duration: 0.5 }` a tween, rest by distance); Motion's type rule over core's own physics.
- **Seconds** (Q3: A): Motion's follower hands its options to the generators as they are, so its `duration` and `delay` are milliseconds (`{ type: "tween", duration: 0.5 }` lands on the next frame; its own docs show `duration: 0.5`). Wardic's are seconds, as every transition; an inertia's `timeConstant` stays milliseconds at the binding, as a `transition`'s (#435). Motion's spring reads `visualDuration` only beside `bounce` or `duration`; Wardic's reads it alone too, as its `transition` does. Rejected: milliseconds for a follow's two fields; a `duration` above 10 read as milliseconds.
- **A change mid-flight, Motion's** (Q4: A): a spring with no `delay` or `velocity` steers toward the source, read every step, keeping its velocity (`Machine.chase`, as before). Anything else starts again at the step after the change, from where its trajectory has reached that step, as Motion's `FollowAnimation` retargets at its next tick: a tween with its full duration and ease, and no velocity; an inertia gliding again, its target unread (#435); a spring with the transition's `velocity`, or its own. Changes in one frame start it once. Rejected: a tween keeping its end time; a velocity carried into the restarted tween.
- **`delay` is a debounce** (Q5: A): every change holds the value where it is for `delay`, for every type, then it goes on toward the latest, a spring keeping its velocity across the hold. A source that never rests doesn't move it. Rejected: a delay once per run (`createSpring`'s rule before); no `delay`.
- **Unit strings, Motion's** (Q6: B): a source whose first value is a string is followed as its `parseFloat`, shown with the unit it started with (its first value without its digits, `.` and `-`), so a later `"2em"` is followed as `2px`; its accessor is a string's and `jump` takes one. In the bindings (`live-style.ts`'s `withUnit`, an `Atom.map` of the follow's Atom): core's follow stays numbers. Rejected: numbers only; the unit read at every change.

**Defaults, stated:** the types are `"spring"`, `"tween"` and `"inertia"`, as a `transition`'s, with no `repeat`; a change to where it is starts nothing; `skipInitialAnimation` and `skipAnimations` (#468) for every type; reduced motion isn't read, as Motion's follower and `createSpring` before; on a server, its source's value, a string as it is.

- **Pinned by:** `packages/test/test/live-value.test.ts` FV1–FV7 (each type at Motion's 20 ms numbers: the defaults, a restart, changes in one frame, the debounce, an inertia, a given `velocity`, a change to where it is, `jump`, the skips) and SP3 (now Motion's spring); `follow-value.browser.test.tsx` FW1–FW4 and `v2/follow-value.browser.test.tsx` FWV1–FWV3 (a tween into `style`, a unit string and its `jump` mid-flight, `createSpring`'s overshoot, the debounce under a source changing every frame); `live-values.ssr.test.tsx` SL8 and `v2/server.ssr.test.tsx` SV24 (on a server), SL9 (an inertia's `timeConstant`, milliseconds to core's seconds).
- **Mutation-checked** (`.tmp/441/mutate.py`, run alone): 19 single-point mutations, all caught.
  - The defaults: core's physics for a spring, rest by distance, physics given to a timed spring, a linear tween (FV1, FV2, FV4, FV7, FW3, FWV3).
  - The restarts: a tween or an inertia steering, changes ignored, a restart dropping its velocity, the restart frame drawn from the new run (FV3–FV5, FW4).
  - The rest of the follow: no delay, a delayed spring steering, a given `velocity` unread, no check for its source, no first jump (FV4, FV6, FV7, FW4).
  - The bindings: an inertia's `timeConstant` read as seconds (SL9), a string's `jump` missing its numbers, no unit, a string source taken for a number on either binding (FW2, FWV2).

## Note (#443, 2026-10-30): `eachFrame` and the page's visibility

Grilled on #443 (Q1 A, Q9 A): Motion's `useAnimationFrame` and `usePageInView`, on both bindings.

- **`LiveValue.eachFrame(callback)`**, `createAnimationFrame` in the bindings: `time` is 0 at its first frame, then the total of each tick's `dt`, unclamped, as `time` keeps wall time; `delta` is the tick's `dt` held to 1–40 ms, as Motion's frame loop holds its delta, and the Clock's nominal 16.7 ms on a wake. A run on the Frame loop that never settles, ended with its Scope. A throw from the callback is logged at the first of a run of throws and the next frame calls it as ever, as `onUpdate` (ADR-0030, *Amendment (#257 item 4)*). Nothing on a server. Rejected: the delta unclamped, which hands a physics step a hidden tab's minutes.
- **`Probe.pageVisible`**, `createPageInView` in the bindings: whether the Environment's page is shown, the DOM's `document.visibilityState`, set within `visibilitychange`. `true` on a server, and a hydrating client keeps it until mount (the Hydration hold, ADR-0021 decision 8), as Motion's starts `true`.
- **`createReducedMotionConfig()`** (Motion's `useReducedMotionConfig`): the nearest `WardicConfig`'s `reducedMotion`, else the provider's, over the user's preference, `ReducedMotion.applies`. The context value now carries the provider's own setting (`reducedMotionSetting`). On a server `"always"` is `true` and the rest `false`, with the same hold. And `createCycle` (Motion's `useCycle`): its index kept outside the signal too, as Motion keeps it in a ref, so two steps before Solid 2 flushes step twice.

- **Pinned by:** `packages/test/test/live-value.test.ts` AF1–AF3; `small-utilities.browser.test.tsx` SU1–SU5b, `v2/small-utilities.browser.test.tsx` SUV1–SUV4b; `small-utilities.ssr.test.tsx` SUS5, `v2/small-utilities.ssr.test.tsx` SUSV5; `server-render.hydrate.browser.test.tsx` HY-H4 (a hidden page hydrates `true`, the server's, then `false`).
- **Mutation-checked** (`.tmp/443/mutate.py`, run alone): 37 single-point mutations with ADR-0062's *Amendment (#443)*, 36 caught. Here: the first frame's time not 0, the delta unclamped or floored at 0; a throw not caught, every throw reported, a returning frame not ending the run; either binding's run outliving its owner; no wrap, anything given jumping, either binding stepping from the signal; the page's visibility not followed or read at the start, either binding's server value or Solid 1's hydration hold `false`; the config's or the provider's setting ignored, a server's provider setting ignored, either binding's preference unread. SUV1 unmounted its whole provider at first, which stops every run, and SU5 only met a preference of `false`: SUV1 now drops its ticker alone, and SU5b and SUV4b emulate the preference. **Not caught:** `eachFrame` without its Supersede token's `end` at its Scope's close, as `time` has: the Scope's close interrupts the run's fiber anyway, and the token only takes it off the loop at once within a tick, which no test reaches.
