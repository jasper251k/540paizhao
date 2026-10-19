import JSZip from 'jszip'
import { db } from './db'

// 备份 = data.json（机位、行程、设置）+ photos/ 下每张图的大图和缩略图
export async function exportBackup() {
  const zip = new JSZip()
  const [spots, trips, settings, photos] = await Promise.all([
    db.spots.toArray(),
    db.trips.toArray(),
    db.settings.toArray(),
    db.photos.toArray(),
  ])
  zip.file(
    'data.json',
    JSON.stringify({ version: 1, spots, trips, settings, photos: photos.map(({ id, spotId }) => ({ id, spotId })) }),
  )
  for (const p of photos) {
    zip.file(`photos/${p.id}.jpg`, p.full)
    zip.file(`photos/${p.id}.thumb.jpg`, p.thumb)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const d = new Date()
  const name = `540拍照备份-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.zip`
  const file = new File([blob], name, { type: 'application/zip' })

  // iPhone 上弹出分享面板，可以「存储到文件」/ iCloud
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

// 合并导入：同 id 的覆盖，其余保留
export async function importBackup(file: File) {
  const zip = await JSZip.loadAsync(file)
  const json = await zip.file('data.json')?.async('string')
  if (!json) throw new Error('不是 540拍照 的备份文件')
  const data = JSON.parse(json)
  const photos = []
  for (const { id, spotId } of data.photos ?? []) {
    const full = await zip.file(`photos/${id}.jpg`)?.async('blob')
    const thumb = await zip.file(`photos/${id}.thumb.jpg`)?.async('blob')
    if (full && thumb) photos.push({ id, spotId, full: new Blob([full], { type: 'image/jpeg' }), thumb: new Blob([thumb], { type: 'image/jpeg' }) })
  }
  await db.transaction('rw', [db.spots, db.trips, db.settings, db.photos], async () => {
    await db.photos.bulkPut(photos)
    await db.spots.bulkPut(data.spots ?? [])
    await db.trips.bulkPut(data.trips ?? [])
    // 本机已经填过 Key 就不覆盖设置
    if (!(await db.settings.get('app'))) await db.settings.bulkPut(data.settings ?? [])
  })
  return { spots: (data.spots ?? []).length, trips: (data.trips ?? []).length }
}
