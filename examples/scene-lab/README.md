# Wardic scene lab

`@wardic/three`'s proving ground (#883, ADR-0073 decision 29), as `layout-lab` is for layout: a page of cards, each a scene of its own exercising one part of `@wardic/three`. Every card has its own canvas, `WebGLRenderer`, scene, camera and `WardicThree` runtime, whose `frame(t)` runs before each render.

| Card | What it shows |
|---|---|
| Transforms | `x`, `rotateY` and `scale` on a spring that keeps its speed through a change of target, and on a tween |
| Colours in linear light | red to blue through `#bc00bc`, and a colour's spring |
| A camera's fov | `fov` and `z`, the projection worked out again after each write |
| A Batch of meshes | 144 meshes as one run, a function of each member's index, a stagger by rank |
| 10,000 instances | an `InstancedMesh`'s Batch: positions, rotations and instance colour; the readout is Wardic's frame time |
| Hover and press | `hover` and `press` on meshes, and on an `InstancedMesh`'s instances by their `instanceId` |

Its "Solid hooks" section (#885) runs each card on a Stage from `@wardic/three/solid`'s `createStage`, its scene moved by `@wardic/solid`'s hooks:

| Card | What it shows |
|---|---|
| A Stage, and a ward on a mesh | `createStage` mounting and sizing its canvas, drawing on demand; `ward(mesh, …)` with `whileHover` and `whileTap`; `createHover(mesh)` and `createPress(mesh)` |
| Scene objects | `createSceneObject`: crates joining the scene, and leaving once their exit lands; a swap given as an accessor |
| Variants down the graph | a card's pips following its variants through three's graph, and a pip moved to another card following that one |
| Drag in 3D | `ward(mesh, { drag })`: along an axis within its range, on the plane facing the camera, and on the ground with momentum |
| Batches in a scene | `createBatch` over meshes, keyed, with an exit; and an `InstancedMesh`'s instances by count |
| A Frame effect | `createFrameEffect` pinning an HTML label to a moving moon, in the Stage's Host loop before the render |
| The sensors on a mesh | `createDrag(dial)`, the app turning the dial from its samples in a Frame effect; `createHover` and `createPress` |

```sh
bun run dev         # Vite, Solid 2
bun run typecheck
```

On a tailnet, serve it on the machine's Tailscale address only: `bunx vite --host <tailscale address> --port 5175 --strictPort`. Vite allows the bench box's MagicDNS names, `wardic-bench` and the tailnet's `.ts.net` ones.

Its browser test (`vitest.browser.config.ts`, `scene-lab-browser` in the root's browser tier) renders a card for every scenario, checks each canvas drew, and drives one real pointer path: a real mouse over a mesh and a click on it, through the scene's input on a real canvas and window. Each Solid hooks card has its own: its Stage's renderer made and its canvas sized, then a real mouse or a button through its hooks (SL3–SL9).
