// The site's own virtual modules (plugins/).

declare module "virtual:page-titles" {
  /** Each page's front matter title, by its path under `src/content/` without `.mdx`: `index`, `guides/layout`. */
  const titles: Readonly<Record<string, string>>
  export default titles
}
