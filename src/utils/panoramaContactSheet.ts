/** Export local panorama captures as a bounded, lossless PNG contact sheet. */
export function panoramaGridColumns(count: number): number {
  return count <= 4 ? Math.min(2, count) : 4
}

export async function panoramaContactSheet(blobs: Blob[]): Promise<Blob> {
  if (!blobs.length) throw new Error('请先选择截图')
  const images: ImageBitmap[] = []
  try {
    for (const blob of blobs) images.push(await createImageBitmap(blob))
    const columns = panoramaGridColumns(images.length)
    const rows = Math.ceil(images.length / columns)
    const aspect = images[0].width / images[0].height
    const cellWidth = Math.max(1, Math.floor(Math.min(images[0].width, 4096 / columns, (4096 / rows) * aspect)))
    const cellHeight = Math.max(1, Math.floor(cellWidth / aspect))
    const canvas = document.createElement('canvas')
    canvas.width = columns * cellWidth
    canvas.height = rows * cellHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前设备无法拼接图片')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    images.forEach((image, index) => {
      const scale = Math.min(cellWidth / image.width, cellHeight / image.height)
      const width = image.width * scale
      const height = image.height * scale
      context.drawImage(
        image,
        (index % columns) * cellWidth + (cellWidth - width) / 2,
        Math.floor(index / columns) * cellHeight + (cellHeight - height) / 2,
        width,
        height,
      )
    })
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('拼接导出失败，请重试'))), 'image/png'),
    )
  } finally {
    images.forEach((image) => image.close())
  }
}
