export type CanvasModelParamOption = string | number

/**
 * 「跟随输入素材」的比例取值。
 *
 * 这类档位要求请求里带素材，模型据此推断画幅；纯文生视频没有素材可推断，
 * 官方 API 直接返回 400（例如 MiniMax 的 adaptive）。
 */
const INPUT_DERIVED_RATIO_VALUES = new Set(['adaptive', 'auto', '自适应'])

/** 判断某个比例取值是否依赖输入素材。 */
export function isInputDerivedRatioValue(value: unknown): boolean {
  return INPUT_DERIVED_RATIO_VALUES.has(
    String(value ?? '')
      .trim()
      .toLocaleLowerCase(),
  )
}

/**
 * 没有输入素材时去掉依赖素材的比例档位。
 *
 * 全部档位都属于这一类时保持原样：宁可让后端按自己的规则报错，
 * 也不要把模型唯一支持的画幅删成空下拉，让用户根本没得选。
 */
export function filterInputDerivedRatioOptions<T extends CanvasModelParamOption>(
  options: T[] | undefined,
  hasMediaInput: boolean,
): T[] | undefined {
  if (hasMediaInput || !options?.length) return options
  const usable = options.filter((option) => !isInputDerivedRatioValue(option))
  return usable.length ? usable : options
}

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
