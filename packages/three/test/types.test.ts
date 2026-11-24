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
  // An inline sequence's options and its Segments are checked, as a declared one's (#963): labels, a
  // Segment's `at`, a Batch's Segment and a function Segment among them.
  wardic.animate(
    [[cube, { x: 1 }], "spin", [cube, { rotateY: 90 }, { at: "spin" }], [swarm, { y: 1 }], [(value: number) => void value, [0, 1], { duration: 1 }]],
    { duration: 2, repeat: 1, delay: 0.1 },
  )
  // @ts-expect-error: a sequence's `duration` is a number.
  wardic.animate([[cube, { x: 1 }]], { duration: "slow" })
  // @ts-expect-error: a misspelt option.
  wardic.animate([[cube, { x: 1 }]], { durration: 1 })
  // @ts-expect-error: nor a Segment's own, beside the sequence's options.
  wardic.animate([[cube, { x: 1 }, { duration: "slow" }]], { delay: 0.1 })
  // Nor options that would fit an array's target: empty ones check the sequence, a target's field is no option.
  wardic.animate([[cube, { x: 1 }]], {})
  // @ts-expect-error: a Segment's value, with empty options.
  wardic.animate([[cube, { x: true }]], {})
  // @ts-expect-error: a target's `transition` isn't a sequence's option (its `defaultTransition` is).
  wardic.animate([[cube, { x: 1 }]], { transition: { duration: 1 } })
  // @ts-expect-error: nor a third argument.
  wardic.animate([[cube, { x: 1 }]], {}, { duration: 1 })
  // A list of unlike uniforms objects takes the uniforms they share, as ever.
  const near = { uTime: { value: 0 }, uNear: { value: 0 } }
  const far = { uTime: { value: 0 }, uFar: { value: 0 } }
  wardic.animate([near, far], { uTime: 1 })
  // @ts-expect-error: a uniform only one of them has.
  wardic.animate([near, far], { uNear: 1 })
  const tinted = { uTime: { value: 0 }, uTint: { value: new THREE.Color() } }
  // @ts-expect-error: nor a colour uniform only one of them has.
  wardic.animate([tinted, near], { uTint: "#f00" })

  // A transition's entries are the Subject's own keys (#952): a scene key's, a colour's.
  wardic.animate(cube, { x: 2, color: "#00f" }, { duration: 1, x: { duration: 0.2 }, color: { type: "tween", duration: 0.1 } })
  wardic.animate(cube, { x: 2, opacity: 0, transition: { duration: 1, opacity: { duration: 0.3 }, rotateY: { stiffness: 200 } } })
  wardic.animate(uniforms, { uTime: 2, uOffsetX: 1 }, { uTime: { duration: 2 }, uOffsetX: { duration: 1 } })
  wardic.animate({ uTint: { value: new THREE.Color() } }, { uTint: "#f0f", transition: { uTint: { duration: 0.4 } } })
  wardic.animate(cube.position, { x: 1 }, { x: { duration: 0.5 } })
  // A ShaderMaterial, its uniforms any name: an entry under any name.
  wardic.animate(shader, { uProgress: 1 }, { duration: 1, ease: "linear", uProgress: { duration: 0.2 } })
  // A channel's entry: on a target by its channels, or by its colour, its own over its colour's.
  wardic.animate(cube, { colorR: 0.5, emissiveB: 1 }, { colorR: { duration: 0.2 }, emissive: { duration: 0.1 } })
  wardic.animate(cube, { color: "#00f", transition: { color: { duration: 0.2 }, colorR: { duration: 1 } } })
  wardic.animate({ uTint: { value: new THREE.Color() } }, { uTintG: 0.5 }, { uTintG: { duration: 0.4 } })
  // @ts-expect-error: a misspelt entry.
  wardic.animate(cube, { x: 2 }, { xx: { duration: 0.2 } })
  // @ts-expect-error: nor in the target's own transition: a key the mesh has nowhere.
  wardic.animate(cube, { x: 2, transition: { fov: { duration: 0.2 } } })
  // @ts-expect-error: a scene has no layout animations to take a `layout` entry.
  wardic.animate(cube, { x: 2 }, { layout: { duration: 0.2 } })
  // A Batch's entries: its keys, an instance's colour and its channels.
  wardic.animate(swarm, { y: 1, color: "#f00" }, { y: { duration: 0.2 }, color: { duration: 0.4 } })
  wardic.animate(instances, { x: (i) => i, color: "#fff" }, { duration: 1, x: { duration: 0.5 }, color: { duration: 0.2 } })
  wardic.animate(instances.at(0), { color: "#fff" }, { colorG: { duration: 0.2 } })
  // @ts-expect-error: an instance's material's keys aren't an instance's.
  wardic.animate(instances, { x: 1 }, { opacity: { duration: 0.2 } })

  // A Subject whose keys are any name (#958): a ShaderMaterial's uniforms, and a mesh drawn with one.
  // Its target's own transition, an entry under any name, and its Transition end.
  const raw = new THREE.RawShaderMaterial({ uniforms: { uProgress: { value: 0 } } })
  const shaded = new THREE.Mesh(new THREE.BoxGeometry(), shader)
  wardic.animate(shader, { uProgress: 1, transition: { duration: 1, uProgress: { duration: 0.2 } }, transitionEnd: { uProgress: 0 } })
  wardic.animate(raw, { uProgress: [0, 1], transition: { type: "tween", ease: "linear", uProgress: { duration: 0.4 } }, transitionEnd: { uProgress: 1 } })
  wardic.animate(shaded, { x: 1, uProgress: 1, transition: { duration: 1, x: { duration: 0.2 } }, transitionEnd: { y: 0 } })
  wardic.animate([shader, raw], { uProgress: 1, transition: { duration: 1 }, transitionEnd: { uProgress: 0 } })
  // Any other object whose keys are any name: its own values.
  const levels: { gain: number; [band: string]: number } = { gain: 0 }
  wardic.animate(levels, { gain: 1, bass: [0, 1], transition: { duration: 1 }, transitionEnd: { gain: 0 } })
  // @ts-expect-error: its Transition end's values are its own, numbers.
  wardic.animate(levels, { gain: 1, transitionEnd: { gain: "loud" } })
  // A uniforms object of any name beside one it names: a uniform a number or a colour.
  const tuned: { uTime: THREE.IUniform<number>; [name: string]: THREE.IUniform } = { uTime: { value: 0 } }
  wardic.animate(tuned, { uTime: 1, uTint: "#f0f", transition: { duration: 1 }, transitionEnd: { uTime: 0 } })
  // @ts-expect-error: a key's value isn't an object.
  wardic.animate(shader, { uProgress: { duration: 1 } })
  // @ts-expect-error: a misspelt field.
  wardic.animate(shader, { uProgress: 1, transition: { durration: 1 } })
  // @ts-expect-error: a field of the wrong type.
  wardic.animate(shaded, { x: 1, transition: { duration: "slow" } })
  // @ts-expect-error: a Transition end's values aren't keyframes.
  wardic.animate(shader, { uProgress: 1, transitionEnd: { uProgress: [0, 1] } })
  // A call that names its Subject's type keeps the target it had: values only.
  wardic.animate<typeof shader>(shader, { uProgress: 1 })
  wardic.animate<typeof shader.uniforms>(shader.uniforms, { uProgress: 1, uTint: "#f0f" })
  // A uniforms object of any name alone, its type inferred (#959): its own transition and Transition end.
  wardic.animate(shader.uniforms, { uProgress: 1, uTint: "#f0f", transition: { duration: 1, uTint: { duration: 0.2 } }, transitionEnd: { uProgress: 0 } })
  // @ts-expect-error: a uniform's value isn't an object.
  wardic.animate(shader.uniforms, { uProgress: { duration: 1 } })
  // A list of meshes is checked as ever.
  wardic.animate([cube, cube.clone()], { x: 1, rotateY: 90 })
  // @ts-expect-error: a key the meshes have nowhere.
  wardic.animate([cube, cube.clone()], { fov: 30 })
  // A target typed as a ThreeTarget fits as ever: a wrapper's, and one declared so.
  const forward = <T extends object>(subject: T, target: WardicThree.ThreeTarget<T>) => wardic.animate(subject, target)
  const declared: WardicThree.ThreeTarget<typeof shader> = { uProgress: 1 }
  wardic.animate(shader, declared)
  void forward(cube, { x: 1 })

  // Any other object's key it may lack, an optional one, and its numeric keys, a typed array's (#964).
  const rig: { weight?: number; bias: number } = { weight: 0, bias: 0 }
  wardic.animate(rig, { weight: 1, transition: { weight: { duration: 0.2 } }, transitionEnd: { weight: 0 } })
  const morphs = new Float32Array(4)
  wardic.animate(morphs, { 0: 1, 2: [0, 1], transition: { 0: { duration: 0.2 } }, transitionEnd: { 0: 0 } })
  // A Partial Record, its keys any name: its own transition and Transition end.
  const mix: Partial<Record<string, number>> = { dry: 1 }
  wardic.animate(mix, { dry: 0, wet: 1, transition: { duration: 1, wet: { duration: 0.2 } }, transitionEnd: { dry: 1 } })
  // @ts-expect-error: an optional key's value is a number, as a key it has.
  wardic.animate(rig, { weight: "heavy" })
  // @ts-expect-error: an element's value is a number.
  wardic.animate(morphs, { 0: "x" })
  // @ts-expect-error: a misspelt key is caught beside the index.
  wardic.animate(morphs, { lenght: 1 })
  // @ts-expect-error: a Partial Record's values are numbers.
  wardic.animate(mix, { wet: "x" })
  // @ts-expect-error: nor its Transition end's.
  wardic.animate(mix, { wet: 1, transitionEnd: { dry: "x" } })
  // @ts-expect-error: nor is a keyframe `undefined`, which isn't a value to animate to.
  wardic.animate(mix, { wet: [0, undefined], transition: { duration: 1 } })
  // A key that may hold `undefined`, a number index alone and beside a name, and a list of them.
  const gain: { level: number | undefined } = { level: 0 }
  wardic.animate(gain, { level: 1, transitionEnd: { level: 0 } })
  const steps: { [step: number]: number } = { 0: 0 }
  wardic.animate(steps, { 0: 1, transition: { 0: { duration: 0.2 } } })
  const clip: { [frame: number]: number; name: string } = { 0: 0, name: "" }
  wardic.animate(clip, { 0: 1, name: "intro" })
  wardic.animate([rig, { weight: 0, bias: 0 }], { weight: 1 })
  wardic.animate([morphs, new Float32Array(4)], { 3: 1 })
  // @ts-expect-error: an optional key's end is a number.
  wardic.animate(rig, { weight: 1, transitionEnd: { weight: "heavy" } })
  // @ts-expect-error: and an element's.
  wardic.animate(morphs, { 0: 1, transitionEnd: { 0: "x" } })
  // @ts-expect-error: a number index has no named key.
  wardic.animate(steps, { name: "intro" })
}

it("TY1: the typed calls compile", () => {
  expect(typeof typed).toBe("function")
})
