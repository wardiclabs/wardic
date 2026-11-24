// `@wardic/three/solid` as an app has it from npm (1.3, #564): a Stage on a stand-in renderer (what a
// Stage drives, `RendererLike`, so the check needs no WebGL), a ward fading a mesh's material in, and a
// Frame effect drawing its opacity onto `#enter` in the Host loop, after Wardic's writes. The ward and
// the Stage meet through `@wardic/solid`'s context, so two copies of it would fail here.
import { render } from "@solidjs/web"
import { createFrameEffect, createStage, type RendererLike, ward, WardicStage } from "@wardic/three/solid"
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from "three"

const enter = document.getElementById("enter")!
const scene = new Scene()
const camera = new PerspectiveCamera(50, 4 / 3, 0.1, 100)
camera.position.z = 5
const cube = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ opacity: 0 }))
scene.add(cube)

let frame = 0
const renderer: RendererLike = {
  domElement: document.createElement("canvas"),
  setSize: () => {},
  setAnimationLoop: (loop) => {
    cancelAnimationFrame(frame)
    if (loop === null) return
    const tick = (time: number): void => {
      loop(time)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  },
  render: () => {},
}

function Cube() {
  const box = ward(cube, { initial: { opacity: 0 }, animate: { opacity: 1, rotateY: 90 }, transition: { duration: 0.3 } })
  createFrameEffect(() => box.read("opacity")(), (opacity) => {
    enter.style.opacity = String(opacity)
  })
  return box.held
}

function App() {
  const stage = createStage({ renderer, scene, camera })
  return (
    <WardicStage value={stage}>
      <div ref={stage} style={{ width: "160px", height: "120px" }} />
      <Cube />
    </WardicStage>
  )
}

render(() => <App />, document.getElementById("app")!)
