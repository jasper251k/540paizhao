import { db, type Day, type Leg, type LegMode, type Place, type Route, type Spot } from './db'
import type { AMapNS } from './amap'

type LL = { lng: number; lat: number }

const keyOf = (p: LL) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`
const CACHE_TTL = 30 * 24 * 3600 * 1000
// 短于这个距离直接走路，不查地铁
const WALK_ONLY_M = 1000

export function distance(a: LL, b: LL) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

// 高德有每秒请求数限制，请求之间至少隔 350ms
let nextAt = 0
async function slot() {
  const now = Date.now()
  const wait = nextAt - now
  nextAt = Math.max(now, nextAt) + 350
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

const services: Partial<Record<LegMode, AMapNS>> = {}
function service(AMap: AMapNS, mode: LegMode) {
  services[mode] ??=
    mode === 'transit'
      ? new AMap.Transfer({ city: '上海', policy: AMap.TransferPolicy?.LEAST_TIME ?? 0, nightflag: false })
      : mode === 'walk'
        ? new AMap.Walking()
        : new AMap.Riding()
  return services[mode]
}

function toPath(arr: AMapNS): [number, number][] {
  return (arr ?? []).map((p: AMapNS) => (Array.isArray(p) ? [p[0], p[1]] : [p.lng ?? p.getLng(), p.lat ?? p.getLat()]))
}

function describe(seg: AMapNS): string {
  if (seg.transit_mode === 'WALK') return seg.distance > 80 ? `步行 ${fmtDist(seg.distance)}` : ''
  const t = seg.transit
  const line = t?.lines?.[0]?.name?.replace(/\(.*\)$/, '')
  if (!line || !t.on_station) return seg.instruction ?? ''
  const stops = typeof t.via_num === 'number' ? `（${t.via_num + 1} 站）` : ''
  return `${line}：${t.on_station.name} → ${t.off_station.name}${stops}`
}

async function query(AMap: AMapNS, mode: LegMode, a: LL, b: LL): Promise<Route | null> {
  await slot()
  const [status, r] = await new Promise<[string, AMapNS]>((res) =>
    service(AMap, mode).search(new AMap.LngLat(a.lng, a.lat), new AMap.LngLat(b.lng, b.lat), (s: string, r: AMapNS) =>
      res([s, r]),
    ),
  )
  if (status === 'no_data') return null
  if (status !== 'complete') throw new Error(`高德查询失败：${typeof r === 'string' ? r : (r?.info ?? status)}`)

  if (mode === 'transit') {
    const plan = r.plans?.[0]
    if (!plan) return null
    let path = toPath(plan.path)
    if (!path.length) path = plan.segments.flatMap((s: AMapNS) => toPath(s.transit?.path))
    return {
      mode,
      duration: plan.time,
      distance: plan.distance,
      path,
      steps: plan.segments.map(describe).filter(Boolean),
    }
  }
  const route = r.routes?.[0]
  if (!route) return null
  return {
    mode,
    duration: route.time,
    distance: route.distance,
    path: (route.steps ?? route.rides ?? []).flatMap((s: AMapNS) => toPath(s.path)),
    steps: [`${mode === 'walk' ? '步行' : '骑行'} ${fmtDist(route.distance)}`],
  }
}

const pick = (c: Route): Route => ({ mode: c.mode, duration: c.duration, distance: c.distance, path: c.path, steps: c.steps })

// auto：近的走路，远的地铁；ride：骑车
export async function getRoute(AMap: AMapNS, a: LL, b: LL, want: 'auto' | 'ride'): Promise<Route> {
  const key = `${want}:${keyOf(a)}>${keyOf(b)}`
  const hit = await db.legs.get(key)
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL) return pick(hit)

  const d = distance(a, b)
  const straight: [number, number][] = [
    [a.lng, a.lat],
    [b.lng, b.lat],
  ]
  let r: Route | null
  if (d < 30) r = { mode: 'walk', duration: 0, distance: 0, path: straight, steps: ['就在旁边'] }
  else if (want === 'ride') r = await query(AMap, 'ride', a, b)
  else r = (d >= WALK_ONLY_M ? await query(AMap, 'transit', a, b) : null) ?? (await query(AMap, 'walk', a, b))
  r ??= { mode: 'walk', duration: d / 1.1, distance: d, path: straight, steps: ['高德没查到路线，按直线距离估算'] }

  await db.legs.put({ ...r, key, fetchedAt: Date.now() })
  return r
}

// 排顺序只需要用时，地铁来回用时差不多，有任一方向的缓存就直接用
async function cost(AMap: AMapNS, a: LL, b: LL) {
  for (const key of [`auto:${keyOf(a)}>${keyOf(b)}`, `auto:${keyOf(b)}>${keyOf(a)}`]) {
    const hit = await db.legs.get(key)
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL) return hit.duration
  }
  return (await getRoute(AMap, a, b, 'auto')).duration
}

// c 是 n×n 用时矩阵，0 是起点、n-1 是终点，返回中间点的最优顺序
function bestOrder(c: number[][], n: number): number[] {
  const mid = Array.from({ length: n - 2 }, (_, i) => i + 1)
  const total = (o: number[]) => {
    const seq = [0, ...o, n - 1]
    let s = 0
    for (let i = 0; i < seq.length - 1; i++) s += c[seq[i]][seq[i + 1]]
    return s
  }

  if (mid.length <= 8) {
    let best = mid
    let bestCost = Infinity
    const permute = (rest: number[], acc: number[]) => {
      if (!rest.length) {
        const t = total(acc)
        if (t < bestCost) [best, bestCost] = [acc, t]
        return
      }
      rest.forEach((x, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, x]))
    }
    permute(mid, [])
    return best
  }

  // 点多时：最近邻起手，再用 2-opt 反复改进
  const left = new Set(mid)
  let o: number[] = []
  let cur = 0
  while (left.size) {
    const next = [...left].reduce((a, b) => (c[cur][a] <= c[cur][b] ? a : b))
    o.push(next)
    left.delete(next)
    cur = next
  }
  for (let improved = true; improved; ) {
    improved = false
    for (let i = 0; i < o.length - 1; i++)
      for (let j = i + 1; j < o.length; j++) {
        const cand = [...o.slice(0, i), ...o.slice(i, j + 1).reverse(), ...o.slice(j + 1)]
        if (total(cand) < total(o) - 1) {
          o = cand
          improved = true
        }
      }
  }
  return o
}

export async function planDay(
  AMap: AMapNS,
  start: Place,
  end: Place,
  spots: Spot[],
  onProgress: (done: number, total: number) => void,
): Promise<Day> {
  const pts: Place[] = [start, ...spots.map((s) => ({ name: s.name, lng: s.lng, lat: s.lat })), end]
  const n = pts.length
  const c = Array.from({ length: n }, () => Array<number>(n).fill(0))
  const pairs: [number, number][] = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (!(i === 0 && j === n - 1)) pairs.push([i, j])

  onProgress(0, pairs.length)
  for (const [k, [i, j]] of pairs.entries()) {
    c[i][j] = c[j][i] = await cost(AMap, pts[i], pts[j])
    onProgress(k + 1, pairs.length)
  }

  const order = [0, ...bestOrder(c, n), n - 1]
  const legs: Leg[] = []
  for (let k = 0; k < order.length - 1; k++) {
    const [from, to] = [pts[order[k]], pts[order[k + 1]]]
    legs.push({ ...(await getRoute(AMap, from, to, 'auto')), from, to })
  }
  return { spotIds: order.slice(1, -1).map((i) => spots[i - 1].id), start, end, legs }
}

export function navUrl(leg: Leg) {
  const mode = { transit: 'bus', walk: 'walk', ride: 'ride' }[leg.mode]
  const p = (x: Place) => `${x.lng},${x.lat},${encodeURIComponent(x.name)}`
  return `https://uri.amap.com/navigation?from=${p(leg.from)}&to=${p(leg.to)}&mode=${mode}&src=540paizhao&coordinate=gaode&callnative=1`
}

export function fmtDur(sec: number) {
  const m = Math.max(1, Math.round(sec / 60))
  if (m < 60) return `${m} 分钟`
  return `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}`
}

export function fmtDist(m: number) {
  return m < 1000 ? `${Math.round(m)} 米` : `${(m / 1000).toFixed(1)} 公里`
}

export function dayTotal(day: Day, stayMin: number) {
  return day.legs.reduce((s, l) => s + l.duration, 0) + day.spotIds.length * stayMin * 60
}
