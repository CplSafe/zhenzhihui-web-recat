import type { LibraryCategory } from '@/api/templateLibrary'

// 后端尚未返回对应行业时的本地展示分类；负数 ID 不会发往服务端。
export const FALLBACK_INDUSTRIES: LibraryCategory[] = [
  ['E01', '食品酒水'],
  ['E02', '百货'],
  ['E03', '服饰'],
  ['E04', '美妆'],
  ['E05', '3C'],
  ['E06', '游戏'],
  ['E07', 'App'],
  ['E08', '工具'],
  ['E09', '医疗健康'],
  ['E10', '教育'],
].map(([code, name], index) => ({ id: -101 - index, code, name, position: index }))

// 根据内置视频内容归类；电动车及难以判断的内容归入百货。
const BUILTIN_INDUSTRIES: Record<number, string> = {
  90000: 'E02',
  90001: 'E01',
  90002: 'E01',
  90003: 'E03',
  90004: 'E02',
  90005: 'E06',
  90006: 'E09',
  90007: 'E02',
  90008: 'E09',
  90009: 'E04',
  90010: 'E02',
  90011: 'E07',
  90012: 'E04',
  90013: 'E01',
  90014: 'E01',
  90015: 'E09',
  90016: 'E03',
  90017: 'E02',
  90018: 'E01',
  90019: 'E01',
  90020: 'E01',
  90021: 'E01',
  90022: 'E01',
  90023: 'E01',
  90024: 'E01',
}

export function builtinIndustryCode(id: number): string {
  return BUILTIN_INDUSTRIES[id] || 'E02'
}

export function mergeIndustryCategories(categories: LibraryCategory[]): LibraryCategory[] {
  const result = [...categories]
  for (const fallback of FALLBACK_INDUSTRIES) {
    if (!result.some((category) => category.code === fallback.code || category.name === fallback.name))
      result.push(fallback)
  }
  return result
}
