// `@wardic/object` as an app has it from npm (#882): a plain object animated on frames the page pumps,
// drawn onto `#enter` after Wardic's writes each frame, as a canvas app draws its scene.
import * as WardicObject from "@wardic/object/WardicObject"

const enter = document.getElementById("enter")!
const fade = { opacity: 0 }
const wardic = WardicObject.make()
wardic.afterWrites(() => {
  enter.style.opacity = String(fade.opacity)
})
const loop = (time: number): void => {
  wardic.frame(time)
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
wardic.animate(fade, { opacity: 1 }, { duration: 0.3 })
