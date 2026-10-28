function crc32(bytes) {
  let crc = -1
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i]
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (~crc) >>> 0
}

function u16(value) {
  const buf = Buffer.alloc(2)
  buf.writeUInt16LE(value >>> 0)
  return buf
}

function u32(value) {
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(value >>> 0)
  return buf
}

export function lessonFileName(id) {
  const clean = String(id || 'lesson').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 80)
  return `${clean || 'lesson'}.md`
}

export function storeZip(files) {
  const parts = []
  const centrals = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(String(file.name || 'lesson.md'), 'utf8')
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data ?? ''), 'utf8')
    const crc = crc32(data)
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
    ])
    parts.push(local, data)
    centrals.push(Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]))
    offset += local.length + data.length
  }
  const central = Buffer.concat(centrals)
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
  return Buffer.concat([...parts, central, end])
}
