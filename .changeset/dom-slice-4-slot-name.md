---
"@wardic/dom": patch
---

A server render's Appear sheet takes a slot's name from the binding (`Sheet.slot(name)`, through `ServerAppear.enter`, `enterServer`'s `ServerElement.slot` and `ElementSetup.appearEntryOf`), for one that names slots by the element's place; the sheet's count stays for the rest. `AppearAnimations.serverAppearUnder(appear, reducedMotion, nonce)` makes a render's Appear state from a provider's settings for every binding, and `AppearAnimations.OWN_ANIMATION` is the veto each says for a style with its own `animation` (#794).
