export type CanvasModelParamOption = string | number

/** Return the exact option exposed by the current model schema. */
export function resolveCanvasModelParamOption(
  options: readonly CanvasModelParamOption[] | undefined,
  value: unknown,
  fallback: unknown,
): unknown {
  if (!options?.length) return value

  const findOption = (candidate: unknown): CanvasModelParamOption | undefined => {
    const exact = options.find((option) => Object.is(option, candidate) || String(option) === String(candidate))
    if (exact !== undefined) return exact
    if (typeof candidate !== 'string') return undefined

    const normalized = candidate.trim().toLocaleLowerCase()
    return options.find((option) => typeof option === 'string' && option.trim().toLocaleLowerCase() === normalized)
  }

  return findOption(value) ?? findOption(fallback) ?? options[0]
}
