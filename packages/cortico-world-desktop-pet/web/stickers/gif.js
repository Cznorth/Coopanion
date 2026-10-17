/**
 * A GIF89a encoder for looping stickers with one-bit transparency.
 *
 * All frames share one global palette (median cut over a 15-bit colour histogram of every frame), so a
 * colour never shifts between frames. Index 0 is the transparent colour; a pixel is transparent when its
 * alpha is under half, and otherwise its colour is taken as composited over white (the sticker outline
 * is white, so the anti-aliased rim blends toward the colour it actually sits on).
 */

const key15 = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/** Composites over white and marks transparency in place: alpha becomes 0 or 255. */
export function flatten(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    if (a < .5) { rgba[i + 3] = 0; continue; }
    rgba[i] = rgba[i] * a + 255 * (1 - a);
    rgba[i + 1] = rgba[i + 1] * a + 255 * (1 - a);
    rgba[i + 2] = rgba[i + 2] * a + 255 * (1 - a);
    rgba[i + 3] = 255;
  }
  return rgba;
}

function medianCut(hist, max) {
  const entries = [];
  for (let k = 0; k < hist.length; k++) if (hist[k]) entries.push(k);
  const rgbOf = k => [((k >> 10) & 31) << 3 | 4, ((k >> 5) & 31) << 3 | 4, (k & 31) << 3 | 4];
  if (entries.length <= max) return entries.map(rgbOf);
  let boxes = [entries];
  while (boxes.length < max) {
    // split the box with the widest weighted spread
    let best = -1, bestScore = -1, bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const lo = [255, 255, 255], hi = [0, 0, 0];
      let n = 0;
      for (const k of box) { const c = rgbOf(k); for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], c[j]); hi[j] = Math.max(hi[j], c[j]); } n += hist[k]; }
      const span = hi.map((h, j) => h - lo[j]), ch = span.indexOf(Math.max(...span));
      const score = span[ch] * Math.sqrt(n);
      if (score > bestScore) { bestScore = score; best = i; bestCh = ch; }
    });
    if (best < 0) break;
    const box = boxes[best].slice().sort((a, b) => rgbOf(a)[bestCh] - rgbOf(b)[bestCh]);
    let total = 0; for (const k of box) total += hist[k];
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) { acc += hist[box[i]]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.map(box => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const k of box) { const c = rgbOf(k), w = hist[k]; r += c[0] * w; g += c[1] * w; b += c[2] * w; n += w; }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

function lzw(indices, minCode) {
  const out = [];
  let cur = 0, bits = 0;
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1;
  let dict = new Map();
  const put = code => {
    cur |= code << bits; bits += size;
    while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; }
  };
  put(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i], k = prefix * 256 + c;
    const hit = dict.get(k);
    if (hit !== undefined) { prefix = hit; continue; }
    put(prefix);
    if (next < 4096) {
      dict.set(k, next++);
      if (next > (1 << size) && size < 12) size++;
    } else {
      put(clear);
      dict = new Map(); size = minCode + 1; next = eoi + 1;
    }
    prefix = c;
  }
  put(prefix);
  put(eoi);
  if (bits > 0) out.push(cur & 255);
  return out;
}

/**
 * `frames`: flattened RGBA arrays (see `flatten`), all `width`×`height`; `delays`: centiseconds per frame.
 * Returns the file's bytes. Loops forever.
 */
export function encodeGif(width, height, frames, delays) {
  const hist = new Uint32Array(32768);
  for (const fr of frames) for (let i = 0; i < fr.length; i += 4) if (fr[i + 3]) hist[key15(fr[i], fr[i + 1], fr[i + 2])]++;
  const pal = [[0, 0, 0], ...medianCut(hist, 255)];
  while (pal.length < 256) pal.push([0, 0, 0]);
  const map = new Int16Array(32768).fill(-1);
  const nearest = k => {
    if (map[k] >= 0) return map[k];
    const r = ((k >> 10) & 31) << 3 | 4, g = ((k >> 5) & 31) << 3 | 4, b = (k & 31) << 3 | 4;
    let best = 1, bd = Infinity;
    for (let i = 1; i < pal.length; i++) {
      const dr = pal[i][0] - r, dg = pal[i][1] - g, db = pal[i][2] - b, d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (d < bd) { bd = d; best = i; }
    }
    return (map[k] = best);
  };

  const bytes = [];
  const w16 = v => bytes.push(v & 255, (v >> 8) & 255);
  const str = s => { for (const ch of s) bytes.push(ch.charCodeAt(0)); };
  str('GIF89a'); w16(width); w16(height);
  bytes.push(0xF7, 0, 0);
  for (const c of pal) bytes.push(c[0], c[1], c[2]);
  bytes.push(0x21, 0xFF, 11); str('NETSCAPE2.0'); bytes.push(3, 1, 0, 0, 0);

  frames.forEach((fr, n) => {
    // graphic control: restore to background after each frame, index 0 transparent
    bytes.push(0x21, 0xF9, 4, (2 << 2) | 1); w16(delays[n]); bytes.push(0, 0);
    bytes.push(0x2C); w16(0); w16(0); w16(width); w16(height); bytes.push(0);
    const idx = new Uint8Array(width * height);
    for (let i = 0, p = 0; p < idx.length; i += 4, p++) idx[p] = fr[i + 3] ? nearest(key15(fr[i], fr[i + 1], fr[i + 2])) : 0;
    bytes.push(8);
    const data = lzw(idx, 8);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0);
  });
  bytes.push(0x3B);
  return new Uint8Array(bytes);
}
