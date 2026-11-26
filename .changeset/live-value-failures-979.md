---
"@wardic/core": patch
"@wardic/solid": patch
---

A Live value whose transform throws no longer freezes (#979). Before, a `createTransform` function or `mixer` that threw over a `createFollowValue`, `createSpring`, `createVelocity` or `createTime` value ended that value's run for good, with nothing logged, and every other consumer of it stopped too.

```tsx
const followed = createFollowValue(target, { type: "tween", duration: 0.3 })
const label = createTransform(followed, (x) => formatter.format(x)) // a formatter that throws for some values
// before: the follow stopped where it was, for good, and nothing said why
// now: the follow lands; `label` keeps the last value it gave, and "wardic.transform: its function failed" is logged once until it returns
```

- **A transform's function or `mixer` that throws** keeps the value it gave last, logged once until it returns, on both bindings and in core's `LiveValue.transform`. One that throws for its first value still throws, to whatever reads it first.
- **On Solid 1,** the rest of the update it ran in goes on: before, Solid dropped it, and what read the transform stopped following it.
- **A Live value's run** (a follow or spring, a velocity, time) goes on past an Atom over it that throws, and past a source that throws as it's read: a spring steers toward its source's last read, and a velocity reads as still. Each is logged once until it's clean.
- **The Frame loop:** a hook at the end of a tick that throws no longer ends every run on the loop. A velocity over a failing source did.
- **A ward's `read(key)`:** an Atom over it that throws no longer ends the ward's own animation.
