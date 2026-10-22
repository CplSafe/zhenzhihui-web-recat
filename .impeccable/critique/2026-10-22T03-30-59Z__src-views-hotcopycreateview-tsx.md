---
target: 帧智汇当前首页
total_score: 20
max_score: 32
na_heuristics: 7,9
p0_count: 0
p1_count: 1
target_identity: "file:F:\\项目\\zhenzhihui-web-recat\\src\\views\\HotCopyCreateView.tsx"
target_fingerprint: "sha256:57362e00b14df9075d2c559c132570c13d5175a5acfb527450afd6a01d868cda"
target_path: "F:\\项目\\zhenzhihui-web-recat\\src\\views\\HotCopyCreateView.tsx"
timestamp: 2026-10-22T03-30-59Z
slug: src-views-hotcopycreateview-tsx
---
Method: dual-agent (A: /root/home_design_review · B: /root/home_detector)

审查对象：当前 /home 实际跳转的 /hot-copy 游客入口，src/views/HotCopyCreateView.tsx。模式 Operate。
结论：已有绿色品牌与工作台结构可保留，先完善操作引导和模板选择。已观察范围评分20/32，非完整产品验收。

截图步骤：
1. 桌面1440×1000首页：可用，顶部留白较大、制作条件说明不足。04-desktop-settled.png。
2. 手机390×844首页：无整页横向溢出，表单较长、模板在首屏下部。04-mobile-settled.png。
3. 上传来源菜单：桌面/手机均可打开，能看到本地上传/素材库。03-*-upload-action.png。
4. 教程弹窗：可打开、Esc关闭，手机桌面录屏文字过小。02-*-tutorial.png。
5. 游客收藏：点击后状态未变化；源码workspaceId=0直接返回，无登录提示。

优点：操作集中；导航分组清楚且绿色品牌一致；有原地教程和图文手册；模板真实画面能解释用途。

优先问题：
- P1：去制作禁用时未解释缺少什么。禁用合理，建议加“请先上传参考视频和至少1张产品图”，给两上传区常驻必填/要求说明，给描述字段标选填。命令clarify/onboard。
- P2：模板只有视频，没有可见标题、场景和时长，难以选型。补短标题与场景标签，再按目录规模增加少量分类；展示参考到结果的关系。命令clarify/layout。
- P2：游客收藏无反馈。点击后引导登录并保留上下文，或明确登录后收藏。命令harden。
- P2：桌面顶栏到标题近200px留白，主面板约y370开始、模板约y700开始；缩短hero上下间距。手机表单也应压缩长placeholder与空白，辅助工具降级。命令layout/adapt。
- P2：手机教程是压缩的桌面录屏，难以辨认步骤。优先简短步骤与局部截图，视频为补充。命令adapt/onboard。

无障碍风险：textarea没有显式label/aria-label，仅placeholder；收藏按钮实测24×24，建议扩大触控区至约44×44。未做完整键盘、屏幕阅读器与对比度验证，不作合规结论。

| Nielsen启发式 | 分数 | 依据 |
|---|---:|---|
| 状态可见 | 2/4 | 缺项原因与收藏反馈不足 |
| 贴近用户语言 | 2/4 | 替换素材与@职责需解释 |
| 控制与退出 | 3/4 | 教程关闭和上传菜单可用 |
| 一致性 | 3/4 | 导航/面板/窄屏重排一致 |
| 错误预防 | 3/4 | 素材不齐禁用提交 |
| 识别胜于记忆 | 2/4 | 长placeholder与模板缺标签 |
| 使用效率 | n/a | 未测登录与完整制作 |
| 简洁与层级 | 2/4 | 顶部留白与工具较多 |
| 错误恢复 | n/a | 未测真实错误 |
| 帮助与文档 | 3/4 | 教程可达，手机阅读困难 |
| 合计 | 20/32 | 已观察范围62.5% |

独立静态扫描0项命中，不能推翻浏览器观察。扫描范围HotCopyCreateView、hotcopy组件、Sidebar、Topbar等；证据detector.json。
认知负担：首次用户面对两上传、文字、模型、参数、@、教程、语音、润色、制作，需明确三步主路径。
用户视角：新手不清楚必填条件；手机用户难读桌面录屏且收藏目标偏小；熟练用户选模板需反复预览。
小项：初始空状态的“创建新视频”应降低视觉权重；费用和时间预期应在模型/素材确定后依据真实报价显示，不虚构承诺。
后续思考：首次访问者更常自带参考片，还是先找模板？需要产品数据决定两入口顺序。

证据限制：本轮为本地Chromium游客态审查，业务API为空响应模拟、视频为内置远程媒体；生产构建成功且初轮可打开，后续dist在会话外被清空，最终证据由Vite开发服务重捕获。无真实后台、登录态、费用或生成链路验证。未改产品源码。
Questions skipped: 本轮范围明确，仅审查，不追加产品决策问题。
