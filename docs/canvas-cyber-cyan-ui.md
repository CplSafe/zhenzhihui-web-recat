# Cyber Cyan (无限画布 · 电光黑绿) 前端工程级 UI 规范与技术实施完整手册 (v1.0.0 Production Ready)

> **版本**：v1.0.0 Production Ready  
> **适用终端**：Web / Electron Desktop 无限画布引擎 (HTML5 Canvas / WebGL / SVG + DOM 混合渲染)  
> **目标读者**：Web 前端开发工程师、UI/UX 架构师、全栈开发者  
> **设计系统基准**：Cyber Cyan Dark System (`#08090D` 纯黑底座 + `#00E5BE` 品牌电光青绿)

---

## 目录 (Table of Contents)
1. [核心设计哲学与原则](#1-核心设计哲学与原则)
2. [色彩系统与 Design Tokens 规范](#2-色彩系统与-design-tokens-规范)
3. [排版体系与微字体标准 (Micro-typography)](#3-排版体系与微字体标准)
4. [空间、布局与视差景深系统 (Z-Index & Elevation)](#4-空间布局与视差景深系统)
5. [无限画布核心组件工程级规范](#5-无限画布核心组件工程级规范)
   - 5.1 [画布基座与视口缩放体系 (Canvas Viewport)](#51-画布基座与视口缩放体系)
   - 5.2 [节点解剖学 (Node Anatomy & Specs)](#52-节点解剖学)
   - 5.3 [端口与贝塞尔连线系统 (Ports & Bezier Connections)](#53-端口与贝塞尔连线系统)
   - 5.4 [悬浮生成弹窗 (Floating Inspector / Prompt Hub)](#54-悬浮生成弹窗)
   - 5.5 [底部 HUD Dock 与 小地图 (Minimap)](#55-底部-hud-dock-与-小地图)
   - 5.6 [顶部全局导航与状态栏 (Top Navigation)](#56-顶部全局导航与状态栏)
6. [交互微动效与动画规范 (Motion & Easing)](#6-交互微动效与动画规范)
7. [开箱即用代码文件 (Ready-to-use Code Files)](#7-开箱即用代码文件)
   - 7.1 [`tokens.css` (全量 CSS 变量与动效样式)](#71-tokenscss-样式表)
   - 7.2 [`tailwind.config.js` (Tailwind 工程配置代码)](#72-tailwindconfigjs-配置)
   - 7.3 [贝塞尔连线计算与 SVG 渲染实现示例 (TypeScript)](#73-贝塞尔连线计算函数)

---

## 1. 核心设计哲学与原则

1. **绝对景深与空间层次 (Visual Depth)**
   - 画布底座必须使用冷感深邃纯黑（`#242424`），配合 `24px` 微点阵，营造无边际虚拟创作空间。
   - 拒绝单调扁平灰色：节点、浮动面板、模态层严格遵循 5 阶表面层次结构（`lowest` 到 `highest`），确保图层叠加时轮廓清晰、质感通透。
2. **电光青绿功能驱动 (Functional Accent, Not Decoration)**
   - 品牌电光青绿（`#00E5BE` / `#06B6D4`）仅作为**焦点高光、数据激活、连线流动流光、核心生成 CTA**，严禁大面积铺底造成视疲劳。
3. **影视级高密度微排版 (Micro-typography for Pro Users)**
   - 专为影视导演、分镜与 AIGC 设计师定制，参数标签、镜头景别、画幅比例 (`16:9` / `2.39:1`)、Token 计费均使用高可读等宽字体（`JetBrains Mono`）精密排版。
4. **流体响应与抗锯齿 (Sub-pixel Crispness)**
   - 节点与端口在视口缩放（20% ~ 200%）时保持清晰边缘，连线采用硬件加速贝塞尔曲线计算。

---

## 2. 色彩系统与 Design Tokens 规范

### 2.1 颜色系统表 (Hex & RGBA)

| 分类         | Token 名称                    | 色值 (Hex / RGBA)           | 业务使用场景与语义                               |
| :----------- | :---------------------------- | :-------------------------- | :----------------------------------------------- |
| **画布底座** | `--canvas-bg`                 | `#242424`                   | 最底层无限画布主背景，消除传统灰色的脏感         |
| **微点阵**   | `--canvas-dot`                | `rgba(255, 255, 255, 0.08)` | 24px × 24px 点阵网格系统（缩放自适应）           |
| **表面 0阶** | `--surface-container-lowest`  | `#0d0e14`                   | 文本输入区底色、代码视窗、资产收纳暗格           |
| **表面 1阶** | `--surface-container-low`     | `#12141c`                   | 默认标准工作流节点卡片背景 (Node Surface)        |
| **表面 2阶** | `--surface-container-mid`     | `#181b26`                   | 悬浮面板、顶部工具栏、Dock 栏磨砂基底            |
| **表面 3阶** | `--surface-container-high`    | `#202433`                   | 选中激活卡片、悬浮卡片、二级 Popover 浮层        |
| **表面 4阶** | `--surface-container-highest` | `#2b3145`                   | 节点卡片头部高亮区、Hover 态控制按钮             |
| **品牌主色** | `--brand-primary`             | `#00e5be`                   | 品牌青绿高光、激活端口、运行中流光连线、核心 CTA |
| **品牌悬浮** | `--brand-primary-hover`       | `#1ae9c5`                   | 鼠标悬浮于按钮/连线上的高亮状态                  |
| **品牌激活** | `--brand-primary-active`      | `#00cca9`                   | 按下状态 (MouseDown / Active)                    |
| **品牌弱底** | `--brand-primary-subtle`      | `rgba(0, 229, 190, 0.12)`   | 状态标签底色（如 `[已连接]`、`[@参考图]`）       |
| **品牌光晕** | `--brand-primary-glow`        | `rgba(0, 229, 190, 0.35)`   | 端口晕影、流动连线发光滤镜阴影                   |
| **状态成功** | `--status-success`            | `#10b981`                   | 节点渲染完毕、已同步到云端指示灯                 |
| **状态警示** | `--status-warning`            | `#f59e0b`                   | 排队中、算力不足警告、资源加载中                 |
| **状态错误** | `--status-error`              | `#f43f5e`                   | 渲染失败、端口类型不匹配、连接断开               |
| **边框微弱** | `--border-subtle`             | `rgba(255, 255, 255, 0.06)` | 未选中节点的默认边缘描边 (1px)                   |
| **边框常态** | `--border-default`            | `rgba(255, 255, 255, 0.12)` | 悬浮面板描边、工具栏分隔线                       |
| **边框聚焦** | `--border-focus`              | `rgba(0, 229, 190, 0.6)`    | 节点 Hover、输入框聚焦外框                       |
| **边框激活** | `--border-active`             | `#00e5be`                   | 选中节点强高亮外描边 (1.5px)                     |
| **文字主色** | `--text-primary`              | `#E5E7EB` (Slate-50)        | 节点标题、镜头名称、重要正文                     |
| **文字次色** | `--text-secondary`            | `#94a3b8` (Slate-400)       | 分镜描述、参数标签说明、次要提示                 |
| **文字弱色** | `--text-muted`                | `#64748b` (Slate-500)       | 禁用态、时间戳、未激活按钮图标                   |
| **输入占位** | `--text-placeholder`          | `#475569` (Slate-600)       | 提示词输入框占位提示文本                         |

---

## 3. 排版体系与微字体标准

### 3.1 字体栈建议 (Font Stack)
- **UI 中英文界面字体**：`Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`
- **代码 / 镜头景别 / Token 等宽字体**：`"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

### 3.2 排版层级阶梯

| 规范级别         | 字号 (px / rem)    | 字重 (Font Weight) | 行高 (Line Height) | 字母间距 (Letter Spacing) | 适用场景                                                     |
| :--------------- | :----------------- | :----------------- | :----------------- | :------------------------ | :----------------------------------------------------------- |
| **Headline-L**   | `18px` (1.125rem)  | SemiBold (600)     | `1.4`              | `-0.015em`                | 项目工作流名称、全局导出弹窗主标题                           |
| **Headline-M**   | `15px` (0.9375rem) | Medium (500)       | `1.4`              | `-0.01em`                 | 节点卡片标题（如：`场景图1 - 绝境觉醒`）                     |
| **Body-Default** | `13px` (0.8125rem) | Regular (400)      | `1.5`              | `normal`                  | 分镜剧本正文、AI 提示词输入区、描述字段                      |
| **Label-M**      | `12px` (0.75rem)   | Medium (500)       | `1.2`              | `0`                       | 按钮文字、分类标签（`@参考图1`、`影视级调色`）               |
| **Code-Mono**    | `11px` (0.6875rem) | Medium (500)       | `1.2`              | `0.02em`                  | 镜头画幅 (`16:9`)、分辨率 (`2K UHD`)、时长 (`00:02/00:05`)、算力 (15 Token) |
| **Caption-S**    | `10px` (0.625rem)  | Regular (400)      | `1.0`              | `0.04em`                  | Minimap 坐标标尺、缩放百分比 (`49%`)、FPS 监测 (`60 FPS`)    |

---

## 4. 空间、布局与视差景深系统

### 4.1 Z-Index 层级阶梯标准

```
z-index: 1  ->  无限画布底层网格与背景 (Canvas Dot Grid Layer)
z-index: 5  ->  SVG 贝塞尔连接线图层 (Connection Link Layer)
z-index: 10 ->  普通未激活节点卡片 (Canvas Nodes - Default)
z-index: 20 ->  当前选中的活动节点卡片 (Selected / Dragging Node)
z-index: 30 ->  画板边缘浮动工具栏、左侧工具箱 (Left Tool Bar / Side Dock)
z-index: 40 ->  全局顶部导航栏 (Top Navigation Bar)
z-index: 45 ->  底部 HUD 控制条 & 左下角 Minimap (HUD Dock & Minimap)
z-index: 50 ->  悬浮中央生成 Hub / 属性检查器 (Inspector Panel / Modal Hub)
z-index: 60 ->  全局右键上下文菜单、快捷指令搜索面板 (Context Menu / Command Palette)
z-index: 70 ->  全局 Toast 消息通知、全屏预览视窗 (Notification & Fullscreen Lightbox)
```

### 4.2 阴影与玻璃拟态 Tokens

```css
/* 默认普通卡片阴影 */
--shadow-node: 0 4px 20px -2px rgba(0, 0, 0, 0.55), 
               0 0 0 1px rgba(255, 255, 255, 0.07);

/* 节点激活/选中外发光阴影 */
--shadow-node-active: 0 8px 32px -4px rgba(0, 229, 190, 0.25), 
                      0 0 0 1.5px #00e5be, 
                      0 0 16px rgba(0, 229, 190, 0.35);

/* 浮动面板磨砂玻璃 */
--glass-panel-bg: rgba(18, 20, 28, 0.82);
--glass-panel-backdrop: blur(16px);
--glass-panel-border: 1px solid rgba(255, 255, 255, 0.08);

/* 核心生成模态框高级景深 */
--glass-modal-bg: rgba(14, 16, 22, 0.92);
--glass-modal-backdrop: blur(24px);
--glass-modal-shadow: 0 24px 64px -12px rgba(0, 0, 0, 0.85),
                      0 0 0 1px rgba(0, 229, 190, 0.2);
```

---

## 5. 无限画布核心组件工程级规范

### 5.1 画布基座与视口缩放体系

- **网格底纹**：基于 CSS Radial Gradient 或 HTML5 Canvas 绘制：
  ```css
  background-color: var(--canvas-bg);
  background-image: radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px);
  background-size: 24px 24px;
  ```
- **缩放范围 (Zoom Bounds)**：`20% (0.2)` 至 `200% (2.0)`，默认最佳呈现比例 `100%` 或 `49%`（广域大图预览）。

### 5.2 节点解剖学 (Node Anatomy)

1. **外壳 (Shell)**：
   - 宽度：标准卡片 `320px` ~ `380px`，宽屏预览卡片 `480px` ~ `560px`。
   - 圆角：统一 `border-radius: 12px`。
   - 背景色：`var(--surface-container-low)`。
2. **头部栏 (Header)**：
   - 高度：`40px` 固定。
   - 构成：左侧为节点图标（`16px`）+ 节点标题（`Headline-M`）；右侧为状态标识（如 `Lib 2.5 Pro`、`生成完成`）及功能按钮（全屏/更多）。
   - 下底边线：`1px solid var(--border-subtle)`。
3. **内容区 (Body)**：
   - 内边距：图文节点为 `12px`；媒体预览窗口（图片/视频播放器）贴边放置（`0 padding`），纵横比严格保持 `16:9`。
4. **胶囊元数据 (Pills & Badges)**：
   - 分辨率标签：`bg-black/60 backdrop-blur text-[#00E5BE] font-mono text-[10px] px-1.5 py-0.5 rounded`。
   - 镜头景别标签：`bg-[#202433] text-slate-300 text-xs px-2 py-0.8 rounded-md`。

### 5.3 端口与贝塞尔连线系统 (Ports & Bezier Connections)

1. **端口尺寸与样式 (Handle / Pin)**：
   - 端口位于节点左右边缘中央（或多端口均匀垂直分布）。
   - 外径 `12px`，内径 `6px`，同心圆结构。
   - 默认态：外圈 `#1e293b`，内圈 `#94a3b8`，描边 `1.5px solid #08090d`。
   - 激活/连线吸附态：外圈 `#00e5be`，光晕发光 `box-shadow: 0 0 10px #00e5be`。
2. **贝塞尔连线参数 (Cubic Bezier Spline)**：
   - 常态连线：`stroke-width: 2px`，色值 `rgba(255, 255, 255, 0.18)`。
   - 激活 / 运行流光连线：`stroke-width: 2.5px`，色值 `#00e5be`。
   - 滤镜晕光：`filter: drop-shadow(0 0 8px rgba(0, 229, 190, 0.6))`。
   - 流光动画特性：`stroke-dasharray: 6 6`，关键帧 `animation: cyberFlow 1.2s linear infinite`。

### 5.4 悬浮生成弹窗 (Floating Inspector)

- **尺寸**：宽度 `520px` ~ `580px`，高度自适应。
- **定位**：默认居中浮动或悬停在当前激活节点右下方 `margin: 16px`。
- **结构划分**：
  1. 顶部资产栏：多资产汇聚胶囊、引用图片缩略图（带红色删除角标）、添加资产槽位（`+` 虚线框）。
  2. 提示词输入区：自适应高度文本域，背景 `var(--surface-container-lowest)`，右下角字符数统计（`148 / 500 字`）与“AI扩写润色”按钮。
  3. 参数设置条：模型选择器（`Lib Image 2.5 Pro`）、比例切换器（`16:9`、`2.39:1`）、分辨率胶囊（`2K UHD`）、预估单次算力计费（`约 0.2 元 / 15 Token`）。
  4. 底部动作区：左侧辅助按钮（`保存为文本`、`创建视频节点`）；右侧主 CTA 按钮（`生成分镜`，背景线性渐变 `#00E5BE` -> `#06B6D4`，反白深黑文字）。

### 5.5 底部 HUD Dock 与 小地图 (Minimap)

- **底部中央 Dock**：
  - 吸附位置：`fixed bottom-6 left-1/2 -translate-x-1/2`。
  - 高度：`44px`，圆角：`12px` 或 `9999px` 胶囊形。
  - 内置控件：添加节点 (`+`)、拖拽手形、对齐工具、连接模式、全局缩放步进器 (`- 49% +`)、自适应全屏。
- **左下角 Minimap**：
  - 固定位置：`fixed left-6 bottom-6`。
  - 规格：宽 `160px`，高 `96px`，磨砂微透明底座。
  - 视口框 (Viewport Indicator)：`border: 1.5px solid #00e5be; background: rgba(0, 229, 190, 0.08);`，响应用户平移和滚轮缩放。

### 5.6 顶部全局导航与状态栏 (Top Navigation)

- **高度**：`56px` (h-14)。
- **布局**：左右通栏弹性布局 (`flex justify-between items-center px-4`)。
- **左侧**：产品 Logo（电光梯形科技符号）+ 工作流名称 + 画布切换下拉框 + 云端实时同步状态（绿色小圆点 `已保存到云端`）。
- **右侧**：会员特惠倒计时标签、剩余算力指示（`⚡ 88 Token`）、操作教程入口、分享协作按钮、用户个人中心。

---

## 6. 交互微动效与动画规范

```css
/* 流光连线动画 */
@keyframes cyberFlow {
  0% {
    stroke-dashoffset: 24;
  }
  100% {
    stroke-dashoffset: 0;
  }
}

/* 呼吸微光高亮 */
@keyframes pulseGlow {
  0%, 100% {
    box-shadow: 0 0 8px rgba(0, 229, 190, 0.3);
  }
  50% {
    box-shadow: 0 0 16px rgba(0, 229, 190, 0.6);
  }
}

/* 节点加载骨架屏扫描 */
@keyframes cyberShimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
```

- **交互过渡时长**：
  - 常规 Hover 颜色过渡：`150ms cubic-bezier(0.4, 0, 0.2, 1)`
  - 节点拖拽位移：`0ms` (保证拖拽即时物理跟手度)
  - 弹窗展开/折叠：`200ms cubic-bezier(0.16, 1, 0.3, 1)` (轻微弹性曲线)

---

## 7. 开箱即用代码文件 (Ready-to-use Code Files)

### 7.1 `tokens.css` 样式表
前端同学可直接在项目全局入口（如 `index.css` 或 `globals.css`）引入：

```css
/* ==========================================================================
   Cyber Cyan (无限画布) 全量工程级 Tokens 与样式表
   ========================================================================== */

:root {
  /* 画布基底与表面阶梯 */
  --canvas-bg: #08090d;
  --canvas-dot: rgba(255, 255, 255, 0.08);
  --surface-container-lowest: #0d0e14;
  --surface-container-low: #12141c;
  --surface-container-mid: #181b26;
  --surface-container-high: #202433;
  --surface-container-highest: #2b3145;

  /* 品牌核心色彩 (Cyber Cyan) */
  --brand-primary: #00e5be;
  --brand-primary-hover: #1ae9c5;
  --brand-primary-active: #00cca9;
  --brand-primary-subtle: rgba(0, 229, 190, 0.12);
  --brand-primary-glow: rgba(0, 229, 190, 0.35);
  --brand-gradient: linear-gradient(135deg, #00e5be 0%, #06b6d4 100%);

  /* 辅助状态色 */
  --status-success: #10b981;
  --status-warning: #f59e0b;
  --status-error: #f43f5e;
  --status-info: #0ea5e9;

  /* 描边与分割线 */
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.12);
  --border-focus: rgba(0, 229, 190, 0.6);
  --border-active: #00e5be;

  /* 文字颜色体系 */
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --text-placeholder: #475569;
  --text-inverse: #08090d;
}

/* 画布基础类 */
.canvas-infinite-viewport {
  background-color: var(--canvas-bg);
  background-image: radial-gradient(var(--canvas-dot) 1px, transparent 1px);
  background-size: 24px 24px;
}

/* 节点阴影类 */
.shadow-node {
  box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.55), 
              0 0 0 1px var(--border-subtle);
}

.shadow-node-active {
  box-shadow: 0 8px 32px -4px var(--brand-primary-glow), 
              0 0 0 1.5px var(--brand-primary), 
              0 0 16px var(--brand-primary-glow);
}

/* 磨砂面板类 */
.glass-panel {
  background: rgba(18, 20, 28, 0.82);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--border-default);
}

.glass-modal {
  background: rgba(14, 16, 22, 0.94);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(0, 229, 190, 0.2);
  box-shadow: 0 24px 64px -12px rgba(0, 0, 0, 0.85);
}

/* 连线与端口动画 */
.line-flowing {
  stroke: var(--brand-primary);
  stroke-width: 2.5px;
  stroke-dasharray: 6 6;
  filter: drop-shadow(0 0 8px var(--brand-primary-glow));
  animation: cyberFlow 1.2s linear infinite;
}

@keyframes cyberFlow {
  0% { stroke-dashoffset: 24; }
  100% { stroke-dashoffset: 0; }
}
```

---

### 7.2 `tailwind.config.js` 配置
将以下配置放入项目工程中的 `tailwind.config.js` 中即可无缝使用 Tailwind 工具类：

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: {
          bg: '#08090d',
          dot: 'rgba(255, 255, 255, 0.08)',
        },
        surface: {
          lowest: '#0d0e14',
          low: '#12141c',
          DEFAULT: '#181b26',
          mid: '#181b26',
          high: '#202433',
          highest: '#2b3145',
        },
        brand: {
          primary: '#00e5be',
          hover: '#1ae9c5',
          active: '#00cca9',
          subtle: 'rgba(0, 229, 190, 0.12)',
          glow: 'rgba(0, 229, 190, 0.35)',
        },
        outline: {
          subtle: 'rgba(255, 255, 255, 0.06)',
          default: 'rgba(255, 255, 255, 0.12)',
          focus: 'rgba(0, 229, 190, 0.6)',
          active: '#00e5be',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Hiragino Sans GB',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'ui-monospace',
          'monospace',
        ],
      },
      boxShadow: {
        'node': '0 4px 20px -2px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.07)',
        'node-active': '0 8px 32px -4px rgba(0, 229, 190, 0.25), 0 0 0 1.5px #00e5be, 0 0 16px rgba(0, 229, 190, 0.35)',
        'glass-panel': '0 12px 32px -8px rgba(0, 0, 0, 0.65)',
        'glass-modal': '0 24px 64px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(0, 229, 190, 0.2)',
      },
      borderRadius: {
        'node': '12px',
        'panel': '14px',
        'pill': '9999px',
      },
    },
  },
  plugins: [],
}
```

---

### 7.3 贝塞尔连线计算函数 (TypeScript 算法片段)
供前端在 `<svg>` 中绘制优雅连线时直接调用：

```typescript
/**
 * 计算两个节点端口之间的三次贝塞尔曲线 SVG Path 数据
 * @param startX 起始端口 X 坐标
 * @param startY 起始端口 Y 坐标
 * @param endX 目标端口 X 坐标
 * @param endY 目标端口 Y 坐标
 * @returns SVG <path d="..." /> 的 d 属性字符串
 */
export function getBezierConnectionPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): string {
  // 水平距离差值
  const dx = Math.abs(endX - startX);
  // 控制点弯曲偏移量，随距离自适应并设下限与上限
  const curvature = Math.max(Math.min(dx * 0.5, 160), 40);

  const control1X = startX + curvature;
  const control1Y = startY;
  const control2X = endX - curvature;
  const control2Y = endY;

  return `M ${startX} ${startY} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${endX} ${endY}`;
}
```

---
*文档编制完成。所有色值与组件逻辑均已匹配设计稿生产标准，前端工程师引入此文档配置即可完整复现设计效果。*
---

## 8. 帧智汇漫剧制作落地约定

本规范仅适用于 `/canvas` 列表、创作入口与编辑器以及 `src/components/canvas/`；共享导航保持产品现有样式，不能通过全局 token 影响其他模块。业务状态、接口、画布数据、节点几何、拖拽命中区域、缩放范围与快捷键不因视觉规范而改变。

- **颜色冲突**：原文第 1、2、5 节明确画布底座为 `#242424`，第 7 节示例又写 `#08090d`。现阶段采用正文和色彩表的 `#242424`；`#08090d` 用作强调按钮上的深色文字。后续需要产品确认统一原文。
- **创作入口与列表**：用户的首要任务是进入已有画布或开始创作。以低对比深色表面承载画布卡片和入口，素材封面保持原图比例；青绿仅用于主操作、键盘焦点和交互反馈。共享产品导航保留原主题，避免改变其他模块的视觉。
- **生成面板**：创作者需要同时辨认引用素材、提示词、模型参数和生成动作；面板按原功能分组，宽度以 580px 为目标并受视口约束，输入区使用最低表面层，避免用装饰挤占编辑空间。
- **节点与连线**：节点媒体内容优先，选中节点及其关联连线以青绿标记；普通连线低对比，错误和重复连接仍使用独立语义色。当前交互端口有更大的命中区域，不能为符合示意尺寸而缩小它。
- **辅助界面**：历史、素材、音频、分镜、导出、设置及失败详情复用相同表面、文字、边框和焦点色；警告、错误、成功色只表达对应状态。长列表和弹窗保留滚动与窄屏约束。
- **动效和可访问性**：普通反馈短促，拖拽位置不加延迟；持续流光遵循减少动态效果偏好。焦点、禁用及状态不能只依赖颜色识别。
- **实现方式**：画布变量限定在 `.canvas-view` 与画布专用 Portal，列表变量限定在 `.cl-page`；组件继续使用各自 CSS Modules，优先复用变量和既有组件，不引入全局样式或更改其他业务模块。颜色示例只是视觉规则，不授权照搬文档中的连线算法或更换现有 React Flow 实现。

- **画布点阵可见性修订**：为满足创作者在 `#242424` 底色上的实际可见性需求，点阵仍使用 24px 间距，白点使用 18% 不透明度、2px 标称直径；点阵继续随视口缩放和移动。此项覆盖原手册中 8% 不透明度的建议。

- **表面色修订**：按参考图取样，原 `#181b26` 主表面统一调整为 `#262626`，仅替换漫剧制作中的同色表面；其他层级与状态颜色保持独立。

- **边框色修订**：漫剧制作的绿色选中、悬停及焦点边框统一使用灰白 `#cbd5d9`（弱边框可降低透明度）；节点连接线、文字和状态色不随边框更改。此项覆盖原手册的绿色边框建议。

- **创作入口主题修订**：`/canvas` 创作入口采用白色页面、浅色卡片和弹窗；进入 `/canvas/:id` 后仍沿用画布编辑器的深色主题。
