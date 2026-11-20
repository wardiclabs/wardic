<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/wardic-lockup-on-dark.svg">
    <img alt="Wardic" src="brand/wardic-lockup-on-light.svg" height="72">
  </picture>
</h1>

An animation library with the API of [Motion](https://motion.dev) for React, built on [Effect](https://effect.website), for [Solid](https://www.solidjs.com) and [Foldkit](https://www.npmjs.com/package/foldkit).

Wardic's elements take Motion's props: `initial`, `animate`, `exit` and `transition`; variants that pass down the tree; hover, press, focus, drag and pan; layout and shared-element animations (`layout`, `layoutId`); presence; and values that follow the scroll or the pointer. On a server-rendered page, mount animations play before the JavaScript has loaded, and the client takes them over mid-flight. On Solid, Effect stays out of your way: you never write Effect to use it.

## Install

```sh
npm install @wardic/solid @wardic/dom effect
```

`solid-js` and `@solidjs/web` are peers: Solid 2. On Solid 1, see below.

## Quick start

```tsx
import { DomLive } from "@wardic/dom"
import { createWardic, domAnimation, WardicProvider } from "@wardic/solid"
import { render } from "@solidjs/web"

// Your app's Wardic instance, in a module of its own (src/lib/wardic.ts): hover, press, focus and in-view.
const { w } = createWardic(domAnimation)

function App() {
  return (
    <WardicProvider env={DomLive}>
      <w.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} whileHover={{ scale: 1.05 }}>
        Hello
      </w.div>
    </WardicProvider>
  )
}

render(() => <App />, document.getElementById("app")!)
```

An element's gestures, layout and the rest are **Features**, chosen on a Wardic instance: `domAnimation` is hover, press, focus and in-view. Its elements take those Features' props alone, so a prop of another is a type error that names it. A page that drags or lays out makes an instance of its own, `createWardic([domAnimation, drag])`, or loads a Feature when it's wanted, so each page ships only the animation code it uses.

**On Solid 1** (`1.9`), import from `@wardic/solid/v1`: the same elements and animation props, built on Solid 1's reactivity, with Motion's callback props (`onTap`…) where Solid 2 has a ward's events. It's deprecated and frozen for features, and goes at Wardic's next major. A Solid 1 app on `@wardic/solid` 1.x moves to 2.0 by changing its imports from `@wardic/solid` to `@wardic/solid/v1`.

## Coming from Motion

Most of Motion for React's API keeps its name: `<motion.div>` is `<w.div>`, with the Features its Wardic instance gives, and `AnimatePresence`, `LayoutGroup`, `Reorder`, `stagger` and `domAnimation` / `domMax` are as they are. Motion's hooks become Solid's `create*` primitives: `useAnimate` is `createAnimate`, `useScroll` is `createScroll`, `useSpring` is `createSpring`, `useTransform` is `createTransform`, `useInView` is `createInView`. `MotionConfig` is `WardicConfig`, and `m` under `LazyMotion` is a Wardic instance's `w` (`createWardic`), or `LazyWardic` for a section. Motion's callback props (`onTap`…) are a ward's events: `await card.next("tap")`. [The docs](https://wardic.dev) map every API, and say where Wardic differs.

## See it

The storefront showcase is a made-up ceramics shop whose every feature is an example: the demo, why it's worth reaching for, and the code.

- On Solid 2: https://solid2.wardic.dev

Its source is in [`examples/storefront`](examples/storefront), with a Solid 1 version beside it.

## Packages

| Package | What it is |
| --- | --- |
| [`@wardic/solid`](packages/solid) | The Solid binding: Solid 2 at the root, Solid 1 under `/v1`, deprecated. |
| [`@wardic/foldkit`](packages/foldkit) | The Foldkit binding: Motion's animations on Foldkit's views, as Effect. |
| [`@wardic/dom`](packages/dom) | The browser environment it runs on. |
| [`@wardic/core`](packages/core) | The engine, for building a binding or an environment of your own. |
| [`@wardic/test`](packages/test) | Testing Layers: a clock that replays the frames you give it and input you push, with no browser. |

## Status

`@wardic/solid` 2.0: Motion for React's API on Solid 2 at the root, under semver, and on Solid 1 at `/v1`, deprecated. `@wardic/core`, `@wardic/dom`, `@wardic/test` and `@wardic/foldkit` are on 1.x, and version together; `@wardic/solid` versions on its own, on the exact `@wardic/core` and `@wardic/dom` it's built with. The Effect-typed packages, `@wardic/core`, `@wardic/dom`, `@wardic/test` and `@wardic/foldkit`, and the Solid binding's Effect-typed entries, move to a new Effect major only in a Wardic major. What comes next is on the [docs site](https://wardic.dev) and in the [milestones](https://github.com/wardiclabs/wardic/milestones).

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) says how work moves and what a change passes. Questions go to [Discussions](https://github.com/wardiclabs/wardic/discussions), and everyone follows the [code of conduct](CODE_OF_CONDUCT.md).

## Licence

[MIT](LICENSE). Parts of Wardic are ported from Motion's source, which is MIT too: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) says which.
