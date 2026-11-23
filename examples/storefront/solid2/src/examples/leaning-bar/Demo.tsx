import { createAnimationFrame, createReducedMotionConfig, createScroll, createSpring, createTransform, createVelocity } from "@wardic/solid"
import { createSignal, For, onSettled } from "solid-js"
import { w } from "~/lib/wardic.ts"

const NEWS = ["Free delivery on orders over $60", "The Lagoon glaze is back, in small batches", "Every piece wrapped by hand", "The studio is open on Saturdays", "Free returns within 30 days"]

/** Its own pace, in pixels a second. */
const PACE = 50

/** The studio's news running across the page: scroll, and it leans with you and runs faster, backwards as you scroll up. */
export default function LeaningBar() {
  let copy!: HTMLDivElement
  const { scrollY } = createScroll()
  // How fast the page scrolls, through a spring: a flick eases off rather than stopping dead.
  const velocity = createSpring(createVelocity(scrollY), { stiffness: 400, damping: 50 })
  // The bar leans into the scroll, and runs up to five times its pace.
  const skewX = createTransform(velocity, [-2000, 0, 2000], [12, 0, -12])
  const boost = createTransform(velocity, [-2000, 0, 2000], [-4, 0, 4])
  const reduced = createReducedMotionConfig()

  // The track holds the news twice, so it runs on without a seam: its x wraps at one copy's width.
  const [x, setX] = createSignal(0)
  let width = 1
  onSettled(() => {
    const observer = new ResizeObserver(() => (width = Math.max(1, copy.offsetWidth)))
    observer.observe(copy)
    return () => observer.disconnect()
  })
  let direction = -1
  createAnimationFrame((_, delta) => {
    if (reduced()) return
    const factor = boost()
    // Scrolling down runs it on, scrolling up turns it round, and it keeps the way it last went.
    if (factor > 0) direction = -1
    if (factor < 0) direction = 1
    const next = x() + direction * PACE * (delta / 1000) * (1 + Math.abs(factor))
    setX(((next % width) - width) % width)
  })

  return (
    <div class="leaning">
      <w.div class="leaning-bar" style={{ skewX: reduced() ? 0 : skewX }}>
        <w.div class="leaning-track" style={{ x }}>
          <For each={[0, 1]}>
            {(n) => (
              <div
                class="leaning-copy"
                ref={(el: HTMLDivElement) => {
                  if (n === 0) copy = el
                }}
                aria-hidden={n === 1 ? "true" : undefined}
              >
                <For each={NEWS}>{(item) => <span class="leaning-item">{item}</span>}</For>
              </div>
            )}
          </For>
        </w.div>
      </w.div>
      <p class="muted leaning-hint">Scroll the page, slowly or in a flick, either way.</p>
    </div>
  )
}
