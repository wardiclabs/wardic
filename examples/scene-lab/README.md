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

```sh
bun run dev         # Vite, Solid 2
bun run typecheck
```

On a tailnet, serve it on the machine's Tailscale address only: `bunx vite --host <tailscale address> --port 5175 --strictPort`. Vite allows the bench box's MagicDNS names, `wardic-bench` and the tailnet's `.ts.net` ones.

Its browser test (`vitest.browser.config.ts`, `scene-lab-browser` in the root's browser tier) renders a card for every scenario, checks each canvas drew, and drives one real pointer path: a real mouse over a mesh and a click on it, through the scene's input on a real canvas and window. Steps 3 and 4 add the Solid hooks' cards.
