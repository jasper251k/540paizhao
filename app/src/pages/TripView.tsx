import { Fragment, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Leg, type Settings, type Spot } from '../db'
import { useAMap, SHANGHAI, type AMapNS } from '../amap'
import { dayTotal, fmtDist, fmtDur, getRoute, navUrl } from '../routing'
import SpotViewer from '../components/SpotViewer'
import SpotEditor, { type Draft } from '../components/SpotEditor'
import Thumb from '../components/Thumb'

const LINE_COLOR = { transit: '#2f6fed', walk: '#34a853', ride: '#f29900' }

export default function TripView({ settings, tripId, onBack }: { settings: Settings; tripId: string; onBack: () => void }) {
  const [AMap, error] = useAMap(settings)
  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId])
  const spots = useLiveQuery(async () => {
    const ids = trip?.days.flatMap((d) => d.spotIds) ?? []
    const list = await db.spots.bulkGet(ids)
    return new Map(list.filter((s): s is Spot => !!s).map((s) => [s.id, s]))
  }, [trip])
  const [dayIdx, setDayIdx] = useState(0)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [busyLeg, setBusyLeg] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(true)
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AMapNS>(null)

  const day = trip?.days[dayIdx]
  const viewing = viewingId ? spots?.get(viewingId) : undefined

  useEffect(() => {
    if (!AMap || !mapEl.current || mapRef.current) return
    mapRef.current = new AMap.Map(mapEl.current, { zoom: 12, center: SHANGHAI })
    return () => {
      mapRef.current?.destroy()
      mapRef.current = null
    }
  }, [AMap])

  // 画当天路线和带序号的机位
  useEffect(() => {
    const map = mapRef.current
    if (!map || !day || !spots) return
    map.clearMap()
    const overlays: AMapNS[] = []
    for (const leg of day.legs) {
      if (leg.path.length < 2) continue
      overlays.push(
        new AMap.Polyline({
          path: leg.path,
          strokeColor: LINE_COLOR[leg.mode],
          strokeWeight: 6,
          strokeOpacity: 0.85,
          strokeStyle: leg.mode === 'walk' ? 'dashed' : 'solid',
          lineJoin: 'round',
          showDir: true,
        }),
      )
    }
    const endpoint = (lng: number, lat: number, text: string) =>
      new AMap.Marker({ position: [lng, lat], anchor: 'center', content: `<div class="endpoint">${text}</div>` })
    overlays.push(endpoint(day.start.lng, day.start.lat, '起'))
    if (Math.abs(day.end.lng - day.start.lng) > 1e-5 || Math.abs(day.end.lat - day.start.lat) > 1e-5)
      overlays.push(endpoint(day.end.lng, day.end.lat, '终'))
    else overlays[overlays.length - 1].setContent('<div class="endpoint">起/终</div>')

    day.spotIds.forEach((id, i) => {
      const s = spots.get(id)
      if (!s) return
      const m = new AMap.Marker({
        position: [s.lng, s.lat],
        anchor: 'center',
        content: `<div class="num-pin ${s.status === 'shot' ? 'pin-shot' : ''}">${i + 1}</div>`,
        zIndex: 120,
      })
      m.on('click', () => setViewingId(s.id))
      overlays.push(m)
    })
    map.add(overlays)
    // 留出顶栏和底部路线面板的位置：[上, 下, 左, 右]
    map.setFitView(overlays, false, [80, Math.round(window.innerHeight * 0.5), 40, 40])
  }, [AMap, day, spots])

  async function toggleRide(i: number) {
    if (!AMap || !trip || !day) return
    const leg = day.legs[i]
    setBusyLeg(i)
    try {
      const ride = !leg.ride
      const r = await getRoute(AMap, leg.from, leg.to, ride ? 'ride' : 'auto')
      const legs = day.legs.map((l, k) => (k === i ? { ...r, from: l.from, to: l.to, ride } : l))
      await db.trips.update(trip.id, { days: trip.days.map((d, k) => (k === dayIdx ? { ...d, legs } : d)) })
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusyLeg(null)
    }
  }

  async function remove() {
    if (!trip || !confirm(`删除行程「${trip.title}」？机位会留在收藏夹里。`)) return
    await db.trips.delete(trip.id)
    onBack()
  }

  if (trip === undefined) return null
  if (!trip || !day) return null

  // 填了出发时间就粗略估算到达时间：路上用时 + 每个机位停留
  const arrive: (string | null)[] = []
  if (trip.departTime) {
    const [h, m] = trip.departTime.split(':').map(Number)
    let t = h * 60 + m
    day.legs.forEach((leg, i) => {
      t += leg.duration / 60
      arrive.push(clock(t))
      if (i < day.spotIds.length) t += settings.defaultStayMin
    })
  }
  const shotCount = day.spotIds.filter((id) => spots?.get(id)?.status === 'shot').length

  return (
    <div className="home">
      <div ref={mapEl} className="map" />
      <header className="topbar">
        <button className="btn-text" onClick={onBack}>
          ‹ 返回
        </button>
        <div className="brand">{trip.title}</div>
        <button className="btn-text danger-text" onClick={remove}>
          删除
        </button>
      </header>
      {error && <div className="toast">{error}</div>}

      <div className={`route-panel ${expanded ? '' : 'collapsed'}`}>
        <div className="route-head" onClick={() => setExpanded(!expanded)}>
          <div className="sheet-grip" />
          {trip.days.length > 1 && (
            <div className="seg seg-full" onClick={(e) => e.stopPropagation()}>
              {trip.days.map((_, i) => (
                <button key={i} className={dayIdx === i ? 'on' : ''} onClick={() => setDayIdx(i)}>
                  第 {i + 1} 天
                </button>
              ))}
            </div>
          )}
          <div className="route-summary">
            {day.spotIds.length} 个机位 · 路上 {fmtDur(day.legs.reduce((s, l) => s + l.duration, 0))} · 含拍摄约{' '}
            {fmtDur(dayTotal(day, settings.defaultStayMin))}
            {shotCount > 0 && ` · 已拍 ${shotCount}`}
          </div>
        </div>

        <ol className="route-list">
          <li className="stop">
            <span className="stop-dot endpoint-dot">起</span>
            <div className="stop-name">{day.start.name}</div>
            {trip.departTime && <span className="eta">{trip.departTime}</span>}
          </li>
          {day.legs.map((leg, i) => {
            const spot = i < day.spotIds.length ? spots?.get(day.spotIds[i]) : undefined
            return (
              <Fragment key={i}>
                <LegRow leg={leg} busy={busyLeg === i} onRide={() => toggleRide(i)} />
                {spot ? (
                  <li className={`stop ${spot.status === 'shot' ? 'is-shot' : ''}`} onClick={() => setViewingId(spot.id)}>
                    <span className="stop-dot">{i + 1}</span>
                    <Thumb photoId={spot.photoIds[0]} />
                    <div className="stop-name">
                      {spot.name}
                      {spot.tags.map((t) => (
                        <span key={t} className="tag">
                          {t}
                        </span>
                      ))}
                      {spot.status === 'shot' && <div className="tip-sub">✓ 已拍</div>}
                    </div>
                    {arrive[i] && <span className="eta">{arrive[i]}</span>}
                  </li>
                ) : (
                  <li className="stop">
                    <span className="stop-dot endpoint-dot">终</span>
                    <div className="stop-name">{day.end.name}</div>
                    {arrive[i] && <span className="eta">{arrive[i]}</span>}
                  </li>
                )}
              </Fragment>
            )
          })}
        </ol>
      </div>

      {viewing && !editing && (
        <SpotViewer spot={viewing} onClose={() => setViewingId(null)} onEdit={() => setEditing({ ...viewing })} />
      )}
      {editing && <SpotEditor draft={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function LegRow({ leg, busy, onRide }: { leg: Leg; busy: boolean; onRide: () => void }) {
  const icon = { transit: '🚇', walk: '🚶', ride: '🚲' }[leg.mode]
  return (
    <li className="leg">
      <div className="leg-line" style={{ background: LINE_COLOR[leg.mode] }} />
      <div className="leg-body">
        <div className="leg-title">
          {icon} {fmtDur(leg.duration)} <span className="tip-sub">{fmtDist(leg.distance)}</span>
        </div>
        {leg.steps.map((s, k) => (
          <div key={k} className="leg-step">
            {s}
          </div>
        ))}
        <div className="leg-actions">
          <a className="chip" href={navUrl(leg)} target="_blank" rel="noreferrer">
            高德导航
          </a>
          <button className={`chip ${leg.ride ? 'on' : ''}`} onClick={onRide} disabled={busy}>
            {busy ? '查询中…' : leg.ride ? '🚲 骑车（点击改回）' : '改骑车'}
          </button>
        </div>
      </div>
    </li>
  )
}

function clock(min: number) {
  const m = Math.round(min) % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
