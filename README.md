# Wardic

> A reactive, services-based animation engine for the modern web.

Wardic is a fine-grained reactive animation engine built on [Effect v4](https://effect.website) (using its in-core reactivity at `effect/reactivity`). It treats environments as Layer-provided services rather than parallel packages, which means the same animation code can run in browsers, headless test runners, or any future environment that has a corresponding Layer. The result is a library that's architecturally cleaner, more observable, and more portable than typical animation libraries — without asking users to know Effect.

> [!WARNING]
> Wardic is **pre-alpha** and not yet usable. v0.1 will ship with Solid bindings only; React, Vue, web components, React Native, and Canvas are roadmap items. APIs will change. Watch the repo for the first preview release.

---

## What makes it different

**Environments are services, not parallel packages.** The engine declares its dependencies (Clock, Renderer, InputSource, Probe, InterpolatorRegistry) as Effect services. Environment packages provide Layer implementations. Adding a new environment is writing a Layer, not reimplementing the engine. The same animation code works everywhere a Layer exists.

**SSR-correct by default.** `createWard` computes initial styles synchronously during render and applies them via spread props. Server-rendered HTML arrives at the client already in the correct initial state. No flash of unanimated content, no hydration mismatch. And a mount animation doesn't wait for your JavaScript: the server samples it from Wardic's own springs and tweens into CSS, it plays from first paint (to its end with JS off), and the client takes it over at hydration, mid-flight, velocity included (*Appear animations*, ADR-0044).

**Variant orchestration as a first-class feature.** Declarative named animation states propagate through the component tree, from every Wardic element to its children. Children inherit the current variant from their parent, with automatic stagger support and configurable ordering. Familiar pattern from Framer Motion, but built on a reactive foundation that scales cleanly to complex trees.

**Built-in observability.** Every animation primitive wraps in `Effect.withSpan`. Hook up OpenTelemetry once at app entry and get hierarchical traces of every animation in your application — performance attribution, causality across the app, replay-from-trace capabilities. Production observability of animation behavior without custom instrumentation.

**Effect is invisible to users.** The Solid bindings expose `createWard`, `wardic.create()`, and idiomatic `createX` primitives. The Effect machinery underneath is doing structural work — resource scoping, cancellation, dependency injection — that users don't have to think about. Power users who do know Effect can drop down and provide custom Layers for advanced cases.

---

## Quick look

To see it in a real app first: [`examples/storefront`](examples/storefront) is a made-up ceramics shop whose every feature is an example, with the demo, why it's worth reaching for, and the code, built once on Solid 1 and once on Solid 2 (#296).

### Setup

```tsx
import { render } from "solid-js/web"
import { WardicProvider } from "@wardic/solid"
import { DomLive } from "@wardic/dom"
import App from "./App"

render(
  () => (
    <WardicProvider env={DomLive}>
      <App />
    </WardicProvider>
  ),
  document.getElementById("root")!,
)
```

### Observability in development

`env` takes any Layer that provides Wardic's services, so an app configures observability with Effect's own layers, merged beside `DomLive`. Wardic ships no logger, level or reporter: Effect's defaults are production's, so Wardic's Debug logs are filtered and its warnings and errors reach the console.

```tsx
import * as FrameLoop from "@wardic/core/FrameLoop"
import { DomLive } from "@wardic/dom"
import { WardicProvider } from "@wardic/solid"
import { DevTools } from "effect/devtools"
import * as ErrorReporter from "effect/ErrorReporter"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as References from "effect/References"

// Forward each failure to your error tracker.
const reporter = ErrorReporter.make(({ error, severity, attributes }) => errorTracker.capture(error, { severity, attributes }))

const env = Layer.mergeAll(
  DomLive,
  Logger.layer([Logger.consolePrettyBrowser()]),
  Layer.succeed(References.MinimumLogLevel, "Debug"),
  ErrorReporter.layer([reporter]),
  DevTools.layer(),
  Layer.succeed(FrameLoop.CheckFrames, true),
)

render(() => <WardicProvider env={env}><App /></WardicProvider>, document.getElementById("root")!)
```

- **The logger and the level** show Wardic's Debug logs (each animation's start, the projection's passes), pretty-printed with their annotations.
- **Your reporters** receive each failure where it stops: a failed animation (`wardic.spine: a leg failed`), a presence exit, drag's track, the hover, press and focus signals, a `useWardicFiber` fiber, and the projection's passes and coordinator. Each is logged at Error too. An interruption, such as a Retarget or an unmount, is neither. A reporter built with `ErrorReporter.make` reports a failure once, even when it crosses two of these boundaries.
- **`DevTools.layer()`** streams every animation's span and the Frame loop's metrics to the Effect devtools (`ws://localhost:34437` by default).
- **`FrameLoop.CheckFrames`** fails an animation whose step produces a NaN or an Infinity, naming the key and the value, instead of writing `NaNpx`, which the browser drops without a word. It checks every Frame, so it's for development.

`effect/ErrorReporter` and `effect/devtools` are marked unstable in Effect 4.0.2.

### Basic animation with `createWard`

```tsx
import { createWard } from "@wardic/solid"

function Hero() {
  const ward = createWard({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease: "easeOut" },
  })

  return <div {...ward()}>Hero content</div>
}
```

`createWard` makes a **ward**, one element's motion binding, and `ward()` returns a spread containing `ref`, `style`, and any event handlers needed for the animation. The initial styles are serialized into server-rendered HTML, so no flash on hydration. From the first frame on, Wardic writes each frame straight onto the element through `ref`, without re-running your component's JSX, and `style` carries only yours: a key Wardic animates is Wardic's while it drives it, and your `style` is the value it falls back to.

### The `wardic.create()` HOC for declarative usage

```tsx
import { wardic, springs } from "@wardic/solid"

const Card = wardic.create("div")

function App() {
  return (
    <Card
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", ...springs.gentle }}
    >
      Card content
    </Card>
  )
}
```

`wardic.create()` works for HTML element strings or any Solid component that forwards refs. A component that renders nothing yet, as a component library's part does while it isn't shown (Kobalte's `Tabs.Content`), is waited on, and its element enters from `initial` when it comes, and again each time it comes back.

On an element you don't render through Wardic, the `use:wardic` directive puts a ward on it, client-only (no Starting style on a server render). Import `wardic` for it to resolve:

```tsx
import { wardic } from "@wardic/solid"

<button use:wardic={{ whileHover: { scale: 1.05 }, whileTap: { scale: 0.95 } }}>Press</button>
```

### Coming from Motion

Wardic keeps Motion's names for everything Motion has:
- the props: `initial`, `animate`, `exit`, `variants`, `transition`, the `while*` props, `layout`, `layoutId` and the other layout props, `drag` and its options;
- the components: `<AnimatePresence>`, `<LayoutGroup>`, `<Reorder.Group>` and `<Reorder.Item>`.

What differs is what Wardic names itself: one element's motion binding is a **ward**, and an element with one is a **Wardic element** (ADR-0042).

Transitions follow Motion's rules (ADR-0051):
- **No transition**: each value runs on Motion's default for it. `x`, `y` and `rotate` get a 500 / 25 spring, a `scale` a stiffer one (critically damped toward 0), and everything else, opacity and colours among them, a 0.3 s ease. A transition with only `delay` or the orchestration (`staggerChildren`, `when`…) counts as none.
- **No `type`**: a tween's fields make a tween, so `{ duration: 0.5 }` is a 0.5 s tween. One difference: a spring field (`stiffness`, `damping`, `mass`, `velocity`, `restDelta`, `restSpeed`, `bounce`, `visualDuration`) makes a spring, where Motion would quietly tween `{ stiffness: 300 }`. So `{ duration: 0.5, bounce: 0.2 }` is a spring.
- **Missing fields are Motion's**: `{ type: "spring" }` is 100 / 10 / 1 and bounces, and a tween with no easing eases out.
- **`repeat` with no `type`** makes a tween, since Wardic's springs don't repeat. Motion would repeat a transform's default spring.
- **`ease` is Motion's** (#360): one of Motion's names (`"easeOut"`, `"backIn"`, `"anticipate"`…), a cubic bézier's four numbers (`[0.25, 0.1, 0.35, 1]`), or a function. The functions are exported by Motion's names too (`import { easeOut, cubicBezier, steps } from "@wardic/solid"`). The Penner set (`easeOutCubic`…) and `Easing.spring` are in `@wardic/core/Easing`. `createTransform` takes `ease` as Motion's `useTransform` does: one for every stretch, or one each. Wardic's old `easing` is an error, naming `ease`.
- **Springs set by time are Motion's** (#359, ADR-0053):
  - `{ type: "spring", duration: 0.5, bounce: 0.25 }` is solved to the spring that settles in 0.5 s, and it lands on its target at 0.5 s. `bounce` defaults to 0.3, and a `bounce` alone is a 0.8 s spring.
  - `{ visualDuration: 0.5, bounce: 0.25 }` does most of its move in 0.5 s, then settles at rest. `bounce` defaults to 0 here.
  - A `stiffness`, `damping` or `mass` beside them wins, as in Motion, and Motion's fill the rest.
  - Two differences: a `visualDuration` alone is honoured, with no bounce, where Motion ignores it; and a `visualDuration` spring keeps the velocity it's handed (a fling, an interrupted animation), where Motion drops it. A `duration` spring starts from rest, as Motion's does, so it lands on time.

Each Environment picks its own defaults: `DomLive` has Motion's, and the Test Environment runs every key on one 170 / 26 spring.

One timing difference: a main-thread stall longer than 0.5 s (a hidden tab, a debugger pause) advances an animation 0.5 s, and it plays out the rest when frames resume, where Motion's jumps to where the elapsed time puts it. A shorter stall lands a tween, a spring or a layout animation where Motion's lands (ADR-0017, *Amendment (#23)*).

An animation that changes some keys leaves the others running, as Motion's does. A hover that turns on mid-entrance animates its own keys, and the entrance's go on, their tween's timing unchanged. A key whose `transition` changed but not its target goes on with its old one, until its next change. One difference: an animation lands once every key it sets has landed, the ones it left running included (#325, ADR-0005). So that hover's `onAnimationComplete` (on Solid 2, `settled()`) comes once the entrance has landed too, where Motion's comes as the hover's own keys land.

Layout animations leave out the scroll of every scrolling element around them, with no `layoutScroll`, and inside a `position: fixed` element they leave out the page's scroll, with no `layoutRoot`. A `layoutId` pair across those meets where each one paints: a card in a scrolled page opening into a fixed detail view, or a twin inside a scrolled list and one outside it (ADR-0012, *Amendment (#331)*).

A `layoutId` twin that mounts while its other twin is still leaving under `<AnimatePresence>` flies from it, as Motion's does: the leaving one rides along, fading from where its exit had it, and goes once the handover ends. On Solid 2, an update that waits on data elsewhere (a count in a `<Loading>` that the same action refetches) keeps the page as it was until it lands; a twin registering then still flies from the one it replaces (ADR-0010, *Amendment (#402)*).

| Motion | Wardic |
|---|---|
| `motion.div` | `wardic.div` |
| `motion.create(Component)` | `wardic.create(Component)` |
| solid-motionone's `<Motion.div>` | `wardic.div` |
| solid-motionone's `createMotion(el, options)` | `createWard(options)`, spread onto the element: `<div {...ward()}>` |
| solid-motionone's `use:motion` | `use:wardic` |
| solid-motionone's `<Presence>` | `<AnimatePresence>` |
| `useMotionValue(0)` | a signal (or an `effect/reactivity` Atom), given in `style` |
| `useTransform(value, input, output)` | `createTransform(value, input, output)` |
| `useSpring(value, options)`, `.jump(v)`, `skipInitialAnimation` | `createSpring(value, options)`, the same `jump(v)` and option |
| `useScroll({ container, target, offset })` | `createScroll({ container, target, offset })` |
| `useVelocity(value)` | `createVelocity(value)` |
| `useTime()` | `createTime()` |
| `onUpdate={(latest) => …}` | `onUpdate={(latest) => …}` |
| `onAnimationStart={(definition) => …}`, `onAnimationComplete={(definition) => …}` | the same, with the variant name or the target values (ADR-0046); not on Solid 2 |
| `<AnimatePresence>` around many keyed children | around many children, each its DOM node: a `<For>`'s items, a `<Show>`'s child; each that leaves exits in its place, and a `layout` sibling slides into its space once it's gone; one back mid-exit is a new node entering beside it, unless it has a `key` (ADR-0048) |
| `<motion.li key={t.id}>` back mid-exit | the same with `<wardic.li key={t.id}>` (or `use:wardic={{ key }}`), on the presence's child: the leaver goes at once, and the new node starts where it was drawn, values and velocity, the Wardic elements inside paired in document order; no `onExitComplete` for it, and `mode="wait"` doesn't hold it. Coming back elsewhere in a list, a `layout` one glides there from where the leaver was; a keyed `layoutId` twin back mid-crossfade fades on from where it had got to, as Motion's same element does (#286, ADR-0048) |
| `variants={{ visible: (i) => ({ opacity: 1, transition: { delay: i * 0.1 } }) }}`, `custom={i}` | the same: a variant may be a function of `custom` (and the element's values and velocities now), and any target may carry its own `transition`, `inherit: true` laying it over the element's (ADR-0048) |
| `transition={{ default: {…}, opacity: { duration: 0.2 }, layout: {…} }}` | the same: a value's own transition under its name, `default` for every value without one, `layout` for layout animations, in every transition (the element's, a variant's, a gesture target's, an exit's); `inherit: true` lays one over the transition's own fields. A key with no transition of its own runs on its value's default, as in Motion (ADR-0051). Each transition completes its entries from the keys it drives, and rejects an entry for any other: the element's takes the keys its targets set (a key only `style` sets never runs on a transition), a target's own its target's keys on Solid 2's `ward(config)`, the element's on `wardic.*` and Solid 1's `createWard` (ADR-0049). A target given by an overloaded call (Effect's `Bool.match`) tells TypeScript none of its keys: type its result (`as WardicVariant`) |
| `exit="exit"`, `<AnimatePresence custom={direction}>` | the same: `exit` takes a variant name, and a leaving child's dynamic exit resolves with the presence's `custom`. An exit runs on its own transition, else the element's (ADR-0048) |
| `exit` on elements inside a leaving child; `exit` variants with `staggerChildren` / `when` | the same: every Wardic element inside the leaving child runs its own `exit`, a Variant child on its parent's exit name in the parent's exit orchestration, and the child goes once all have ended (ADR-0048, #290) |
| `<AnimatePresence propagate>` | the same: a nested presence's children exit when its parent presence's child leaves, which goes once they're gone; without it, they go with that child as they are (ADR-0048) |
| `usePresence()`, `useIsPresent()`, `usePresenceData()` | the same names: `usePresence(() => el, (safeToRemove, custom) => …)` is called as the child leaves (its own code is disposed by then), which stays until `safeToRemove()`; on Solid 2, `const p = usePresence(); <div ref={p}>`, `await p.next("leave")`, `p.safeToRemove()`. `useIsPresent` is `false` from the leave, for handlers on the retained node (ADR-0048) |
| `<AnimatePresence mode="popLayout">` | the same: the leaver is popped out of the flow where it was (`position: absolute`, its size kept) while it exits, and the children after it take its space at once, a `layout` one sliding there. It's pinned with inline styles, so there's no `root` prop (ADR-0048) |
| `<AnimatePresence mode="wait">` | the same: the entering child goes on the page once every leaver has animated out and been removed. Solid builds it at once, so its own code (`onMount` included) runs then, off the page; its Wardic elements start once it's on the page (ADR-0048) |
| `<Reorder.Group values onReorder>`, saving the order in each item's `onDragEnd` | `onReorderEnd={({ values, value, from, to }) => save(values)}`, once at the end of a user's reorder that changed the order: a drag released, or a keyboard lift dropped, not each crossover as `onReorder`, nor a keyboard cancel. On Solid 2, `createEffect(list.when("reorderEnd"), …)`, the group made with `reorderGroup()` and given to `<Reorder.Group groupRef={list}>` (ADR-0020, *Amendment (#257 item 3)*; #349, #355) |
| `<AnimatePresence onExitComplete={() => …}>` | the same, once every exiting child has animated out and been removed (ADR-0046); on Solid 2, a `createPresence()` handle |
| `onHoverStart`, `onHoverEnd`, `onTapStart`, `onTap`, `onTapCancel`, `onDragStart`, `onDrag`, `onDragEnd`: `(event, info) => …`; `onDragTransitionEnd={() => …}` | the same, called at the event (so `event.stopPropagation()` works), with `info.point` in the viewport, not the page (ADR-0047); on `wardic.*`, `onDrag*` are these, not the DOM's drag and drop; on Solid 2, `next(name)` |
| `dragConstraints={{ left, right, top, bottom }}`, `dragConstraints={ref}`, `onMeasureDragConstraints` | the same box; a container as an accessor, a signal ref (`dragConstraints={frame}`) or `() => frame`, measured at each drag's start and when either resizes, keeping the element's place (ADR-0047) |
| `dragDirectionLock`, `onDirectionLock={(axis) => …}` | the same lock (10 px, y first), but the drag starts at its lock, claiming only that axis: `onDragStart` and `whileDrag` come at the lock, after `onDirectionLock`, and a card that drags sideways in a sheet that drags down (`drag="x"` and `drag="y"`, both locked) doesn't start on a vertical swipe (ADR-0047); on Solid 2, `next("directionLock")` |
| `<LayoutGroup id="tabs">`, `inherit` (`true`, `"id"`, `false`) | the same: the `layoutId`s made under it pair as `tabs-underline`, so two copies of a tab bar keep their own underline; nested groups join (`outer-inner`), a group with no `id` takes the outer one's, and `inherit={false}` starts its own. `"id"` is `true` here: every Measure pass reads the whole tree, so there's no re-measure group to join. A ward is in the group it's made in, as with its presence: one made in a component body and spread inside that component's `<LayoutGroup>` is outside it (#432) |
| `const controls = useDragControls()`, `onPointerDown={(e) => controls.start(e, { snapToCursor, distanceThreshold })}`, `dragControls={controls}`, `dragListener={false}`, `controls.stop()`, `controls.cancel()` | `const controls = createDragControls()`, made outside, given to a `wardic.*` element, a ward's config or a `Reorder.Item`; the same `start`, `stop` and `cancel`, on both bindings. A drag it starts takes its Drag claim as any drag does, so of two given the controls on one axis the first drags, unless the other has `dragPropagation` (Motion's drag lock). `snapToCursor` measures the element's box, so a layout node snaps too, back on its slot if no drag follows. `dragListener={false}` drops the drag defaults, so a list dragged by its handles scrolls by touch: give the handle `touch-action: none` (ADR-0060) |
| `whileHover="hover"` (and `whileTap`, `whileDrag`, `whileFocus`, `whileInView`): a variant name | the same: the element's own entry while the gesture is on, and its Variant children's, staggered by that variant's transition; a child's gesture is on while its parent's is (ADR-0007, *Amendment (#291)*) |
| `animate={["visible", "active"]}` (and `initial`, `exit`, the `while*` props): a list of names | the same: merged in order, each key on the own transition of the last name that sets it; each name orchestrates its Variant children's keys; each name's `when` holds the children's keys of that name, the others running alongside; Solid 1's callbacks are told each name, Solid 2's landing the list (ADR-0007, *Amendment (#297)*) |
| `whileInView`, `viewport={{ once, margin, amount, root }}`, `onViewportEnter`, `onViewportLeave` | the same, the entry to each callback; `root` an accessor of an element (ADR-0047); on Solid 2, `next("viewportEnter" \| "viewportLeave")` |
| `whileFocus` | the same: a keyboard's focus (`:focus-visible`), not a pointer's click |
| `animate={{ opacity: 0, transitionEnd: { display: "none" } }}` | the same: values set at once once the target's own keys land, its keys the target's (a higher gesture's win; they return to their base when it's off); a target interrupted first never sets them; the target rendered first sets its own at once, so a server renders a closed panel hidden; a landing (`settled()`, `onAnimationComplete`) comes once they're set (ADR-0057) |
| `animate={{ scale: [1, 1.2, 1] }}`, `x: [null, 100, 0]`, `transition={{ times: [0, 0.3, 1], ease: ["easeOut", "easeIn"] }}` | the same, on every target (`initial` renders its first stop, `initial={false}` `animate`'s last): a first `null` is where the key is, a later one the stop before; more than two stops run on a tween, Motion's 0.8 s one with no transition defined, and a spring given more is Motion's error, reported, the key landing on its last stop. Equal stops a re-render makes run on; a hover over them ending, or a new variant name, plays them again from their first stop, so a repeating pulse resumes. A server plays them too (ADR-0058) |
| `animate={{ height: open ? "auto" : 0 }}`, `width: "50%"` from px, `x: "100%"` | the same: a positional key (`width`, `height`, `top`, `left`, `right`, `bottom`, `x`, `y`) whose two ends differ in type is measured in px at both ends, every element's in one batch at the end of the task before it paints, and lands on its target as given, so an opened accordion grows with its content afterwards. Exits measure too (ADR-0059) |
| `whileTap` and `onTap` from the keyboard: Enter on a focused element (Motion's `press`), which gets `tabIndex = 0` if it can't take focus | the same, and Space too, as a button takes it: keydown presses, keyup taps, a blur cancels. The info says `input: "keyboard"`, its point the element's centre; Space is taken only where the page would scroll, so a button's own click still fires. A key the page took, or a Reorder item's (its keyboard reorder's), doesn't press (ADR-0056) |
| `onPanSessionStart`, `onPanStart`, `onPan`, `onPanEnd`: `(event, info) => …` | the same, at the event, `point` in the viewport; a pan that has started counts as a drag, so the press it took over isn't a tap, as Motion's would be (ADR-0047); set `touch-action` for touch, as with Motion; on Solid 2, `next(name)` |
| a motion value that `drag` or `animate` writes into | `ward.value("x")`, the element's output |
| `<MotionConfig reducedMotion="always">` | `<WardicProvider reducedMotion="always">`, followed as it changes: an element already on the page takes a new setting at its next animation, where Motion reads it once, as each element mounts (#366) |
| Framer's optimised appear animations (`startOptimizedAppearAnimation`) | on by default for a server render: `<WardicProvider appear={false}>` or an element's `appear={false}` turns it off |

One difference in how a value you move works: Wardic never writes into it. It's an input the element follows, and what Wardic shows comes out through the element's output, `ward.value(key)` (see *Live values* below).

### Variant orchestration

Named animation states pass from a Wardic element to its children automatically, as Motion's do. A child with `variants` and no `initial` or `animate` of its own starts from its parent's `initial` and follows its `animate`, staggered by the parent's `transition`:

```tsx
import { wardic } from "@wardic/solid"
import { For } from "solid-js"

const menu = { closed: { opacity: 0, x: -200 }, open: { opacity: 1, x: 0 } }
const item = { closed: { opacity: 0, y: 10 }, open: { opacity: 1, y: 0 } }

function NavMenu(props: { isOpen: boolean }) {
  return (
    <wardic.nav
      variants={menu}
      initial="closed"
      animate={props.isOpen ? "open" : "closed"}
      transition={{ staggerChildren: 0.05 }}
    >
      <For each={menuItems}>{(entry) => <wardic.a variants={item}>{entry.label}</wardic.a>}</For>
    </wardic.nav>
  )
}
```

When `isOpen` flips, the nav's variant changes and each item animates to its own entry of the same name, with the stagger applied. A server render gives every item its `closed` style, so the entrance starts from it with no flash.

Only those children join: an element without `variants` takes no stagger slot, an element in between passes the names through, and `inherit={false}` keeps a child out. With `createWard`, wrap the children in `<ward.Provider>` to pass its variants down.

### Nested draggables

A draggable inside a draggable drags on its own, as in Motion. A drag claims its axes when it starts (both for `drag`, one for `drag="x"` or `drag="y"`), and an ancestor that needs one of them stays where it is for that gesture:

```tsx
<wardic.div drag="x">
  <wardic.div drag="y">Slides down; the card slides across</wardic.div>
  <wardic.div drag>Drags alone</wardic.div>
  <wardic.div drag dragPropagation>Drags the card with it</wardic.div>
</wardic.div>
```

The card's `whileHover` and `whileTap` still show while a child is dragged. `dragPropagation` makes an element claim nothing, so its ancestors drag with it; `createDrag(el, { claim: false })` watches a pan over an area without blocking the draggables in it.

### Live values

A value you move yourself goes in `style`: a signal, a memo, or an `effect/reactivity` Atom. `style` also takes the transform keys (`x`, `y`, `scale`, `rotate`…), static or live. Wardic writes them through its own frame, not through Solid's `style`, so following a value that changes every frame never re-runs your JSX:

```tsx
import { createSpring, createTransform, createWard, wardic } from "@wardic/solid"

function SwipeCard() {
  const ward = createWard({ drag: "x", dragSnapToOrigin: true })
  // Fades as it's dragged out either way, in the same frame as its x.
  const opacity = createTransform(ward.value("x"), [-150, 0, 150], [0, 1, 0])
  return <div {...ward({ style: { opacity } })}>Swipe me</div>
}

function ScrollFade(props: { progress: () => number }) {
  const opacity = createTransform(props.progress, [0, 1], [0.2, 1])
  const x = createSpring(() => props.progress() * 100, { stiffness: 300, damping: 30 })
  return <wardic.div style={{ opacity, x }} whileHover={{ opacity: 1 }} />
}
```

A value in `style` is where the key rests. While `animate`, a `while*` prop or a drag sets the key, that wins. When it lets go, the key returns to where the value is then: a spring chases it if it's still moving, and a tween lands on it at its end. After that, the element follows it again. So a scroll-linked opacity under a hover shows the hover while it's on, and the scroll after.

`ward.value(key)` is what the element shows for a key, whoever moves it, as an accessor. `ward.atom(key)` is the same as an Atom, for Effect code. With a transform key set, a `transform` string in `style` gives way to the keys, as in Motion, and a warning is logged.

A spring can also snap, as Motion's does. `spring.jump(value)` sets it at once, not as motion: it rests there until its source next changes, then springs from there, and a `createVelocity` of it reads 0 across the jump. With `skipInitialAnimation: true`, the source's first change is a jump, for a source set once after mount, such as a scroll the browser restores:

```tsx
import { createScroll, createSpring, wardic } from "@wardic/solid"
import { createSignal } from "solid-js"

function Follower() {
  const [pointerX, setPointerX] = createSignal(0)
  const x = createSpring(pointerX, { stiffness: 500, damping: 40 })
  // A scroll the browser restores after mount lands at once; scrolling after it springs.
  const progress = createSpring(createScroll().scrollYProgress, { skipInitialAnimation: true })
  return (
    <div
      onPointerMove={(e) => setPointerX(e.clientX)}
      // Back in the window: start where the pointer is, without gliding across to it.
      onPointerEnter={(e) => {
        setPointerX(e.clientX)
        x.jump(e.clientX)
      }}
    >
      <wardic.div style={{ x }} />
      <wardic.div style={{ scaleX: progress }} />
    </div>
  )
}
```

Scroll, velocity and time are Live values too, and `onUpdate` reports every value Wardic draws for an element once a frame:

```tsx
import { createScroll, createTime, createTransform, createVelocity, wardic } from "@wardic/solid"

function ScrollLinked() {
  let card!: HTMLDivElement
  // The page's scroll, and the card's way through the viewport, in Motion's offset syntax.
  const { scrollY, scrollYProgress } = createScroll()
  const passing = createScroll({ target: () => card, offset: ["start end", "end start"] }).scrollYProgress
  const skewY = createTransform(createVelocity(scrollY), [-1000, 1000], [-10, 10])
  const rotate = createTransform(createTime(), (ms) => (ms / 1000) * 90)
  return (
    <>
      <wardic.div style={{ scaleX: scrollYProgress, skewY }} onUpdate={(latest) => console.log(latest.scaleX)} />
      <wardic.div ref={card} style={{ opacity: createTransform(passing, [0, 0.5, 1], [0, 1, 0]), rotate }} />
    </>
  )
}
```

A scroll's values are set within its own event, so what you derive from them paints in the frame of the scroll. Velocity reads 0 once its value stops, and time keeps the frame loop running while it exists.

A `target`'s place in its `container` is measured as Motion measures it, along its chain of offset parents. Unlike Motion, the container doesn't need a position: a `position: static` one reads just as a `relative` one would. Motion reads it short, and warns you to position the container (#395).

### Server rendering and Appear animations

A server render gives every element its starting style (its `initial`), and the client hydrates it with no flash. An element whose whole mount animation the server knows (static `initial` and `animate`, every key starting from `initial`) also plays it from first paint: the server samples it from the same springs and tweens the client runs into a CSS `@keyframes` rule in the page's head, and the element runs it before any JavaScript does. At hydration the engine takes it over where the CSS has got to, velocity included; with JavaScript off, it plays to its end and holds. Variant staggers, `when`, repeats and reduced motion (`prefers-reduced-motion`) carry over.

```tsx
<WardicProvider env={DomLive}>
  {/* Plays from first paint, taken over at hydration. */}
  <wardic.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>Hello</wardic.h1>
  {/* Waits for hydration, as before. */}
  <wardic.div appear={false} initial={{ scale: 0.9 }} animate={{ scale: 1 }} />
</WardicProvider>
```

The rules go in the head through Solid's `useAssets` (SolidStart's document renders them; a render with no `</head>` leaves its elements at their starting style). A key that starts from the element's own value (no `initial`), and an `auto` or `var()` value, wait for hydration. A `layout` element plays too, drawn as the client draws it: its own `x` and `y` aren't (its layout animation owns its translate), from the server's starting style on. Each element costs a server render about 8 µs more.

Content streamed after the page's shell (a `Suspense` boundary waiting on data) plays too: its chunk brings its own rules, which the provider moves into the head before the chunk hydrates, and its animations start when it lands.

On SVG, the attributes that are also CSS properties play too: `opacity`, `fill`, `stroke` and its width and dash (so a line drawing itself with `pathLength`), and the stop and flood colours. `cx`, `cy`, `r`, `rx`, `ry` and `attrX`/`attrY` play where the browser draws them from CSS (Chrome, Firefox; a browser that doesn't keeps the element, and what it orchestrates, at its starting style). `width`, `height` and `d` wait for hydration.

### Solid 2 (unstable)

`@wardic/solid/unstable/v2` is Wardic for Solid 2, tracking its release candidate: last tested with `solid-js` and `@solidjs/web` **2.0.0-rc.18**. Any release may change it. Once Solid 2.0 is stable it becomes `@wardic/solid`, and the Solid 1 binding moves to `@wardic/solid/v1`.

Its element primitive is `ward(config)`: a ref that carries its props. Make it once, in a component's body (or a `<For>` callback), then give it to a Wardic component's `wardRef`, which drives its element with it (#349), or spread it on a plain element. Either way its starting style goes in server HTML. Given to `ref`, it's client-only:

```tsx
import { ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"

function Card(props: { open: boolean }) {
  // Given to a Wardic component, a ward can only listen: the element's props set its motion (#398).
  const card = ward()
  createEffect(card.when("hoverStart"), ({ point }) => track(point))
  return <wardic.div wardRef={card} class="card" initial={{ opacity: 0 }} animate={{ opacity: 1, x: props.open ? 100 : 0 }} />
}

function Badge(props: { open: boolean }) {
  // Spread on a plain element, the ward is its whole motion. A key that changes is an accessor (or a
  // getter, a store's property, a component's prop).
  const badge = ward({ initial: { opacity: 0 }, animate: () => ({ opacity: 1, x: props.open ? 100 : 0 }), style: { color: "red" } })
  return <div {...badge} class="badge" />
}

<div ref={ward({ animate: { scale: 1.1 } })} />                  // client-only
<div ref={[ward({ animate: { opacity: 1 } }), (el) => (mine = el)]} />  // with your own ref
```

- **A config is read per key.** Each key is a value, or an accessor of it: `animate: () => …`, a getter, a store's property (`ward(store)`), or a component's prop (`ward(props)`, which is what `<wardic.div>` does). A change re-runs only what reads that key, so a `style` change doesn't re-resolve `animate`. A plain value is a constant, as a literal prop is: `ward({ animate: { x: x() } })` reads `x` once. `initial`, `drag` and its settings, and `layout` and its keys are read once, at setup (a Layout mode at each layout animation's start). The callbacks (`onUpdate`, `onReorder`) are functions as they are. The whole config as an accessor (`ward(() => ({ … }))`) isn't taken: a key's accessor does the same, read only where that key is. For a store, make it shallow (`createStore(config, { shallow: true })`, its values replaced whole): on the bench it Retargets 3–7% faster than a deep one, whose values are proxies. A deep store works too, a deep set (`draft.animate.opacity = 1`) included.
- `{...ward(config)}` inline doesn't work: Solid 2 runs a spread's expression again on every update, making a new ward each time, and Wardic throws when it sees one. Keep the ward in a variable.
- **The element's own `style` and `ref`** go beside a given ward as props, as its motion props do: the style over the config's, key by key, the ref beside the ward's. On a spread, `card.with({ ref, style })` gives them, as Solid 1's `ward({ ref, style })` does (#264): a `ref` written after the spread would replace the ward's own. It's for a style made after the ward, such as Motion's swipe card, whose opacity comes from its own `x`:

  ```tsx
  const swipe = ward({ drag: "x", dragSnapToOrigin: true })
  const opacity = createTransform(swipe.read("x"), [-150, 0, 150], [0, 1, 0])
  return <wardic.div wardRef={swipe} style={{ opacity }} />   // spread: <div {...swipe.with({ style: { opacity } })} />
  ```
- A kept ward has `card.Provider` (its Variant children inherit its variant names), `card.read("x")` (an accessor of the element's value, where Solid 1's ward has `ward.value`) and `card.atom("x")`. Their keys complete from the config: every key it animates or styles, through `initial`, `animate`, `exit`, its variants, `whileHover`, `whileTap`, `whileDrag` and `style`, and `x`/`y` when it drags. Any other key is accepted too.
- Sensors are refs too, and called with nothing they give their reading: `const hovered = createHover()`, then `<div ref={hovered}>` and `hovered()`. There are `createHover`, `createPress`, `createFocus`, `createInView` and `createDrag`, plus `createReducedMotion()`, which isn't a ref. Several go in one ref array beside a ward: `ref={[card, hovered]}`.
- The Live value helpers (`createTransform`, `createSpring`, `createVelocity`, `createTime`, `createScroll`) work as on Solid 1. Make them in a component's body, not inside JSX. When one is derived from a ward's `read(key)` or another helper, it carries that value's Atom, so a `style` given it moves in the same frame as its source: `createTransform(card.read("x"), [0, 200], [1, 0])` fades another element exactly as the card moves.
- **A config from async data.** A key the ward reads as it goes (`animate`, `while*`, `transition`, `style`, `custom`) may read an async memo. The ward's region waits for it under `<Loading>`, as for any async read, and the ward then plays from its `initial` to the fetched target; a refetch keeps the last target until the new one lands. Give it the memo, not a function that fetches: an accessor is called at every read, so one that returns a promise is an error. The keys a ward fixes when it's made (`initial`, `layout`, `drag`…) must be ready, and one still loading is an error naming it.

  ```tsx
  const x = createMemo(() => api.position(id()))   // async
  const card = ward({ initial: { x: 0 }, animate: () => ({ x: x() }) })
  <Loading fallback={<Skeleton />}><div {...card} /></Loading>
  ```
- **A spring's target that you both derive and set** is Solid's writable memo, given to `createSpring`. A write springs there, and the next change of what it derives from springs to that. Keep anything derived from a ward's value on its Atom (`read`, `createTransform`, `createSpring`), not in a memo: a memo over `card.read("x")` paints a frame behind the card.

  ```tsx
  const [target, setTarget] = createSignal(() => (open() ? 300 : 0))
  const x = createSpring(target)
  setTarget(150)   // springs to 150; open()'s next change springs to its value
  ```
- Reorder has factories that are refs too: `const list = reorderGroup({ values: items, onReorder: setItems })`, given to `<Reorder.Group groupRef={list}>`, and `reorderItem(list, { value })`, given to each `<Reorder.Item wardRef={row}>` (#349). Spread, they go on a `<ul>` (`<ul {...list}>`) and its `<li>`s. Each item is a ward. An item's own `tabindex` and `aria-describedby` go in its config, or on a given item's element, so the keyboard reorder's instructions are kept. `Reorder.Group` and `Reorder.Item` also take their config as props, as Motion's do.
- **Saving a new order, optimistically:** a group tells `{ values, value, from, to }` once at the end of each user reorder that changed the order: `list.next("reorderEnd")` for one, and `list.when("reorderEnd")` for an effect that acts on each (#355). A `<Reorder.Group>` made from its props hands its own group to a function in `groupRef`. The effect saves:

  ```tsx
  function TaskList() {
    const [tasks, setTasks] = createOptimisticStore<Task[]>(() => api.listTasks(), [])
    const [order, setOrder] = createSignal(() => [...tasks])   // follows tasks; the drag writes it
    const [saveError, setSaveError] = createSignal<Error>()

    const save = action(function* (ids: string[]) {
      setTasks((list) => ids.map((id) => list.find((task) => task.id === id)!))   // optimistic
      yield api.saveOrder(ids)
      refresh(tasks)
    })

    const list = reorderGroup({ values: order, onReorder: setOrder })
    const reordered = list.when("reorderEnd")
    createEffect(
      () => reordered().values.map((task) => task.id),
      (ids) => {
        setSaveError(undefined)
        save(ids).catch(setSaveError)
      },
    )

    return (
      <>
        <Show when={saveError()}>{(error) => <p role="alert">Couldn't save the order: {error().message}</p>}</Show>
        <Reorder.Group groupRef={list}>
          <For each={order()}>
            {(task) => {
              const row = reorderItem(list, { value: task })
              return <Reorder.Item wardRef={row}>{task.title}</Reorder.Item>
            }}
          </For>
        </Reorder.Group>
      </>
    )
  }
  ```
  - **The drag writes `order`, not `tasks`.** `onReorder` runs at each crossover, outside any action, and an optimistic write made there is dropped at once. `order` is a writable memo (`createSignal(fn)`): it follows `tasks`, from its load to each save's optimistic write and its refresh, and the drag overrides it until the next change.
  - **A failed save needs no rollback code.** Solid drops the optimistic write when the action settles, `order` follows `tasks` back, and the item glides back to its slot.
  - **Read the ids in the effect's compute,** a tracked scope: Solid's strict mode warns of store reads in its apply, and the action's first step runs there.
  - **Keep the failure in state.** An action started from an effect hands its failure back as a rejected promise, which reaches no `<Errored>` boundary. Left unread, it's an unhandled rejection, so the example renders it.
- **Holds:** an item in a user's hand, from its drag's start (not the press) or a keyboard lift, is a **Reorder hold**. The group tells, through `when`, `next` and `each`:
  - `"holdStart"`, with `{ value, from }`;
  - `"holdEnd"`, once, whatever ended it, with `reorderEnd`'s fields and `how`: `"drop"`, `"cancel"` (Escape) or `"unmount"`. It comes after `reorderEnd` when the order changed.

  One hold at a time. Solid 1 has `onHoldStart` / `onHoldEnd` on `Reorder.Group` (ADR-0020, *Amendment (#348)*).
- Motion's components are there too: `<wardic.div animate={…}>` and `wardic.create(Component)`. There are no directives in Solid 2, so no `use:wardic`.
- **A ward given to a component** (#349): `wardRef` takes a ward made with `ward(config)` as well as a function. The component then drives its element with that ward, so you get the tag's prop types, the variant context, and `wardic.create`'s ref forwarding, while the ward and whatever reads its `when` / `next` stay where you made it:

  ```tsx
  function Toast() {
    const card = ward()
    createEffect(card.when("settled"), () => announce("Saved"))   // each landing, any element
    return (
      <AnimatePresence>
        <Show when={open()}>
          <wardic.div wardRef={card} class="toast" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        </Show>
      </AnimatePresence>
    )
  }
  ```

  - **The ward listens; the element animates** (#398). The element's motion props go beside a given ward, laid over its config. `ward()`, with no config, only listens: a **Listening ward**, whose element's `variants`, `initial`, `animate`, `while*`, `exit` and `style` set its motion, while you hear its gestures, landings and values through the ward. `card.read(key)` and `settled()` follow what the element animates.
    - A key set in both places (`animate` in `ward({ animate })` and on the element) is a type error, and an error naming it. Set each key in one place.
    - By convention the ward holds what changes what it can hear: `drag` and its options, `layout` / `layoutId`, `viewport`. The element holds what shapes the motion. A spread keeps everything in the ward.
    - `style` merges key by key, the element's over the ward's; `ref` goes beside the ward's.
  - **Its presence is the element's.** Each element registers with the `<AnimatePresence>` the component renders under, even when the ward was made outside it. Above, every close plays the exit, and every open enters fresh, from `initial` (or at `animate`, under `initial={false}`). The ward lives on, and its `when` / `next` hear every element.
  - **A Listening ward's element joins the variant tree where it renders**, from its own props: `<wardic.li wardRef={row} variants={item}>` inside a `<wardic.ul variants initial animate>` starts at the list's `initial` name and joins its stagger, as a plain `<wardic.li>` would. Made with `ward(undefined, { parent: list })`, it joins `list`, wherever it renders.
  - **A ward that carries its variants** (its config sets `variants` or `inherit`) **has its variant parent where it's made.** Made beside its parent, a child names it: `ward(config, { parent: list })` inherits `list`'s variant names and transition, and joins its stagger in the order the children were made. That works wherever the element renders, a portal included. Made with no `parent`, under another variant parent than its element's that it would inherit from, it's an error naming the fix. `inherit: false` stands alone.
    - Its variant node is made with it, so the keys that node reads stay in its config: `initial`, `animate`, `transition`, `custom` and the `while*` names. On the element they're an error saying so; `exit`, `style`, `drag*`, `layout*` and `viewport` go there.
    - `{ parent: card }` names a ward that carries its variants: naming a Listening ward is an error, as it has none until its element mounts. Render the child inside `card`'s element, or put the variants in `card`'s `ward({ … })`.
  - **One element at a time.** A ward on a second element still on the page is an error, given or spread (one ward handed to every row of a `<For>`, say). One element after another is fine.
  - **Reorder's components** take theirs too: `<Reorder.Group groupRef={list}>` a `reorderGroup()`, and `<Reorder.Item wardRef={row}>` a `reorderItem(list, …)` of that group. Their config props go beside them by the same rule, and a plain ward or another group's item is an error. An item is made with its `value`, and a group with its `values` and `onReorder`, so those beside them are always duplicates. A group's type doesn't carry its config, so its other duplicates (`axis`, `keyboard`…) are errors at setup only. `reorderItem(list, config, { parent })` takes a parent too.

    ```tsx
    const list = reorderGroup({ values: order, onReorder: setOrder })
    <Reorder.Group groupRef={list} axis="y">
      <For each={order()}>
        {(item) => {
          const row = reorderItem(list, { value: item })
          createEffect(row.when("dragStart"), () => haptics.tap())
          return <Reorder.Item wardRef={row} whileDrag={{ scale: 1.03 }}>{item.name}</Reorder.Item>
        }}
      </For>
    </Reorder.Group>
    ```
- Motion's `onAnimationStart` and `onAnimationComplete` aren't props or config keys here; a ward hands its landings over as async values instead (#257, ADR-0046). `card.settled()` is the last landing (`{ definition, target, gestures }`), `undefined` before the first, and pending while an animation runs, so `isPending(() => card.settled())` is "animating". `await card.next("settled")` waits for the next landing, in a handler or an action; it rejects with an `AbortError` if the ward is disposed first. A press is one too (#427, ADR-0056): `card.tapped()` is the last tap, `undefined` before the first, and pending while a press is held, from a pointer or Enter and Space on the focused element, so `isPending(() => card.tapped())` is "pressed"; a cancel keeps the last tap. Motion's gesture callbacks are `next` names too: `"hoverStart"`, `"hoverEnd"`, `"pressStart"`, `"tap"`, `"tapCancel"` (each with the pointer's `point` and the `element` it was on; a press's also with its `input`, `"pointer"` or `"keyboard"`, a keyboard press's `point` the element's centre) and `"dragStart"`, `"drag"` (its start and each move), `"dragEnd"` (with `point`, `offset`, `delta`, `velocity` and `element`), and `"dragTransitionEnd"`, once the release comes to rest (not one a new target for `x` or `y` took over: it stops there, and the new animation goes on from where it was, at its speed, as Motion's does, #340); a pan's `"panSessionStart"`, `"panStart"`, `"pan"` and `"panEnd"`, a pan that has started counting as a drag for its press, so `next("tap")` doesn't come after a swipe. One is Wardic's own: `"hover"` (#397), the pointer over the element while it's hovered, its start (after `"hoverStart"`, at the same point) and each move, as `"drag"` is a drag's; Motion's hover has only a start and an end, so there you'd read the element's `pointermove`. `createEffect(card.when("hover"), ({ point, element }) => place(point, element))` follows the pointer over a card. Each gesture event's `element` (#397) is the element the ward is on, Motion's `event.currentTarget`, so reading one needs no `ref`. Their `point` is in the viewport, as `clientX` and `getBoundingClientRect()` are, not the page as Motion's: `document.elementsFromPoint(point.x, point.y)` finds what a drag was dropped on. A ward made in your component is read where you made it, and given to the element's `wardRef` (#349). A component's own ward is handed over through a function there instead: `<wardic.div wardRef={(card) => …}>`, and on `wardic.create(Component)` and `Reorder.Item`. Read `settled()` under `<Loading>`, as any async value; a read outside one still works, and Solid's dev build warns of it. On `<wardic.div>`, `onAnimationStart` is the DOM's CSS `animationstart` event, and `onDrag`, `onDragStart` and `onDragEnd` are the DOM's drag and drop.

  ```tsx
  const card = ward()
  <wardic.div wardRef={card} variants={variants} animate={open() ? "open" : "shut"} />
  <Loading><p>{isPending(() => card.settled()) ? "moving" : card.settled()?.definition}</p></Loading>

  // A drop target, found where the drag ended.
  const { point } = await photo.next("dragEnd")
  const folder = document.elementsFromPoint(point.x, point.y).find((el) => el instanceof HTMLElement && el.dataset.folder)
  ```

  `card.each(name)` is every `name` from the call on, for `for await`; the loop ends when the ward is disposed. With Solid 2's `action` and optimistic values, a gesture, its animation and a request read as one sequence. A swipe-to-dismiss card that sends its request only once it has flown off, with an undo window, and flies back by itself if the request fails or is undone. The fly-out takes `x` from the snap back, so the card goes on out from where it was let go:

  ```tsx
  const flight = { shown: { x: 0, opacity: 1 }, left: { x: -420, opacity: 0 }, right: { x: 420, opacity: 0 } }

  function NoticeCard(props: { notice: Notice; list: SourceAccessor<ReadonlyArray<Notice>> }) {
    // Optimistic: shown at once, reverted when the action ends, whichever way it ends.
    const [out, setOut] = createOptimistic<"left" | "right" | undefined>(undefined)
    const [undoable, setUndoable] = createOptimistic(false)
    // The ward hears the drag; the element sets its motion (#398).
    const card = ward({ drag: "x", dragSnapToOrigin: true })

    let undoNow = () => {}
    const dismiss = action(function* (side: "left" | "right") {
      setOut(side)                                   // fly out
      yield card.next("settled")                     // ...and land off screen
      setUndoable(true)                              // "Dismissed · Undo", for 4 s
      const undone: boolean = yield new Promise((resolve) => {
        undoNow = () => resolve(true)
        setTimeout(() => resolve(false), 4000)
      })
      if (undone) return                             // the revert flies it back in
      yield api.dismiss(props.notice.id)             // only now, the request (a throw: it flies back)
      refresh(props.list)                            // the list, without it
    })

    // Each release, through `when`: an effect dismisses on a fling.
    createEffect(card.when("dragEnd"), (release) => {
      const flung = Math.abs(release.offset.x) >= 120 || Math.abs(release.velocity.x) >= 600
      if (flung) dismiss(release.offset.x < 0 ? "left" : "right").catch(() => toast("Couldn't dismiss it"))
    })

    return (
      <>
        <wardic.article wardRef={card} variants={flight} initial="shown" animate={out() ?? "shown"}>
          {props.notice.text}
        </wardic.article>
        <Show when={undoable()}><p>Dismissed · <button onClick={() => undoNow()}>Undo</button></p></Show>
      </>
    )
  }
  ```

  **Acting on a ward's events: `when(name)`** (#355). It's a memo the ward makes for an effect, on a ward, a Reorder group and a presence handle:
  - **It's pending until the first event,** so the effect runs at each one and never before. It's typed as the event, never `undefined`, so it needs no guard. Nothing else waits on it: the page mounts, and no `<Loading>` shows.
  - **It works on any page.** On a page rendered on the server it's the browser's, with no `ssrSource` and no `<Loading>` to add: a server has no events to send.
  - **It hears each event as it's told,** so none is lost between steps. Several in one flush run the effect once, with the latest. An event with no value (`layoutStart`, `exitComplete`…) runs it each time.
  - **Read it in an effect, not in JSX.** In the element's own markup it would wait on a gesture its region holds back. To show the last event, set a signal in the effect.
  - **Call it in a component's body,** as `createMemo`: each call makes one.
  - **A failure:** `when("settled")` for an animation that fails goes to the effect's `error` arm (`createEffect(card.when("settled"), { effect, error })`). Without one, Solid logs it and skips the run.
  - **The other forms:** for a sequence, `await card.next(name)`; for every event, a `for await` over `card.each(name)`. A memo over `each` misses one between its steps, and on a page rendered on the server it needs `ssrSource: "client"` and a `<Loading>` (#343).

  **When an animation fails,** it never lands. That happens with a `transition` Wardic rejects (a `repeat: 1.5`, or a `duration` from a setting that came back `NaN`) or a step that throws. So `next("settled")` rejects with the error, `settled()` throws it (a read in JSX goes to the nearest `<Errored>`), `each("settled")` throws it, and `when("settled")` hands it to its effect's `error` arm. The next animation that starts clears it. In the card above, a fly-out that fails makes `dismiss` throw: the optimistic side reverts, and the `catch` shows its toast. Before, `dismiss` waited for good. The failure is logged and reported to your `ErrorReporter` either way, so a ward whose outcome nothing reads can't stop the app. Misusing Wardic (a ward made inside a spread, `Reorder.Item` outside a group, no `<WardicProvider>`) throws where `<Errored>` catches it too. An `onUpdate` that throws every frame is logged once per run of throws.
- Layout is async too (#257, ADR-0046). `useAnimateLayout()`'s call returns a promise of its callback's result, resolved once every layout animation the change started has ended: `await animateLayout(() => setItems(shuffled()))`, then re-enable the button. Calls in one task resolve together, and the provider's disposal rejects one still waiting with an `AbortError`. A layout element's animations are `"layoutStart"` and `"layoutComplete"` (through `when`, `next` and `each`), where Solid 1 has `onLayoutAnimationStart` / `onLayoutAnimationComplete` and `animateLayout`'s `onSettled`.
- A presence's exits are heard through a handle, `createPresence()`, given to `<AnimatePresence ref>` (#257, ADR-0046). `presence.exiting()` is whether a child is exiting, a plain reactive boolean; `await presence.next("exitComplete")` waits until every exiting child has animated out and been removed, and `next("exitStart")` until a child leaves. `ref` is optional, and takes a plain callback too: `ref={(p) => (presence = p)}`.

  ```tsx
  const presence = createPresence()
  <AnimatePresence ref={presence}><Show when={open()}><wardic.div exit={{ opacity: 0 }} /></Show></AnimatePresence>
  <button disabled={presence.exiting()} onClick={async () => {
    setOpen(false)
    await presence.next("exitComplete")
    await api.save()
  }}>Close and save</button>
  ```
- So far: `initial`, `animate`, `transition`, `variants` with stagger and `when`, `style` with Live values, `onUpdate`, `<AnimatePresence>` with `exit` (a name, a dynamic variant, the presence's `custom`), many children and `mode="wait"` / `"popLayout"`, dynamic variants and `custom`, layout (`layout`, `layoutId`, `layoutScroll`, `layoutRoot`, `layoutAnchor`, `<LayoutGroup>` with `id` and `inherit`, `useAnimateLayout`), gestures (`whileHover`, `whileTap`, `whileDrag`, `whileInView` with `viewport`, `whileFocus`), drag (`drag`, `dragConstraints` with `onMeasureDragConstraints`, `dragElastic`, `dragMomentum`, `dragSnapToOrigin`, `dragPropagation`, `dragDirectionLock`, `dragTransition`, `dragControls` from `createDragControls()`, `dragListener`), sensors, the Live value helpers, `fromAtom` and `streamToSignal`, Reorder with the keyboard reorder, and server rendering with Appear animations: the head's `<style>` goes through Solid 2's head registry (`useHead`), and a streamed `<Loading>` chunk's rules arrive with it.
- `examples/solid2-start` runs it in `@solidjs/vite-plugin`'s start mode (streaming server rendering, file routes, hydration), with the same hand checks as the Solid 1 example: `/ssr` for hydration and `/appear` for Appear animations.
- `examples/layout-lab` runs on it too (`bun dev:v2`): the same lab built on Solid 2, every scenario on the Solid 2 binding, its Reorder card on the components or the factories.

### Imperative primitives for fine-grained control

When the declarative API doesn't fit, the lower-level hooks are there:

```tsx
import { createSpring, createDrag } from "@wardic/solid"

function DraggableCard() {
  let ref!: HTMLElement

  const drag = createDrag(() => ref, {
    constraints: { left: -100, right: 100 },
    momentum: true,
  })

  return (
    <div
      ref={ref}
      style={{
        transform: `translateX(${drag.x()}px)`,
        cursor: drag.dragging() ? "grabbing" : "grab",
      }}
    >
      Drag me
    </div>
  )
}
```

---

## Packages (v0.1)

| Package | Status | Description |
|---------|--------|-------------|
| `@wardic/core` | Pre-alpha | Engine, services, primitives, interpolators, utilities |
| `@wardic/dom` | Pre-alpha | Browser environment Layers — rAF driver, DOM renderer, pointer/keyboard input, measurement |
| `@wardic/solid` | Pre-alpha | Solid framework binding — `createWard`, `wardic.*` and `wardic.create()`, `use:wardic`, primitives, components; Solid 2 at `@wardic/solid/unstable/v2` (unstable) |
| `@wardic/test` | Pre-alpha | Headless testing — mock clock, recording renderer, programmatic input |

### Future roadmap

Architectural support exists in v0.1 for everything below; these are additive future packages.

| Package | Target version | Description |
|---------|---------------|-------------|
| `@wardic/react` | v0.2 | React framework binding |
| `@wardic/web-components` | v0.3 | Custom elements for vanilla HTML and framework-agnostic use |
| `@wardic/vue` | v0.4 | Vue framework binding |
| `@wardic/timeline` | v0.5 | Scrubbable, seekable timeline abstraction |
| `@wardic/canvas` | v0.6 | Canvas 2D and WebGL renderers |
| `@wardic/native` | v0.7 | React Native renderer |
| `@wardic/devtools` | Later | OpenTelemetry-powered inspector, trace-based replay, performance attribution |

---

## Design principles

- **Services are the abstraction; everything pluggable.** Anything that varies by environment is a service. Anything stable is in core.
- **Effect is invisible to users.** The Solid bindings expose familiar shapes. Power users can drop down to Effect directly if they want.
- **SSR-correct by default.** Initial state is computed during render and applied via spread props.
- **Variants over imperative coordination.** Declarative variant orchestration scales to complex component trees better than imperative animation calls.
- **Springs for interruptible motion, tweens for definite motion.** Springs preserve velocity through target changes; tweens scrub cleanly.
- **dt over absolute time.** Animations are insensitive to clock magnitude.
- **Resource management is structural.** Effect's Scope guarantees cleanup.
- **Tracing is first-class.** Production observability of animation behavior without custom instrumentation.
- **Color quality.** The DOM Environment (`@wardic/dom`) parses CSS colors with `culori` and can blend them in any of its color spaces; core names no color syntax (ADR-0036).

---

## Status & roadmap

This project is in the architectural-design and early-implementation phase. v0.1 focuses on a feature-complete Solid binding built on a framework-agnostic core. The current focus is `@wardic/core` and `@wardic/test`, which together form the foundation everything else builds on.

Implementation order is roughly:

1. **`@wardic/core` + `@wardic/test`** — engine primitives with frame-level test coverage.
2. **`@wardic/dom`** — first browser-rendered vertical.
3. **`@wardic/solid`** — the layered Solid API (low-level `createX` primitives, `createWard`, the `wardic.create()` HOC, the `use:wardic` directive, `<AnimatePresence>` and `<LayoutGroup>` orchestration components).
4. **v0.1.0-alpha release.**

See [`plan.md`](./plan.md) for the full architectural design and decisions.

---

## Tooling

- **Bun** for package management, testing, and build. **Node 24** in the dev shell, as the storefront's SolidStart 2 app requires.
- **TypeScript** with `strict: true` and project references for incremental type-checking. `tsc` is TypeScript 7, the Go port (the `typescript-7` alias): `bun run typecheck` checks the packages, their tests and the examples. The `typescript` package stays 6 for typescript-eslint and anything using the compiler API, until they support 7 (#308).
- **Changesets** for versioning across the multi-package release.
- **ESM-only.** No CommonJS shipping.

---

## Contributing

Contributions are welcome once the foundation stabilizes. For now, the most useful thing is feedback on the design — open a discussion if you have thoughts on the architecture, the API shape, or anything in [`plan.md`](./plan.md).

If you're interested in contributing code once development opens up, watch the repo for the first preview release.

---

## License

MIT
