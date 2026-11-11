---
"@wardic/solid": patch
---

The `solid` export condition points at JSX entries, `dist/solid/index.jsx` and `dist/solid/unstable/v2/index.jsx`, as other Solid libraries' do: every module that imports or re-exports a component is a `.tsx` module, so it ships as `.jsx` for the app's Solid compiler. The `browser`, `server` and `types` entries are unchanged.
