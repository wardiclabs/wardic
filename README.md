# Wardic

Animation for [Solid](https://www.solidjs.com), with the API of [Motion](https://motion.dev) for React.

Wardic's elements take Motion's props: `initial`, `animate`, `exit` and `transition`; variants that pass down the tree; hover, press, focus, drag and pan; layout and shared-element animations (`layout`, `layoutId`); presence; and values that follow the scroll or the pointer. On a server-rendered page, mount animations play before the JavaScript has loaded, and the client takes them over mid-flight. It runs on [Effect](https://effect.website), which it keeps out of your way: you never write Effect to use it.

## Install

```sh
npm install @wardic/solid @wardic/dom effect
```

`solid-js` is a peer: Solid 1 (`1.9`), or Solid 2's release candidate.

## Quick start

```tsx
import { DomLive } from "@wardic/dom"
import { domAnimation, w, WardicProvider } from "@wardic/solid"
import { render } from "solid-js/web"

function App() {
  return (
    <WardicProvider env={DomLive} features={[domAnimation]}>
      <w.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} whileHover={{ scale: 1.05 }}>
        Hello
      </w.div>
    </WardicProvider>
  )
}

render(() => <App />, document.getElementById("app")!)
```

The provider gives its elements **Features**: `domAnimation` is hover, press, focus and in-view. A page that drags or lays out brings `drag` or `layout` itself, through `<LazyWardic features={[drag]}>`, or loads it when it's wanted, so each page ships only the animation code it uses.

**On Solid 2,** import from `@wardic/solid/unstable/v2`: the same elements and props, built on Solid 2's reactivity. It stays outside semver until Solid 2 itself is stable.

## Coming from Motion

Most of Motion for React's API keeps its name: `<motion.div>` is `<w.div>`, and `AnimatePresence`, `LayoutGroup`, `Reorder`, `stagger` and `domAnimation` / `domMax` are as they are. Motion's hooks become Solid's `create*` primitives: `useAnimate` is `createAnimate`, `useScroll` is `createScroll`, `useSpring` is `createSpring`, `useTransform` is `createTransform`, `useInView` is `createInView`. `MotionConfig` is `WardicConfig`, and `LazyMotion` is the provider's `features` with `LazyWardic` below it. [The docs](https://wardic.dev) map every API, and say where Wardic differs.

## See it

The storefront showcase is a made-up ceramics shop whose every feature is an example: the demo, why it's worth reaching for, and the code.

- On Solid 1: https://solid1.wardic.dev
- On Solid 2: https://solid2.wardic.dev
- The same examples in Motion for React, to compare: https://motion.wardic.dev

Its source is in [`examples/storefront`](examples/storefront).

## Packages

| Package | What it is |
| --- | --- |
| [`@wardic/solid`](packages/solid) | The Solid binding: Solid 1 at the root, Solid 2 under `/unstable/v2`. |
| [`@wardic/dom`](packages/dom) | The browser environment it runs on. |
| [`@wardic/core`](packages/core) | The engine, for building a binding or an environment of your own. |
| [`@wardic/test`](packages/test) | Testing Layers: a clock that replays the frames you give it and input you push, with no browser. |

## Status

`1.0.0`'s release candidates: Motion for React's API on both Solid bindings. Solid 1's binding follows semver from `1.0.0`; Solid 2's does once Solid 2 is stable, and becomes the root entry in `2.0`. What comes next is on the [docs site](https://wardic.dev) and in the [milestones](https://github.com/wardiclabs/wardic/milestones).

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) says how work moves and what a change passes. Questions go to [Discussions](https://github.com/wardiclabs/wardic/discussions), and everyone follows the [code of conduct](CODE_OF_CONDUCT.md).

## Licence

[MIT](LICENSE). Parts of Wardic are ported from Motion's source, which is MIT too: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) says which.
