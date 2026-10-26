/**
 * The shop's frame (#296), as in the Solid apps: its header, with the visitor's switches and the
 * store's, and its footer. A server component: the cart's count is a read it starts and hands to
 * the header, which shows it when it arrives, so the page doesn't wait for it.
 */
import Link from "next/link"
import type { ReactNode } from "react"
import { PageScope } from "~/lib/preferences.tsx"
import { getCart } from "~/lib/store.ts"
import { HeaderTools } from "./HeaderTools.tsx"

export function Shell({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="page">
          <Link className="brand" href="/">
            Wardic Northlight
            <span className="badges">
              <span className="badge badge-motion">Motion · Next.js</span>
            </span>
          </Link>
          <nav className="site-nav" aria-label="Main">
            <Link href="/">Examples</Link>
          </nav>
          <HeaderTools cart={getCart()} />
        </div>
      </header>
      <PageScope>{children}</PageScope>
      <footer className="site-footer">
        <div className="page">
          <span>Wardic Northlight is a made-up shop: here, each example in Motion on Next.js, to set beside Wardic&apos;s.</span>
          <span>Photos: CC0, from museums&apos; open-access collections.</span>
        </div>
      </footer>
    </>
  )
}
