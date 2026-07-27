# Design QA — 智能成片任务管理

- Source: `C:\Users\admin\AppData\Local\Temp\zhenzhihui-task-audit\figma-task-manager.png`
- Source viewport: `1920 × 1080`
- Implementation URL: `http://127.0.0.1:4173/smart`
- Requested implementation state: 已登录、任务管理展开、同时包含已生成/生成中/排队中的智能成片任务
- Implementation screenshot: 未生成（当前 Codex Desktop 会话没有可用的内置浏览器；按照浏览器使用约束，未擅自改用 Playwright CLI 或其他浏览器）

## Comparison history

1. 检查 Figma 正式节点（忽略标记为“作废”的方案）：确认任务管理位于主侧栏右侧，展开宽度约 330px，任务缩略图 100 × 100px，包含智能成片/爆款复制/图片三个标签及中部收起把手。
2. 代码级对照：任务面板按 330px 推挤主内容，桌面收起态保留 20 × 60px 把手；任务缩略图、标签、标题层级和状态色按来源实现。排队状态使用灰色，完成/失败项不显示进度轨道，活动与排队项显示进度轨道。
3. 交互级检查：标签切换（含方向键/Home/End）、任务跳转、隐藏任务、展开/收起、Esc/遮罩关闭、窄屏焦点圈定与后台状态恢复均已接线；窄屏收起把手扩大为 24 × 60px，并避免占据整页左侧高度。
4. 辅助功能复核：移除轮询任务列表上的 `aria-live`，避免进度更新持续触发读屏播报；TypeScript、ESLint 与生产构建用于验证实现完整性。
5. 像素截图合并对比：阻塞。缺少同视口、同登录态的实现截图，因此未声称完成最终视觉一致性验收。

## Unverified visual details

- 真实登录数据下任务列表的首屏密度与滚动位置
- 1920 × 1080 下标题、标签和第一张任务缩略图的最终纵向偏移
- 900px 以下覆盖层的焦点顺序、遮罩透明度和触控反馈
- 真实视频签名地址加载后的首帧缩略图表现

## Final result

`blocked` — 功能与代码验证可完成，但缺少获准使用的浏览器截图工具，无法执行来源图与实现图的最终并排视觉 QA。

---

# Design QA — 我的素材·真人素材库

- Source visual truth: `C:\Users\admin\AppData\Local\Temp\codex-clipboard-7086dad9-d2a9-48e3-a16b-1a51909d4223.png`
- Source composition: 5 个桌面画板纵向拼接；单画板基准约 `1600 × 900`
- Implementation URL: `http://127.0.0.1:5174/resources?tab=people`
- Intended states: 真人素材库列表、真人认证、上传照片、创建完成、创建后列表
- Implementation screenshot: 未生成（当前 Codex Desktop 会话没有可用的内置浏览器；未擅自改用 Playwright CLI）
- Browser-rendered evidence: blocked
- Console errors checked: blocked；开发服务器编译输出无错误

## Full-view comparison evidence

- 来源图已打开并按 `1600 × 900` 画板比例拆解；确认顶部标签、220 × 280 人物卡、新增卡、全屏三步向导与左右两栏布局。
- 实现页可由本地开发服务器返回，生产构建通过；由于缺少浏览器截图，无法把实现图与来源图合并进行同视口对照。

## Focused region comparison evidence

- 来源图重点区域已检查：人物卡、创建卡、Stepper、认证方式卡、上传面板、完成状态。
- 实现截图缺失，因此字体渲染、最终像素间距、图标光学大小和真实浏览器裁切无法完成聚焦对照。

## Findings

- [P2] 缺少实现截图，最终像素一致性未验证。
  - Location: `/resources?tab=people` 及三步创建向导。
  - Evidence: 来源图可见，实现仅完成代码、类型、Lint、构建与服务响应验证。
  - Impact: 不能确认 `1600 × 900` 下的卡片首屏密度、两栏宽度和文字换行是否完全一致。
  - Fix: 使用获准浏览器分别捕获列表、Step 1、Step 2、Step 3，再与来源画板合并对比。

## Required fidelity surfaces

- Fonts and typography: 已按 12/13/14/16/18/20px 层级实现；浏览器字形与换行待截图确认。
- Spacing and layout rhythm: 列表使用 220px 卡片、24px 间距；向导以 1600 × 900 基准还原；待截图确认最终缩放。
- Colors and visual tokens: 主绿 `#03A976`、页面 `#F8F9FA`、浅青面板与灰阶已映射。
- Image quality and asset fidelity: 使用两张项目内高分辨率真人肖像；认证与流程图标使用 Ant Design 图标，不使用占位图。
- Copy and content: 已覆盖来源图中的真人素材库、认证、上传与完成文案。

## Primary interactions checked

- 标签切换与 `?tab=people` 直达状态。
- 搜索过滤、创建入口、认证方式选择、JPG/PNG 与 5MB 校验、拖拽上传、创建完成返回。
- 形象重命名、删除与工作空间隔离的本地持久化。
- TypeScript、ESLint `--quiet`、生产构建与开发服务器响应均通过。

## Comparison history

1. 从参考长图识别并排除 Figma frame 名和蓝色选中线，避免误实现为产品 UI。
2. 按首屏和三步向导拆解布局、颜色、文案与状态；完成代码实现及项目人物资产。
3. 代码验证通过；浏览器截图能力缺失，未进行像素修正迭代。

## Final result

`blocked` — 当前仍缺少同视口浏览器实现截图，无法完成来源图与实现图的最终并排视觉 QA。

---

# Design QA — 智能成片首页模型下拉

- Source visual truth: `C:\Users\admin\AppData\Local\Temp\codex-clipboard-1f1e81dd-68c5-4436-a645-484d2c106d77.png`
- Source pixels: `5104 × 2712`
- Intended implementation route: `/smart`
- Intended state: 已登录、智能成片初始页、模型下拉打开、尚未开始后续创作步骤
- Implementation screenshot: 未生成
- Browser-rendered evidence: blocked（当前 Codex Desktop 会话没有可用的内置浏览器工具；未擅自改用 Playwright CLI）
- Viewport / CSS size / density normalization: 无实现截图，无法确认
- Console errors checked: blocked；由 TypeScript、组件测试和生产构建代替代码级校验，但不等同于浏览器控制台检查

## Full-view comparison evidence

- 已打开原始参考图，确认红框位置位于输入卡片底部工具栏中，处在脚本下拉之后、发送区之前。
- 实现把唯一模型入口放在该工具栏位置；原先占据首页下方的大型模型面板以及后续创作步骤中的模型选择器均已移除。
- 缺少同视口实现截图，不能对工具栏最终换行、弹层裁切和任务管理展开态下的可用宽度做像素判断。

## Focused region comparison evidence

- 代码与组件测试覆盖模型胶囊按钮、下拉弹层、五类 operation、模型限制、不可用原因、关闭回焦和锁定状态。
- 参考图红框区域已聚焦检查；由于实现截图缺失，字体光学大小、按钮垂直居中、阴影和圆角不能完成并排对照。

## Findings

- [P2] 缺少浏览器实现截图，最终位置与弹层像素表现未验证。
  - Location: 智能成片入口工具栏的模型按钮及其下拉弹层。
  - Evidence: 来源图已打开；实现仅有代码、组件测试、类型检查和构建证据。
  - Impact: 不能确认目标桌面宽度下是否发生非预期换行，以及弹层在窄屏/任务栏展开时是否完全可见。
  - Fix: 使用获准的浏览器在同一登录态打开 `/smart`，捕获关闭与打开两种状态并和来源红框区域合并比较。

## Required fidelity surfaces

- Fonts and typography: 复用项目现有字体栈和 11–16px 层级；浏览器字形、行高与换行待截图确认。
- Spacing and layout rhythm: 入口位于比例、时长、@、脚本控件之后；按钮 44px 触控高度，弹层 520px 最大宽度并带移动端底部面板规则；最终像素间距待确认。
- Colors and visual tokens: 延续项目青绿色主色、白色卡片和浅灰边框；限制使用琥珀色语义提示。
- Image quality and asset fidelity: 本次区域无图片资产；新增图标使用项目现有 Ant Design 图标，不使用占位图或手绘 SVG。
- Copy and content: 模型名来自后端；界面仅维护 operation 类型、选择状态、使用限制和错误说明。

## Primary interactions checked

- 单个工具栏入口打开/关闭模型下拉，Escape 和关闭按钮回焦。
- 视频模式要求五类模型，图片模式要求文生图与图生图；任何必选 operation 失败、为空或配置损坏都会阻止下一步。
- 选择后展示后端限制；比例/时长不兼容时禁止提交。
- 旧草稿可在首页补齐模型，完整配置在恢复态锁定；后续步骤不再显示模型选择器。
- 浏览器鼠标、触控、真实滚动和控制台检查仍被截图工具缺失阻塞。

## Comparison history

1. 打开 `5104 × 2712` 参考图并确认模型入口目标区域与周边控件顺序。
2. 将大型模型面板收敛为工具栏下拉，补全限制、错误、锁定、响应式与无障碍状态；组件和逻辑测试通过。
3. 尝试按 Codex Desktop 内置浏览器规则进行渲染验证，但当前会话未提供对应工具，因此未进行像素修正迭代。

## Final result

blocked — 功能和代码验证已完成，但缺少同视口浏览器实现截图，不能宣称视觉 QA 通过。
