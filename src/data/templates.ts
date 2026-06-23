/**
 * 模板数据 — 后续替换为后端 API 调用
 * 排序：使用热度(useCount) > 时间倒序(createdAt)
 */

export interface TemplateItem {
  id: number
  title: string
  grad: string
  ratio: string
  useCount: number
  createdAt: string
}

const TEMPLATES: TemplateItem[] = [
  {
    id: 1,
    title: '健康饮食 均衡生活',
    grad: 'linear-gradient(160deg, #c9efc2, #eafbe4)',
    ratio: '9 / 16',
    useCount: 890,
    createdAt: '2026-06-20',
  },
  {
    id: 2,
    title: '未来科技 智能生活',
    grad: 'linear-gradient(160deg, #b6c4f0, #e2e9fb)',
    ratio: '3 / 4',
    useCount: 1200,
    createdAt: '2026-06-18',
  },
  {
    id: 3,
    title: '美味直击 舌尖诱惑',
    grad: 'linear-gradient(160deg, #f0d6b8, #fbeede)',
    ratio: '1 / 1',
    useCount: 650,
    createdAt: '2026-06-21',
  },
  {
    id: 4,
    title: '温暖相伴 情感故事',
    grad: 'linear-gradient(160deg, #f8d6e3, #fdeef3)',
    ratio: '4 / 5',
    useCount: 1500,
    createdAt: '2026-06-15',
  },
  {
    id: 5,
    title: '活力无限 运动人生',
    grad: 'linear-gradient(160deg, #ffd2b0, #ffeede)',
    ratio: '9 / 16',
    useCount: 430,
    createdAt: '2026-06-22',
  },
  {
    id: 6,
    title: '春日限定 焕新出发',
    grad: 'linear-gradient(160deg, #d7f0c4, #eefbe2)',
    ratio: '16 / 9',
    useCount: 980,
    createdAt: '2026-06-19',
  },
  {
    id: 7,
    title: '潮流穿搭 个性表达',
    grad: 'linear-gradient(160deg, #e2c4f0, #f4e7fb)',
    ratio: '3 / 4',
    useCount: 2100,
    createdAt: '2026-06-10',
  },
  {
    id: 8,
    title: '清新茶饮 慢享时光',
    grad: 'linear-gradient(160deg, #c4f0e8, #e2fbf6)',
    ratio: '1 / 1',
    useCount: 760,
    createdAt: '2026-06-20',
  },
  {
    id: 9,
    title: '旅行日记 远方在召唤',
    grad: 'linear-gradient(160deg, #c4dff0, #e2f1fb)',
    ratio: '9 / 16',
    useCount: 1800,
    createdAt: '2026-06-12',
  },
  {
    id: 10,
    title: '美妆教程 妆点自信',
    grad: 'linear-gradient(160deg, #f0c4d2, #fbe2eb)',
    ratio: '4 / 5',
    useCount: 1350,
    createdAt: '2026-06-16',
  },
  {
    id: 11,
    title: '科技数码 智享未来',
    grad: 'linear-gradient(160deg, #c4ccf0, #e2e6fb)',
    ratio: '3 / 4',
    useCount: 560,
    createdAt: '2026-06-21',
  },
  {
    id: 12,
    title: '宠物日常 萌动每一刻',
    grad: 'linear-gradient(160deg, #f0dcc4, #fbf0e2)',
    ratio: '1 / 1',
    useCount: 3200,
    createdAt: '2026-06-05',
  },
  {
    id: 13,
    title: '都市夜色 灵感闪现',
    grad: 'linear-gradient(160deg, #b9c0e8, #e3e7fb)',
    ratio: '9 / 16',
    useCount: 870,
    createdAt: '2026-06-19',
  },
  {
    id: 14,
    title: '简约家居 美学生活',
    grad: 'linear-gradient(160deg, #f0e2c4, #fbf3e2)',
    ratio: '16 / 9',
    useCount: 690,
    createdAt: '2026-06-20',
  },
  {
    id: 15,
    title: '萌宠时刻 治愈日常',
    grad: 'linear-gradient(160deg, #cdeccb, #ecf8ea)',
    ratio: '3 / 4',
    useCount: 2500,
    createdAt: '2026-06-08',
  },
  {
    id: 16,
    title: '国风新潮 东方美学',
    grad: 'linear-gradient(160deg, #eccfcf, #f8eaea)',
    ratio: '4 / 5',
    useCount: 1100,
    createdAt: '2026-06-17',
  },
  {
    id: 17,
    title: '职场穿搭 干练不失温柔',
    grad: 'linear-gradient(160deg, #d4c4f0, #ede2fb)',
    ratio: '9 / 16',
    useCount: 720,
    createdAt: '2026-06-20',
  },
  {
    id: 18,
    title: '家庭烘焙 甜蜜时光',
    grad: 'linear-gradient(160deg, #f0cfc4, #fbe6e2)',
    ratio: '1 / 1',
    useCount: 940,
    createdAt: '2026-06-18',
  },
  {
    id: 19,
    title: '户外露营 拥抱自然',
    grad: 'linear-gradient(160deg, #c4f0d2, #e2fbe9)',
    ratio: '16 / 9',
    useCount: 1600,
    createdAt: '2026-06-14',
  },
  {
    id: 20,
    title: '读书分享 知识的力量',
    grad: 'linear-gradient(160deg, #c4e2f0, #e2f2fb)',
    ratio: '3 / 4',
    useCount: 510,
    createdAt: '2026-06-22',
  },
  {
    id: 21,
    title: '母婴好物 安心之选',
    grad: 'linear-gradient(160deg, #f0c4e6, #fbe2f4)',
    ratio: '4 / 5',
    useCount: 830,
    createdAt: '2026-06-19',
  },
  {
    id: 22,
    title: '摄影技巧 定格美好',
    grad: 'linear-gradient(160deg, #c4d6f0, #e2eafb)',
    ratio: '9 / 16',
    useCount: 1450,
    createdAt: '2026-06-13',
  },
  {
    id: 23,
    title: '咖啡日常 从豆到杯',
    grad: 'linear-gradient(160deg, #e8dcc4, #f8f2e2)',
    ratio: '1 / 1',
    useCount: 1050,
    createdAt: '2026-06-16',
  },
  {
    id: 24,
    title: '健身打卡 蜕变之旅',
    grad: 'linear-gradient(160deg, #f0c4c4, #fbe2e2)',
    ratio: '3 / 4',
    useCount: 2800,
    createdAt: '2026-06-06',
  },
  {
    id: 25,
    title: '家装改造 焕然一新',
    grad: 'linear-gradient(160deg, #c4f0e4, #e2fbf2)',
    ratio: '16 / 9',
    useCount: 590,
    createdAt: '2026-06-21',
  },
  {
    id: 26,
    title: '音乐推荐 旋律里的故事',
    grad: 'linear-gradient(160deg, #d0c4f0, #e9e2fb)',
    ratio: '9 / 16',
    useCount: 780,
    createdAt: '2026-06-19',
  },
  {
    id: 27,
    title: '护肤心得 肌肤管理',
    grad: 'linear-gradient(160deg, #f0c4da, #fbe2ed)',
    ratio: '4 / 5',
    useCount: 1900,
    createdAt: '2026-06-11',
  },
  {
    id: 28,
    title: '汽车测评 驾驭激情',
    grad: 'linear-gradient(160deg, #c4c8f0, #e2e5fb)',
    ratio: '16 / 9',
    useCount: 620,
    createdAt: '2026-06-20',
  },
  {
    id: 29,
    title: '插花艺术 生活美学',
    grad: 'linear-gradient(160deg, #f0e8c4, #fbf6e2)',
    ratio: '1 / 1',
    useCount: 480,
    createdAt: '2026-06-22',
  },
  {
    id: 30,
    title: '手机摄影 人人都是摄影师',
    grad: 'linear-gradient(160deg, #c4f0ee, #e2fbf9)',
    ratio: '3 / 4',
    useCount: 1700,
    createdAt: '2026-06-14',
  },
  {
    id: 31,
    title: '营养早餐 开启活力一天',
    grad: 'linear-gradient(160deg, #f0d0c4, #fbe9e2)',
    ratio: '9 / 16',
    useCount: 880,
    createdAt: '2026-06-18',
  },
  {
    id: 32,
    title: '亲子游戏 快乐成长',
    grad: 'linear-gradient(160deg, #c4ecf0, #e2f8fb)',
    ratio: '4 / 5',
    useCount: 1150,
    createdAt: '2026-06-15',
  },
]

/** 按使用热度 > 时间倒序排序 */
export function getTemplates(): TemplateItem[] {
  return [...TEMPLATES].sort((a, b) => {
    if (b.useCount !== a.useCount) return b.useCount - a.useCount
    return b.createdAt.localeCompare(a.createdAt)
  })
}

/** 首页取前 20 条 */
export function getHomeTemplates(): TemplateItem[] {
  return getTemplates().slice(0, 20)
}
