# @wardic/foldkit

## 1.2.0

### Minor Changes

- 9476e68: `@wardic/foldkit`, Wardic's binding for [Foldkit](https://www.npmjs.com/package/foldkit), ships (#561, ADR-0071): Motion's animations on Foldkit's views, as Effect. One Handle a program, `Wardic.make({ env, features })`, whose `html(h)` gives a view the `w.*` elements, with Motion's props as attributes: `w.Initial`, `w.Animate`, `w.Transition` and `w.Variants`, the gestures (`w.WhileHover`, `w.WhileTap`, `w.WhileFocus`, `w.WhileInView`), `w.Drag` and its options, `w.Layout`, `w.LayoutId` and `w.LayoutGroup`, `w.Presence` and `w.Exit`, `w.ReorderGroup` and `w.ReorderItem`; Messages where Motion has callbacks; Atoms for the Live values (`w.Style`, `w.Text`, `w.OnUpdate`, `Wardic.scroll`, `Wardic.pointer`); `Wardic.animate` and `Wardic.animateLayout` as Effects for Commands, with Animation controls, Animation scopes and Drag controls made apart from any element; the Features a Handle names or loads; server rendering through Foldkit's `renderToString`, the Appear animations playing from the first paint and `wardic.hydrate` taking them over; and Scene tests resolving its Mounts by name. See [Start on Foldkit](https://wardic.dev/start/foldkit) and the [Foldkit reference](https://wardic.dev/reference/foldkit).

### Patch Changes

- 93a40be: Foldkit 0.171.0 (#795): the peer range widened to `~0.170.0 || ~0.171.0`, the suites passing on it.
- 8c19ae6: What the storefront's Foldkit app asked of the binding (#795): `w.LayoutCrossfade(false)`, so a `LayoutId` handover flies one element instead of blending two; `arc()`, `correctParentTransform` and `transformViewBoxPoint` from the root and from `Wardic`, the last two given an element as a selector, since a Foldkit view has no refs.
- d4539b8: `Wardic.scroll(options)`: a container's scroll as Live values (Motion's `useScroll`), on the Handle's `scroll` Feature, now exported as `Features.scroll`; without the Feature it fails with `ScrollFailed`. Core's `LiveValue.scroll` under `Wardic.provide` had no way to that Feature's service (#795).
- 69b558a: `Wardic.pointer(element, options?)`: the pointer over an element as Live values, on the Handle's registry (#833): its place in the element's pixels, its progress across the element's box from 0 to 1 each way, the box's size, and whether it's inside, each an Atom a view binds, set within the pointer's own events and held while the caller's Scope lives; a mouse and a pen unless `types` says. Plain pointer events, not the hover gesture: no Feature to name, nothing to fail.
- 8cb7917: A `popLayout` leaver is pinned where it was before the patch (#840): a child swapped for another in one patch, a page under `w.Presence({ mode: "popLayout" })` for the next, was measured after Foldkit had put the entering child in above it, so it was pinned that much lower and a `layoutId` photo flew up from there. The binding now measures each `popLayout` presence's children as a view renders such a presence, before the render's patch; a presence pins its leavers before it starts the children of the change; every `w.*` element's Mount lets the presences deliver before it registers anything; and the layout observer asks for its pass once they have. So a `layoutId` twin entering in the same patch takes over from where its leaver was pinned, not where the patch pushed it.
- 6024e95: A tree mounted by one patch starts top-down (#848): a `w.*` element not under a `w.Presence` now starts once its nearest `w.*` ancestor has, where it started at its own Mount, which Foldkit runs before the parent's. Variant children under a parent with `staggerChildren` mounted in the same patch started together, each reading a stagger slot set with itself alone registered; they now read it with every sibling known, and the storefront's product grid staggers on a client-side navigation and a Replay as it did on a hard load.
- Updated dependencies [69b558a]
- Updated dependencies [8cb7917]
  - @wardic/dom@1.2.0
  - @wardic/core@1.2.0
