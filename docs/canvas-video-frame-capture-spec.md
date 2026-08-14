# 无限画布 · 视频截帧设计

日期：2026-08-14

## 目标

在无限画布的视频节点上支持「截帧」：用户在放大预览里定位到某一帧，把它截取成一张图片素材，并作为新的图片节点落到画布上，可以继续连去做图生图或当作生成新视频的参考。

## 背景与现状

画布已经具备实现这个功能所需的全部底座：

- `src/utils/videoFrameCapture.ts` 的 `seekVideoToDecodedFrame` 已经解决了最难的部分——seek 之后确认目标帧真的解码完成，不会截到上一帧。智能成片的时间轴缩略图已在使用。
- `CanvasVideoPreviewModal` 提供了全屏播放器，带原生进度条，可以任意跳转。
- `importLocalImages` 已经确立了「先落带本地预览的占位节点 → 上传素材中心 → 换成持久地址」的完整模式，含失败回滚。
- 节点素材统一以 `{ assetId, resultUrl }` 持久化，`resultUrl` 用同源的 `assetStreamUrl`。

因此本设计不引入新的基础能力，只做接线与一个纯函数工具。

## 范围

**做：**

- 放大预览弹窗内提供「截取当前帧」
- 截取结果按视频原始分辨率存为 JPEG（质量 0.92）
- 上传素材中心，落成画布上的新图片节点

**不做：**

- 节点上的快捷截帧入口（画面太小，定位不准）
- 让用户选择输出分辨率（原尺寸在绝大多数情况下就是对的）
- 后端抽帧接口（当前没有，前端能力已足够）
- 截帧后自动连线（见「落位与连线」）

## 架构

### 新增：`src/utils/videoFrameGrab.ts`

单一职责——把一个 `HTMLVideoElement` 变成一个 JPEG `Blob`：

```
captureVideoFrameBlob(video: HTMLVideoElement, options?: { quality?: number; signal?: AbortSignal })
  → Promise<Blob>
```

流程：`pause()` → `seekVideoToDecodedFrame(video, video.currentTime)` 确认当前帧稳定 → 按 `videoWidth × videoHeight` 建 canvas → `drawImage` → `toBlob('image/jpeg', quality)`。

它不认识画布、不认识节点、不做上传，因此可以被单测直接覆盖，也可供其他入口复用。

**为什么是「用弹窗里现有的 video 元素」而不是另开一个隐藏 video 重新加载：** 用户看到的那一帧已经解码在屏，直接 `drawImage` 即可；重新加载只会增加等待，且需要处理第二次加载的失败。先 `pause()` 再等一次解码确认，就能保证截到的正是用户看到的画面。

### 修改：`CanvasVideoPreviewModal`

新增两个可选 props：

- `canCapture?: boolean` —— 为 false 时按钮置灰并显示原因
- `onCaptureFrame?: (blob: Blob) => Promise<void> | void`

弹窗自身只负责：调用 `captureVideoFrameBlob`、维护「截取中」禁用态、把 Blob 交出去。它不知道 Blob 之后会变成什么。

截取成功后**弹窗不关闭**——连续截取多帧是常见操作。

### 修改：视频节点与 `CanvasView`

弹窗渲染在节点组件内部，而建节点、上传、记历史都在 `CanvasInner`。两者通过模块级共享 handler 桥接，与本文件既有的 `canvasModelNameByVersion`、`__canvasTextContents` 同一思路，不另起一套机制。

`CanvasInner` 收到 Blob 后：

1. `commitHistory()`
2. 落一个带本地预览（`previewUrl`，不进持久化白名单）的图片占位节点
3. 上传素材中心取得 `assetId`
4. 写入 `{ assetId, resultUrl: assetStreamUrl(assetId, workspaceId) }`，释放预览地址

失败则移除占位节点并 toast，与 `importLocalImages` 现有行为一致。

## 落位与连线

新图片节点落在源视频节点**右侧**，按视频原始宽高比吸附到画布可选比例（复用 `snapImageRatio`）。连续截取时依次向下错开，不重叠。

**不自动连线**，两个原因：

1. 画布规则里图片节点只接受 `['text', 'image']` 来源，视频 → 图片这条边本就不合法。
2. 语义上截帧是「从视频派生出一张图」，不是「把视频当作生成这张图的输入」。自动连上会让这条视频被当作 `input_assets` 提交给下一次生成。

要不要连、连去哪，由用户决定。

## 错误处理

| 情况 | 处理 |
| --- | --- |
| 视频没有 `assetId`（只有 provider 直链，跨域必然污染 canvas） | 按钮预先置灰并说明「该视频尚未入素材库，无法截帧」 |
| `toBlob` 抛 `SecurityError` | 兜底转成「该视频无法截帧（跨域限制）」 |
| seek / 解码超时（已有 5s / 1.2s 上限） | 「未能取到当前帧，请重试」 |
| `videoWidth` 或 `videoHeight` 为 0 | 前置校验直接拒绝，不产出 0×0 空图 |
| 上传素材失败 | 移除占位节点 + toast |

原则：不出现静默失败，每条路径都有确定出口。

## 测试策略

**`videoFrameGrab.ts`（纯函数，全分支覆盖）**

jsdom 没有真正的 canvas 2D 实现，因此需要 stub `HTMLCanvasElement.prototype.getContext` 与 `toBlob`。这不削弱测试价值：要验证的是「什么情况下产出 Blob、什么情况下抛哪一类错」，而非像素内容。

覆盖：正常产出、SecurityError 转业务错误、尺寸为 0 时拒绝、`toBlob` 返回 null、abort 生效。

**`CanvasVideoPreviewModal`（组件测试）**

按钮存在；`canCapture` 为 false 时禁用且有说明；点击后进入禁用态；成功后 `onCaptureFrame` 收到 Blob。

**`CanvasView` 的接线：不做端到端测试。**

该文件目前本就缺少端到端覆盖（见 CLAUDE.md「Known runtime caveats」），为它新建大型夹具收益低。做法是把其中可测的纯逻辑（落位偏移、按视频尺寸吸附比例）抽成独立函数单测，剩余接线靠 TypeScript 与手动验证。此处不假装已被覆盖。

按 CLAUDE.md 约定，`src/utils/videoFrameGrab.ts` 加入 `vitest.config.ts` 的 coverage 白名单。

## 手动验证清单

1. 生成或上传一个视频节点 → 放大预览 → 拖到任意位置 → 截取当前帧 → 画布右侧出现图片节点，内容与暂停画面一致
2. 连续截取三帧 → 三个节点依次错开、不重叠
3. 截出的图片节点连去图片节点做图生图 → 能正常提交（说明 `assetId` 有效）
4. 断网状态下截帧 → 占位节点被移除并提示上传失败
5. 撤销一次 → 截帧产生的节点被撤掉
