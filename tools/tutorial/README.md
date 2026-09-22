# 教程短片录制器

对标 CineArt「操作手册」风格：只录产品视口（无浏览器边框）、绿色高亮光标 + 点击涟漪、底部一句式大字幕、关键步骤放大、静音 1080p。UI 改版后重跑即可重出视频。

```sh
node.exe tools/tutorial/login.mjs                          # 一次性：弹出浏览器手动登录，关窗即保存登录态到 .auth/profile
node.exe tools/tutorial/recorder.mjs tools/tutorial/tours/main-smart.mjs     # 爆款成片主流程
node.exe tools/tutorial/recorder.mjs tools/tutorial/tours/main-hotcopy.mjs   # 爆款复刻主流程
node.exe tools/tutorial/recorder.mjs tools/tutorial/tours/main-canvas.mjs    # 无限画布功能全览
```

输出在 `tools/tutorial/out/<name>/<name>.mp4`，复制到 `public/tutorials/` 对应文件名（见 `src/utils/tutorialVideos.ts`）即被页面「操作手册」按钮引用。

注意
- 录制期间**不要**再用同一 `.auth/profile` 开第二个浏览器（`probe*.mjs`），会话续期会互相作废导致登出。
- tour 里 `t.cut()` 之后到下一次 `t.clip()` 之间的等待（脚本生成、AI 润色）不进成片。
- 「生成」按钮只悬停不点击，避免消耗积分；成片画面复用已出片的项目 / 画布（环境变量 `TUTORIAL_FINISHED_PROJECT` 等可改）。
- 默认对 `http://localhost:5173` 录制，`TUTORIAL_BASE_URL` 可改。
