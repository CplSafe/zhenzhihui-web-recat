/**
 * 模板目录加载工具：全应用共享一次后端探测，并在接口不可用时回退内置模板。
 * 回退结果带明确提示，避免把演示数据误认为服务端真实模板。
 */
import { listBackendTemplates, type TemplateItem } from '@/api/templates'
import { DEMO_TEMPLATES } from '@/data/demoTemplates'

/** 模板列表的实际数据来源。 */
export type TemplateCatalogSource = 'backend' | 'builtin'

/** 页面消费的统一模板目录结果。 */
export interface TemplateCatalog {
  items: TemplateItem[]
  source: TemplateCatalogSource
  /** 只在使用内置降级数据时展示，避免把演示素材伪装成远程模板。 */
  notice: string
}

/** 全应用复用的模板目录请求，避免多个页面重复探测同一接口。 */
let catalogPromise: Promise<TemplateCatalog> | null = null

/**
 * 全应用共享一次模板接口探测。
 * 当 /api/v1/templates 尚未部署、返回非法数据或空列表时，稳定使用内置精选模板；
 * HomeView 和 TemplatesView 共用该 Promise，不会各自重复请求一个已知 404 的端点。
 */
export function loadTemplateCatalog(): Promise<TemplateCatalog> {
  if (catalogPromise) return catalogPromise
  catalogPromise = listBackendTemplates()
    .then((items) => {
      if (Array.isArray(items) && items.length > 0) {
        return { items, source: 'backend' as const, notice: '' }
      }
      return {
        items: DEMO_TEMPLATES,
        source: 'builtin' as const,
        notice: '模板服务暂未开放，当前展示内置精选模板',
      }
    })
    .catch(() => ({
      items: DEMO_TEMPLATES,
      source: 'builtin' as const,
      notice: '模板服务暂时不可用，当前展示内置精选模板',
    }))
  return catalogPromise
}

/** 仅供测试和显式的运维恢复流程重置；普通页面重挂载不应调用。 */
export function clearTemplateCatalogCache(): void {
  catalogPromise = null
}
