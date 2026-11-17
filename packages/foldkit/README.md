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
- Variants go down the DOM: a child with `w.Variants(…)` and no `Animate` of its own follows the name its nearest `w.*` ancestor hands down, staggered by that ancestor's `Transition` (`staggerChildren`, `delayChildren`, `when`). `w.Custom(value)` resolves its dynamic variants; `w.Inherit(false)` keeps it out.
- `w.Config({ transition, reducedMotion, skipAnimations })` sets a subtree's defaults, over the Handle's `Wardic.make({ config })`.
- `w.OnAnimationStart(message | (definition) => message)` and `w.OnAnimationComplete(…)` send Messages to `update`; `Option.none()` from a function sends nothing.
- Live values are Atoms: `w.Style({ x: atom })` follows one through the gate, `w.Text(atom)` writes one as the element's text, `w.OnUpdate(atom)` sets one to the element's values each frame. Derived ones (`LiveValue.spring`, `follow`, `velocity`, `scroll`, re-exported from the root) are made in a Command through `Wardic.provide(effect)`, with `resources: wardic.resources` on the program; their Scope is the caller's, a `ManagedResource`'s or an `Effect.scoped`.
- `Wardic.animate(subject, values, options)` is an Effect for a Command: an element, a selector or a list, landing as `{ landed }`, failing `AnimationFailed` when the subject finds nothing.
- A Retarget a patch makes paints its first step in the patch's frame: the binding tells the Frame loop it runs inside the frame (the **Held frame**'s cure).
- Presence: `w.ul([w.Presence({ mode, initial, custom, onExitComplete, propagate })], items.map((key) => w.keyed("li")(key, [w.Exit({ opacity: 0 }), …], [key])))` keeps each item Foldkit removes in its place while its `Exit` plays, in Motion's order through the patches that follow; one back under its key mid-exit takes over from where the leaver is. It needs `Wardic.make({ env, features: [Features.presence] })`, with `Features` from the root.
- Layout: `w.li([w.Layout(true)])` animates from where it was to where a patch put it, measured by a pass after every patch that changed the DOM (the child list, the text, `class` and `hidden`; `Wardic.make({ layoutAttributes })` adds yours; never `style`). `w.LayoutId("pill")` hands over across two views; `w.LayoutGroup({ id })` on an ancestor keeps its ids apart; `w.LayoutDependency(value)` asks for a pass as it changes, the only trigger beside `Wardic.animateLayout` under `Wardic.make({ layoutTrigger: "declared" })`. `w.OnLayoutAnimationStart(message)` and `w.OnLayoutAnimationComplete(message)` send Messages; `w.OnBeforeLayoutMeasure(fn)` and `w.OnLayoutMeasure(fn)` are plain functions. It needs `Features.layout`. Put `w.Provider()` on the app's root: the observer then watches the app's tree alone, not the body (Foldkit's DevTools paint into it).
- Scene tests resolve Wardic's Mounts by name: `Scene.Mount.resolve(wardic.Element, Done())`, `wardic.Provider` and `wardic.Presence`.

- Docs: https://wardic.dev
- Source: https://github.com/wardiclabs/wardic/tree/main/packages/foldkit
- Licence: MIT
