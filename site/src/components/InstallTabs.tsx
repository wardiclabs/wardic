/**
 * An install command in tabs, one per package manager (npm, pnpm, Yarn, Bun), each with a button that
 * copies it. The manager picked is kept in this browser, so the next install block opens on it.
 * Kobalte's tabs give the keyboard and the roles, as `CodeTabs`'s do. Every manager gets the same
 * packages, peers included: Yarn doesn't install a missing peer, as npm, pnpm and Bun do.
 */
import { Tabs } from "@kobalte/core/tabs"
import { w } from "~/lib/wardic.ts"
import { createSignal, For, onCleanup, onSettled } from "solid-js"

/** The package managers, in the tabs' order, and the command each adds packages with. */
const MANAGERS = [
  { name: "npm", add: "npm install" },
  { name: "pnpm", add: "pnpm add" },
  { name: "Yarn", add: "yarn add" },
  { name: "Bun", add: "bun add" },
] as const

/** Where the manager picked is kept. */
const KEY = "wardic-docs-package-manager"

/** The manager kept in this browser, if it's one of the tabs'. Storage can be off, or throw. */
const kept = (): string | undefined => {
  try {
    const name = localStorage.getItem(KEY)
    if (MANAGERS.some((manager) => manager.name === name)) return name ?? undefined
  } catch {
    // No storage: every block opens on npm.
  }
  return undefined
}

/** The button's label, and what the live region says, by whether the command was just copied. */
const LABEL: Record<"true" | "false", string> = { true: "Copied", false: "Copy" }
const SAID: Record<"true" | "false", string> = { true: "Copied to the clipboard", false: "" }

/** Copies `text`, and says so for a moment. */
function CopyButton(props: { readonly text: string; readonly manager: string }) {
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const copy = () => {
    navigator.clipboard.writeText(props.text).then(
      () => {
        setCopied(true)
        clearTimeout(timer)
        timer = setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }
  return (
    <>
      <w.button type="button" class="copy-button" aria-label={`Copy the ${props.manager} command`} whileTap={{ scale: 0.92 }} onClick={copy}>
        {LABEL[String(copied()) as "true" | "false"]}
      </w.button>
      <span class="visually-hidden" aria-live="polite">
        {SAID[String(copied()) as "true" | "false"]}
      </span>
    </>
  )
}

/** `packages`, space-separated, as each package manager installs them. */
export function InstallTabs(props: { readonly packages: string }) {
  const [manager, setManager] = createSignal<string>("npm")
  // In the browser only, once it has mounted: the server renders npm's, and hydration matches it.
  onSettled(() => {
    const name = kept()
    if (name !== undefined) setManager(name)
  })
  const choose = (name: string) => {
    setManager(name)
    try {
      localStorage.setItem(KEY, name)
    } catch {
      // No storage: the choice holds for this block.
    }
  }
  return (
    <Tabs class="code-tabs install-tabs" value={manager()} onChange={choose}>
      <Tabs.List class="code-tab-list" aria-label="Install with">
        <For each={MANAGERS}>
          {(entry) => (
            <Tabs.Trigger class="code-tab" value={entry.name}>
              {entry.name}
            </Tabs.Trigger>
          )}
        </For>
      </Tabs.List>
      <For each={MANAGERS}>
        {(entry) => (
          // Every panel stays mounted, the unselected ones hidden by the stylesheet, as CodeTabs' are.
          <Tabs.Content class="code-tab-panel" value={entry.name} forceMount>
            <div class="install-command">
              <pre>
                <code>{`${entry.add} ${props.packages}`}</code>
              </pre>
              <CopyButton text={`${entry.add} ${props.packages}`} manager={entry.name} />
            </div>
          </Tabs.Content>
        )}
      </For>
    </Tabs>
  )
}
