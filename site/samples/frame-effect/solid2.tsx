import { createFrameEffect, createWardic, domAnimation, drag } from "@wardic/solid"

// This page drags: its own Wardic instance brings `drag`, so pages that don't never load it.
const { w } = createWardic([domAnimation, drag])

/** Two balls to drag, joined by a line a canvas draws in Wardic's frame, from where each ball is drawn. */
export default function FrameEffect() {
  let arena!: HTMLDivElement
  let canvas!: HTMLCanvasElement
  let left!: HTMLDivElement
  let right!: HTMLDivElement
  const a = w.ward({ drag: true, dragConstraints: () => arena, dragElastic: 0.2 })
  const b = w.ward({ drag: true, dragConstraints: () => arena, dragElastic: 0.2 })
  const [ax, ay, bx, by] = [a.read("x"), a.read("y"), b.read("x"), b.read("y")]
  // After Wardic has moved the balls for the frame, before it's painted: the line is never a frame behind.
  createFrameEffect(
    () => [ax(), ay(), bx(), by()],
    ([x1, y1, x2, y2]) => {
      canvas.width = arena.clientWidth
      canvas.height = arena.clientHeight
      const context = canvas.getContext("2d")!
      context.strokeStyle = getComputedStyle(canvas).color
      context.lineWidth = 3
      context.setLineDash([8, 6])
      context.beginPath()
      context.moveTo(left.offsetLeft + left.offsetWidth / 2 + x1!, left.offsetTop + left.offsetHeight / 2 + y1!)
      context.lineTo(right.offsetLeft + right.offsetWidth / 2 + x2!, right.offsetTop + right.offsetHeight / 2 + y2!)
      context.stroke()
    },
  )
  return (
    <div class="sample-arena" ref={arena}>
      <canvas class="sample-canvas" ref={canvas} />
      <w.div class="sample-ball" wardRef={a} ref={left} whileDrag={{ scale: 1.15 }} />
      <w.div class="sample-ball sample-ball-alt" wardRef={b} ref={right} whileDrag={{ scale: 1.15 }} />
    </div>
  )
}
