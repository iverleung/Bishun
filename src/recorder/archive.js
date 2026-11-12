const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function checksum(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function header(size, values) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  values.forEach(([offset, width, value]) => {
    if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
  });
  return bytes;
}

function dosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function audioExtension(mimeType) {
  if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'm4a';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

export function recordingFileName(reading, position, mimeType) {
  const safeReading = reading.normalize('NFC').replace(/[\\/:*?"<>|]/g, '_');
  return `${String(position).padStart(4, '0')}_${safeReading}.${audioExtension(mimeType)}`;
}

export async function createZip(files, now = new Date()) {
  if (files.length > 65535) throw new Error('录音数量过多，请分批导出');
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosDateTime(now);

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : new Uint8Array(await file.data.arrayBuffer());
    if (data.byteLength > 0xffffffff || offset > 0xffffffff) throw new Error('录音文件过大，无法导出 ZIP');
    const crc = checksum(data);
    const local = header(30, [
      [0, 4, 0x04034b50], [4, 2, 20], [6, 2, 0x0800], [8, 2, 0],
      [10, 2, time], [12, 2, date], [14, 4, crc], [18, 4, data.byteLength],
      [22, 4, data.byteLength], [26, 2, name.byteLength], [28, 2, 0],
    ]);
    localParts.push(local, name, data);
    centralParts.push(header(46, [
      [0, 4, 0x02014b50], [4, 2, 20], [6, 2, 20], [8, 2, 0x0800], [10, 2, 0],
      [12, 2, time], [14, 2, date], [16, 4, crc], [20, 4, data.byteLength],
      [24, 4, data.byteLength], [28, 2, name.byteLength], [30, 2, 0], [32, 2, 0],
      [34, 2, 0], [36, 2, 0], [38, 4, 0], [42, 4, offset],
    ]), name);
    offset += local.byteLength + name.byteLength + data.byteLength;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0);
  const end = header(22, [
    [0, 4, 0x06054b50], [4, 2, 0], [6, 2, 0], [8, 2, files.length], [10, 2, files.length],
    [12, 4, centralSize], [16, 4, offset], [20, 2, 0],
  ]);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}
