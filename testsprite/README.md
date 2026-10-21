# TestSprite 测试计划

用 [TestSprite CLI](https://github.com/TestSprite/testsprite-cli) 在云端浏览器里跑的端到端测试，测试步骤用自然语言写在 `plans/*.plan.json` 里。

所有用例都**停在「生成 / 去制作」之前**，不会消耗帧智汇积分（TestSprite 自己的运行额度照常扣）。

| 文件                                    | 覆盖内容                                           | 优先级 |
| --------------------------------------- | -------------------------------------------------- | ------ |
| `01-canvas-copy-submenu`                | 画布右键「创建副本」有两个子选项                   | p0     |
| `02-canvas-paste-chooser`               | Ctrl+C 后在空白处 Ctrl+V 弹出二选一                | p0     |
| `03-smart-entry-mention-backspace`      | 爆款成片输入框 @图片 两步删除                      | p1     |
| `04-smart-entry-model-order`            | 视频模型列表 Framora 置顶                          | p1     |
| `05-smart-entry-toolbar-layout`         | 爆款成片工具条桌面宽度下一行排开                   | p2     |
| `06-resources-preview-autoplay`         | 我的素材预览及左右切换时视频自动播放               | p1     |
| `07-canvas-video-node-ratio`            | 新建视频节点默认 9:16                              | p0     |
| `08-canvas-image-node-param-labels`     | 图片节点参数摘要带单位（张 / P / K / 有无水印）    | p2     |

## 前提

- 测试账号要能用**密码登录**（浏览器走登录页的「密码登录」，收不到短信验证码），且不要用正式账号。
- `06` 需要测试账号的「我的素材」里至少有两条视频。
- 本地先 `npm run dev`（`http://localhost:5173`）。

## 首次配置

```bash
testsprite setup
testsprite project create --type frontend --name "帧智汇本地" --local 5173
testsprite project update <项目ID> --username <测试手机号> --password-file ./pw.txt
```

`pw.txt` 只放密码一行，**不要提交进仓库**。

把计划文件里的占位项目 ID 换成真实的（PowerShell）：

```powershell
Get-ChildItem testsprite\plans\*.json | % { (Get-Content $_ -Raw -Encoding utf8).Replace('REPLACE_WITH_PROJECT_ID', '<项目ID>') | Set-Content $_ -Encoding utf8 -NoNewline }
```

## 日常使用

```bash
# 本地校验（不联网、不扣额度）
testsprite test lint --plan-from-dir ./testsprite/plans/

# 批量创建（每个文件一个测试）
testsprite test create-batch --plan-from-dir ./testsprite/plans/

# 跑某个项目下的全部测试（会自动开隧道连到本机 5173）
testsprite test run --all --project <项目ID>

# 失败时拉取失败包（截图 / DOM / 原因推测），修完重跑
testsprite test failure get <测试ID> --out ./.testsprite/failure
testsprite test rerun <测试ID> --wait
```
