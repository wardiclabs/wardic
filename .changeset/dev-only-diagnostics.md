---
"@wardic/solid": patch
---

A production build leaves out development's notes: the `wardic.base` and `wardic.hydration` Debug logs and the `wardic.style` warning are written in development alone, and the errors an app can hit (a `WardicProvider` whose `env` waits as it builds, a `wardic.create` component that doesn't forward its ref) throw one line in production and the full fix in development. A Slim element's app is 1.1 KB gzipped smaller on both bindings.
