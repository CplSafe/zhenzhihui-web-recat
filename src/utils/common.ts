/**
 * Shared utility functions used across composables and views.
 */

/**
 * Promise-based sleep/delay.
 * @param {number} ms - milliseconds to wait (clamped to >= 0)
 */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms))
  })
}
