# Wardic

> A reactive, services-based animation engine for the modern web.

Wardic is a fine-grained reactive animation engine built on [Effect v4](https://effect.website) (using its in-core reactivity at `effect/unstable/reactivity`). It treats environments as Layer-provided services rather than parallel packages, which means the same animation code can run in browsers, headless test runners, or any future environment that has a corresponding Layer. The result is a library that's architecturally cleaner, more observable, and more portable than typical animation libraries — without asking users to know Effect.

> [!WARNING]
> Wardic is **pre-alpha** and not yet usable. v0.1 will ship with Solid bindings only; React, Vue, web components, React Native, and Canvas are roadmap items. APIs will change. Watch the repo for the first preview release.

---

## What makes it different

**Environments are services, not parallel packages.** The engine declares its dependencies (Clock, Renderer, InputSource, Probe, InterpolatorRegistry) as Effect services. Environment packages provide Layer implementations. Adding a new environment is writing a Layer, not reimplementing the engine. The same animation code works everywhere a Layer exists.

**SSR-correct by default.** `useWardic` computes initial styles synchronously during render and applies them via spread props. Server-rendered HTML arrives at the client already in the correct initial state. No flash of unanimated content, no hydration mismatch.

**Variant orchestration as a first-class feature.** Declarative named animation states propagate through the component tree via the `ward.Provider` context. Children inherit the current variant from their parent, with automatic stagger support and configurable ordering. Familiar pattern from Framer Motion, but built on a reactive foundation that scales cleanly to complex trees.

**Built-in observability.** Every animation primitive wraps in `Effect.withSpan`. Hook up OpenTelemetry once at app entry and get hierarchical traces of every animation in your application — performance attribution, causality across the app, replay-from-trace capabilities. Production observability of animation behavior without custom instrumentation.

**Effect is invisible to users.** The Solid bindings expose `useWardic`, `wardic.create()`, and idiomatic `createX` hooks. The Effect machinery underneath is doing structural work — resource scoping, cancellation, dependency injection — that users don't have to think about. Power users who do know Effect can drop down and provide custom Layers for advanced cases.

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

### Basic animation with `useWardic`

```tsx
import { useWardic, easeOutCubic } from "@wardic/solid"

function Hero() {
  const ward = useWardic({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, easing: easeOutCubic },
  })

  return <div {...ward()}>Hero content</div>
}
```

`ward()` returns a spread containing `ref`, `style`, and any event handlers needed for the animation. The initial styles are serialized into server-rendered HTML, so no flash on hydration.

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

### Variant orchestration

Named animation states propagate from parent to children automatically:

```tsx
import { useWardic, springs } from "@wardic/solid"
import { For } from "solid-js"

function NavMenu(props: { isOpen: boolean }) {
  const ward = useWardic({
    variants: {
      closed: { opacity: 0, x: -200 },
      open:   { opacity: 1, x: 0 },
    },
    initial: "closed",
    animate: () => (props.isOpen ? "open" : "closed"),
    transition: {
      type: "spring",
      ...springs.gentle,
      staggerChildren: 0.05,
    },
  })

  return (
    <ward.Provider>
      <nav {...ward()}>
        <For each={menuItems}>
          {(item) => <NavItem label={item.label} />}
        </For>
      </nav>
    </ward.Provider>
  )
}

function NavItem(props: { label: string }) {
  // No `initial` or `animate` — inherits the current variant from the parent
  const ward = useWardic({
    variants: {
      closed: { opacity: 0, y: 10 },
      open:   { opacity: 1, y: 0 },
    },
  })

  return <a {...ward()}>{props.label}</a>
}
```

When `isOpen` flips, the parent's variant changes, the Provider propagates the change to children, and each child animates to its matching variant with the stagger applied.

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
| `@wardic/solid` | Pre-alpha | Solid framework binding — `useWardic`, `wardic.create()`, hooks, components, directives |
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
- **Color quality.** Depend on `culori` for proper color-space interpolation rather than naive sRGB.

---

## Status & roadmap

This project is in the architectural-design and early-implementation phase. v0.1 focuses on a feature-complete Solid binding built on a framework-agnostic core. The current focus is `@wardic/core` and `@wardic/test`, which together form the foundation everything else builds on.

Implementation order is roughly:

1. **`@wardic/core` + `@wardic/test`** — engine primitives with frame-level test coverage.
2. **`@wardic/dom`** — first browser-rendered vertical.
3. **`@wardic/solid`** — the layered Solid API (low-level `createX` primitives, `useWardic` hook, `wardic.create()` HOC, `use:ward` directive, `<AnimatePresence>` and `<LayoutGroup>` orchestration components).
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
