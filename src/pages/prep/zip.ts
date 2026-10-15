// A zip writer for Export N changed: one download instead of one per Round package.
// Entries are STORED, not compressed: Round packages are mostly base64 assets, which barely
// compress, and a stored zip opens everywhere. Names must be ASCII, as slugified file names are.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  modified: Date;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

/** The CRC-32 a zip records for each entry. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The MS-DOS time and date fields, in local time as zip tools expect. */
const dosTime = (date: Date) => (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
const dosDate = (date: Date) =>
  (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

/** A zip archive of the entries, in order, at its root. */
export function zip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const files = entries.map((entry) => ({ ...entry, nameBytes: encoder.encode(entry.name), crc: crc32(entry.data) }));
  const localSize = files.reduce((sum, file) => sum + 30 + file.nameBytes.length + file.data.length, 0);
  const centralSize = files.reduce((sum, file) => sum + 46 + file.nameBytes.length, 0);
  const bytes = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(bytes.buffer);
  let at = 0;
  const u16 = (value: number) => (view.setUint16(at, value, true), (at += 2));
  const u32 = (value: number) => (view.setUint32(at, value, true), (at += 4));
  const put = (data: Uint8Array) => (bytes.set(data, at), (at += data.length));
  // What the local header and the central directory both record: version needed 1.0, no flags,
  // STORED, the time, the CRC, both sizes (the same, uncompressed) and the name's length.
  const sharedFields = (file: (typeof files)[number]) => {
    u16(10);
    u16(0);
    u16(0);
    u16(dosTime(file.modified));
    u16(dosDate(file.modified));
    u32(file.crc);
    u32(file.data.length);
    u32(file.data.length);
    u16(file.nameBytes.length);
  };

  const offsets = files.map((file) => {
    const offset = at;
    u32(0x04034b50);
    sharedFields(file);
    u16(0); // extra field length
    put(file.nameBytes);
    put(file.data);
    return offset;
  });

  files.forEach((file, i) => {
    u32(0x02014b50);
    u16(20); // made by: MS-DOS, zip 2.0
    sharedFields(file);
    u16(0); // extra field length
    u16(0); // comment length
    u16(0); // disk number
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]!);
    put(file.nameBytes);
  });

  u32(0x06054b50);
  u16(0); // this disk
  u16(0); // the disk the central directory starts on
  u16(files.length);
  u16(files.length);
  u32(centralSize);
  u32(localSize);
  u16(0); // comment length
  return bytes;
}
