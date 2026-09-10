/**
 * 视频生成提示词的通用防线。
 *
 * 视频模型没有「贴字幕」的能力：提示词里出现要显示的文字，模型只会把它画进
 * 画面像素，中文必然渲染成乱码（Framora 1.0 实测，其余模型同样中招）。
 * 所有向视频模型下发提示词的链路（整片生成 / video.edit 修改 / 爆款复刻
 * video.replicate）都必须带上这条硬约束，不要各自再写一份文案。
 */

/** 禁止画面出现文字的统一硬约束（场景实物自带文字除外）。 */
export const NO_ONSCREEN_TEXT_REQUIREMENT =
  '画面中不得出现任何文字、字幕、标题、标语、水印或字符(场景实物本身自带的文字除外)。'

/** 在提示词末尾追加禁文字约束；空提示原样返回，避免只发一条约束当正文。 */
export function withNoOnscreenTextGuard(prompt: string): string {
  const text = String(prompt || '').trim()
  if (!text) return text
  if (text.includes(NO_ONSCREEN_TEXT_REQUIREMENT)) return text
  return `${text}\n${NO_ONSCREEN_TEXT_REQUIREMENT}`
}
