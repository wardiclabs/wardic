// PROTOTYPE: empty DOM classes so Motion's `animate` runs outside a browser (it tests `instanceof NodeList` etc.).
const g = globalThis as Record<string, unknown>
for (const name of ["NodeList", "Element", "HTMLElement", "SVGElement", "Node"]) {
  if (g[name] === undefined) g[name] = class {}
}
export {}
