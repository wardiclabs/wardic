---
"@wardic/dom": minor
---

`@wardic/dom/Appear`'s `findIn` looks an element's own Appear animation up in a page's read (`findAll`'s), as `find` gets it, with no read of its own: elements hydrating together share one read. `findAll` reads a shadow root's Appear animations too, which a document's read doesn't reach.
