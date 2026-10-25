/* =============================================================
 * 极简 PNG 编解码（零依赖，仅用内置 zlib）
 *
 * 为什么自己写：本仓是「零依赖前端」，工具链也尽量不引第三方包
 * （此前只为 docx 引过依赖，那是一次例外）。房间场景生成只需要
 * 「解码 PNG → 逐像素拼接 → 编码 PNG」三件事，用 zlib 足够。
 *
 * 支持范围（够用即止，不做通用库）：
 *   · 解码：8 位色深、非隔行、colorType 2(RGB) / 6(RGBA) / 0(灰度) / 4(灰度+α)
 *   · 编码：8 位 RGBA、非隔行
 *   · 不做：16 位、调色板、隔行、ICC/gAMA 等辅助块
 * ============================================================= */
'use strict';
const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readChunks(buf) {
  if (!buf.slice(0, 8).equals(SIG)) throw new Error('不是 PNG');
  const chunks = [];
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    chunks.push({ type, data });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

/** 解码为 { width, height, data: RGBA Buffer } */
function decode(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find(c => c.type === 'IHDR');
  if (!ihdr) throw new Error('缺 IHDR');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const depth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (depth !== 8) throw new Error('只支持 8 位色深，实际 ' + depth);
  if (interlace !== 0) throw new Error('不支持隔行');

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('不支持 colorType ' + colorType);

  const idat = Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data));
  const raw = zlib.inflateSync(idat);
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);

  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) v += paeth(a, b, c);
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 4;
      if (channels === 1) { out[d] = out[d + 1] = out[d + 2] = cur[s]; out[d + 3] = 255; }
      else if (channels === 2) { out[d] = out[d + 1] = out[d + 2] = cur[s]; out[d + 3] = cur[s + 1]; }
      else if (channels === 3) { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = 255; }
      else { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = cur[s + 3]; }
    }
    prev = cur;
  }
  return { width, height, data: out };
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 编码 RGBA { width, height, data } → PNG Buffer */
function encode(img) {
  const { width, height, data } = img;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                    /* filter: none */
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIG, chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function blank(w, h) {
  return { width: w, height: h, data: Buffer.alloc(w * h * 4) };
}

/** 把 src 叠到 dst 的 (dx,dy) 处，alpha 混合 */
function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4, d = (ty * dst.width + tx) * 4;
      const a = src.data[s + 3] / 255;
      if (a === 0) continue;
      if (a >= 1) {
        dst.data[d] = src.data[s]; dst.data[d + 1] = src.data[s + 1];
        dst.data[d + 2] = src.data[s + 2]; dst.data[d + 3] = 255;
      } else {
        for (let k = 0; k < 3; k++) {
          dst.data[d + k] = Math.round(src.data[s + k] * a + dst.data[d + k] * (1 - a));
        }
        dst.data[d + 3] = Math.min(255, Math.round(src.data[s + 3] + dst.data[d + 3] * (1 - a)));
      }
    }
  }
}

module.exports = { decode, encode, blank, blit };