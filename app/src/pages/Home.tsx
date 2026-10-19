import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Settings, type Spot } from '../db'
import { loadAMap, mapStyle, SHANGHAI, type AMapNS } from '../amap'
import PlaceSearch, { type PickedPlace } from '../components/PlaceSearch'
import SpotEditor, { type Draft } from '../components/SpotEditor'
import SpotViewer from '../components/SpotViewer'
import { useBlobUrl } from '../photos'
import Icon from '../components/Icon'

type Mode = 'browse' | 'pick'

export default function Home({
  settings,
  onOpenSettings,
  onOpenTrips,
  onImport,
}: {
  settings: Settings
  onOpenSettings: () => void
  onOpenTrips: () => void
  onImport: () => void
}) {
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AMapNS>(null)
  const markersRef = useRef<Map<string, AMapNS>>(new Map())
  const [AMap, setAMap] = useState<AMapNS>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<Mode>('browse')
  const [view, setView] = useState<'map' | 'list'>('map')
  const [filter, setFilter] = useState<'todo' | 'shot' | 'all'>('todo')
  const [editing, setEditing] = useState<Draft | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)
  // 选点模式下搜索选中的地名，确认时直接用，不再逆地理
  const pickedRef = useRef<PickedPlace | null>(null)
  // 地图上默认只显示小标记，点一下弹出参考图；也可以一键全部显示
  const [showPhotos, setShowPhotos] = useState(false)
  const [openSpot, setOpenSpot] = useState<string | null>(null)
  const pinState = useRef({ showPhotos, openSpot })
  pinState.current = { showPhotos, openSpot }
  const modeRef = useRef(mode)
  modeRef.current = mode

  const spots = useLiveQuery(() => db.spots.orderBy('createdAt').reverse().toArray(), [])
  // 每个机位的封面缩略图（第一张参考图）
  const covers = useLiveQuery(async () => {
    const ids = (spots ?? []).map((s) => s.photoIds[0]).filter(Boolean)
    const ps = await db.photos.bulkGet(ids)
    return new Map(ps.filter((p) => !!p).map((p) => [p!.id, p!.thumb]))
  }, [spots])
  const coverUrls = useRef<Map<string, string>>(new Map())
  const viewing = spots?.find((s) => s.id === viewingId)

  useEffect(() => {
    loadAMap(settings.amapKey, settings.amapSecurityCode).then(setAMap, (e) => setError(e.message))
  }, [settings.amapKey, settings.amapSecurityCode])

  // 初始化地图
  useEffect(() => {
    if (!AMap || !mapEl.current || mapRef.current) return
    const map = new AMap.Map(mapEl.current, { zoom: 12, center: SHANGHAI, resizeEnable: true, mapStyle: mapStyle() })
    map.addControl(new AMap.Scale())
    mapRef.current = map

    // 长按地图直接在该处新建机位
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => clearTimeout(timer)
    map.on('touchstart', (e: AMapNS) => {
      cancel()
      if (modeRef.current !== 'browse') return
      const ll = e.lnglat
      timer = setTimeout(() => startDraftAt(ll.lng, ll.lat), 600)
    })
    map.on('touchmove', cancel)
    map.on('touchend', cancel)
    map.on('dragstart', cancel)
    map.on('zoomstart', cancel)
    // 电脑上右键代替长按
    map.on('click', () => setOpenSpot(null))
    map.on('rightclick', (e: AMapNS) => modeRef.current === 'browse' && startDraftAt(e.lnglat.lng, e.lnglat.lat))
    return () => {
      map.destroy()
      mapRef.current = null
      markersRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [AMap])

  // 同步机位标记
  useEffect(() => {
    const map = mapRef.current
    if (!map || !spots || !covers) return
    const markers = markersRef.current
    // 缩略图 URL 按 photoId 复用，不再用到的释放
    const urls = coverUrls.current
    for (const [pid, u] of urls) {
      if (!covers.has(pid)) {
        URL.revokeObjectURL(u)
        urls.delete(pid)
      }
    }
    for (const [pid, b] of covers) if (!urls.has(pid)) urls.set(pid, URL.createObjectURL(b))
    const ids = new Set(spots.map((s) => s.id))
    for (const [id, m] of markers) {
      if (!ids.has(id)) {
        map.remove(m)
        markers.delete(id)
      }
    }
    for (const s of spots) {
      const url = urls.get(s.photoIds[0])
      const open = showPhotos || openSpot === s.id
      const shot = s.status === 'shot' ? 'pin-shot' : ''
      const content = open
        ? `<div class="pin ${shot}">${url ? `<img src="${url}" alt="">` : ''}<span>${escapeHtml(s.name)}</span></div>`
        : `<div class="pin ${shot}"><span>${escapeHtml(s.name)}</span></div>`
      // 收起时点一下弹出参考图，已弹出再点打开详情
      const onClick = () => {
        const st = pinState.current
        if (st.showPhotos || st.openSpot === s.id) setViewingId(s.id)
        else setOpenSpot(s.id)
      }
      let m = markers.get(s.id)
      if (!m) {
        m = new AMap.Marker({ position: [s.lng, s.lat], anchor: 'bottom-center', content })
        map.add(m)
        markers.set(s.id, m)
      } else {
        m.setPosition([s.lng, s.lat])
        m.setContent(content)
        m.off('click')
      }
      m.on('click', onClick)
      m.setzIndex(openSpot === s.id ? 300 : 100)
    }
  }, [AMap, spots, covers, showPhotos, openSpot])

  function startDraftAt(lng: number, lat: number, place?: PickedPlace) {
    const draft: Draft = { name: place?.name ?? '', address: place?.address, lng, lat, tags: [], status: 'todo' }
    setMode('browse')
    setEditing(draft)
    if (place) return
    // 没有地名时用逆地理补一个，用户可以改
    new AMap.Geocoder({ city: '上海' }).getAddress([lng, lat], (status: string, result: AMapNS) => {
      if (status !== 'complete') return
      const r = result.regeocode
      const poi = r.pois?.[0]?.name || r.addressComponent?.township || ''
      setEditing((d) => (d && d.lng === lng && d.lat === lat && !d.name ? { ...d, name: poi, address: r.formattedAddress } : d))
    })
  }

  function confirmPick() {
    const c = mapRef.current.getCenter()
    const p = pickedRef.current
    pickedRef.current = null
    // 搜索选中后用户又拖了地图，就以中心点为准
    if (p && Math.abs(p.lng - c.lng) < 1e-5 && Math.abs(p.lat - c.lat) < 1e-5) startDraftAt(p.lng, p.lat, p)
    else startDraftAt(c.lng, c.lat)
  }

  function focusSpot(s: Spot) {
    setView('map')
    mapRef.current?.setZoomAndCenter(16, [s.lng, s.lat])
  }

  const shown = spots?.filter((s) => filter === 'all' || s.status === filter) ?? []
  const todoCount = spots?.filter((s) => s.status === 'todo').length ?? 0

  return (
    <div className="home">
      <div ref={mapEl} className="map" />

      <header className="topbar">
        <div className="brand">540拍照</div>
        <div className="seg">
          <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
            地图
          </button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
            列表 {todoCount > 0 && <em>{todoCount}</em>}
          </button>
        </div>
        <button className="btn-pill" onClick={onOpenTrips}>
          行程
        </button>
        <button className="icon-btn" onClick={onOpenSettings} aria-label="设置">
          <Icon name="gear" size={22} />
        </button>
      </header>

      {error && <div className="toast">{error}</div>}

      {mode === 'pick' && AMap && (
        <>
          <div className="pick-search">
            <PlaceSearch
              AMap={AMap}
              autoFocus
              onPick={(p) => {
                pickedRef.current = p
                mapRef.current.setZoomAndCenter(17, [p.lng, p.lat])
              }}
            />
          </div>
          <div className="center-pin" />
          <div className="pick-bar">
            <button className="btn-ghost" onClick={() => setMode('browse')}>
              取消
            </button>
            <button className="btn-primary" onClick={confirmPick}>
              就这里
            </button>
          </div>
        </>
      )}

      {mode === 'browse' && view === 'map' && (
        <>
          {spots?.length === 0 && <div className="empty-hint">点右下角 + 或长按地图，添加第一个机位</div>}
          <div className="map-tools">
            <button className="fit-btn" onClick={onImport}>
              <Icon name="photo" size={15} />
              批量导入
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
          <button className="fab" onClick={() => setMode('pick')} disabled={!AMap} aria-label="添加机位">
            <Icon name="plus" size={28} />
          </button>
        </>
      )}

      {view === 'list' && mode === 'browse' && (
        <div className="list-panel">
          <div className="seg seg-full">
            <button className={filter === 'todo' ? 'on' : ''} onClick={() => setFilter('todo')}>
              待拍
            </button>
            <button className={filter === 'shot' ? 'on' : ''} onClick={() => setFilter('shot')}>
              已拍
            </button>
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
              全部
            </button>
          </div>
          {shown.length === 0 && <p className="hint">这里还没有机位</p>}
          <ul className="spot-list">
            {shown.map((s) => (
              <li key={s.id} className={s.status === 'shot' ? 'is-shot' : ''}>
                <ListThumb blob={covers?.get(s.photoIds[0])} />
                <div className="spot-main" onClick={() => setViewingId(s.id)}>
                  <div className="tip-name">
                    {s.name || '未命名机位'}
                    {s.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                  {s.address && <div className="tip-sub">{s.address}</div>}
                </div>
                <button className="btn-text" onClick={() => focusSpot(s)}>
                  地图
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {viewing && !editing && (
        <SpotViewer spot={viewing} onClose={() => setViewingId(null)} onEdit={() => setEditing({ ...viewing })} />
      )}
      {editing && <SpotEditor draft={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ListThumb({ blob }: { blob?: Blob }) {
  const url = useBlobUrl(blob)
  return <div className="list-thumb">{url && <img src={url} alt="" />}</div>
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
