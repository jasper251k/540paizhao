import Dexie, { type EntityTable } from 'dexie'

export type Place = { name: string; lng: number; lat: number }

export type Spot = {
  id: string
  name: string
  address?: string
  lng: number
  lat: number
  photoIds: string[]
  note?: string
  tags: string[]
  status: 'todo' | 'shot'
  shotAt: number[]
  createdAt: number
}

export type Photo = { id: string; spotId: string; full: Blob; thumb: Blob }

export type Settings = {
  key: 'app'
  amapKey: string
  amapSecurityCode: string
  home?: Place
  lastStart?: Place
  defaultStayMin: number
}

export const db = new Dexie('540paizhao') as Dexie & {
  spots: EntityTable<Spot, 'id'>
  photos: EntityTable<Photo, 'id'>
  settings: EntityTable<Settings, 'key'>
}

db.version(1).stores({
  spots: 'id, status, createdAt',
  photos: 'id, spotId',
  settings: 'key',
})

// crypto.randomUUID 只在 https 下可用，手机用局域网 http 调试时会缺失
export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
