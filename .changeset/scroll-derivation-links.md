---
"@wardic/core": minor
---

`LiveValue.derivesAs(atom, source)` describes an Atom a binding keeps and sets from `source` as deriving from a container's scroll as `source` does, so a Timeline value finds it, and a `transform` made over it before then derives through it too. `scrollDerivationOf` now reads a value's derivation when it's asked for: a `transform` made before its source was described, or a source pointed somewhere new, is described as its source is now.
