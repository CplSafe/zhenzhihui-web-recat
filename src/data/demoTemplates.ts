/**
 * 案例库 / 轮播 的固定演示视频(替换后端真实数据,用于展示)。
 * OSS 视频(HTTPS 域名,公开读)。
 * 每条带真实宽高(已探测),比例 = w/h(通用,不限 9:16 / 16:9);轮播只取横屏(w>h)。
 */
import type { TemplateItem } from '@/api/templates'

/** 内置演示视频的公共 OSS 前缀。 */
const BASE = 'https://zzh-zhongdahengrui.oss-accelerate.aliyuncs.com/'

/** 内置演示视频的对象名与真实像素尺寸。 */
interface DemoVid {
  name: string
  w: number
  h: number
}

// name = OSS 对象名(不含 .mp4);w/h = 真实像素(探测得到)
const VIDS: DemoVid[] = [
  { name: '2764a7e5761828c5abe96803a506a1e8', w: 720, h: 1280 },
  { name: '2b3e62962a9dd1ae22237405dde1eac2', w: 720, h: 1280 },
  { name: '2e566af27e73e1e60a1d46d0f83610c9', w: 720, h: 1280 },
  { name: '3500604259d134a4aa065935ffeef88a', w: 1280, h: 720 },
  { name: '3abbda6c6f7e70e40b5d5e239efe27e3', w: 1280, h: 720 },
  { name: '43b9af91d1e89a990ae7f28cee861b52', w: 720, h: 1280 },
  { name: '4e066c8a05608916b7a8152cb339b5d9', w: 720, h: 1280 },
  { name: '5a5daddaade7d7d6a8ac1299f449bb4a', w: 720, h: 1280 },
  { name: '5ab5400995bcd126030288f8f8daff80', w: 720, h: 1280 },
  { name: '6caa1218d553d3a4fedb1228bd6fa210', w: 720, h: 1280 },
  { name: '6ed9e67ed137a7a9c9155838de5fc245', w: 1280, h: 720 },
  { name: '80ca76323d25e51c01ad895f58b4fac3', w: 1280, h: 720 },
  { name: '891ec3549de707f294b37d111e2f6b7d', w: 1280, h: 720 },
  { name: 'a66834795c1eb8a0b3b6485aab3134c3', w: 1280, h: 720 },
  { name: 'c5b8518c01c071a149503510fce5b3a8', w: 720, h: 1280 },
  { name: 'cdca0f95d9f05ec5b0b15edafb6cbc41', w: 1280, h: 720 },
  { name: 'e392e4e7a65971b1e9bff7dc4baffd6c', w: 720, h: 1280 },
  { name: 'ff0b0a3b8c6bc0d43458c1d0d7940a6d', w: 720, h: 1280 },
  { name: '43518e0fdd4a2d633fd5d2d4e8af684f', w: 720, h: 1280 },
  { name: '02b8643d9e3f7dd2ecb88754537ee426', w: 720, h: 1280 },
  { name: '0e4e93bfa13e91f3a78cd88f8cb5d98d', w: 960, h: 960 },
  { name: '2b87e409f463819782b9ebbd47aab80f', w: 960, h: 960 },
  { name: '4e801a23462484f7fbfeedf2ded1e13a', w: 1280, h: 720 },
  { name: '8e03e7cc86f048d258d514d75f32d0ed', w: 960, h: 960 },
  { name: 'e2c11b01e534ce338cdf3eb03659a725', w: 960, h: 960 },
]

/** 把演示视频对象名转换为公开可读的完整 OSS 地址。 */
const urlOf = (v: DemoVid) => BASE + v.name + '.mp4'

/** 横屏视频 url(w>h),用于轮播 */
export const DEMO_LANDSCAPE_URLS: string[] = VIDS.filter((v) => v.w > v.h).map(urlOf)

/** 缩略图不可用时循环使用的卡片渐变背景。 */
const GRADS = [
  'linear-gradient(160deg, #e0d4f5, #f5ecfd)',
  'linear-gradient(160deg, #d4e8f0, #ecf8fb)',
  'linear-gradient(160deg, #f0d4d8, #fbeaed)',
  'linear-gradient(160deg, #d4f0e2, #eafbf1)',
  'linear-gradient(160deg, #f0e8d4, #fbf6ea)',
  'linear-gradient(160deg, #d4d8f0, #eaeefb)',
]

/** 全部演示模板(供案例库展示);ratio 用真实宽高(任意比例) */
export const DEMO_TEMPLATES: TemplateItem[] = VIDS.map((v, i) => ({
  id: 90000 + i,
  title: `精选模板 ${i + 1}`,
  thumbnailUrl: '',
  videoUrl: urlOf(v),
  ratio: `${v.w} / ${v.h}`,
  width: v.w,
  height: v.h,
  style: '',
  useCount: 0,
  createdAt: '',
  grad: GRADS[i % GRADS.length],
}))
