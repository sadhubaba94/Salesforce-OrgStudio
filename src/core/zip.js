/* zip.js — minimal STORED (no-compression) ZIP writer + CRC32 (MV3-CSP safe). */
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function strBytes(s) { return new TextEncoder().encode(s); }
const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
export function buildZip(entries) {
  const chunks = []; const central = []; let offset = 0;
  for (const e of entries) {
    const nameBytes = strBytes(e.name);
    const data = typeof e.data === "string" ? strBytes(e.data) : e.data;
    const crc = crc32(data); const size = data.length;
    const local = new Uint8Array([].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0)));
    chunks.push(local, nameBytes, data);
    const localLen = local.length + nameBytes.length + data.length;
    const cen = new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)));
    central.push(cen, nameBytes);
    offset += localLen;
  }
  let centralSize = 0; for (const c of central) centralSize += c.length;
  const end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralSize), u32(offset), u16(0)));
  const all = [...chunks, ...central, end];
  let total = 0; for (const a of all) total += a.length;
  const out = new Uint8Array(total); let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
export function zipToBase64(u8) { let bin = ""; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(bin); }
