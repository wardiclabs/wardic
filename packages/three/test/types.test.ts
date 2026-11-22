/**
 * `@wardic/three`'s targets are typed by three's own types (#883, ADR-0069 decision 4): a misspelt key,
 * a key a Subject has nowhere and a Color key are type errors. Checked by `bun run typecheck:tests`;
 * the one test only runs the calls' types.
 */
import * as WardicThree from "@wardic/three/WardicThree"
import { expect, it } from "@effect/vitest"
import * as THREE from "three"

/** Calls whose types are what's checked: never run. */
const typed = (wardic: WardicThree.WardicThree): void => {
  const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  const camera = new THREE.PerspectiveCamera()
  const light = new THREE.PointLight()
  const shader = new THREE.ShaderMaterial({ uniforms: { uProgress: { value: 0 } } })
  const uniforms = { uTime: { value: 0 }, uOffset: { value: new THREE.Vector2() } }

  // A mesh: Motion's transform keys, its material's numbers, and its vectors' axes.
  wardic.animate(cube, { x: 2, rotateY: 90, scaleZ: 2, opacity: 0.5, roughness: 0.2, emissiveIntensity: 2, normalScaleX: 1, positionY: 1 })
  // @ts-expect-error: a misspelt key.
  wardic.animate(cube, { rotatY: 90 })
  // @ts-expect-error: a Color isn't a number key (linear colours are #883's PR 3).
  wardic.animate(cube, { color: 1 })
  // @ts-expect-error: a key the mesh has nowhere.
  wardic.animate(cube, { fov: 30 })

  // A camera adds its projection keys; a light its intensity.
  wardic.animate(camera, { fov: 30, zoom: 2, near: 0.5, far: 50, z: 10 })
  wardic.animate(light, { intensity: 4, distance: 10, y: 3 })
  // A material's own numbers, and a ShaderMaterial's uniforms (three types them as any name).
  wardic.animate(cube.material, { opacity: 0, metalness: 1 })
  wardic.animate(shader, { uProgress: 1 })
  // A uniforms object: its names, and a vector uniform's axes.
  wardic.animate(uniforms, { uTime: 2, uOffsetX: 1 })
  // @ts-expect-error: a uniform it doesn't have.
  wardic.animate(uniforms, { uSpeed: 1 })
  // A Vector3: its own keys.
  wardic.animate(cube.position, { x: 1 })

  // A Batch's keys are its members' scene keys.
  const swarm = wardic.batch([cube, cube.clone()])
  wardic.animate(swarm, { y: (i) => i, opacity: 0.5 })
  swarm.get(0, "rotateY")
  // @ts-expect-error: a key its members have nowhere.
  swarm.get(0, "fov")
}

it("TY1: the typed calls compile", () => {
  expect(typeof typed).toBe("function")
})
