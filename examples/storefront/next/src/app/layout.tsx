/**
 * The storefront's Motion side (#366): every page inside the shop's frame, under the visitor's
 * preferences, whose "Reduce motion" sets `MotionConfig`.
 */
import "@wardic/example-storefront-shared/styles.css"
import type { Metadata } from "next"
import { cookies, headers } from "next/headers"
import Script from "next/script"
import type { ReactNode } from "react"
import { Shell } from "~/components/Shell.tsx"
import { HYDRATE_HEADER, holdOf } from "~/lib/hydration.ts"
import { Preferences } from "~/lib/preferences.tsx"
import { REDUCE_MOTION_COOKIE } from "~/lib/reduce-motion.ts"

export const metadata: Metadata = {
  title: "Wardic Northlight · Motion",
  icons: { icon: "data:," },
}

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  // A page that asks to hydrate late, or never (the before-hydration example's links).
  const hold = holdOf((await headers()).get(HYDRATE_HEADER))
  // The header's "Reduce motion", read here so the page renders, and so mounts, with it.
  const reduceMotion = (await cookies()).get(REDUCE_MOTION_COOKIE)?.value === "true"
  return (
    <html lang="en">
      <body>
        {hold !== undefined && <Script strategy="beforeInteractive" src={hold} />}
        <Preferences reduceMotion={reduceMotion}>
          <Shell>{children}</Shell>
        </Preferences>
      </body>
    </html>
  )
}
