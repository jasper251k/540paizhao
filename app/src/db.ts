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

export type LegMode = 'transit' | 'walk' | 'ride'

// 两点之间的一段路线；path 是 [lng, lat] 点列，用来画线
export type Route = { mode: LegMode; duration: number; distance: number; path: [number, number][]; steps: string[] }
export type LegCache = Route & { key: string; fetchedAt: number }
export type Leg = Route & { from: Place; to: Place; ride?: boolean }

// legs[i] 是第 i 个点到第 i+1 个点：起点 → 机位们 → 终点
export type Day = { spotIds: string[]; start: Place; end: Place; legs: Leg[] }
export type Trip = { id: string; title: string; days: Day[]; departTime?: string; createdAt: number }

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
  trips: EntityTable<Trip, 'id'>
  legs: EntityTable<LegCache, 'key'>
}

db.version(1).stores({
  spots: 'id, status, createdAt',
  photos: 'id, spotId',
  settings: 'key',
})

db.version(2).stores({
  trips: 'id, createdAt',
  legs: 'key',
})

// crypto.randomUUID 只在 https 下可用，手机用局域网 http 调试时会缺失
export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
