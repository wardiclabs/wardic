# @wardic/foldkit (#561): Foldkit's "Blocks and Layers" preview (#1655), checked against the decisions so far

> **Read at:** 2026-11-09 (UTC) · **Sources:**
> - **The preview:** `foldkit/foldkit#1655`, a draft, base `main`, head `codex/layers-and-submodels` at `54f8bcd443b4fd18952403a3d02e212abf872d58`. That head *is* the verified snapshot: the branch tip and the PR's "Source" are the same commit.
>   - It was fetched into the note's clone and checked out as a detached worktree at `.tmp/561-foldkit/repo-preview/`.
>   - Its website pages (`packages/website/src/page/`, the migration guides included), its 285 changesets (`.changeset/`) and its source were read there.
> - **Stacked PRs:**
>   - #1922's head `bc7a2546` and #1860's head `d740ef48` were fetched as `origin/pr1922` and `origin/pr1860`, and `codex/preview-followups` as `origin/preview-followups`. They were read with `git show` and `git diff`.
>   - Their relation to the snapshot comes from `gh api repos/foldkit/foldkit/compare/…`.
> - **GitHub text, read with `gh` only:** PR bodies of #1655, #1860, #1922, #1757, #1764 and #1921; issues #1698, #1810, #1868, #1869, #1887, #1895, #1910, #1911, #1925, #1497, #1641, #1775, #1662, #1663 and #1363; and the list of PRs based on the preview branch.
> - **For comparison:** 0.170.0 as [`foldkit-binding.md`](foldkit-binding.md) read it (`a471adb`, its `fk:` prefix), and `effect@4.1.1` (`fx:`).
>
> **Prefixes:**
> - `fkp:` is the preview's `packages/foldkit/` at `54f8bcd` (`fkp:src/mount/handler.ts`).
> - `fkpweb:` is its `packages/website/src/page/`.
> - `fkproot:` is its root (`.changeset/`, `packages/ui/`).
> - `fk:`, `fkweb:` and `fx:` are as in the binding note.
> - "#1655 body" is the PR's description, cited by its section heading.
> - A stacked change is cited by PR number and commit (`#1922 5c96e577`).
>
> **Nothing was run:** no install, build, test or browser, since a timing run was going. It's reading only: `git fetch`, `git worktree add`, shell reads and `gh` reads. Claims reasoned from source rather than read in it are marked *inferred*.

## Summary: what most changes the binding's design

1. **Every app is a Block graph now, and a Block's view may only render the Mounts its Composition registered.**
   - The builder's `OnMount` accepts an action only if its requirement `R` is in the builder's allowed set (`fkp:src/html/index.ts:5128-5143`). A Composition's builder allows only its `mounts` and its child Bindings' Mounts (`fkpweb:core/layers.md:258`; `fkpweb:core/mount.md:73`, `:193-205`).
   - At runtime the renderer throws for any rendered Layer-backed Mount the program didn't register (`fkp:src/runtime/renderer.ts:400-452`, `:494`).
   - **So a `w.div` built on a Layer-backed Mount would need registering in every Block whose view renders it, its handler Layer included.**
   - **A raw `MountAction` (`{ name, f }`, `R = never`) needs registering nowhere.** It passes every builder's type check (`fkp:src/html/mountCapabilities.test.ts:391-401`, "keeps raw MountActions with no requirements valid"). It also skips the owner check (`fkp:src/html/index.ts:5676-5700`) and the renderer's registration walk (`fkp:src/runtime/renderer.ts:418-425`).
   - That's the binding's path. It keeps G's "raw Mounts" decision, and it now rests on that one test.
2. **`resources` is gone. `program.provide(layer)` builds the app's Layer once per start, before the first render, and its services reach every Mount fiber.**
   - The Program has one MemoMap per start, shared by the services, the root graph and the runtime Layer (`fkp:src/runtime/programConstruction.ts:138-176`).
   - The built context is merged into the runtime context that Mounts fork on (`fkp:src/runtime/runtime.ts:704-718`; `fkp:src/runtime/resourceProvider.ts:146-157`).
   - Ordinary services survive into every child Block's projected context (`fkp:src/block/scope.ts:228-240`, `:275-299`).
   - So Wardic's Layer goes in `program.provide`. A raw Mount reaches it with `Effect.serviceOption` (`R = never`, `fx:dist/Effect.d.ts:11816`).
   - The provider Mount's `Layer.buildWithScope` and `resources: wardic.resources` (G, "One Wardic runtime") are replaced (*inferred* for the runtime behaviour; the code path was read, not run).
3. **A second `OnMount` on one element now throws while the VNode is built,** where 0.170 silently replaced the first (`fkp:src/html/index.ts:2598-2606`; `fkpweb:core/mount.md:81-85`).
   - `w.*`'s fused Mount still works.
   - A `Ward.attributes(config)` bundle spread onto an element that also has the user's `OnMount` now throws.
   - The fused action must keep the user's Layer-backed Mount's registration and identity (`fkp:src/html/index.ts:2627-2641`).
4. **The renderer, the props module, the scheduler, `Render`, hydration, serialization and `brand` are byte-identical to 0.170** (`cmp`; A.4, A.5, A.10). So P1–P10, P14 and the R5 decisions hold as probed. The exceptions:
   - a new `mountModule` in the patch (`fkp:src/vdom.ts:28-37`; `fkp:src/mountModule.ts:23-29`);
   - a Mount whose acquiring Block occurrence retires restarts on a kept element (`fkpweb:core/mount.md:53-55`);
   - and #1922 (open, not in the snapshot) arms the next render frame from a task after each frame. That can move a Message emitted in Wardic's tick into the same frame's patch (*inferred*; #1922 `5c96e577`).
5. **The preview answers U1 only in part, and none of U2–U6.**
   - Layer-backed Mounts get typed services, but only if registered per Block.
   - Raw Mounts get the services at runtime, untyped.
   - The preview is a draft whose authoring has changed with every snapshot, with a competing design open (#1860). "APIs and conventions may change before the stable release" (#1655 body, banner).

## 1. Status

- **What it is.**
  - "A preview of Foldkit's Block composition and handler Layers. APIs and conventions may change before the stable release." The PR is draft, open since 2026-10-12, last updated 2026-11-08 (`gh pr view 1655`).
  - "This is a breaking release combining Block composition and handler Layers" (#1655 body, *Why Foldkit is making this change*).
  - Canary set: `foldkit@0.170.0-canary.54f8bcd443b4`, `@foldkit/ui@0.170.0-canary.54f8bcd443b4`, `@foldkit/vite-plugin@0.29.0-canary.54f8bcd443b4`, and others (#1655 body, *Package versions*).
- **Is it the next stable release?**
  - It targets `main`, and its changesets are ordinary bumps. 285 changeset files; for `foldkit`, 69 `minor`, 57 `patch` and no `major`. There's no `pre.json` (`fkproot:.changeset/`).
  - `@foldkit/ui` peers `foldkit >=0.171.0` (`fkproot:packages/ui/package.json:145-148`), in a fixed group with `foldkit` and `@foldkit/devtools` (`fkproot:.changeset/config.json`).
  - So merging releases it as **0.171.0** (*inferred* from Changesets' rules and that peer).
  - The PR says only #1662 and #1663 "have explicit approval to follow after this work merges to main" (#1655 body, *Verification and remaining limits*).
- **Stability.**
  - The roadmap: Foldkit is pre-1.0; "Names and API signatures can still change before 1.0, but the architecture is locked" (`fkpweb:roadmap.md:5`, `:72`); "Stable public APIs will follow semver" at 1.0 (`:19`).
  - Authoring changed again in this snapshot: `Block.make` and record-form `makeLayer` replace the Definition, preparation and assembly stages of the previous snapshot `90746b3` (#1655 body, *Required migrations*).
  - #1910 and #1911 already "target the preview after the candidate being prepared on November 7".
- **Its own measured cost.** "Optimized medians are 207.4/308.1 ms (+48.55%), with 48,092/48,711 added gzip bytes. All eight optimized pairs are slower… The rendering and bundle gap is an explicit limitation of this preview" (#1655 body, *Verification and remaining limits*). It matters to Wardic's focus on speed: an app on the preview starts slower before Wardic adds anything (*inferred*).
- **The stacked PRs: none has merged into the preview branch.**

  | PR | State | Base | Against `54f8bcd` |
  |---|---|---|---|
  | #1860 "replace Block authoring with class and Layer Blocks" (sam-goodwin) | open, draft | preview branch | diverged: 15 ahead, 15 behind, from `244251e`. A different authoring model ("A Block is a class plus one Layer"; `gh pr view 1860`) |
  | #1922 "refine Block views, UI contracts and testing" | open, ready | preview branch | 16 commits ahead, 0 behind: a follow-up snapshot |
  | #1757 `Composition.implement` | open, draft | `codex/preview-followups` | diverged: 25 ahead, 20 behind. Editor-performance typing (`gh pr view 1757`) |
  | #1764 `Composition.assembleAs` | open, draft | `codex/preview-followups` | diverged: 24 ahead, 20 behind. Same (#1737) |

  - What *has* merged into the preview branch: #1634, #1656, #1693–#1696, #1705, #1729, #1801, #1802, #1847, #1848, #1878, #1880, #1881, #1883–#1885, #1894, #1896, #1901, #1903, #1909 and #1912–#1915 (`gh pr list --base codex/layers-and-submodels --state all`).
- **Release date: none found.** Not in the PR, the roadmap, the changesets or the issues read.

## 2. Mounts

**The API.**
- **Block-owned Mounts** are `FeatureBlock.makeMount(name, { args?, messages, handler })` and `FeatureBlock.makeMountStream(…)` (`fkpweb:core/mount.md:11-13`).
  - `handler` is a generator constructor, run once when the application Layer is built. It returns the per-element function (`:181`).
  - Underneath, each is `Mount.define` / `Mount.defineStream` under an owned name, plus `registerDefinition(owner, …)` (`fkp:src/block/named.ts:662-685`).
- **`Mount.define`, `Mount.defineStream`, `mapMessage` and the `MountAction` type stay public** (`fkp:src/mount/public.ts:12-40`). A Definition carries a registration, `{ name, kind, messages }`, and a handler identity (`fkp:src/mount/index.ts:746-797`).
- **`MountAction` now has an `R`:** `MountAction<Message, E = never, R = never>` (`fkp:src/mount/index.ts:119-127`). The docs say "Authors don't construct this shape directly" (`:115`).

**Its `R`, our U1.**
- **A Layer-backed Mount's work can require services.**
  - `toLayer(build)` returns `Layer<Handler<Name, Input, Message>, E, Exclude<StreamRequirements | BuildRequirements, Scope>>` (`fkp:src/mount/handler.ts:41-78`). The Layer captures its construction context.
  - At execution, "service lookups inside the Stream use the invocation context over the construction context": `Context.merge(handler.context, invocationContext)` (`:97-110`, `:158-177`).
  - So `yield* Wardic` inside a handler is typed, and is met by whatever the root provides (`fkpweb:core/layers.md:54`).
- **The action's own `R` is the `Handler`,** and that's what the builder checks (below).

**What context a Mount fiber runs on.**
- **The fork:** `Effect.runForkWith(capturedContext)` (`fkp:src/html/index.ts:2763-2766`). `capturedContext` is the frame's `requireRuntimeContext()` (`:2608`, `:2846-2852`).
- **At the root,** that's the render context: the composition root's context, which merges `Effect.context()` with the built application context, plus `Dispatch`, `MountTracker` and `MountRuntime` (`fkp:src/runtime/renderer.ts:480-487`, `:587-596`; `fkp:src/runtime/runtime.ts:704-718`; `fkp:src/runtime/compositionRuntime.ts:591-601`).
- **Inside a child Block,** `pushBoundary` replaces it with a projected local context (`fkp:src/html/runtimeSingleton.ts:103-134`; `fkp:src/block/scope.ts:301-337`):
  - ordinary entries are kept;
  - handler and resource keys are kept only where scoped to that placement (`fkp:src/block/scope.ts:228-240`, `:275-299`).
- **So an app service provided at the root is in every Mount fiber's context, raw ones included.** A root-provided *handler* key is not, inside a child Block (*inferred* from the projection code).
- **New: a Block occurrence's start barrier.** A Mount waits on it while an earlier generation of the same key closes (`fkp:src/html/index.ts:2700-2721`; `fkp:src/runtime/compositionRuntime.ts:233-253`).

**Registration and capability checking.**
- **Types.**
  - `OnMount: <Action extends MountAction<Message, unknown, never | AllowedMountRequirements>>` (`fkp:src/html/index.ts:5128-5143`).
  - A Composition's `makeView` gives a builder whose allowed set is its `mounts` plus its child Bindings' (`fkpweb:core/layers.md:258`; `fkpweb:core/mount.md:73`, `:193-205`).
  - A Layer-backed Mount outside that set is a type error (`fkp:src/html/mountCapabilities.test.ts:164-204`). An embedded child view whose Mounts are missing is rejected with "Block view requires Mounts that are not registered by this application" (`fkp:src/html/index.ts:5820-5830`).
- **Runtime, three checks:**
  1. `h.OnMount` throws "Mount … belongs to a different Block" for an owned Mount rendered elsewhere, and "… is not registered in this view's Mounts" (`fkp:src/html/index.ts:5676-5700`). Both run only when the action has an owner.
  2. A canonical view throws "This view uses Mounts that are not registered in its selected Block" (`fkp:src/block/viewScope.ts:66-109`). Its changeset: "erased or JavaScript callers receive an actionable error" (`fkproot:.changeset/captured-view-mount-registrations.md`).
  3. The renderer walks each rendered tree before patching. It throws "The rendered view contains Layer-backed Mounts that were not registered" for any marker whose registration isn't in the program's set (`fkp:src/runtime/renderer.ts:393-452`, `:494`). That's a full VNode walk every render (`fkproot:.changeset/mount-validation-traversal-bookkeeping.md`).
- **"Published Mounts"** are a contracted Block's `view: { kind, Inputs, mounts: [...] }`: the Mounts its view hands a parent, for example through child attributes. They must be registered in that Block (`fkp:src/experimental/contracted/contract.ts:378-395`, `:431`; `fkp:src/experimental/contracted/publishedMounts.test.ts:46-57`).

**Exactly: what a `w.div` from a library needs.**

| The `w.*` element's Mount | Declared where | Typed services | Runs | Scene |
|---|---|---|---|---|
| **Layer-backed** (`Mount.define`/`defineStream`, or a Block's `makeMount`) | **In every Block whose view renders it:** under that Composition's `mounts`, its `.layer` in that Block's `EffectsLayer`, and Wardic's service under `effects.services` (`fkpweb:core/block.md:637-647`). A child that publishes it in `view.mounts` passes it to its parent. A root-provided handler isn't visible inside a child Block (*inferred*, above). | Yes, through the handler Layer | Only if registered (checks 1–3) | `resolve`, `emit` (stream), `expectEnded` |
| **Raw `MountAction`**, no registration, no identity | **Nowhere.** The type passes (`R = never`), check 1 is skipped (`owned === undefined`), check 3 is skipped (`registration === undefined`), and check 2 looks only at registered Definitions. | No: `R` must be `never`. Services through `Effect.serviceOption` over the fiber's context (*inferred*) | In any Block | `resolve({ name })` by name (`fkp:src/test/bindingMatcher.ts:170-187`); `emit` refused, "requires a stream Mount declared with makeMountStream or Mount.defineStream" (`fkp:src/test/scene.ts:1827-1833`) |

- **The friction is reported:** #1698 point 4, "Reusable view helpers with mounts are difficult to type… the capability error is hard to interpret."
- **The docs point library helpers at the plain builder:** "Use the general `HtmlBuilder` only for a helper that truly has no owner-specific child or Mount capability" (`fkpweb:previewMigration.md:278`); "A shared helper can use `HtmlBuilder<Message>` for ordinary content" (`fkpweb:core/mount.md:201`).
- **A richer builder still passes to a helper typed `HtmlBuilder<Message>`:** the allowed-Mounts marker is a parameter position (`fkp:src/html/index.ts:5771-5773`) (*inferred* from variance, not compiled).

**The rest of the Mount contract:**
- Args are still captured at mount (`fkpweb:core/mount.md:115-121`).
- One Mount per element, now throwing (`:81-85`).
- DevTools replay reruns Mounts (`:87-91`).
- `viewStateChanges` is unchanged (`:123-147`).
- Failures are still only `console.error`ed (`fkp:src/html/index.ts:2721-2728`).
- **New:** "Retiring the acquiring occurrence also closes its Mount scope, even when the element is retained. A marker from a different occurrence starts a replacement acquisition" (`fkpweb:core/mount.md:53-55`; `postpatch`, `fkp:src/html/index.ts:2656-2667`).

## 3. Services

- **What replaces `resources`:**
  - The program option is gone: `Runtime` exports only `run`, `hydrate` and `embed` (`fkp:src/runtime/public.ts:2`). `Runtime.makeApplication` and `Submodel` aren't in the root exports (`fkp:src/index.ts:1-27`).
  - The entry is `Program.make({ block, layer, … })`, then `Runtime.run(program.provide(ApplicationLayer))` (`fkpweb:previewMigration.md:290-316`; `fkproot:packages/website/src/snippet/applicationEntryPoint.ts:7-19`).
  - Commands, Subscriptions, Mounts and ManagedResources get handler Layers (`fkproot:.changeset/command-handler-layers.md`).
- **When the Layer is built.**
  - "The Runtime builds the supplied application Layer once per start. Handler constructors run at that point, including constructors for handlers never invoked" (`fkpweb:core/layers.md:50`).
  - Order: the hydration handoff is validated, then the services Layer, then the root graph, then the runtime providers, all in one MemoMap (`fkp:src/runtime/programConstruction.ts:126-176`; `fkp:src/runtime/application.ts:386`).
  - `provide({ services, runtime })` splits the two phases. Plain `provide(layer)` is runtime-only (`fkpweb:core/layers.md:229`).
  - A constructor that fails "fails startup before a Model exists" (`:127`, `:151`).
  - So Wardic's Layer is built before any `insert` hook runs, hydration included (*inferred*).
- **`Wardic.animateLayout` inside a Block's Command.**
  - The app defines `FeatureBlock.makeCommand('AnimateLayout', { messages, handler: function* () { return () => Wardic.animateLayout(…) } })`. "If an existing Effect or Stream already declares its service requirements, return it from the invocation function. The handler Layer carries those requirements to application assembly" (`fkpweb:core/layers.md:54`, `:60-72`).
  - The Block declares Wardic's service under `effects.services` (`fkpweb:core/block.md:38`, `:637-647`), and the root's `program.provide` meets it.
  - Hand-built Commands still exist: `Command` is the same record (`fkp:src/block/scope.ts:497-560`, `qualifyCommand`; `fkp:src/command/index.ts:33-45`). The guide steers to Block-owned ones (`fkpweb:previewMigration.md:73-90`).
- **Shared once, or per Block?**
  - **Root-provided services: once per runtime start,** by reference ("Obtaining an API client with `yield* ApiClientService` retrieves the instance supplied by its Layer"; `fkpweb:core/layers.md:52`, `:146-151`).
  - "Removing an optional or keyed child stops its lifecycle work without rebuilding shared application Services" (#1655 body, §6).
  - **A Block's local `EffectsLayer`** is built by `selectLayer` in a fresh `Layer.makeMemoMapUnsafe()`, given the incoming context (`fkp:src/block/scope.ts:388-413`). It's then reused per placement through the program's MemoMap (`qualifyLayer`, `:480-495`).
  - So **a Wardic Layer placed inside Blocks' `EffectsLayer`s would build once per Block, not once per app** (*inferred*). It belongs in `program.provide`.

## 4. Re-renders

- **Do Mounts see later args (U2)? No.** "Later renders create new MountActions, but a reused DOM node does not run the handler again… Mount args are not reactive properties" (`fkpweb:core/mount.md:115-121`). `postpatch` reacquires only on an owner change (`fkp:src/html/index.ts:2656-2667`).
- **Is `h.Prop` public? No.**
  - `Prop` is exported only from the internal `html/index.ts` (`fkp:src/html/index.ts:1392`), not from `foldkit/html` (`fkp:src/html/public.ts:1-31`).
  - #1922's "Preserve public signatures, `Prop` and `OnCustomEvent` copying" means keeping the *internal* raw copying intact while consolidating builders: "Keep raw Prop and OnCustomEvent copying and current Mount capture intact" (#1922 `977b5732`; its changeset `shared-html-definitions.md`).
  - **New:** the `VNode` type is now public (`fkp:src/html/public.ts:24`; absent in `fk:src/html/public.ts`).
- **Does `CustomElement.define`'s property factory still behave as in P6? Yes** (*inferred*: same code path, not re-probed).
  - The factory still returns `Prop({ key: propertyName, value })` (`fkp:src/customElement/index.ts:238-243`).
  - `propsModule.ts` is byte-identical to 0.170's (`cmp`).
  - `withMessage(h)` now carries the builder's allowed Mounts (`:300-312`; `fkpweb:core/customElement.md:25-27`).
  - The docs keep "Foldkit only writes a property again when its value changes" (`:39`).

## 5. The view-input guard (#1698, point 2)

- **What #1698 says:** "Using the provided Toast view with entry content that contains a dismiss button causes the runtime to reject the nested event callback passed through the animation child."
- **Where.** `h.block` → `wrapViewInputsForOuterBoundary` → `assertNoNestedFunctions` (`fkp:src/html/block.ts:474-484`, `:384-401`, `:403-431`).
  - It walks every plain object and array **below** the top level of a child Block's `viewInputs`.
  - It throws "h.block `viewInputs` may only contain functions at the top level. Found a function at `viewInputs.…`".
  - Only `ChildAttribute`s are skipped (`:401`).
  - It's the same walker 0.170 had for `h.submodel` (`fk:src/html/submodel.ts:206-263`). The preview adds a type-level twin (`fkp:src/html/viewInputs.ts:45-58`, `:102-112`) and exempts `Date`/`DateTime` (`fkpweb:core/block.md:317-319`).
- **Why the Toast hits it** (*inferred*):
  - A VNode is a plain object literal (`fkp:src/snabbdom/vnode.ts:55-64`). Event handlers are functions on `data.on` (`fkp:src/html/index.ts:1521-1525`), and hooks on `data.hook`.
  - So any VNode with a handler or a Mount, passed as or inside a `viewInputs` field, is walked into and rejected.
  - The *type* check lets VNodes through (`viewInputs.ts:50`), so this fails only at runtime.
- **Would it reject Wardic's helpers? Not where G puts the functions.**
  - It guards `h.block`'s `viewInputs` only. `w.OnDragEnd((event, info) => …)` and a config holding functions are attributes of the `w.*` call, built in the rendering Block's own view (*inferred*: no other caller of the walker; `fkp:src/html/block.ts:480` is its one call site).
  - It **does** reject a parent passing a built `w.*` element, or a Wardic config with functions, to a child Block as a nested `viewInputs` value. A Wardic element carries `data.hook` from its Mount.
  - The pattern that works: a top-level render callback that builds the element in the parent's boundary (`fkpweb:core/block.md:313-321`, `:335-339`).
  - For D.3's thunk-children fallback, that's the only way across a Block.
- **"Element view inputs" (#1922)** aren't VNodes. They're the `Inputs` of a Block's declared Element-kind view: "Default an omitted contracted Block view to an Element view with no inputs. Element views with inputs now need only `view: { Inputs }`" (#1922 `4ed89f75`, changeset `default-block-element-view.md`).
  - Inputs are Schemas, or `Block.makeInputContract<…>()` "for deliberately nonserialized inputs such as render callbacks" (`fkpweb:core/block.md:38`).

## 6. Removal

- **No public removal delay (U3).**
  - `removeVnodes` still calls module and vnode `remove` hooks as before (`fkp:src/snabbdom/init.ts:657-690`).
  - No attribute sets `data.hook.remove`, and `OnRemove` doesn't exist (grep of `fkp:src`).
  - `snabbdom/hooks.ts` and `snabbdom/style.ts` are byte-identical.
- **What's new is release:** `mountModule.destroy` releases an element's Mount even when the last render dropped its `OnMount` (`fkp:src/mountModule.ts:23-29`, between `eventListenersModule` and `onUnmountModule` in `fkp:src/vdom.ts:28-37`).
- **Foldkit UI's exits are still Model-driven, now as a Block.**
  - `AnimationBlock` is bound in the parent, which calls `requestShow` / `requestHide`.
  - The parent's OutMessage policy answers `StartedLeaveAnimating` with `AnimationBinding.requestWaitForLeaveSettlement()`, which waits on `getAnimations()`. `TransitionedOut` "tells the parent that it can unmount content" (`fkpweb:ui/animationPage.md:5-19`, `:131-160`; `fkproot:.changeset/animation-leave-settlement-operation.md`).

## 7. Commits and the frame

- **`Render` is unchanged:** `fkp:src/render/{public,render,commit}.ts` are byte-identical. Only `afterCommit` and `afterPaint` are public (`fkp:src/render/public.ts:1`). There's no commit Stream and no before-commit moment (U4).
- **The frame at `54f8bcd`,** same order as 0.170 (`fkp:src/runtime/renderer.ts:639-683`, `:769-816`):
  1. `renderFramePlain` in Foldkit's own `requestAnimationFrame`;
  2. the view;
  3. **new:** the registration walk (`:494`);
  4. the patch;
  5. `attachRenderedMounts`;
  6. `drainPendingMessages()`;
  7. `settlePendingCommit()`, last.
  - The deferred-drain re-request is still there (`:771-774`).
- **The scheduler is unchanged:** `browserScheduler.ts` is byte-identical, `MixedScheduler('async', microtask)`, still wrapped around boot (`fkp:src/runtime/start.ts:125-127`, `:326-327`).
- **The message queue** gains `isCurrent` guards and receipts (stale-occurrence admission). The 5 ms budget logic stays (`diff` of `runtime/messageQueue.ts`).
- **#1922 changes the frame's arming (open, not in the snapshot)** (#1922 `5c96e577`; its changeset `render-animation-frame-ticks.md`; #1921 is its open counterpart on `main`).
  - **The change:**
    - After each patched frame, a `MessageChannel` task requests the next rAF in advance ("armed").
    - `scheduleRenderFrame` doesn't request another while armed.
    - "An idle application stops requesting frames after one unchanged callback."
  - **For Wardic** (*inferred*):
    - The armed request is made in a task after frame N, so in N+1 it runs after Wardic's Clock callback, which was requested during N. Warm order stays tick → patch → pass.
    - A Message offered in Wardic's tick while Foldkit is armed patches in **the same frame**, not N+1. That changes P7's result during continuous rendering.
    - B.3's one held frame for patch-driven layout stays.
    - Each changed Foldkit frame also posts one `MessageChannel` task, which the probes' paint markers must tell apart.

## 8. Scene and Story

- **How Mounts resolve:**
  - Scene "follows the renderer's element identity and, for a Block-aware subject, the acquiring Block occurrence".
  - "Adding the first `OnMount` to an already-rendered element does not start a Mount" (`fkpweb:testingScene.md:265-279`). So Scene now matches the runtime on #1497.
  - Every ended acquisition needs `Mount.expectEnded` (`:276`, `:293`).
- **#1869 (a stream Mount resolves only once): answered.**
  - `Scene.Mount.emit(Def, Message)` delivers later results from a resolved, still-mounted stream Mount (`fkp:src/test/scene.ts:1792-1856`, `:2591`; `fkpweb:testingScene.md:289`, `:297-307`; `fkproot:.changeset/emit-active-stream-mounts.md`).
  - Only for a registration of kind `Stream` (`fkp:src/test/scene.ts:1827-1833`). A raw Wardic Mount can't use it.
- **#1887 (Scene routes a retained Mount's stream to the previous child): open.**
  - The docs state the runtime rule: "retained Mount results follow the currently rendered Block boundary" (`fkpweb:testingScene.md:269`).
  - The attempted fixes #1888 and #1893 were closed (`gh pr list`). Whether `54f8bcd`'s Scene matches wasn't checked.
- **#1911 (resolver lifetimes): about Commands.** #1922 makes `Command.resolveAll` local to its call (changeset `local-command-resolvers.md`). Mount resolution is unchanged.
- **A family of Mounts (U5): no.**
  - `Mount` steps are `resolve`, `resolveAll`, `emit`, `expectHas`, `expectExact`, `expectNone` and `expectEnded` (`fkp:src/test/scene.ts:2581-2601`).
  - The nearest ask is #1363 (open), "Mount.resolveAll should tolerate unused resolvers like Command.resolveAll does". #1911 names it as a case to "consider", not to implement.
  - **Raw Mounts still enter Scene:** `OnMount` stamps a marker for any action (`fkp:src/html/index.ts:2627-2641`). T6 stays.

## 9. Head channel, server render, hydration

- **The view still can't reach `<head>` (U6).**
  - `Document` is still `title`, `lang`, `dir`, `canonical`, `ogUrl` and `body` (`fkp:src/html/index.ts:322-329`).
  - `renderDocument`'s `head` is still trusted per-call HTML (`fkp:src/experimental/server/document.ts:31-41`, `:72-78`).
  - #1775 ("Let the view Document declare the page color scheme") is open and lists the same gap: "The view cannot reach `<head>` or `<html>`".
- **Server render.**
  - Still experimental (`fkp:src/runtime/start.ts:226-227`).
  - `renderToString({ block, layer }, serverConfig, requestOptions)` "builds the selected construction Layer… It does not… run Mount handlers, or build the handler graph" (`fkpweb:core/serverRendering.md:91-93`).
  - The view still runs under `Context.empty()` (`fkp:src/experimental/server/server.ts:1339-1345`).
  - `serialize.ts`, `template.ts` and `domReflection.ts` are byte-identical; `document.ts` lost one blank line.
- **`Runtime.hydrate`:**
  - same signature, now over a `Program` (`fkp:src/runtime/start.ts:228-239`);
  - `hydrate.ts` is byte-identical, so P14's adoption and style-seeding facts hold;
  - the application Layer is built after handoff validation and before the first render (§3).

## 10. Identity

- **`foldkit/brand` is unchanged.**
  - `brandViewResult` is still public (`fkp:src/brand/public.ts:1`; `fkp:src/brand/brand.ts:43-54`), byte-identical to 0.170.
  - "A mismatch replaces the node instead of patching it" (`fkp:src/snabbdom/vnode.ts:33-37`), checked in `sameVnode` (`fkp:src/snabbdom/init.ts:12-26`).
  - `@foldkit/vite-plugin`'s `viewIdentity.ts` is unchanged (`diff -rq`).
- **A kept node and its `OnMount` (#1497):**
  - The runtime behaviour is unchanged: an `OnMount` added to a kept node never starts. `insert` acquires, and `postpatch` only *re*acquires an existing state (`fkp:src/html/index.ts:2650-2667`). #1497 is open.
  - Scene now agrees with the runtime (§8).
  - **New:** a kept node's Mount restarts when its acquiring occurrence retires or another occurrence marks it (`fkpweb:core/mount.md:53-55`). For example, a keyed child re-created under the same key is a new occurrence (`fkpweb:testingScene.md:267`).
  - So branding still decides node reuse. A Wardic element can also restart without a DOM change when its Block occurrence does (*inferred*).

## 11. Messages from a Mount inside a Block

- **Routing.**
  - A Mount emits the Message universe of the builder that built it, the rendering Block's own Message.
  - `requireMountDispatchResolver` resolves that boundary's wrapping chain at emission time and wraps the result in `guardInstanceDispatch`, which drops the Message once the occurrence is inactive (`fkp:src/html/runtimeSingleton.ts:243-260`; `fkp:src/block/instanceContext.ts:129-153`).
  - Each emission re-checks `lifecycle.isActive` (`fkp:src/html/index.ts:2713-2717`), which is #1641's fix on this branch. #1641 is still open against `main`.
- **Submodel lifting is replaced by Bindings:**
  - `h.submodel` → `h.block(Binding.embedView(…))`;
  - `Got*Message` wrappers are generated child-routing envelopes;
  - "Composition routes child Messages" (#1655 body, §2; `fkpweb:previewMigration.md:141-160`).
- **Can a library Mount emit app Messages given as values or functions? Yes** (*inferred*).
  - A raw Mount closes over what the view gave it: `w.OnTap(TappedCard({ id }))` or `(event, info) => …`. It dispatches through that Block's boundary.
  - **A Layer-backed library Mount is awkward.** `messages` must be Schemas the library can't know (`fkpweb:core/mount.md:15-17`). `Mount.mapMessage` keeps the action's `R`, so a mapped one still needs registering (`fkp:src/mount/index.ts:1077-1099`).

## 12. Peers

- **`foldkit@54f8bcd`:**
  - peers `effect ~4.1.0` and `@effect/platform-browser ~4.1.0`;
  - pins both, and `@effect/vitest`, at exactly `4.1.0` for its own development;
  - depends only on `parse5 ^8.0.1` (`fkp:package.json:188-199`).
- **`@foldkit/ui`** peers `effect ~4.1.0` and `foldkit >=0.171.0` (`fkproot:packages/ui/package.json:145-148`).
- **Wardic's `effect ^4.1.1` meets it.** #1922 only "clarif[ies] the verified Effect pins and supported peer range"; its `package.json` keeps `~4.1.0`.

## Part G against the preview

"Kept" means the decision stands as written. "Changed" means it stands with a different spelling or cost. "Broken" means it can't be done as written on the preview.

| Part G decision | Verdict | Why | Citation |
|---|---|---|---|
| Parity, delivered in slices (R1 Q1) | kept | Foldkit-independent | — |
| Server rendering in 1.2, Appear included (R1 Q2, R2 Q4) | kept | Server still experimental, now `{ block, layer }`. Serializer, template and hydration are byte-identical | `fkpweb:core/serverRendering.md:91-93`; §9 |
| Public API now, workarounds behind one module, U1–U6 drafted (R1 Q3) | **changed** | "Public API" now means choosing a line: 0.170 stable or the preview. The preview removes `Runtime.makeApplication`, `resources` and `Submodel`, and its authoring is still moving (#1860, #1910, #1911). U1–U6 need redrafting (below) | `fkp:src/runtime/public.ts:2`; `fkp:src/index.ts:1-27`; §1 |
| Probes before the API round (R1 Q4) | kept | P1–P10 and P14 rest on files that are byte-identical. New: re-probe raw-Mount service access and #1922's arming | §7, §9 |
| Lift first, #672; `@wardic/core/unstable/<Module>`; a move plan first (R1 Q5, R3 Q2, R2 Q6) | kept | Foldkit-independent | — |
| One Wardic runtime: a module-scope handle `Wardic.make`, a provider `w.*` element whose Mount builds the Layer and completes the handle's `Deferred` (R1 Q6, R2 Q1, R3 Q7) | **changed** | `program.provide(Wardic.layer(…))` builds it once per start, before the first render, in the program's MemoMap. Every Mount fiber's context carries it, so children never wait on a `Deferred`. The provider element stays for Appear's chunk and subtree config (*inferred*) | `fkp:src/runtime/programConstruction.ts:138-176`; `fkp:src/runtime/runtime.ts:704-718`; `fkp:src/block/scope.ts:228-240` |
| `resources: wardic.resources` hands the handle to Commands (R1 Q6) | **broken** | No `resources` option. A Block-owned Command's handler requires Wardic's service, declared under `effects.services` and met by `program.provide` | `fkpweb:core/layers.md:54`, `:60-72`; `fkpweb:core/block.md:637-647` |
| Keep Foldkit's scheduler (R1 Q7) | kept | `browserScheduler.ts` byte-identical, still around boot | `fkp:src/runtime/start.ts:125-127` |
| Fibers split: the element's Mount Scope for registrations, the provider's runner for Legs (R1 Q8) | kept, with a new case | A Mount Scope now also closes when its acquiring Block occurrence retires, on a kept element | `fkpweb:core/mount.md:53-55`; `fkp:src/html/index.ts:2656-2667` |
| Failures contained, every Command answers (R1 Q9) | kept, with a new edge | Mount failures still only logged. A constructor failure in a provided Layer fails startup before a Model exists, so `Wardic.layer` must not fail | `fkp:src/html/index.ts:2721-2728`; `fkpweb:core/layers.md:127`, `:151` |
| No Schema in `src` (R1 Q10) | kept | Only on the raw path: Layer-backed Mounts and Block Commands need `messages` Schemas. The raw `MountAction` needs none | `fkpweb:core/mount.md:13-17`; §2 |
| Effect-typed surface, `Option` (R1 Q11) | kept | — | — |
| Live values are Atoms, one registry in Wardic's Layer (R1 Q12) | kept | The registry moves into the provided Layer | §3 |
| Tracing: inherited References, `env` overrides, Tracer through `env` until U1 (R1 Q13, R2 Q2) | **changed** | A Tracer in `program.provide` reaches Mount fibers and Wardic's Layer through the shared context and MemoMap. The `env` route becomes optional, and the "deviation until U1" can go (*inferred*) | `fkp:src/runtime/programConstruction.ts:138-176`; `fkp:src/runtime/runtime.ts:704-718` |
| `w.div(attributes, children)`, `w.keyed`, `Ward.attributes`; `w.*` merges the Starting style and fuses its Mount with the user's (R2 Q3) | **changed** | `w.*` must use a raw `MountAction` to work in any Block. A second `OnMount` now throws, so a `Ward.attributes` bundle beside a user `OnMount` throws. The fused action must keep the user's Layer-backed registration, identity and `R` | `fkp:src/html/index.ts:2598-2606`, `:2627-2641`, `:5128-5143`, `:5676-5700` |
| DevTools replay lands everything at once (R2 Q7) | kept | `viewStateChanges` and replay rules unchanged | `fkpweb:core/mount.md:87-91`, `:123-147` |
| Variants: builder-time walk plus DOM ancestry; thunks as fallback (R3 Q6) | kept | `VNode` is now a public type. `h.block` runs the child view inline and wraps it, as `h.submodel` did. Lazy hits now also miss when a tracked occurrence isn't current. Thunks across a Block must be top-level callbacks | `fkp:src/html/public.ts:24`; `fkp:src/html/block.ts:693-712`; `diff` of `html/lazy.ts`; §5 |
| Appear: first-child `<style>`, `Appear.adoptChunks` before `Runtime.hydrate`, stable slots (R3 Q7) | kept | `hydrate.ts`, `serialize.ts` and `template.ts` byte-identical. The Layer is built before the first render | §9 |
| Scene: raw Mounts exported as `Wardic.Provider` / `Wardic.Element`, plus U5 (R3 Q8) | kept, with a gap | Raw markers still pend and match by name. `Mount.emit` refuses raw Mounts, so a test can't push a second callback Message from a live element. U5 is unanswered | `fkp:src/test/bindingMatcher.ts:170-187`; `fkp:src/test/scene.ts:1827-1833` |
| Imperative calls are Effects with typed errors, wrapped by the app in `Command.define` (R3 Q9) | **changed** (spelling) | The app wraps them in `FeatureBlock.makeCommand(…, { messages, handler })`. The Effect's Wardic requirement is now typed and met at the root | `fkpweb:previewMigration.md:73-90`; `fkpweb:core/layers.md:54` |
| Callbacks: a Message or `(event, info) => Message \| Option<Message>` (R4 Q3) | kept | Raw Mount emissions route through the rendering Block's boundary and are dropped after release or retirement. The view-input guard doesn't see `w.*` attributes | §11; `fkp:src/html/block.ts:480` |
| The four non-events (R4 Q4); `onDrag`/`onPan` per pointer event (R4 Q5) | kept | With #1922, a per-tick Message may patch in its own frame (*inferred*) | §7 |
| Config: defaults in `Wardic.make`, `w.Config` for a subtree (R4 Q10) | kept | `Wardic.make`'s defaults travel in the provided Layer | §3 |
| Live values in the view; `w.DragConstraints`; drag controls; Reorder (R4 Q11–Q14) | kept | No Foldkit surface they rest on changed. Reorder's order lives in a Block's Model | — |
| Re-renders through a `CustomElement.define` property factory, by `sameResolution`; U2 the ask (R5 Q15) | kept | The factory still emits `Prop`, and `propsModule.ts` is byte-identical. `Prop` stays internal even in #1922 | `fkp:src/customElement/index.ts:238-243`; §4 |
| Identity: every `w.*` stamps `brandViewResult` (R5 Q16) | kept | `brand.ts` and `viewIdentity.ts` unchanged, `sameVnode` unchanged. Add: occurrence retirement restarts a kept node's Mount | §10 |
| Leaver order by `orderOf` after each patch, once P19 confirms it (R5 Q17) | kept | The keyed diff was refactored into a shared `pairChildren`. Removal is unchanged. P8 and P19 should be repeated on the preview (*inferred*) | `diff` of `snabbdom/init.ts`; §6 |
| `viewTransition`: the app wraps its predicate in `wardic.viewTransition(…)` (R5 Q18) | kept | The option moved to `Program.make` | `fkp:src/runtime/makeApplication.ts:64`; `fkpweb:core/viewTransitions.md:7` |
| Layout triggers: a `MutationObserver` on the provider's subtree, once P13 shows its cost (R5 Q19) | kept | The patch is still inside the rAF. P13's cost now sits beside Foldkit's own per-render registration walk | `fkp:src/runtime/renderer.ts:400-452` |
| Open: R5 Q20, the held frame | **changed input** | #1922 (unmerged) arms render frames. Patch-driven moves keep one held frame; tick-emitted Messages may patch in the same frame (*inferred*) | §7 |

**The Part A and B facts those decisions rest on:**

| Fact (note section) | At `54f8bcd` |
|---|---|
| A Mount's `R = never`, no `resources` (A.6, Summary 2) | **Changed:** `MountAction` has `R`. Layer-backed Mounts get typed services; raw Mounts get the app's services untyped. `resources` is gone (§2, §3) |
| Mount args captured at insert; one Mount per element (A.6) | Args kept. One per element now **throws** (§2) |
| A sync release finishes in `destroy` (A.6, P4) | Kept: cleanup is still forked from `destroy`. Plus `mountModule` and occurrence retirement (`fkp:src/html/index.ts:2741-2748`; §6) |
| The frame: view → patch → drain → `afterCommit` inside one rAF (A.4, B.1) | Kept, plus the registration walk. #1922 adds arming (§7) |
| Commands start one microtask after `update` (B.1 step 3) | Kept (`fkp:src/runtime/runtime.ts:772-790`, the `queueMicrotask` fork) |
| `h.Prop` written on reference change (A.5) | Kept as an internal attribute. Public only through `CustomElement` (§4) |
| Removal synchronous, no public `remove` (A.7) | Kept (§6) |
| No context; `viewInputs` and `childAttributes` (A.8) | Kept, as Bindings' `embedView` and top-level callbacks. Same nested-function walker (§5) |
| `viewTransition` per render (A.9) | Kept, on `Program.make` |
| Server `Context.empty()`, no Mounts; hydration adopts, then runs `insert`s (A.10, F.1) | Kept, with the Layer built before hydration's render (§9) |
| `Scene` pends every `OnMount`; no family resolution (A.6, F.2) | Kept, with `emit` for declared stream Mounts and identity matching the runtime (§8) |
| `MixedScheduler('async', microtask)` (A.3, C6) | Kept, byte-identical |
| `resources` built once, lazily; MemoMap rules (A.3, C2) | **Changed:** built eagerly at start in one MemoMap. Block-local recipes get isolated maps (§3) |

## The upstream asks, U1–U6

| Ask | Answered by the preview? | How, or what's left |
|---|---|---|
| **U1.** Mounts get `resources` | **In part** | Layer-backed Mounts' handler Layers capture typed services (`fkp:src/mount/handler.ts:41-110`), but only for Mounts registered in each rendering Block. Raw Mounts' fibers carry the root's services at runtime with `R = never` (§2). **What's left, a narrower ask:** let an unregistered (library) Mount require ordinary root services in its type, not only `Handler`s. Or document `Effect.serviceOption` for library Mounts |
| **U2.** An `argsChanges` Stream | No | "Mount args are not reactive properties" (`fkpweb:core/mount.md:121`). Still the `CustomElement` property route |
| **U3.** `h.OnRemove` | No | `remove` hooks unchanged and unexposed. Foldkit UI exits stay Model-driven (§6) |
| **U4.** `Render.commits`, `Render.beforeCommit` | No | `render/*` byte-identical (§7) |
| **U5.** A Scene option for a family of Mounts | No | `Mount.emit` (stream Mounts only) is the one new step. #1363 (tolerant `resolveAll`) is open (§8) |
| **U6.** A head channel from the view | No | `Document` unchanged. #1775 asks for one field of it (§9) |
| **New, from §2.** A library view helper's Mount in any Block | — | Today only a raw `MountAction` does it, by a tested but undocumented path ("Authors don't construct this shape directly", `fkp:src/mount/index.ts:115`). Ask for it to be a supported library contract, the test at `fkp:src/html/mountCapabilities.test.ts:391-401` made API |

## Not checked

- **Nothing was run.** Every runtime claim on the preview is read from source. These are *inferred*, and need probes on the canary:
  - a raw Mount's `Effect.serviceOption(Wardic)` inside a child Block;
  - the Layer built before hydration's `insert`s, still synchronous in production as P14 found for 0.170;
  - #1922's same-frame patch for a tick-emitted Message;
  - a root-provided handler key being invisible inside a child Block.
- **#1887 at `54f8bcd`:** whether Scene's routing of a retained stream Mount now matches the runtime.
- **#1860's API** past its PR body, and #1757's and #1764's diffs. They're typing and authoring alternatives.
- **The preview's `viewTransition.ts`,** DevTools and `@foldkit/ui`'s Animation source, past the docs.
- **The type-level claims,** for example that a richer builder passes to an `HtmlBuilder<Message>` helper, or that a fused `OnMount` keeps a user's requirement. Nothing was compiled.
- **The issues #1810, #1868, #1895, #1910 and #1925:** grepped for Mount, view-input, frame and Layer lines only.
- **The preview website build** and its `preview-release.json` manifest weren't fetched. The package map is from the PR body.
