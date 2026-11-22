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
- **A Batch** moves many objects on the same keys as one run: `wardic.batch(meshes)`.

Colours, an `InstancedMesh`'s instances, and hover and press in a scene come next.

Private until Wardic 1.3: not on npm yet. See [the roadmap](https://wardic.dev/roadmap).
