import * as fs   from 'node:fs/promises'
import * as path from 'node:path'
import { createLogger } from '@/lib/logger'

const log = createLogger('trafficTarBuilder')

const TRAFFIC_TAR_PATH = process.env.VALHALLA_TRAFFIC_TAR_PATH || '/data/traffic/live.tar'

export interface EdgeSpeed {

  edgeId:   string
  speedKmh: number
}

interface TileEntry {

  tilePath: string

  maxOffset: number

  speeds: Map<number, number>
}

const POW21 = 2097152
const POW25 = 33554432
const POW46 = 2 ** 46

function graphIdParts(idStr: string): { level: number; tileId: number; edgeOffset: number } | null {
  const id = Number(idStr)
  if (!Number.isSafeInteger(id) || id < 0) return null
  const edgeOffset = id % POW21
  const tileId     = Math.floor(id / POW21) % POW25
  const level      = Math.floor(id / POW46) % 8
  return { level, tileId, edgeOffset }
}

function tilePath(level: number, tileId: number): string {
  const s = String(tileId).padStart(9, '0')
  return `${level}/${s.slice(0, 3)}/${s.slice(3, 6)}/${s.slice(6)}.spd`
}

function buildTileBlob(entry: TileEntry): Buffer {
  const count = entry.maxOffset + 1
  const buf   = Buffer.alloc(count * 8, 0)

  for (const [offset, kmh] of entry.speeds) {
    const idx    = offset * 8
    const speed  = Math.max(1, Math.min(127, Math.round(kmh)))

    buf[idx] = 0x80 | speed
  }

  return buf
}

function buildTarHeader(filename: string, fileSize: number): Buffer {
  const hdr = Buffer.alloc(512, 0)

  hdr.write(filename.slice(0, 99), 0, 'ascii')

  hdr.write('0000644\0', 100, 'ascii')

  hdr.write('0000000\0', 108, 'ascii')
  hdr.write('0000000\0', 116, 'ascii')

  hdr.write(fileSize.toString(8).padStart(11, '0') + '\0', 124, 'ascii')

  hdr.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 'ascii')

  hdr.write('        ', 148, 'ascii')

  hdr[156] = 0x30

  hdr.write('ustar  \0', 257, 'ascii')

  let sum = 0
  for (let i = 0; i < 512; i++) sum += hdr[i]
  hdr.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')

  return hdr
}

function tarPad(dataLen: number): Buffer {
  const rem = dataLen % 512
  return rem === 0 ? Buffer.alloc(0) : Buffer.alloc(512 - rem, 0)
}

export function buildTrafficTar(edges: EdgeSpeed[]): Buffer | null {
  if (edges.length === 0) return null

  const tiles = new Map<string, TileEntry>()

  for (const { edgeId, speedKmh } of edges) {
    const parts = graphIdParts(edgeId)
    if (!parts) continue
    const { level, tileId, edgeOffset } = parts
    const tp = tilePath(level, tileId)

    let entry = tiles.get(tp)
    if (!entry) {
      entry = { tilePath: tp, maxOffset: 0, speeds: new Map() }
      tiles.set(tp, entry)
    }

    if (edgeOffset > entry.maxOffset) entry.maxOffset = edgeOffset

    entry.speeds.set(edgeOffset, speedKmh === 0 ? 1 : speedKmh)
  }

  if (tiles.size === 0) return null

  const chunks: Buffer[] = []

  for (const entry of tiles.values()) {
    const blob   = buildTileBlob(entry)
    const header = buildTarHeader(entry.tilePath, blob.length)
    chunks.push(header, blob, tarPad(blob.length))
  }

  chunks.push(Buffer.alloc(1024, 0))

  return Buffer.concat(chunks)
}

export async function writeTrafficTar(tar: Buffer): Promise<boolean> {
  try {
    const dir = path.dirname(TRAFFIC_TAR_PATH)
    await fs.mkdir(dir, { recursive: true })

    const tmp = TRAFFIC_TAR_PATH + '.tmp'
    await fs.writeFile(tmp, tar)
    await fs.rename(tmp, TRAFFIC_TAR_PATH)

    log.info('Traffic tar written', { path: TRAFFIC_TAR_PATH, bytes: tar.length })
    return true
  } catch (err) {
    log.error('Traffic tar write failed', { err: err instanceof Error ? err.message : String(err) })
    return false
  }
}
