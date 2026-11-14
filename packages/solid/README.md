# @wardic/solid

Motion for React's API on [Solid](https://www.solidjs.com): elements that animate, gestures, layout and shared-element animations, presence, scroll and live values, with server rendering that plays before the JavaScript has loaded. For Solid 1, and for Solid 2 under `@wardic/solid/unstable/v2`.

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

Solid 2's binding (`@wardic/solid/unstable/v2`) is outside semver until Solid 2 itself is stable. The Effect-typed packages, `@wardic/core`, `@wardic/dom` and `@wardic/test`, and the bindings' Effect-typed entries, move to a new Effect major only in a Wardic major.

- Docs: https://wardic.dev
- Live examples: https://solid1.wardic.dev and https://solid2.wardic.dev, with Motion's beside them at https://motion.wardic.dev
- Source: https://github.com/wardiclabs/wardic/tree/main/packages/solid
- Licence: MIT
