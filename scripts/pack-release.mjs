import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// CRC32 implementation
const makeCrcTable = () => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
};

const crcTable = makeCrcTable();

function calculateCrc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZip(sourceDir, destZipPath) {
  const entries = [];

  function walk(currentDir, relativePath = "") {
    const items = fs.readdirSync(currentDir);
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const rel = relativePath ? `${relativePath}/${item}` : item;
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath, rel);
      } else if (stat.isFile()) {
        // Exclude secrets or temporary files
        if (item.startsWith(".env") || item.endsWith(".log")) {
          continue;
        }
        const data = fs.readFileSync(fullPath);
        const crc = calculateCrc32(data);
        const deflated = zlib.deflateRawSync(data);
        const useCompressed = deflated.length < data.length;
        entries.push({
          name: rel.replace(/\\/g, "/"),
          data: useCompressed ? deflated : data,
          size: data.length,
          compressedSize: useCompressed ? deflated.length : data.length,
          crc,
          method: useCompressed ? 8 : 0, // 8 = deflate, 0 = store
          mtime: stat.mtime,
        });
      }
    }
  }

  walk(sourceDir);

  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const d = entry.mtime;
    const dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
    const dosDate = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

    // Local file header (30 bytes + nameBuf.length)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);          // version needed (2.0)
    localHeader.writeUInt16LE(0x0800, 6);      // flags (bit 11 = UTF-8)
    localHeader.writeUInt16LE(entry.method, 8); // compression method
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(entry.crc, 14);
    localHeader.writeUInt32LE(entry.compressedSize, 18);
    localHeader.writeUInt32LE(entry.size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, entry.data);

    // Central directory header (46 bytes + nameBuf.length)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4);         // version made by
    centralHeader.writeUInt16LE(20, 6);         // version needed
    centralHeader.writeUInt16LE(0x0800, 8);     // flags (bit 11 = UTF-8)
    centralHeader.writeUInt16LE(entry.method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(entry.crc, 16);
    centralHeader.writeUInt32LE(entry.compressedSize, 20);
    centralHeader.writeUInt32LE(entry.size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(0, 38); // external file attributes
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);

    offset += localHeader.length + entry.data.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const h of centralHeaders) {
    centralDirSize += h.length;
  }

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4);          // disk number
  eocd.writeUInt16LE(0, 6);          // start disk
  eocd.writeUInt16LE(entries.length, 8); // entries on disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  const fullZip = Buffer.concat([...localHeaders, ...centralHeaders, eocd]);

  const destDir = path.dirname(destZipPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.writeFileSync(destZipPath, fullZip);
  return { entriesCount: entries.length, byteLength: fullZip.length };
}

// CLI runner
const distDir = path.resolve("dist");
const manifestPath = path.join(distDir, "manifest.json");

if (!fs.existsSync(manifestPath)) {
  console.error("Error: dist/manifest.json not found. Run 'npm run build' first.");
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const version = pkg.version || "0.1.0";

const releaseDir = path.resolve("release");
const versionedZip = path.join(releaseDir, `sahayak-v${version}.zip`);
const latestZip = path.join(releaseDir, "sahayak-extension.zip");

console.log(`Packing dist/ into ${versionedZip}...`);
const res1 = createZip(distDir, versionedZip);
fs.copyFileSync(versionedZip, latestZip);

console.log(`Successfully created release ZIP:`);
console.log(`  - ${versionedZip} (${(res1.byteLength / 1024).toFixed(1)} KB, ${res1.entriesCount} files)`);
console.log(`  - ${latestZip}`);

