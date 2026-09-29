import { mimeTypeFromSignature, resolveUploadMimeType } from '@/utils/fileSignature'
import { describe, expect, it } from 'vitest'

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0))
}

function ftyp(major: string, ...compatible: string[]): Uint8Array<ArrayBuffer> {
  const size = 16 + compatible.length * 4
  return new Uint8Array([0, 0, 0, size, ...ascii('ftyp'), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii)])
}

describe('mimeTypeFromSignature', () => {
  it.each([
    ['jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xe1]), 'image/jpeg'],
    ['png', new Uint8Array([0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    ['gif', new Uint8Array(ascii('GIF89a')), 'image/gif'],
    ['webp', new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')]), 'image/webp'],
    ['avi', new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('AVI ')]), 'video/x-msvideo'],
    ['wav', new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]), 'audio/wav'],
    ['heic', ftyp('heic', 'mif1', 'heic'), 'image/heic'],
    ['heif compatible heic', ftyp('mif1', 'heic'), 'image/heic'],
    ['avif', ftyp('avif', 'mif1'), 'image/avif'],
    ['mov', ftyp('qt  ', 'qt  '), 'video/quicktime'],
    ['mp4', ftyp('isom', 'isom', 'mp41'), 'video/mp4'],
    ['m4a', ftyp('M4A ', 'isom'), 'audio/mp4'],
    ['3gp', ftyp('3gp5', 'isom'), 'video/3gpp'],
    ['webm', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84, ...ascii('webm')]), 'video/webm'],
    ['mkv', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88, ...ascii('matroska')]), 'video/x-matroska'],
    ['mp3 id3', new Uint8Array(ascii('ID3\x04')), 'audio/mpeg'],
    ['mp3 frame', new Uint8Array([0xff, 0xfb, 0x90]), 'audio/mpeg'],
    ['aac adts', new Uint8Array([0xff, 0xf1, 0x50]), 'audio/aac'],
    ['unknown', new Uint8Array(ascii('hello world')), ''],
  ])('%s', (_name, bytes, expected) => {
    expect(mimeTypeFromSignature(bytes)).toBe(expected)
  })
})

describe('resolveUploadMimeType', () => {
  it('prefers the sniffed type over the extension-based File.type', async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'photo.png', { type: 'image/png' })
    await expect(resolveUploadMimeType(file)).resolves.toBe('image/jpeg')
  })

  it('fills in an empty File.type from the signature', async () => {
    const file = new File([ftyp('heic', 'mif1')], 'IMG_0001', { type: '' })
    await expect(resolveUploadMimeType(file)).resolves.toBe('image/heic')
  })

  it('falls back to File.type when the signature is unknown', async () => {
    const file = new File(['plain'], 'note.txt', { type: 'text/plain;charset=utf-8' })
    await expect(resolveUploadMimeType(file)).resolves.toBe('text/plain')
  })

  it('falls back to octet-stream when nothing is known', async () => {
    await expect(resolveUploadMimeType(new File(['x'], 'x', { type: '' }))).resolves.toBe('application/octet-stream')
  })

  it('keeps a declared audio type for a generic MP4 container', async () => {
    const file = new File([ftyp('isom', 'isom')], 'voice.m4a', { type: 'audio/x-m4a' })
    await expect(resolveUploadMimeType(file)).resolves.toBe('audio/x-m4a')
  })
})
