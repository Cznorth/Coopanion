import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { encodeGif, flatten } from '../packages/cortico-world-desktop-pet/web/stickers/gif.js';
import { storeZip } from '../packages/cortico-world-desktop-pet/web/stickers/zip.js';

/** Reads a GIF89a back as one array of palette indices per frame and the global palette (the spec's LZW). */
function decodeGif(bytes) {
  const w = bytes[6] | (bytes[7] << 8), h = bytes[8] | (bytes[9] << 8);
  const palSize = 2 << (bytes[10] & 7);
  const pal = Array.from({ length: palSize }, (_, i) => [bytes[13 + i * 3], bytes[14 + i * 3], bytes[15 + i * 3]]);
  let p = 13 + palSize * 3;
  const frames = [];
  const delays = [];
  while (bytes[p] !== 0x3B) {
    if (bytes[p] === 0x21) {
      if (bytes[p + 1] === 0xF9) delays.push(bytes[p + 4] | (bytes[p + 5] << 8));
      p += 2;
      while (bytes[p]) p += bytes[p] + 1;
      p++;
      continue;
    }
    expect(bytes[p]).toBe(0x2C);
    p += 10;
    const min = bytes[p++];
    const data = [];
    while (bytes[p]) { data.push(...bytes.subarray(p + 1, p + 1 + bytes[p])); p += bytes[p] + 1; }
    p++;
    const clear = 1 << min, eoi = clear + 1;
    let size = min + 1, dict = [], prev = null, bit = 0;
    const out = [];
    const reset = () => { dict = Array.from({ length: clear }, (_, i) => [i]); dict.push([], []); size = min + 1; prev = null; };
    reset();
    for (;;) {
      let code = 0;
      for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      if (code === clear) { reset(); continue; }
      if (code === eoi) break;
      const entry = code < dict.length ? dict[code] : [...prev, prev[0]];
      out.push(...entry);
      if (prev) dict.push([...prev, entry[0]]);
      prev = entry;
      if (dict.length === 1 << size && size < 12) size++;
    }
    frames.push(out);
  }
  return { w, h, pal, frames, delays };
}

describe('sticker GIF', () => {
  it('decodes back to the pixels it was given: transparent where alpha is under half, colours composited over white', () => {
    const W = 37, H = 23, n = 3;
    const raw = Array.from({ length: n }, (_, k) => {
      const px = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        const x = i % W, y = (i / W) | 0;
        // stripes of a few flat colours, a soft rim and holes, different per frame
        const band = (x + y * 2 + k * 5) % 9;
        px.set(band < 3 ? [27, 22, 38, 255] : band < 6 ? [0, 168, 112, 255] : band < 8 ? [240, 86, 122, 200] : [0, 0, 0, 40], i * 4);
      }
      return px;
    });
    const frames = raw.map((px) => flatten(new Uint8ClampedArray(px)));
    const gif = decodeGif(encodeGif(W, H, frames, frames.map(() => 5)));
    expect([gif.w, gif.h, gif.frames.length]).toEqual([W, H, n]);
    expect(gif.delays).toEqual([5, 5, 5]);
    gif.frames.forEach((idx, k) => {
      expect(idx).toHaveLength(W * H);
      idx.forEach((c, i) => {
        if (raw[k][i * 4 + 3] < 128) return expect(c).toBe(0);
        expect(c).not.toBe(0);
        // the 15-bit palette keeps each channel within a quantisation step
        const want = frames[k].subarray(i * 4, i * 4 + 3);
        gif.pal[c].forEach((v, j) => expect(Math.abs(v - want[j])).toBeLessThanOrEqual(8));
      });
    });
  });

  it('keeps a frame of over 4096 codes intact across the encoder clearing its table', () => {
    const W = 200, H = 120;
    const px = new Uint8ClampedArray(W * H * 4);
    // many colours in no repeating order, so the code table fills and starts over
    for (let i = 0; i < W * H; i++) px.set([(i * 37) & 255, (i * 91 + 7) & 255, (i * 13) & 255, 255], i * 4);
    const frame = flatten(px);
    const gif = decodeGif(encodeGif(W, H, [frame], [5]));
    expect(gif.frames[0]).toHaveLength(W * H);
    expect(gif.frames[0].every((c) => c > 0)).toBe(true);
  });
});

describe('sticker zip', () => {
  it('stores each file byte for byte under its UTF-8 name', () => {
    const files = [
      { name: 'coo-hi.gif', data: new Uint8Array([71, 73, 70, 56, 57, 97, 1, 2, 3]) },
      { name: '表情/coo-晚安.gif', data: new Uint8Array(5000).map((_, i) => (i * 7) & 255) },
      { name: 'empty.txt', data: new Uint8Array(0) },
    ];
    const back = unzipSync(storeZip(files));
    expect(Object.keys(back)).toEqual(files.map((f) => f.name));
    for (const f of files) expect(back[f.name]).toEqual(f.data);
  });
});
