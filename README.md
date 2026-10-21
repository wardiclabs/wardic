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
import { createWard, easeOutCubic } from "@wardic/solid"

function Hero() {
  const ward = createWard({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, easing: easeOutCubic },
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

`wardic.create()` works for HTML element strings or any Solid component that forwards refs.

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

One timing difference: a main-thread stall longer than 0.5 s (a hidden tab, a debugger pause) advances an animation 0.5 s, and it plays out the rest when frames resume, where Motion's jumps to where the elapsed time puts it. A shorter stall lands a tween, a spring or a layout animation where Motion's lands (ADR-0017, *Amendment (#23)*).

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
| `useSpring(value, options)` | `createSpring(value, options)` |
| `useScroll({ container, target, offset })` | `createScroll({ container, target, offset })` |
| `useVelocity(value)` | `createVelocity(value)` |
| `useTime()` | `createTime()` |
| `onUpdate={(latest) => …}` | `onUpdate={(latest) => …}` |
| `onAnimationStart={(definition) => …}`, `onAnimationComplete={(definition) => …}` | the same, with the variant name or the target values (ADR-0046); not on Solid 2 |
| a motion value that `drag` or `animate` writes into | `ward.value("x")`, the element's output |
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

`@wardic/solid/unstable/v2` is Wardic for Solid 2, tracking its release candidate: last tested with `solid-js` and `@solidjs/web` **2.0.0-rc.15**. Any release may change it. Once Solid 2.0 is stable it becomes `@wardic/solid`, and the Solid 1 binding moves to `@wardic/solid/v1`.

Its element primitive is `ward(config)`: a ref that carries its props. Make it once, in a component's body (or a `<For>` callback), then spread it, which puts its starting style in server HTML, or give it to `ref`, client-only:

```tsx
import { ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"

function Card(props: { open: boolean }) {
  // A key that changes is an accessor (or a getter, a store's property, a component's prop).
  const card = ward({ initial: { opacity: 0 }, animate: () => ({ opacity: 1, x: props.open ? 100 : 0 }), style: { color: "red" } })
  return <div {...card} class="card" />
}

<div ref={ward({ animate: { scale: 1.1 } })} />                  // client-only
<div ref={[ward({ animate: { opacity: 1 } }), (el) => (mine = el)]} />  // with your own ref
```

- **A config is read per key.** Each key is a value, or an accessor of it: `animate: () => …`, a getter, a store's property (`ward(store)`), or a component's prop (`ward(props)`, which is what `<wardic.div>` does). A change re-runs only what reads that key, so a `style` change doesn't re-resolve `animate`. A plain value is a constant, as a literal prop is: `ward({ animate: { x: x() } })` reads `x` once. `initial`, `drag` and its settings, and `layout` and its keys are read once, at setup (a Layout mode at each layout animation's start). The callbacks (`onUpdate`, the layout animation callbacks, `onReorder`) are functions as they are. The whole config as an accessor (`ward(() => ({ … }))`) isn't taken: a key's accessor does the same, read only where that key is. For a store, make it shallow (`createStore(config, { shallow: true })`, its values replaced whole): on the bench it Retargets 3–7% faster than a deep one, whose values are proxies. A deep store works too, a deep set (`draft.animate.opacity = 1`) included.
- `{...ward(config)}` inline doesn't work: Solid 2 runs a spread's expression again on every update, making a new ward each time, and Wardic throws when it sees one. Keep the ward in a variable.
- A kept ward has `card.Provider` (its Variant children inherit its variant names), `card.read("x")` (an accessor of the element's value, where Solid 1's ward has `ward.value`) and `card.atom("x")`. Their keys complete from the config: every key it animates or styles, through `initial`, `animate`, `exit`, its variants, `whileHover`, `whileTap`, `whileDrag` and `style`, and `x`/`y` when it drags. Any other key is accepted too.
- Sensors are refs too, and called with nothing they give their reading: `const hovered = createHover()`, then `<div ref={hovered}>` and `hovered()`. There are `createHover`, `createPress`, `createFocus`, `createInView` and `createDrag`, plus `createReducedMotion()`, which isn't a ref. Several go in one ref array beside a ward: `ref={[card, hovered]}`.
- The Live value helpers (`createTransform`, `createSpring`, `createVelocity`, `createTime`, `createScroll`) work as on Solid 1. Make them in a component's body, not inside JSX. When one is derived from a ward's `read(key)` or another helper, it carries that value's Atom, so a `style` given it moves in the same frame as its source: `createTransform(card.read("x"), [0, 200], [1, 0])` fades another element exactly as the card moves.
- Reorder has factories that are refs too: `const list = reorderGroup({ values: items, onReorder: setItems })` goes on the `<ul>` (`<ul {...list}>`), and `reorderItem(list, { value })` on each `<li>`. Each item is a ward. An item's own `tabindex` and `aria-describedby` go in its config, so the keyboard reorder's instructions are kept. `Reorder.Group` and `Reorder.Item` are there too.
- Motion's components are there too: `<wardic.div animate={…}>` and `wardic.create(Component)`. There are no directives in Solid 2, so no `use:wardic`.
- Motion's `onAnimationStart` and `onAnimationComplete` aren't props or config keys here; a ward hands its landings over as async values instead (#257, ADR-0046). `card.settled()` is the last landing (`{ definition, target, gestures }`), `undefined` before the first, and pending while an animation runs, so `isPending(() => card.settled())` is "animating". `await card.next("settled")` waits for the next landing, in a handler or an action; it rejects with an `AbortError` if the ward is disposed first. Read `settled()` under `<Loading>`, as any async value; a read outside one still works, and Solid's dev build warns of it. On `<wardic.div>`, `onAnimationStart` is the DOM's CSS `animationstart` event.

  ```tsx
  const card = ward({ animate: () => (open() ? "open" : "shut"), variants })
  <div {...card} />
  <Loading><p>{isPending(() => card.settled()) ? "moving" : card.settled()?.definition}</p></Loading>
  ```
- So far: `initial`, `animate`, `transition`, `variants` with stagger and `when`, `style` with Live values, `onUpdate`, `<AnimatePresence>` with `exit`, layout (`layout`, `layoutId`, `layoutScroll`, `layoutRoot`, `layoutAnchor`, `<LayoutGroup>`, `useAnimateLayout`), gestures (`whileHover`, `whileTap`, `whileDrag`), drag (`drag`, `dragConstraints`, `dragElastic`, `dragMomentum`, `dragSnapToOrigin`, `dragPropagation`, `dragTransition`), sensors, the Live value helpers, `fromAtom` and `streamToSignal`, Reorder with the keyboard reorder, and server rendering with Appear animations: the head's `<style>` goes through Solid 2's head registry (`useHead`), and a streamed `<Loading>` chunk's rules arrive with it.
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

- **Bun** for package management, testing, and build.
- **TypeScript** with `strict: true` and project references for incremental type-checking.
- **Changesets** for versioning across the multi-package release.
- **ESM-only.** No CommonJS shipping.

---

## Contributing

Contributions are welcome once the foundation stabilizes. For now, the most useful thing is feedback on the design — open a discussion if you have thoughts on the architecture, the API shape, or anything in [`plan.md`](./plan.md).

If you're interested in contributing code once development opens up, watch the repo for the first preview release.

---

## License

MIT
