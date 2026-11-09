// 画 VR 指针圆点的贴图到 resources/vr/pointer.png：白色实心圆加主色描边，边缘抗锯齿。
// 用法：node scripts/gen-pointer.ts

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZE = 128;                        // 贴图边长(像素)
const RING = 12;                         // 描边宽度(像素)
const FILL = [255, 255, 255] as const;   // 填充色(RGB)
const EDGE = [79, 91, 213] as const;     // 描边色 #4f5bd5

// 画出 SIZE×SIZE 的 RGBA 像素
function draw(): Buffer {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  const c = (SIZE - 1) / 2;
  const outer = SIZE / 2 - 1;
  const inner = outer - RING;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - c, y - c);
      const alpha = Math.min(1, Math.max(0, outer - d + 0.5));
      // 描边和填充之间过渡 1 像素
      const t = Math.min(1, Math.max(0, d - inner + 0.5));
      const i = (y * SIZE + x) * 4;
      for (let k = 0; k < 3; k++) rgba[i + k] = Math.round((FILL[k] ?? 0) * (1 - t) + (EDGE[k] ?? 0) * t);
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

// CRC32(PNG 块校验)
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = (CRC[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 一个 PNG 块：长度、类型、数据、校验
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// RGBA → PNG(8 位，每行前加过滤类型 0)
function png(rgba: Buffer, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);   // 位深 8、颜色类型 6(RGBA)，压缩、过滤、隔行都是 0
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.resolve(import.meta.dirname, '..', 'resources', 'vr', 'pointer.png');
fs.writeFileSync(out, png(draw(), SIZE, SIZE));
console.log(`已生成 ${out}`);
