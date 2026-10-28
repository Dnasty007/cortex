const bases = (process.env.CORTEX_URL || 'http://127.0.0.1:5173,http://localhost:5173')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

function args() {
  const out = { q: '', id: '', lobe: '', offset: '' }
  const list = process.argv.slice(2)
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    if (item === '--q') out.q = list[++i] || ''
    else if (item === '--id') out.id = list[++i] || ''
    else if (item === '--lobe') out.lobe = list[++i] || ''
    else if (item === '--offset') out.offset = list[++i] || ''
    else if (!item.startsWith('--') && !out.q) out.q = item
  }
  return out
}

const query = args()
const params = new URLSearchParams()
if (query.id) params.set('id', query.id)
if (query.q) params.set('q', query.q)
if (query.lobe) params.set('lobe', query.lobe)
if (query.offset) params.set('offset', query.offset)

let last = 'Cortex travel door is not open.'
for (const base of bases) {
  try {
    const response = await fetch(`${base}/api/travel?${params}`)
    const text = await response.text()
    if (!response.headers.get('content-type')?.includes('json')) {
      last = `${base} is the picture only. The travel door is not on that server.`
      continue
    }
    console.log(text)
    process.exit(response.ok ? 0 : 1)
  } catch (error) {
    last = error?.message || String(error)
  }
}
console.error(last)
process.exit(1)
