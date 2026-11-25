/// <reference types="node" />
/**
 * `bun run size [--base <ref>] [--head <ref>]` (#511, decision Q10): what an app ships for Wardic.
 *
 * - **The apps:** each Solid binding's plain app, one Complete element (`wardic.div` under a
 *   `WardicProvider`), and the same inside `<AnimatePresence>`; one Slim element (`w.div`) alone, the
 *   Slim element's base, and with each Feature (#511); a Wardic instance's of `domAnimation` (#516); one whose values follow a scroll (#240). And a multi-route app (#548): a shell giving
 *   `domAnimation`, a plain page, a page that drags and one that lays out, each an entry as
 *   SolidStart's routes are, measured as what the plain page loads, so a Feature that reaches a page
 *   that never uses it fails the gate. An app the base can't build, its API new, is reported as new and not gated.
 *   And the Foldkit binding's (#795, ADR-0071 decision 38): `f-plain`, Foldkit alone with one `h.div`
 *   and an opacity style, and `f-slim`, one `w.div` fading in under `w.Provider()` on a Handle with no
 *   Features, the binding's Slim app, with a budget of its own. And `@wardic/three/solid`'s (#885,
 *   ADR-0073 *Amendment (#885)* Q12): `t2-three`, three.js alone with a mesh drawn, and `t2-stage`, a
 *   `createStage` scene and one `ward(mesh, …)` under `<WardicStage>`, with a budget of its own; and
 *   `t2-features` (PR 5), a Stage given `stageDrag` and `stageBatches`, a ward dragging and a Batch of meshes.
 * - **Each side is built as an app ships it** (`sides.ts`): a Vite app build, production mode,
 *   minified, tree-shaken, for the browsers an app ships to by default (`APP_TARGET`, #525); Solid 1
 *   through vite-plugin-solid, Solid 2 through the repo's `solid2({ dev: false })`, Foldkit as plain
 *   TypeScript, its bare imports (`foldkit`, `effect`) the binding's own. Not Vite's lib
 *   mode, as `bench:solid`'s pages are: for an ES library Vite keeps the whitespace, for bundlers
 *   downstream, and the Slim element's app read 122.5 KB gzipped where an app ships 103.9 (#518).
 * - **Reported:** each app's minified, gzip (level 9) and brotli bytes, head against base, and the
 *   head's minified bytes split by package through its source map.
 * - **Gate:** an app fails when its gzip grows more than 1% over the base's, and the Slim element's
 *   base apps when they pass their budgets (`BUDGETS`). Sizes are deterministic, so no reps and no
 *   quiet host: it runs in seconds. Exits 1 when an app fails.
 *
 * Run it for any change to a package's `src` (`docs/agents/effect-first.md`'s *Checks*). CI runs it
 * too (#654, `ci.yml`'s `size` job): a PR against its base branch, a push to `main` against the push before.
 */
import { execSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { brotliCompressSync, gzipSync } from "node:zlib"
import { build } from "vite"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constUndefined } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { APP_TARGET, type Binding, BINDINGS, commitOf, depsOf, PACKAGES, REPO, sideResolver, sourcesInto } from "./sides.ts"

/** An app fails when its gzip passes this ratio of the base's. */
const GATE = 1.01

/**
 * The Slim element's base apps' budgets (#511, decision 10), in gzipped KB: an app fails past its own,
 * whatever its base, so changes each under the gate can't add up. Each is the app's size as it ships,
 * with 0.5 KB of room, and each #518 PR lowers them to its own result (#518, Q8): 103.9 and 132.3 when
 * the apps were first built as they ship, where lib mode had read 122.5 and 158.6. Solid 2's 123.9 once its
 * client builds dropped the server render's code (#518), and 102.8 and 122.9 with the Frame loop's
 * metrics an app's to give, 99.0 and 119.1 with Wardic's own fan-out, 97.4 and 117.3 with the `scroll` Feature.
 * Solid 2's raised 0.1 KB for #663 (a spring leg's velocities read when asked for: a third fewer bytes a
 * frame), whose second loop, chosen per run, is what keeps every engine's default path as it was.
 * #746 found `main` past both, at 100.0 and 121.5, with nothing in CI running this (#654), Solid 2's 1.4 KB
 * of it its rc.21 compiler's (ADR-0067, *Amendment (#746)*). Each of its PRs sets them to its own result
 * with the same room: 100.2 and 121.6 once its pure marks dropped the dead code, 99.1 and 120.5 with
 * development's diagnostics and errors left out of a production build, 98.0 and 119.3 with a layout node's
 * code the `layout` Feature's, 96.1 and 117.5 with Wardic's spans an app's to give, 95.4 and 116.7 with
 * the Frame loop's burst and dom's runner holding their fibers themselves, 94.6 and 116.0 with the Imperative
 * track `imperative.ts`'s, 94.5 and 115.9 with a Batch member's hold all `member-hold.ts`'s. #672's
 * PR 2 raised them by what it measured (Q23): 95.2 and 116.5, the Environment's three ports' plumbing and
 * the helpers out of the spine (ADR-0067, *Note (#672)*). #566 raised Solid 2's to 118.0 for Solid 2.0.1, whose own
 * code grew 1.5 KB in every app that makes a ward (ADR-0067, *Note (#566)*). The Foldkit binding's Slim app,
 * `f-slim`, holds 196.3 from its first number, 195.8, with the same room (#795, ADR-0071 decision 38): a budget
 * on the first number, no target, which is a follow-up's with what the Handle ships that a Slim element doesn't.
 * #882 raised it to 196.5 by what it measured, as #672's Q23 did: the Imperative track's two ports into core
 * (ADR-0073, *Amendment (#882)*), which Foldkit's Slim app ships and Solid's don't. #896 raised it to 196.8 by
 * what it measured, 0.3: a target's own transition and its Transition end on that track (ADR-0061,
 * *Amendment (#896)*), core's 0.7 KB of it minified. `t2-stage` and `t2-features` carry the same 0.7 within
 * their room. #951 raised it, `t2-stage`'s and `t2-features`' to 197.0, 243.9 and 251.5 by what it
 * measured, 0.2, 0.3 and 0.3: a call a later one takes a key from mid-flight ending without landing, a run
 * taking its keys back, and a Batch's `onTaken` (ADR-0061, *Amendment (#951)*), core's 0.4–0.7 KB of it
 * minified; Solid's slim apps, whose spine it doesn't touch, as they were. #968 raised `t2-stage`'s and
 * `t2-features`' to 244.2 and 251.9 by what it measured, 0.3 and 0.4: a key Wardic can't write refused as its
 * leg starts, `@wardic/three`'s 0.7 KB of it minified and `@wardic/object`'s 0.5; the Slim apps, which
 * don't reach either, as they were. #970 raised `f-slim`'s, `t2-stage`'s and `t2-features`' to 197.1, 244.3
 * and 252.0 by what it measured, 0.1 each (88, 125 and 65 B): a Transition end's keys read at the call, and
 * one that can't be set by the landing reported (ADR-0061, *Amendment (#970)*), core's 0.2 KB of it minified;
 * Solid's slim apps, which ship no Imperative track, as they were. #973 raised them to 197.3, 244.5 and 252.2
 * by what it measured, 0.2 each (211, 216 and 196 B): every Subject's keys read before a call takes any, so
 * a call refused at the call takes nothing (ADR-0061, *Amendment (#973)*), core's 0.5 KB of it minified;
 * Solid's slim apps as they were. #969 raised all five, `s1-slim`'s, `s2-slim`'s, `f-slim`'s, `t2-stage`'s
 * and `t2-features`', to 95.5, 118.3, 197.6, 244.7 and 252.4 by what it measured, 0.3, 0.3, 0.3, 0.2 and
 * 0.2 (236, 247, 249, 218 and 248 B): one element's failure in the Flush gate its own, and tried again at
 * its next flush (ADR-0033, *Amendment (#969)*), core's 0.7 KB of it minified in every app, since every
 * app has the gate. #979's group A raised `t2-stage`'s and `t2-features`' to 244.8 and 252.6 by what it
 * measured, 0.1 and 0.2 (137 and 186 B): a raycast, a render or an exit's landing that throws on a Stage
 * reported, the frame's writes run on (ADR-0073, *Amendment (#979, group A)*), `@wardic/three`'s 0.3 KB of it
 * minified; the other apps as they were. #977 raised them to 245.3 and 253.0 by what it measured, 0.5 and 0.4
 * (485 and 426 B): one Batch member's failure its own, its run reporting it and going on, and a call finished
 * before its `onComplete` runs (ADR-0069 and ADR-0061, *Amendment (#977)*), core's 1.2 KB of it minified. The
 * page's Batch apps grew alike (457–541 B), within the 1% gate; `f-slim`, which has no Batch, by 58 B, inside its
 * budget. #979's group C raised `f-slim`'s, `t2-stage`'s and `t2-features`' to 197.7, 245.4 and 253.1 by what it
 * measured, 0.1 each (79, 161 and 176 B): a function Segment's callback, and its cancel, that throws reported,
 * and each Subject's `delay` worked out, a mixed call's Batch parts run, before any plain Subject takes a key
 * (ADR-0061, *Amendment (#979, group C)*); the apps with no Imperative track not at all.
 * `@wardic/three/solid`'s
 * base app, `t2-stage`, holds 298.8 from its first number, 298.3, with the same room (#885, ADR-0073
 * *Amendment (#885)* Q12): 163.5 over three.js alone (`t2-three`), 98.6 KB of its minified bytes `@wardic/dom`'s, the DOM's ward that `ward` reaches (#927).
 * #885's PR 2 raised it to 298.9 by what it measured: a Scene object's code is a side only `createSceneObject`
 * brings, and what's left on every Stage ward's path (its branches for a side, and taking back a Subject
 * given again mid-exit) took the app 0.1 past its first number's room. #885's PR 3 raised it to 300.2 by
 * what it measured, 1.3: variants passing down a scene's graph, which every Stage ward follows, `@wardic/solid`'s
 * 3.7 KB of it minified and `@wardic/three`'s 0.5. The page's apps carry none of it. #885's PR 4 raised it
 * to 301.9 by what it measured, 1.7: drag in 3D, which every Stage brings, `@wardic/three`'s `ThreeDrag` 3.6 KB
 * of it minified and the Stage ward's 0.7; core's drag recognizer was in already, through the DOM ward (#927).
 * #885's PR 5 made drag and a scene's Batches a Stage's features, opt-in (`stageDrag`, `stageBatches`): a Stage
 * that gives neither carries neither, so `t2-stage` came back down to 300.4, its budget lowered to 300.5. Their
 * cost is `t2-features`', a Stage giving both and using them, with a budget of its own: its first number,
 * 316.1, with the same room. 22.7 KB of its minified bytes more are `@wardic/dom`'s, the page's Batch, which
 * `createBatch` reaches as `ward` reaches the DOM's ward (#927).
 * #927 gave a scene its own hooks: `@wardic/three/solid`'s `ward`, `createBatch` and sensors are `@wardic/solid`'s
 * Stage halves alone, which both apps now import. `t2-stage` fell to 243.1 and `t2-features` to 250.8, with
 * `@wardic/dom` 0.7 KB of either's minified bytes and culori none; their budgets were lowered to those, with the
 * same room. `@wardic/solid`'s own `ward` on a mesh still carries the page's ward, as a page with both pays anyway.
 */
const BUDGETS: Readonly<Record<string, number>> = { "s1-slim": 95.5, "s2-slim": 118.3, "f-slim": 197.7, "t2-stage": 245.4, "t2-features": 253.1 }

const OUT = join(REPO, ".tmp/size-gate")

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`)
  if (at === -1 || at + 1 >= process.argv.length) return fallback
  return process.argv[at + 1]!
}

interface App {
  readonly name: string
  readonly binding: Binding
  readonly source: string
  /**
   * A multi-route app's pages (#548), each its own file and its own entry, as SolidStart's routes are,
   * which `source` loads with `import()`. Its size is what its first page loads: `source`, that page,
   * and every chunk they import statically, so a Feature only another page uses shows when it reaches
   * them.
   */
  readonly pages?: ReadonlyArray<string>
}

const plain = (render: string): string => `import { render } from "${render}"
render(() => <div style={{ opacity: 1 }}>hi</div>, document.body)
`

const complete = (render: string, entry: string, presence: boolean): string => {
  let element = `<wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>hi</wardic.div>`
  let imports = "WardicProvider, wardic"
  if (presence) {
    element = `<AnimatePresence><Show when={shown()}><wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>hi</wardic.div></Show></AnimatePresence>`
    imports = "AnimatePresence, WardicProvider, wardic"
  }
  return `import { createSignal, Show } from "solid-js"
import { render } from "${render}"
import { DomLive } from "@wardic/dom"
import { ${imports} } from "${entry}"
const [shown] = createSignal(true)
render(() => <WardicProvider env={DomLive}>{shown() && ${element}}</WardicProvider>, document.body)
void Show
`
}

/**
 * A Slim element's app (#511): one `w.div` that fades in under a `WardicProvider` with `features`, a
 * list of the Feature imports it names (none: the Slim element's base app).
 */
const slim = (render: string, entry: string, features: ReadonlyArray<string>): string => {
  const imports = ["WardicProvider", "w", ...features].join(", ")
  return `import { render } from "${render}"
import { DomLive } from "@wardic/dom"
import { ${imports} } from "${entry}"
render(() => <WardicProvider env={DomLive} features={[${features.join(", ")}]}><w.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>hi</w.div></WardicProvider>, document.body)
`
}

/**
 * A Wardic instance's app (#516): a `w.div` from `createWardic(features)`, under a `WardicProvider`
 * given none: what an app pays for its Features chosen on an instance, beside the same Features on its
 * provider (`slim`).
 */
const instance = (render: string, entry: string, features: ReadonlyArray<string>): string => {
  const imports = ["createWardic", "WardicProvider", ...features].join(", ")
  return `import { render } from "${render}"
import { DomLive } from "@wardic/dom"
import { ${imports} } from "${entry}"
const { w } = createWardic([${features.join(", ")}])
render(() => <WardicProvider env={DomLive}><w.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>hi</w.div></WardicProvider>, document.body)
`
}

/**
 * A scroll's app (#240): a Slim element whose `scaleX` is a box's scroll progress and whose `opacity` a
 * `createTransform` of it through ranges, under a `WardicProvider` with no Features: what an app that
 * reads a scroll pays, the `scroll` Feature (which `createScroll` brings) and its Timeline values with it.
 */
const scrollApp = (render: string, entry: string): string => `import { render } from "${render}"
import { DomLive } from "@wardic/dom"
import { createScroll, createTransform, w, WardicProvider } from "${entry}"
const Page = () => {
  let box!: HTMLDivElement
  const { scrollYProgress } = createScroll({ container: () => box })
  const opacity = createTransform(scrollYProgress, [0, 1], [0.2, 1])
  return <><div ref={box} style={{ height: "100px", overflow: "auto" }}><div style={{ height: "1000px" }} /></div><w.div style={{ scaleX: scrollYProgress, opacity }}>hi</w.div></>
}
render(() => <WardicProvider env={DomLive}><Page /></WardicProvider>, document.body)
`

/**
 * A Batch's app (#665): `createBatch` over a grid of plain divs under a `WardicProvider` with no
 * Features: what an app that animates its collections as one pays, beside the Slim element's.
 */
const batch = (render: string, entry: string): string => `import { For } from "solid-js"
import { render } from "${render}"
import { DomLive } from "@wardic/dom"
import { createBatch, WardicProvider } from "${entry}"
const cells = Array.from({ length: 100 }, (_, i) => i)
const Grid = () => {
  const grid = createBatch({ count: 100, animate: (i) => ({ x: (i % 10) * 20, y: Math.floor(i / 10) * 20, opacity: 1 }), transition: { type: "spring", bounce: 0.2 } })
  return <For each={cells}>{(i) => <div {...grid.at(i)} />}</For>
}
render(() => <WardicProvider env={DomLive}><Grid /></WardicProvider>, document.body)
`

/**
 * A Batch Reorder group's app (#714): `Reorder.BatchGroup` over 100 items of one size under a
 * `WardicProvider` with no Features: what an app that reorders a long list as one Batch pays, its items'
 * sizes one or each their own (the places' code is the same either way).
 */
const reorderBatch = (render: string, entry: string): string => `import { createSignal, For } from "solid-js"
import { render } from "${render}"
import { DomLive } from "@wardic/dom"
import { Reorder, WardicProvider } from "${entry}"
const List = () => {
  const [items, setItems] = createSignal(Array.from({ length: 100 }, (_, i) => \`item \${i}\`))
  return <Reorder.BatchGroup values={items()} onReorder={setItems} itemSize={{ width: 240, height: 48 }} gap={8}><For each={items()}>{(item) => <Reorder.BatchItem value={item}>{item}</Reorder.BatchItem>}</For></Reorder.BatchGroup>
}
render(() => <WardicProvider env={DomLive}><List /></WardicProvider>, document.body)
`

/**
 * A multi-route app (#548): a shell with a hover under a provider giving `domAnimation`, and three pages
 * loaded with `import()`: a plain one, one that drags (`LazyWardic features={[drag]}`) and one that
 * lays out (`features={[layout]}`). Measured, the plain page: what a page that never drags or lays out
 * downloads.
 */
const routes = (render: string, entry: string, name: string): App => ({
  name,
  binding: Bool.match(render === "@solidjs/web", { onTrue: (): Binding => "solid2", onFalse: (): Binding => "solid1" }),
  source: `import { lazy, Show } from "solid-js"
import { render } from "${render}"
import { DomLive } from "@wardic/dom"
import { domAnimation, w, WardicProvider } from "${entry}"
const Plain = lazy(() => import("./${name}-plain.tsx"))
const Drags = lazy(() => import("./${name}-drags.tsx"))
const Moves = lazy(() => import("./${name}-moves.tsx"))
render(() => <WardicProvider env={DomLive} features={[domAnimation]}><w.button whileHover={{ scale: 1.1 }}>menu</w.button><Show when={location.hash === "#drag"} fallback={<Show when={location.hash === "#layout"} fallback={<Plain />}><Moves /></Show>}><Drags /></Show></WardicProvider>, document.body)
`,
  pages: [
    `import { w } from "${entry}"
export default function Plain() { return <w.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>hi</w.div> }
`,
    `import { drag, LazyWardic, w } from "${entry}"
export default function Drags() { return <LazyWardic features={[drag]}><w.div drag="x">drag me</w.div></LazyWardic> }
`,
    `import { layout, LazyWardic, w } from "${entry}"
export default function Moves() { return <LazyWardic features={[layout]}><w.div layout>moves</w.div></LazyWardic> }
`,
  ],
})

/**
 * A Foldkit app (#795): an element program with an empty Model, embedded in the body, whose `view` is
 * given, after `imports` of its own.
 */
const foldkitApp = (imports: string, view: string): string => `import * as Schema from "effect/Schema"
import * as Runtime from "foldkit/runtime"
${imports}const Model = Schema.Struct({})
const container = document.createElement("div")
container.id = "app"
document.body.append(container)
Runtime.embed(Runtime.makeElement({ Model, init: () => ({ model: {} }), update: (model) => ({ model }), view: ${view}, container }))
`

/** Foldkit alone (#795): one `h.div` with an opacity style. What Foldkit's runtime and Effect cost before Wardic, the `f-slim` app's baseline. */
const foldkitPlain = (): string => foldkitApp("", `(_model, h) => h.div([h.Style({ opacity: "1" })], ["hi"])`)

/**
 * The Foldkit binding's Slim app (#795, ADR-0071 decision 38): one `w.div` fading in under
 * `w.Provider()`, on a Handle over `DomLive` with no Features. The binding's base, as `s1-slim` and
 * `s2-slim` are the Slim element's, with a budget of its own (`BUDGETS`).
 */
const foldkitSlim = (): string =>
  foldkitApp(
    `import { DomLive } from "@wardic/dom"
import * as Wardic from "@wardic/foldkit/Wardic"
const wardic = Wardic.make({ env: DomLive })
`,
    `(_model, h) => {
  const w = wardic.html(h)
  return w.div([w.Provider(), w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 }), w.Transition({ duration: 0.3 })], ["hi"])
}`,
  )

/** three.js alone (#885): a mesh in a scene, drawn by a WebGL renderer into the page. The `t2-stage` app's baseline. */
const threePlain = (): string => `import { render } from "@solidjs/web"
import { BoxGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, WebGLRenderer } from "three"
const scene = new Scene()
scene.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: "#ff8a3d" })))
const camera = new PerspectiveCamera(45, 1, 0.1, 100)
const renderer = new WebGLRenderer()
renderer.setAnimationLoop(() => renderer.render(scene, camera))
render(() => <div ref={(el) => el.append(renderer.domElement)} />, document.body)
`

/**
 * `@wardic/three/solid`'s base app (#885, ADR-0073 *Amendment (#885)* Q12): a `createStage` scene on
 * a WebGL renderer, and one `ward(mesh, …)` rising the mesh in under `<WardicStage>`, every import
 * `@wardic/three/solid`'s, as a scene with no page wards writes it (#927). A budget of its own.
 */
const threeStage = (): string => `import { render } from "@solidjs/web"
import { createStage, ward, WardicStage } from "@wardic/three/solid"
import { BoxGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, WebGLRenderer } from "three"
const scene = new Scene()
const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: "#ff8a3d" }))
scene.add(mesh)
const camera = new PerspectiveCamera(45, 1, 0.1, 100)
const Crate = () => ward(mesh, { initial: { scale: 0 }, animate: { scale: 1 }, transition: { duration: 0.3 } }).held
const App = () => {
  const stage = createStage({ renderer: () => new WebGLRenderer(), scene, camera })
  return <WardicStage value={stage}><div ref={stage} /><Crate /></WardicStage>
}
render(() => <App />, document.body)
`

/** A Stage's features (#885's PR 5): `stageDrag` and `stageBatches` given, a ward that drags and a keyed Batch of meshes. */
const threeFeatures = (): string => `import { render } from "@solidjs/web"
import { createBatch, createStage, stageBatches, stageDrag, ward, WardicStage } from "@wardic/three/solid"
import { BoxGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, WebGLRenderer } from "three"
const scene = new Scene()
const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: "#ff8a3d" }))
scene.add(mesh)
const camera = new PerspectiveCamera(45, 1, 0.1, 100)
const items = [{ id: 1 }, { id: 2 }, { id: 3 }]
const Pieces = () => {
  ward(mesh, { drag: true })
  createBatch({ each: () => items, key: "id", object: () => new Mesh(new BoxGeometry(), new MeshStandardMaterial()), initial: { scale: 0 }, animate: (_, i) => ({ x: i, scale: 1 }), exit: { scale: 0 } })
  return null
}
const App = () => {
  const stage = createStage({ renderer: () => new WebGLRenderer(), scene, camera, features: [stageDrag, stageBatches] })
  return <WardicStage value={stage}><div ref={stage} /><Pieces /></WardicStage>
}
render(() => <App />, document.body)
`

const APPS: ReadonlyArray<App> = [
  { name: "s1-plain", binding: "solid1", source: plain("solid-js/web") },
  { name: "s1-complete", binding: "solid1", source: complete("solid-js/web", "@wardic/solid/v1", false) },
  { name: "s1-presence", binding: "solid1", source: complete("solid-js/web", "@wardic/solid/v1", true) },
  { name: "s1-slim", binding: "solid1", source: slim("solid-js/web", "@wardic/solid/v1", []) },
  { name: "s1-colors", binding: "solid1", source: slim("solid-js/web", "@wardic/solid/v1", ["colors"]) },
  { name: "s1-layout", binding: "solid1", source: slim("solid-js/web", "@wardic/solid/v1", ["layout"]) },
  { name: "s1-hover", binding: "solid1", source: slim("solid-js/web", "@wardic/solid/v1", ["hover"]) },
  { name: "s1-drag", binding: "solid1", source: slim("solid-js/web", "@wardic/solid/v1", ["drag"]) },
  { name: "s1-dom-animation", binding: "solid1", source: slim("solid-js/web", "@wardic/solid/v1", ["domAnimation"]) },
  { name: "s1-dom-max", binding: "solid1", source: slim("solid-js/web", "@wardic/solid/v1", ["domMax"]) },
  { name: "s1-instance", binding: "solid1", source: instance("solid-js/web", "@wardic/solid/v1", ["domAnimation"]) },
  { name: "s1-scroll", binding: "solid1", source: scrollApp("solid-js/web", "@wardic/solid/v1") },
  { name: "s1-batch", binding: "solid1", source: batch("solid-js/web", "@wardic/solid/v1") },
  { name: "s1-reorder-batch", binding: "solid1", source: reorderBatch("solid-js/web", "@wardic/solid/v1") },
  routes("solid-js/web", "@wardic/solid/v1", "s1-routes"),
  { name: "s2-plain", binding: "solid2", source: plain("@solidjs/web") },
  { name: "s2-complete", binding: "solid2", source: complete("@solidjs/web", "@wardic/solid", false) },
  { name: "s2-presence", binding: "solid2", source: complete("@solidjs/web", "@wardic/solid", true) },
  { name: "s2-slim", binding: "solid2", source: slim("@solidjs/web", "@wardic/solid", []) },
  { name: "s2-colors", binding: "solid2", source: slim("@solidjs/web", "@wardic/solid", ["colors"]) },
  { name: "s2-layout", binding: "solid2", source: slim("@solidjs/web", "@wardic/solid", ["layout"]) },
  { name: "s2-hover", binding: "solid2", source: slim("@solidjs/web", "@wardic/solid", ["hover"]) },
  { name: "s2-drag", binding: "solid2", source: slim("@solidjs/web", "@wardic/solid", ["drag"]) },
  { name: "s2-dom-animation", binding: "solid2", source: slim("@solidjs/web", "@wardic/solid", ["domAnimation"]) },
  { name: "s2-dom-max", binding: "solid2", source: slim("@solidjs/web", "@wardic/solid", ["domMax"]) },
  { name: "s2-instance", binding: "solid2", source: instance("@solidjs/web", "@wardic/solid", ["domAnimation"]) },
  { name: "s2-scroll", binding: "solid2", source: scrollApp("@solidjs/web", "@wardic/solid") },
  { name: "s2-batch", binding: "solid2", source: batch("@solidjs/web", "@wardic/solid") },
  { name: "s2-reorder-batch", binding: "solid2", source: reorderBatch("@solidjs/web", "@wardic/solid") },
  routes("@solidjs/web", "@wardic/solid", "s2-routes"),
  { name: "f-plain", binding: "foldkit", source: foldkitPlain() },
  { name: "f-slim", binding: "foldkit", source: foldkitSlim() },
  { name: "t2-three", binding: "three-solid2", source: threePlain() },
  { name: "t2-stage", binding: "three-solid2", source: threeStage() },
  { name: "t2-features", binding: "three-solid2", source: threeFeatures() },
]

/** What a source map's sources are counted under: the packages, then the frameworks (`foldkit-lib` is the Foldkit framework, `foldkit` the binding; `three-lib` three.js, `three` Wardic's). */
const GROUPS = ["core", "dom", "solid", "foldkit", "object", "three", "effect", "solid-js", "foldkit-lib", "three-lib", "culori", "other"] as const
type Group = (typeof GROUPS)[number]

const groupOf = (source: string): Group => {
  const own = /packages\/(core|dom|solid|foldkit|object|three)\/src\//.exec(source)
  if (own !== null) return own[1] as Group
  if (/node_modules\/(\.bun\/[^/]+\/node_modules\/)?effect\//.test(source)) return "effect"
  if (/node_modules\/(\.bun\/[^/]+\/node_modules\/)?(solid-js|solid-js-1|solid-js-2|@solidjs)\//.test(source)) return "solid-js"
  if (/node_modules\/(\.bun\/[^/]+\/node_modules\/)?(foldkit|@foldkit)\//.test(source)) return "foldkit-lib"
  if (/node_modules\/(\.bun\/[^/]+\/node_modules\/)?culori\//.test(source)) return "culori"
  if (/node_modules\/(\.bun\/[^/]+\/node_modules\/)?three\//.test(source)) return "three-lib"
  return "other"
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** One source-map segment's fields, from its base64 VLQs. */
const fieldsOf = (segment: string): Array<number> => {
  const fields: Array<number> = []
  let value = 0
  let shift = 0
  for (const ch of segment) {
    const digit = B64.indexOf(ch)
    value += (digit & 31) << shift
    if ((digit & 32) !== 0) {
      shift += 5
      continue
    }
    if ((value & 1) === 1) fields.push(-(value >>> 1))
    if ((value & 1) === 0) fields.push(value >>> 1)
    value = 0
    shift = 0
  }
  return fields
}

/** A bundle's bytes by group: each generated column range counted under the source its segment maps to. */
const bytesByGroup = (js: string, map: { readonly sources: ReadonlyArray<string>; readonly mappings: string }): Record<Group, number> => {
  const bytes = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>
  const lines = js.split("\n")
  let source = 0
  map.mappings.split(";").forEach((line, row) => {
    const text = lines[row] ?? ""
    let column = 0
    const segments = line.split(",").filter((s) => s.length > 0).map((s) => {
      const fields = fieldsOf(s)
      column += fields[0]!
      if (fields.length > 1) source += fields[1]!
      return { column, source, mapped: fields.length > 1 }
    })
    segments.forEach((segment, i) => {
      const end = UndefinedOr.match(segments[i + 1], { onUndefined: () => text.length, onDefined: (next) => next.column })
      let group: Group = "other"
      if (segment.mapped) group = groupOf(map.sources[segment.source] ?? "")
      bytes[group] += Buffer.byteLength(text.slice(segment.column, end))
    })
  })
  return bytes
}

interface Size {
  readonly min: number
  readonly gz: number
  readonly br: number
  readonly groups: Record<Group, number>
}

/** One output chunk as `appSizeOf` reads it. */
interface Chunk {
  readonly type: "chunk" | "asset"
  readonly fileName: string
  readonly isEntry?: boolean
  readonly facadeModuleId?: string | null
  readonly imports?: ReadonlyArray<string>
  readonly code?: string
  readonly map?: { readonly sources: ReadonlyArray<string>; readonly mappings: string } | null
}

/**
 * An app's size, built as it ships: a Vite app build of its entry, and of each page beside it as
 * SolidStart builds a client's routes (`preserveEntrySignatures: "exports-only"`, #548). Measured as
 * what its first page loads: the app's chunk, its first page's when it has pages, and every chunk
 * either imports statically, each gzipped on its own as a page fetches them. `undefined` when the
 * base can't build it.
 */
const appSizeOf = async (root: string, deps: string, app: App, entry: string, side: string): Promise<Size | undefined> => {
  const pages = (app.pages ?? []).map((source, i) => {
    const file = join(root, "apps", `${app.name}-${["plain", "drags", "moves"][i]}.tsx`)
    writeFileSync(file, source)
    return file
  })
  const built = await build({
    configFile: false,
    logLevel: "error",
    mode: "production",
    root,
    plugins: [sideResolver(root, deps, BINDINGS[app.binding].importing), BINDINGS[app.binding].plugins()],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: join(root, "dist", app.name),
      minify: true,
      target: [...APP_TARGET],
      sourcemap: true,
      write: false,
      rollupOptions: { input: [entry, ...pages], preserveEntrySignatures: "exports-only" },
    },
  }).then(
    (output) => output,
    (error: unknown) => {
      if (side === "head") throw error
      return undefined
    },
  )
  if (Predicate.isUndefined(built)) return undefined
  const chunks = ([built].flat() as ReadonlyArray<{ readonly output: ReadonlyArray<Chunk> }>).flatMap((o) => o.output).filter((c) => c.type === "chunk")
  const byName = new Map(chunks.map((c) => [c.fileName, c]))
  const entryOf = (file: string): Chunk => chunks.find((c) => c.isEntry === true && c.facadeModuleId === file)!
  // What the first page loads: the app's and that page's chunks, and their static imports.
  const loaded = new Set<string>()
  const visit = (chunk: Chunk): void => {
    if (loaded.has(chunk.fileName)) return
    loaded.add(chunk.fileName)
    for (const imported of chunk.imports ?? []) visit(byName.get(imported)!)
  }
  visit(entryOf(entry))
  Arr.forEach(Arr.take(pages, 1), (page) => visit(entryOf(page)))
  const groups = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>
  let min = 0
  let gz = 0
  let br = 0
  for (const file of loaded) {
    const chunk = byName.get(file)!
    const js = Buffer.from(chunk.code!)
    min += js.length
    gz += gzipSync(js, { level: 9 }).length
    br += brotliCompressSync(js).length
    if (chunk.map) {
      const per = bytesByGroup(chunk.code!, chunk.map)
      for (const g of GROUPS) groups[g] += per[g]
    }
  }
  return { min, gz, br, groups }
}

/** Build every app on one side: its sources from `commit` (the working tree when undefined). */
const sizesOf = async (side: string, commit: string | undefined, deps: string): Promise<ReadonlyMap<string, Size>> => {
  const root = join(OUT, side)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, "apps"), { recursive: true })
  // With each package's manifest, so its `sideEffects: false` shakes the bundle as an app's install would.
  sourcesInto(root, commit, true)
  // vite-plugin-solid's Babel reads the JSX import source from a package's own node_modules.
  if (!existsSync(join(root, "node_modules"))) symlinkSync(join(deps, "packages/solid/node_modules"), join(root, "node_modules"))
  const sizes = new Map<string, Size>()
  for (const app of APPS) {
    const entry = join(root, "apps", `${app.name}.${BINDINGS[app.binding].ext}`)
    writeFileSync(entry, app.source)
    // An app the base can't build is one the head adds (its API is new): reported, not gated.
    const size = await appSizeOf(root, deps, app, entry, side)
    if (Predicate.isNotUndefined(size)) sizes.set(app.name, size)
  }
  return sizes
}

const base = arg("base", "main")
const headRef = arg("head", "")
const baseCommit = commitOf(base)
const headCommit = Bool.match(headRef.length > 0, { onTrue: (): string | undefined => commitOf(headRef), onFalse: constUndefined })
const dirty =
  execSync(`git status --porcelain -- ${PACKAGES.map((pkg) => `packages/${pkg}/src`).join(" ")}`, { cwd: REPO }).toString().trim().length > 0
const headLabel = UndefinedOr.match(headCommit, {
  onUndefined: () => Bool.match(dirty, { onTrue: () => "the working tree (modified)", onFalse: () => "the working tree" }),
  onDefined: (commit) => `${headRef} (${commit.slice(0, 7)})`,
})
console.log(`size: base ${base} (${baseCommit.slice(0, 7)}) against ${headLabel}`)

const baseSizes = await sizesOf("base", baseCommit, depsOf(baseCommit))
const headSizes = await sizesOf("head", headCommit, UndefinedOr.match(headCommit, { onUndefined: () => REPO, onDefined: depsOf }))

const kb = (bytes: number): string => (bytes / 1024).toFixed(1)
const pad = (text: string, width: number): string => text.padStart(width)
const change = (head: number, base: number): string => {
  const percent = ((head / base - 1) * 100).toFixed(1)
  return Bool.match(head >= base, { onTrue: () => `+${percent}%`, onFalse: () => `${percent}%` })
}

let failed = false
console.log("\nKB; gzip at level 9, brotli at its default; gated on gzip, head against base (+1%)")
console.log(`${"app".padEnd(14)}${pad("min", 9)}${pad("gzip", 15)}${pad("change", 9)}${pad("brotli", 15)}   gate`)
for (const app of APPS) {
  const h = headSizes.get(app.name)!
  const b = baseSizes.get(app.name)
  if (b === undefined) {
    console.log(`${app.name.padEnd(14)}${pad(kb(h.min), 9)}${pad(`new → ${kb(h.gz)}`, 15)}${pad("", 9)}${pad(`new → ${kb(h.br)}`, 15)}   new`)
    continue
  }
  const fails = h.gz > b.gz * GATE
  if (fails) failed = true
  console.log(
    `${app.name.padEnd(14)}${pad(kb(h.min), 9)}${pad(`${kb(b.gz)} → ${kb(h.gz)}`, 15)}${pad(change(h.gz, b.gz), 9)}${pad(`${kb(b.br)} → ${kb(h.br)}`, 15)}   ${
      Bool.match(fails, { onTrue: () => "FAIL", onFalse: () => "ok" })
    }`,
  )
}

console.log("\nbudgets: gzip KB, the head at most")
for (const [name, budget] of Object.entries(BUDGETS)) {
  const h = headSizes.get(name)!
  const over = h.gz > budget * 1024
  if (over) failed = true
  console.log(`${name.padEnd(14)}${pad(kb(h.gz), 9)} of ${budget}   ${Bool.match(over, { onTrue: () => "FAIL", onFalse: () => "ok" })}`)
}

console.log("\nthe head's minified KB by package (change from the base)")
console.log(`${"app".padEnd(14)}${GROUPS.map((g) => pad(g, 15)).join("")}`)
for (const app of APPS) {
  const h = headSizes.get(app.name)!
  const b = UndefinedOr.match(baseSizes.get(app.name), { onUndefined: () => h, onDefined: (given) => given })
  console.log(
    `${app.name.padEnd(14)}${GROUPS.map((g) => {
      const delta = h.groups[g] - b.groups[g]
      const shown = Bool.match(Math.abs(delta) < 51, { onTrue: () => "", onFalse: () => ` (${Bool.match(delta > 0, { onTrue: () => "+", onFalse: () => "" })}${kb(delta)})` })
      return pad(`${kb(h.groups[g])}${shown}`, 15)
    }).join("")}`,
  )
}
process.exit(Bool.match(failed, { onTrue: () => 1, onFalse: () => 0 }))
