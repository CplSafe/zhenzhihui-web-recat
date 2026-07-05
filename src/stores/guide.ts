/**
 * Zustand Store: 新手引导(聚光挖洞式蒙层)。
 * 两种引导形态:
 *  - 扁平(首页 home):固定 steps,靠「下一步」推进。
 *  - 分阶段(智能成片 smart):stages 跟随创作流程——支付成功后触发,用户【自己操作】进到下一阶段时,
 *    自动展示该阶段的引导(入口 → 营销拆解 …);每阶段内若有多步用「下一步」推进,阶段末隐藏等待下一阶段。
 * 覆盖层渲染见 components/guide/GuideOverlay.tsx。
 */
import { create } from 'zustand'
import iconSmart from '@/assets/yindao/ef6233397eeec03acceee6cea6212dec.png' // 视频机 → 智能成片
import iconSpark from '@/assets/yindao/02b04334d1db2f3ed739bb11b52bc84d.png' // 闪光 → 案例库
import iconFolder from '@/assets/yindao/8edabba3e1b101ba5853a3fd7df6a28f.png' // 文件夹 → 项目管理
import iconRocket from '@/assets/yindao/ab77fbf6046403906094a0eb4087c586.png' // 火箭 → 会员中心

export type GuidePlacement = 'top' | 'bottom' | 'left' | 'right'

export interface GuideAnnotation {
  target: string
  label: string
  /** 标注方位:down=标签在目标下方(向下引线),up=标签在目标上方(向上引线)。默认 down */
  dir?: 'down' | 'up'
}

export interface GuideStep {
  /** 高亮目标的 CSS 选择器;找不到则居中只显示文案 */
  target: string
  /** 卡片左上角图标 */
  icon?: string
  title: string
  body: string[]
  placement?: GuidePlacement
  /** 挖洞外扩 px,默认 8 */
  pad?: number
  /** 把挖洞从主目标顶延伸到该选择器元素底(跨元素高亮) */
  spanTo?: string
  /** 额外标注(指向若干元素引虚线到文字标签) */
  annotations?: GuideAnnotation[]
  /** 单动作按钮文案(如「开始创作」);设了则底部只显示这一个按钮 */
  cta?: string
  /** true=不挖洞高亮,整屏均匀压暗 */
  noSpot?: boolean
  /** 要打亮(挖透明洞)的元素选择器们;设了则只亮这些(而非 target),支持多个(如 @ + SKILLS) */
  spots?: string[]
  /** 气泡卡定位锚点(不设则用 target);标注/挖洞仍用 target。用于卡片贴近某小元素(如 @ 上方) */
  cardTarget?: string
  /** 气泡卡垂直微调 px(负=上移,正=下移);连同箭头一起偏移 */
  cardOffsetY?: number
}

/** 智能成片分阶段:key 对应 SmartCreateView 的流程阶段(entry/marketing/…) */
export interface GuideStage {
  key: string
  steps: GuideStep[]
}

export interface GuideDef {
  key: string
  /** 扁平引导(首页) */
  steps?: GuideStep[]
  /** 分阶段引导(智能成片,跟随流程) */
  stages?: GuideStage[]
}

export const GUIDES: Record<string, GuideDef> = {
  home: {
    key: 'home',
    steps: [
      {
        target: '[data-guide="nav-smart"]',
        icon: iconSmart,
        title: '从这里开始',
        body: [
          'AI 会根据您的描述生成完整的创意及视频分镜脚本。',
          '您可以查看每个镜头的画面内容和时长,如需调整可重新生成。',
        ],
        placement: 'right',
      },
      {
        target: '[data-guide="home-cases"]',
        icon: iconSpark,
        title: '没有灵感?',
        body: ['可以直接选择热门案例,一键生成同款视频。'],
        placement: 'top',
        spanTo: '.home__masonry .home__tpl',
      },
      {
        target: '[data-guide="nav-projects"]',
        icon: iconFolder,
        title: '所有作品都会被保留在这里',
        body: ['这里汇总了您创建的所有项目。', '可以随时查看创作进度,继续编辑或管理历史作品,让创作更加高效。'],
        placement: 'right',
      },
      {
        target: '[data-guide="topbar-member"]',
        icon: iconRocket,
        title: '解锁更多创作能力',
        body: ['在这里选择适合的会员套餐。', '基础版满足个人创作需求,专业版支持团队空间与多人协作。'],
        placement: 'bottom',
      },
    ],
  },
  smart: {
    key: 'smart',
    stages: [
      // 阶段 entry:入口输入页(!started)
      {
        key: 'entry',
        steps: [
          {
            target: '[data-guide="smart-input"]',
            cardTarget: '[data-guide="smart-at"]', // 卡片贴 @ 上方(工具栏上方),不飘到整卡顶
            title: '用简单的描述,AI 帮你生成精彩视频',
            body: ['上传图片,输入描述,引用素材或预设技能,即可一键生成爆款短视频!'],
            placement: 'top',
            spots: ['[data-guide="smart-at"]', '[data-guide="smart-skills"]'], // 只打亮 @ 和 SKILLS
            cta: '开始创作',
            annotations: [
              { target: '[data-guide="smart-at"]', label: '输入@引用素材或指令', dir: 'down' },
              { target: '[data-guide="smart-skills"]', label: '选择预设技能快速创作', dir: 'down' },
            ],
          },
        ],
      },
      // 阶段 reentry:从流程点「上一步」退回入口、且已有生成结果(canResume)——高亮「重新生成」
      {
        key: 'reentry',
        steps: [
          {
            target: '[data-guide="smart-regen"]',
            cardTarget: '[data-guide="smart-regen"]',
            title: '改完描述,选择继续方式',
            body: ['修改上方描述或素材后:点「重新生成」按新内容重走分镜脚本;点右侧箭头则回到已生成的流程,不重生成。'],
            placement: 'top',
            cardOffsetY: -75, // 气泡卡上移,避免遮住下方按钮
            spots: ['[data-guide="smart-regen"]', '[data-guide="smart-next"]'],
            cta: '知道了',
            annotations: [
              { target: '[data-guide="smart-regen"]', label: '根据描述重新生成内容', dir: 'up' },
              { target: '[data-guide="smart-next"]', label: '点击返回到下一步', dir: 'up' },
            ],
          },
        ],
      },
      // 阶段 process:进入创作流程后(营销拆解 或 分镜脚本等任一步)——2 步:步骤条 + 底部导航
      {
        key: 'process',
        steps: [
          {
            target: '[data-guide="smart-stepbar"]',
            title: '了解创作流程',
            body: ['视频创作分为多个步骤,可点击随意切换已生成的步骤,可随时查看进度,完成当前步骤后自动进入下一步。'],
            placement: 'bottom',
          },
          {
            target: '[data-guide="smart-foot"]',
            cardTarget: '[data-guide="smart-foot-confirm"]', // 卡片贴确认按钮上方(右侧)
            title: '使用导航和生成按钮继续创作',
            body: ['使用底部导航栏可返回上一步或进入下一步,点击绿色按钮生成新内容并进入下一阶段。'],
            placement: 'top',
            cardOffsetY: -75, // 气泡卡(含箭头)整体上移 75px
            // 只打亮三个按钮(而非整条底栏),其余压暗
            spots: [
              '[data-guide="smart-foot-prev"]',
              '[data-guide="smart-foot-next"]',
              '[data-guide="smart-foot-confirm"]',
            ],
            cta: '开始创作',
            annotations: [
              { target: '[data-guide="smart-foot-prev"]', label: '点击返回上一步', dir: 'up' },
              { target: '[data-guide="smart-foot-next"]', label: '点击进入下一步', dir: 'up' },
              { target: '[data-guide="smart-foot-confirm"]', label: '点击生成新内容', dir: 'up' },
            ],
          },
        ],
      },
    ],
  },
}

// 路由 → 引导 key
export const guideKeyForPath = (pathname: string): string | null => {
  const p = String(pathname || '')
  if (p.startsWith('/home')) return 'home'
  if (p.startsWith('/smart')) return 'smart'
  return null
}

// 路由 → 引导展示名(帮助中心「新手引导」项按当前页分类:首页显示「首页新手引导」,智能成片显示「智能成片新手引导」)
export const guideLabelForPath = (pathname: string): string => {
  switch (guideKeyForPath(pathname)) {
    case 'home':
      return '首页新手引导'
    case 'smart':
      return '智能成片新手引导'
    default:
      return '新手引导'
  }
}

// —— 已看标记(首页用;按用户隔离)——
const seenKey = (guideKey: string, uid: any) => `zzh_guide_seen_${guideKey}_u${Number(uid) || 'anon'}`
export const isGuideSeen = (guideKey: string, uid: any): boolean => {
  try {
    return window.localStorage.getItem(seenKey(guideKey, uid)) === '1'
  } catch {
    return false
  }
}
export const markGuideSeen = (guideKey: string, uid: any): void => {
  try {
    window.localStorage.setItem(seenKey(guideKey, uid), '1')
  } catch {
    /* 忽略 */
  }
}

// —— 智能成片引导「已装填」标记:支付成功后置位,下次进 /smart 入口页触发,触发后清除 ——
const SMART_ARM_KEY = 'zzh_smart_guide_armed'
// 「首次支付」门槛(按用户隔离):智能成片引导只对新用户触发——仅该用户【第一次支付】装填一次,
// 续费/再买不再触发。首次装填时置位;之后 armSmartGuide 见此标记即跳过。
const smartOnboardedKey = (uid: any) => `zzh_smart_guide_onboarded_u${Number(uid) || 'anon'}`
export const isSmartGuideOnboarded = (uid: any): boolean => {
  try {
    return window.localStorage.getItem(smartOnboardedKey(uid)) === '1'
  } catch {
    return false
  }
}
// 支付成功调用:传入当前用户 id。该用户此前已装填过(续费/再买)→ 直接跳过,保证只对首次付费的新用户触发。
export const armSmartGuide = (uid?: any): void => {
  try {
    if (isSmartGuideOnboarded(uid)) return // 非首次支付 → 不再装填
    window.localStorage.setItem(SMART_ARM_KEY, '1')
    window.localStorage.setItem(smartOnboardedKey(uid), '1') // 记「该用户已首次装填」,后续支付不再触发
  } catch {
    /* 忽略 */
  }
}
export const isSmartGuideArmed = (): boolean => {
  try {
    return window.localStorage.getItem(SMART_ARM_KEY) === '1'
  } catch {
    return false
  }
}
export const disarmSmartGuide = (): void => {
  try {
    window.localStorage.removeItem(SMART_ARM_KEY)
  } catch {
    /* 忽略 */
  }
}

interface GuideState {
  activeKey: string | null
  stepIndex: number
  /** 分阶段引导:当前阶段 key */
  stageKey: string | null
  /** 阶段末/无引导阶段:隐藏气泡等待用户操作到下一阶段 */
  waiting: boolean
  /** 分阶段引导:已展示过的阶段(每阶段只展示一次,不回放) */
  shownStages: Record<string, boolean>

  startGuide: (key: string) => void
  next: () => void
  prev: () => void
  close: () => void
  /** 智能成片:同步当前流程阶段,首次到达某带引导的阶段时展示它 */
  syncSmartStage: (stageKey: string) => void
}

const stageSteps = (def: GuideDef | null, stageKey: string | null): GuideStep[] => {
  if (!def) return []
  if (def.stages) return def.stages.find((s) => s.key === stageKey)?.steps || []
  return def.steps || []
}

export const useGuideStore = create<GuideState>((set, get) => ({
  activeKey: null,
  stepIndex: 0,
  stageKey: null,
  waiting: false,
  shownStages: {},

  startGuide: (key) => {
    const def = GUIDES[key]
    if (!def) return
    if (def.stages?.length) {
      // 分阶段:先置为「装填/等待」,由 syncSmartStage 依当前流程阶段决定展示哪个
      set({ activeKey: key, stageKey: null, stepIndex: 0, waiting: true, shownStages: {} })
    } else if (def.steps?.length) {
      set({ activeKey: key, stageKey: null, stepIndex: 0, waiting: false, shownStages: {} })
    }
  },

  next: () => {
    const { activeKey, stageKey, stepIndex } = get()
    if (!activeKey) return
    const def = GUIDES[activeKey]
    const steps = stageSteps(def, stageKey)
    if (stepIndex + 1 < steps.length) {
      set({ stepIndex: stepIndex + 1 })
      return
    }
    // 到达当前组末步
    if (def?.stages) {
      // 分阶段:隐藏,等待用户操作进到下一阶段(由 syncSmartStage 再展示)
      set({ waiting: true })
    } else {
      // 扁平:结束
      set({ activeKey: null, stepIndex: 0, stageKey: null, waiting: false })
    }
  },

  prev: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),

  close: () => set({ activeKey: null, stepIndex: 0, stageKey: null, waiting: false, shownStages: {} }),

  syncSmartStage: (nextStageKey) => {
    const { activeKey, stageKey, waiting, shownStages } = get()
    if (activeKey !== 'smart') return
    const def = GUIDES.smart
    const hasGuide = !!def.stages?.some((s) => s.key === nextStageKey)
    // 无引导的阶段(如纯流程步)→ 隐藏等待
    if (!hasGuide) {
      if (!waiting) set({ waiting: true })
      return
    }
    // 已展示过该阶段 → 不回放
    if (shownStages[nextStageKey]) {
      if (!waiting || stageKey !== nextStageKey) set({ waiting: true })
      return
    }
    // 首次到达带引导的阶段 → 展示
    set({
      stageKey: nextStageKey,
      stepIndex: 0,
      waiting: false,
      shownStages: { ...shownStages, [nextStageKey]: true },
    })
  },
}))

// 模块级触发器
export const openGuide = (key: string) => useGuideStore.getState().startGuide(key)
export const syncSmartGuideStage = (stageKey: string) => useGuideStore.getState().syncSmartStage(stageKey)
