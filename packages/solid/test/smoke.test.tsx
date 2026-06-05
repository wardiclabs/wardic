import { render } from "@solidjs/testing-library"
import { expect, it } from "@effect/vitest"
import { VERSION, WardicProvider } from "@wardic/solid"

it("@wardic/solid resolves and exposes a version", () => {
  expect(VERSION).toBe("0.1.0-alpha.0")
})

it("@wardic/solid exposes a WardicProvider", () => {
  expect(typeof WardicProvider).toBe("function")
})

it("renders a trivial Solid component via JSX", () => {
  const { getByText } = render(() => <div>hi</div>)
  expect(getByText("hi")).toBeTruthy()
})
