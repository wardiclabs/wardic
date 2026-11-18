---
"@wardic/dom": patch
---

A server render's Appear sheet takes a slot's name from the binding (`Sheet.slot(name)`, through `ServerAppear.enter`, `enterServer`'s `ServerElement.slot` and `ElementSetup.appearEntryOf`), for one that names slots by the element's place; the sheet's count stays for the rest (#794).
