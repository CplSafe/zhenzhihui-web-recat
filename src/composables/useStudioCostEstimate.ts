/**
 * 创作台提交前的积分预估。
 *
 * 参数或模型变化后防抖调用 `/ai/tasks/estimate-cost`（经 smartVideo / smartShotImage 的
 * 估价封装，保证与真正提交时的参数同口径，完成后按模型计费规则结算），把单条价格 × 生成数量
 * 作为本次提交的总价展示在生成按钮上。
 *
 * 未登录、未选模型或工作空间缺失时不发请求；请求失败只静默降级为不展示价格，
 * 不阻塞用户提交——真正的余额校验仍由后端在创建任务时执行。
 */
import { useEffect, useRef, useState } from 'react'
import { estimateShotImageCost } from '@/api/smartShotImage'
import { estimateFullVideoCost } from '@/api/smartVideo'
import type { StudioMode } from '@/utils/studioParams'
import { multiplyCredits, toMilli } from '@/utils/creditsFormat'

/** 一次预估的结果。 */
export interface StudioCostEstimate {
  /** 单条产物消耗的积分。 */
  perItem: number
  reservation: boolean
  note?: string
  /** 本次提交合计消耗的积分（perItem × count）。 */
  total: number
  /** 当前工作空间余额；后端未返回时为 null。 */
  balance: number | null
  /** 余额是否够本次提交。 */
  canAfford: boolean
}

/** 预估请求的入参。 */
export interface StudioCostEstimateInput {
  workspaceId: number
  mode: StudioMode
  modelVersionId: number
  modelVersion?: any
  ratio: string
  resolution: string
  count: number
  /** 视频：参与计价的分镜（智能分镜开启时为整份分镜，否则单镜）。 */
  shots?: { desc: string; duration: string }[]
  prompt: string
  resolveReferenceAssets: () => Promise<{ imageAssetIds: number[]; sourceVideoAssetIds: number[] }>
  /** 视频：音频开关；必须与提交一致，否则「预估 ≠ 实扣」。 */
  generateAudio?: boolean
  /** 视频：参考模式；必须与提交一致，否则「预估 ≠ 实扣」。 */
  referenceMode?: boolean
  /** 是否具备提交条件；为 false 时不发预估请求。 */
  enabled: boolean
}

/** 预估状态。 */
export interface StudioCostEstimateState {
  estimate: StudioCostEstimate | null
  loading: boolean
}

/** 预估防抖窗口：避免调参数时每一次点击都打一次估价接口。 */
const ESTIMATE_DEBOUNCE_MS = 400

/** 依据当前参数预估本次生成消耗的积分。 */
export function useStudioCostEstimate(input: StudioCostEstimateInput): StudioCostEstimateState {
  const [estimate, setEstimate] = useState<StudioCostEstimate | null>(null)
  const [loading, setLoading] = useState(false)

  const {
    workspaceId,
    mode,
    modelVersionId,
    modelVersion,
    ratio,
    resolution,
    count,
    prompt,
    resolveReferenceAssets,
    generateAudio,
    referenceMode,
    enabled,
  } = input
  // 分镜数组每次渲染都是新引用，用序列化值做依赖，避免无谓的重复估价；
  // 真正发请求时读 ref 里的最新值，不必把这串 key 再解析回数组。
  const shotsKey = JSON.stringify(input.shots || [])
  const shotsRef = useRef(input.shots)
  shotsRef.current = input.shots

  useEffect(() => {
    if (!enabled || !workspaceId || !modelVersionId) {
      setEstimate(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setEstimate(null)
    setLoading(true)

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const refs = await resolveReferenceAssets()
          if (cancelled) return
          const shots = shotsRef.current || []
          const response: any =
            mode === 'video'
              ? await estimateFullVideoCost({
                  workspaceId,
                  shots,
                  ...refs,
                  ratio,
                  resolution,
                  modelVersionId,
                  modelVersion,
                  generateAudio,
                  referenceMode,
                })
              : await estimateShotImageCost({
                  workspaceId,
                  refAssetIds: refs.imageAssetIds,
                  resolution,
                  prompt,
                  ratio,
                  modelVersionId,
                  modelVersion,
                })

          if (cancelled) return

          const perItem = response?.estimated_cost
          if (!Number.isFinite(perItem) || perItem < 0) {
            setEstimate(null)
            return
          }
          const rawBalance = response?.balance
          const balance = Number.isFinite(rawBalance) ? rawBalance : null
          const total = multiplyCredits(perItem, Math.max(1, count))
          setEstimate({
            perItem,
            reservation: response.estimate_kind === 'reservation',
            note: response.estimate_note,
            total,
            balance,
            canAfford: balance === null ? response?.can_afford !== false : toMilli(total) <= toMilli(balance),
          })
        } catch {
          // 估价失败不打断创作：按钮回退为不显示价格，余额校验交给提交时的后端。
          if (!cancelled) setEstimate(null)
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }, ESTIMATE_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    enabled,
    workspaceId,
    mode,
    modelVersionId,
    modelVersion,
    ratio,
    resolution,
    count,
    prompt,
    resolveReferenceAssets,
    generateAudio,
    referenceMode,
    shotsKey,
  ])

  return { estimate, loading }
}
