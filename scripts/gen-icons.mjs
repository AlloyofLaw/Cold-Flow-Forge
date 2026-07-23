// Dependency-free PNG icon generator for Lift Log.
// Draws a simple barbell mark on a dark background. Produces 192, 512 (any) and
// 512 maskable (extra safe-zone padding) PNGs into /public.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public');
mkdirSync(outDir, { recursive: true });

const BG = [15, 17, 21];       // near-black
const PLATE = [34, 211, 138];  // accent green
const BAR = [148, 163, 184];   // steel grey

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function makePng(size, safeZone) {
  // safeZone: fraction of padding for maskable icons (0 = fill, 0.1 = 10% inset)
  const inset = Math.floor(size * safeZone);
  const w = size, h = size;
  const px = (x, y) => {
    // background
    let color = BG;
    const cx = w / 2, cy = h / 2;
    const usable = size - inset * 2;
    // barbell geometry relative to usable area
    const barHalf = usable * 0.34;   // half length of bar
    const barThick = usable * 0.055;
    const plateW = usable * 0.06;
    const innerPlateH = usable * 0.30;
    const outerPlateH = usable * 0.20;
    const dx = x - cx, dy = y - cy;
    // bar
    if (Math.abs(dx) <= barHalf && Math.abs(dy) <= barThick) color = BAR;
    // inner plates
    const innerX = barHalf * 0.72;
    if (Math.abs(Math.abs(dx) - innerX) <= plateW && Math.abs(dy) <= innerPlateH) color = PLATE;
    // outer plates
    const outerX = barHalf * 0.92;
    if (Math.abs(Math.abs(dx) - outerX) <= plateW && Math.abs(dy) <= outerPlateH) color = PLATE;
    return color;
  };

  const rowBytes = w * 4 + 1;
  const raw = Buffer.alloc(rowBytes * h);
  for (let y = 0; y < h; y++) {
    raw[y * rowBytes] = 0; // filter type 0
    for (let x = 0; x < w; x++) {
      const c = px(x, y);
      const o = y * rowBytes + 1 + x * 4;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(outDir, 'icon-192.png'), makePng(192, 0));
writeFileSync(join(outDir, 'icon-512.png'), makePng(512, 0));
writeFileSync(join(outDir, 'icon-maskable-512.png'), makePng(512, 0.12));
writeFileSync(join(outDir, 'apple-touch-icon.png'), makePng(180, 0.06));

// Simple favicon SVG
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0f1115"/><rect x="10" y="29" width="44" height="6" rx="3" fill="#94a3b8"/><rect x="18" y="22" width="6" height="20" rx="2" fill="#22d38a"/><rect x="40" y="22" width="6" height="20" rx="2" fill="#22d38a"/><rect x="12" y="26" width="5" height="12" rx="2" fill="#22d38a"/><rect x="47" y="26" width="5" height="12" rx="2" fill="#22d38a"/></svg>`;
writeFileSync(join(outDir, 'favicon.svg'), favicon);

console.log('Icons generated in', outDir);
