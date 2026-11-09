# @wardic/foldkit (#561): drafts of the asks for Foldkit

Drafts for review (#561, round 8, Q39). **Nothing here is posted** until each draft is approved.
- Two go as comments on foldkit/foldkit#1655, the Blocks and Layers preview, which asks for feedback in the PR.
- Four go as issues, since they apply to 0.170.0 as well.

**Written to Foldkit's own prose rules** (its `AGENTS.md`):
- no em dashes;
- architecture types capitalized (Model, Message, Command, Mount, CustomElement);
- the claim first;
- "For example:" before illustrations.

**Links:**
- 0.170.0's source is at `a471adb` (`https://github.com/foldkit/foldkit/blob/a471adb24d750ab9e8d8312edad53ff6f26d961b/packages/foldkit/src/`).
- The preview's source is at `54f8bcd` (`…/blob/54f8bcd443b4fd18952403a3d02e212abf872d58/packages/foldkit/src/`).
- Each draft names files by path and lines. Turn them into permalinks when posting.

**Where the evidence is:** `docs/research/foldkit-binding.md`, `docs/research/foldkit-probes.md` and `docs/research/foldkit-blocks-preview.md`.

---

## 1. Comment on #1655: a library's Mount in any Block (U1′)

> We're building a Foldkit binding for Wardic, an Effect animation library with Motion's API ([wardiclabs/wardic](https://github.com/wardiclabs/wardic)). Its view helper, `w.div(attributes, children)`, gives each animated element a Mount that registers the element with Wardic's engine. A helper like that is rendered by Blocks the library never sees.
>
> In the preview, a Layer-backed Mount has to be registered in every Block whose view renders it. The renderer walks each rendered tree and throws for an unregistered one (`runtime/renderer.ts:393-452`), and `OnMount` checks the owner (`html/index.ts:5676-5700`). For a library helper, that means every Block that renders a Wardic element registers Wardic's Mount and its handler Layer.
>
> The one way around it today is a raw `MountAction` with `R = never`. It needs no registration, and `html/mountCapabilities.test.ts:391-401` keeps it valid. But `mount/index.ts:115` says "Authors don't construct this shape directly", and the Mount can only reach Wardic's service untyped, with `Effect.serviceOption` over its fiber's context.
>
> Could one of these become a supported contract?
>
> - **A library Mount that needs no registration**, documented as such, either the raw shape as public API or a constructor for it.
> - **A Mount that declares ordinary services in its `R`**, met by `program.provide`, with no per-Block registration. Today only `Handler`s are captured that way.
>
> Either keeps the Mount to DOM work for its own element, with services from the program's Layer as Commands get them. The Model and Messages don't change.

## 2. Comment on #1655: Scene tests with a library's Mounts (U5, widened)

> A follow-up to the comment above. In Scene, every Wardic element is a pending Mount, which is right for a Mount the app wrote. With a library that puts a Mount on every animated element, every Scene test of the app needs a `Mount.resolve` per element and an `expectEnded` per element that leaves. That's work that says nothing about the app.
>
> Two asks:
>
> - **Resolve every Mount with a given name in one step,** including ones that mount later. For example: `Scene.Mount.resolveEvery({ name: "Wardic.Element" }, CompletedWardic())`. #1363's tolerant `resolveAll` is close.
> - **`Scene.Mount.emit` for raw stream Mounts.** It refuses them today ("requires a stream Mount declared with makeMountStream or Mount.defineStream", `test/scene.ts:1827-1833`), so a test can't push a callback Message, such as an animation's completion, from a live library element.

## 3. Issue: let an element receive a value on every render (U2)

**Title:** Let a view give an element a property on every render: a public `Prop`

> A view can't give an element a value that changes from render to render, except through attributes. A Mount's args are captured when it's inserted (`mount/index.ts:310-331`; `core/mount.md`), and `Prop` is exported only from the internal `html/index.js`.
>
> A library element whose configuration comes from the Model needs each render's value: an animation target, say. Wardic's `w.Animate({ x: model.offset })` has to reach the element when `model.offset` changes, without a Command from `update` for every animated element.
>
> **What works today** is a `CustomElement.define` spec's property factory on a built-in `div`. We probed it in Chromium and Firefox, and it does what a `Prop` does:
> - one setter call per fresh value, in document order, a parent's before its children's;
> - none for the same reference;
> - none when the view drops an object-valued property;
> - DevTools replay writes the historical value synchronously.
>
> But that is a CustomElement API used on an element that isn't one.
>
> **The ask:** make `h.Prop(key, value)` public. It's Elm's `Html.Attributes.property`, and the props module already implements it. The alternative is an `argsChanges` Stream for a Mount, which is a bigger API for the same need.

## 4. Issue: let an element delay its own removal (U3)

**Title:** A public way for an element to delay its own removal

> When the view drops an element, Foldkit runs its `destroy` hooks and removes it in the same patch (`snabbdom/init.ts:449-491`). Nothing public can keep it on screen while it plays an exit. Snabbdom's `remove` hook exists for exactly this ("use `remove` to trigger an animation when an element is being removed"), but no Foldkit attribute sets it.
>
> **The Model pattern Foldkit UI uses,** keeping the leaving item in the Model until its animation settles, fits components that own their state. It doesn't fit a library whose job is Motion's `AnimatePresence`: any element the view drops plays its `exit`, wherever it is.
>
> **What works today** is re-inserting the removed element from a `MutationObserver` and playing the exit there. Every frame paints it. But a keyed reorder moves Foldkit's known nodes around it, so after a reverse the leaver sits first (`b, d, c, x, a`), no longer beside its old neighbour. An injected `remove` hook gives the same order.
>
> **The ask:** an element-owned removal delay, such as an `h.OnRemove` whose Effect completes when the element may go, or a Mount option that lets its release hold the element until an Effect completes. The Model is still the source of truth: the element has left the view, and only its DOM node stays until its exit ends. Interrupting the delay (the key coming back, the parent going) would follow the Mount's Scope.

## 5. Issue: a signal after every commit, and a moment before it (U4)

**Title:** A public Stream of commits, and a moment before a commit writes

> Wardic measures layout after each patch and before paint, so it can animate what the patch moved. The public moments today:
> - `Render.afterCommit`, which is one-shot, and which falls back to one animation frame when nothing is pending (`render/render.ts:99-107`). A loop on it would run on every frame of an idle page.
> - A `MutationObserver` on a container.
>
> The exact signal, `RenderCommit.onNextCommit`, is `@internal` (`render/commit.ts:5-27`).
>
> **The ask:**
> - **`Render.commits`:** a Stream with one element per commit, for Mounts and Subscriptions.
> - **`Render.beforeCommit`:** a moment after the view runs and before the patch writes, React's `getSnapshotBeforeUpdate`. Wardic would read layout there, so a change the patch makes animates from where things were.
>
> Both are host timing, not Model changes, which is where Mounts already live.

## 6. Issue: let a view put a style in the document head (U6)

**Title:** Let a view declare `<style>` content for the document head

> A view's `Document` holds `title`, `lang`, `dir`, `canonical`, `ogUrl` and `body` (`html/index.ts:295-302`). #1775 and #1393 extend it the same way.
>
> **Why Wardic needs a head channel:** on the server, Wardic samples each element's mount animation into a CSS `@keyframes` rule, so the animation plays from first paint, before hydration. Those rules belong in `<head>`.
>
> **The view can't put them there.** `Server.renderDocument(…, { head })` takes trusted head HTML, but the server entry calls it after the render with only the `RenderedApplication` (`experimental/server/fetch.ts:28-31`, `:142-148`). The view's CSS would have to be threaded through the app.
>
> **What Wardic does instead:** its provider renders the rules in a `<style>` as its first child, and moves that element into `<head>` before `Runtime.hydrate`. That works, but every page carries a body `<style>` until the script runs.
>
> **The ask:** a `styles` (or `head`) field on `Document` that the server renders into `<head>` and the client patches, with the page's CSP nonce. Or a hook that lets the view's render collect head content during `renderToString`.
