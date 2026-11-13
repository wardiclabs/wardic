# Wardic Core

The framework-agnostic animation engine. Defines the vocabulary for how motion is
produced (primitives over a clock), observed (frames), and handed off (retargeting),
independent of any rendering environment.

## Language

### Motion production

**Primitive**:
A clock-driven piece of motion (`spring`, `tween`, `decay`, `inertia`, `animate`, `keyframes`, `chase`, and their multi-key forms) that produces one Frame per tick until it Settles. It runs as a Stream of Frames, or on the **Frame loop**.
_Avoid_: animation (too broad), tweener, machine (its code form).

**Physics primitive**:
A Primitive whose motion is governed by simulated forces and therefore carries velocity — `spring`, `decay`, and `inertia`, a decay that springs back to an edge it would cross (Motion's, what a drag's release runs, and a transition of `type: "inertia"`, which glides each number from where it is on its velocity, whatever its target, #435).
_Avoid_: dynamic animation.

**Time-based spring**:
A spring set by how long it takes rather than by its physics, as Motion's are (#359): a `duration` (with a `bounce`) solved to a stiffness and damping, which ends at that duration; or a `visualDuration` (with a `bounce`), by which most of its move is done, which ends at rest. A `stiffness`, `damping` or `mass` given beside makes it a physics spring again.
_Avoid_: duration spring (for both: `visualDuration`'s doesn't end at a duration), timed spring.

**Definite primitive**:
A Primitive whose motion is governed by a fixed duration and easing, with no momentum — `tween`, `keyframes`, `animate`.
_Avoid_: timed animation.

**Chase**:
A Physics primitive that follows a continuously-moving target indefinitely — it never auto-Settles and ends only when cancelled.
_Avoid_: follow, track.

**Frame**:
One per-tick output of a Primitive — the current value plus whether motion has settled. Distinct from a **Refresh frame**.
_Avoid_: tick, step, sample.

**Physics frame**:
A Frame that additionally carries `velocity`; emitted only by Physics primitives. The optional `velocity` is the discriminator a type guard narrows on.
_Avoid_: snapshot (reserved — see below).

**Interval**:
One of the pieces an `animate` or `keyframes` run plays in sequence: one pass of a repeat, or the stretch between two stops. Each starts the moment the one before it ends, in frame time, wherever that falls within a tick, and only the last one's end settles the run.
_Avoid_: segment (a **Sequence**'s step), leg (a Retarget's run), iteration (Motion's word for one pass of a repeat).

**Hold**:
A stretch of frame time in which a run's value stays where it is: its `delay`, before its first Interval, or a gap after an Interval that keeps that Interval's last value (`repeatDelay`, Motion's; #91).
_Avoid_: pause (a paused run doesn't tick), wait.

**Frame time**:
Time as a run on the Clock counts it: the sum of the `dt`s of the ticks it has been stepped through, each counted at most `MAX_DT`. A Hold, a tween's `duration` and a stagger are in frame time, so they stop when the Clock does (a hidden tab) and fall behind through a stall. Effect's own time (`Effect.sleep`, `Effect.timeout`, `Schedule`) is wall time (ADR-0030).
_Avoid_: animation time, clock time.

**Positional key**:
A key that moves or resizes the element: a transform (`x`, `scale`, `rotate`, …), or a key its Environment names as the element's position or size (the DOM's: `width`, `height`, `top`, `left`, `right`, `bottom`, Motion's `positionalKeys`). Reduced motion Snaps these and no others (ADR-0029).
_Avoid_: layout key (a layout animation is the projection's), geometry.

**Snap**:
Under reduced motion, a run's Positional keys landing where the run would end, in one Frame, after the Hold their leg would have had (`ReducedMotion.snap`, ADR-0029). The run's other keys animate as they would, and a layout animation lands on its new box at once.
_Avoid_: jump, skip, instant animation (Motion's `type: false`).

**Frame loop**:
The one loop per Environment that steps every running Primitive once per tick, in one pass, and hands each its Frame. It holds one `Clock.ticks` subscription while anything runs. The binding runs its Primitives on it from #74, and dom's projection coordinator is one of its runs from #75. Within a tick, runs step in the order they were added, and the projection coordinator after all of them, so it reads what they wrote that tick (ADR-0027). A run added in a tick's **Late window** takes its **Late step** there (ADR-0027 *Amendment (#680)*).
_Avoid_: coordinator (ADR-0006's placeholder; dom's projection coordinator is one of its runs), ticker, driver, scheduler (Effect's).

**Late window**:
From a **Frame loop** tick's first step until the microtask the tick queues at its end has run: the tick itself, its hooks (the flush gate's flush, the app callbacks the engine calls there), and the microtasks they queue, such as Solid 2's effects. Whatever starts in it is drawn in that tick's Refresh frame, after the tick and before its paint. App code in a later rAF callback, or in a microtask queued after the loop's, is past it (ADR-0027 *Amendment (#680)*).
_Avoid_: in-frame, frame window, after-tick (that's the `afterTick` hook).

**Late step**:
The first step a run added in a **Late window** takes there, at the tick's dt, so the frame paints it rather than its origin. The flush gate then flushes again. A Late step can add more runs, which take theirs in the same window, up to 5 rounds. The projection coordinator takes none: the Measure pass that started it has stepped its nodes already (ADR-0027 *Amendment (#680)*).
_Avoid_: Priming step (ADR-0033 removed that: taken in every task, it doubled the first painted step).

**Batch**:
Many Subjects, or a mesh's instances, animated on the same keys as one run on the **Frame loop** (#665, ADR-0069). Each member's values, velocities and targets are kept together, so a new target turns every member toward it at the speed it already has. Its members are fixed when it's made, or, in a keyed Batch, enter and leave with their items: an entering member animates from its start, and a leaving one plays its exit before it goes. It runs springs and tweens on numbers. A member can be hovered and pressed, and returns to its target when the gesture ends. The latest driver of a key wins per member: a **Ward**, an `animate` or another Batch that takes a member's key starts from where it is and how fast it's moving, and the Batch takes it back the same way. Motion has none: its `animate` over an array runs each Subject on its own, as Wardic's does.
_Avoid_: group (a `LayoutGroup`'s, a **Reorder group**'s), instances (three's), swarm, collection.

**Batch member**:
One of a **Batch**'s Subjects, or one instance of its mesh, by its index.
_Avoid_: slot (a **Projection node**'s box), instance (three's word for one row of an `InstancedMesh`: one kind of member), element.

### Lifecycle

**Settle** (at rest):
The point at which a Primitive reaches its rest thresholds; it produces a final Frame and completes.
_Avoid_: finish, end, stop.

**Retarget**:
Replacing a running Primitive with a fresh one seeded from its last Frame, for each key whose target changed: the running one gives the key up, and is **Superseded** once it has none left. A Physics primitive carries velocity across the seam; a Definite primitive restarts from the current value. A key whose target didn't change is a **Carried key**. A change that resolves the same target starts no Retarget: the same values, variant names and **Keyframes**, with the same gesture layers on (#470, Motion's rule). So a `transition`, `style` or callback change moves nothing, and tells nothing.
_Avoid_: restart, cancel, interrupt (those name a mechanism, not the intent).

**Carried key**:
A key a Retarget resolves to the same target as its running **Leg**: the Leg runs on, unrestarted, and the Retarget lands once it has (#325, Motion's per-key rule). A key whose last Leg landed at that target starts none, and stays where it is. So does a key already at its target with nothing moving it (#448). **Keyframes** are the same target when every stop is (#429). A key whose **Transition end** changed isn't one: it starts again (#470).
_Avoid_: protected key (Motion's name for it), kept key.

**Superseded**:
A run a Retarget ended before it settled. It leaves the **Frame loop** at once and ends normally: neither settled, so it counts toward nothing, nor failed, so nothing reports it.
_Avoid_: cancelled, interrupted (mechanisms: a Superseded run's fiber isn't interrupted).

**Snapshot**:
The last value a binding has cached for each key it drives, a number or a string, with each numeric key's velocity, as its last frames moved it, whatever drew them (a spring, a tween, keyframes, a drag; #464, Motion's): the seed read at the moment of a Retarget.
_Avoid_: state, current value.

**Leg**:
One Primitive run a Retarget starts: the numeric keys' and the string keys' are separate legs, and an element settles with its last. A Leg draws its keys until a later Retarget changes them, and one left with none is Superseded.
_Avoid_: interval (a piece of one `animate` or `keyframes` run), segment (a **Sequence**'s step), track.

**Value transition**:
One value's own transition, inside an element's, a variant's, a gesture target's or an exit's (#301, Motion's): an entry under the value's name. A key runs on its value transition, else the transition's `default` entry, else the transition's own fields; a layout animation on its `layout` entry the same way. Keys on different value transitions are separate Legs. The orchestration (`staggerChildren`, `when` and the rest) stays the whole transition's.
_Avoid_: per-key transition, override (that's the **Override stack**'s word).

**Config transition**:
A subtree's default transition (#434, Motion's `MotionConfig` `transition`), given by a `WardicConfig` above its Wardic elements: an element with no transition of its own runs on it, before its **Default transition**, and a **Variant child** on it in place of its parent's, as in Motion. A `WardicConfig` inside another replaces its transition or, with `inherit: true`, lays its own fields over it.
_Avoid_: global transition, provider transition.

**Skipped animation**:
An animation that lands at its end on its next frame, with no delay, no stagger and no velocity, under a `WardicConfig`'s `skipAnimations` or a transition's (#468, Motion's): every animation an element runs, its exit, its layout animations and a drag's release among them, and a spring following a value. It's told as any landing is. On a server page its **Appear animation** lands at once, so the page is drawn landed from the first paint. Made for end-to-end and visual-regression tests.
_Avoid_: instant animation, disabled animation (it still runs, and is still told).

**Path**:
A curve `x` and `y` travel along together, or a layout animation's centre, from where they start to where they end, given as a transition's `path` (#438, Motion's): `arc()` makes one, bulging off the straight line between them, and any function from the two ends to a point at each progress is one. It can turn the element along the curve, on a turn of its own added onto its `rotate`. Timed by `x`'s transition, from rest.
_Avoid_: motion path (that's CSS's `offset-path`), arc (one kind of Path).

**Default transition**:
What a key runs on when its transition isn't defined: none given, or one with only orchestration (`delay`, `staggerChildren`, `when` and the rest), as Motion's `isTransitionDefined` has it. Its **Environment** picks it, by key and target (the DOM's, Motion's: a spring for a transform, a stiffer one for a scale, critically damped toward 0, and a 0.3 s ease for the rest); an Environment with no opinion runs every key on one spring (#357). A key through more than two **Keyframes** stops runs on the Environment's one keyframes default (the DOM's, Motion's 0.8 s tween; #429).
_Avoid_: fallback transition, implicit transition.

### Value blending

**Interpolator**:
A value kind and how two values of it blend: it decodes an endpoint of its kind (a number, an array, a unit string, a **Complex value**; an Environment adds its own, the DOM's colours) once, when a stream is built, and blends two decoded endpoints at progress `t`, encoding the result each frame. A value it can't decode isn't its kind.
_Avoid_: easing (distinct — see ambiguities), tween, mixer (Motion's).

**Complex value**:
A string carrying one or more numbers among other text: an SVG `d` or `points`, a `filter` such as `blur(4px)`, a `box-shadow`. A string that is only a number with a unit is a unit string, not a complex value. Its Environment can name kinds of token besides numbers, which blend as their kind (the DOM's: a colour, `#hex`, `rgb()`, `hsl()`), and spans that are only text (the DOM's: a CSS `var()`), so the digits in them are never numbers.

Two complex values blend when they hold the same count of colours and the start holds at least as many numbers as the target. The first colour blends with the first colour and the first number with the first number, and so on, written in the target's structure, so `rgba(0, 0, 0, 0.2) 0px 1px 2px 0px` blends with `0px 8px 24px rgba(0, 0, 0, 0.3)`. Any other two are a **Discrete pair**.

A shadow (`boxShadow`, `textShadow`) is a list of shadows, matched one by one. A length missing from a shadow counts as 0, CSS's own default, and a shadow missing from one end grows from its **Animatable none**.
_Avoid_: path (a path is one kind of complex value).

**Easing**:
A reshaping of normalized time `t`∈[0,1]→[0,1] applied by Definite primitives; orthogonal to interpolation. A transition gives it as `ease`, Motion's word, in any of Motion's forms (an **Easing definition**).
_Avoid_: curve, interpolator.

**Easing definition**:
How an `ease` names its Easing, as Motion's do: one of Motion's names (`"easeOut"`, `"backIn"`, `"anticipate"`…), a cubic bézier's four numbers (`[0.25, 0.1, 0.35, 1]`), or the function itself (#360).
_Avoid_: easing type, timing function (CSS's word).

**Discrete pair**:
A `from`/`to` pair no Interpolator can blend (`"auto"` → `"none"`, two complex values with different counts of colours, a path into a longer one, two lengths in different units like `"10px"` → `"1em"`). It switches to its target at its leg's first frame; a `display` or `visibility` pair turning to `none` or `hidden` switches at the leg's last frame instead (ADR-0024). A positional key's pair is a **Measured pair** instead (#430).
_Avoid_: instant animation (Motion's), snap.

**Measured pair**:
A positional key's `from`/`to` pair whose ends differ in type (`"auto"`, `"50%"` against a length in px, a `calc()` on one side), on `width`, `height`, `top`, `left`, `right`, `bottom`, `x` or `y` (#430, Motion's). Both ends are measured in px before the next paint, its leg runs between them, and it lands on its target as given, so `auto` follows its content afterwards. Keyframes of more than two stops that mix types stay a **Discrete pair**.
_Avoid_: auto animation, unit conversion.

**Variable value**:
A value that is wholly a reference to a custom property, `var(--name)`, with or without a fallback. It stands for that property's value on the element: its Environment resolves it against the element, once, when a leg starts, and the leg blends what it resolved to. The leg's last frame writes the reference itself, so at rest the element follows the property again. A `var()` inside a larger value (a shadow, a `calc()`) isn't one: it stays part of that value's text.
_Avoid_: CSS variable (the custom property itself), token (a complex value's token).

**Key rule**:
An Environment's rule for how one key's pair blends, picked by the key or by its pair: it gives the key's blend for the whole leg, or declines, and the pair blends by value through the **Interpolators**. Most hold for the whole Environment; one can be bound to an element for a leg, when it needs to read that element (a **Variable value**'s). Core holds none: they are the Environment's, and the DOM's know CSS properties.
_Avoid_: key interpolator (an Interpolator is picked by value), property hook.

**Animatable none**:
What a pair's empty end stands for, so the pair blends instead of being a **Discrete pair**. An empty end is `"none"`, `0`, `"0"`, or a zero with a unit like `"0px"`. When the other end carries a number or a colour (a **Complex value** or a lone colour), the empty end becomes that value with every number at zero and every colour transparent. Two kinds of key differ:
- **A filter** (`filter`, `backdropFilter`) puts each function at its identity: 1 for `brightness`, `contrast`, `saturate` and `opacity`, and 0 for the rest. A `drop-shadow()` grows from a transparent zero, like a shadow.
- **A mask** (`mask`, `maskImage`) keeps its colours opaque, so the element stays visible.

A shadow from `"none"` grows from a transparent zero shadow, and a `padding` of `"0px"` opens to `"4px 8px"`. On the way back the pair blends to its Animatable none and takes its empty end, as written, on its leg's last frame, so at rest the element is exactly what the author wrote. When the other end carries neither (`"auto"`), or is a plain length like `"100px"` (`none` isn't 0 for `max-height`), the pair stays a Discrete pair.
_Avoid_: zero value (a zero with a unit is one kind of empty end).

**Transition end**:
A target's values set at once, with no animation, once the keys that target animates have landed (#428, Motion's `transitionEnd`): `{ opacity: 0, transitionEnd: { display: "none" } }` hides the element after it fades. Its keys belong to the target's entry in the **Override stack**, so they return to their **Base value** when that entry goes inactive, and a target interrupted before it lands never sets them. The first frame's target sets its own at once. A landing includes them.
_Avoid_: end values, final values (a keyframe's last value is its final value).

**Keyframes**:
A target value given as a list of stops the key passes through in order (#429, Motion's): `scale: [null, 1.2, 1]`. A first `null` stop is where the key is now; a later one repeats the stop before it. An explicit first stop is jumped to when its Leg starts. Keyframes are never already at their target. Equal Keyframes, stop by stop, are a **Carried key**; they play again from their first stop when a gesture's entry over the key in the **Override stack** goes inactive, or a variant change resolves them again. An `initial` given Keyframes starts at its first stop, or at its `animate`'s last when the mount starts there.
_Avoid_: steps, waypoints, sequence (Motion's name for a timeline of several animations).

**Override stack**:
An ordered set of partial, optionally-active value-maps that resolve to a single target — for each key, the topmost *active* entry wins. This is how stacked gesture states combine (base `animate`, then `whileHover`, `whileTap`, `whileDrag`…). Core ships the pure resolution mechanism (`Override.resolve`); the binding owns the named priority order and the variant names. The resolved target feeds `springValues` / `animateValues`.
_Avoid_: **layer** (collides with Effect/Environment Layer — never reuse it here), variant stack, state stack.

**Gesture layer**:
A gesture's entry in the **Override stack**: the values its `while*` (`whileHover`, `whileTap`, `whileDrag`, `whileFocus`, `whileInView`) sets while the gesture is on, over the element's base entry and below any gesture that ranks higher. The one compound that keeps "layer", as Motion's word for it; an entry on its own, or the base one, is an *entry*.
_Avoid_: gesture state, layer (alone).

**Imperative animation**:
An animation started by a call rather than declared (#433, Motion's `useAnimate`): `animate(elements, target, options)` from an **Animation scope**, on Wardic elements and plain ones alike, returning its **Playback controls**. On a Wardic element it takes the keys it animates from whatever ran them, and they stay where it leaves them until the element's own target for that key changes: a value's latest animation wins, as in Motion. A key it never touched follows the **Override stack** as ever.
_Avoid_: imperative layer (it isn't an entry in the **Override stack**), manual animation.

**Animation scope**:
The element an **Imperative animation**'s selectors are looked up in, and the owner of the animations started from it (#433, Motion's `useAnimate` scope): its component's cleanup stops them.
_Avoid_: animation context, root.

**Playback controls**:
What an **Imperative animation** returns (Motion's): awaitable, and able to stop it where it is, cancel it back to where it started, complete it at its end, pause and play it, change its speed, and seek its time.
_Avoid_: animation handle, player.

**Sequence**:
An **Imperative animation** of Segments laid out in time (#433, Motion's `animate(sequence)`): each Segment animates its subjects to its values, one after another unless its `at` places it (a time, a time after or before the Segment before, or a **label**'s). It plays as one animation, under one set of **Playback controls**: each subject's values run through their stops over the whole sequence. A function Segment animates a value, from 0 to 1, told to its callback each frame.
_Avoid_: timeline (the roadmap's `@wardic/timeline` is its own abstraction), chain, choreography.

**Segment**:
One step of a **Sequence** (Motion's word): an element's or a value's animation with its options and its `at`, a **Batch**'s members each through their own stops, a function animated from 0 to 1, or a **label**.
_Avoid_: interval (a piece of one run), keyframe.

**Animation controls**:
One object, made anywhere, that Wardic elements are given as their `animate` (#433, Motion's `useAnimationControls`): each element given them follows its calls. A start sets each one's `animate` entry, so it animates and orchestrates its **Variant children** as a change of the prop would, and is awaited until they have all landed; a set lands them at once; a stop ends them where they are. An element given them names its own variants, whatever it's been started to.
_Avoid_: animation handle, controller, imperative layer.

**Controls change**:
What one start or set of **Animation controls** makes of one element: its new `animate` entry and the transition of the change, if one was given. The element and the **Variant children** it reaches run their first animation for it on that transition, which then orchestrates them, and the change lands once they all have; their next animation, a gesture's, runs on their own transitions again.
_Avoid_: command, controls update.

**Variant child**:
A Wardic element with `variants` that names none of its variant props (`initial`, `animate`, the five `while*` gestures, `exit`), and doesn't set `inherit={false}`. It joins its nearest Wardic ancestor that has variants of its own (`variants`, or a name on any variant prop): it inherits that ancestor's `initial` and `animate` names, resolved against its own `variants` (the `initial` name as its **Starting style**, read once; an inherited `initial={false}` starts it at its `animate`, #134), takes a stagger slot among the ancestor's variant children, and counts for its `when`. Any other Wardic element passes the names through to its children untouched, except one with `inherit={false}`, which passes none from above it (#50, Motion's rule).
_Avoid_: registered child, orchestrated child.

### Interaction

**Recognizer**:
A core combinator that interprets raw `InputSource` (or `Probe`) events into a portable interaction signal — the *recognition* half of a gesture. Which value or variant to apply in response is the binding's concern, not the recognizer's. Like every Primitive it's a function returning a Stream with its service deps in `R` (e.g. `drag(target): Stream<…, never, InputSource>` — velocity is computed from pointer-event timeStamps, so `drag` needs no `Clock`; `Clock` enters only at a Fling, where `inertia` ticks). Every recognizer is also a **watch** (#318, #379): a callback told inside each event's dispatch while a Scope is open, with no fiber of its own. Its Stream is built over the watch, and a binding runs the watch.
_Avoid_: gesture (names the whole feature, not the core piece), handler, listener.

**Keyboard press**:
A press made from the keyboard on the focused element (#427): Enter or Space goes down to start it, and it taps when the key comes back up; a blur cancels it. It is a press like a pointer's, with `whileTap` on through the hold, and its events say they came from the keyboard and give the element's centre as their point. It reaches the element's pressable ancestors as a pointer's press does, each pressed too, unless a **Press claim** stops it (#439, Motion's); a key on something inside that has no press of its own, a text field or a plain button, presses none of them. A key the page or a **Keyboard reorder** has already taken starts none, and an element with a press that can't take focus is made focusable, as Motion's are.
_Avoid_: keyboard tap (a tap is only a press's end), key click.

**State recognizer**:
A Recognizer that emits a `Stream<boolean>` — active / inactive — for the binary gestures `hover`, `press`, `focus`, `inView`. The binding toggles a variant on the boolean. `press` listens to the **Primary pointer**, and to a **Keyboard press** on its target. `hover` ignores touch, starts no hover during **Drag activity**, and holds a leave until the release of a pointer pressed on its target (ADR-0019).
_Avoid_: binary recognizer, flag.

**Edge**:
A **State recognizer** turning on or off, with the event that turned it: a hover's start or end, a target coming into view or leaving it (`Recognizer.Edge`, `Recognizer.ViewEdge`). An event that changes nothing is no Edge.
_Avoid_: transition (an animation's), toggle.

**Sample recognizer**:
A Recognizer that emits an event-driven stream of samples carrying positional data and velocity, for the continuous gestures `drag` / `pan`. Distinct from a Frame: not clock-driven and has no Settle — its emissions are events, not ticks.
_Avoid_: continuous recognizer, tracker.

**Drag sample**:
One emission of the `drag` Sample recognizer — four `{ x, y }` vectors plus a phase: `point` (current pointer position), `offset` (total movement since drag start — for positioning), `delta` (movement since the last sample — for incremental work), `velocity` (per-axis: the pointer's speed over its last 100 ms, up to this sample, as Motion's `info.velocity`), and `phase` (`"start" | "move" | "end"`). The `end` sample counts the release point too, so letting go after a pause gives a lower velocity, down to none. It is the only drag velocity Wardic reads: the `end` sample's feeds a Fling (a fresh `inertia` seeded from it) and a layout drag's release, and each move's gives a Reorder group its direction. All four vectors are **2D**: a pointer has no z, so 3D "z-drag" is a consumer-side *projection* (camera/raycast) — response, not recognition. A genuinely spatial input environment (VR/AR, raycast-with-depth) would warrant a dedicated spatial Recognizer, not a z bolted onto this sample.
_Avoid_: drag event, pointer sample.

**Drag transition**:
What every drag release runs on, apart from the element's own transition (Motion's `dragTransition`): a **Fling**, a snap back to the drag's origin, and a **Projection node**'s **Release offset**, Reorder's included. A release never borrows the element's transition.
_Avoid_: release transition, momentum transition.

**Fling** (momentum handoff):
A drag release continuing under physics — a fresh `inertia` **per axis** seeded from the Drag sample's `end` velocity, so motion continues with no visible kink. It runs on the **Drag transition**, and respects the drag's constraints: where its glide would cross one, or starts past one, it springs back to that edge and rests there. A press on the element (a grab) stops it where it is. The binding composes it from core's `drag` Sample recognizer and `inertia` Primitive; core has no Fling of its own until a binding-less Environment needs one (ADR-0004, *Amendment (#32)*).
_Avoid_: inertia (the Primitive it runs), throw, momentum (name the mechanism — Fling).

**Release offset**:
A released **Projection node**'s distance from its slot, per axis, springing to zero on its own, on the **Drag transition**, from the drag's release velocity (none with `dragMomentum={false}`), on top of the node's layout animation. A slot that moves during the release animates underneath it and leaves the offset's motion as it was, as Motion's `dragSnapToOrigin` release does (ADR-0016).
_Avoid_: release FLIP, flight back.

**Pointer kind**:
What kind of pointer an event comes from, in core's words: a mouse, a pen, a touch, or another kind. Each Environment maps its platform's names onto these (#189).
_Avoid_: pointer type (the DOM's `pointerType`), device.

**Primary pointer**:
The pointer `drag` and `press` listen to: a mouse event with its main button or no button change, or any other **Pointer kind**'s first contact on the page (an event's `primary`). A right-click doesn't drag, and a second finger neither presses nor moves a drag. Motion's `isPrimaryPointer`, kept in core over core's own fields (ADR-0019, #189).
_Avoid_: main pointer, first pointer.

**Stale gesture**:
A gesture whose release was lost, e.g. swallowed by another listener or released outside the window. It ends as a cancel, at its last pressed point with no velocity, at the owning pointer's first move with no button pressed, at its next down, or at the next press anywhere by it or by a new primary pointer of its kind (ADR-0019).
_Avoid_: stuck drag.

**Drag activity**:
The number of drags active on the page, counted in one core `Context.Reference` that also holds the **Drag claims**. A drag counts in it once past its threshold and counts off at its end or when interrupted. While it is non-zero, no hover and no press starts (ADR-0019).
_Avoid_: drag lock (that's a **Drag claim**), dragging (a projection node's flag, ADR-0016).

**Drag claim**:
A target's hold on the page's drag axes, each claimed on its own: the axis of an `x` or `y` drag, or both for a free one. It's taken at the drag's start and kept until that gesture ends or the drag is interrupted, and every drag subscription on one target shares it. A drag that needs an axis another target holds is refused for its whole gesture, so of nested draggables the innermost drags, unless they drag on different axes (ADR-0019, *Amendment (#29)*).
_Avoid_: drag lock (Motion's name), axis lock (a drag kept to one axis), pointer capture.

**Press claim**:
An element's hold on the pointer down or the key its press starts from, taken when the element doesn't let its taps propagate (#439, Motion's `propagate={{ tap: false }}`): no press of an ancestor starts from it. By default nothing is claimed, and a press inside a pressable element presses both. It touches presses only: a **Drag claim** is its own.
_Avoid_: stop propagation (the platform's, which stops every listener), tap lock.

**Drag controls**:
A drag's start from outside its element (#431, Motion's `useDragControls`): controls made apart and given to one element or more, whose `start(event)` begins each one's drag from a pointer that went down elsewhere, a handle or a track, which the drag then follows as if it had pressed the element. `stop()` ends a drag as a release would; `cancel()` ends it where it is. With `dragListener={false}`, an element's own presses start none. A drag the controls start takes its **Drag claim** as any drag does.
_Avoid_: drag handle (one use of them), drag trigger.

**Reorder group**:
The items a drag can reorder, and the rules that do it. Core's `Reorder.Group` (built by `Reorder.make`) holds each item's box, read from its projection handle at each drag sample, or, in a **Batch Reorder group**, computed from the item's place, and decides each **Crossover**. `@wardic/dom`'s controller wires it to the items' drags, Auto-scroll and the axis. The binding owns the `values` array, `onReorder`, the elements and JSX. After a reorder it makes no further one until the new order's boxes are known: a Measure pass has measured them, or the Batch has placed them (ADR-0020).
_Avoid_: sortable, list (the element), reorder context.

**Batch Reorder group**:
A **Reorder group** whose items are a keyed **Batch**'s members, each at the place its index gives: from its own size and the sizes of the items before it, the gap between, and, in a grid, where its rows break. The sizes are the app's, one for every item or one for each, or read from the items on the page (#714). Its items' boxes are computed from those sizes, never read at a **Crossover**, so a Crossover waits for no **Measure pass**, and its items are dragged and focused through the group (ADR-0072).
_Avoid_: virtual list (every item is mounted), sortable, slot (a **Projection node**'s box; an item's position is its place), re-measure and Measurement (an item's size is read; a Measurement is the projection's `Bounds`).

**Crossover**:
The point at which a dragged item has moved far enough past a neighbour to take its place, which changes the order.
- On a single axis: its leading edge passes the centre of the neighbour on the side it's moving toward, the direction coming from a 100 ms window of its drag. A sample that carries it past several centres moves it past them all.
- In `"xy"`: its centre is nearer another line of items, or another item's box.
It's Motion's rule, with the neighbour chosen by position rather than by index (ADR-0020).
_Avoid_: swap (one outcome), collision (dnd-kit's term for a different model).

**Auto-scroll**:
While a **Reorder group** item is dragged toward, and within 50 px of, its scroll container's visible edge, the container scrolls, faster the nearer the edge. It stops at the scroll range it had when it started. Because each scroll moves the **Held pointer**, it keeps going while the pointer holds still (Motion's; ADR-0020).
_Avoid_: edge scroll, drag scroll.

**Keyboard reorder**:
A **Reorder group** item moved with the keyboard instead of a drag: lifted with a key, moved one place per arrow key, then dropped or cancelled, each step animating as a drag's reorder does and each announced to assistive technology. Built into every group (#43); Motion has none.
_Avoid_: keyboard drag (nothing is dragged), keyboard sort.

**Reorder hold**:
A **Reorder group** item in a user's hand: from its drag's start (past the drag's threshold, not the press) or its **Keyboard reorder** lift, to its release or drop, its cancel, or its unmount. Every reorder hold ends once, whatever ends it; one that changed the order is told as a reorder too, before its end (#348). Its events keep the short names, `holdStart` and `holdEnd`.
_Avoid_: hold alone (a run's **Hold** is frame time), grab, lift (the keyboard's alone), keyboard drag.

**Announcement**:
A message spoken to assistive technology, such as a **Keyboard reorder**'s "Dropped Milk at position 3 of 6". Core words it; the Environment's Announcer delivers it (in the DOM, a live region shared by the page). Each one replaces the last.
_Avoid_: notification, toast (visible), alert (a role).

### Layout

**Measurement**:
A `Bounds` reading taken via `Probe`, recorded so a later layout change can be animated from it. Distinct from a **Snapshot** (a cached *Frame* seeding a Retarget): a Measurement is *geometry*, a Snapshot is a *cached value*. The two never substitute for each other.
_Avoid_: snapshot (reserved), rect, box.

**FLIP** (layout animation):
Animating an element from a prior Measurement to its current one by inverting the geometric delta and playing it to zero (First, Last, Invert, Play). It plays on the element's transition; with none, on Motion's default, a 0.45 s tween eased `cubic-bezier(0.4, 0, 0.1, 1)`. Core's **Projection** owns the Invert→Play math; the binding reports the layout changes only it knows about (`layoutDependency`: a position-only move is invisible to `Probe.observeResize`, so only the render lifecycle knows the before/after points), and the **Projection system** measures them in a **Measure pass** at the end of the task; matching `layoutId`s is the Projection system's (ADR-0010). Inherently post-mount, so it cannot be SSR'd and the first frame may flash (see ADR-0003). The general, *nested-correct* realization is **Projection** (below) — FLIP is its un-nested special case.
_Avoid_: layout (too broad), reflow animation.

**Projection** (the box-based layout model):
Animating an element's *target Box* and **deriving** its transform each frame, tree-aware: a node's box is expressed relative to its parent node's *projected* box, and translations are corrected by the cumulative ancestor scale (**treeScale**) so nested layout animations compose correctly through CSS transform nesting. Box-based (animate the box, derive the transform), **not** invert-delta-based (see ADR). Plain **FLIP** is the un-nested special case (no parent node ⇒ project relative to the viewport). Core owns the pure box geometry (relative box, axis delta, tree-scale, applied around an `origin`/anchor); the **Projection system** (`@wardic/dom`) owns the node tree, the **Measure pass** and the per-frame projection pass; the binding reports the layout changes only it knows about (`layoutDependency`).
_Avoid_: FLIP (reserve for the un-nested case), transform tree.

**Layout mode** (`layout="position"` and the rest):
Which parts of an element's layout change its **FLIP** animates. With `true`, it animates both position and size. With `"position"`, its size takes the new value at once and only its top-left corner slides. With `"size"`, its position takes the new value at once and only its size animates. With `"x"` or `"y"`, only that axis animates. With `"preserve-aspect"`, both animate while the width/height ratio stays close, and only position animates when the ratio changes. With `false`, nothing animates: an element only a `layoutScroll` or a **Layout sub-root** makes a node, with no `layout` or `layoutId`, has no layout animation of its own, as Motion's. The mode is read at each layout animation's start. In a **Crossfade**, a **Follower** whose mode animates position only keeps its own size. `Reorder.Item` takes `true` or `"position"`. Motion's `animationType`.
_Avoid_: layout type, animation type.

**Projection system**:
`@wardic/dom`'s engine for the **Projection**, one per Environment a binding builds: it holds every **Projection node**, runs the **Measure pass** and the per-frame projection pass, and owns `layoutId` matching. A binding gets it as a service, built by its Layer and ended by its Scope (#132): the `layout` **Feature**'s, so an app with no layout animation builds none (#511).
_Avoid_: projection engine, layout engine.

**Projection node**:
A layout-enabled element's entry in the **projection tree** — a parent link by DOM ancestry, its children, and its retained + target **Box** (`{ x: {min,max}, y: {min,max} }`, the projection-internal geometry that measured `Bounds` convert into). A node with no layout ancestor projects relative to the page, so Projection works with no `<LayoutGroup>`.
_Avoid_: layout member (the prior flat name), FLIP node.

**Measure pass**:
The **Projection system**'s end-of-task unit. Every layout trigger in a task (a node registering, the shared ResizeObserver reporting a size the engine hasn't measured, `layoutDependency` through `notify`) queues one Measure pass. It runs in a microtask at the end of that task. It resets every **Projection node**'s transform, reads every box, and seeds a FLIP for each node that moved. The flush gate then applies the writes it made (`flushPass`), so a new layout never paints without its projection. The nodes it seeded take their first step at the next tick, painted in that Refresh frame (ADR-0033). A pass that knows it runs after its frame's tick, because its trigger came in the Frame loop's **Late window** or in the engine's own observer delivery, takes the first step of the nodes it seeded itself, so they move in that frame too (ADR-0018 *Amendment (#673)*, ADR-0027 *Amendment (#680)*). A running animation whose box didn't change is left alone. A dragged node and its subtree get a slot-only update (**Drag block**). After a window resize, the next pass is a **Resize block**; after a change to the page's size no pass read, a **Page-size refresh**. A trigger during the pass's own flush repeats the pass, at most 5 rounds (ADR-0018). After a **Declared layout change**, a node's "before" is its Measurement taken at the call, not the one from the last pass.
_Avoid_: commit (the Renderer's write), layout update (Motion's name).

**Declared layout change**:
A layout change an app marks itself, by making it inside `animateLayout(fn)`, so it animates even where no trigger sees it, or a node's last Measurement is out of date. Before `fn` runs, every **Projection node** is measured afresh (a **Measure pass** already due in the task runs first, so a change made earlier still animates), and the pass at the end of the task animates every node that moved from those Measurements. Calls in one task share the first call's Measurements. It has **settled** once every layout animation that pass started has ended, however each ended (landed, cut short, or restarted by a later change), or once the pass has run if it started none.
_Avoid_: snapshot (reserved), layout boundary (avoided for a **Layout sub-root**), layout transaction, batch.

**Drag block**:
While a **Projection node** is dragged, it and its subtree are drag-blocked. A **Measure pass** updates their slots but starts no layout animation there, and counts the ones whose box changed in its `dragBlocked` attribute, not as seeded. The dragged node is its subtree's relative parent, so the subtree rides the drag, and then its **Release offset** (ADR-0016, *Amendment (#26)*). A dragged node that opts in (a **Reorder group**'s items do) is also raised above its siblings until its release settles: `z-index: 2` while dragged and `1` while its **Release offset** runs, so the item under the pointer paints above one still flying back (ADR-0016, *Amendment (Reorder)*).
_Avoid_: held (the layout lab's held frames), drag lock (that's a **Drag claim**).

**Shared layout**:
A layout animation between two *distinct* elements that share a `layoutId` — one leaving, one entering — animating the entering element from where the leaver paints, realized on the **Projection** tree (a `layoutId` element is a **Projection node** seeded from its twin). Where it paints counts everything that moves it on screen: its own layout animation mid-flight, its **Release offset**, a drag, its carriers; at rest that is its Measurement. So a handover that interrupts another goes on from where the twin was seen, as Motion's does. The entering element also starts with the leaver's look as drawn — its corner radius and tilt, and in a **Switch** its opacity — and eases into its own over the handover, so the twins read as one object changing shape. Two modes: a **Switch** (the twins never coexist — the leaver has unmounted; the enterer seeds from where the leaver last painted, captured in the **Root frame** at the leaver's removal and held by the **Projection system** until the end of the current task) and a **Crossfade** (the twins coexist). The per-element box geometry stays in core.
_Avoid_: magic motion, shared element (reserve as the informal gloss only).

**Layout group**:
A `<LayoutGroup>` and the elements made under it (#432, Motion's `LayoutGroup`). Given an `id`, it is a namespace for `layoutId`: **Shared layout** twins pair only within it, so two copies of a component that uses a `layoutId` (a tab bar's underline) keep their own. A group inside another joins the outer one's id unless it opts out (`inherit={false}`), and one with no `id` of its own takes the outer one's. A group bounds no **Measure pass**: the whole projection tree re-measures, whatever groups it holds.
_Avoid_: shared layout scope, layout namespace (the `id`'s job, not the group's name).

**Crossfade**:
The **Shared layout** mode where both twins are mounted at once (one app-rendered alongside the other, or one retained mid-exit by `<AnimatePresence>`: its leaving child, or a twin anywhere inside that child, which is handed back to its other twin whatever the child is). They are kept perfectly overlapped — every non-lead twin (a **Follower**) projects onto the **Lead**'s current Box each frame — while opacity cross-fades over the handover: the Lead fades in over its first half, and its Followers fade out over its second, so the overlap is never see-through (Motion's). Each multiplies the twin's own opacity. A handover crossfades even when the twins' Boxes are equal and nothing moves. One that starts while an ancestor is crossfading moves without a fade of its own, so the ancestor's fade decides which twin shows. Only a handover crossfades: a later layout animation of the Lead, or its **Release offset**, moves it without fading (Motion's). A Lead whose `layoutCrossfade` is `false` doesn't: its Followers are hidden as its handover starts, and it moves at its own opacity (#442, Motion's). Contrast **Switch**, where there is no overlap because the leaver is already gone. A Lead that leaves hands over only to a twin that isn't leaving: with none, nothing takes over, and it stays where it's drawn as it leaves (ADR-0010 *Amendment (#682)*, Motion's `relegate`).
_Avoid_: fade transition (opacity-only, no shared box), dissolve.

**Page transition**:
A route change animated by an `<AnimatePresence>` around the router's outlet (#479): the leaving page's root, a Wardic element, runs its `exit` popped out of the flow (`mode="popLayout"`), the new page's runs its entrance in its place, and an element on both pages flies between them by its `layoutId`. A route change gives the new page new nodes, so it needs no `key`; a change of a route's params alone keeps its nodes, and its page keys its content to animate it.
_Avoid_: route animation, view transition (the browser's snapshots, which Wardic doesn't use, #437).

**Lead / Follower**:
Among the Projection nodes sharing one `layoutId`, the **Lead** is the most-recently-mounted live node — the only visible one, projecting to its own Box. Every other node is a **Follower**: locked onto where the Lead is drawn, its Box at the Lead's own scale and with the Lead's corner radius and tilt as they ease, so the two overlap exactly (its own set aside while it follows), and held hidden (a *live* follower at rest) or fading out toward removal (a *leaving* follower, retained mid-exit). A Follower takes no pointer input, so one painted over its Lead never takes the Lead's clicks. The layout nodes a Follower carries stay corrected for its lock, as under any moving ancestor, and a leaving Follower brings them back with it. Mounting promotes a new Lead; the prior Lead is relegated to a Follower.
_Avoid_: active/inactive, primary/secondary.

**Scale correction**:
A **Projection**'s scale counter-scales an element's *geometry* via the transform, but distorts non-geometric CSS — `border-radius`, `box-shadow`. A **Scale corrector** reads the authored value and emits, each frame, a CSS string that — once the transform scales it — renders as the authored value (a px radius becomes `radius / scale`; a percentage is self-correcting and passes through). The corrected value is computed upstream (in the projection, which has the per-frame scale) and written as an ordinary style key, so the Renderer stays pure. A per-CSS-key registry holds the correctors: Wardic's built-in ones, and those an app gives its runtime (its `WardicProvider`'s, #443), which correct the element's own value for a key each frame, or its computed one.
_Avoid_: counter-scale (reserve for the geometric transform), inverse scale.

**Own transform**:
A **Projection node**'s own `x`, `y`, `translate*`, `z`, scales, `rotate` and skews: what its animations and style set, drawn on top of its projection, as Motion draws a layout element's latest values (#363). Its children ride it through CSS, and a twin, a handover or a restart starts from where it's drawn with it.
_Avoid_: own value (that's a key's value before Wardic writes it), projection transform.

**Transform template**:
A function an element gives to build its whole transform itself, from its values and the transform Wardic would draw (Motion's `transformTemplate`). What it returns is the element's transform wherever the element is drawn: at rest, animating, projected by a **FLIP**, held for a **Measure pass**, and on a server. So a static part of it, such as centring, is measured, and stays through a layout animation (#443).
_Avoid_: transform string, custom transform.

**Layout sub-root** (`layoutRoot`):
A **Projection node** marked a stable reference frame for its subtree: it never FLIPs its own layout, bounds the search for a relative parent (its descendants find none above it), and is a **persistent relative anchor** (its descendants always project relative to it). Every ancestor's projection still counts in its descendants' boxes, as CSS composes them. With `layout` or a `layoutId` as well, it isolates its subtree from an ancestor's projection, from then on even if they're taken away: under an ancestor's layout animation it self-snaps to its new box from the first frame, while an ancestor's transforms (a drag, a **Release offset**) still carry it. With `layoutRoot` alone it rides an ancestor's layout animation, as any element does, and is only its subtree's frame. Both as Motion's `layoutRoot` (#691).
_Avoid_: layout boundary (reserve "sub-root"), projection root.

**Relative anchor** (`layoutAnchor`):
The point (0–1 per axis, default top-left) in a relativeParent that a node anchors to when projecting relative to it — the knob that makes relative projection through a *scaling* parent sound (moot for a pure-translate parent). `false` opts the node out of relative projection entirely (forces absolute).
_Avoid_: origin (reserve for the scale transform-origin in the delta math).

**Scroll-stable frame** (`layoutScroll`):
The coordinate frame a **Projection node**'s box is stored in so neither scroll nor a transform leaks into a layout animation. It's the box as laid out, with no transform applied: not the node's own, and not any ancestor's, whoever set it (Wardic, a stylesheet, another library). An ancestor's transform carries the node, as CSS does (#136). To that it adds the scroll offsets of its scroll-container ancestors (the root's scroll always, and that of every scrollable ancestor, one whose overflow isn't `visible` or `clip`; `layoutScroll` marks a container that is itself a projection node, ADR-0012 *Amendment (Reorder)*; with no `layout` or `layoutId` it animates no layout of its own, as Motion's, #691), sampled at measure. Two measures taken at *different* scrolls, or with an ancestor moved by a transform in between, then yield the same box if the layout didn't change, so the delta is layout-only. A `position: fixed` element is a **scroll root** — its subtree is viewport-relative and folds in no outer (or root) scroll. A `position: sticky` element folds too: its offset from its static place comes out, as a scroll does, whether it's stuck or not, so a node under a stuck sidebar doesn't move as the page scrolls (ADR-0012 *Amendment (#578)*). An element becoming or ceasing to be one between measures changes the frame, not where things are: nothing animates unless it moved on screen. Scroll changing *during* a transition is the documented limit (offsets are sampled at measure, not per frame). So is an ancestor whose transform is mid CSS transition when a pass measures: its current offset stays in the box.
_Avoid_: scroll compensation, document frame (reserve "stable" for this specific fold).

**Root frame**:
The coordinate frame **Shared layout** twins are compared in: a box as painted (its ancestors' transforms applied, and a twin's own motion when it's where a handover starts) plus the scroll of the projection tree's root (the page, in a browser), with nested `layoutScroll` container scroll left as rendered — Motion's `measuredBox`. Unlike the **Scroll-stable frame**, it doesn't depend on which containers or transformed ancestors a node sits in, so two twins' boxes are directly comparable. A box in it is converted into a twin's scroll-stable frame through that twin's containers' scroll and its ancestors' transforms: the translate and scale Wardic animates on them followed each frame, any other as of its last pass. That covers a crossfade's origin, a Switch seed at first measure, a Lead's flight, a Follower locked onto its Lead and one promoted when its Lead leaves (#136, #137, #331). It carries the root's scroll inside a **scroll root** too, so a twin in a `position: fixed` view and one in the scrolled page compare directly (ADR-0012, *Amendment (#331)*).
_Avoid_: page frame, document frame (browser words for the same thing).

**Resize block**:
After a change of the window's width, running layout animations finish, and the next **Measure pass** (within 250 ms) updates every node's slot and starts no animation. If none runs, the engine runs one itself at 250 ms, or at a drag's start, so no box from before the resize is left (ADR-0018, *Amendment (#39)*).
_Avoid_: resize freeze, blocked update (Motion's name).

**Page-size refresh**:
When the page's content (the body and its direct children) changes size with no **Measure pass** reading it, every **Projection node** is measured again at once, with the **Resize block**'s slot-only update: nothing starts, and a running animation moves with its box. A node that content elsewhere moved then starts its next layout animation from where it's painted. A move that leaves the page's size unchanged needs a **Declared layout change** (ADR-0018, *Amendment (#261)*).
_Avoid_: re-measure, snapshot (reserved).

**Instant change**:
A change of the app's state that lands rather than animates (Motion's `useInstantTransition`, Wardic's `createInstantTransition`). The next **Measure pass** after it is blocked, as a **Resize block**'s is: every **Projection node** takes its new box and nothing starts, and a running layout animation ends on its slot as the pass begins. Every animation that starts until two frames after it is a **Skipped animation**, so it's still told. One that only blocks the layout (`createInstantLayoutTransition`) leaves the other animations running as ever. It belongs to one runtime (#443).
_Avoid_: instant transition (in Wardic a transition is how a value moves, not a change of state), skipped change.

**Projection reset**:
Ending every layout animation on its node's slot and dropping what came before: every leaving twin and Switch seed goes, and the next **Measure pass** measures every box afresh and moves no node, as an **Instant change**'s (Motion's `useResetProjection`). Live `layoutId` twins stay paired: Motion empties its pairings, which leaves a hidden twin with no Lead. For a change that replaces the page wholesale, or one outside Wardic (#443).
_Avoid_: re-measure, refresh (a **Page-size refresh** keeps every box and pairing).

### Environment

**Environment**:
A complete set of Layer implementations of the core services (Clock, `RefreshFrameSource`, Renderer, Probe, InterpolatorRegistry with the Environment's **Key rules**, PositionalKeys naming its **Positional keys**, DefaultTransition, Announcer), with core's **Frame loop** over its Clock — e.g. DOM, Test. Its InputSource is built apart, when a gesture first needs one, so an app with none has no input code (ADR-0067, decision 14).
_Avoid_: platform, adapter, driver.

**Shared source**:
A contract property of *every* source an Environment hands out, a Stream (`Clock.ticks`, `Probe.observeResize`) or an **Input feed** (pointer, keyboard, focus, intersection; #318): it is hot and ref-counted per target, or per subscriber where each brings its own options (an intersection's root and margin). Subscribers share one underlying source (one rAF loop, one listener-set per element, plus one page-wide set while a pointer that went down on it is held, one observer), established on first subscribe and torn down when the last unsubscribes. A consumer attaching `hover` + `press` + `drag` to one element gets one listener-set, not three. Cold re-running per subscriber is an Environment bug, not a consumer concern. Core's `SharedSource` builds one for any Environment, per target or for the whole Environment. (Resolves the `Clock.ticks` sharing question ADR-0001 flagged: yes, shared.)
The Clock's loop ends at the first Refresh frame after its last subscriber leaves, not at the unsubscribe itself (see **Cold start**).
_Avoid_: hot stream, multicast (name the property — Shared source).

**Input feed**:
A target's input as an Environment gives it (#318): started with a callback, it calls it with each event inside the platform's dispatch, until stopped. A gesture recognizer folds a feed's events as they come, with no Stream between. `InputSource.pointer` and the rest hand out feeds; a consumer that wants a Stream makes one with `InputFeed.toStream` (ADR-0055). A **Shared source**: one per target, however many recognizers fold it.
_Avoid_: listener (the platform's), subscription (a Stream's).

**Held pointer**:
A pointer that went down on a target and hasn't been released. Until its release or cancel, its moves, release and cancel keep reaching that target's pointer **Input feed** wherever they land, so a drag or a press keeps its pointer anywhere on the page. A move with no button pressed ends it, as a lost release, and so does a new press anywhere on the page by it or by a new primary pointer of its kind. A scroll of the page or of a scrollable ancestor while it is held, once it has moved since its down, moves it too: the Environment reports the scroll, and `InputSource.heldPointer` turns it into a move of the held pointer, so a drag stays under the pointer (ADR-0019, *Amendment (Reorder)*). DOM touch holds pointers this way natively; the DOM Environment adds page-wide listeners at the down for the rest. Core's `InputSource.heldPointer` implements it for any Environment (ADR-0019).
_Avoid_: captured pointer, pointer capture (the DOM's `setPointerCapture`, which Wardic doesn't use), pointer session.

**Refresh frame**:
One refresh of an Environment's output: a display vsync in DOM and native, a timer-driven redraw where there is no display. The Clock ticks once per Refresh frame, and the **Flush gate** applies writes once per Refresh frame. Firefox can run a second Refresh frame right after an input with the previous one's timestamp; the Clock times it by elapsed time (ADR-0017, amended). An Environment supplies them through its `RefreshFrameSource` (`requestFrame` / `cancelFrame`), one of its members: core builds the Clock from it (ADR-0017), and the gate requests from it the flush of a write made outside the Frame loop's tick (ADR-0031, ADR-0033). Not a **Frame**: that is a Primitive's per-tick emission.
_Avoid_: animation frame (browser API wording), display frame, vsync.

**Cold start**:
A subscription to `Clock.ticks` made while the Clock is idle, so it starts requesting Refresh frames. Its first tick is the next Refresh frame's, with the nominal dt (1/60 s), since there is no earlier Refresh frame to measure against. A **warm start** joins a Clock that is already ticking and gets its next tick, with a measured dt. Either way an animation's first step is painted in the Refresh frame that computed it (ADR-0017, ADR-0033). The Clock goes idle only at the first Refresh frame that finds no subscriber, so an unsubscribe followed by a subscribe before the next Refresh frame (a retarget) is a warm start (ADR-0017).
_Avoid_: wake (Motion's term).

### Rendering

**Project**:
The pure half of the Renderer — translating engine values into the environment's representation (e.g. grouping `x`/`y`/`scale` into one DOM `transform` string), with no side effect.
_Avoid_: render, format, serialize.

**Identity** (a transform key's):
The value at which a transform key leaves the element untransformed: 1 for `scale`, `scaleX` and `scaleY`, 0 for the rest. An element whose transform keys are all at their identity is projected with no transform (ADR-0023).
_Avoid_: default (Motion's `defaultTransformValue`), zero, rest value.

**Commit**:
The imperative half of the Renderer — writing a projected patch onto a target.
_Avoid_: apply, flush, paint.

**Flush gate**:
The accumulator every binding writes an element's values into. It merges each element's writes by key and commits them onto each element once per Refresh frame, all in one flush (ADR-0006, ADR-0034): at the end of the **Frame loop**'s tick, in the Refresh frame that computed them, or, for a write made outside a tick (a drag's move, a release), at the next Refresh frame (ADR-0033). A **Measure pass**'s own writes are applied at the end of its task (ADR-0018). A server render gets one that does nothing (ADR-0021).
_Avoid_: batcher, scheduler (Effect's), coordinator (the **Frame loop**'s old name).

**Imperative path**:
How a Frame stream renders outside a binding (canvas, native, tests): pushed through Project→Commit by the `applyTo` combinator, one Commit per Frame, with no **Flush gate**. A binding's elements, `wardic.*`, `createWard` and `use:wardic` alike, are committed by the gate (#79).
_Avoid_: manual path; reactive path (gone with #79: no Frame reaches an element through JSX).

**Starting style**:
An element's style before its first Frame: `project(resolveInitial(config))`, computed purely with no runtime (ADR-0003). A **Variant child** with no `initial` of its own resolves its ancestor's `initial` name (#50). With `initial={false}` it is the element's `animate`, resolved once (a **Variant child** with no `animate` of its own: its ancestor's `animate` name), so the element starts at its target and nothing animates at mount (#134, Motion's). It is the server's markup, the style the hydration render keeps, and the animation's `from`. A binding's element receives it through `style` until its first frame is committed (ADR-0021, #79).
_Avoid_: initial style (`initial` is its input, not its projected result), SSR seed.

**Hydration hold**:
From a server render until the element mounts, a client hydrating that markup renders exactly what the server rendered: the Starting style, and a client-only hook's server value (`false` for `createHover`, `createReducedMotion`, …). At mount it switches to its client values and the engine starts. A client-only render has no hold (ADR-0021). An **Appear animation** plays through the hold, and the **Handoff** ends it (ADR-0044).
_Avoid_: deferred hydration, two-pass render.

**Appear animation**:
An element's mount animation, or a **Batch member**'s entrance, as a server render starts it: the server samples it from Wardic's own machines into a CSS `@keyframes` rule in the page's head, and the element plays it from first paint, before any script runs (with none, to its end). An element qualifies whole, when the server knows its whole mount animation: static `initial` and `animate`, every key starting from `initial`. One that doesn't keeps its **Starting style** until mount. A **Batch** asks for one (`appear: true`); its members on one set of transitions share a rule, each one's own values read from its element. At mount the engine takes it over, the **Handoff** (#48, #706, ADR-0044; Motion's "optimised appear").
_Avoid_: optimised appear, pre-hydration animation, server animation.

**Handoff**:
The engine taking over an **Appear animation** at mount: the element's run starts as far in as the CSS has got, read in the frame that draws its first Frame, and that frame's commit removes the CSS animation, with no paint between (ADR-0044). A **Batch**'s first change starts each member so, at its first step (#706). Motion's word for the same step.

**Late chunk**:
Server markup a streamed render sends after its shell: a `Suspense` boundary's content, once its data has resolved. A **Late chunk** brings its own **Appear animation** rules, which the client moves into the page's head before it hydrates the chunk, and its animations start when it lands, not at the page's first paint (#245, ADR-0044 *Amendment (#245)*).
_Avoid_: resume, takeover, sync.

**Live value**:
A value the user moves themselves, given in `style`. It's the key's `style` link (**Base value**): the element follows it on every change while no entry of the **Override stack** sets the key, and an entry that lets go returns the key to where the Live value is then.
_Avoid_: motion value (Motion's name, for a value the engine writes into), signal, atom (its forms).

**Follow value**:
A **Live value** that animates on a transition toward its source's latest value, from wherever it is when the source changes (Motion's `useFollowValue`, Wardic's `createFollowValue`). A spring one is `createSpring`'s.
_Avoid_: follower (a **Shared layout** twin that isn't the **Lead**), spring value (one kind of it).

**Timeline value**:
A **Live value** derived from a container's scroll by ranges alone, which the DOM gives to a native scroll timeline, so the browser draws it with the scroll and the **Flush gate** doesn't. It runs there only while it's what its key shows: an entry of the **Override stack** that sets the key takes it back to the gate, and the key returns to the timeline when the entry lets go. Where the browser has no scroll timeline, the gate draws it as any Live value (#240).
_Avoid_: accelerated value (Motion's), handoff (the **Appear animation**'s), compositor value (a key the browser can't composite still runs on the main thread).

**Base value**:
The value a key returns to when no entry of the Override stack (`animate`, an inherited variant, the gestures) sets it any more. In order: the key's `initial` value, its value in the element's `style`, then its **Own value** (ADR-0022). With `initial={false}`, a key the element started at from `animate`: its `style` value, then the value it started at (#134, Motion's `baseTarget`). A key with no value yet starts from the same links (`initial` already seeds the Snapshot). A key at rest at its `style` value follows a later `style` change. While any entry of the Override stack sets a key, the element shows Wardic's value whatever its `style` says: `style` is the key's fallback, never an override (#79).
_Avoid_: default (a transform key's Identity, which is one kind of Own value), fallback.

**Own value**:
An element's value for a key before Wardic writes it. For a transform key it's the key's **Identity**, pure and in core. For any other key, the element's Environment reads it from the element (in the DOM, the computed style or an SVG attribute), once, when the key first needs it, on the client after mount. It's never read on a server (ADR-0021).
_Avoid_: computed value (a DOM term), initial value (`initial` is a prop).

### Binding

**Subject**:
What an Environment draws and a **Ward** binds: in the DOM an element, in a scene an object (a mesh, a camera, a material, a uniforms object). An Environment decides what its Subjects are. Motion's word for what `animate(subject, …)` takes. A **Batch** drives many at once.
_Avoid_: target (an animation's target values), element (the DOM's kind of Subject), node.

**Scene object**:
A **Subject** a scene holds for its owner: it joins its parent when it enters, and it leaves only once its exit has landed, so its exit plays in the scene. What happens to its resources when it leaves is its owner's choice. Its motion is set on it, as a **Wardic element**'s is: it's the scene's Wardic element, though it doesn't make its object. Its parent is the nearest Scene object above it, else the scene. An object that already has a parent, such as a node of a loaded model, stays where it is. Variants pass down nested Scene objects as they do down Wardic elements.
_Avoid_: entity, presence child (the DOM's), node.

**Presence child**:
An element among an `<AnimatePresence>`'s children, whatever made it (a `<Show>`'s branch, a `<For>`'s item, a Batch member's element) and whatever its kind: HTML, SVG or MathML (#702). Text is never one. One that drops out of the children is a *leaver*: with an exit to play, its own or one inside it, it stays on the page until they have landed.
_Avoid_: presence item, exiting node.

**Host loop**:
The loop a scene's host runs, one pass a **Refresh frame**: it steps Wardic, then renders. A scene Environment's Refresh frames are the host loop's, wherever they come from (the display, an XR session, a game loop), so Wardic's writes land in the frame that draws them.
_Avoid_: render loop (the renderer's call alone), animation loop, rAF.

**Ward**:
One Subject's motion binding: its config, its Recognizers, its Override stack, its Legs and its Snapshot, however a binding attaches it. Solid's binding has three ways to put one on an element: a `wardic.*` component, `createWard`'s spread, and the `use:wardic` directive. Solid 2's has two: a `wardic.*` component, and `ward(config)`, a ref carrying its props, spread when it's kept or given to `ref`. A ward made with `ward(config)` can also be given to any Wardic component, `Reorder.Item` too, through its `wardRef`: the component then drives its element with that ward, the element's own motion props laid over its config (#349, #398). Foldkit's binding has two: a `w.*` element from `wardic.html(h)`, and the `Ward.attributes(config)` bundle on any other element (ADR-0071).
_Avoid_: motion component (Motion's), controller, spine (the code that runs it).

**Delivery**:
One render's config reaching a **Wardic element**, in a binding whose host has no reactive graph (Foldkit, ADR-0071): a property setter called inside the patch, once per fresh value, a parent's before its children's. The ward Retargets only when the delivered targets resolve differently from the last ones (#470). Its watches re-read once per patch, after the provider's delivery, which comes first in every patch.
_Avoid_: update (Foldkit's `update`), prop write, re-render.

**Listening ward**:
A **Ward** given to a Wardic component's `wardRef` whose config carries no variants (sets neither `variants` nor `inherit`): the element's own props set its motion and its place in the variant tree, and the ward is what its gestures, landings and values are heard through. `ward()`, with no config, is one. A ward whose config sets `variants` or `inherit` **carries its variants**: its variant node is made where the ward is made, and the keys that node reads stay in its config (#398).
_Avoid_: empty ward, headless ward, event ward.

**Wardic element**:
An element with a **Ward** on it.
_Avoid_: motion element, animated element.

**Feature**:
A part of the binding an element pays for only when it needs it (#511): a gesture each (`hover`, `press`, `focus`, `inView`, `pan`, `drag`), `layout` (layout, `layoutId`, projection), `colors` (every CSS colour space beyond hex, `rgb()`, `hsl()` and colour names, which the base reads), and `scroll` (a container's scroll, read by the scroll hooks alone, #518). Motion's presets name two sets of them: `domAnimation` (the hover, press, focus and in-view gestures) and `domMax` (every Feature an element's props use). A component or hook that needs a Feature brings it for itself: `Reorder`'s items bring `drag`, `layout` and the gestures, `LayoutGroup` brings `layout` for its own `layoutDependency`, not for the elements under it, and `createScroll` brings `scroll`. A **Slim element** has the Features chosen above it, by its `WardicProvider` and any `LazyWardic` between them, together; a **Complete element** has every one.
_Avoid_: plugin, addon, module.

**Slim element**:
A **Wardic element** put on by one of `w`'s forms (#511; Motion's `m`): `w.*`, `w.create()`, and the ward forms, `w.createWard()` and `use:w` on Solid 1, `w.ward()` on Solid 2, and every Foldkit `w.*` element, with the Features its `Wardic.make` handle was given (ADR-0071). Its own code animates values (`animate`, `initial`, `exit`, variants, transitions), with the **Features** chosen above it (its `WardicProvider`'s and every `LazyWardic`'s between). A prop of a Feature it doesn't have does nothing.
_Avoid_: m component, lite element.

**Complete element**:
A **Wardic element** put on by any form but `w`'s (`wardic.*`, `wardic.create()`, `createWard`, `use:wardic`, `ward()`; Motion's `motion`): it has every **Feature** built in. An app with one ships every Feature's code.
_Avoid_: full element, motion component.

## Relationships

- A **Primitive** produces **Frames**; a **Physics primitive** produces **Physics frames**.
- Every Primitive the binding starts runs on the **Frame loop** (from #74); a Primitive's Stream runs it on its own.
- A **Retarget** seeds a new Primitive from a cached **Snapshot**.
- A **Definite primitive** applies an **Easing**; the multi-value path blends each key through an **Interpolator**.
- An **Environment** provides the services a Primitive depends on (every Primitive needs a **Clock**).
- A **Ward** runs one **Subject**'s keys; a **Batch** runs many Subjects' (or a mesh's instances') keys as one run, and hands a key to whichever driver took it last.
- Target change has three regimes: a *static* target → `spring`; an *occasional/discrete* change → `spring` + **Retarget**; a *continuous* change → **Chase**.
- A **Chase** never **Settle**s on its own; it ends only when cancelled. Every other Primitive Settles and completes.
- A **Recognizer** consumes an **Environment**'s input/geometry and emits an interaction signal — a **State recognizer** a boolean, a **Sample recognizer** Drag samples. A Recognizer is *not* a Primitive: event-driven, no **Settle**.
- A **Fling** composes the `drag` Sample recognizer with an `inertia` Primitive, in the binding.
- Stacked gesture states resolve through an **Override stack** to the target that feeds the multi-value Primitives (`springValues`/`animateValues`).
- **FLIP** animates from a prior **Measurement** to the current one; a **Measurement** is geometry and a **Snapshot** is a cached value — never interchanged.
- A key that leaves the target animates to its **Base value**, whose last link is the element's **Own value**.

## Example dialogue

> **Dev:** "When the user flicks the card and lets go, the drag hands off to motion — is that a Retarget?"
> **Engine:** "It's a fresh `inertia` Primitive seeded from the drag's release velocity, on the Drag transition. Because inertia is a Physics primitive, the Snapshot carries velocity, so there's no visible kink."
> **Dev:** "And if they grab it again mid-fling?"
> **Engine:** "Retarget again — cancel the inertia, read its last Physics frame, seed the next motion from that value and velocity."

## Flagged ambiguities

- **"Atom" as the core's animation output** — the plan/README describe primitives that "return an Atom." Resolved: core **Primitives emit Streams of Frames**. `Atom` (Effect's `effect/reactivity`) appears only on service *inputs* (`Probe.viewport`, `Probe.prefersReducedMotion`; the Clock's `time` and `dt` Atoms went with #109, ADR-0030) and as a *binding-layer* output. Reactivity is an Environment/binding concern, not part of the core value contract.
- **"velocity" on every frame** — Resolved: velocity is **optional and physics-only**. A Frame is `{ value, done }`; a Physics frame adds `velocity`. Definite primitives never carry it.
- **"easing" vs "interpolator"** — distinct: Easing reshapes *time*; an Interpolator blends *values by type*. Not interchangeable.
- **A colour's midpoint differs by Environment** — Resolved (ADR-0069): the DOM blends colours in sRGB, as CSS and WAAPI do (ADR-0024); a scene blends them in linear light, as three's own `Color.lerp` and animation clips do. Red to blue passes `#800080` on a div and `#bc00bc` on a mesh. Motion's gamma-2 mix (`#b400b4`) is neither.
- **"color string"** (what the DOM's color Interpolator decodes; core has none) — Resolved: a string is a color iff culori's `parse` accepts it, trimmed. CSS keywords like `"auto"`, `"none"`, `"inherit"` are **not** colors, and neither is a string culori rejects (`"#zzz"`, `"rgb(var(--x))"`) or throws on (`"blur(4px)"`, #154): paired with a color, they make a **Discrete pair**.
- **Reduced-motion policy ownership** — Resolved (#98, ADR-0029, replacing an earlier resolution that nothing applied): core's `ReducedMotion` holds the DOM-free policy (`Config`, `applies`, `split`, `endOf`, `snap`), and the bindings apply it when each run starts. It's on by default (the provider's `reducedMotion`, `"user"`; a `WardicConfig`'s sets it for the elements below it, #434, as Motion's `MotionConfig`), and reaches the spine's legs, presence's exit and layout animations, never drag's release. Only Positional keys Snap; the rest animate. A transition opts out with `respectReducedMotion: false`.
