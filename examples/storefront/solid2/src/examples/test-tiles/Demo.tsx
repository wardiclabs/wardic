import { colourOf } from "@wardic/example-storefront-shared/glazes"
import { w } from "~/lib/wardic.ts"
import { createEffect, createSignal, For } from "solid-js"
import { type TestTile, TILES } from "./tiles.ts"

/** How far the eye is from what turns, in px: each tile's own depth, or the wall's. */
const DEPTH = 800

/** Whose depth a tile turns in: its own, or the wall's, seen from the wall's middle. */
type Depth = "tile" | "wall"

const DEPTHS: ReadonlyArray<{ readonly id: Depth; readonly label: string }> = [
  { id: "tile", label: "Each tile's own" },
  { id: "wall", label: "One depth for the wall" },
]

/** A tile's turn over: a spring that lands with a little give, as a slab set down does. */
const TURN = { type: "spring", visualDuration: 0.6, bounce: 0.25 } as const

/** A wall of glaze test tiles: a tap turns one over to its recipe, in a depth of its own or the wall's. */
export default function TestTiles() {
  const [depth, setDepth] = createSignal<Depth>("tile")
  return (
    <div class="test-tiles">
      <div class="segmented depth-switch" role="group" aria-label="Depth">
        <For each={DEPTHS}>
          {(one) => (
            <button aria-pressed={depth() === one.id ? "true" : "false"} onClick={() => setDepth(one.id)}>
              {one.label}
            </button>
          )}
        </For>
      </div>
      {/* The wall's depth, `perspective`, is its children's: every tile seen from the wall's middle. A bare
          number is px, as on any length. */}
      <w.ul class="test-tile-wall" style={{ perspective: depth() === "wall" ? DEPTH : "none" }}>
        <For each={TILES}>{(tile) => <Tile tile={tile} ownDepth={depth() === "tile" ? DEPTH : 0} />}</For>
      </w.ul>
    </div>
  )
}

/** A tile, `ownDepth` its own depth in px, or 0 for none: then the wall's is the one it turns in. */
function Tile(props: { readonly tile: TestTile; readonly ownDepth: number }) {
  const [turned, setTurned] = createSignal(false)
  // The tile's ward, given to its button: a tap, Enter or Space turns it over (#355). It only listens; the
  // button's own props turn it.
  const tile = w.ward()
  createEffect(tile.when("tap"), () => {
    setTurned((was) => !was)
  })
  const recipeId = `recipe-${props.tile.glaze.id}`
  return (
    <li>
      <w.button
        class="test-tile"
        wardRef={tile}
        // Its name stays the glaze's as it turns, as a toggle's should; turned, its recipe describes it.
        aria-label={`${props.tile.glaze.name}, ${props.tile.glaze.finish}`}
        aria-describedby={turned() ? recipeId : undefined}
        aria-pressed={turned() ? "true" : "false"}
        animate={{ rotateY: turned() ? 180 : 0 }}
        transition={{ rotateY: TURN }}
        whileTap={{ scale: 0.96 }}
        // Its own depth, `transformPerspective`: a perspective() at the head of its transform, so it turns
        // as if held in front of you wherever it sits. 0 is none, and the wall's is the depth then.
        style={{ transformPerspective: props.ownDepth, "--glaze": colourOf(props.tile.glaze) }}
      >
        {/* The face turned away is inert: nothing on it is reached. */}
        <span class="test-tile-face front" inert={turned()}>
          <span class="glaze-coat" />
          <span class="label">
            {props.tile.glaze.name} <span class="muted">· {props.tile.glaze.finish}</span>
          </span>
        </span>
        <span class="test-tile-face back" id={recipeId} inert={!turned()}>
          <span class="name">{props.tile.glaze.name}</span>
          <span>{props.tile.recipe.firing}</span>
          <span>
            <span class="muted">Base</span> {props.tile.recipe.base}
          </span>
          <span>
            <span class="muted">Colour</span> {props.tile.recipe.colourant}
          </span>
        </span>
      </w.button>
    </li>
  )
}
