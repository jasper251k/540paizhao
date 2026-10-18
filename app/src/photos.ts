import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, type Photo } from './db'

// 原图不保存：大图长边 1600 够现场对照，缩略图给地图标记和列表用
export async function makePhoto(file: Blob, spotId: string): Promise<Photo> {
  const img = await loadImg(file)
  const [full, thumb] = await Promise.all([resize(img, 1600, 0.82), resize(img, 240, 0.8)])
  return { id: newId(), spotId, full, thumb }
}

function loadImg(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

function resize(img: HTMLImageElement, maxSide: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/jpeg', quality),
  )
}

export function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return setUrl(undefined)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

// photoId → 缩略图 URL，给地图标记用（标记是 HTML 字符串，不能用组件）
export function useThumbUrls(photoIds: string[]) {
  const key = photoIds.join(',')
  const photos = useLiveQuery(() => db.photos.bulkGet(key ? key.split(',') : []), [key])
  const [urls, setUrls] = useState<Map<string, string>>()
  useEffect(() => {
    if (!photos) return
    const m = new Map<string, string>()
    for (const p of photos) if (p) m.set(p.id, URL.createObjectURL(p.thumb))
    setUrls(m)
    return () => m.forEach((u) => URL.revokeObjectURL(u))
  }, [photos])
  return urls
}
