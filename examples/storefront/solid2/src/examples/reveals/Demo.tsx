import { photoOf } from "@wardic/example-storefront-shared/images"
import { STUDIO_CHAPTERS } from "@wardic/example-storefront-shared/stories"
import { w } from "@wardic/solid/unstable/v2"
import { For } from "solid-js"

// Each chapter names a variant as it comes into view; its photo and words follow, one after another.
const chapter = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.1 } },
}

const part = {
  hidden: { opacity: 0, y: 28 },
  shown: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 160, damping: 22 } },
} as const

export default function Reveals() {
  let panel!: HTMLDivElement
  return (
    <div class="story" ref={panel} tabindex="0" aria-label="The studio's story">
      <For each={STUDIO_CHAPTERS}>
        {(story) => {
          const photo = photoOf(story.photo)
          return (
            // In view once a third of it shows in the panel; once, so scrolling back up doesn't hide it.
            <w.section class="chapter" variants={chapter} initial="hidden" whileInView="shown" viewport={{ root: () => panel, once: true, amount: 0.35 }}>
              <w.img variants={part} src={photo.small} width={photo.width} height={photo.height} alt="" />
              <div>
                <w.h3 variants={part}>{story.title}</w.h3>
                <w.p variants={part}>{story.text}</w.p>
              </div>
            </w.section>
          )
        }}
      </For>
    </div>
  )
}
