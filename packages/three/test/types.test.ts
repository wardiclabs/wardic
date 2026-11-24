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
  // A colour: a CSS colour, a hex number or a Color, keyframes of them, and its channels in linear light.
  wardic.animate(cube, { color: "#ff8800", emissive: 0x00ff00, emissiveIntensity: 2 })
  wardic.animate(cube, { color: ["#f00", null, new THREE.Color("blue")], transitionEnd: { color: "red" } })
  wardic.animate(cube, { colorR: 0.5, emissiveB: 1 })
  // @ts-expect-error: a colour isn't a boolean.
  wardic.animate(cube, { color: true })
  // @ts-expect-error: a number key isn't a colour.
  wardic.animate(cube, { opacity: "#fff" })
  wardic.animate(light, { color: "white", intensity: 2 })
  wardic.animate({ uTint: { value: new THREE.Color() } }, { uTint: "#f0f", uTintG: 0.5 })
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
  // A Batch's colours: one for all, two stops, or a function of a member's index; its keys up front.
  wardic.animate(swarm, { color: (i) => ["#f00", "#00f"][i % 2] as string, emissive: ["#000", 0xffffff] })
  wardic.animate(swarm.at(1), { color: "#0f0", emissiveG: 1 })
  wardic.batch([cube], { keys: ["x", "color"] })
  // @ts-expect-error: a number key isn't a colour.
  wardic.animate(swarm, { opacity: "#fff" })

  // An InstancedMesh's instances: their transforms and their colour, by index.
  const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 100)
  const instances = wardic.batch(instanced, { keys: ["x", "rotateY", "color"] })
  wardic.animate(instances, { x: (i) => i, rotateY: [0, 90], color: (i) => new THREE.Color().setHSL(i / 100, 1, 0.5) })
  wardic.animate(instances.at(3), { scale: 1.4, colorR: 1 })
  instances.get(3, "colorG")
  // @ts-expect-error: the instances share one material: its keys aren't an instance's.
  wardic.animate(instances, { opacity: 0 })
  // @ts-expect-error: nor in its keys.
  wardic.batch(new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 4), { keys: ["roughness"] })
  // Gestures: the hit on the event, a press's end told its success.
  wardic.hover(cube, (event) => {
    const hit: THREE.Object3D | undefined = event.object
    return (end) => void [hit, end.point, end.distance]
  })
  wardic.press(instances, (event) => (end, { success }) => void [event.member, event.instanceId, end.nativeEvent, success])
  // @ts-expect-error: an event has no such field.
  wardic.hover(cube, (event) => event.button)
  // A sequence's Segment of a Batch takes colours.
  wardic.animate([
    [instances, { color: ["#000", "#fff"], y: 1 }],
    [swarm.at(0), { color: "#f0f" }, { at: 0 }],
  ])

  // A transition's entries are the Subject's own keys (#952): a scene key's, a colour's by its name.
  wardic.animate(cube, { x: 2, color: "#00f" }, { duration: 1, x: { duration: 0.2 }, color: { type: "tween", duration: 0.1 } })
  wardic.animate(cube, { x: 2, opacity: 0, transition: { duration: 1, opacity: { duration: 0.3 }, rotateY: { stiffness: 200 } } })
  wardic.animate(uniforms, { uTime: 2, uOffsetX: 1 }, { uTime: { duration: 2 }, uOffsetX: { duration: 1 } })
  wardic.animate({ uTint: { value: new THREE.Color() } }, { uTint: "#f0f", transition: { uTint: { duration: 0.4 } } })
  wardic.animate(cube.position, { x: 1 }, { x: { duration: 0.5 } })
  // A ShaderMaterial, its uniforms any name: an entry under any name.
  wardic.animate(shader, { uProgress: 1 }, { duration: 1, ease: "linear", uProgress: { duration: 0.2 } })
  // @ts-expect-error: a colour's entry is under its name, not its channels'.
  wardic.animate(cube, { color: "#00f" }, { colorR: { duration: 0.2 } })
  // @ts-expect-error: a misspelt entry.
  wardic.animate(cube, { x: 2 }, { xx: { duration: 0.2 } })
  // @ts-expect-error: nor in the target's own transition: a key the mesh has nowhere.
  wardic.animate(cube, { x: 2, transition: { fov: { duration: 0.2 } } })
  // @ts-expect-error: a scene has no layout animations to take a `layout` entry.
  wardic.animate(cube, { x: 2 }, { layout: { duration: 0.2 } })
  // A Batch's entries: its keys, an instance's colour by its name.
  wardic.animate(swarm, { y: 1, color: "#f00" }, { y: { duration: 0.2 }, color: { duration: 0.4 } })
  wardic.animate(instances, { x: (i) => i, color: "#fff" }, { duration: 1, x: { duration: 0.5 }, color: { duration: 0.2 } })
  // @ts-expect-error: nor an instance's channels.
  wardic.animate(instances.at(0), { color: "#fff" }, { colorG: { duration: 0.2 } })
  // @ts-expect-error: an instance's material's keys aren't an instance's.
  wardic.animate(instances, { x: 1 }, { opacity: { duration: 0.2 } })
}

it("TY1: the typed calls compile", () => {
  expect(typeof typed).toBe("function")
})
