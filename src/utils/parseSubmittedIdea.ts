/** 解析当前申请表单写入的创意正文；旧格式按原文显示。 */
export function parseSubmittedIdea(content: string) {
  const text = content || ''
  const header = /^剧名：([^\n]*)\n\n题材：([^\n]*)\n\n/.exec(text)
  if (!header) return null
  const remaining = text.slice(header[0].length)
  const plotMarker = '\n\n第一集剧本剧情：\n'
  const castMarker = '\n\n人物、身份、性格：\n'
  const plotAt = remaining.indexOf(plotMarker)
  const castAt = remaining.indexOf(castMarker)
  if (plotAt !== -1 && castAt !== -1 && castAt < plotAt) return null
  const synopsisEnd = plotAt !== -1 ? plotAt : castAt !== -1 ? castAt : remaining.length
  const plotEnd = castAt !== -1 ? castAt : remaining.length
  return {
    title: header[1].trim(),
    genre: header[2].trim(),
    synopsis: remaining.slice(0, synopsisEnd),
    plot: plotAt === -1 ? '' : remaining.slice(plotAt + plotMarker.length, plotEnd),
    characters: castAt === -1 ? '' : remaining.slice(castAt + castMarker.length),
  }
}
