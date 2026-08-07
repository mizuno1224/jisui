// PWA 用アイコンを生成する。画像ライブラリを足さずに済むよう PNG を直接書き出す。
//   node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BG = [5, 150, 105]; // emerald-600
const FG = [255, 255, 255];

// ---- PNG エンコード -------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: None
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- 描画 -----------------------------------------------------------------

const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** 境界を 1.2px ぶんぼかして、輪郭のギザつきを消す。 */
const coverage = (dist) => clamp01(0.5 - dist / 1.2);

function roundedRectDist(x, y, size, radius) {
  const cx = Math.abs(x - size / 2) - (size / 2 - radius);
  const cy = Math.abs(y - size / 2) - (size / 2 - radius);
  const dx = Math.max(cx, 0);
  const dy = Math.max(cy, 0);
  return Math.min(Math.max(cx, cy), 0) + Math.hypot(dx, dy) - radius;
}

function segmentDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = clamp01(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** チェックマーク(買い物リストの「チェックできる」を一目で表す)。 */
function checkDist(x, y, size, scale) {
  const s = (v) => size / 2 + (v - 0.5) * size * scale;
  const p = [
    [s(0.24), s(0.52)],
    [s(0.43), s(0.71)],
    [s(0.78), s(0.31)],
  ];
  return Math.min(
    segmentDist(x, y, p[0][0], p[0][1], p[1][0], p[1][1]),
    segmentDist(x, y, p[1][0], p[1][1], p[2][0], p[2][1]),
  );
}

function draw(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : size * 0.22;
  const scale = maskable ? 0.62 : 0.92; // maskable は中央 80% に収める
  const stroke = size * (maskable ? 0.055 : 0.08);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const bgA = coverage(roundedRectDist(px, py, size, radius));
      const fgA = coverage(checkDist(px, py, size, scale) - stroke);

      const alpha = clamp01(bgA);
      const mix = clamp01(fgA) * alpha;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BG[c] * (1 - mix) + FG[c] * mix);
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, rgba);
}

const targets = [
  { path: "public/icons/icon-192.png", size: 192, maskable: false },
  { path: "public/icons/icon-512.png", size: 512, maskable: false },
  { path: "public/icons/maskable-512.png", size: 512, maskable: true },
  { path: "app/icon.png", size: 192, maskable: false },
  { path: "app/apple-icon.png", size: 180, maskable: true }, // iOS は角を自分で丸める
];

for (const t of targets) {
  const out = join(ROOT, t.path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, draw(t.size, { maskable: t.maskable }));
  console.log(`generated ${t.path} (${t.size}px)`);
}
