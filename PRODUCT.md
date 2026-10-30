# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

创作者使用无限画布制作 AI 内容，需要从全景图调整视角并截取画面。

## Product Purpose

帧智汇提供 AI 图像、视频创作与无限画布工作流。全景取景让创作者从画布中的全景素材选取一个或多个视角，并将截图作为图片素材加入画布。

## Operating Context

用户在无限画布中打开全景图预览，进入 360° 浏览与取景，调整相机视角、选择截图范围，再将取景结果加入画布。

## Capabilities and Constraints

- 全景取景支持当前视角、4 视角和 12 视角截图。
- 截图可在加入画布前预览、选择，也可下载或拼接下载。
- 多张截图加入画布时会作为分镜组排列。
- 已确认：全景取景为本地操作，不消耗生成积分。
- 已确认的本次界面要求：点击“360°查看全景”后，全屏展开取景页面；整体采用黑色风格。
- 加入画布后的截图应继续作为可用图片节点参与后续创作。

## Evidence on Hand

- 当前界面截图：用户在 2026-10-28 提供的“全景取景”弹窗与画布截图。
- 实现参考：`src/components/canvas/CanvasImagePreviewModal.tsx`、`src/components/canvas/CanvasToolScene.tsx`、`src/components/canvas/PanoramaCapturePanel.tsx`。
