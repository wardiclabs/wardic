// Server markup read back, for both bindings' server tests (#209): Solid-free.

/** One opening tag in server markup: its name, attributes and parsed inline style. */
export interface Tag {
  readonly name: string
  readonly attrs: Readonly<Record<string, string>>
  readonly style: Readonly<Record<string, string>>
}

/** Every opening tag in `html`, in document order, with its attributes and its parsed inline style. */
export const tagsOf = (html: string): ReadonlyArray<Tag> =>
  [...html.matchAll(/<([a-z][a-z0-9]*)((?:\s+[^\s=>]+(?:=(?:"[^"]*"|[^\s">]+))?)*)\s*\/?>/g)].map(([, name, rest]) => {
    // A value is quoted, or (Solid 2's hydration key, `_hk=0040`) bare.
    const attrs = Object.fromEntries([...rest!.matchAll(/([^\s=>]+)(?:=(?:"([^"]*)"|([^\s">]+)))?/g)].map(([, k, quoted, bare]) => [k!, quoted ?? bare ?? ""]))
    const style = Object.fromEntries(
      (attrs.style ?? "")
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d !== "")
        .map((d) => {
          const i = d.indexOf(":")
          return [d.slice(0, i).trim(), d.slice(i + 1).trim()]
        }),
    )
    return { name: name!, attrs, style }
  })
