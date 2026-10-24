import { Fragment, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Day, type Leg, type PartKind, type Settings, type Spot } from '../db'
import { useAMap, mapStyle, SHANGHAI, type AMapNS } from '../amap'
import { dayTotal, fmtDist, fmtDur, getRoute, navUrl, partsOf } from '../routing'
import { useThumbUrls } from '../photos'
import SpotViewer from '../components/SpotViewer'
import SpotEditor, { type Draft } from '../components/SpotEditor'
import Thumb from '../components/Thumb'
import TripEditor from '../components/TripEditor'
import Icon from '../components/Icon'
import Weather, { WeatherLine } from '../components/Weather'
import { addDays } from '../weather'

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
  const [editingTrip, setEditingTrip] = useState(false)
  const [busyLeg, setBusyLeg] = useState<number | null>(null)
  // 默认收起列表，地图占大部分屏幕
  const [expanded, setExpanded] = useState(false)
  const [activeLeg, setActiveLeg] = useState<number | null>(null)
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AMapNS>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const overlaysRef = useRef<AMapNS[]>([])
  // 每段路线的线和线路名标记，逐段看时用来高亮 / 变淡
  const legOverlaysRef = useRef<{ lines: AMapNS[]; labels: AMapNS[] }[]>([])
  const dotRef = useRef<AMapNS>(null)
  // 逐段看：当前第几段；null = 看全程
  const [step, setStep] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const playToken = useRef(0)
  // 地图上默认只显示序号，点一下才弹出参考图；也可以一键全部显示
  const [showPhotos, setShowPhotos] = useState(false)
  const [openSpot, setOpenSpot] = useState<string | null>(null)
  const pinState = useRef({ showPhotos, openSpot })
  pinState.current = { showPhotos, openSpot }
  const spotMarkersRef = useRef<Map<string, { m: AMapNS; s: Spot; i: number; url?: string }>>(new Map())

  const day = trip?.days[dayIdx]
  const viewing = viewingId ? spots?.get(viewingId) : undefined
  const thumbs = useThumbUrls(day?.spotIds.map((id) => spots?.get(id)?.photoIds[0] ?? '').filter(Boolean) ?? [])

  // 地图容器要等行程读出来才渲染；高德往往先加载好，所以也要等 hasDay
  const hasDay = !!day
  useEffect(() => {
    if (!AMap || !hasDay || !mapEl.current || mapRef.current) return
    mapRef.current = new AMap.Map(mapEl.current, { zoom: 12, center: SHANGHAI, mapStyle: mapStyle() })
    mapRef.current.on('click', () => setOpenSpot(null))
    return () => {
      mapRef.current?.destroy()
      mapRef.current = null
    }
  }, [AMap, hasDay])

  // 画当天路线：每一截按地铁 / 公交 / 步行 / 骑车分颜色；机位直接显示参考图和序号
  useEffect(() => {
    const map = mapRef.current
    if (!map || !day || !spots || !thumbs) return
    map.clearMap()
    const lines: AMapNS[] = []
    const marks: AMapNS[] = []
    const perLeg: { lines: AMapNS[]; labels: AMapNS[] }[] = []
    day.legs.forEach((leg, li) => {
      const own: { lines: AMapNS[]; labels: AMapNS[] } = { lines: [], labels: [] }
      perLeg.push(own)
      for (const part of partsOf(leg)) {
        if (part.path.length < 2) continue
        const st = PART_STYLE[part.kind]
        // 白色描边垫底，线在任何底图上都看得清
        const under = new AMap.Polyline({ path: part.path, strokeColor: '#fff', strokeWeight: st.w + 4, strokeOpacity: 0.9, lineJoin: 'round', lineCap: 'round', zIndex: 50 })
        under.on('click', () => focusLeg(li))
        lines.push(under)
        own.lines.push(under)
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
        own.lines.push(line)
        // 地铁公交在上车点标出线路名
        if (part.label) {
          const lab = new AMap.Marker({
            position: part.path[0],
            anchor: 'bottom-left',
            offset: new AMap.Pixel(4, -4),
            content: `<div class="line-label" style="background:${st.color}">${escapeHtml(part.label)}</div>`,
            zIndex: 90,
          })
          marks.push(lab)
          own.labels.push(lab)
        }
      }
      // 每段路中间标「1→2」，一眼看出这段是从哪到哪
      const pts = legPath(leg)
      if (pts.length > 1) {
        const n = day.spotIds.length
        const from = li === 0 ? '起' : String(li)
        const to = li === n ? '终' : String(li + 1)
        const badge = new AMap.Marker({
          position: pointAt(pts, 0.5),
          anchor: 'center',
          content: `<div class="leg-badge">${from} → ${to}</div>`,
          zIndex: 95,
        })
        badge.on('click', () => focusLeg(li))
        marks.push(badge)
        own.labels.push(badge)
      }
    })
    legOverlaysRef.current = perLeg
    dotRef.current = new AMap.Marker({ anchor: 'center', content: '<div class="flow-dot"></div>', zIndex: 200, visible: false, position: [day.start.lng, day.start.lat] })
    marks.push(dotRef.current)

    const endpoint = (lng: number, lat: number, text: string) =>
      new AMap.Marker({ position: [lng, lat], anchor: 'center', content: `<div class="endpoint">${text}</div>`, zIndex: 100 })
    const same = Math.abs(day.end.lng - day.start.lng) < 1e-5 && Math.abs(day.end.lat - day.start.lat) < 1e-5
    marks.push(endpoint(day.start.lng, day.start.lat, same ? '起 / 终' : '起'))
    if (!same) marks.push(endpoint(day.end.lng, day.end.lat, '终'))

    const spotMarkers = new Map<string, { m: AMapNS; s: Spot; i: number; url?: string }>()
    day.spotIds.forEach((id, i) => {
      const s = spots.get(id)
      if (!s) return
      const url = thumbs.get(s.photoIds[0])
      const { showPhotos, openSpot } = pinState.current
      const m = new AMap.Marker({
        position: [s.lng, s.lat],
        anchor: 'bottom-center',
        content: pinHtml(s, i, url, showPhotos || openSpot === id),
        zIndex: 120 + i,
      })
      // 收起时点一下弹出参考图，已弹出再点打开大图
      m.on('click', () => {
        const st = pinState.current
        if (st.showPhotos || st.openSpot === id) setViewingId(id)
        else setOpenSpot(id)
      })
      marks.push(m)
      spotMarkers.set(id, { m, s, i, url })
    })
    spotMarkersRef.current = spotMarkers
    map.add([...lines, ...marks])
    overlaysRef.current = [...lines, ...marks]
    fitAll()
    setStep(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [AMap, day, spots, thumbs])

  // 切换显示照片 / 点开某个机位时只改标记内容，不重画路线
  useEffect(() => {
    for (const [id, { m, s, i, url }] of spotMarkersRef.current) {
      const open = showPhotos || openSpot === id
      m.setContent(pinHtml(s, i, url, open))
      m.setzIndex(openSpot === id ? 300 : 120 + i)
    }
  }, [showPhotos, openSpot])

  // 逐段看：当前段正常显示，其他段变淡
  useEffect(() => {
    legOverlaysRef.current.forEach((o, i) => {
      const dim = step !== null && i !== step
      for (const l of o.lines) l.setOptions({ strokeOpacity: dim ? 0.15 : l.getOptions().strokeColor === '#fff' ? 0.9 : 0.95 })
      for (const m of o.labels) {
        if (dim) m.hide()
        else m.show()
      }
    })
    if (step === null) dotRef.current?.hide()
  }, [step])

  // 播放：一段一段地让小圆点沿路线走过去
  async function play() {
    if (!day) return
    const token = ++playToken.current
    setPlaying(true)
    setExpanded(false)
    for (let i = 0; i < day.legs.length; i++) {
      if (playToken.current !== token) return
      focusLeg(i)
      await sleep(600)
      const ok = await runDot(legPath(day.legs[i]), 2200, token)
      if (!ok) return
      await sleep(300)
    }
    if (playToken.current !== token) return
    setPlaying(false)
    dotRef.current?.hide()
    setStep(null)
    fitAll()
  }

  function stopPlay() {
    playToken.current++
    setPlaying(false)
  }

  function runDot(pts: [number, number][], ms: number, token: number) {
    const dot = dotRef.current
    if (!dot || pts.length < 2) return Promise.resolve(true)
    dot.show()
    const t0 = performance.now()
    return new Promise<boolean>((resolve) => {
      const tick = (now: number) => {
        if (playToken.current !== token) return resolve(false)
        const k = Math.min(1, (now - t0) / ms)
        dot.setPosition(pointAt(pts, k))
        if (k < 1) requestAnimationFrame(tick)
        else resolve(true)
      }
      requestAnimationFrame(tick)
    })
  }

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
    mapRef.current?.setFitView([tmp], false, [170, panel + 20, 50, 50])
    setActiveLeg(i)
    setStep(i)
  }

  function exitStep() {
    stopPlay()
    setStep(null)
    setActiveLeg(null)
    fitAll()
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
  if (!trip) return null
  // 编辑后天数变少，当前选中的那天可能不存在了
  if (!day) {
    if (dayIdx > 0) setDayIdx(0)
    return null
  }

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
  const dayDate = trip.date ? addDays(trip.date, dayIdx) : undefined
  // 天气看这天机位的中心
  const daySpots = day.spotIds.map((id) => spots?.get(id)).filter((s): s is Spot => !!s)
  const wx = daySpots.length ? { lng: avg(daySpots.map((s) => s.lng)), lat: avg(daySpots.map((s) => s.lat)) } : day.start

  // 在第 2 天选日期，存的是第 1 天
  const pickDate = (d: string | undefined) => db.trips.update(trip.id, { date: d && addDays(d, -dayIdx) })

  return (
    <div className="home">
      <div ref={mapEl} className="map" />
      <header className="topbar">
        <button className="btn-text" onClick={onBack}>
          <Icon name="back" size={22} />返回
        </button>
        <div className="brand">{trip.title}</div>
        <button className="btn-text" onClick={() => setEditingTrip(true)} disabled={!AMap}>
          编辑
        </button>
      </header>
      {error && <div className="toast">{error}</div>}

      {step === null ? (
        <div className="map-tools">
          <button className="fit-btn" onClick={play}>
            <Icon name="play" size={13} />
            播放路线
          </button>
          <button className="fit-btn" onClick={() => focusLeg(0)}>
            <Icon name="steps" size={15} />
            一段段看
          </button>
          <button
            className={`fit-btn ${showPhotos ? 'on' : ''}`}
            onClick={() => {
              setShowPhotos(!showPhotos)
              setOpenSpot(null)
            }}
          >
            <Icon name="photo" size={15} />
            {showPhotos ? '收起照片' : '显示照片'}
          </button>
        </div>
      ) : (
        <StepBar
          day={day}
          step={step}
          spots={spots}
          playing={playing}
          onPrev={() => {
            stopPlay()
            focusLeg(Math.max(0, step - 1))
          }}
          onNext={() => {
            stopPlay()
            focusLeg(Math.min(day.legs.length - 1, step + 1))
          }}
          onExit={exitStep}
        />
      )}

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
          {dayDate && <WeatherLine lat={wx.lat} lng={wx.lng} date={dayDate} />}
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
          <li className="trip-weather">
            <div className="tip-sub">{dayDate ? '这天的天气，点别的日期可以改' : '还没定哪天去，点一天就记下来'}</div>
            <Weather lat={wx.lat} lng={wx.lng} date={dayDate} onPick={pickDate} />
          </li>
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
          <li className="trip-delete">
            <button className="btn-text danger-text" onClick={remove}>
              删除这个行程
            </button>
          </li>
        </ol>
      </div>

      {viewing && !editing && (
        <SpotViewer spot={viewing} date={dayDate} onClose={() => setViewingId(null)} onEdit={() => setEditing({ ...viewing })} />
      )}
      {editing && <SpotEditor draft={editing} onClose={() => setEditing(null)} />}
      {editingTrip && AMap && <TripEditor AMap={AMap} trip={trip} dayIdx={dayIdx} onClose={() => setEditingTrip(false)} />}
    </div>
  )
}

// 收起时底部一排参考图，按顺序，点开看大图
// 逐段看时顶部显示：这是第几段、从哪到哪、怎么走
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

function StepBar({
  day,
  step,
  spots,
  playing,
  onPrev,
  onNext,
  onExit,
}: {
  day: Day
  step: number
  spots?: Map<string, Spot>
  playing: boolean
  onPrev: () => void
  onNext: () => void
  onExit: () => void
}) {
  const leg = day.legs[step]
  const n = day.spotIds.length
  const name = (i: number) => (i === 0 ? day.start.name : i === n + 1 ? day.end.name : (spots?.get(day.spotIds[i - 1])?.name ?? ''))
  const tag = (i: number) => (i === 0 ? '起' : i === n + 1 ? '终' : String(i))
  const icon = <span className="step-mode"><Icon name={leg.mode} size={16} /></span>
  return (
    <div className="step-bar">
      <div className="step-top">
        <span className="tip-sub">
          第 {step + 1} / {day.legs.length} 段{playing && ' · 播放中'}
        </span>
        <button className="btn-text" onClick={onExit}>
          {playing ? '停止' : '看全程'}
        </button>
      </div>
      <div className="step-route">
        <span className="step-tag">{tag(step)}</span>
        <span className="step-name">{name(step)}</span>
        <span className="step-arrow">→</span>
        <span className="step-tag">{tag(step + 1)}</span>
        <span className="step-name">{name(step + 1)}</span>
      </div>
      <div className="leg-step">
        {icon} {fmtDur(leg.duration)} · {leg.steps.join('，')}
      </div>
      <div className="step-nav">
        <button className="chip" onClick={onPrev} disabled={step === 0}>
          ‹ 上一段
        </button>
        <a className="chip" href={navUrl(leg)} target="_blank" rel="noreferrer">
          高德导航
        </a>
        <button className="chip" onClick={onNext} disabled={step === day.legs.length - 1}>
          下一段 ›
        </button>
      </div>
    </div>
  )
}

function legPath(leg: Leg): [number, number][] {
  return partsOf(leg).flatMap((p) => p.path)
}

// 沿折线走到比例 k（0~1）处的点，按经纬度近似距离算
function pointAt(pts: [number, number][], k: number): [number, number] {
  const seg: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    seg.push(d)
    total += d
  }
  let target = total * k
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const r = seg[i] ? Math.min(1, target / seg[i]) : 0
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r]
    }
    target -= seg[i]
  }
  return pts[pts.length - 1]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
  const icon = <Icon name={leg.mode} size={18} />
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
            <Icon name="nav" size={13} /> 高德导航
          </a>
          <button className={`chip ${leg.ride ? 'on' : ''}`} onClick={onRide} disabled={busy}>
            {busy ? '查询中…' : leg.ride ? '骑车中 · 改回' : '改骑车'}
          </button>
        </div>
      </div>
    </li>
  )
}

// open：带参考图的大标记；否则只是带序号的小圆标
function pinHtml(s: Spot, i: number, url: string | undefined, open: boolean) {
  const shot = s.status === 'shot' ? 'pin-shot' : ''
  if (!open) return `<div class="dot-pin ${shot}">${i + 1}</div>`
  return `<div class="photo-pin ${shot}">
    <b>${i + 1}</b>${url ? `<img src="${url}" alt="">` : `<div class="photo-pin-empty">${escapeHtml(s.name)}</div>`}
  </div>`
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function clock(min: number) {
  const m = Math.round(min) % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
