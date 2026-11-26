---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
"@wardic/foldkit": patch
"@wardic/three": patch
---

A dynamic variant (a function in `variants`) that throws is now its element's alone, and reported (#979). Before, the throw came out of the app's update. On Solid 1 that froze every element changed in it; Solid 2 halted; and Foldkit crashed the app if it threw at setup, and kept every leaver on the page if it threw in an exit.

- At a change (`animate`, a `while*` gesture, an inherited name), the element keeps the target it had until the variant resolves again. It's logged once as `wardic.ward: a variant failed`, annotated with the variant's name, until then. One that throws only as its element orchestrates its Variant children (it's resolved there with no values) is logged the same way, and the children animate without that variant's orchestration.
- In an `exit`, alone or in a list, the element leaves at once, without its exit, and the others leaving beside it exit. It's logged each time as `wardic.presence: an exit variant failed`.
- At setup, the element starts without that variant's values, and it's logged once, not again at its first change. On a server those values are left out of the markup, and it's logged there.
