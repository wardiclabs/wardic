# @wardic/three

Wardic for three.js: Motion's `animate` on a scene's meshes, materials, cameras, lights and uniforms, on frames your Host loop pumps. Its keys are Motion's names, typed by three's own types.

```ts
import * as WardicThree from "@wardic/three/WardicThree"

const wardic = WardicThree.make()
renderer.setAnimationLoop((time) => {
  wardic.frame(time) // Wardic's writes for this frame, before it's drawn
  renderer.render(scene, camera)
})

wardic.animate(cube, { y: 2, rotateY: 180 }, { type: "spring", bounce: 0.3 })
await wardic.animate(cube, { opacity: 0 }, { duration: 0.4 })
wardic.animate(camera, { fov: 35, z: 8 })
```

- **Transform keys** are Motion's: `x`, `y` and `z` move `position`; `rotateX`, `rotateY` and `rotateZ` turn `rotation`, in degrees; `scale` sets all three scales, and `scaleX`, `scaleY` and `scaleZ` one each. Each frame they're written in one call per vector.
- **Any other key** is the object's own number (a camera's `fov`, a light's `intensity`), else its material's (`opacity`, `roughness`), a `ShaderMaterial` uniform's (`uProgress`), a TSL uniform node's, or a vector's axis (`normalScaleX`).
- **Types:** `animate(cube, { rotatY: 90 })` is a type error, and a camera suggests its projection keys.
- **A shared material** changes on every mesh that uses it. In development, Wardic warns at the first key it finds on one, naming the other meshes.
- **three's rules after a write:** a camera's projection keys update its projection matrix, and an `opacity` below 1 draws its material transparent.
- **Units:** `x`, `y` and `z` are metres, so a spring rests within millimetres. Give `make({ unitScale: 1 })` for a scene in pixels.
- **Reduced motion** snaps the transforms and a camera's `fov` and `zoom`, and fades the rest.
- **Colours** (`color`, `emissive`, a uniform's `Color`) take a CSS colour, a hex number or a `Color`, and blend in linear light, three's: red to blue passes `#bc00bc`. A spring keeps a colour's speed through a change of target.
- **A Batch** moves many objects on the same keys as one run: `wardic.batch(meshes)`. A value can be a function of a member's index: `animate(swarm, { y: (i) => i * 2, color: (i) => palette[i % 5] })`.
- **An `InstancedMesh`'s instances** are a Batch too, `wardic.batch(instanced)`, each moved by its transforms and its instance colour. Each frame, Wardic writes the matrices of the instances that moved, uploads only that span, and keeps the mesh's bounding sphere around them, so culling and picking stay right.

```ts
const swarm = wardic.batch(instanced)
wardic.animate(swarm, { y: (i) => rowY(i), rotateY: 90 }, { type: "spring", delay: stagger(0.002) })
wardic.animate(swarm.at(42), { scale: 1.4, color: "#ff8800" })
```

- **Hover and press:** given its canvas, camera and scene, a runtime's `hover(subject, onStart)` and `press(subject, onStart)` work on the scene's objects, a Batch's members and an `InstancedMesh`'s instances. The pointer hits the nearest drawn object under it, cast once a frame, so hover follows what moves under a still pointer.

```ts
const wardic = WardicThree.make({ canvas: renderer.domElement, camera, scene })
wardic.hover(crate, () => {
  wardic.animate(crate, { scale: 1.1 })
  return () => wardic.animate(crate, { scale: 1 })
})
wardic.press(swarm, (event) => (end, { success }) => {
  if (success) select(event.member)
})
```

- **Tests:** `@wardic/three/TestStage` runs a scene with no renderer and no page, in Node: `stage.pointer.over(crate)`, then `stage.frame()`.

## With Solid 2

`@wardic/three/solid` runs a scene for a component: `createStage` mounts the canvas, keeps it sized and runs the Host loop, and under `<WardicStage>` the hooks of `@wardic/solid` work on the scene's objects. `solid-js`, `@solidjs/web` and `@wardic/solid` are optional peers, needed only for this subpath.

```tsx
import { createFrameEffect, ward } from "@wardic/solid"
import { createSceneObject, createStage, stageDrag, WardicStage } from "@wardic/three/solid"

const stage = createStage({ renderer: () => new WebGLRenderer({ antialias: true }), scene, camera, frameloop: "demand" })

const Crate = (props: { mesh: Mesh }) => {
  const crate = ward(props.mesh, { initial: { scale: 0 }, animate: { scale: 1 }, whileHover: { y: 0.3, color: "#4fd1c5" }, drag: true })
  // In the Host loop, after Wardic's writes and before the render: the crate's shadow shrinks as it rises.
  createFrameEffect(() => crate.read("y")(), (y) => shadow.scale.setScalar(1 - y / 2))
  return crate.held
}

<WardicStage value={stage}>
  <div class="viewport" ref={stage} />
  <Crate mesh={crate} />
</WardicStage>
```

- **`createStage`** takes a renderer or a function making one (called once the page has settled, so a server never does), a scene and a camera. `frameloop: "demand"` draws only while something moves, a Frame effect applies, or after `invalidate()`. `{ wardic }` adopts a runtime made outside Solid, whose maker pumps its frames.
- **`ward(mesh, config)`** under the Stage takes `initial`, `animate`, `transition`, `variants`, `whileHover` and `whileTap`. A ward with variants and no names of its own follows the nearest ward above its object in three's graph, not Solid's tree.
- **`createSceneObject(mesh, config)`** adds an object to the scene as its ward starts (its `parent`, else the one it has, else the scene) and removes it once its `exit` lands. `dispose: true` disposes its geometries and materials then.
- **Drag and Batches are features,** each code only a scene that uses it carries: `createStage({ …, features: [stageDrag, stageBatches] })`. `ward(mesh, { drag })` drags on the plane facing the camera, a `dragPlane`, or an axis; `createBatch({ object, … })` or `createBatch({ instances, … })` animates meshes or an `InstancedMesh`'s instances as one run.
- **The sensors** take a scene's object: `createHover(mesh)`, `createPress(mesh)`, `createDrag(mesh)`.
- **Tests:** `@wardic/three/solid`'s `TestStage.make` is a Stage too, so a component's hooks run in Node with no renderer.

Private until Wardic 1.3: not on npm yet. See [the roadmap](https://wardic.dev/roadmap).
