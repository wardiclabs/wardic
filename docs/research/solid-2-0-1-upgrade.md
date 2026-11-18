# Solid `2.0.0-rc.21` → `2.0.1`: what changed for Wardic

> **Read at:** 2026-11-18 (UTC), on `feat/566-solid-2-stable` (installed: `solid-js-2`, `@solidjs/web`,
> `@solidjs/babel-plugin`, `@solidjs/diagnostics` and `@solidjs/signals` 2.0.1, `@solidjs/compiler`
> 2.0.1, `@solidjs/router` 2.0.0, `@solidjs/vite-plugin` 3.0.1). **Sources, in order of trust:**
> - The npm tarballs of 2.0.0 (`npm pack` into an empty scratch directory, nothing run from them),
>   diffed against the installed rc.21 copies: `solid-js`, `@solidjs/signals`, `@solidjs/web`,
>   `@solidjs/babel-plugin`, `@solidjs/diagnostics`.
> - The `solidjs/solid` changelogs at the tag `solid-js@2.0.0` (rc.22, rc.23 and 2.0.0's entries; 2.0.0's
>   section is cumulative, so only rc.22, rc.23 and one docs-URL change, 83aa07c, are new), and the GitHub
>   release of [`@solidjs/signals@2.0.1`](https://github.com/solidjs/solid/releases/tag/%40solidjs/signals%402.0.1)
>   (2026-11-18). `solidjs/solid-router`'s changelog to 2.0.0, `solidjs/solid-vite-plugin`'s to 3.0.1.
> - The binding, where its code meets each change, and its suites on 2.0.1 (#320's diagnostics gate on).
>
> 2.0.1 came out the day this was read, after the 2.0.0 tarballs were diffed: its notes are read, its
> tarballs aren't. Solid paths are the 2.0.0 tarball's `dist/…` unless prefixed `wardic:`.

## Summary

| | Reached by Wardic's shipped code | Reached by tests / examples / site only |
|---|---|---|
| Public API | None changed: `solid-js`'s `types/index.d.ts` and `CHEATSHEET.md` are byte-identical to rc.21's, and the four packages' `exports` maps too. | — |
| Ref callbacks (7230c08, 9c917ea; rc.22) | A ref runs in its creating pass's owner, not ownerless: a memo, an effect or a root made there throws (`PRIMITIVE_IN_EFFECT_CALLBACK`), and so does `onCleanup` (`CLEANUP_IN_FORBIDDEN_SCOPE`), even under `runWithOwner`. A ward's accessors made at their first call did both: fixed ([below](#ref-callbacks)). | — |
| Context providers (cf839ea) | A provider makes no owner of its own now: two lazy memos carry its value. The owner chain under a `WardicProvider` is shorter; hydration ids move on both sides alike. | — |
| Scheduling and holds (`@solidjs/signals`: ab3fc44, eb31c86, 5755ddd, 46a72c0, dc33de6, 6b7474b, 0895916, a01fd92, e0f31bc; 2.0.1's) | A computation runs after every computation that owns it; a queued child no longer runs before the owner that disposes it; a user effect waits for the end of a hold. The binding's held-region, in-action, async-config, in-flight-setup and route-transition tests pass as they were. | — |
| Reconciler (`@solidjs/web` rc.22: b38d592, dfb1812, 218fe4a) | A moved node moves with `Element.moveBefore()` where the browser has it, staying connected; no `NotFoundError` when user code moved a list node past its list's end (presence's re-inserted leavers). | — |
| Compiler (rc.22, rc.23) | Production builds compile `<Show>` to a ternary (`lowerShow`, default `!dev`): the binding's source has none, but an app's `<Show>` under `<AnimatePresence>` is one. The compiler and `@solidjs/web` move together (`heldRead`, `ssrSelect`). | The size gate's and `bench:solid`'s Solid 2 apps build with `dev: false`. |
| Bundle | Every Solid 2 app that makes a ward ships about 1.4 KB more gzipped of Solid's own code; Solid's bare app shrinks ([below](#size)). | — |
| Diagnostics | 72 → 75 codes, none removed: `INVALID_HTML_NESTING`, `OPTIMISTIC_WRITE_WHILE_LOADING`, `STORE_WRITE_THROUGH_LOADING`. Every `guideUrl` moved to `docs.solidjs.com`. | The `reactivity-diagnostics` skill gained the ref callback's notes (`bun run skills`). |
| Router 2.0.0, vite-plugin 3.0.1 | — | Stable, peering on `^2.0.0`. Router: five changesets since next.44, none on what the tests use (`createRouter`, `memoryHistory`, `useNavigate`, `useParams`). vite-plugin: dev module URLs, a directive's dead-code fix, start mode's SSR build order and hot updates. `@solidjs/start` has no Solid 2 release; nothing here uses it for Solid 2. |

## Ref callbacks

rc.21's `ref()` was `runWithOwner(null, () => applyRef(…))`; 2.0.0's is `runRefCallback(() => applyRef(…))`
(`@solidjs/web` `web.dev.js`), which runs the ref untracked in the creating pass's context and marks it an
effect callback whose owner is that context (`@solidjs/signals` `dev-shared.js`, `runRefCallback`):

- **A memo, an effect or a root** throws `PRIMITIVE_IN_EFFECT_CALLBACK` when the current owner *is* that
  context (`assertNotInEffectCallback`, called by `createOwner` and `setupComputedNode`). Under
  `runWithOwner` to any other owner it's allowed.
- **`onCleanup`** throws `CLEANUP_IN_FORBIDDEN_SCOPE` whenever a ref runs, whatever the owner: the check
  is a depth count (`inRefCallback`).
- **A read** made directly in a ref warns `STRICT_READ_UNTRACKED`; one inside `untrack` doesn't.
- **A signal's write** is allowed.

A ward spread in the component that made it has that component's owner, and so does the ref the spread
applies: `runWithOwner(owner, …)`, how the binding made an accessor's memos at its first call, was the ref's
own context. Before the fix, `card.read("x")` first called in a ref threw `CLEANUP_IN_FORBIDDEN_SCOPE` (its
driven Atom's `onCleanup`), then, past it, `PRIMITIVE_IN_EFFECT_CALLBACK` (its resting memo).

`createBatch`'s `settled()` and `createAnimate`'s `scope.settled()` did the same: their flights
(wardic:`flights.ts`) made their memo at the first read under their maker's owner.

**The fix** (wardic:`packages/solid/src/unstable/v2/`):
- `solid-reactivity.ts`'s `firstCallOwnerHere()`: a root under the current owner, `CLIENT_ONLY` (transparent:
  it takes no hydration id), disposed with it, made in a maker's body;
- a ward makes one at setup (`ward.tsx`, `firstCallOwner`), and what `read`, `atom`, `settled` and `tapped`
  make at their first call goes under it; what they mount (their Atoms in the registry, `followAtom`'s
  subscription) goes on a list the ward's one cleanup ends (`addCleanup`), so none calls `onCleanup` there;
- a Batch's and an animate scope's flights make one as they're made (`flights.ts`), for their memo;
- `next` and `each` make nothing Solid; `when(name)` is a memo the caller makes, documented as one to make in
  a component's body, as `createMemo` is.
- The lazy gesture watch (`watchLateGestures`) stays on the ward's owner. A `wardic.<tag>` element with no
  gesture prop makes it at its first want, which a user reaches through `wardRef`'s callback (the element's
  own ward) and a first `tapped()` in the element's ref; that ref runs under the element's rendering
  component (`dynamic()`), not the ward's owner, where an effect may be made.

`ref-accessors.browser.test.tsx` pins it, each first call in a ref, a read of a value in `untrack`:
- RA1–RA5: a ward's `read`, `atom`, `settled`, `tapped`, and `next` and `each`, in the user's ref beside the
  ward's (`ref={[card, mine]}`);
- RA6: a `wardic.div`'s own ward from `wardRef`'s callback, its `tapped()` in the element's ref;
- RA7, RA8: a Batch's `settled()` in a member's ref, and `scope.settled()` in the scope's ref.

Before each fix, RA1 failed with `CLEANUP_IN_FORBIDDEN_SCOPE`, then `PRIMITIVE_IN_EFFECT_CALLBACK`, and RA7
and RA8 with `PRIMITIVE_IN_EFFECT_CALLBACK`. Two mutations: the lifecycle back on the ward's owner fails RA3
and RA4; the gesture watch on the ward's own root fails none of RA1–RA5 (run before RA6 existed).

**What a first call after the ward is gone does:** `read(key)` still warns `RUN_WITH_DISPOSED_OWNER`, its
root disposed with the ward; `atom(key)` no longer does, since it makes nothing under an owner. Its Atom's
mount in the registry is then kept until the registry goes.

**A Batch member's presence lookup** (wardic:`create-batch.tsx`, `presenceHere`) reads no presence outside
an owner (a handler, or after an `await`, where a context read throws). Inside a ref it now has one, the
creating pass's, and finds the `<AnimatePresence>` the element is rendered under, where rc.21 found none;
reading a context there is allowed, and dom's `memberFor` makes nothing Solid. Unchanged, and not pinned: a
member's handle is made for a spread, not in a ref.

## Size

`bun run size` builds both sides with the working tree's Solid, so its gate (head against base) sees
Wardic's own change only: +0.1% on the Slim element's app, the root above. Against CI's run of `main` on
rc.21 (285d949):

| App | rc.21 (CI) | 2.0.1 |
|---|---|---|
| `s2-plain` (Solid alone) | 23.6 KB min, 9.9 gzip | 23.3, 9.9 |
| `s2-slim` | 314.5, 116.1 | 318.1, 117.6 |
| `s2-complete` | 428.3, 156.2 | 432.0, 157.5 |
| `s2-batch` (no ward) | 249.2, 93.5 | 249.1, 93.5 |
| `s2-routes` | 343.8, 129.0 | 347.5, 130.5 |

The size split's `solid-js` in `s2-slim`: 61.7 → 65.3 KB minified. `s2-slim` is 1.1 KB over its budget,
116.5, which rises to 118.0 (ADR-0067, *Note (#566)*). Which of Solid's modules grew isn't split here.

## Checked

All on 2026-11-18, the branch at its last code commit unless said:
- **Typecheck** (`bun run typecheck`: every package's source and tests, the site and every example) and
  **lint**: clean. One lint warning, `reorder.ssr.test.tsx:186`, is `main`'s.
- **Node tier** (`bun run test`): 188 files, 1,958 tests, with #320's gate on the Solid 2 projects.
- **Solid 2's browser projects:** `v2-browser` 115 files, 746 tests (before RA6–RA8); `v2-hydrate` 6 files,
  54 tests; `ref-accessors.browser.test.tsx` RA1–RA8.
- **The full browser tier** (`bun run test:browser`, local WSL): 2,889 of 2,903 tests, the 14 failing all real
  mouse drags, Reorder and Batch Reorder drags, and timeouts, in Solid 1's, dom's and Solid 2's projects alike.
  Run alone, the 7 files they're in pass, 137 of 137: the host's load, #811's kind. A first full run, made
  while files changed under it, had 23 such.
- **The storefront's Solid 2 app:** its production smoke, 61 of 61 routes; its dev smoke (`smoke:dev`, Solid's
  diagnostics bridge on, failing on what #320's gate fails on), 61 of 61. The first dev run failed `/` with
  Vite's `504 (Outdated Optimize Dep)`, its dependency cache from rc.21; the second, on a fresh one, passed.
- **`solid2-start`'s production build** served by Node: `/`, `/ssr` and `/appear` with no console error; the
  hydration report 15/15 OK, the Appear report 33/33 OK.
- **A production build's presence:** a scratch app built with `vite.solid2.ts`'s `solid2({ dev: false })`,
  `<AnimatePresence><Show>` over a `wardic.div` with an `exit`. Compiled, `<Show>` is a conditional on the
  memo, no `createComponent(Show, …)`, where the development build has one. Hidden, the element plays its
  exit over 23 frames, opacity 0.93 down to 0.00, then leaves; no console error.
- **The site:** `bun run build`, 161 pages prerendered and indexed.
- **`bun run pack:check`:** 52 of 52 steps, once `packages/solid/dist` was cleared of tsc output for modules
  the lift removed (#817).
- **The size gate:** every app within +1% of its base; `s2-slim` past its old budget, [above](#size).
- **`bench:solid --base main`** on the bench box (a9a3fef, before the review's renames and flights' owner;
  base `main` on its own dependencies, so rc.21 against 2.0.1), 11 paired reps: every gate passed on both
  bindings. Solid 2: warm mount +3.0% [−4.2% – +6.9%], retarget +1.7%, unmount +4.0%; bytes +1.2%; retained
  +0.6% (`hover + press`) and +0.4% (`reorder item`), about 0.1 KB per element. Solid 1, unchanged: mount
  −3.0%, bytes +0.2%.
- **`bench:core --base main`** on the box: Bun and Chromium, every workload passing; Node too noisy twice
  (its control +7.8%, then +25.0%), the box's load average 21.7 as it ended. This PR changes no core source.

## Not checked

- The 2.0.1 tarballs, diffed: 2.0.0's were, and 2.0.1's notes read.
- Which of Solid's modules the 1.4 KB is in.
- Solid 1's storefront and the Next storefront, whose dependencies didn't change; SolidStart 1's example.
- WebKit and Firefox.
