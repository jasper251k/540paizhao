import { Fragment, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Day, type Leg, type PartKind, type Settings, type Spot } from '../db'
import { useAMap, SHANGHAI, type AMapNS } from '../amap'
import { dayTotal, fmtDist, fmtDur, getRoute, navUrl, partsOf } from '../routing'
import { useThumbUrls } from '../photos'
import SpotViewer from '../components/SpotViewer'
import SpotEditor, { type Draft } from '../components/SpotEditor'
import Thumb from '../components/Thumb'

const LINE_COLOR = { transit: '#2f6fed', walk: '#34a853', ride: '#f29900' }
const PART_STYLE: Record<PartKind, { color: string; w: number; dashed?: boolean }> = {
  subway: { color: '#2f6fed', w: 7 },
  bus: { color: '#7b4dff', w: 6 },
  walk: { color: '#34a853', w: 5, dashed: true },
  ride: { color: '#f29900', w: 6 },
}

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
  // 默认收起列表，地图占大部分屏幕
  const [expanded, setExpanded] = useState(false)
  const [activeLeg, setActiveLeg] = useState<number | null>(null)
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AMapNS>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const overlaysRef = useRef<AMapNS[]>([])

  const day = trip?.days[dayIdx]
  const viewing = viewingId ? spots?.get(viewingId) : undefined
  const thumbs = useThumbUrls(day?.spotIds.map((id) => spots?.get(id)?.photoIds[0] ?? '').filter(Boolean) ?? [])

  useEffect(() => {
    if (!AMap || !mapEl.current || mapRef.current) return
    mapRef.current = new AMap.Map(mapEl.current, { zoom: 12, center: SHANGHAI })
    return () => {
      mapRef.current?.destroy()
      mapRef.current = null
    }
  }, [AMap])

  // 画当天路线：每一截按地铁 / 公交 / 步行 / 骑车分颜色；机位直接显示参考图和序号
  useEffect(() => {
    const map = mapRef.current
    if (!map || !day || !spots || !thumbs) return
    map.clearMap()
    const lines: AMapNS[] = []
    const marks: AMapNS[] = []
    day.legs.forEach((leg, li) => {
      for (const part of partsOf(leg)) {
        if (part.path.length < 2) continue
        const st = PART_STYLE[part.kind]
        // 白色描边垫底，线在任何底图上都看得清
        lines.push(
          new AMap.Polyline({ path: part.path, strokeColor: '#fff', strokeWeight: st.w + 4, strokeOpacity: 0.9, lineJoin: 'round', lineCap: 'round', zIndex: 50 }),
        )
        const line = new AMap.Polyline({
          path: part.path,
          strokeColor: st.color,
          strokeWeight: st.w,
          strokeOpacity: 0.95,
          strokeStyle: st.dashed ? 'dashed' : 'solid',
          strokeDasharray: st.dashed ? [8, 6] : undefined,
          lineJoin: 'round',
          lineCap: 'round',
          showDir: !st.dashed,
          zIndex: 51,
        })
        line.on('click', () => focusLeg(li))
        lines.push(line)
        // 地铁公交在上车点标出线路名
        if (part.label)
          marks.push(
            new AMap.Marker({
              position: part.path[0],
              anchor: 'bottom-left',
              offset: new AMap.Pixel(4, -4),
              content: `<div class="line-label" style="background:${st.color}">${escapeHtml(part.label)}</div>`,
              zIndex: 90,
            }),
          )
      }
    })

    const endpoint = (lng: number, lat: number, text: string) =>
      new AMap.Marker({ position: [lng, lat], anchor: 'center', content: `<div class="endpoint">${text}</div>`, zIndex: 100 })
    const same = Math.abs(day.end.lng - day.start.lng) < 1e-5 && Math.abs(day.end.lat - day.start.lat) < 1e-5
    marks.push(endpoint(day.start.lng, day.start.lat, same ? '起 / 终' : '起'))
    if (!same) marks.push(endpoint(day.end.lng, day.end.lat, '终'))

    day.spotIds.forEach((id, i) => {
      const s = spots.get(id)
      if (!s) return
      const url = thumbs.get(s.photoIds[0])
      const m = new AMap.Marker({
        position: [s.lng, s.lat],
        anchor: 'bottom-center',
        content: `<div class="photo-pin ${s.status === 'shot' ? 'pin-shot' : ''}">
          <b>${i + 1}</b>${url ? `<img src="${url}" alt="">` : `<div class="photo-pin-empty">${escapeHtml(s.name)}</div>`}
        </div>`,
        zIndex: 120 + i,
      })
      m.on('click', () => setViewingId(s.id))
      marks.push(m)
    })
    map.add([...lines, ...marks])
    overlaysRef.current = [...lines, ...marks]
    fitAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [AMap, day, spots, thumbs])

  // 留出顶栏和底部面板的位置：[上, 下, 左, 右]
  function fitAll() {
    const panel = panelRef.current?.offsetHeight ?? 0
    mapRef.current?.setFitView(overlaysRef.current, false, [110, panel + 20, 40, 40])
  }

  function focusLeg(i: number) {
    const leg = day?.legs[i]
    if (!leg || !AMap) return
    const pts = partsOf(leg).flatMap((p) => p.path)
    if (pts.length < 2) return
    const panel = panelRef.current?.offsetHeight ?? 0
    const tmp = new AMap.Polyline({ path: pts })
    mapRef.current?.setFitView([tmp], false, [110, panel + 20, 50, 50])
    setActiveLeg(i)
  }

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

      <button className="fit-btn" onClick={fitAll}>
        看全程
      </button>

      <div ref={panelRef} className={`route-panel ${expanded ? '' : 'collapsed'}`}>
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
          <div className="legend">
            <span><i style={{ background: PART_STYLE.subway.color }} />地铁</span>
            <span><i style={{ background: PART_STYLE.bus.color }} />公交</span>
            <span><i className="dashed" style={{ borderColor: PART_STYLE.walk.color }} />步行</span>
            <span><i style={{ background: PART_STYLE.ride.color }} />骑车</span>
            <span className="legend-toggle">{expanded ? '收起 ▾' : '路线详情 ▴'}</span>
          </div>
        </div>
        {!expanded && <StopStrip day={day} spots={spots} onPick={setViewingId} />}

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
                <LegRow
                  leg={leg}
                  active={activeLeg === i}
                  busy={busyLeg === i}
                  onRide={() => toggleRide(i)}
                  onShow={() => focusLeg(i)}
                />
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

// 收起时底部一排参考图，按顺序，点开看大图
function StopStrip({ day, spots, onPick }: { day: Day; spots?: Map<string, Spot>; onPick: (id: string) => void }) {
  return (
    <div className="stop-strip">
      {day.spotIds.map((id, i) => {
        const s = spots?.get(id)
        if (!s) return null
        return (
          <button key={id} className={`strip-item ${s.status === 'shot' ? 'is-shot' : ''}`} onClick={() => onPick(id)}>
            <Thumb photoId={s.photoIds[0]} className="strip-thumb" />
            <b>{i + 1}</b>
          </button>
        )
      })}
    </div>
  )
}

function LegRow({
  leg,
  active,
  busy,
  onRide,
  onShow,
}: {
  leg: Leg
  active: boolean
  busy: boolean
  onRide: () => void
  onShow: () => void
}) {
  const icon = { transit: '🚇', walk: '🚶', ride: '🚲' }[leg.mode]
  return (
    <li className={`leg ${active ? 'leg-active' : ''}`} onClick={onShow}>
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
        <div className="leg-actions" onClick={(e) => e.stopPropagation()}>
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

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function clock(min: number) {
  const m = Math.round(min) % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
