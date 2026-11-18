# @wardic/solid

Motion for React's API on [Solid](https://www.solidjs.com): elements that animate, gestures, layout and shared-element animations, presence, scroll and live values, with server rendering that plays before the JavaScript has loaded. For Solid 2, last tested with `solid-js` and `@solidjs/web` 2.0.1, and for Solid 1 under `@wardic/solid/v1`, deprecated.

```sh
npm install @wardic/solid @wardic/dom effect
```

```tsx
import { DomLive } from "@wardic/dom"
import { createWardic, domAnimation, WardicProvider } from "@wardic/solid"

// Your app's Wardic instance, in a module of its own: hover, press, focus and in-view.
const { w } = createWardic(domAnimation)

export function App() {
  return (
    <WardicProvider env={DomLive}>
      <w.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} whileHover={{ scale: 1.05 }} />
    </WardicProvider>
  )
}
```

Solid 1's binding, `@wardic/solid/v1`, is deprecated and frozen for features, and goes at Wardic's next major: a Solid 1 app on 1.x moves to 2.0 by changing its imports from `@wardic/solid` to `@wardic/solid/v1`. `@wardic/solid/unstable/v2`, Solid 2's entry before 2.0, re-exports the root, deprecated, until then. The Effect-typed packages, `@wardic/core`, `@wardic/dom` and `@wardic/test`, and the bindings' Effect-typed entries, move to a new Effect major only in a Wardic major.

- Docs: https://wardic.dev
- Live examples: https://solid2.wardic.dev
- Source: https://github.com/wardiclabs/wardic/tree/main/packages/solid
- Licence: MIT
