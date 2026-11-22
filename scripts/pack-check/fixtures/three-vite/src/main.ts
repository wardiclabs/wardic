// `@wardic/three` as an app has it from npm (#883): a mesh's material faded on frames the page pumps,
// drawn onto `#enter` after Wardic's writes each frame. Its material is shared, so a dev build warns;
// this production build carries no warning (the `development` condition's other half).
import * as WardicThree from "@wardic/three/WardicThree"
import { BoxGeometry, Mesh, MeshBasicMaterial, Scene } from "three"

const enter = document.getElementById("enter")!
const material = new MeshBasicMaterial({ opacity: 0 })
const scene = new Scene()
const cube = new Mesh(new BoxGeometry(), material)
scene.add(cube, new Mesh(new BoxGeometry(), material))
const wardic = WardicThree.make()
wardic.afterWrites(() => {
  enter.style.opacity = String(material.opacity)
})
const loop = (time: number): void => {
  wardic.frame(time)
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
wardic.animate(cube, { opacity: 1, rotateY: 90 }, { duration: 0.3 })
