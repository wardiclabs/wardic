# @wardic/foldkit

[Wardic](https://wardic.dev) for [Foldkit](https://www.npmjs.com/package/foldkit): Motion's animations on Foldkit's views, as Effect. Private until Wardic 1.2 ships it (#561).

```ts
import { DomLive } from "@wardic/dom"
import * as Wardic from "@wardic/foldkit/Wardic"

// Once, at module scope.
export const wardic = Wardic.make({ env: DomLive })

// In the view: `w.*` elements take Foldkit's attributes and Wardic's.
const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return w.div([h.Class("app")], [
    w.div([h.Class("card"), w.Initial({ opacity: 0, y: 8 }), w.Animate({ opacity: 1, y: 0 }), w.Transition({ duration: 0.3 })], [model.title]),
  ])
}
```

- The first `w.*` element to mount builds Wardic's services on the Handle's `env`, shared until the last has left. `w.Provider(options)` on the `w.*` element at the top names the root the subtree options hang on.
- An element animates its `Animate` target from `Initial` as it mounts, Retargets on a render that changes its target, and holds through one that doesn't.
- `h.div([...w.attributes({ initial, animate, transition, style, mount })])` puts a Ward on an element `w` doesn't make.
- Scene tests resolve Wardic's Mounts by name: `Scene.Mount.resolve(wardic.Element, Done())`, and `wardic.Provider`.

- Docs: https://wardic.dev
- Source: https://github.com/wardiclabs/wardic/tree/main/packages/foldkit
- Licence: MIT
