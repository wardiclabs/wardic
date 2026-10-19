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
   - **No compositor path:** Motion hands `scroll` to a native `ScrollTimeline` where it can; Wardic draws everything through the gate.
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
