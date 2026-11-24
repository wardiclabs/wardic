/**
 * A scene's colours (#883, PR 3; ADR-0069 decision 7, ADR-0073 *Amendment (#883)*): split at the call
 * into linear channels, sprung as positions are, written on the `Color` itself. Real three.js in Node.
 */
import * as ThreeColours from "@wardic/three/ThreeColours"
import * as WardicThree from "@wardic/three/WardicThree"
import { describe, expect, it } from "@effect/vitest"
import * as THREE from "three"

const FRAME = 1000 / 60
const LINEAR = { type: "tween", duration: 0.1, ease: "linear" } as const
const SPRING = { type: "spring", stiffness: 100, damping: 10 } as const

const tick = (): Promise<void> => Promise.resolve()

const pump = (wardic: WardicThree.WardicThree, n: number, clock = { time: 0 }): void => {
  for (let i = 0; i < n; i++) {
    clock.time += FRAME
    wardic.frame(clock.time)
  }
}

const box = (color = "#ff0000"): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color }))

/** A material's colour as drawn: sRGB hex. */
const hexOf = (colour: THREE.Color): string => `#${colour.getHexString()}`

/** Frames until `controls` lands, pumping one at a time: and the red channel the frame before it did. */
const landing = async (wardic: WardicThree.WardicThree, controls: PromiseLike<void>, colour: THREE.Color): Promise<{ readonly frames: number; readonly before: number }> => {
  let landed = false
  void Promise.resolve(controls).then(() => {
    landed = true
  })
  await tick()
  const clock = { time: 0 }
  let before = colour.r
  for (let frames = 1; frames < 1200; frames++) {
    const drawn = colour.r
    pump(wardic, 1, clock)
    await tick()
    await tick()
    if (landed) return { frames, before: drawn }
    before = drawn
  }
  throw new Error(`never landed (${before})`)
}

describe("ThreeColours: colours in linear light, as channel keys", () => {
  it("TC1: red to blue passes #bc00bc, three's linear midpoint, not Motion's #b400b4 or the DOM's #800080", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    wardic.animate(cube, { color: "#0000ff" }, { type: "tween", duration: 1, ease: "linear" })
    await tick()
    pump(wardic, 30)
    expect(hexOf(cube.material.color)).toBe("#bc00bc")
    wardic.dispose()
  })

  it("TC2: a target is a CSS colour, a hex number or a Color, copied, read in the app's colour management", async () => {
    const wardic = WardicThree.make()
    const [a, b, c, d] = [box(), box(), box(), box()]
    const given = new THREE.Color("#00ff00")
    await Promise.all([
      wardic.animate(a, { color: "rgb(0, 0, 255)" }, LINEAR),
      wardic.animate(b, { color: 0x00ffff }, LINEAR),
      wardic.animate(c, { color: given }, LINEAR),
      wardic.animate(d, { color: "white" }, LINEAR),
      tick().then(() => {
        given.set("#123456")
        pump(wardic, 9)
      }),
    ])
    expect([a, b, c, d].map((mesh) => hexOf(mesh.material.color))).toEqual(["#0000ff", "#00ffff", "#00ff00", "#ffffff"])
    wardic.dispose()
  })

  it("TC3: a spring keeps a colour's speed through a change of target, where a progress blend starts from rest", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    const clock = { time: 0 }
    wardic.animate(cube, { color: "#0000ff" }, SPRING)
    await tick()
    pump(wardic, 9, clock)
    const b8 = cube.material.color.b
    pump(wardic, 1, clock)
    const b9 = cube.material.color.b
    wardic.animate(cube, { color: "#00ff00" }, SPRING)
    await tick()
    pump(wardic, 1, clock)
    // Blue still rises the frame after it's turned toward green's 0: its speed carried over.
    expect(cube.material.color.b - b9).toBeGreaterThan(b9 - b8)
    wardic.dispose()
  })

  it("TC4: a channel rests by its share of the distance: black to a near black animates, and lands with black to white", async () => {
    const wardic = WardicThree.make()
    const dark = box("#000000")
    const light = box("#000000")
    const near = await landing(wardic, wardic.animate(dark, { color: "#080808" }, SPRING), dark.material.color)
    const far = await landing(wardic, wardic.animate(light, { color: "#ffffff" }, SPRING), light.material.color)
    expect(near.frames).toBeGreaterThan(30)
    expect(Math.abs(near.frames - far.frames)).toBeLessThanOrEqual(1)
    // The frame before landing, within an 8-bit step of the target: no visible snap.
    const goal = new THREE.Color("#080808").r
    expect(Math.abs(new THREE.Color().setRGB(near.before, 0, 0).getHex() - new THREE.Color().setRGB(goal, 0, 0).getHex())).toBeLessThanOrEqual(0x010000)
    wardic.dispose()
  })

  it("TC5: keyframes of colours, a null stop where it is", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    wardic.animate(cube, { color: [null, "#00ff00", "#0000ff"] }, { type: "tween", duration: 1, ease: "linear" })
    await tick()
    pump(wardic, 30)
    expect(hexOf(cube.material.color)).toBe("#00ff00")
    pump(wardic, 31)
    expect(hexOf(cube.material.color)).toBe("#0000ff")
    wardic.dispose()
  })

  it("TC6: a material's emissive, each of an array of materials, a ShaderMaterial's Color uniform, and a uniforms object's", async () => {
    const wardic = WardicThree.make()
    const glow = box()
    const faces = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()])
    const shader = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.ShaderMaterial({ uniforms: { uTint: { value: new THREE.Color() } } }))
    const uniforms = { uSky: { value: new THREE.Color("#000000") } }
    await Promise.all([
      wardic.animate(glow, { emissive: "#ff8800" }, LINEAR),
      wardic.animate(faces, { color: "#00ff00" }, LINEAR),
      wardic.animate(shader, { uTint: "#ff00ff" }, LINEAR),
      wardic.animate(uniforms, { uSky: "#0088ff" }, LINEAR),
      tick().then(() => pump(wardic, 9)),
    ])
    expect(hexOf(glow.material.emissive)).toBe("#ff8800")
    expect(faces.material.map((material) => hexOf(material.color))).toEqual(["#00ff00", "#00ff00"])
    expect(hexOf((shader.material as THREE.ShaderMaterial).uniforms.uTint!.value as THREE.Color)).toBe("#ff00ff")
    expect(hexOf(uniforms.uSky.value)).toBe("#0088ff")
    wardic.dispose()
  })

  it("TC7: a colour's own transition in the options goes to its channels", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    const slow = { type: "tween", duration: 1, ease: "linear" } as const
    wardic.animate(cube, { color: "#0000ff", opacity: 0 }, { ...slow, color: LINEAR })
    await tick()
    pump(wardic, 9)
    expect(hexOf(cube.material.color)).toBe("#0000ff")
    expect(cube.material.opacity).toBeGreaterThan(0.5)
    wardic.dispose()
  })

  it("TC8: a colour's channels by their own keys, in linear light", async () => {
    const wardic = WardicThree.make()
    const cube = box("#000000")
    await Promise.all([wardic.animate(cube, { colorG: 1, colorB: 0.5 }, LINEAR), tick().then(() => pump(wardic, 9))])
    expect([cube.material.color.r, cube.material.color.g, cube.material.color.b]).toEqual([0, 1, 0.5])
    wardic.dispose()
  })

  it("TC9: a sequence's Segment of a mesh, and a list of meshes, split their colours too", async () => {
    const wardic = WardicThree.make()
    const [a, b, c] = [box(), box(), box()]
    const controls = wardic.animate([
      [a, { color: "#00ff00" }, LINEAR],
      [[b, c], { color: "#0000ff", x: 1 }, LINEAR],
    ])
    await tick()
    pump(wardic, 20)
    await controls
    expect([a, b, c].map((mesh) => hexOf(mesh.material.color))).toEqual(["#00ff00", "#0000ff", "#0000ff"])
    expect(c.position.x).toBe(1)
    wardic.dispose()
  })

  it("TC10: reduced motion fades a colour: it isn't positional", async () => {
    const wardic = WardicThree.make({ reducedMotion: "always" })
    const cube = box()
    wardic.animate(cube, { color: "#0000ff" }, { type: "tween", duration: 1, ease: "linear" })
    await tick()
    pump(wardic, 1)
    expect(hexOf(cube.material.color)).not.toBe("#0000ff")
    wardic.dispose()
  })

  it("TC12: a Batch of meshes takes colours: one for all, two stops, a function of a member's index read once each, and in its keys", async () => {
    const wardic = WardicThree.make()
    const [a, b, c] = [box(), box(), box()]
    const swarm = wardic.batch([a, b, c], { keys: ["color", "x"] })
    let calls = 0
    const palette = ["#00ff00", "#0000ff"]
    await Promise.all([
      wardic.animate(
        swarm,
        {
          color: (i) => {
            calls++
            return palette[i % 2]!
          },
        },
        LINEAR,
      ),
      tick().then(() => pump(wardic, 9)),
    ])
    expect(calls).toBe(3)
    expect([a, b, c].map((mesh) => hexOf(mesh.material.color))).toEqual(["#00ff00", "#0000ff", "#00ff00"])
    await Promise.all([wardic.animate(swarm.at(2), { color: ["#000000", 0xff8800] }, LINEAR), tick().then(() => pump(wardic, 9))])
    expect(hexOf(c.material.color)).toBe("#ff8800")
    await Promise.all([wardic.animate([[swarm, { color: "#ffffff", x: 1 }, LINEAR]]), tick().then(() => pump(wardic, 9))])
    expect([a, b, c].map((mesh) => hexOf(mesh.material.color))).toEqual(["#ffffff", "#ffffff", "#ffffff"])
    wardic.dispose()
  })

  it("TC11: split gives a target with no colour back as it is, and a colour as its channels", () => {
    const cube = box()
    const plain = { x: 1, opacity: 0 }
    expect(ThreeColours.split(cube, plain)).toBe(plain)
    expect(ThreeColours.split(cube, { color: "#0000ff", x: 1 })).toEqual({ x: 1, colorR: 0, colorG: 0, colorB: 1 })
    // Its transitionEnd, and its own entry in the target's transition and the options, go to its channels.
    const entry = { duration: 0.2 }
    const [target, options] = ThreeColours.splitCall(cube, { color: "#00ff00", transitionEnd: { color: "#0000ff" }, transition: { duration: 1, color: entry } }, { color: entry })
    expect(target).toEqual({
      colorR: 0,
      colorG: 1,
      colorB: 0,
      transitionEnd: { colorR: 0, colorG: 0, colorB: 1 },
      transition: { duration: 1, colorR: entry, colorG: entry, colorB: entry },
    })
    expect(options).toEqual({ colorR: entry, colorG: entry, colorB: entry })
    expect(ThreeColours.isChannel("colorR")).toBe(true)
    expect(ThreeColours.isChannel("x")).toBe(false)
  })

  it("TC13: splitCall gives a colour's entry to its channels whenever the Subject has the colour, a channel's own entry winning (#952)", () => {
    const cube = box()
    const entry = { duration: 0.2 }
    const own = { duration: 0.5 }
    // A target written by channels: the colour's entry, in the options and in its own transition.
    expect(ThreeColours.splitCall(cube, { colorR: 0.5 }, { color: entry })).toEqual([{ colorR: 0.5 }, { colorR: entry, colorG: entry, colorB: entry }])
    expect(ThreeColours.splitCall(cube, { colorG: 1, transition: { duration: 1, emissive: entry } }, undefined)[0]).toEqual({
      colorG: 1,
      transition: { duration: 1, emissiveR: entry, emissiveG: entry, emissiveB: entry },
    })
    // A channel's own entry over its colour's.
    expect(ThreeColours.splitCall(cube, { color: "#0000ff" }, { color: entry, colorR: own })[1]).toEqual({ colorR: own, colorG: entry, colorB: entry })
    // A name the Subject has no colour under, or a field, stays as it is.
    const options = { duration: 1, x: entry }
    expect(ThreeColours.splitCall(cube, { x: 1 }, options)[1]).toBe(options)
  })

  it("TC14: a colour's entry runs a target written by its channels, a call's and a Segment's, and a channel's own entry runs it over its colour's (#952)", async () => {
    const wardic = WardicThree.make()
    const slow = { type: "tween", duration: 1, ease: "linear" } as const
    // By its channels, the colour on its 0.1 s entry: landed at 0.15 s, where the 1 s fields aren't.
    const byChannel = box("#000000")
    wardic.animate(byChannel, { colorG: 1, opacity: 0 }, { ...slow, color: LINEAR })
    const inSegment = box("#000000")
    void wardic.animate([[inSegment, { colorB: 1 }, { ...slow, color: LINEAR }]])
    // By its colour, the red channel on its own 1 s entry, green and blue on the colour's 0.1 s.
    const ownChannel = box("#000000")
    wardic.animate(ownChannel, { color: "#ffffff" }, { color: LINEAR, colorR: slow })
    await tick()
    pump(wardic, 9)
    expect(byChannel.material.color.g).toBe(1)
    expect(byChannel.material.opacity).toBeGreaterThan(0.5)
    expect(inSegment.material.color.b).toBe(1)
    expect([ownChannel.material.color.g, ownChannel.material.color.b]).toEqual([1, 1])
    expect(ownChannel.material.color.r).toBeGreaterThan(0.05)
    expect(ownChannel.material.color.r).toBeLessThan(0.3)
    wardic.dispose()
  })
})
