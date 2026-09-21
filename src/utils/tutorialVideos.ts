/**
 * 页面 → 操作手册视频 的映射（纯逻辑，供顶栏「操作手册」按钮按当前路由取视频）。
 * 视频文件放在 public/tutorials/（由 tools/tutorial 录制器生成，静音 1080p）。
 * 上 CDN 时只需改 TUTORIAL_BASE_URL。
 */
export interface TutorialVideo {
  /** 稳定标识，也是文件名 */
  key: 'smart-create' | 'hot-copy' | 'canvas'
  /** 弹窗标题 */
  title: string
  /** 一句话说明 */
  summary: string
  /** 视频地址 */
  src: string
}

export const TUTORIAL_BASE_URL = '/tutorials/'

const TUTORIALS: Record<TutorialVideo['key'], Omit<TutorialVideo, 'src' | 'key'>> = {
  'smart-create': {
    title: '爆款成片 · 操作手册',
    summary: '选模型 → 写需求 → 去制作 → 分镜脚本 → 生成视频 → 查看与修改成片',
  },
  'hot-copy': {
    title: '爆款复刻 · 操作手册',
    summary: '上传爆款视频 → 上传替换素材 → 选模型 → 去制作 → 查看成片',
  },
  canvas: {
    title: '无限画布 · 操作手册',
    summary: '新建画布 → 文本/图片/视频节点 → @引用 → 截帧 → 框选 → 剪辑时间线',
  },
}

/** 路径前缀 → 视频 key。顺序即匹配优先级。 */
const ROUTE_RULES: Array<[RegExp, TutorialVideo['key']]> = [
  [/^\/smart(\/|$)/, 'smart-create'],
  [/^\/real-person-video(\/|$)/, 'smart-create'],
  [/^\/hot-copy(\/|$)/, 'hot-copy'],
  [/^\/canvas(\/|$)/, 'canvas'],
]

/** 按 key 取视频描述。 */
export function getTutorialByKey(key: TutorialVideo['key']): TutorialVideo {
  return { key, src: `${TUTORIAL_BASE_URL}${key}.mp4`, ...TUTORIALS[key] }
}

/** 按当前路径取对应教程；没有教程的页面返回 null（按钮不显示）。 */
export function getTutorialForPath(pathname: string): TutorialVideo | null {
  const path = String(pathname || '')
    .split('?')[0]
    .split('#')[0]
  for (const [re, key] of ROUTE_RULES) {
    if (re.test(path)) return getTutorialByKey(key)
  }
  return null
}
