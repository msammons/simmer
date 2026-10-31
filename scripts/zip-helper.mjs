// Packs the Chrome helper (extension-working/) into public/simmer-helper.zip before every build, so Simmer always offers the
// helper that matches it (Simmer says when the computer's copy is older). The zip holds one folder, "Simmer".
import { readdir, readFile, writeFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";

const dir = new URL("../extension-working/", import.meta.url);
const names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile() && !d.name.startsWith(".")).map((d) => d.name).sort();

const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

const local = [], central = [];
let offset = 0;
for (const name of names) {
  const data = await readFile(new URL(name, dir));
  const packed = deflateRawSync(data);
  const path = Buffer.from(`Simmer/${name}`);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8);
  head.writeUInt16LE(0x21, 12); // a fixed date (1980-01-01), so the zip only changes when the helper does
  head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(path.length, 26);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(0x21, 14); entry.writeUInt32LE(crc32(data), 16); entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(path.length, 28); entry.writeUInt32LE(offset, 42);
  local.push(head, path, packed);
  central.push(entry, path);
  offset += head.length + path.length + packed.length;
}
const size = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
await writeFile(new URL("../public/simmer-helper.zip", import.meta.url), Buffer.concat([...local, ...central, end]));
console.log(`simmer-helper.zip: ${names.length} files`);
