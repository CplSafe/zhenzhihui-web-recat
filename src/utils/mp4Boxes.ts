/**
 * MP4（ISO BMFF）box 层的低层读取原语。
 *
 * mp4Probe（规格探测）与 mp4Demux（样本表解析）共用这一份，避免两处各写一套
 * 偏移计算——box 偏移写错是静默的，读出来的是垃圾数值而不是异常。
 *
 * 只做只读解析，不修改字节；遇到不合法长度立即停止，不对损坏文件做任何猜测。
 */

/**
 * 显式绑定到 ArrayBuffer 的字节视图。
 *
 * TS 5.7 起 Uint8Array 带缓冲区类型参数，裸 Uint8Array 会被推成「也可能是 SharedArrayBuffer」，
 * 而 BlobPart 只接受 ArrayBuffer 支撑的视图——封装成 Blob 时会在这里报错。
 */
export type Bytes = Uint8Array<ArrayBuffer>

export interface Mp4Box {
  type: string
  /** box 起始偏移（含 header）。 */
  start: number
  /** box 结束偏移（不含）。 */
  end: number
  /** box 负载起始偏移（跳过 header）。 */
  body: number
}

/**
 * 逐个读出同一层级的 box。
 *
 * size==1 表示 64 位长度（header 16 字节）；size==0 表示「一直到父级结尾」。
 * 任何越界或长度小于 header 的情况都直接中断，已解析出的部分照常返回。
 */
export function readBoxes(view: DataView, start: number, end: number): Mp4Box[] {
  const list: Mp4Box[] = []
  const limit = Math.min(end, view.byteLength)
  let cursor = Math.max(0, start)
  while (cursor + 8 <= limit) {
    let size = view.getUint32(cursor)
    const type = readFourCc(view, cursor + 4)
    let headerSize = 8
    if (size === 1) {
      // 64 位长度字段紧跟在 type 之后，读它本身也要先确认没越界
      if (cursor + 16 > limit) break
      size = Number(view.getBigUint64(cursor + 8))
      headerSize = 16
    } else if (size === 0) {
      size = limit - cursor
    }
    if (size < headerSize || cursor + size > limit) break
    list.push({ type, start: cursor, end: cursor + size, body: cursor + headerSize })
    cursor += size
  }
  return list
}

/** 在同层 box 列表中找第一个指定类型。 */
export function findBox(list: readonly Mp4Box[], type: string): Mp4Box | undefined {
  return list.find((box) => box.type === type)
}

/** 沿路径逐层向下查找，例如 findPath(view, top, ['moov', 'mvhd'])。 */
export function findPath(view: DataView, list: readonly Mp4Box[], path: readonly string[]): Mp4Box | undefined {
  let current: readonly Mp4Box[] = list
  let found: Mp4Box | undefined
  for (const type of path) {
    found = findBox(current, type)
    if (!found) return undefined
    current = readBoxes(view, found.body, found.end)
  }
  return found
}

/** 读 4 字节 fourCC。 */
export function readFourCc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

/** 把一段字节转成十六进制字符串（用于比较解码配置是否逐字节相同）。 */
export function toHex(view: DataView, start: number, end: number): string {
  let hex = ''
  for (let i = start; i < end; i += 1) hex += view.getUint8(i).toString(16).padStart(2, '0')
  return hex
}

/** FullBox 的 version 字节（body 的第 0 字节）。 */
export function readVersion(view: DataView, box: Mp4Box): number {
  return view.getUint8(box.body)
}
