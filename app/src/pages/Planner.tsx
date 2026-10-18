import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, type Day, type Place, type Settings } from '../db'
import { useAMap, type AMapNS } from '../amap'
import { planDay } from '../routing'
import PlaceSearch from '../components/PlaceSearch'
import Thumb from '../components/Thumb'

const defaultTitle = () => {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export default function Planner({
  settings,
  onBack,
  onDone,
}: {
  settings: Settings
  onBack: () => void
  onDone: (tripId: string) => void
}) {
  const [AMap, error] = useAMap(settings)
  const spots = useLiveQuery(() => db.spots.where('status').equals('todo').reverse().sortBy('createdAt'))
  // 选中的机位 → 第几天
  const [picked, setPicked] = useState<Record<string, 1 | 2>>({})
  const [days, setDays] = useState<1 | 2 | null>(null)
  const [start, setStart] = useState<Place | undefined>(settings.lastStart ?? settings.home)
  const [end, setEnd] = useState<Place | undefined>(settings.home)
  const [title, setTitle] = useState(defaultTitle)
  const [depart, setDepart] = useState('')
  const [progress, setProgress] = useState<string | null>(null)

  const ids = Object.keys(picked)

  function toggle(id: string) {
    const p = { ...picked }
    if (p[id]) delete p[id]
    else p[id] = 1
    setPicked(p)
  }

  async function run() {
    if (!AMap || !spots) return
    if (!ids.length) return alert('先选几个机位')
    if (!days) return alert('选一下：拍一天还是两天？')
    if (!start || !end) return alert('出发地和终点都要设置')
    const groups = days === 1 ? [ids] : [1, 2].map((n) => ids.filter((id) => picked[id] === n))
    if (groups.some((g) => !g.length)) return alert('两天都至少要有一个机位')

    try {
      const result: Day[] = []
      for (const [i, g] of groups.entries()) {
        const daySpots = g.map((id) => spots.find((s) => s.id === id)!)
        const prefix = days === 2 ? `第 ${i + 1} 天：` : ''
        result.push(await planDay(AMap, start, end, daySpots, (done, total) => setProgress(`${prefix}正在查路线 ${done}/${total}`)))
      }
      const id = newId()
      await db.trips.put({ id, title: title.trim() || defaultTitle(), days: result, departTime: depart || undefined, createdAt: Date.now() })
      await db.settings.update('app', { lastStart: start })
      onDone(id)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <button className="btn-text" onClick={onBack}>
          ‹ 返回
        </button>
        <h1>新建行程</h1>
      </header>
      {error && <p className="hint">{error}</p>}

      <section className="card">
        <label className="field">
          <span>名字</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <PlaceField label="出发地" place={start} onChange={setStart} AMap={AMap} />
        <PlaceField label="终点（默认回家）" place={end} onChange={setEnd} AMap={AMap} />
        <label className="field">
          <span>出发时间（可不填，填了会估算几点到）</span>
          <input className="input" type="time" value={depart} onChange={(e) => setDepart(e.target.value)} />
        </label>
      </section>

      <section className="card">
        <div className="field">
          <span>拍一天还是两天？</span>
          <div className="seg seg-full">
            <button className={days === 1 ? 'on' : ''} onClick={() => setDays(1)}>
              一天
            </button>
            <button className={days === 2 ? 'on' : ''} onClick={() => setDays(2)}>
              两天
            </button>
          </div>
          {days === 2 && <div className="tip-sub">选中的机位右边可以切换第几天，每天都从出发地出发、最后回到终点。</div>}
        </div>
      </section>

      <div className="section-title">
        选机位 <span className="tip-sub">已选 {ids.length} 个</span>
      </div>
      {spots?.length === 0 && <p className="hint">收藏夹里没有待拍机位，先去地图上加几个。</p>}
      <ul className="spot-list">
        {spots?.map((s) => (
          <li key={s.id} className={picked[s.id] ? 'is-picked' : ''} onClick={() => toggle(s.id)}>
            <span className="check">{picked[s.id] ? '✓' : ''}</span>
            <Thumb photoId={s.photoIds[0]} />
            <div className="spot-main">
              <div className="tip-name">
                {s.name}
                {s.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
              {s.address && <div className="tip-sub">{s.address}</div>}
            </div>
            {days === 2 && picked[s.id] && (
              <div className="seg seg-day" onClick={(e) => e.stopPropagation()}>
                {([1, 2] as const).map((n) => (
                  <button key={n} className={picked[s.id] === n ? 'on' : ''} onClick={() => setPicked({ ...picked, [s.id]: n })}>
                    {n === 1 ? '一' : '二'}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="bottom-bar">
        <button className="btn-primary" onClick={run} disabled={!AMap || !!progress}>
          排路线
        </button>
      </div>

      {progress && (
        <div className="sheet-mask center">
          <div className="progress-box">{progress}</div>
        </div>
      )}
    </div>
  )
}

function PlaceField({
  label,
  place,
  onChange,
  AMap,
}: {
  label: string
  place?: Place
  onChange: (p: Place) => void
  AMap: AMapNS
}) {
  const [open, setOpen] = useState(!place)
  return (
    <div className="field">
      <span>{label}</span>
      {place && !open ? (
        <div className="place-row">
          <div className="home-now">{place.name}</div>
          <button className="btn-text" onClick={() => setOpen(true)}>
            修改
          </button>
        </div>
      ) : AMap ? (
        <PlaceSearch
          AMap={AMap}
          onPick={(p) => {
            onChange({ name: p.name, lng: p.lng, lat: p.lat })
            setOpen(false)
          }}
        />
      ) : (
        <div className="tip-sub">地图加载中…</div>
      )}
    </div>
  )
}
