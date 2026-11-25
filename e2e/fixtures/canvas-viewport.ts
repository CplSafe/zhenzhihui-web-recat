import { expect, type Locator } from '@playwright/test'

export async function waitForCanvasViewportToSettle(viewport: Locator) {
  await expect
    .poll(() =>
      viewport.evaluate(async (element) => {
        const transform = getComputedStyle(element).transform
        for (let frame = 0; frame < 4; frame += 1) {
          await new Promise<number>((resolve) => requestAnimationFrame(resolve))
          if (getComputedStyle(element).transform !== transform) return false
        }
        return true
      }),
    )
    .toBe(true)
}
