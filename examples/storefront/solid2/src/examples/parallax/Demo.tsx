import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { type Collection, LOOKBOOK } from "@wardic/example-storefront-shared/stories"
import { createScroll, createTransform, w } from "@wardic/solid/unstable/v2"
import { For } from "solid-js"
import { useReducedMotion } from "~/lib/preferences.tsx"

export default function Parallax() {
  let panel!: HTMLDivElement
  return (
    <div class="lookbook" ref={panel} tabindex="0" aria-label="The lookbook">
      <For each={LOOKBOOK}>{(collection) => <Banner collection={collection} panel={() => panel} />}</For>
    </div>
  )
}

function Banner(props: { readonly collection: Collection; readonly panel: () => HTMLElement | undefined }) {
  let banner!: HTMLElement
  const reduced = useReducedMotion()
  // How far the banner has come through the panel: 0 as its top comes in at the bottom, 1 as its
  // bottom leaves at the top.
  const { scrollYProgress } = createScroll({ container: props.panel, target: () => banner, offset: ["start end", "end start"] })
  // The photo moves less than the banner, the words more: depth. Under reduced motion, neither.
  const depth = (travel: number) => (progress: number) => {
    if (reduced()) return 0
    return (progress - 0.5) * travel
  }
  const photoY = createTransform(scrollYProgress, depth(90))
  const wordsY = createTransform(scrollYProgress, depth(-70))
  const photo = photoOf(props.collection.photo)
  return (
    <section class="lookbook-banner" ref={banner}>
      <w.img class="lookbook-photo" style={{ y: photoY }} src={photo.large} srcset={srcsetOf(photo)} sizes="(max-width: 640px) 100vw, 720px" alt="" />
      <w.div class="lookbook-words" style={{ y: wordsY }}>
        <h3>{props.collection.title}</h3>
        <p>{props.collection.blurb}</p>
      </w.div>
    </section>
  )
}
