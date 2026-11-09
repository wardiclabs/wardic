# @wardic/foldkit (#561): Foldkit 0.170.0, its frame order, Effect 4's rules, and the binding's API

> **Read at:** 2026-11-08 (UTC) · **Sources:**
> - **Foldkit, current:** `foldkit@0.170.0`, npm's `latest`, published 2026-10-29. Its peers are `effect ~4.1.0` and `@effect/platform-browser ~4.1.0`; its one dependency is `parse5 ^8.0.1`.
>   - **The package:** `npm pack foldkit@0.170.0`, shasum `bb3a265e447c4253791853b65ae99a1f441d47e4`, extracted to `.tmp/561-foldkit/pkg/package/`.
>   - **The source:** a shallow clone of `github.com/foldkit/foldkit` at `a471adb24d750ab9e8d8312edad53ff6f26d961b` (2026-10-29, "Version Packages (#1854)"), in `.tmp/561-foldkit/repo/`. npm's dist-tag `foldkit-stable-upload-a471adb24d75` names that commit as 0.170.0's build, and its `packages/foldkit/package.json` reads `0.170.0`.
>   - **The docs:** foldkit.dev is built from the clone's `packages/website/src/page/*.md`. Read there, not fetched.
>   - **For the diff:** `foldkit@0.168.0` (published 2026-10-11), packed to `.tmp/561-foldkit/pkg-0.168.0/package/`, and the clone's `CHANGELOG.md` from 0.168.0 to 0.170.0.
>   - A canary, `0.170.0-canary.54f8bcd443b4` (2026-11-07), exists. It wasn't read.
> - **Effect:** `effect@4.1.1` as installed at `node_modules/effect/`: `dist/*.d.ts` and the shipped `src/`. And the repo's `effect-4` skill (Effect's own `AGENTS.md`, copied from 4.1.1), read whole.
> - **Wardic** at `15f723d` (branch `test/pe3-resize-event`: main plus one test commit). Read: `docs/agents/effect-first.md`, `docs/agents/pipeable.md`, `CONTEXT.md`; ADRs 0005, 0018, 0025, 0028, 0030, 0033, 0038, 0041 (every Amendment), 0042, 0043, 0045, 0062, 0067; `packages/dom/src/`; the Solid bindings' runtime, spine, presence, variant tree, layout and Feature modules; [`three-binding-semantics.md`](three-binding-semantics.md) (for format) and [`clock-and-scheduler.md`](clock-and-scheduler.md) (for the browser's frame order).
> - **Prior art:**
>   - `snabbdom@3.6.3`, packed to `.tmp/561-foldkit/snabbdom/package/`, the upstream of Foldkit's vendored fork;
>   - `mdgriffith/elm-animator`, a shallow clone at `12ca2ee` (2026-09-25, package 2.0.0), in `.tmp/561-foldkit/elm-animator/`.
>
> **Prefixes:**
> - `fk:` is the Foldkit clone's `packages/foldkit/` (so `fk:src/runtime/renderer.ts`, `fk:CHANGELOG.md`).
> - `fkweb:` is the clone's `packages/website/src/page/`, foldkit.dev's source.
> - `fkroot:` is the clone's root (`README.md`, `examples/`).
> - `fkpkg:` and `fk168:` are the `package/` folders of the 0.170.0 and 0.168.0 tarballs.
> - `fx:` is `effect@4.1.1` at `node_modules/effect/` (`fx:dist/…`, `fx:src/…`).
> - `skill:` is `.claude/skills/effect-4/SKILL.md`.
> - `wardic:` is the repo at `15f723d`.
> - `sd:` is `snabbdom@3.6.3`'s `package/`; `ea:` is elm-animator at `12ca2ee`.
>
> **Nothing was run for this note.** It's reading and design: shell reads, `npm pack`, `npm view`, `git clone` and `gh issue view 561`. No probe, build or install ran, and nothing inside the downloads was executed. Claims reasoned rather than read are marked *inferred*. Part B lists the probes that would settle them.
>
> **Where the brief and the sources differ, the sources win:**
> - there's no `CONTEXT-MAP.md` at `15f723d`; the root `CONTEXT.md` is the one glossary (`wardic:docs/agents/domain.md`, *Before exploring*);
> - Effect 4.1.1's Atoms are at `effect/reactivity`, not `effect/unstable/reactivity` (`fx:package.json:50`);
> - ADR-0025's *Amendment (#66)* (option bags decoded by Schema) is reversed by *Amendment (#511)*: the bags are checked by hand, with the same "check, then fill defaults" design (`wardic:docs/adr/0025-effect-first-core.md:508-519`);
> - `ProjectionSystem.layer` is `DomProjectionSystem.layer` since #548 (`wardic:docs/adr/0041-dom-api.md:426-436`);
> - Foldkit's helper is `Subscription.animationFrameEntry`, in 0.168.0 too (`fk168:dist/subscription/public.d.ts:3`);
> - and the issue's main premise, that a Mount can use the `resources` Layer, doesn't hold in either version (Summary 2).

Research for #561, the Foldkit binding. Its milestone is "1.2: Foldkit" (`gh issue view 561`). The issue's first step is "a probe of the frame order, then a grill on the binding's API". This note is the fact base for that grill: Foldkit as it is now (Part A), the frame order from its source (Part B), the Effect 4 rules the binding must keep (Part C), the API's options (Part D), and the questions (Part E).

## Summary

1. **Foldkit 0.170.0 is current, and little in its runtime moved since 0.168.0.**
   - It peers `effect ~4.1.0` (`fkpkg:package.json:167-170`), which Wardic's `^4.1.1` meets. 0.168.0 pinned exactly `4.0.0` (`fk168:package.json:167-170`).
   - What changed for a binding: Effect 4.1's eager `Stream.callback` and the `{ interruptible: true }` advice for Mounts (0.170); a render frame that waits while an over-budget Message drain is deferred (0.169); a patch that tolerates an element moved out of its parent (0.169). See A.1.
   - The scheduler file is byte-identical in both versions.
2. **A Mount can't reach the `resources` Layer, and couldn't in 0.168.0.**
   - `resources` is built once and handed to Flags, Commands and Subscriptions (`fk:src/runtime/resourceProvider.ts:150-184`).
   - A Mount's Stream is typed `R = never` (`fk:src/mount/index.ts:66-73`, `:507-534`). Its fiber runs on the render's captured context, which holds Foldkit's own services and no `resources` (`fk:src/html/index.ts:2500-2607`; `fk:src/runtime/renderer.ts:525-533`).
   - So "DomLive, `FlushGate.layer` and `ProjectionSystem.layer` in `resources`, Mount actions for registration" can't work as written. Foldkit's Mount docs say services "come from Foldkit `Resources`" (`fkweb:core/mount.md:97`). The source says otherwise.
3. **One Foldkit frame, from the source.**
   - `update` runs synchronously on the dispatching stack (`fk:src/runtime/messageQueue.ts:50-59`).
   - A Model change books one `requestAnimationFrame` (`fk:src/runtime/renderer.ts:731-743`).
   - Inside that callback, plain JavaScript runs: the view, the snabbdom patch, Messages buffered during the patch, then `Render.afterCommit`'s waiters, resumed inline (`renderer.ts:548-592`; `fx:src/internal/effect.ts:1205-1211`).
   - Wardic's Measure pass is a `queueMicrotask` at the end of the task that triggered it (ADR-0018; `wardic:packages/core/src/Microtask.ts:21-38`). A trigger fired inside the patch therefore runs its pass after the patch and before paint, in the same frame (*inferred*; P1).
4. **Wardic's two moments.**
   - **After the patch, before paint:** there are public ways (the end-of-task pass, `Render.afterCommit`, a `MutationObserver`).
   - **Before the DOM changes:** no public hook. Wardic doesn't need one by default, since its "before" is the retained Measurement (ADR-0005).
   - **For a Declared layout change,** two moments exist:
     - a Command, which starts a microtask after `update`, before the frame's patch (`fk:src/runtime/runtime.ts:658-716`);
     - or a props write on a root element at the very start of each patch (B.2).
5. **Layout motion from a Foldkit render probably holds one frame.** The patch runs inside a rAF callback, so its origin paints in that frame and the first step in the next (ADR-0018's "after the frame's tick" case). That comes on top of Foldkit's own wait for the next frame (*inferred*; P1).
6. **No public hook sees an element re-render.**
   - Mount args are captured at insert: "a reused DOM node does not run `execute` again" (`fkweb:core/mount.md:103-109`).
   - Props that change per render need a channel. The candidates:
     - `h.Prop`, which the props module writes only when its reference changes (`fk:src/propsModule.ts:151-174`), to an own accessor the element's Mount installs;
     - a snabbdom hook added to the built vnode (internal);
     - a custom element.
7. **Removal is synchronous inside the patch.**
   - First the `destroy` hooks run: a Mount's fiber is interrupted inline, so a release with no async step finishes there.
   - Then the element is removed (`fk:src/snabbdom/init.ts:449-491`; `fk:src/html/index.ts:2543-2555`).
   - The fork keeps snabbdom's `remove` hook (`fk:src/snabbdom/hooks.ts:12`), but no attribute sets it.
   - Exits need one of: a re-insert before paint (as Solid's presence does), a presence the Model drives (Foldkit UI's pattern, `fkweb:ui/animationPage.md:13-19`), or an injected hook.
8. **Nothing passes down implicitly.**
   - Foldkit has no context: a parent passes `viewInputs` or `childAttributes` explicitly (`fkweb:core/submodel.md:137-160`, `:351-386`).
   - Variants down the tree need either DOM ancestry at mount, as dom's projection tree already uses, with explicit names for server HTML, or explicit child builders.
9. **Effect 4 and Foldkit pull apart at six seams** (Part C, T1–T6):
   - a Mount's `R = never`;
   - Schema everywhere in Foldkit, and none in Wardic's `src` (#511);
   - one Model as the only state, where Wardic keeps per-frame state in its runtime;
   - any defect reaching a Command or Subscription paints the crash view (`fk:src/runtime/renderer.ts:300-335`), where Wardic contains a bad option per animation;
   - no public update, remove or commit hook;
   - a Scene test must resolve every `OnMount` (`fkweb:testingScene.md:219-231`).
10. **The largest piece of work isn't Foldkit's.**
    - Wardic's spine and every Solid-free module (presence, variant tree, drag track, Features) live in `@wardic/solid`, unexported and behind a required `solid-js` peer (`wardic:packages/solid/package.json:41-83`).
    - A Foldkit binding needs them lifted into a framework-free package first, the canvas note's step 1.
11. **A shape to grill** (Part E has the options):
    - a provider element whose Mount builds Wardic's Layer into its own Scope;
    - `w = Wardic.html(h)` builders with Motion's props as PascalCase attributes;
    - props through `h.Prop` to an accessor, compared by `sameResolution` (#470);
    - variants and presence through DOM ancestry, a presence re-inserting its leavers from a `MutationObserver`;
    - Commands that find their target by element id after `Render.afterCommit`, Foldkit's own idiom for DOM work (`fk:src/mount/index.ts:318-321`);
    - and four asks to Foldkit (D.11).
12. **Probes P1–P13** (B.4) and **grill questions Q1–Q20** (Part E).

## Part A: Foldkit, as of 0.170.0

### A.1 What changed from 0.168.0 to 0.170.0

- **0.170.0** (`fk:CHANGELOG.md:3-19`):
  - Effect 4.1. Peers `~4.1.0` take 4.1 patch releases.
  - "Effect 4.1 starts `Stream.callback` setup immediately." For asynchronous Mount acquisition that must stop on unmount, pass `{ interruptible: true }` to `Effect.acquireRelease` (`:15`).
- **0.169.0** (`:21-50`):
  - `Lazy.expectAllReused` in `foldkit/test`.
  - `Transition.match` for routes.
  - The patch tolerates an element a Mount moved out of its parent, a portaled panel (#1548, `:37`).
  - A render frame waits while an over-budget Message drain is deferred to a later task, so controlled inputs don't lose characters (#1702, `:43`).
  - `postdestroy` keeps a Submodel's boundary through its subtree's destroy hooks (#1549, `:49`).
- **0.168.0:** a rebuild only (`:51-55`).
- **In `dist`, 53 files differ** (`diff -rq`), and few of them touch a binding:
  - `runtime/renderer.js` gained only `isAnyMessageDeferred` and the frame re-request (`fk:src/runtime/renderer.ts:535-538`, `:640-646`, `:678-683`);
  - `snabbdom/init.js` gained `isChildOf` and its reference rules (`fk:src/snabbdom/init.ts:320-380`), and `postdestroy` (`:445`);
  - `mount/index.d.ts` changed only its docs (`fk:src/mount/index.ts:223-249`);
  - `runtime/browserScheduler.js` is identical.

### A.2 The program and its types

- **A program** is `makeApplication` or `makeElement` (`fk:src/runtime/runtime.ts:79-224`). Its parts:
  - `Model`, a `Schema.Codec` (`:91`);
  - `init` and `update`, which return `{ model, commands? }` (`:95-102`; `fkroot:README.md:66-99`, its counter);
  - `view: (model, h) => Document` (`:103`);
  - `subscriptions`, `resources`, `managedResources`, `viewTransition`, `crash`, `slow` and `devTools` (`:113-223`).
- **Messages are Schema `TaggedStruct`s,** callable as constructors (`fk:src/schema/index.ts:3-15`), defined with `defineMessageUnion` (`fk:src/message/index.ts:1`).
- **The Model must round-trip through JSON** for development reloads: `Schema.toCodecJson(Model)` (`runtime.ts:450-455`).
- **In development, the Model is deep-frozen** after `init` and every `update` (`:153-165`, `:352-362`). A mutable Wardic record in the Model would throw at its first write (*inferred*).
- **Foldkit's own code style** uses ternaries, `for` loops and `undefined` checks. Wardic's rules bind the binding's code, not Foldkit's.

### A.3 The runtime

- **Start.**
  - `Runtime.run` and `hydrate` go through `BrowserRuntime.runMain` (`fk:src/runtime/start.ts:86-104`).
  - `embed` returns a handle whose `dispose` interrupts the runtime fiber (`:211-287`).
  - All three wrap the program in `provideBrowserScheduler` (`:94`, `:269`).
- **The scheduler.**
  - It's `new Scheduler.MixedScheduler('async', microtaskSetImmediate)`, provided as `Layer.succeed(Scheduler.Scheduler, …)` (`fk:src/runtime/browserScheduler.ts:12-30`).
  - Its comment: "Dispatch no longer routes through the Effect scheduler, but Command and Subscription fibers still do" (`:3-11`).
- **Messages.**
  - `enqueueMessage` drains on the spot, so `update` runs on the dispatching stack. During a render frame, Messages only buffer (`fk:src/runtime/messageQueue.ts:50-59`).
  - Past a 5 ms budget a drain hands off to a `MessageChannel` task (`:5`, `:82-92`).
  - The Model is plain closure state (`runtime.ts:611-615`).
  - A change publishes the Model and calls `scheduleRenderFrame()` (`:742-750`).
- **Commands.**
  - Each is forked one microtask after `update`, with `Effect.runForkWith(runtimeContext)(Effect.forkIn(runtimeScope)(…))`, wrapped in a span named for the Command and given every resource (`runtime.ts:658-716`).
  - A failure of its Effect goes to `crashWith` (`:711`).
- **Subscriptions.**
  - They fork after the init render (`:809-820`).
  - A Subscription restarts when its dependencies change under `Schema.toEquivalence(dependenciesSchema)` (`fk:src/runtime/subscriptionFibers.ts:66-71`).
- **`resources`** is "built once, the first time it is needed": Flags at startup, else Subscriptions, else the first Command (`runtime.ts:182-214`; `fkweb:core/resources.md:13`).
  - It's one `Effect.cached(Effect.uninterruptible(Layer.buildWithScope(resourceLayer, runtimeScope)))` (`fk:src/runtime/resourceProvider.ts:79-103`).
  - `provideAllResources` hands it to Commands and Subscriptions (`:150-184`).
  - Its type is `Layer.Layer<Resources>`: no error, no input (`runtime.ts:214`).
- **`ManagedResources`**: handles whose lifetime follows a Model condition, operated by Commands (`runtime.ts:215-222`; `fkweb:core/mount.md:37`).
- **The runtime's context** is captured once with `Effect.context<never>()` (`runtime.ts:617-620`).
  - It's inside `provideBrowserScheduler`, with `RenderCommit` and `DialogRuntime` provided (`:892-902`).
  - Commands and Mounts fork on it. It holds no `resources`.
- **Teardown order** (`fk:src/runtime/renderer.ts:264-298`; `runtime.ts:831-846`):
  - The renderer registers its teardown patch, "patching to an empty tree fires snabbdom destroy hooks", before the perpetual fibers fork. Scope finalizers run last-registered first.
  - `resources`, built later, is therefore released before that teardown patch runs (*inferred* from the order).

### A.4 The renderer and the patch

- **The frame is a plain rAF callback.** "Render frames run as plain JavaScript inside the requestAnimationFrame callback. Messages arriving between frames mark at most one pending frame" (`renderer.ts:727-743`; `runtime.ts:885-890`).
- **`renderFramePlain`** (`renderer.ts:678-725`), in order:
  1. while a deferred drain waits, re-request the frame (0.169);
  2. bail on a disposed, crashed or DevTools-paused runtime, settling the commit notifier;
  3. reset the drain budget;
  4. run the body plainly, or inside `document.startViewTransition` when `viewTransition` says so.
- **`runRenderFrameBody`** (`:548-592`), in order:
  1. sets `isRenderingFrame`;
  2. `renderSync`: the view (`:396-409`), then the patch (`:427-463`);
  3. `attachRenderedMounts`;
  4. `drainPendingMessages()`, for Messages dispatched during the patch (OnUnmount, Mount emissions);
  5. `settlePendingCommit()`, last, "so a waiter resumed by the commit observes the same DOM".
- **`Render.afterCommit`** (`fk:src/render/render.ts:137-144`):
  - it waits on the runtime's `RenderCommit` when a patch is pending, else on one rAF (`:87-107`);
  - `RenderCommit` is `@internal` (`fk:src/render/commit.ts:5-27`); `foldkit/render` exports only `afterCommit` and `afterPaint` (`fk:src/render/public.ts:1`);
  - `afterPaint` is the commit and then one more frame (`render.ts:159-162`).
- **The vendored snabbdom** is v3.6.3 with two identity axes, a stricter keyed path, a duplicate-key warning and a `postdestroy` hook (`fk:src/snabbdom/README.md:38-60`).
  - Its modules are fixed in `vdom.ts`: attributes, class, dataset, event listeners, onUnmount, props, style, in that order (`fk:src/vdom.ts:27-35`).
  - Nothing adds a module or a `pre`/`post` hook from outside.
- **Hook order in one patch** (`fk:src/snabbdom/init.ts`):
  - **A new element** (`createElm`, `:194-275`):
    - `init` first, with no element;
    - then the element is created and every module's `create` runs, `h.Prop` and `h.Style` included;
    - then its children are created;
    - then its own `create`, and its `insert` is queued. A child's `insert` is queued before its parent's.
  - **A kept element** (`patchVnode`, `:736-812`): `prepatch`, then each module's `update`, then the element's `update`, then its children, then `postpatch`.
  - **`patch`** (`:814-871`): `pre` module hooks; the root's patch; then every queued `insert`, in queue order, once the new tree is installed; then `post` module hooks.
  - An `oldVnode === vnode` short-circuit skips a lazy cache hit's whole subtree, with no hook at all (`:740-742`).

### A.5 Views

- **The builder.** `HtmlBuilder<Message>` holds every element and attribute factory, plus `keyed` and `submodel` (`fk:src/html/index.ts:5547-5556`).
  - It's one process-wide object, retyped per frame. That keeps it `===`-stable for `createLazy`'s arguments (`:5558-5588`).
  - An element is `h.div(attributes, children)`: `children` are `Html | string`, and `Html = VNode | null` (`:215-216`, `:3216-3232`).
  - `h.keyed('li')(key, attributes, children)` sets the snabbdom key (`:3255-3266`).
- **Attributes** are one `Data.TaggedEnum`, typed by `Message` (`:589-981`). For a binding these matter:
  - `Style: { value: Record<string, string> }`. Its handler replaces `data.style` (`setModuleData`, `:1334-1342`, `:2333-2339`), so a second `h.Style` on one element replaces the first.
  - `h.Style` with a raw `h.Attribute('style', …)` throws (`:2953-2966`).
  - `Prop: { key, value: unknown }`, a client-only DOM property (`:971`, `:2486-2487`, `:1384-1391`).
  - `OnCustomEvent`, whose `f` returns `Option<Message>` (`:972-975`).
  - `OnMount: { action: MountAction }` and `OnUnmount: { message }` (`:976-981`).
  - Handlers either take a Message value (`OnClick`) or a function to one (`OnInput: f`).
  - `OnPointerDown`'s `f` receives the pointer's fields (type, button, coordinates, `pointerId`, target), not the event (`:625-637`).
- **The props module.**
  - It runs on `create` and `update` and writes `element[key] = value` only when the value changes by reference (`fk:src/propsModule.ts:151-174`, `:234-237`), through `writeProperty` (`:19-32`).
  - The docs say the same of custom-element properties: "Foldkit only writes a property again when its value changes across renders" (`fkweb:core/customElement.md:35`).
- **The style module** writes each key whose value differs from the *old vnode's*, and removes keys the new vnode dropped (`fk:src/snabbdom/style.ts:72-122`).
  - So a key Wardic draws keeps its value until the view changes or drops that key.
- **Memoization:** `createLazy` and `createKeyedLazy` compare arguments with `!==` (`fk:src/html/lazy.ts:63-76`).
- **Custom elements:** `CustomElement.define` gives a typed builder. Properties become PascalCase factories, events `On{PascalCase}`, bound with `.withMessage(h)` (`fkweb:core/customElement.md:7`, `:25`, `:35`).

### A.6 Mount

- **The shape.**

  ```ts
  type MountAction<Message, E = never> = Readonly<{
    name: string
    args?: Record<string, unknown>
    f: (element: Element, viewStateChanges: Stream.Stream<ViewState>) => Stream.Stream<Message, E>
  }>
  ```

  (`fk:src/mount/index.ts:66-73`). `Mount.define` takes `execute: (input) => Effect<Message, never, Scope>`, with `args` as Schema fields and at least one result Message Schema (`:333-360`). `Mount.defineStream` returns `Stream<Message, never, never>` (`:507-534`).
- **When it runs** (`fk:src/html/index.ts:2500-2608`):
  - the `insert` hook acquires it: `Effect.runForkWith(capturedContext)(acquire)` starts a root fiber, inline;
  - `acquire` runs `Stream.runForEach(action.f(element, viewStateChanges), dispatch)`;
  - a failure is only `console.error`ed (`:2589-2594`);
  - `destroy` runs `Effect.runFork(Fiber.interrupt(state.fiber))`.
  - Effect interrupts a parked fiber inline, on the caller's stack (`fx:src/internal/effect.ts:606-611`). So a release with no asynchronous step finishes inside `destroy`, before the element is removed, which 0.170's docs now say (`fk:src/mount/index.ts:241-249`).
- **Its context:** `capturedContext` is the render's: the runtime's context plus `Dispatch`, `MountTracker` and `MountRuntime` (`fk:src/runtime/renderer.ts:525-533`). It has Foldkit's scheduler and `RenderCommit`, and no `resources`.
- **Its Scope** is the Stream's, open for the element's whole lifetime, "even after the Effect completes" (`fk:src/mount/index.ts:223-229`). Acquisition is uninterruptible unless `{ interruptible: true }` is passed (`:226-229`).
- **Its rules:**
  - **One Mount per element:** a second `OnMount` silently replaces the first (`fkweb:core/mount.md:69-73`). The handler keeps the old `destroy`, but replaces `insert` and `postpatch` (`fk:src/html/index.ts:2522-2556`).
  - **Args are captured at insert.** "OnMount only binds to snabbdom's insert and destroy hooks; there is no update hook in between." A Model change that should drive DOM work is a Command from `update` (`fk:src/mount/index.ts:310-331`; `fkweb:core/mount.md:103-109`).
  - **DOM node lifetime:** a reused node keeps its Mount; a replaced one restarts it (`fkweb:core/mount.md:51-55`).
  - **`viewStateChanges`** is `Live | Paused` (DevTools time travel). The Stream starts with the state at acquisition (`fk:src/mount/index.ts:208-221`). Mounts acquired by a replay can't dispatch (`:52-61`).
- **In tests:** a Scene keeps every `OnMount` in the view pending until the test resolves it. An interaction throws while one is unresolved (`fkweb:testingScene.md:219-231`). Scene finds them by a marker the `OnMount` handler stamps on the vnode (`fk:src/test/scene.ts:306`; `fk:src/html/index.ts:2512-2521`).

### A.7 Removal, and what can delay it

- **`removeVnodes`** (`fk:src/snabbdom/init.ts:449-491`), for each removed child:
  1. `invokeDestroyHook`: the child's own `destroy`, then the modules' `destroy`, then its children's, then `postdestroy` (`:408-447`);
  2. then every `remove` module hook and the vnode's own `remove` hook, given a callback;
  3. the element is removed once every callback has been called (`:183-192`).
  - With no `remove` hook, the callback runs at once.
- **The style module's `remove`** delays removal until the transitions on `style.remove`'s keys end (`fk:src/snabbdom/style.ts:135-170`). `h.Style` takes `Record<string, string>`, so nothing public sets `style.remove` (`fk:src/html/index.ts:879`).
- **No public attribute sets `data.hook.remove`** (grep: only the style module defines one). Upstream snabbdom documents `remove` for exactly this: "use `remove` to trigger an animation when an element is being removed" (`sd:README.md:355-366`, `:388-389`).
- **Foldkit's own exit pattern** is in the Model.
  - Foldkit UI's `Animation` keeps the element rendered with `data-closed` during its leave. A Command waits for the element's Web Animations to settle, and then the parent's `update` removes it (`fkweb:ui/animationPage.md:13-19`, `:32-56`).
  - Dialog, Menu, Popover, Listbox and Combobox use it (`:5-7`).
- **0.169's patch tolerance** (`fk:src/snabbdom/init.ts:320-380`, `isChildOf`): an element no longer in its parent isn't used as an `insertBefore` reference, and a reorder doesn't pull it back. That's for portals. A leaver the binding re-inserts sits in the parent unknown to the vnode tree, and later inserts use the reference rules (*inferred*; P8).

### A.8 Passing things down

- **No context.** A Submodel gets the parent's render-time data through `viewInputs` (`fkweb:core/submodel.md:137-160`) and parent state for `update` through an explicit `context` argument (`:209-236`).
- **`childAttributes`** brands a child's attribute bundle with its dispatcher, so a parent can spread it (`:351-386`).
- **Element identity in a list** comes from `h.keyed` and Foldkit's `identity` axis (`fk:src/snabbdom/README.md:7-30`).

### A.9 `viewTransition`

- **The predicate** decides per render, with `previousModel` and `model` (`fk:src/runtime/runtime.ts:133-152`).
- **When it says yes,** the frame's body runs inside `startViewTransition`'s update callback, which the browser calls later (`fk:src/runtime/renderer.ts:604-672`).
- **It's skipped** under `prefers-reduced-motion: reduce`, during replay, crash and the initial render (`fkweb:core/viewTransitions.md:39-47`). A later qualifying render skips a running transition (`:51-53`).
- **Shared elements** pair by `viewTransitionName` in `h.Style` (`:31-37`).

### A.10 Server rendering, hydration, DevTools

- **Server rendering** (`foldkit/experimental/server`) and `Runtime.hydrate` are experimental (`fk:src/runtime/start.ts:150-184`).
  - Hydration defers every `insert` hook until the DOM is adopted, then runs them (`fk:src/hydrate.ts:997-1021`), so Mounts start on a hydrated page too.
  - `h.Prop` is client-only (`fk:src/html/index.ts:1384-1391`). `h.Style` is serialized.
- **DevTools time travel** paints historical Models with no-op dispatch. Mounts see `Paused` (A.6). "Time-travel never animates" for View Transitions (`fk:src/runtime/renderer.ts:808-812`).
- **Story tests** run `update` only. **Scene tests** walk vnodes, and "snabbdom hooks never fire in their VNode-only environment" (`fk:src/mount/index.ts:12-17`).

### A.11 Foldkit's animation story today

- **`Subscription.animationFrameEntry`:** a Message every frame while `isActive`, with the delta (`fk:src/subscription/animationFrame.ts:17-78`). This is what the canvas guide recommends: `update` advances the Model, the view derives shapes, one patch a frame (`fkweb:core/canvas.md:23`; `fkweb:core/subscriptions.md:87-101`).
- **CSS through data attributes,** with Model-driven enter and leave (A.7).
- **The View Transitions API** (A.9).
- **`Dom.waitForAnimationSettled`** (`fkweb:core/dom.md:39`).
- None keeps per-frame state out of `update` except CSS. Wardic would be the first runtime-driven engine there.

### A.12 #561's 0.168.0 facts, re-verified

| The issue's fact (0.168.0) | At 0.170.0 | Evidence |
|---|---|---|
| `resources` for `DomLive`, `FlushGate.layer`, `ProjectionSystem.layer`, unchanged | **Changed.** It reaches Flags, Commands and Subscriptions, not Mounts. Not so in 0.168.0 either (`fk168:dist/html/index.js:949`, `:1031`). The engine's Layer is `DomProjectionSystem.layer` (#548). `FlushGate.layer` takes `{ batch }`. | A.3, A.6; `wardic:packages/dom/src/FlushGate.ts:58`; `wardic:packages/dom/src/DomProjectionSystem.ts:43` |
| Mount actions `(element, viewStateChanges) => Stream<Message>` for registration, their Scope unregistering | **Kept**, with more rules: `R = never`; uninterruptible acquisition unless asked; a sync release finishes in `destroy`; args captured at insert; one Mount per element; every Mount pending in a Scene test. | A.6 |
| Messages for callbacks | **Kept.** A Mount's Stream emissions dispatch. Emitted through a `Queue`, they reach `update` a microtask later (B.1). | `fk:src/html/index.ts:2586-2588`; `fx:src/Queue.ts:804-822` |
| Commands for `animateLayout` | **Kept,** but a Command needs Wardic's services (Q2). It starts before the frame's patch. | `fk:src/runtime/runtime.ts:658-716` |
| `Render.afterCommit` for reads after a patch | **Kept.** It resumes inline in the rAF callback, after the patch and the drain; `afterPaint` adds a frame. | `fk:src/render/render.ts:87-162` |
| Don't drive animation through `Subscription.animationFrame` | **Kept.** The name is `animationFrameEntry`, in both versions. | `fk:src/subscription/animationFrame.ts:66` |
| Don't combine `viewTransition` with a `layoutId` handover on one element | **Kept, and wider:** any Wardic layout change in a transitioned render (*inferred*; P10). | A.9 |
| Foldkit installs `MixedScheduler('async', queueMicrotask…)` | **Kept**, byte-identical, provided as a `Scheduler.Scheduler` Layer over the whole program. | `fk:src/runtime/browserScheduler.ts:12-30` |
| dom's runner keeps a host's async scheduler (#208) | **Kept.** | `wardic:packages/dom/src/internal/runner.ts:43-64` |
| The renderer patches inside its own rAF; no public hook around the patch | **Kept.** 0.169 adds a frame that waits while a drain is deferred. The render was already plain JavaScript in 0.168.0. | A.4; `diff` of `renderer.js` |
| The Measure pass must run after that patch, before paint, same frame | **Kept** as the requirement. ADR-0018's end-of-task microtask meets it for any trigger fired in the patch (*inferred*; P1). | B.1 |

## Part B: The frame order

### B.1 One Message, one frame, from the source

From a click to the paint. A step marked *inferred* follows from the sources but needs a probe.

**The event's task:**
1. **The listener dispatches.**
   - A Foldkit handler calls `dispatchSync` → `enqueueMessage` → drain → `update`, synchronously, on the event's stack (`fk:src/runtime/messageQueue.ts:50-59`; `fk:src/runtime/runtime.ts:718-750`).
   - **Scheduler:** none. Plain JavaScript.
2. **A Model change books the frame:** `markCommitPending()` and `requestAnimationFrame(renderFramePlain)`, once per frame (`fk:src/runtime/renderer.ts:731-743`).
3. **The Commands' microtask:**
   - each Command is forked in a `queueMicrotask` (`runtime.ts:680`);
   - `runForkWith` evaluates inline; `forkIn` forks without `startImmediately`, so the child is scheduled on the parent's dispatcher (`fx:src/internal/effect.ts:5697-5711`, `:5602-5606`, `:5745-5756`), Foldkit's microtask scheduler;
   - so a Command's Effect starts in this task's microtask checkpoint, **before the frame's patch**. It sees the pre-patch DOM (*inferred*: two microtask hops, no task boundary).
   - A Command that `yield*`s `Render.afterCommit` registers on the commit notifier and parks (`fk:src/render/render.ts:99-107`).

**Frame N, the rendering task:**

4. **rAF callbacks run in the order they were requested,** each followed by a microtask checkpoint, before style, layout and paint (`wardic:docs/research/clock-and-scheduler.md:916-926`).
   - **If Wardic is ticking,** its Clock requested this frame during frame N−1's callback, so its tick runs before Foldkit's frame. The tick's end flushes the gate (`afterTick`, ADR-0033) (*inferred* from request order).
   - **If Wardic is idle,** there's no Wardic callback in frame N.
5. **Foldkit's frame** (`renderer.ts:678-725`, `:548-592`):
   - **The view runs:** pure, `h` builders.
   - **The patch runs** (A.4):
     - root `prepatch`, then module updates: `h.Prop` writes and `h.Style` writes for kept elements;
     - children: new elements are created with their props and style; removed ones run `destroy`, where a Mount's release runs inline, then are removed;
     - then every queued `insert`, children first. Each `OnMount` starts its fiber inline (`fk:src/html/index.ts:2600`), and its `Stream.callback` setup runs at once in Effect 4.1 (`fk:CHANGELOG.md:15`).
   - **Then `drainPendingMessages()`:** Messages the patch dispatched run `update` now. A dirty Model books frame N+1.
   - **Then `settlePendingCommit()`:** every `Render.afterCommit` waiter resumes inline. `Effect.callback`'s `resume` runs `fiber.evaluate` on the resumer's stack once the fiber has yielded (`fx:src/internal/effect.ts:1205-1211`). A Command's or Mount's code after `afterCommit` runs here, inside the rAF callback, after the patch (*inferred*; P3).
6. **The microtask checkpoint after Foldkit's callback:**
   - **Wardic's Measure pass** runs if anything in step 5 triggered one: a node registering at `insert`, or `notify()`. It's `Microtask.next`, a plain `queueMicrotask` that resumes inline, the same under any scheduler (`wardic:packages/core/src/Microtask.ts:21-38`).
   - It resets transforms, reads every box, seeds FLIPs and applies its own writes at once (`flushPass`) (CONTEXT.md, **Measure pass**; ADR-0018 decisions 1–2).
   - **Mount Stream emissions:** a Message offered with `Queue.offerUnsafe` releases the taker through the queue's dispatcher (`fx:src/Queue.ts:804-822`, `:2481-2490`), the Mount fiber's microtask scheduler. So `update` runs here, after the tick or patch that emitted it, and its render goes to frame N+1 (*inferred*; P7).
   - **A `MutationObserver`'s callback** (a browser microtask by the DOM Standard; not re-read for this note) lands here too, queued at the patch's first mutation.
7. **Other rAF callbacks,** requested after Foldkit's.
8. **Style and layout.** `ResizeObserver` delivery loops here: a Wardic observer trigger runs its pass in that callback's checkpoint, still before paint (`wardic:docs/research/clock-and-scheduler.md:908`).
9. **Paint.**

**Frame N+1:** Wardic's tick takes the seeded nodes' first step, painted in that frame (ADR-0033).

**Two variants:**
- **Under `viewTransition`,** step 5's body runs inside the transition's update callback, a task after the browser's snapshot (`renderer.ts:634-663`). Wardic's pass runs in that callback's checkpoint, and the transition's new snapshot is taken with Wardic's origin projection drawn (*inferred*; P10).
- **Over budget,** a deferred drain makes `renderFramePlain` re-request the frame and leave the commit pending. The patch moves to a later frame, and `afterCommit` waits with it (`renderer.ts:678-683`).

### B.2 Where Wardic's two moments can go

**Its "before": a Measurement before the DOM changes.**
- **Wardic doesn't need one by default.**
  - A pass's "before" is each node's retained Measurement, the box the last pass read (ADR-0005; CONTEXT.md, **Measure pass**).
  - What a Foldkit binding needs is a *trigger* after every patch that moves a node. ADR-0005 *Amendment (#3)* says the trade is "trigger coverage, not timing" (`wardic:docs/adr/0005-binding-orchestration-spine.md:39-44`).
- **For a Declared layout change** (ADR-0038), the options:
  - **Public, before the frame:** a Command.
    - It starts before the patch (B.1 step 3). It can call `projection.animateLayout(constVoid)`: a slot-only refresh of every node's Measurement, nothing started (`wardic:packages/dom/src/internal/projection.ts:4325-4376`).
    - Then it `yield*`s `Render.afterCommit` and calls `notify()`, so the pass after the patch animates from the refreshed boxes (*inferred*; P5).
    - **Its gap:** anything between the Command's microtask and the frame isn't covered, as ADR-0038's boundary says "from this call on" (`wardic:docs/adr/0038-declared-layout-change.md:31-35`).
  - **Public behaviour, used unusually: a root element's props write.**
    - In `patchVnode`, a kept element's module `update`s run before its children are patched (`fk:src/snabbdom/init.ts:743-777`), and `propsModule` writes a changed `h.Prop` with a plain assignment (`fk:src/propsModule.ts:151-174`).
    - So a provider element at the top of the view that renders a fresh `h.Prop` object each render, and whose Mount installed an own accessor for that key, gets a call at the start of every patch, before any descendant changes.
    - **Its limit:** the root's own attributes, class and dataset modules run before the props module (`fk:src/vdom.ts:27-35`).
    - It's tree-wide and pre-mutation: React's `getSnapshotBeforeUpdate` moment, which ADR-0005 says Solid lacks (`wardic:docs/adr/0005-binding-orchestration-spine.md:35-38`) (*inferred*; P6).
  - **Internal:** snabbdom's `pre` module hook (the module list is fixed), or a `prepatch` set on the built vnode.
  - **None:** no `Render.beforeCommit`.

**Its "after": a Measure pass after the patch, before paint.**
- **Public:**
  - any trigger fired during the patch: registration at `insert`, a `notify()` from a props accessor. The pass runs in step 6;
  - code after `Render.afterCommit` in a Command, a Subscription or a Mount fiber (step 5);
  - a `MutationObserver` on a container, delivered in step 6.
- **Internal:** `postpatch` and `post`; `RenderCommit.onNextCommit`, an `@internal` service that sits in every Mount's context (`fk:src/render/commit.ts:5-27`).
- **None:** a public signal for every commit. `afterCommit` falls back to one rAF when nothing is pending (`fk:src/render/render.ts:99-106`), so a loop on it would run every frame of an idle page (*inferred*).

### B.3 Held frames (*inferred*)

- **ADR-0018's rule:** a layout change made in an ordinary task moves on its first painted frame (0 held). One made after the frame's tick paints its origin and moves on the next (1 held), cold or warm (`wardic:docs/adr/0018-end-of-task-measure-pass.md:96`).
- **A Foldkit patch is always inside a rAF callback.**
  - **Warm:** the tick ran first (B.1 step 4), so it's the second case: 1 held.
  - **Cold:** the pass starts the loop's burst inline (ADR-0018 *Amendment (#75)*). The Clock's first frame request is made inside a rAF callback, so it books frame N+1: also 1 held.
- **Against Solid:** a click's DOM change happens in the click's task, before any frame (0 held). In Foldkit the change itself waits for frame N, then moves at N+1.
- **A Retarget** made in the patch, through the props channel, is a gate write outside a tick. That keeps the gate's own frame request (CONTEXT.md, **Flush gate**), so it's drawn at N+1.

### B.4 Probes for the first step

Each one in a real browser, with a `foldkit@0.170.0` app and Wardic at head, frame-logged as the layout lab logs:

- **P1, the frame order.** Log, per frame: Wardic's Clock callback, `renderFramePlain`'s start and end, the Measure pass, `afterCommit` resumptions, and the paint (`requestAnimationFrame` plus a following `MessageChannel` post as its marker). Do it for a click-dispatched Message that moves a `layout` element, cold and warm.
  - **Expected:** warm, tick → patch → pass → paint; first step at N+1 (1 held). Cold, patch → pass → paint; first step at N+1.
- **P2, registration inside the patch.** A new Wardic element's Mount registers with the gate and the projection system inside the `insert` loop. Its first pass runs before paint, and no frame shows it without its Starting style or projection.
  - Repeat with a provider whose `insert` comes after its children's (children first, A.4), the children awaiting the provider's `Deferred`.
  - **Expected:** every registration done before the checkpoint, since `Deferred.doneUnsafe` resumes waiters inline (`wardic:docs/research/clock-and-scheduler.md:437`).
- **P3, `afterCommit`'s resumption.** A Command waiting on `Render.afterCommit` reads `getBoundingClientRect` and logs which callback it ran in.
  - **Expected:** inside Foldkit's rAF callback, after the patch and the drain, before the Measure pass's microtask.
- **P4, release timing at removal.** A Mount's sync release reads `element.isConnected` and its box.
  - **Expected:** connected, with its pre-removal box. An `Effect.sleep(0)` release runs after removal.
- **P5, a Declared layout change through a Command.** `animateLayout(constVoid)` in a Command returned with the Message that reorders a keyed list, then `Render.afterCommit`, then `notify()`.
  - **Expected:** items animate from their pre-patch boxes. Compare with P6's moment and with no Command (the items jump).
- **P6, the props channel.** An own accessor installed at `insert` receives each later `h.Prop` write during the patch.
  - Log its order against the element's children's patch and its siblings'. Check that the same reference writes nothing, and that DevTools replay writes the historical value.
  - **Expected:** one call per render that builds a fresh value, before the element's children are patched.
- **P7, a callback's Message.** A Message offered from Wardic's tick through a Mount's `Queue`.
  - **Expected:** `update` runs in that frame's microtask checkpoint, not inside the tick; its patch lands in N+1.
- **P8, presence.** A leaver re-inserted from a `MutationObserver` callback, against one kept by an injected `remove` hook.
  - **Expected:** no frame paints it missing. A later patch that inserts a sibling places it right (0.169's rules); a keyed reorder leaves it where the controller put it.
- **P9, the scheduler.** Wardic's Layers built in a Mount and in `resources` (inside a Command fiber): a gate or engine fork that yields resumes on a microtask (#208's RN3 shape).
  - **Expected:** microtask in both, since both contexts carry Foldkit's scheduler.
- **P10, `viewTransition`.** A transitioned render with a `layoutId` handover and a plain `layout` move.
  - **Expected (inferred):** the new snapshot captures the origin projection, and the morph and Wardic's FLIP run on top of each other.
- **P11, the deferred drain.** A burst over 5 ms: the frame re-requests itself, and no pass runs for a patch that hasn't happened.
- **P12, teardown order.** `embed`'s `dispose`, with Wardic's Layer in a provider Mount and in `resources`. Check that every child's unregister after the gate or engine closed is a no-op, with nothing written after it.
  - **Expected (inferred):** destroy hooks run parent first (A.7), so the provider's Scope closes before its children's. And `resources` is released before the teardown patch (A.3).
- **P13, the cost of a pass every render.** A `notify()` on every Foldkit render, at 50 and 1,000 layout nodes, with a pre-patch tree-wide Measurement and without.
  - **The reference:** ADR-0018 measured 0.4–0.8 ms a pass at 50 nodes and 6–10 ms at 1,000 (`wardic:docs/adr/0018-end-of-task-measure-pass.md:39`).

## Part C: Effect 4 semantics the binding must follow

Each item gives: **the rule** (Effect 4); **Foldkit**; **Wardic today**; **the binding**.

**C1. Services: `Context.Service`, and `Context.Reference` for a value with a default.**
- **Rule:** a service is a class extending `Context.Service`, its implementation in a Layer (`skill:140-184`; `fx:dist/Context.d.ts:196`). A Reference has a default value (`skill:188`; `fx:dist/Context.d.ts:395`, `:1741`).
- **Foldkit:**
  - its own services are `Context.Service`s (`MountTracker`, `MountRuntime`, `RenderCommit`, `Dispatch`, `DialogRuntime`; `fk:src/mount/index.ts:18-41`; `fk:src/render/commit.ts:21-27`);
  - two internal References (`__CurrentPortChannels`, `__CurrentRegistry`; `fk:src/port/port.ts:125`, `fk:src/command/interruptible/interruptible.ts:93`);
  - an app's services go in `resources`.
- **Wardic today:** dom's services are `Context.Service`s with Layers (`FlushGate`, `ProjectionSystem`, the `Dom*` modules; ADR-0041 decisions 2 and 7). `CheckFrames` is a Reference (`wardic:packages/dom/src/index.ts:74`; ADR-0030 decision 7).
- **The binding:**
  - its own long-lived parts (the provider's runtime handle, its options) are `Context.Service`s;
  - its settings with defaults (`reducedMotion`, the default transition) are References or the existing services;
  - the binding defines no service of Foldkit's.

**C2. Layers: build once, memoized by reference.**
- **Rule:**
  - `Layer.build` and `Effect.provide(layer)` build into a child of the fiber's `CurrentMemoMap`, `CurrentMemoMap.forkOrCreate` (`fx:src/Layer.ts:600-605`, `:815-825`, `:994-1003`; `fx:src/internal/layer.ts:8-22`);
  - `buildWithMemoMap` puts its MemoMap into the built context (`fx:src/Layer.ts:770-783`);
  - so a Layer already built in a parent map is reused by reference, and an effect provided with that context builds new Layers into a child map.
- **Foldkit:**
  - builds `resources` once into the runtime's Scope (A.3);
  - a Command runs under that built context, so an `Effect.provide(DomLive)` inside it would reuse a `DomLive` already in `resources` (*inferred* from the MemoMap rule).
  - A Mount's context has no MemoMap, so a Mount that provides a Layer builds a fresh one each time (*inferred*).
- **Wardic today:**
  - Solid's provider makes one `ManagedRuntime` over `FlushGate.layer`, the projection options and `env`, built at once (`wardic:packages/solid/src/runtime.ts:62-69`, `:217-219`);
  - its Features build into that runtime's MemoMap with `Layer.buildWithMemoMap` (`wardic:packages/solid/src/feature.ts:1-12`).
- **The binding:**
  - **exactly one build of Wardic's Layer per Foldkit runtime,** on one MemoMap, so the gate, the Frame loop and the projection system are each one instance;
  - Features build into that MemoMap as they arrive;
  - a Mount must never `Effect.provide` Wardic's Layer itself: that's an Environment per element.

**C3. Scope and finalizers.**
- **Rule:**
  - resources are acquired with `Effect.acquireRelease`, which takes `{ interruptible?: boolean }` (`fx:dist/Effect.d.ts:12675-12679`);
  - finalizers run when their Scope closes, last registered first;
  - `Layer.buildWithScope` ties a Layer's resources to a given Scope (`skill:236-247`).
- **Foldkit:**
  - a Mount's Stream Scope is the element's lifetime;
  - acquisition is uninterruptible unless asked; "construct resources inside the acquire body" (`fk:src/mount/index.ts:223-262`);
  - the runtime's Scope ends Commands, Subscriptions and `resources` (A.3).
- **Wardic today:**
  - the gate's and the engine's Scopes end them, the engine before the gate (ADR-0041 decision 2);
  - dom's runner forks into a `FiberSet` in the Layer's Scope (`wardic:packages/dom/src/internal/runner.ts:43-54`);
  - Solid ties an element's registration to its owner's cleanup (`wardic:packages/solid/src/layout.tsx:55`).
- **The binding:**
  - each Wardic element's registrations (the gate's `register`, the projection node, gesture watches) are `acquireRelease`d inside its Mount's Stream, constructed in the acquire;
  - Wardic's Layer lives in one Scope as long as the app's: a provider Mount's (Q2 B) or `resources`'s (Q2 A);
  - P12 checks the close order.

**C4. Fibers and supervision.**
- **Rule:**
  - a fork is supervised by a Scope (`forkIn`, `forkScoped`; `fx:dist/Effect.d.ts:17126`, `:17216`) or a container (`FiberSet`, `FiberMap`, `FiberHandle`; `fx:dist/FiberSet.d.ts:106`, `fx:dist/FiberMap.d.ts:115`, `fx:dist/FiberHandle.d.ts:110`);
  - `runFork` makes an unsupervised root fiber.
- **Foldkit:**
  - Commands and Subscriptions fork into the runtime Scope (`fk:src/runtime/runtime.ts:399-404`, `:707-713`);
  - a Mount is a root fiber from `runForkWith`, interrupted by `destroy` and not supervised by the runtime Scope. The teardown patch's `destroy` hooks reach it (A.3).
- **Wardic today:**
  - **Solid:** a Leg is `runtime.runFork(leg)` on the provider's `ManagedRuntime`, interrupted by the spine at a Retarget or unmount (`wardic:packages/solid/src/spine.ts:1843-1844`, `:2694`, `:2968`).
  - **dom:** the engine and the gate fork through the runner's `FiberSet` (C3).
- **The binding:**
  - **Legs fork on the provider's runner, not in the element's Scope.** An exit has to outlive the element's `destroy` (Q4).
  - The element's Scope holds only what ends with it.
  - Callback emission is a `Queue` the Mount's Stream owns.

**C5. The runtime boundary.**
- **Rule:** inside Effect code, Layers and services; at the edge to non-Effect code, a `ManagedRuntime` (`skill:280-286`; `fx:dist/ManagedRuntime.d.ts:276`).
- **Foldkit:**
  - is the program, and its users write Effects;
  - Foldkit itself calls `runForkWith` at Commands and Mounts (`fk:src/runtime/runtime.ts:707`; `fk:src/html/index.ts:2600`), `runSync` in a few places (`runtime.ts:517`, `:747`), and `runFork` at `destroy` and `dispose` (`fk:src/html/index.ts:2551`; `fk:src/runtime/start.ts:281`).
- **Wardic today:**
  - Solid is non-Effect, so its provider is a `ManagedRuntime`, its services read once with `runSync` (`wardic:packages/solid/src/runtime.ts:182-255`);
  - the spine's per-frame members are plain functions (ADR-0041 decision 2).
- **The binding:**
  - **No `run*` in the app's code,** and no `ManagedRuntime`: Foldkit is Effect code, so the skill's bridge doesn't apply.
  - **The binding's own boundary** is where plain callbacks (the props accessor, a DOM listener, the spine's Retarget) need to fork. They use a runner over the provider's context, dom's `Runner` shape (`wardic:packages/dom/src/internal/runner.ts:23-33`).
  - The spine's `runtime: WardicRuntime` option has to accept that shape (gap G2).

**C6. The Scheduler.**
- **Rule:**
  - `Scheduler.Scheduler` is a `Context.Reference`, defaulting to `new MixedScheduler()` (`fx:dist/Scheduler.d.ts:62-79`);
  - `"async"` mode dispatches with `setImmediate` or the given function (`fx:src/Scheduler.ts:176-186`);
  - a fork's first run goes to the parent's dispatcher (`fx:src/internal/effect.ts:5602-5606`);
  - `Effect.callback` resumes inline (`:1205-1211`);
  - `Queue.offerUnsafe` releases takers through the queue's dispatcher (`fx:src/Queue.ts:2481-2490`).
- **Foldkit:** a microtask `MixedScheduler("async", …)` over the whole program (A.3). Mounts and Commands inherit it.
- **Wardic today:**
  - #208: the runner drops only a sync scheduler, so a host's async one stays (`wardic:docs/adr/0041-dom-api.md:342-362`; RN3);
  - the per-frame path never yields through the scheduler: the Frame loop's tick is plain calls, and settles resume inside it (ADR-0033, *Why*);
  - the Measure pass uses `queueMicrotask`.
- **The binding:**
  - Wardic's Layer built in a provider Mount or in `resources` is built under Foldkit's scheduler. #208 already keeps it (P9).
  - **No new conflict found.** One trap: a fiber that yields in a loop on a microtask scheduler never lets the page paint. Wardic has none on its per-frame path, and the binding must not add one: for example, a `Stream.repeat` over `afterCommit`.

**C7. Typed errors and defects.**
- **Rule:**
  - expected errors are typed, `Schema.TaggedError`, caught with `Effect.catchTag`;
  - defects are unexpected (`skill:194-234`).
- **Foldkit:**
  - a Command's and a Subscription's error channel is `never`: failures are Messages ("Failed*");
  - any cause that escapes one paints the crash view and stops the runtime (`fk:src/runtime/renderer.ts:300-335`; `runtime.ts:711`);
  - a Mount's failure is only logged (`fk:src/html/index.ts:2589-2594`).
- **Wardic today:**
  - a rejected option bag throws `Machine.OptionError`, a defect contained at each call site, so one animation fails (`wardic:docs/adr/0025-effect-first-core.md:515-517`);
  - failures are reported where they stop, to `ErrorReporter` (ADR-0030 decision 4);
  - a machine's build keeps `E = never` (ADR-0030 decision 2).
- **The binding:**
  - **Contain every Wardic defect at its own edge,** in the Mount's Stream and in each Command: `catchCause` → `Report.failure` → go on. A bad `transition` must never reach Foldkit's crash view.
  - A Command the binding defines returns its result Message on success and failure alike (Foldkit's "Completed*" convention), or a `Failed*` Message when the app can act on it.

**C8. Schema.**
- **Rule:** decode untrusted data and model the domain with `Schema` (`skill:122-132`).
- **Foldkit:** Model, Messages, Flags, Mount and Command args, Subscription dependencies and custom-element properties are Schema (A.2, A.6).
- **Wardic today:**
  - no Schema in any package's `src` (`wardic:docs/agents/effect-first.md:14`; ADR-0067 decision 9): it was about 54 KB minified of every app (`wardic:docs/adr/0067-features-and-the-slim-element.md:3`);
  - option bags are checked by hand, with defaults filled after the check (*Amendment (#511)*).
- **The binding:**
  - Wardic's config holds functions (`ease`, dynamic variants, `transformTemplate`), so it isn't a Schema. It never goes in the Model (A.2's freeze) or in a Message.
  - Messages the binding dispatches are the app's own constructors, passed in.
  - **Tension T2:** Schema is free in a Foldkit app, which already ships it, so #511's reason doesn't hold there. But `Mount.define` needs Schema args and result Messages (Q6).

**C9. `Data`, `Equal` and `Hash` against same-target comparison.**
- **Rule:** structural equality only where a value is a `Data` value or implements `Equal`; `Equivalence` for explicit comparisons.
- **Foldkit:**
  - snabbdom compares per key by `!==` (A.5);
  - `createLazy` by `!==`;
  - Subscriptions by `Schema.toEquivalence` of their dependencies (A.3);
  - attributes are `Data.TaggedEnum` values, built fresh each render.
- **Wardic today:**
  - **`sameResolution`:** each key's value with `Equivalence.strictEqual`, plus the variant name, the drag, the Keyframes, the gesture layers and the Transition ends (`wardic:packages/solid/src/spine.ts:1120-1134`).
  - Solid 2's target memo compares with it (`wardic:packages/solid/src/unstable/v2/ward.tsx:270-274`, `:1132`). A `style`, `transition` or callback change doesn't Retarget (#470).
- **The binding:**
  - a Foldkit view builds a new config object every render, so reference equality would Retarget every render;
  - compare each delivered config's resolution with `sameResolution`, as Solid 2 does;
  - no `Equal` on the config.

**C10. Streams.**
- **Rule:**
  - `Stream.callback` turns a callback API into a Stream over a `Queue`, buffered `"unbounded"` by default (`fx:dist/Stream.d.ts:560-597`);
  - in 4.1 its setup starts at once (`fk:CHANGELOG.md:15`).
- **Foldkit:** a Mount returns `Stream<Message>`, the canonical form being `Stream.callback` with an `acquireRelease` and `Effect.never` (`fk:src/mount/index.ts:440-466`).
- **Wardic today:**
  - input feeds are watches in an element's Scope, and the gesture Streams are built over them with `Stream.callback` (`wardic:docs/adr/0055-input-feeds.md:109-119`);
  - a Stream wrapper that suspended every pull cost 4–6% on a tick workload (`wardic:docs/adr/0040-start-cost.md:281`).
- **The binding:**
  - one `Stream.callback` per Wardic element: its setup registers the element, and its queue carries callback Messages;
  - `Queue.offerUnsafe` from Wardic's sinks, never per frame;
  - **no per-frame value goes through the Stream.**

**C11. `Option` and `Result`, not `undefined` and `Either`.**
- **Rule:** `Option` for a missing value; `Result` in Effect 4 (the skill's header).
- **Foldkit:** `Option` in its API (`OnCustomEvent`'s `f`, the pointer handlers' `f`; A.5).
- **Wardic today:**
  - dom's surface uses `Option` (ADR-0025 *Amendment (#69)*);
  - Solid's Tier 1 unwraps it for an app (ADR-0008 *Amendment (#63)*).
- **The binding:**
  - its users already write Effect, so the Tier 1 "Effect-free" promise is a choice here, not a must (Q19);
  - Motion's props stay plain shapes (Motion parity);
  - a callback that can produce no Message returns `Option<Message>`, as Foldkit's own handlers do.

**C12. `Effect.fn` and spans.**
- **Rule:** the skill prefers `Effect.fn("name")` for traced functions, and `Effect.fnUntraced` in libraries and hot paths (`skill:26-30`, `:63-114`).
- **Foldkit:** wraps every Command in `Effect.withSpan(command.name, { attributes: command.args })` (`fk:src/runtime/runtime.ts:692-695`).
- **Wardic today:**
  - `Effect.fn` is replaced by `Effect.fnUntraced`, since it always captures a stack, and every span is `captureStackTrace: false` (`wardic:docs/agents/effect-first.md:143-144`; ADR-0040);
  - core opens spans only under a non-native Tracer (`:124-126`);
  - devtools are Effect's `DevTools.layer()` on the Environment (ADR-0030 decision 6).
- **The binding:**
  - Wardic's rule wins in Wardic code;
  - a Command the binding defines gets Foldkit's span by its name (`Wardic.AnimateLayout`);
  - Wardic's own spans reach the Tracer given to Wardic's Layer, provided to it as Solid's `env` is.
  - Foldkit's DevTools (Message history, time travel) are a different tool from Effect's.

**C13. Atoms and the `AtomRegistry`.**
- **Rule:** `effect/reactivity`'s `Atom` and `AtomRegistry`.
  - `Atom.family` for keyed atoms;
  - `Atom.toStream` to read one as a Stream (`fx:dist/reactivity/Atom.d.ts:677`, `:1428`);
  - imported by their own paths (`wardic:docs/agents/effect-first.md:200`, #656).
- **Foldkit:** doesn't use `effect/reactivity` anywhere (grep, `fk:src`). Its stance is one Model against many atoms (`fkweb:effectAtomComparison.md:21-35`).
- **Wardic today:**
  - `DomLive` holds the `AtomRegistry`, and `DomProbe` writes `viewport` and `prefersReducedMotion` through it (`wardic:packages/dom/src/index.ts:96-118`);
  - Live values are Atoms in every binding (ADR-0043 decision 2). ADR-0043 already notes Foldkit "would take an Effect source; a shared mutable value Wardic writes into would go against its messages-only model" (`wardic:docs/adr/0043-live-values.md:19`).
- **The binding:**
  - one registry per app, in Wardic's Layer;
  - Live values are Atoms made outside the view (module scope or a family keyed by element id). Never in the Model;
  - **no runtime conflict.** The tension (T3) is philosophical, and documented.

**C14. Pipeable modules and `dual`.**
- **Rule:**
  - a module per data type or concept, at `@wardic/<package>/<Module>`, the root re-exporting namespaces;
  - `dual` operations on cold paths;
  - positional per frame;
  - plain shapes stay plain (`wardic:docs/agents/pipeable.md:13-40`, `:54-62`; ADR-0041 decisions 4–7).
- **Foldkit:** namespaces too (`import { Mount, Command } from 'foldkit'`, `foldkit/html`; `fk:src/index.ts:1-25`).
- **The binding:** `@wardic/foldkit/<Module>`, for example `Wardic` (the builders), `Ward` (attributes), `Presence`, `Layout`, `Reorder`, `LiveValue`, `WardicConfig`. Attribute values stay plain tagged shapes, Foldkit's own style.

**C15. The Effect-first rules.**
- **Rule (Wardic's):**
  - Effect's modules over vanilla TypeScript, and no ternaries;
  - allocation-free forms per frame;
  - compose once on the hot path (per key per Retarget, per leg);
  - statements at measured mount sites (`wardic:docs/agents/effect-first.md:9-15`, `:31-73`, `:85-104`).
- **Foldkit:** its own code doesn't follow them (A.2).
- **The binding:**
  - follows them in all its code;
  - its per-frame path is the spine's sinks;
  - the props accessor runs per element per render: the hot path, composed once;
  - a callback's Message is per event, not per frame.

**Where following Effect 4 strictly and following Foldkit pull apart:**
- **T1: services by type against a Mount's `R = never`.**
  - Effect wants an element's code to require Wardic's services and get them from the program's Layer.
  - Foldkit gives a Mount no Layer (Summary 2).
  - Strict Effect needs Foldkit's change (U1). Until then the binding carries its services in a provider Mount (Q2).
- **T2: Schema.** Effect and Foldkit want Schema at the edges. Wardic's `src` has none, and its config can't be one (C8).
- **T3: state.**
  - Foldkit: "The Model is the single source of truth" (`fkroot:README.md:25`).
  - Wardic keeps per-frame values, leavers and Snapshots in its runtime, outside the Model, as Effect allows (`Ref`s, Atoms, services).
- **T4: defects.**
  - Effect: a defect is a bug, so stopping is right.
  - Foldkit: any defect in a Command stops the whole app.
  - Wardic: one bad animation fails alone. The binding must contain (C7).
- **T5: hooks.** Effect has no say. Foldkit's public surface lacks an update, remove and commit hook, so the strictly public binding uses an own accessor and a `MutationObserver` (Q9).
- **T6: tests.** Foldkit's Scene contract asks for every `OnMount` to be resolved. A Mount per Wardic element puts Wardic in every Scene test.

## Part D: The API design space

Every example is a sketch, not compiled. User code follows Foldkit's `Message.match` and `{ model, commands }` (`fkroot:README.md:66-77`), with no ternaries.

### D.1 How a view names a Wardic element

**A. A builder that mirrors `h`: `w.div(attributes, children)`.**
- **What:** `Wardic.html(h)` returns `w`, with every tag (`w.div`, `w.li`, `w.button`, …) and Motion's props as PascalCase attribute factories, as `CustomElement` does (`fkweb:core/customElement.md:7`, `:25`).
- **Where:** `@wardic/foldkit/Wardic`.
- **How:** `w.div` splits its attributes into Foldkit's and Wardic's, then builds one element with:
  - one `h.Style`: the Starting style laid under the user's `h.Style`, merged since a second one replaces the first (A.5);
  - one `h.Prop` carrying the config (D.2);
  - one `h.OnMount`, fused with any `OnMount` the user gave, since one replaces the other (A.6);
  - and passes the rest through.
  - `w` is cached per `h`, so it's as `===`-stable as `h` for `createLazy`.
- **Cost:**
  - one config object and three attributes of its own per element per render;
  - one Mount per element (Scene: T6);
  - typing: `Attribute<Message> | ChildAttribute | WardAttribute<Message>`.
- **Precedent:** elm-animator's `Anim.div animation attrs children` (`ea:src/Animator.elm:402-411`), and Solid's `wardic.div` (ADR-0042 decision 3).

```ts
const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const w = Wardic.html(h)
  return {
    title: "Cards",
    body: w.ul(
      [h.Class("cards")],
      Arr.map(model.cards, (card) =>
        w.keyed("li")(card.id, [
          h.Class("card"),
          w.Initial({ opacity: 0, y: 8 }),
          w.Animate({ opacity: 1, y: 0 }),
          w.WhileHover({ scale: 1.03 }),
          w.Transition({ type: "spring", bounce: 0.2 }),
          w.OnAnimationComplete(ShowedCard({ id: card.id })),
        ], [card.title]),
      ),
    ),
  }
}
```

**B. Motion's props as one record, beside Foldkit's attributes: `w.div(props, attributes, children)`.**
- **What:** the closest to `<motion.div animate={…}>`; Motion's docs map line for line.
- **How:** the record is the config.
- **Cost:** a third positional argument breaks Foldkit's two-argument shape, and `keyed` needs a fourth.

```ts
w.div({ initial: { opacity: 0 }, animate: { opacity: 1 }, onAnimationComplete: ShowedCard({ id }) }, [h.Class("card")], [title])
```

**C. A bundle on any element: `h.div([...Ward.attributes(config)], children)`.**
- **What:** Solid 2's `ward()` shape, a value that carries its props, and the **Listening ward**'s place ("the ward listens, the element animates"; CONTEXT.md, **Listening ward**). It works on custom elements and on Foldkit UI's elements.
- **Cost:**
  - the bundle's `h.Style` and a user's `h.Style` collide, last wins (A.5), so the user's style goes in the config (`Ward.attributes({ style, … })`), as Solid 2's `ward({ style })` does;
  - and `OnMount` collides the same way.

**D. A hook added to a built element: `Ward.on(h.div(…), config)`.**
- **What:** the binding adds `insert`, `prepatch`, `postpatch`, `destroy` and `remove` to the vnode Foldkit returned.
- **Cost:**
  - no Scene marker, so no T6;
  - snabbdom's own `remove`;
  - but `VNode` isn't exported (`fk:src/index.ts:1-25`), Foldkit calls its hooks internal (#561), and 0.x minors may break it (`fkroot:README.md:28`).

### D.2 Props: which, how typed, and how a re-render becomes a Retarget

- **Which:** Motion's element props, as Solid's `WardConfig` has them (`wardic:packages/solid/src/config.ts:440`):
  - `initial`, `animate`, `exit`, `variants`, `custom`, `inherit`, `transition`, `transitionEnd`;
  - the `while*` props and `viewport`;
  - `layout`, `layoutId`, `layoutDependency`, `layoutScroll`, `layoutRoot`;
  - `drag` and its options;
  - `style` for Base and Live values;
  - `transformTemplate`.

  `onUpdate` and the layout-measure callbacks aren't Messages (D.4).
- **Typed** by Wardic's own TypeScript types, not Schema (C8). `w.Animate` infers its keys, as #305's inference does for `wardic.*`.
- **Derived from the Model in `view` every render.** That's pure, and Foldkit's model. The config is a new object each render.
- **How the render reaches the ward**, the options:
  - **A. `h.Prop` and an own accessor.**
    - The element renders `h.Prop("wardic", config)`. The props module assigns it at `create`, and again whenever its reference changes (A.5).
    - At `insert`, the Mount reads the first value, registers, then `Object.defineProperty`s an accessor for that key on the element.
    - Each later assignment calls it, inside the patch. It resolves the config with `resolutionOf` and calls the spine's `retarget` when `!sameResolution` (C9).
    - The `destroy` release removes the accessor.
    - **Cost:** one resolution per element per render; a Retarget only on change; an expando on built-in elements (P6).
  - **B. An injected `postpatch`** (D.1 D): the same compare, from snabbdom's own hook.
  - **C. Commands only:** `Ward.animate({ id, target })` from `update`, Foldkit's documented route for "Model change → DOM work" (`fk:src/mount/index.ts:318-321`). There's no declarative `animate`, so it's no Motion parity.
- **The Starting style** is computed purely from `initial` (dom's `Style.starting`) and rendered in `h.Style` with the same values every render while `initial` holds. The style module then never rewrites the keys Wardic draws, and drops a key only if the view stops giving it (A.5).

```ts
// Inside w.div, in outline (hot path: composed once, statements):
const wardAttributes = <Message>(h: HtmlBuilder<Message>, config: WardConfig, user: UserStyle): ReadonlyArray<Attribute<Message>> => [
  h.Style(pipe(Style.starting(config), Style.over(user))),
  h.Prop(CONFIG_KEY, config),
  h.OnMount(wardMount(config)),
]
```

### D.3 Variants down the tree, with no context

Variants need two halves:
- **at render:** an inherited `initial` name, for the Starting style;
- **at mount:** the parent's registry, its stagger, `when` and its gestures handed down (`wardic:packages/solid/src/variant-tree.ts:275-315`).

ADR-0045 rejected finding the parent through the DOM for Solid 2 "since the Starting style and Appear groups need the parent during render" (`wardic:docs/adr/0045-solid-2-binding.md:25`).

**A. DOM ancestry at mount, explicit names for server HTML.**
- **How:**
  - a Variant child's Mount walks `parentElement` to the nearest Wardic element with variants. Its config is on its accessor key, set at `create`, before any `insert`;
  - children's `insert`s come before the parent's (A.4), so the child gets or creates the parent's record, keyed by element, and the parent's Mount adopts it;
  - the inherited Starting style is applied at the child's `insert`, before paint.
- **Cost:**
  - a walk per Variant child at mount;
  - server HTML lacks an inherited Starting style, so an SSR page repeats `w.Initial` on children (or it flashes until hydration's inserts run).
- **Precedent:** dom's projection tree is already built by DOM ancestry (`wardic:packages/solid/src/layout.tsx:41`, `:105-107`; CONTEXT.md, **Projection node**).

**B. A child builder from the parent: thunk children.**
- **How:** `w.ul([…], (w) => [...])`. The parent's `w.ul` builds a child builder bound to its names, then calls the thunk.
- **Cost:**
  - the children argument changes type for variant parents;
  - exact on the server, since the names are known at render;
  - nothing found at mount.

```ts
w.ul([w.Variants(list), w.Initial("hidden"), w.Animate("shown")], (child) =>
  Arr.map(model.items, (item) => child.keyed("li")(item.id, [w.Variants(row)], [item.name])),
)
```

**C. Explicit values: `w.Inherit(parent)`,** the parent's names passed as data, as `viewInputs` are. It's verbose, and nothing like Motion.

### D.4 Callbacks → Messages

- **Messages:**
  - `onAnimationStart` / `onAnimationComplete`;
  - `onHoverStart` / `onHoverEnd`;
  - `onTap`, `onTapStart`, `onTapCancel`;
  - `onPanStart`, `onPan`, `onPanEnd`;
  - `onDragStart`, `onDrag`, `onDragEnd`, `onDirectionLock`, `onDragTransitionEnd`;
  - `onLayoutAnimationStart` / `Complete`;
  - `onViewportEnter` / `Leave`;
  - `Reorder.Group`'s `onReorder`;
  - `AnimatePresence`'s `onExitComplete`.
- **Never Messages:**
  - `onUpdate`, per frame: every frame through `update`, `view` and the patch is the issue's "don't";
  - `onBeforeLayoutMeasure` and `onLayoutMeasure`, synchronous inside a pass;
  - `transformTemplate`.

  These stay plain functions on the config, or a Live value (D.8).
- **The form:** Foldkit's two handler shapes:
  - a Message value: `w.OnHoverStart(HoveredCard({ id }))`;
  - a function: `w.OnTap((event, info) => TappedCard({ id, x: info.point.x }))`, ADR-0047's `(event, info)`. It returns an `Option<Message>` where it may produce none, as `OnPointerMove`'s does (A.5).
- **Delivery:** `Queue.offerUnsafe` into the element's Mount Stream. `update` then runs in a microtask, never inside Wardic's tick (B.1 step 6; P7).
  - High-rate ones (`onDrag`, `onPan`) fill DevTools' history. The docs should say so.

### D.5 Imperative calls → Commands

- **`animateLayout`:**
  - `Wardic.animateLayout({ provider: "app", onSettled: SettledShuffle() })`, returned with the Message that changes layout;
  - its Effect finds the provider by id, refreshes the Measurements, awaits `Render.afterCommit`, `notify`s, and maps `onSettled` to its result Message (B.2; P5);
  - finding the target by id after `afterCommit` is Foldkit's own `Dom` idiom (`fkweb:core/render.md:7-34`).
- **`animate`** (`createAnimate`, Motion's `useAnimate`): `Wardic.animate({ target: "#hero", values, transition })` → its result Message when it lands, with the Playback controls by id.
- **Animation controls:** `Wardic.controls("hero").start("open")` as Commands, addressed by a controls id an element names (`w.Controls("hero")`).
- **Drag controls aren't a Command.**
  - `dragControls.start(event)` adopts the pointer inside its event (ADR-0032, ADR-0060; `adoptPointer(target, raw)` takes the raw event, `wardic:packages/core/src/InputSource.ts:284`).
  - Foldkit's `OnPointerDown` gives fields, not the event, and a Command runs after the handler (A.5, B.1).
  - So a handle element names its target, and its Mount starts the drag inside the event: `w.DragHandle("card-7")`.

```ts
const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedShuffle: () => ({
      model: { ...model, order: shuffle(model.order) },
      commands: [Wardic.animateLayout({ provider: "app", onSettled: SettledShuffle() })],
    }),
    SettledShuffle: () => ({ model }),
  })
```

### D.6 Presence and exits

**A. Model-driven, Foldkit UI's pattern.**
- **How:**
  - the app keeps a leaving item in the Model, marked;
  - `w.Present(false)` plays its `exit`;
  - `w.OnExitComplete(Removed({ id }))` tells `update` to drop it.
- **Cost:**
  - every exit is a round trip through `update`, and the app writes the bookkeeping;
  - not Motion's `AnimatePresence` (removal from the view animates);
  - but it's Foldkit-idiomatic, testable in Story tests, and needs no DOM trick.

```ts
w.li([w.Present(Bool.not(item.leaving)), w.Exit({ opacity: 0, x: -20 }), w.OnExitComplete(RemovedItem({ id: item.id }))], [item.name])
```

**B. A presence element that keeps its leavers: `w.presence(attributes, children)`.**
- **How:**
  - each child's Mount registers a PresenceRecord, whose cells outlive the child (`wardic:packages/solid/src/presence-record.ts:15-57`);
  - its `destroy` release runs while the element is still connected (A.6). It hands the leaver over and takes `popLayout`'s Measurement;
  - the presence observes its own `childList` with a `MutationObserver`. In the patch's checkpoint, before paint, it tells the Solid-free `PresenceController` what's present, which re-inserts each leaver where it was and runs its exit (`wardic:packages/solid/src/presence-controller.ts:400-406`, `:477-506`).
- **Cost:**
  - an observer per presence;
  - a node Foldkit doesn't know about among its children (A.7; P8);
  - Motion's semantics: direct children only, as snabbdom's `remove` is (`sd:README.md:364-366`).

```ts
w.presence([w.Mode("popLayout"), w.OnExitComplete(SettledList())],
  Arr.map(model.items, (item) => w.keyed("li")(item.id, [w.Exit({ opacity: 0 })], [item.name])),
)
```

**C. An injected `remove` hook** (D.1 D):
- snabbdom delays removal until Wardic calls back, which is upstream's intended use;
- no observer and no re-insert;
- internal API.

### D.7 Layout animations, `layoutId` and LayoutGroup

- **Registration:**
  - `w.Layout()`, `w.LayoutId("underline")`, `w.LayoutDependency(model.isOpen)`;
  - the Mount registers a Projection node at `insert`, which triggers a pass in the patch's checkpoint (B.1);
  - the projection tree comes from DOM ancestry, as now.
- **The trigger after a patch, the options:**
  - **A. Solid's coverage:** registration, the shared observer, and `LayoutDependency`, whose accessor `notify`s on a change. A keyed reorder with no dependency jumps, as in Solid (ADR-0038, *Why*).
  - **B. Every render:** the provider's props accessor `notify`s at the start of each patch. The pass runs after it.
    - It costs one whole-tree pass per Foldkit render (P13; 6–10 ms at 1,000 nodes by ADR-0018).
    - It gives React's trigger coverage, which ADR-0005 *Amendment (#3)* says Motion relies on.
  - **C. B, plus a tree-wide Measurement before the patch** at the same accessor: Motion's snapshot model, where B alone uses the retained boxes.
  - **D. A `MutationObserver` on the provider** (`childList`, `subtree`, `attributeFilter: ["class"]`; not `style`, which the gate writes):
    - structural and class changes trigger a pass, others don't;
    - an app style change that moves layout is missed, as in Solid.
- **`layoutId` handovers** work as in Solid: the engine pairs twins in one end-of-task window (ADR-0010). A leaving twin needs presence (D.6).
- **LayoutGroup:**
  - no context, so the group's id is a prefix the view gives: `w.LayoutId(LayoutGroup.id(["tabs"], "underline"))`, Motion's `tabs-underline` (#432);
  - or a `w.layoutGroup("tabs", (w) => …)` child builder, as D.3 B.
  - Its `layoutDependency` is the provider's `notify`.

### D.8 Live values without the Model

- **The form:** an `Atom`, made once outside the view: at module scope, or `Atom.family` keyed by element id (`fx:dist/reactivity/Atom.d.ts:677`). Given in `w.Style({ opacity })` (ADR-0043 decisions 1–2).
- **A ward's output:** `Ward.read("hero", "x")`, a family keyed by the element's id, where Solid hands a ward object (CONTEXT.md, **Listening ward**).
- **Helpers:** `LiveValue.scroll`, `transform`, `velocity`, `follow`, core's over Atoms.
- **Shown in the view:** the view reads the Model, so a Live value shown as text needs a Message per change: low-rate only. A `w.Text(atom)` sink that writes `textContent` itself is Motion's `<motion.span>{value}</motion.span>`, outside the patch.
- **Cost:** one registry per app; nothing per frame through Foldkit.

```ts
const scroll = LiveValue.scroll({})                                  // module scope: one per app
const fade = LiveValue.transform(scroll.scrollYProgress, [0, 0.2], [1, 0])
const header = (h: HtmlBuilder<Message>): Html => {
  const w = Wardic.html(h)
  return w.header([w.Style({ opacity: fade })], ["Menu"])
}
```

### D.9 Gestures, drag, Reorder

- **Gestures:**
  - Wardic's recognizers listen on the element through `DomInput.layer`, built with the first gesture Feature (ADR-0041 *Amendment (#511)*);
  - Foldkit's own `OnPointer*` attributes stay the app's;
  - `whileHover`, `whileTap`, `whileFocus` and `whileInView` need no Message.
- **Drag:**
  - `w.Drag("x")`, `w.DragConstraints({ left: -100, right: 100 })`, or `w.DragConstraints("parent")` / `w.DragConstraints("#board")`: an element ref doesn't exist in a view, so it's an id or an ancestor;
  - the drag never touches the Model; its end is a Message.
- **Reorder:**
  - `Reorder.group(h, { values, onReorder: (values) => Reordered({ values }), axis: "y" }, items)` and `Reorder.item(h, value, attributes, children)`;
  - `onReorder` is a Message, and the DOM moves at the next frame's patch;
  - **the Reorder group's guard waits for a pass** (ADR-0038 decision 4), so the item's Mount `yield*`s `Render.afterCommit` after offering the Message, then `notify`s (B.2);
  - the crossover shows one frame later than Solid's (B.3).

```ts
Reorder.group(h, { values: model.tasks, axis: "y", onReorder: (tasks) => Reordered({ tasks }) },
  Arr.map(model.tasks, (task) => Reorder.item(h, task, [h.Key(task.id), h.Class("task")], [task.title])),
)
```

### D.10 Config and provider

- **The provider element:** `w.provider([w.Env(env), w.Features(domMax), w.ReducedMotion("user")], children)`, at the top of the view.
  - Its Mount builds Wardic's Layer into its Scope and hands it to descendants (Q2 B).
  - Its accessor is D.7's per-render moment.
- **`WardicConfig`** (ADR-0062):
  - `w.config([w.Transition(t), w.ReducedMotion("always"), w.SkipAnimations(true)], children)`;
  - found by DOM ancestry, read when each animation starts, as ADR-0062 says ("a change to a config moves nothing by itself"; `wardic:docs/adr/0062-wardic-config.md:17-28`).
- **As a Layer instead:** `Wardic.layer({ reducedMotion, transition })` in `resources` (Q2 A). One per app, no subtree.
- **Time travel:** while a Mount's `viewStateChanges` reads `Paused`, every animation is skipped (ADR-0063's `skipAnimations`), so a replayed view lands at once, as Foldkit's View Transitions don't animate in replay (A.10).

### D.11 Package shape, and what dom and Foldkit lack

**The package:**
- `@wardic/foldkit`, peers `foldkit ~0.170.0` and `effect ^4.1.1`, depending on `@wardic/dom`, `@wardic/core` and the lifted shared package (G1);
- modules per C14;
- the server needs nothing but the pure Starting style: Foldkit's server runs the view only, and dom's stand-ins (`FlushGate.layerInert`) stay unused.

**Wardic's gaps:**
- **G1. The spine and the Solid-free modules are in `@wardic/solid`.**
  - These are `spine.ts`, `retarget-legs.ts`, `variant-tree.ts`, `variant-target.ts`, `presence-controller.ts`, `presence-record.ts`, `drag-track.ts`, `gesture-features.ts`, `live-style.ts`, `imperative.ts`, `feature.ts`, `config.ts`, `motion-props.ts` and the runtime module. They're unexported (`wardic:packages/solid/package.json:41-63`), and the package has a required `solid-js` peer (`:74-83`).
  - Lift them into a framework-free package: the canvas note's step 1 (`wardic:docs/research/canvas-environment.md:560`).
  - *Superseded by ADR-0069 decision 2 at `origin/main`: see Part F.0 and F.4.*
- **G2.** The spine takes `runtime: WardicRuntime`, a `ManagedRuntime` (`wardic:packages/solid/src/spine.ts:1843-1844`). It uses only `runSync` and `runFork`, so dom's `Runner` shape would do.
- **G3.** The `Reactivity` port (`untrack`, `trigger`, `watch`; `wardic:packages/solid/src/reactivity.ts:9-29`) needs a Foldkit implementation over per-render deliveries: `watch` from the props accessor, `untrack` as a plain call.
- **G4.** A Declared layout change whose change lands in a later task. `animateLayout(fn)` holds one task's Measurements (ADR-0038 decision 2). Refreshing the slots and `notify`ing after the commit should work today (B.2; P5). If P5 fails, dom needs a "measure now, animate at the next pass" form.
- **G5.** The teardown must tolerate an unregister after its gate or engine closed (P12).
- **G6.** Drag controls from a handle element's own pointer listener: a Feature, not a Command (D.5).

**Asks for Foldkit (upstream):**
- **U1.** Mounts get `resources`: `R` met by the program's Layer, as Commands' is. That closes T1.
- **U2.** A Mount that sees each render's args, an `argsChanges` Stream: Foldkit's own answer to "args are captured at mount", in place of the accessor.
- **U3.** A public removal delay (`h.OnRemove` over snabbdom's `remove`), for exits.
- **U4.** A public commit signal (`Render.commits`, a Stream) and a pre-commit moment (`Render.beforeCommit`).

## Part E: Questions for the grill

Ordered so each answer unblocks the next. Q1 frames the rest. Q2–Q8 are Effect semantics, Q9–Q20 the API.

### Strategy

**Q1. Build on 0.170.0's public API now, or wait for Foldkit's hooks (U1–U4)?**
- **A. Public only now, and file U1–U4 in parallel.**
  - Mounts, the props accessor and a `MutationObserver` now. Each workaround sits behind one internal module, swapped when Foldkit ships.
  - **Cost:** the accessor and the observer are unusual (P6, P8); T6 stays.
- **B. Wait for U1–U4.**
  - **Cost:** the binding's date is Foldkit's. Foldkit is pre-1.0 and ships often (A.1).
- **C. Internal hooks now** (D.1 D).
  - **Cost:** exact snabbdom semantics, but any Foldkit minor may break it.
- **Recommendation: A.**
  - It starts on the public surface, keeps the swap local, and gives Foldkit's maintainers the cases.
  - P6 and P8 decide whether A's two tricks hold. If either fails, C behind the same module.

### Effect semantics

**Q2. Where do Wardic's services live, and how does an element reach them?**
- **A. Foldkit's `resources`.**
  - Commands and Subscriptions get them by type.
  - **Cost:** Mounts can't, until U1 (Summary 2). It's built lazily, maybe after the first Mounts (A.3).
- **B. A provider element.**
  - `w.provider`'s Mount runs `Layer.buildWithScope(Wardic.layer(env), scope)` in its own Scope, and keeps the built context in a `Deferred` per provider element.
  - Descendant Mounts find it by DOM ancestry and await it. They insert first (A.4), and resume inline when it's done (P2).
  - Commands find the provider by id (D.5).
  - **Cost:** one build per app; lifetime = the root element's, so `embed`'s `dispose` ends it (A.3); no `run*` in app code.
- **C. A `ManagedRuntime` the app makes** (`Wardic.make(env)`), Solid's shape.
  - **Cost:** a second runtime beside Foldkit's, outside its Scope and its `dispose`. It's the skill's bridge for non-Effect code (C5), where Foldkit is Effect code.
- **Recommendation: B now, A once U1 lands.**
  - B is Effect-native on 0.170's public API: a Layer built into a Scope, one instance, structured lifetime.
  - A is the cleanest Effect, but can't serve a Mount today.

**Q3. The Scheduler: keep Foldkit's microtask scheduler for Wardic's fibers, or pin Effect's default?**
- **A. Keep it.** #208 already does (RN3). Wardic's per-frame path doesn't yield through any scheduler (C6).
- **B. Pin the default** in Wardic's Layer: `Layer.succeed(Scheduler.Scheduler, new MixedScheduler())`. Forks then resume on `setTimeout`, unlike Foldkit's own.
- **Recommendation: A.** It's the host's choice, as ADR-0027 decision 6 and #208 say. P9 confirms it.

**Q4. Who owns a Wardic element's fibers and Scope?**
- **A. Split.**
  - The element's Mount Scope holds its registrations.
  - The provider's runner holds its Legs, interrupted by the spine at a Retarget or unmount, as Solid's runtime does.
- **B. All in the element's Scope** (`forkScoped`).
- **C. All in the runner,** the element's Scope only unregistering.
- **Recommendation: A.**
  - B kills an exit at `destroy`, which runs before removal (A.7).
  - C loses `acquireRelease`'s pairing for what ends with the element.

**Q5. How do Wardic's failures surface in a Foldkit app?**
- **A. Contained at the binding's edge,** `Report.failure` and `ErrorReporter` (ADR-0030 decision 4), never a defect into Foldkit.
- **B. A, plus typed results** for the binding's Commands: their result Message on failure too, or a `Failed*` Message the app gives.
- **C. Let defects reach Foldkit,** which paints the crash view.
- **Recommendation: B.**
  - Foldkit stops the whole app on a Command's or Subscription's defect (C7). Wardic fails one animation.
  - B keeps Foldkit's "every Command answers" convention.

**Q6. Schema at the binding's edge: none, or `Mount.define`?**
- **A. None.** Raw `MountAction`s (a public type) and Wardic's own checks.
- **B. `Mount.define`,** with Schema args and a result Message, so a Scene test can name and resolve Wardic's Mounts (`Mount.resolveAll`), as Foldkit UI exports its definitions (`fkweb:testingScene.md:223-246`).
- **C. A Schema-typed config.** It can't be: functions (C8).
- **Recommendation: A, unless T6 forces B.**
  - #511's rule holds in the binding's `src`, though its size reason doesn't hold in a Foldkit app.
  - Decide with Q9: if Wardic elements carry an `OnMount`, Scene tests need a resolver, and B gives one.

**Q7. Live values: Atoms, Streams, or the Model?**
- **A. Atoms,** one registry per app, made outside the view (D.8). ADR-0043 decision 2's form in every binding.
- **B. Streams.** ADR-0043 *Amendment (#233, #234)* rejected a Stream form: "every Live value helper and `style` takes Atoms" (`wardic:docs/adr/0043-live-values.md:92`).
- **C. The Model,** with a Message per frame: the issue's "don't".
- **Recommendation: A.**

**Q8. Spans and the Tracer: whose reaches Wardic?**
- **A. The Layer the app gives the provider** (`w.Env(Layer.mergeAll(DomLive, DevTools.layer()))`), as Solid's `env`.
- **B. Foldkit's `resources`.** Only with Q2 A.
- **Recommendation: A.** It follows Q2 B. Note that Solid's provider refuses an `env` that waits as it builds (`wardic:packages/solid/src/runtime.ts:53-69`); a provider Mount can await one.

### API

**Q9. Which Foldkit surface carries an element's lifetime, updates and removal?**
- **A. Public:**
  - `OnMount` for the lifetime;
  - the props accessor for updates (D.2 A);
  - a `MutationObserver` for removal (D.6 B).

  **Cost:** T6 (every Wardic element pending in Scene); one-Mount fusion; an expando.
- **B. Injected hooks** (D.1 D). **Cost:** no T6, exact `remove`, internal.
- **C. Custom elements** (`<w-div>` via `CustomElement.define`). Public and typed, but the tag isn't a `div` or a `button`: semantics, CSS and accessibility change.
- **Recommendation: A.** Q1's reasons. Q6 answers T6.

**Q10. How does a view name a Wardic element?**
- **A. `w = Wardic.html(h)`; `w.div(attributes, children)`,** with PascalCase Motion props (D.1 A).
- **B. A props record first** (D.1 B).
- **C. A bundle on any element** (D.1 C).
- **Recommendation: A, with C as the Listening ward's form.**
  - A is Foldkit's own element shape and CustomElement's naming rule, with Motion's names kept (ADR-0042 decision 1).
  - C serves custom elements and Foldkit UI's elements, with `style` in its config.

**Q11. How does a re-render become a Retarget?**
- **A. The props accessor, compared by `sameResolution`** (D.2 A; C9).
- **B. An injected `postpatch`** (with Q9 B).
- **C. Commands only.** No declarative `animate`.
- **Recommendation: A, if P6 holds.** It's Solid 2's comparison (#470), on Foldkit's documented "written when it changes" (`fkweb:core/customElement.md:35`).

**Q12. Variants down the tree?**
- **A. DOM ancestry at mount, explicit `w.Initial` on SSR pages** (D.3 A).
- **B. Thunk children** (D.3 B).
- **C. Explicit values** (D.3 C).
- **Recommendation: A.**
  - It keeps Motion's implicit propagation. The client's first paint is right, since the Starting style is applied at `insert`, before paint (P2).
  - The cost is server HTML, the reason ADR-0045 chose a context. Ask whether SSR pages with variant trees matter for 1.2 (Foldkit's SSR is experimental).

**Q13. Presence?**
- **A. Model-driven** (D.6 A).
- **B. A presence element that re-inserts from a `MutationObserver`** (D.6 B).
- **C. An injected `remove` hook** (D.6 C).
- **Recommendation: B, with A documented as Foldkit's way.**
  - B is Motion's `AnimatePresence`, on the Solid-free controller.
  - P8 decides it. If it fails, C (with Q9 B).

**Q14. Layout triggers and the "before"?**
- **A. Solid's coverage:** registration, the observer, `LayoutDependency` (D.7 A).
- **B. A pass every render** (D.7 B).
- **C. B, plus a pre-patch Measurement** (D.7 C).
- **D. A `MutationObserver`** (D.7 D).
- **Recommendation: A by default, with B as a provider option** (`w.LayoutEveryRender()`). P13 decides the default.
  - A matches Solid's semantics and cost.
  - B is Foldkit's chance at React's coverage, at a pass per render.
  - C only if P5 shows the retained box is wrong there.

**Q15. Which callbacks are Messages, in which form?** (D.4)
- **A. Foldkit's two handler shapes,** a Message or `(event, info) => Message | Option<Message>`, every event callback but the four plain ones.
- **B. One `OnWardEvent` Stream per element.**
- **C. Plain callbacks.** Impossible: a view has no dispatch.
- **Recommendation: A.**

**Q16. Imperative calls?** (D.5)
- **A. Commands by id after `Render.afterCommit`;** drag controls by a handle element.
- **B. Model tokens** (`w.Controls(model.tick)`), declarative.
- **C. A handle outside Foldkit.**
- **Recommendation: A.** It's Foldkit's `Dom` idiom. A token per call is bookkeeping in the Model.

**Q17. Live values' API?** (D.8)
- **A. Module-scope Atoms and `Ward.read(id, key)` families.**
- **B. Atoms per element made by the binding,** read through a Message.
- **Recommendation: A, with a `w.Text(atom)` sink.**

**Q18. Gestures, drag and Reorder?** (D.9)
- **Decide:**
  - `dragConstraints` as an id or `"parent"`;
  - Reorder's post-commit `notify`;
  - whether `onDrag` and `onPan` are Messages at pointer rate or opt-in.
- **Recommendation:** an id or `"parent"`; the `notify`; and Messages, documented against DevTools' history.

**Q19. Config: provider and `w.config` elements, or Layers? And is the Tier 1 surface Effect-typed?**
- **A. Elements by DOM ancestry** (D.10). Their reads at each animation start, as ADR-0062.
- **B. A Layer** in `resources` or the provider. One per app, no subtrees.
- **And:** `Option` in callbacks (C11). Motion's plain shapes for props either way.
- **Recommendation: A, with `Option` where a callback may give nothing.** Foldkit users write Effect, so hiding it buys nothing there (ADR-0008 *Amendment (#63)*).

**Q20. The package and the lift: first, or alongside?**
- **A. Lift the spine and the Solid-free modules into a framework-free package first** (G1), with the `Runner` and `Reactivity` ports (G2, G3). Then `@wardic/foldkit` on it.
- **B. Export the internals from `@wardic/solid`.** **Cost:** `solid-js` comes with them.
- **C. Copy them.** **Cost:** drift.
- **Recommendation: A.** It's the canvas note's step 1 too, so a scene binding gets it as well. And the repo's own rule: extend, don't copy.

## Not checked

- **Nothing was run.** Every timing in Part B is read, and the *inferred* ones are P1–P13's. In particular:
  - the order of Wardic's and Foldkit's rAF callbacks;
  - that `afterCommit` resumes inside the frame;
  - the props accessor;
  - the observer re-insert;
  - teardown order;
  - and the 1-held-frame claim.
- **Foldkit:**
  - the canary after 0.170.0 wasn't read;
  - `foldkit/experimental/server`'s render path and `hydrate.ts` were read only where cited;
  - Foldkit UI's `Animation` source wasn't read past its docs;
  - DevTools' replay was read only through the Mount and renderer code;
  - the examples (`map`, `charting`, `kanban`) were skimmed.
- **Effect:** `Stream.callback`'s 4.1 setup change was taken from Foldkit's CHANGELOG and the `d.ts`, not traced in `src`.
- **The browser:** the `MutationObserver` microtask is from the DOM Standard as known, not re-read for this note.
- **elm-animator:** read at its README, changelog and `Animator.elm` only. It's Elm; its CSS path (no clock subscription) and its timeline path (`onAnimationFrame` through `update` while running) are its two answers (`ea:changelog.md:3-28`; `ea:src/Animator/Timeline.elm:20-50`).
- **Costs:** none measured. Bundle sizes quoted are ADR-0041's and ADR-0067's, for Solid apps.

## Part F: Round 2 follow-ups (2026-11-08)

> **Read at:** 2026-11-08, after grill round 1. **Sources:** Part A's (`fk:`, `fkweb:`, `fkroot:` at `a471adb`, `fx:` 4.1.1, `wardic:` at `15f723d`), plus:
> - `main:` is `origin/main` at `a1f74c0`, read with `git show origin/main:<path>`, never checked out. ADR-0068, ADR-0069, ADR-0070 and `docs/research/canvas-environment.md` there.
> - `gh issue list --state open` and `gh api …/issues/564/sub_issues`, read only.
>
> Nothing was run. Claims reasoned rather than read are *inferred*; F.7 lists the probes that would settle them.

### F.0 G1 is superseded

- **D.11's G1** proposed lifting the spine and the Solid-free modules into "a framework-free package" (Q20 A).
- **ADR-0069 decision 2 decides otherwise:** "The spine and the Flush gate move into core's `internal/*`, behind ADR-0068's ports. Their DOM-named parts become Environment members the DOM fills (Own values, Measured pairs, Appear's handoff, Variables), so core keeps no DOM names (#609)." It rejects "`@wardic/object` … ; a package of their own" (`main:docs/adr/0069-wardic-three-core-api.md:23-24`).
- **ADR-0068's consequence 1** names the ports: an Own-values reader, Measured pairs as an Environment member, subject resolution, `HTMLElement` loosened to a Subject, and "its static `@wardic/dom` imports are cut" (`main:docs/adr/0068-wardic-three-objects-not-scene-components.md:69-75`). The probe behind them is the canvas note's P6 (`main:docs/research/canvas-environment.md:740-771`).
- So Q20's "lift first" (decided in round 1) now means: the spine into core, the DOM-bound modules into `@wardic/dom` for binding authors. F.4 places each module.

### F.1 (a) Foldkit's server render and hydration

**How a document is rendered** (`fk:src/experimental/server/server.ts:1383-1515`):
1. `init` runs; "Commands returned by `init` are not run" (`:1339-1340`, `:1434-1441`).
2. `runView` calls the view once, synchronously, under a no-op dispatch and `Context.empty()` as the captured context (`:1224-1246`). The bracket "must never interleave with another render's", and can't, since a view never suspends (`:1224-1233`).
3. The root is checked (`:1444-1446`), then `serializeHtml` writes the body (`:1459-1470`): attrs, class, dataset, property-backed attributes and inline style, in that order. "Event handlers and hooks are behavior, not markup, and are skipped" (`fk:src/experimental/server/serialize.ts:1105-1117`). No Mount runs on a server.
4. The markup is re-parsed with parse5 in both scripting modes and compared with the view (`server.ts:1474-1491`).
5. The result is `{ html: root + Flags script, title, lang, dir, canonical, ogUrl }` (`:1497-1513`; the type, `:1013-1020`).

**A channel for one `<style>` in `<head>`: none from the view.**
- The view's `Document` holds `title`, `lang`, `dir`, `canonical`, `ogUrl` and `body` only (`fk:src/html/index.ts:295-302`). `RenderedApplication` carries the same, plus `html` (`server.ts:1013-1020`).
- `html` must parse as one root element plus an optional Flags script. Template injection refuses any other top-level content (`fk:src/experimental/server/template.ts:697-707`), and `Server.renderDocument` goes through the same injection (`fk:src/experimental/server/document.ts:84`).
- **The server entry has one:** `Server.renderDocument(application, assets, { head })`, "Trusted HTML to add to the head" (`document.ts:36-41`, `:76`; `fkweb:core/serverRendering.md:132-138`; `fkroot:packages/website/src/snippet/serverRenderingDocument.ts:3-6`).
  - But the entry's `renderDocument` receives only the `RenderedApplication` (`fk:src/experimental/server/fetch.ts:28-31`), and `handleRequest` calls it after `await options.renderPage(request)` (`:142-148`).
  - So a render's CSS reaches it only if the app threads it: a field added to the application object, which TypeScript allows on a wider object (*inferred*), or module state across that `await`, unsafe with concurrent requests (*inferred*).
- **Content after the body is rendered:** none. Nothing runs between `runView` and `serializeHtml` that a library can hook (`server.ts:1442-1470`).
- **What works on the public API** (*inferred*; P14):
  - The provider builds a `<style data-wardic-appear-chunk>` as its **first child**. `h.style` exists (`fk:src/html/index.ts:3390`, `:3611`). A raw-text element's content is written verbatim (`serialize.ts:81-94`, `:1031-1038`), refusing only `</style` (`:106-114`), so CSS quoting survives (Solid's text escaping broke it: `wardic:docs/adr/0044-appear-animations.md:143`). The provider's builder runs after its children, so it knows the whole CSS (F.1, orchestration).
  - The client entry calls dom's `Appear.adoptChunks(document)` **before** `Runtime.hydrate`. It moves each chunk style into the head and removes the node (`wardic:packages/dom/src/internal/appear.ts:668-686`). The client's first render, which has no `<style>` child, then matches the served DOM.
  - That's ADR-0044 *Amendment (#245)* decision 4's mechanism, used for the whole page (`0044-appear-animations.md:205-209`, `:264`).
  - Without the adoption, hydration breaks the page: a first child whose tag differs clears the provider's children and rebuilds them (`fk:src/hydrate.ts:930-940`). A client render that kept the `<style>` would have to match its text, since a differing text is rewritten (`:861-866`).
  - As the first child, the rule arrives before the elements it animates, which is decision 3's reason for the head (`0044-appear-animations.md:40-41`).

**`h.Style` and `h.Prop` on the server.**
- **`h.Style` is serialized inline**, through `collectStyleAttribute` (`serialize.ts:459-468`, `:859-868`).
  - Every value must be a string with no `;` or `!` outside parentheses or quotes. Custom properties (`--…`) are allowed. `cssText` and snabbdom's lifecycle keys (`delayed`, `remove`, `destroy`) are refused (`fk:src/domReflection.ts:503-568`; `fkweb:core/serverRendering.md:592-594`).
  - The same check runs on the client when the element is built (`fk:src/html/index.ts:3201`).
  - `animation: var(--wardic-a3)` and `--wardic-a3: …` both pass.
- **`h.Prop` with a Wardic key is dropped.**
  - A non-custom element emits a property only if `isHtmlPropertyRepresentable(tag, name)` holds (`serialize.ts:399-405`; `fk:src/domReflection.ts:381-387`). A custom element emits only global attribute properties that aren't client-only (`serialize.ts:390-398`).
  - `h.Prop` marks its key client-only (`fk:src/html/index.ts:1380-1391`; `fk:src/propertyProvenance.ts:48-64`).
  - So a config under a Wardic key never reaches the markup. It is in the server vnode's `data.props`, which a builder walk can read (F.3).

**Hydration: how it adopts the server DOM** (`fk:src/hydrate.ts:30-57`, `:1079-1142`):
- It walks the first client render and the server DOM together and builds a clone tree pointing at the server's nodes. Then one ordinary `patch(clone, next)` attaches behaviour (`:38-50`, `:1126-1131`).
- **Structure:** a tag, namespace, key or identity mismatch at a child clears the parent's children, which are rebuilt (`:930-940`). Extra trailing DOM is removed (`:946-951`). A root mismatch replaces the root (`:1108-1121`). In development a warning is logged; production rebuilds silently (`fkweb:core/serverRendering.md:242`).
- **Attributes:** every server attribute is seeded into the clone, so the attributes module removes any the client render doesn't declare and writes the ones it does (`hydrate.ts:378-389`, `:430-455`).
- **Inline style, for an element whose style the view owns through `h.Style`** (`:401-403`, `:439-441`):
  - `seedStyle` seeds the element's **whole** inline style as the old vnode's, minus the properties the client declares (`:108-161`).
  - The declared ones are seeded too, but only if **every** declared value equals the server's (`:150-159`).
  - The style module then removes each server declaration the client render doesn't declare, and writes every declared one when any differed (`fk:src/snabbdom/style.ts:72-122`).
  - So hydration "avoids rewriting unchanged declarations" (`fkweb:core/serverRendering.md:594`), but **a declaration the client's first render lacks is removed**. A custom element is the exception: only its declared properties are seeded, so the component's own survive (`hydrate.ts:108-111`; `fkweb:core/serverRendering.md:616`).
  - For Appear, that means: the client's first render must declare the server's inline `animation` exactly, or hydration ends the CSS animation before the Handoff reads it (*inferred*; P15).
- **Not in a rAF.**
  - The first render, hydration included, is `render(initModel, …)` on the boot fiber (`fk:src/runtime/runtime.ts:786-788`). The hydrating patch is in that render (`fk:src/runtime/renderer.ts:430-455`).
  - The boot fiber starts inline: `runFork` evaluates at once (`fx:src/internal/effect.ts:5746-5756`, from `fk:src/runtime/start.ts:86-104`, `:174-184`). Only later renders are rAF callbacks (`renderer.ts:731-743`).
  - So hydration runs in the client entry's task, or in microtasks of it on Foldkit's scheduler (*inferred*: no asynchronous step was found on the hydrate boot path, `runtime.ts:428-470`).
- **`insert` hooks and Mounts:**
  - They are detached before the patch and fired after it in one pass, children first, in the order a fresh render creates them (`hydrate.ts:997-1043`).
  - Each `insert` acquires its Mount inline (`fk:src/html/index.ts:2525-2529`, `:2600`). Then `render`'s `ensuring` drains the Messages buffered meanwhile (`renderer.ts:512-518`), and init Commands fork after the render (`runtime.ts:848-881`).
  - So every Mount's synchronous acquisition runs before the first paint after hydration (*inferred*: same task). A Starting style a Mount applies at `insert` paints in that first frame.

**Variant orchestration: is ADR-0044 decision 5's `:root` trick still needed?**
- **On the server: not for its stated reason.**
  - Decision 5 exists because "Solid writes an element's `style` before rendering its children", so a parent's inline style can't know them (`0044-appear-animations.md:57-63`).
  - In Foldkit, JavaScript evaluates `h.div(attributes, children)`'s arguments before the call: a parent's builder receives its built children. The whole tree exists before serialization (`server.ts:1442`, `:1459`).
  - So the outermost Wardic builder (the provider) can walk the finished tree once. It can give every element its stagger slot, its group's total and every settle time, and write the full `animation` inline (*inferred*; F.3 option 2 is the walk).
- **The `<style>` is still needed** for the `@keyframes` rules, which inline style can't hold.
- **The custom property is still the better choice, for hydration:**
  - The client's first render must declare the same `animation` (above).
  - A full inline value makes that first client view redo the sampling and timings: 77–122 µs per distinct spec (`0044-appear-animations.md:103`).
  - `animation: var(--wardic-aN)` needs only `N`. dom's sheet already hands out that slot (`wardic:packages/dom/src/internal/appear.ts:534-548`).
- **A new constraint, from Foldkit's style module** (*inferred*; P15):
  - `N` must name the same element on both sides.
  - It must never pass to another element in a later client render. The style module writes any value that differs from the old vnode's (`style.ts:72-122`), and `release` only removed the inline `animation` (`appear.ts:737`). An element that gets another's slot would replay that element's animation, held by `fill: forwards`.
  - Ways out:
    - emit slots only in the hydrating render;
    - name slots by a stable identity (the key path);
    - or drop the `:root` slot declarations once every element has handed off.

### F.2 (b) Scene tests and Mounts

- **A raw `MountAction` can be resolved by name.**
  - The `OnMount` handler stamps `{ name, args }` on the vnode for any action, built with `Mount.define` or not (`fk:src/html/index.ts:2512-2521`). Scene collects these markers (`fk:src/test/scene.ts:301-330`).
  - `Mount.resolve` takes a Definition or an `AnyMount`, `{ name, args? }`, matched by name, and by `Equal.equals` on args when given (`fk:src/test/internal.ts:134-161`; `scene.ts:1087-1094`).
  - So `Mount.resolve({ name: "Wardic.Element" }, msg)` works.
  - `MountDefinitionTypeId` is public (`fk:src/mount/public.ts:8`), so Wardic could also brand its own Definition-like value, with no Schema (*inferred*: not a documented path).
- **Resolving always feeds a Message through `update`** (`fk:src/test/internal.ts:660-711`). The app needs a Message to give it.
- **What `Mount.define` and `Mount.defineStream` require:**
  - **`args`** (optional) are `Schema.Struct` fields.
  - **`messages`** is a **non-empty** tuple of Schemas (`fk:src/mount/index.ts:336`, `:350`, `:510`, `:524`).
  - **`execute`:** `define`'s returns `Effect<Message, never, Scope>`, "exactly one Message" (`:333-360`). `defineStream`'s returns `Stream<Message, never, never>` (`:507-534`).
  - **At runtime both read only whether `args` is present, and `execute`** (`:362-385`, `:536-560`). `messages` and the args Schema only type it.
  - The docs ask for a result Message even for fire-and-forget work, a `Completed*` that `update` ignores, for DevTools, Scene and replay (`:231-239`, `:422-430`).
- **How Foldkit UI exports its Mounts:**
  - The component module exports the Definition, and its own Message union has the result: `AnchorPopover`, with `messages: [Message.CompletedAnchorPopover]`, which the Popover's `update` ignores (`fkroot:packages/ui/src/popover/index.ts:404`, `:426-437`).
  - A consumer's test writes `Scene.Mount.resolve(AnchorPopover, CompletedAnchorPopover())` (`:427`; `fkweb:testingScene.md:223`, `:246`). The boundary mappers lift that child Message (`scene.ts:1080-1086`).
  - That works because a UI component is a Submodel with its own Message type. A Wardic element is part of the app's view and dispatches the app's Messages, so Wardic can't own the result Message.
- **No Scene option auto-resolves or ignores a family of Mounts.**
  - `scene` takes `{ update, view }` and steps (`scene.ts:3033-3108`).
  - Interactions throw while a Mount is unresolved, and the scene throws at its end (`fkweb:testingScene.md:225-231`).
  - `Mount.resolveAll` resolves only what's pending now (`scene.ts:1148-1157`), unlike Commands' resolvers, which carry across calls (`:1467-1471`).
  - A Mount that leaves must be acknowledged with `Mount.expectEnded` (`fkweb:testingScene.md:228`, `:244`).
- **A Wardic element's Mount in each form** (sketches, not compiled):
  - **The shared body:** the config isn't a Mount arg. Args are captured at insert, and DevTools records them on every mount (`fk:src/runtime/devToolsIntegration.ts:175-185`). The Mount reads the config from the element's `h.Prop` key, set at `create`, before `insert`, so one module-level action serves every element:

    ```ts
    const elementStream = <Message>(element: Element): Stream.Stream<Message> =>
      Stream.callback<Message>((queue) =>
        Effect.gen(function* () {
          const provider = yield* Provider.nearest(element) // DOM ancestry; waits for the provider's Deferred
          yield* Effect.acquireRelease(
            Effect.sync(() => provider.register(element, (message: Message) => Queue.offerUnsafe(queue, message))),
            (registration) => Effect.sync(registration.release),
            { interruptible: true }, // 0.170's advice for an asynchronous acquisition
          )
          return yield* Effect.never
        }),
      )
    ```
  - **Raw:** `{ name: "Wardic.Element", f: (element) => elementStream(element) }`. It needs no Schema. Its Message type is the app's, cast once inside `w`.
  - **`defineStream`:** `Mount.defineStream("Wardic.Element", { messages: [Schema.Unknown], execute: ({ element }) => elementStream(element) })`.
    - It brings Schema into Wardic's `src` only for a type that is never checked.
    - The Definition is typed `Stream<unknown>`, so `w` still casts it to the app's Message.
  - **`define`:** it doesn't fit. It produces one Message and then holds the Scope (`fk:src/mount/index.ts:170-187`), and Wardic's callbacks are many.
- **The minimum a Scene test writes** (sketch):

  ```ts
  // The app: one Message its update ignores (Foldkit's Completed* convention).
  CompletedWardic: () => ({ model }),

  Scene.scene({ update, view },
    Scene.Mount.resolveAll(
      [Wardic.Provider, CompletedWardic()],
      ...Arr.makeBy(model.cards.length, () => [Wardic.Element, CompletedWardic()] as const),
    ),
    Scene.click("#remove-c2"),
    Scene.Mount.expectEnded(Wardic.Element), // the removed card's
  )
  ```

  - Every interaction that renders a new Wardic element needs another `resolve` before the next one.
  - With no Wardic Definition exported, `{ name: "Wardic.Element" }` stands in.
- **What would shrink T6** (*inferred*):
  - **One Mount for the provider alone** doesn't work. Each element's Mount dispatches through its own Submodel-lifted dispatcher (`resolveMountDispatch.resolve()`, `fk:src/html/index.ts:2576`, `:2586-2588`). A provider-level Mount would send a Submodel's callback Messages unlifted.
  - **Callbacks as `CustomEvent`s** on the element, read by an `h.OnCustomEvent` the `w.*` builder adds, route through the element's own dispatcher (`fk:src/html/index.ts:972-975`, `:2488-2493`). Scene can emit a declared custom event (`fkweb:testingScene.md:280-286`; `scene.ts:1385-1444`), but its typed path is for `CustomElement.define`'s specs. The registration Mount stays either way.
  - **So T6 stays** unless Foldkit adds a Scene option to resolve a Mount family: a new ask, **U5**.

### F.3 (c) Variants down the tree with no context

**(1) DOM ancestry at mount.**
- **Client:** feasible. A child's `insert` runs before its parent's (A.4), and the parent's config is on its `h.Prop` key from `create`. The child's Mount walks `parentElement` to the nearest Wardic element with variants and gets or creates that parent's record.
- **Server:** gives nothing. No hook runs (`serialize.ts:1105-1107`).
- **Cost:** one walk per Variant child per mount.
- **Covers the mount half only:** the registry, stagger, `when` and gestures handed down (`wardic:packages/solid/src/variant-tree.ts:275-331`).

**(2) A builder-time walk.**
- **Reachable:**
  - `VNode` isn't exported by name, but `Html = VNode | null` is (`fk:src/html/index.ts:215`; `fk:src/html/public.ts:12-21`). Its fields, `data` and `children` included, are mutable (`fk:src/snabbdom/vnode.ts:23-35`).
  - Each element gets a fresh `data` object (`fk:src/html/index.ts:2763-2766`).
- **Three traps:**
  1. **The data mask.**
     - Modules run only for the data kinds whose bit is set on the vnode: skipped at `create` when the mask is 0, and per module at `update` (`fk:src/snabbdom/init.ts:231-236`, `:752-774`; `vnode.ts:11-21`).
     - The mask key isn't public. So a walk can only rewrite a kind the child already declared.
     - `w.*` always renders an `h.Style`, so its Style bit is set (*inferred*).
  2. **The same object.**
     - The style module returns at once when the old and new `style` are one object (`fk:src/snabbdom/style.ts:80`).
     - So a style object mutated in place, and shared by both trees, writes nothing.
  3. **Cached vnodes.**
     - A lazy hit returns the previous render's vnode object (`fk:src/html/lazy.ts:176-179`), and the patch skips it whole (`init.ts:740-742`). "The cached VNode must be rendered at a single position" (`lazy.ts:223-228`).
     - A mutation persists in the cache and never reaches the DOM.
     - Dedupe copies only the node shell, `{ ...node, elm: undefined }`, sharing `data` (`fk:src/vdom.ts:77-98`).
     - Foldkit copies rather than mutates a returned vnode for this reason: "so module-level cached vnodes a user might return from view are not contaminated" (`fk:src/html/submodel.ts:307-309`, `:336-339`).
- **So:**
  - copy on write along each stamped path;
  - and skip a subtree whose root has `.elm` set, which is a lazy hit or a constant from an earlier render (*inferred* heuristic: `memoizedVNodes` is internal, `vdom.ts:57`).
  - A skipped subtree is already mounted, so its Starting style no longer matters. A later name change reaches mounted children through the variant tree, at runtime (*inferred*).
- **Through plain elements:** the walk descends through any element, and through Wardic elements that inherit. It stops at one with names of its own, Motion's rule (`variant-tree.ts:1-20`).
- **Across a Submodel boundary:**
  - `h.submodel` runs the child's view inline and returns a fresh wrapper over the child's root, its children shared (`submodel.ts:391-414`, `:424-432`).
  - The walk sees through it, as Motion's context crosses components. A Submodel behind `createKeyedLazy` is a lazy hit, skipped as above.
- **Server:** exact.
  - No `.elm` is ever set there.
  - Lazy slots are module-level and can hit across requests (`lazy.ts:229-243`), so copying on write matters there too (*inferred*).
- **Cost** (*inferred*):
  - each element visited once per inheritance root per render;
  - allocations only along stamped paths;
  - one walk at the provider can serve both this and the Appear timings (F.1).

**(3) Thunk children, `w.ul(attributes, (w) => children)`.**
- **Both sides:** exact, with nothing mutated.
- **Memoization stays correct:** the child builder is cached per (`h`, names), so it's `===`-stable as a lazy's argument, and a change of names misses the cache (*inferred*).
- **Through plain elements:** fine, as long as their Wardic children use the builder passed in.
- **Across a Submodel:** only if passed in `viewInputs`, as a top-level slot function, since nested functions throw (`fkweb:core/submodel.md:157-158`).
- **Cost:** a second children type for variant parents. Motion's implicit propagation is lost across Submodels.

**(4) Explicit names** (`w.Inherit(names)`, or `w.Initial` repeated on each child):
- **Both sides:** works.
- **Cost:** verbose, and nothing like Motion.

**Foldkit's own channels:**
- `viewInputs`: parent-owned render data into a Submodel's view, rebuilt every render (`fkweb:core/submodel.md:137-150`).
- `childAttributes`: brands a child's attribute bundle with the child's dispatcher so a parent can spread it (`fk:src/html/childAttribute.ts:35-42`, `:70-87`; `fkweb:core/submodel.md:351-386`).
- Nothing implicit is public. The process-wide frame stack carries only dispatch and boundaries (`fk:src/html/runtimeSingleton.ts:26-138`, set by `setRuntime`; `server.ts:1238-1240`). "Never store [`h`] in module state" (`fkweb:core/submodel.md:349`).

**Where this leaves Q12** (*inferred*):
- (2) covers render: the Starting style and the server's Appear groups.
- (1) covers mount.
- Together they answer ADR-0045's reason for a context, "the Starting style and Appear groups need the parent during render" (`wardic:docs/adr/0045-solid-2-binding.md:25`), with Motion's implicit propagation kept.
- (3) is the fallback if P16 finds the walk's traps unworkable.

### F.4 (d) Where the lift's modules go

**What ADR-0068 and ADR-0069 say:**
- **ADR-0069 decision 2:** the spine and the Flush gate go to core's `internal/*`. Their DOM-named parts become Environment members: Own values, Measured pairs, Appear's handoff, Variables (`main:docs/adr/0069-wardic-three-core-api.md:23-24`). It's step 1 of the build order (`:132-133`).
- **ADR-0068's ports:** Own values, Measured pairs, subject resolution, `HTMLElement` loosened (`main:docs/adr/0068-wardic-three-objects-not-scene-components.md:69-75`). Decision 3 replaces the `nodeType` checks with the Environment's is-Subject check (`:36-37`).
- **ADR-0070:** variants and stagger pass down nested Scene objects "through the variant context Wardic elements use" (`main:docs/adr/0070-wardic-three-solid-binding.md:55`). A Scene object carries `style` and `drag` (`main:docs/adr/0068-wardic-three-objects-not-scene-components.md:101`), and drags in 3D (`main:docs/adr/0070-wardic-three-solid-binding.md:76-81`).
- **The canvas note:**
  - P6 ran `imperative.ts`'s plain path on an `Object3D` and found those ports. It didn't run the Wardic-element path (presence, drag, Appear, Live values), "which holds most of `spine.ts`'s DOM-named code" (`main:docs/research/canvas-environment.md:740-771`).
  - Part 6 turned the recommendation into "step 1 moves the spine" (`:556-567`). Part 7 is a sketch (`:571-628`).

**How a separate binding package imports each place:**
- **Core's internals:** `exports["./internal/*"]` is `null` (`wardic:packages/core/package.json:51`), so `@wardic/core/internal/…` doesn't resolve outside core (`wardic:docs/agents/pipeable.md:12`, `:59`).
- **dom's internals:** the same (`wardic:packages/dom/package.json:50`), and lint rejects the import (`wardic:eslint.config.js:58-61`).
- **Today no package imports another's internals** (grep of `packages/*/src`: none). Solid reaches dom's implementations through public modules that re-export them, such as `@wardic/dom/FlushGate` over `internal/gate.ts` (`wardic:docs/adr/0041-dom-api.md:189-191`).
- **So "core's `internal/*`" can serve `@wardic/solid` and `@wardic/foldkit` only through public core modules that re-export the implementation,** as dom's do: Tier 2, for binding authors (*inferred*: ADR-0069 names no such module).
  - Below, "core" means implementation in `packages/core/src/internal/`, reached through a Tier 2 module whose name is still to grill (`@wardic/core/Spine`, say).
  - A dom placement is reached as `import * as X from "@wardic/dom/X"`, ADR-0041's audience (`0041-dom-api.md:32-33`).

**Per module.** What it uses of the DOM and why, whether it's "the spine" in ADR-0069's sense, and a proposed home. All proposals are *inferred*.

| Module | Its DOM, and what for | The spine? | Proposed home | `@wardic/foldkit` imports |
|---|---|---|---|---|
| `spine.ts` | `Appear.release`/`matches`: the Handoff (ADR-0044 d6). `OwnValues.of`/`styleValueOf`/`valueLike`: a key's start from computed style or the `style` prop (`:1758-1771`, `:2919`, `:3142-3158`). `MeasuredPair.needs`/`measure`: `auto`/`%` pairs in px (`:1200-1222`). `Variables.values`/`isValue`: custom properties as Key rules (`:712-722`, `:1976`). `DomRenderer.TEMPLATE_KEY`/`heldTransformOf`: `transformTemplate`, a layout node's held transform (`:3333-3360`). `Style.starting`: the server's Starting style (`:3303-3315`). `Style.dragDefaults`, `applyDragDefaults` writing `element.style` and `draggable` (`:3418-3423`). `FlushGate` types: the gate. `Report`: logging only. `HTMLElement` in signatures (`:1212`, `:1758`, `:1785`, `:1850`). | **Yes** | **core**, behind the ports. Its DOM edges (`releasingAppear`, `checkHandoff`, `serverStartingStyle`, `drawnAtRest`, `withTemplate`, `heldTransformFor`, `followTemplate`, `applyDragDefaults`, `isLayoutNode`) go to **dom** as the members' DOM implementation. | core Tier 2; the edges from `@wardic/dom/<Module>` |
| `retarget-legs.ts` | `MeasuredPair.measured`/`Requested`: a Measured pair's own leg (`:643`, `:679`). `Style.Stops`: a type, pure. | **Yes**: the legs of a Retarget, which a server's Appear sampler also builds (ADR-0044 d8, `0044-appear-animations.md:79`) | **core**, Measured pairs through the port | core Tier 2: the spine, and the binding's server Appear |
| `variant-target.ts` | `Style.splitValues`/`valuesAt`/`toValues`/`Stops`: pure values and Keyframes helpers that live in dom's Style (`wardic:packages/dom/src/internal/starting-style.ts:32-163`). | Adjacent: the spine resolves targets with it (`spine.ts:97`) | **core**. The pure helpers move from dom's Style to core, and dom's Style re-exports them. | core Tier 2 |
| `variant-tree.ts` | `Style.resolveInitial` only, pure (`starting-style.ts:216-221`). `Stagger` is core's. | Not named, but the spine imports it (`spine.ts:71-96`), and scenes need it (ADR-0070 `:55`) | **core** | core Tier 2 |
| `presence-record.ts` | Types only: `element: HTMLElement`, `Style.Stops`, `Box`. | The record the spine writes (`spine.ts:66`) | **core**, its element a Subject | core Tier 2 |
| `presence-controller.ts` | Puts a leaver back where it was (`parentNode`, `nextSibling`; `:258-270`). `popLayout`'s pin: `getComputedStyle`, `offsetParent`, `!important` styles (`:279-340`). `instanceof HTMLElement` (`:253`). `MeasuredPair` for exits (`:224`). `Variables.values`. `ProjectionSystem.Shape` (`:539-540`): `handBackWithin`, `keepLeaving`, `registerValues`, `keepSeen`, `awaitsTwin`, `handleLeave`, `rootBoxOf`, `dropLeaver` and `notify`, for layout leavers and twins (`:743-1375`). | No | **dom**, a binding-author module beside `@wardic/dom/ReorderController`, the precedent: `@wardic/dom/PresenceController`. A scene's presence is simpler (ADR-0068 d8). | `@wardic/dom/PresenceController` |
| `drag-track.ts` | `getBoundingClientRect` for `snapToCursor` (`:417`). Constraint containers as `Element`s, watched for resizes (`:682-718`). `ProjectionSystem.DragHandle`/`DragTransition`: a layout node drags through its projection (`:133`, `:180`, `:344-485`). `FlushGate.Shape`: the direct-set `x`/`y`. `Report`. | No | **dom** for now (`@wardic/dom/DragTrack`). ADR-0070 d9's scene drag may later want its release and takeover half behind a constraints port. | `@wardic/dom/DragTrack` |
| `gesture-features.ts` | None: core's `InputSource`, `Context` lookups, and the words development's message uses. | No | With `feature.ts` | as `feature.ts` |
| `live-style.ts` | `Style.over`: a `style` given as CSS text, parsed to a record (`:182`). `Style.toValues`: pure (`:200`). will-change: `createWillChange` and the compositor set (`:399-442`). | Read by the spine (`spine.ts:65`) | **core**: Live values in `style` are every binding's (ADR-0043 d2), and a Scene object takes `style`. CSS text and will-change become DOM-filled members. | core Tier 2 |
| `imperative.ts` | Subject resolution: `document`/`querySelectorAll` for a selector, the `nodeType` check (`:229-236`). `Element` WeakMaps (`:54`, `:92`). `as HTMLElement` (`:110`). `FlushGate.Shape`. `Report`. | **Yes**: ADR-0068's subject resolution; P6 ran its plain path | **core**. Selectors and the is-Subject check come from the Environment (ADR-0068 d3). | core Tier 2; the binding's `Wardic.animate` (F.6) |
| `feature.ts` | `Color.spacesRegistered`: development's check for a wide-gamut colour on a page with only sRGB registered (`:325-339`). `Report`. Typed on `ManagedRuntime` (`ProviderRuntime`, `serverRegistry`: `:24`, `:310`) and `OwnerScope`. | No | **dom**, a binding-author module, its runtime loosened to the Runner shape. The DOM's Features (gestures over `DomInput`, `layout` as `DomProjectionSystem`, colours) are the DOM's. | `@wardic/dom/<Features module>` |
| `config.ts` | Types only: `csstype` CSS properties (`:13`, `:35`), `DomRenderer.LengthKey`, `TransformTemplate`, `ProjectionSystem.ScaleCorrector`, the gesture callbacks' `PointerEvent`/`KeyboardEvent`/`FocusEvent` (`:707-714`; `gesture-info.ts:53`), the viewport's `Element` root (`:31`). | The spine's config contract (`spine.ts:54-62`) | **Split.** The transition, variant and target types, generic over their keys, go to **core**. `WardConfig` with CSS keys, DOM events and the layout and drag props goes to **dom**. | type imports from both |
| `motion-props.ts` | None: Motion's prop names (`MOTION_PROPS`, `:122`) and Solid's prop split into a config accessor (`:253`). | No | Stays in **`@wardic/solid`**. The name list could sit beside dom's `WardConfig` if Foldkit's `w.*` factories are generated from it. | none, or dom |
| `runtime.ts` | `FlushGate.layer`/`inert`: the gate. `ProjectionSystem`: the `layout` Feature's service and options (`:92`, `:367-399`). `requestIdleCallback` (`whenIdle`, #535: `:330-344`). `ManagedRuntime`: Solid's non-Effect edge (`:85`, `:98`). | Partly: `WardicServices` (`:72-82`) and the runner the spine takes (G2) | **Split.** `WardicServices`, core services only, and a `Runner` shape (`runSync`/`runFork`) go to **core**. The `ManagedRuntime` provider, `clientContext`/`serverContext` and `whenIdle` stay in **`@wardic/solid`**. `@wardic/foldkit` builds its own provider inside Foldkit's runtime (round 1). | core Tier 2 (types) |
| `reactivity.ts` | None. | The port that the spine, the variant tree, live style and Features take | **core**; each binding implements it | core Tier 2 (type) |

**What the moves imply** (*inferred*):
- **dom's Style splits.** `toValues`, `splitValues`, `valuesAt`, `keyframesOf`, `Stops`, `StopAt` and `resolveInitial` are CSS-free Keyframes and values rules (`starting-style.ts:32-221`). `over`, `without`, `heldTouches`, `starting` and `parseCssText` are CSS.
- **`Report` has no DOM** (`wardic:packages/dom/src/internal/report.ts:1-60`). Core doesn't report today ("Core doesn't report", `:1-4`), so a spine in core either reports through it as an internal or takes a reporter.
- **Core's code under `#609`** can't import `csstype` or dom's types, even as `import type`. Hence `config.ts`'s split.

**The `Reactivity` port** (`wardic:packages/solid/src/reactivity.ts:9-29`):
- **What it asks of a host:**
  - `untrack(fn)`;
  - `trigger()`, `{ track, notify }`: a computation that called `track` re-runs on `notify`;
  - `watch(accessor, onChange)`: each later value, never the first, until the returned stop, in a root no owner disposes.
- **Solid 1** (`wardic:packages/solid/src/solid-reactivity.ts:9-21`):
  - `untrack` is Solid's;
  - `trigger` is an `equals: false` signal;
  - `watch` is `createRoot` around `createComputed(on(accessor, onChange, { defer: true }))`.
- **Solid 2** (`wardic:packages/solid/src/unstable/v2/solid-reactivity.ts:55-69`):
  - the same `trigger`;
  - `watch` is a deferred `createEffect` in a `createRoot` run under the ward's owner, transparent to hydration ids (`:21-29`), so it ends with the ward.
- **Its callers:**
  - the spine (`untrack`; `watch` for `transformTemplate`, `spine.ts:3367-3379`);
  - the variant tree: accessors for `index`, `total`, `variant`, `stagger`, `when`, `childrenMayStart` and `allChildrenSettled`, and `untrack` (`variant-tree.ts:49-50`, `:277-331`, `:441-487`);
  - live style (`watch` per accessor-valued key, `live-style.ts:280`);
  - Features (`trigger` for lazily loaded ones, `feature.ts:170-185`).
- **A Foldkit implementation** (*inferred*; P17). Foldkit has no reactive graph, so it's a re-check after each delivery:
  - `untrack: (fn) => fn()`;
  - accessors are getters over the latest config the element's `h.Prop` accessor received;
  - `watch` adds the accessor to its host's list. After each delivery and each `notify`, it re-reads it and calls `onChange` when the value differs (`Equivalence.strictEqual`). The stop removes it.
  - `trigger` is `{ track: constVoid, notify }`, `notify` re-checking its host's watches.
  - Its cost is one accessor read per watch per render. Live values stay Atoms on the registry, not watches (ADR-0043).

**An issue for ADR-0069's step 1: none open.**
- Open issues (`gh issue list --state open`): #665 (the batch), #654, #653, #566, #565, #564, #563, #562, #561, #560, #533, #516, #240, #175, #16.
- #564 (milestone "1.5: beyond the DOM") is the umbrella. Its comment says "the first step is moving `spine.ts` out of `@wardic/solid`, behind those ports". It has no sub-issues (`gh api …/issues/564/sub_issues`: empty).
- #16 is the projection system's lift, parked.
- So the lift Q20 makes #561's first step has no issue yet.

### F.5 (e) Tracer and References

- **An app sets services for its runtime in one place: `resources`** (`fk:src/runtime/runtime.ts:214`), a `Layer` built once into the runtime's Scope (`fk:src/runtime/resourceProvider.ts:79-103`).
  - Flags, Commands and Subscriptions run under it, through `Effect.provideContext` (`:150-184`).
  - A Command's own span is opened inside that provision: `command.effect.pipe(Effect.withSpan(command.name, …), provideAllResources)` (`runtime.ts:692-697`).
  - `Tracer.Tracer` is a `Context.Reference` (`fx:dist/Tracer.d.ts:624`). So a `resources` Layer that provides a Tracer traces Commands and Subscriptions, their spans included (*inferred*).
  - Foldkit's docs mention spans only for HTTP: "a Foldkit app nests it under the Command span" (`fkweb:core/http.md:21`). There's no tracing option or guide.
- **No option sets a Reference on the runtime's own fiber.**
  - The program's options are `subscriptions`, `container`, `hydration`, `routing`, `crash`, `slow`, `viewTransition`, `freezeModel`, `preserveScroll`, `resources`, `managedResources` and `devTools` (`runtime.ts:104-224`).
  - `run`, `hydrate` and `embed` build the root effect themselves: `BrowserRuntime.runMain(provideBrowserScheduler(…))` (`fk:src/runtime/start.ts:86-104`, `:268-269`).
- **A Mount's context doesn't carry what the app set.**
  - It is the render's: the runtime context captured once in the boot fiber (`runtime.ts:617-620`), with Dispatch, MountTracker and MountRuntime (`fk:src/runtime/renderer.ts:525-533`).
  - It has Foldkit's scheduler, `RenderCommit` and `DialogRuntime` (`runtime.ts:892-902`), Effect's defaults, and no `resources`.
- **So a Wardic Layer built inside a provider's Mount doesn't inherit the app's Tracer.**
  - It gets Effect's native one.
  - Wardic's core opens spans only under a non-native Tracer (C12), so it would open none.
- **What it means for the binding** (*inferred*):
  - **Q8 A stands.** The app hands the provider its Tracer with the rest of its Environment (`w.Env(…)`, as Solid's `env`).
  - **The same Layer given to `resources` and to the provider builds twice.** The Mount's context has no MemoMap, and `Layer.build` makes a fresh map when there's none (`fx:src/Layer.ts:601-604`, `:815-828`). An app shares one tracer by making the instance once, at module scope, and giving `Layer.succeed(Tracer.Tracer, tracer)` to both.
  - **A span doesn't cross from a Command into Wardic's runner.** A Wardic Command's span (F.6) is under `resources`' Tracer, but the Legs it starts fork on the provider's runner, under the provider's context, so their spans don't parent to it unless passed.
  - **The clean fix is U1.** Mounts that get `resources` would let one Layer carry the Tracer to both.

### F.6 (f) Commands as a library would define them

- **`Command.define(name, { args?, messages, interrupt?, execute })`** (`fk:src/command/index.ts:220-389`):
  - `args` are `Schema.Struct` fields. Omit them and `execute` is a bare Effect; declare them and `execute` receives the args, suspended until the runtime runs it (`:116-128`, `:303-325`).
  - `messages` is a `ReadonlyArray<Schema.Top>`, not required non-empty, unlike a Mount's (`:223`, `:279`). It only types `execute`'s result, as `Eff extends Effect<Schema.Type<Messages[number]>>` (`:226`).
  - **At runtime only `args`' presence, `interrupt` and `execute` are read** (`:303-389`). Neither Schema is ever decoded.
  - `interrupt` adds an `Interrupt` constructor (`:144-160`, `:328-388`).
- **The `Command` type itself is a plain record:** `{ name, args?, key?, effect: Effect<Message, E, R> }` (`:12-24`). `update` returns `ReadonlyArray<Command<Message, never, R>>`, so `E` must be `never` (`fk:src/update/update.ts:16-18`, `:37-39`).
  - "Commands built by hand (not via `define`) carry no chain; readers treat its absence as an empty chain" (`command/index.ts:38-40`). A library can therefore build Commands with no Schema.
  - `CommandDefinitionTypeId` is public (`fk:src/command/public.ts:9`), with the brand's shape at `fk:src/command/brand.ts:13-21`. A library can brand its own Definition for Scene's name matching (*inferred*: undocumented).
- **Can a library's Command take the app's Message constructors as arguments?**
  - **With `define`:** only as args fields typed by a Schema for a function (`Schema.Any`, a `declare`), which is never checked.
  - But args become span attributes (`runtime.ts:692-695`), DevTools records them as they are (`fk:src/runtime/devToolsIntegration.ts:91-95`), and Scene compares them with `Equal.equals` (`fk:src/test/internal.ts:94-101`). A function there is noise in all three (*inferred*).
  - **Hand-built:** the Messages are closed over by `effect` and kept out of `args`, which stay data (a provider id, a selector).
- **Foldkit's own `Dom` helpers aren't Commands. They're Effects an app wraps:**
  - `Dom.focus(selector, options?)` and `Dom.scrollIntoView` are `Effect<void, ElementNotFound>`. They wait for `afterCommit`, then query (`fk:src/dom/dom.ts:329-340`, `:678-686`). `scrollIntoViewAfterPaint` waits for `afterPaint` (`:709-717`). `ElementNotFound` is a `Data.TaggedError` (`fk:src/dom/error.ts:4-6`).
  - `Dom.waitForAnimationSettled(selector)` is `Effect<void>`: `Effect.callback`, one rAF, then `Promise.allSettled` of `getAnimations()`'s `finished`. It hangs on an infinite animation (`fk:src/dom/waitForAnimation.ts:3-31`).
  - The app makes the Command and its Messages: `Command.define('FocusEmailInput', { messages: [Focused], execute: Dom.focus('#email-input').pipe(Effect.ignore, Effect.as(Focused())) })` (`fkroot:packages/website/src/snippet/domFocus.ts:4-7`; `fkweb:core/dom.md:19-23`). "Dom helpers include the timing their operation needs" (`:42`).
- **Two shapes for Wardic's imperative calls** (*inferred*):
  - **A. Effects, Foldkit's `Dom` idiom.** `Wardic.animateLayout(provider)` would be an `Effect<void, ProviderNotFound | LayoutFailed>`, which the app wraps in `Command.define` with its own Messages. Wardic takes no Message constructors. Defects are caught inside and surface as the typed errors.
  - **B. Commands that always answer** (round 1's decision), hand-built, with branded Definitions for tests. Shape A's Effects are what B's Commands run.
- **A Command's moment:** it starts one microtask after `update`, before the frame's patch (`runtime.ts:658-716`). So a Wardic Command that needs the new DOM waits for `Render.afterCommit` itself, as `Dom.focus` does. Anything that escapes paints the crash view (`runtime.ts:711`).

```ts
// @wardic/foldkit/Wardic: sketches, not compiled. Hand-built, so no Schema; Messages closed over, args data only.
export const animateLayout = <Message>(options: Readonly<{
  provider: string
  onSettled: Message
  onFailed: (failure: Wardic.Failure) => Message
}>): Command.Command<Message> => ({
  name: "Wardic.AnimateLayout",
  args: { provider: options.provider },
  effect: Provider.find(options.provider).pipe(        // Effect<Provider, ProviderNotFound>, a registry by id
    Effect.flatMap((provider) => provider.animateLayout), // refresh the Measurements, afterCommit, notify, await settle
    Effect.as(options.onSettled),
    Effect.catchCause((cause) => Effect.succeed(options.onFailed(Wardic.failureOf(cause)))), // reported on the provider's runner
  ),
})

export const animate = <Message>(options: Readonly<{
  provider: string
  target: string // a selector, as Dom's helpers take
  values: Wardic.TargetValues
  transition?: Wardic.Transition
  onEnded: (end: Wardic.AnimationEnd) => Message // Landed | Stopped | Cancelled | Failed
}>): Command.Command<Message> => ({
  name: "Wardic.Animate",
  args: { provider: options.provider, target: options.target },
  effect: Provider.find(options.provider).pipe(
    Effect.flatMap((provider) => provider.animate(options.target, options.values, options.transition)), // afterCommit, query, the core animate, its end
    Effect.map(options.onEnded),
    Effect.catchCause((cause) => Effect.succeed(options.onEnded(Wardic.AnimationEnd.Failed({ reason: Wardic.failureOf(cause) })))),
  ),
})

// In update:
ClickedShuffle: () => ({
  model: { ...model, order: shuffle(model.order) },
  commands: [Wardic.animateLayout({ provider: "app", onSettled: SettledShuffle(), onFailed: (failure) => FailedShuffle({ failure }) })],
}),
// In a Scene test: Scene.Command.resolve(Wardic.AnimateLayout, SettledShuffle())
```

- **Each sketch's own catches** (*inferred*):
  - **The Legs run on the provider's runner, not the Command's fiber.** A child of a Command fiber ends with it. So the provider's methods fork onto its `FiberSet` and await only the end, all in Effect, with no `run*`.
  - **`animate` must observe more than `finished`.** Motion's `finished` "resolves at a landing or `complete()`, never at a `stop()` or a `cancel()`" (`wardic:packages/solid/src/imperative.ts:14-16`). A Command awaiting it alone could never answer, and its fiber would wait in `runtimeScope` for the app's lifetime.
  - **A taken-over key is the open risk.** The canvas note's P6 saw an earlier call's controls still read `state: "running"` after a third call took its key and everything landed (`main:docs/research/canvas-environment.md:771`). `animate`'s `Stopped` answer would hang on the same case (P18).

### F.7 Not verified, and the probes that would settle it

- **P14.** A provider-first `<style data-wardic-appear-chunk>`, adopted into `<head>` by `Appear.adoptChunks` before `Runtime.hydrate`:
  - hydration adopts every element, with no rebuild;
  - the CSS animation runs on through the adoption.
- **P15.** A server element with inline `animation: var(--wardic-aN)`:
  - with the client's first render declaring the same, nothing is rewritten and the CSS animation survives hydration;
  - with it missing, the declaration is removed;
  - an `N` shifted on a later render replays another element's animation.
- **P16.** The builder-time walk:
  - mutating a `w.*` child's `data.style` reaches the DOM on `create` and `update`;
  - a lazy hit's subtree is skipped by its `.elm`;
  - nothing leaks into the lazy cache, a module constant or `h.submodel`'s wrapper.
- **P17.** The Foldkit `Reactivity` over deliveries:
  - Solid's variant-tree and live-style tests, run through it.
- **P18.** `animate`'s controls:
  - the end of a run whose keys another run takes over, as a Command would await it.
- **Not read:**
  - the boot path for an asynchronous step between `Runtime.hydrate` and the first render, beyond `runtime.ts:428-470`;
  - Scene's `CustomElement.emit` on a plain element's `OnCustomEvent`;
  - whether a function-valued span attribute reaches an exporter;
  - Effect 4's `Equal.equals` on a Message value in Command args.
- **Not decided here:**
  - the names of core's Tier 2 modules for the spine, the gate, the variant tree and `animate`;
  - the split of dom's Style;
  - where Features' mechanism ends up if a scene binding needs it.

## Part G: Decisions so far (the grill, rounds 1–5, 2026-11-08/09)

Settled answers, in the grill's numbering (R = round). "Yes" accepts the recommendation as asked. This is the record an ADR for `@wardic/foldkit` would be written from.

### Scope and strategy

- **Parity** (R1 Q1): Motion React parity, as 1.0 set for Solid, delivered in slices: elements and `animate` first, then presence and layout, then the rest.
- **Server rendering is in 1.2** (R1 Q2, reversed: "this just makes initial to animate cycles flicker"). The server renders as Solid's does, Appear included (R2 Q4).
- **Public API now** (R1 Q3, A). Each workaround sits behind one internal module. Upstream asks are drafted for review and never posted without approval:
  - U1: Mounts get `resources`;
  - U2: an `argsChanges` Stream;
  - U3: `h.OnRemove`;
  - U4: `Render.commits` and `beforeCommit`;
  - U5: a Scene option that resolves a family of Mounts;
  - U6: a head channel from the view (R3 Q7).
- **Probes before the API round** (R1 Q4).

### The lift

- **The lift comes first** (R1 Q5): ADR-0069 decision 2's move, made now (R2 Q5, R3 Q1, R4 Q1). Filed as **#672** (a sub-issue of #561, milestone 1.2).
- **Published under `@wardic/core/unstable/<Module>`** (R3 Q2 revised, A): public, no semver promise. Recorded as an ADR-0069 Amendment. `@wardic/foldkit` joins the Changesets fixed group.
- **A move plan comes before any code** (R2 Q6).

### Effect semantics

- **One Wardic runtime, inside Foldkit's** (R1 Q6).
  - **A handle** made at module scope: `Wardic.make({ env, features })`.
  - **A provider attribute** on a `w.*` element at the top (R2 Q1; R3 Q7 makes it a `w.*` element). Its Mount runs `Layer.buildWithScope` and completes the handle's `Deferred`.
  - **`resources: wardic.resources`** hands the handle to Commands.
- **The scheduler:** keep Foldkit's (R1 Q7). P9 confirmed it.
- **Fibers are split** (R1 Q8): the element's Mount Scope holds its registrations, and the provider's runner holds its Legs, so an exit outlives `destroy`.
- **Failures** (R1 Q9) are contained at the binding's edge, and every Command answers.
- **No Schema in `src`** (R1 Q10). Hand checks are shared across bindings, recorded as a deliberate deviation from the skill (ADR-0067 decision 9), with Schema only where Foldkit's API asks for it.
- **An Effect-typed public surface** (R1 Q11): `Option` where a callback may give nothing.
- **Live values are Atoms** (R1 Q12), with the registry in Wardic's one Layer.
- **Tracing** (R1 Q13). The Layer inherits the building fiber's References, and `env` overrides them (R2 Q2).
  - Mounts never see `resources`, so the app's Tracer comes in through `env` (F.5). That's documented as a deviation until U1.

### The API

- **Naming elements** (R2 Q3): the builder `w.div(attributes, children)` and `w.keyed(tag)(key, …)`, with Motion's names in PascalCase.
  - Any element can take the bundle `Ward.attributes(config)` instead.
  - `w.*` merges the Starting style under the user's `h.Style` and fuses its Mount with the user's `OnMount`.
- **DevTools replay lands everything at once** (R2 Q7).
- **Variants down the tree** (R3 Q6): a builder-time walk, copy-on-write, that skips mounted subtrees, plus DOM ancestry at mount. Thunk children are the fallback if P16 fails.
- **Appear's CSS** (R3 Q7): a first-child `<style data-wardic-appear-chunk>` from the provider, and `Appear.adoptChunks(document)` before `Runtime.hydrate`, with stable slot names (P15).
- **Scene tests** (R3 Q8): raw Mounts exported as `Wardic.Provider` and `Wardic.Element`, plus U5.
- **Imperative calls** (R3 Q9) are Effects with typed errors (`Wardic.animateLayout`, `Wardic.animate`), which the app wraps in `Command.define`.
- **Callbacks** (R4 Q3) take a Message, or `(event, info) => Message | Option<Message>`, for every event callback and presence's `onExitComplete`.
- **The four that aren't events** (R4 Q4):
  - `onMeasureDragConstraints` is a pure function;
  - `onUpdate` is an Atom sink, `w.OnUpdate(atom)`;
  - `onBeforeLayoutMeasure` and `onLayoutMeasure` are plain functions that can't dispatch.
- **`onDrag` and `onPan`** send a Message per pointer event (R4 Q5), and `Option.none()` skips one.
- **Config** (R4 Q10): defaults in `Wardic.make`, and a `w.Config(…)` attribute for a subtree, found as variants are and read at each animation start.
- **Live values in the view** (R4 Q11):
  - `w.Style` takes Atoms;
  - core's `LiveValue` helpers are made at module scope;
  - `w.Text(atom)` writes `textContent` outside the patch.
- **`w.DragConstraints`** (R4 Q12) takes a box, `"parent"` or a selector, measured at each drag start.
- **Drag controls** (R4 Q13): `DragControls.make()` at module scope, with `w.DragControls(handle)` and `w.StartsDrag(handle)`. The handle element's pointerdown is a Wardic Feature (ADR-0060).
- **Reorder** (R4 Q14): the attributes `w.ReorderGroup({ values, axis, onReorder })` and `w.ReorderItem(value)`, with the order kept in the Model.
- **Re-renders** (R5 Q15) reach the ward through a `CustomElement.define` property factory, compared by `sameResolution` (#470). U2 is the upstream ask.
- **Identity** (R5 Q16): every `w.*` element stamps a Foldkit identity with `foldkit/brand`'s `brandViewResult`, so it never inherits a plain node.
- **Leaver order** (R5 Q17): re-placed by `orderOf` after each patch that moves its siblings, **once P19 confirms it** never fights the next patch.
- **`viewTransition`** (R5 Q18): the app wraps its predicate in `wardic.viewTransition(…)`. In a transitioned render, layout moves and `layoutId` handovers land at once.
- **Layout triggers** (R5 Q19): a `MutationObserver` on the provider's subtree runs a pass after each patch that changed the DOM, on top of Solid's triggers, **once P13 shows its cost**.

### Round 6 (2026-11-09)

- **Placement** (R6 Q21): F.4's table.
  - **To core:** spine, retarget-legs, variant-target, variant-tree, presence-record, live-style, imperative and the `Reactivity` port, under `@wardic/core/unstable/<Module>`.
  - **To dom:** presence-controller, drag-track, feature and gesture-features, under `@wardic/dom/unstable/<Module>`.
  - **`config` splits:** the generic types go to core, and `WardConfig` to dom.
  - **`runtime` splits:** `WardicServices` and the `Runner` shape go to core, and the `ManagedRuntime` provider stays in solid.
  - **`motion-props` stays** in solid.
  - **dom's `Style` splits:** its pure Keyframes and value helpers go to core, re-exported by dom.
- **`Report` moves to core** (R6 Q22, A) as `@wardic/core/unstable/Report`, re-exported by `@wardic/dom/Report`. Recorded as an ADR-0030 Amendment: the engine doesn't report; the spine does, as a binding boundary.
- **`Reactivity` in Foldkit** (R6 Q23, A): watches are re-checked after each delivery and each `notify`, compared with `Equal.equals`. P17 checks it.
- **Presence** (R6 Q24) is `w.Presence({ mode, initial, custom, onExitComplete, presenceAffectsLayout, propagate, anchorX, anchorY })` on the leavers' parent.
- **LayoutGroup** (R6 Q25, A) is `w.LayoutGroup({ id, inherit })`, found the way variant names are.
- **Peers** (R6 Q26, A): `foldkit` on tested minors only (`~0.170.0`, widened per tested minor), a weekly CI run against `foldkit@latest`, and `effect` at `^4.1.1`.
- **The record** (R6 Q27, A): one docs PR when the grill ends, holding:
  - ADR-0071;
  - the ADR-0069 and ADR-0030 Amendments;
  - `packages/foldkit/CONTEXT.md`;
  - both research notes.
- **Re-check against the Blocks and Layers preview:** Q24–Q26 depend on Foldkit's API, so they're settled for 0.170 and checked again once `foldkit-blocks-preview.md` is in.

### Round 7 (2026-11-09): the lift's move plan

- **The move plan is accepted:** `docs/research/lift-672-move-plan.md`.
  - **The ten modules Q21 left out** (R7 Q28): `appear.ts` splits (its handoff half to core, its sampler to dom). To core: `animation-controls`, `frame-time` and `wardic-config-value`. To dom: `server-interpolators`, `instant`, the drag helpers, `gesture-info` and `owner-scope`.
  - **The ports beyond ADR-0068** (R7 Q29): the Transform template as a member of the Renderer port; the server's Starting style; drag defaults, filled by dom's drag Feature; and the gate's inline read, as a member of Own values.
  - **How the spine reaches them** (R7 Q30): each port is a `Context.Service` in core, filled by `DomLive`, and resolved once into `WardicServices` when the provider builds. No element does a Context lookup.
  - **Five PRs** (R7 Q31), with the ports put in place while the spine is still in solid (PR 2). Each commit passes:
    - typecheck, lint, both test runs;
    - `bench:solid` and `bench:core`, flat;
    - `size`;
    - `pack:check`.
  - **The ADR-0069 and ADR-0030 Amendments** land in the lift's PR 1 (R7 Q32). ADR-0071 stays in the grill-end docs PR.
- **The lift starts after the grill** (R7 Q33, B), once the shared understanding is confirmed.

### Round 8 (2026-11-09): scope, tests, gates, and the Blocks preview

- **Examples and docs** (R8 Q34, A): a Foldkit storefront page for page with the others, deployed as a fourth subdomain, plus a `@wardic/foldkit` docs section. It ships as 1.2's last slice.
- **Tests** (R8 Q35, A): the binding's own browser suite.
  - Solid's binding-level scenarios are ported as Foldkit fixtures.
  - Each Foldkit-specific finding gets a test: P1, P2, P14, P19, P20, Q16, Q18, and replay.
  - Scene tests cover the documented pattern.
  - A shared suite across the three bindings is a separate issue, if they drift.
- **Performance** (R8 Q36, A): `bench:foldkit` with bench:solid's scenes, a render that changes nothing, a Foldkit-without-Wardic baseline, and a size entry. There's no target until the first numbers.
- **The Foldkit target** (R8 Q37; reopens R1 Q3): 0.170's public API.
  - Three pieces sit behind one internal module each: where elements get Wardic's services, how Commands get them, and fusing the user's `OnMount`.
  - Widen to 0.171 once it ships and the suites pass on it (Q26).
  - On the preview, services come from `program.provide(Wardic.layer)`, and the app wraps the Effects in `FeatureBlock.makeCommand`.
- **The bundle takes the user's Mount** (R8 Q38, A): `Ward.attributes({ …, mount })` fuses it, since a second `OnMount` throws on the preview and silently replaces the first on 0.170. P21 checks that the fused Mount keeps the user's Mount registered.
- **Upstream asks** (R8 Q39): drafted in `docs/research/foldkit-upstream-asks.md` for review.
  - U1′ (a library Mount usable in any Block) and U5, widened to `Mount.emit` for raw Mounts, go as feedback on #1655.
  - U2, U3, U4 and U6 go as issues.
  - Nothing is posted without approval.

### Round 9 (2026-11-09): the probe-dependent questions

- **Leaver placement** (R9 Q17′, as P19 found it has to work):
  - re-place **every** leaver after every patch, walking `orderOf`'s order with a cursor, not `backPlaceOf`;
  - keys in a WeakMap that `w.keyed`'s Mount fills;
  - a key that re-enters during its exit hands the leaver's values to Foldkit's fresh element (with an `enteredFrom` layout take-over when it lands elsewhere);
  - the controller drops its own records with `takeRecords()`;
  - `orderOf`'s comment gets fixed in the lift, since its code matches Motion 14.9.
- **The layout trigger** (R9 Q19′): the `MutationObserver` pass is the default. `w.Provider({ layoutTrigger: "declared" })` opts back into Solid's triggers.
  - **P13's cost:** about 3.5 µs per layout node per DOM-changing render in Chromium, and about 6.5 µs in Firefox. A render that changes nothing costs nothing.
- **What the observer watches** (R9 Q40, A): the child list, text, and `attributeFilter: ["class", "hidden"]`. The app extends it with `layoutAttributes`.
- **The held frame** (R9 Q20): accepted and documented for 1.2, with P20's numbers. The core fix is **#673**, filed to be taken up independently of the binding.
- **Follow-ups filed** (R9 Q41):
  - **#673:** the first step inside a pass that runs after the frame's tick;
  - **#674:** a pass at rest still writes 2N transforms.
- **The rest of the queue** (R9 Q42): one small agent runs P21 (the preview's canary), P17 (`Reactivity`) and a Solid check for multi-leaver drift. P15, P16 and P18 become tests in the binding's suite.

### Round 10 (2026-11-09): the last probes

- **`Reactivity` re-checks once per patch** (R10 Q23′; replaces R6 Q23's "after each delivery", which P17 showed fires values from partway through a patch and is quadratic).
  - The provider's fresh per-render delivery, the first setter call in every patch, queues one microtask.
  - It runs after the whole patch and before the Measure pass, and fires each watch on `!Equal.equals`.
  - It's documented that a config object mutated in place can read stale (Effect's `Equal` caches its result per pair).
  - **Cost:** 0.48–0.60 ms for 1,000 elements × 3 watches (Bun).
- **A Mount restarting on a kept element** (R10 Q43; preview only, P21):
  - a release does only what must be synchronous (presence's box and values);
  - the unregister or exit is decided in the patch's microtask;
  - if the same element re-registers in the same patch, it carries on, with no `initial` replay;
  - it lives in the module that differs between Foldkit versions.
- **The fused `OnMount`** is `{ ...userAction, f }`, which passes the preview's registration checks (P21). Wardic's part starts before the `Stream.merge`.
- **The Solid presence bug filed** (R10 Q44): **#675**, a leaver drifting on a reorder, with P19's fix proposed.

### Open

- **Nothing open in the grill.** The upstream ask drafts await review.
- **P15, P16 and P18** become tests in the binding's suite (R9 Q42). P13, P17, P19, P20, P21 and P22 are done (`foldkit-probes.md`).
- **Foldkit's Blocks and Layers preview** (foldkit/foldkit#1655) is read in `foldkit-blocks-preview.md` and handled by R8 Q37–Q39 and R10 Q43. The upstream asks are drafted in `foldkit-upstream-asks.md`.
