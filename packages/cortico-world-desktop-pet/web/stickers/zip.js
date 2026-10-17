/**
 * A zip writer for files that are already compressed (the stickers' GIFs): every entry is stored as is,
 * names in UTF-8.
 */

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** `files`: [{ name, data: Uint8Array }]. Returns the archive's bytes. */
export function storeZip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nm = enc.encode(name), crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    // version 2.0, UTF-8 names (flag bit 11), stored, no date
    head.setUint32(0, 0x04034B50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
    head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true);
    head.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(head.buffer), nm, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014B50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true); dir.setUint32(20, data.length, true); dir.setUint32(24, data.length, true);
    dir.setUint16(28, nm.length, true); dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nm);
    offset += 30 + nm.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}
