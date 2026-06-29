/**
 * 资源素材项目 CRUD（localStorage）
 * 管理素材库项目列表的增删改查，每个项目关联素材资产。
 */
import { readJson, writeJson } from '@/utils/storage'

const STORAGE_KEY = 'zhenzhihui:resource-projects:v1'

function createId(prefix) {
  const id = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}_${id}`
}

function toCount(value) {
  const num = Number(value || 0)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
}

export function loadResourceProjects() {
  const parsed = readJson(STORAGE_KEY, [])
  return Array.isArray(parsed) ? parsed : []
}

export function saveResourceProjects(projects) {
  writeJson(STORAGE_KEY, projects)
}

export function ensureSeededResourceProjects(seedProjects = []) {
  const current = loadResourceProjects()
  if (current.length) return current
  if (Array.isArray(seedProjects) && seedProjects.length) {
    saveResourceProjects(seedProjects)
    return seedProjects
  }
  const defaults = buildDefaultProjects()
  saveResourceProjects(defaults)
  return defaults
}

export function buildDefaultProjects() {
  return [
    {
      id: 'project-1',
      tab: 'mine',
      title: '艾玛电动车春季推广',
      date: '2026-05-20',
      time: '14:30',
      badge: '最近使用',
      badgeTone: 'violet',
      layout: 'folder',
      size: '85.6GB',
      channel: '千川',
      aiScore: 92,
      imageCount: 128,
      videoCount: 32,
      audioCount: 8,
      collaborators: 3,
      updatedAt: Date.now(),
    },
    {
      id: 'project-2',
      tab: 'mine',
      title: '美妆新品上市方案',
      date: '2026-05-18',
      time: '10:20',
      badge: 'AI 生成中',
      badgeTone: 'blue',
      layout: 'mosaic',
      size: '28.4GB',
      channel: '小红书',
      aiScore: 88,
      imageCount: 96,
      videoCount: 28,
      audioCount: 6,
      collaborators: 4,
      updatedAt: Date.now(),
    },
    {
      id: 'project-3',
      tab: 'mine',
      title: '东方树叶广告素材库',
      date: '2026-05-12',
      time: '09:15',
      badge: '已投放',
      badgeTone: 'green',
      layout: 'wide',
      size: '63.2GB',
      channel: '抖音',
      aiScore: 90,
      imageCount: 72,
      videoCount: 16,
      audioCount: 4,
      collaborators: 3,
      updatedAt: Date.now(),
    },
    {
      id: 'project-4',
      tab: 'mine',
      title: '运动鞋夏季 campaign',
      date: '2026-05-10',
      time: '16:40',
      badge: '团队共享',
      badgeTone: 'lavender',
      layout: 'triple',
      size: '128.7GB',
      channel: '千川',
      aiScore: 94,
      imageCount: 156,
      videoCount: 48,
      audioCount: 12,
      collaborators: 5,
      updatedAt: Date.now(),
    },
    {
      id: 'project-5',
      tab: 'mine',
      title: '瑞幸联名活动素材',
      date: '2026-05-08',
      time: '11:05',
      badge: '收藏',
      badgeTone: 'amber',
      layout: 'single',
      size: '38.8GB',
      channel: '微信',
      aiScore: 86,
      imageCount: 64,
      videoCount: 20,
      audioCount: 4,
      collaborators: 2,
      updatedAt: Date.now(),
    },
    {
      id: 'project-6',
      tab: 'mine',
      title: '家居行业信息流素材',
      date: '2026-05-05',
      time: '15:30',
      badge: '高消耗',
      badgeTone: 'orange',
      layout: 'double',
      size: '52.1GB',
      channel: '巨量引擎',
      aiScore: 76,
      imageCount: 89,
      videoCount: 24,
      audioCount: 6,
      collaborators: 4,
      updatedAt: Date.now(),
    },
  ]
}

export function createResourceProject({ tab = 'mine', title = '新建文件夹', layout = 'folder' } = {}) {
  const projects = loadResourceProjects()
  const created = {
    id: createId('project'),
    tab,
    title,
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toTimeString().slice(0, 5),
    badge: '最近使用',
    badgeTone: 'violet',
    layout,
    size: '0GB',
    channel: '未设置',
    aiScore: 0,
    imageCount: 0,
    videoCount: 0,
    audioCount: 0,
    collaborators: 1,
    updatedAt: Date.now(),
  }
  const next = [created, ...projects]
  saveResourceProjects(next)
  return created
}

export function deleteResourceProject(projectId) {
  const projects = loadResourceProjects()
  const next = projects.filter((project) => project?.id !== projectId)
  saveResourceProjects(next)
  return next
}

export function addAssetToResourceProject({ projectId, asset }: any = {}) {
  if (!projectId || !asset) return null
  const projects = loadResourceProjects()
  const next = projects.map((project) => {
    if (project?.id !== projectId) return project
    const type = String(asset?.type || '').trim()
    const isImage = type === '图片' || type === 'image'
    const isVideo = type === '视频' || type === 'video'
    const isAudio = type === '音频' || type === 'audio'
    const delta = {
      imageCount: toCount(project?.imageCount) + (isImage ? 1 : 0),
      videoCount: toCount(project?.videoCount) + (isVideo ? 1 : 0),
      audioCount: toCount(project?.audioCount) + (isAudio ? 1 : 0),
    }
    return {
      ...project,
      ...delta,
      updatedAt: Date.now(),
      badge: '最近使用',
      badgeTone: 'violet',
    }
  })
  saveResourceProjects(next)
  return next.find((project) => project?.id === projectId) || null
}
