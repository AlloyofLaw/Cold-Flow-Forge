// Generates the PWA icon set as PNGs with zero native deps (pure Node zlib).
// Dark "villain" aesthetic: near-black field, single crimson accent forming a
// stylized "vs" crosshair — Andrew vs Drew. Run: npm run gen:icons
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'public', 'icons')
mkdirSync(OUT, { recursive: true })

const BG = [10, 10, 11, 255] // #0a0a0b
const ACCENT = [225, 29, 72, 255] // #e11d48 crimson
const ACCENT_DIM = [80, 14, 30, 255]

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(size, draw) {
  const px = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rgba = draw(x, y, size)
      const o = (y * size + x) * 4
      px[o] = rgba[0]
      px[o + 1] = rgba[1]
      px[o + 2] = rgba[2]
      px[o + 3] = rgba[3]
    }
  }
  // add filter byte (0) per scanline
  const raw = Buffer.alloc(size * size * 4 + size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Draws a bold "V" chevron (the confrontation crosshair) centred in the icon.
function makeDraw(padding) {
  return (x, y, size) => {
    const s = size
    const nx = (x - s / 2) / (s / 2) // -1..1
    const ny = (y - s / 2) / (s / 2)
    const r = Math.sqrt(nx * nx + ny * ny)
    const inset = padding

    // outer ring (crosshair)
    if (r > 0.62 - inset && r < 0.72 - inset) return ACCENT
    if (r > 0.72 - inset && r < 0.78 - inset) return ACCENT_DIM

    // Chevron "V": two diagonal strokes meeting at the bottom-centre.
    const cx = x - s / 2
    const cy = y - s / 2
    const half = (s / 2) * (0.5 - inset)
    const thick = s * 0.09
    // left stroke y = -x  (from top-left to centre-bottom), right stroke y = x
    const onLeft = Math.abs(cy - -cx) < thick && cx < 0 && cy > -half && cy < half
    const onRight = Math.abs(cy - cx) < thick && cx > 0 && cy > -half && cy < half
    if (onLeft || onRight) return ACCENT

    return BG
  }
}

const sizes = [
  ['icon-192.png', 192, 0.06],
  ['icon-512.png', 512, 0.06],
  // maskable icons keep the mark well inside the safe zone (more padding)
  ['icon-192-maskable.png', 192, 0.14],
  ['icon-512-maskable.png', 512, 0.14],
]

for (const [name, size, pad] of sizes) {
  writeFileSync(join(OUT, name), encodePng(size, makeDraw(pad)))
  console.log('wrote', name)
}

// apple-touch-icon lives at public root, 180px, no transparency padding.
writeFileSync(
  join(__dirname, '..', 'public', 'apple-touch-icon.png'),
  encodePng(180, makeDraw(0.06)),
)
console.log('wrote apple-touch-icon.png')
