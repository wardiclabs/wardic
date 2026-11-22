/**
 * The lab's entry point.
 *
 * @module
 */
import { render } from "@solidjs/web"
import "./styles.css"
import { App } from "./App.tsx"

const root = document.getElementById("root")
if (root === null) throw new Error("scene-lab: #root is missing from index.html")
render(() => <App />, root)
