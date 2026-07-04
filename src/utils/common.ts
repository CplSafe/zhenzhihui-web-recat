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

/**
 * Safely coerce a value to a positive integer (>= 1) or 0.
 * Returns 0 for NaN, Infinity, zero, and negative values.
 * @param {*} value
 * @returns {number}
 */
export function toPositiveInt(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
