import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Day, type Spot, type Trip } from '../db'
import type { AMapNS } from '../amap'
import { planDay } from '../routing'
import Thumb from './Thumb'

// 在行程里增删机位、换到另一天，保存后改动过的那天重新排路线
export default function TripEditor({
  AMap,
  trip,
  dayIdx,
  onClose,
}: {
  AMap: AMapNS
  trip: Trip
  dayIdx: number
  onClose: () => void
}) {
  // 每天的机位 id，编辑完再统一保存
  const [days, setDays] = useState<string[][]>(() => trip.days.map((d) => [...d.spotIds]))
  const [cur, setCur] = useState(dayIdx)
  const [adding, setAdding] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const inTrip = new Set(days.flat())

  const spots = useLiveQuery(async () => {
    const all = await db.spots.toArray()
    return new Map(all.map((s) => [s.id, s]))
  })
  const candidates = [...(spots?.values() ?? [])]
    .filter((s) => s.status === 'todo' && !inTrip.has(s.id))
    .sort((a, b) => b.createdAt - a.createdAt)

  const setDay = (i: number, ids: string[]) => setDays(days.map((d, k) => (k === i ? ids : d)))

  async function save() {
    if (days.every((d) => !d.length)) return alert('至少留一个机位；不想去了可以直接删除行程')
    try {
      const result: Day[] = []
      for (const [i, ids] of days.entries()) {
        const old = trip.days[i]
        if (!ids.length) continue
        // 机位没变就保留原来的路线（包括改过骑车的段）
        const same = ids.length === old.spotIds.length && ids.every((id) => old.spotIds.includes(id))
        if (same) {
          result.push(old)
          continue
        }
        const daySpots = ids.map((id) => spots!.get(id)!).filter(Boolean)
        const prefix = days.length > 1 ? `第 ${i + 1} 天：` : ''
        result.push(await planDay(AMap, old.start, old.end, daySpots, (n, t) => setProgress(`${prefix}重新排路线 ${n}/${t}`)))
      }
      await db.trips.update(trip.id, { days: result })
      onClose()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  const ids = days[cur]

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h2>编辑行程</h2>
        {days.length > 1 && (
          <div className="seg seg-full trip-edit-days">
            {days.map((d, i) => (
              <button key={i} className={cur === i ? 'on' : ''} onClick={() => setCur(i)}>
                第 {i + 1} 天（{d.length}）
              </button>
            ))}
          </div>
        )}

        {!adding ? (
          <>
            {ids.length === 0 && <p className="hint">这天没有机位了，保存后这一天会被去掉。</p>}
            <ul className="spot-list">
              {ids.map((id) => {
                const s = spots?.get(id)
                if (!s) return null
                return (
                  <li key={id}>
                    <Thumb photoId={s.photoIds[0]} />
                    <div className="spot-main">
                      <div className="tip-name">{s.name}</div>
                      {s.status === 'shot' && <div className="tip-sub">✓ 已拍</div>}
                    </div>
                    {days.length > 1 && (
                      <button
                        className="btn-text"
                        onClick={() => {
                          const other = cur === 0 ? 1 : 0
                          setDays(days.map((d, k) => (k === cur ? d.filter((x) => x !== id) : k === other ? [...d, id] : d)))
                        }}
                      >
                        移到第 {cur === 0 ? 2 : 1} 天
                      </button>
                    )}
                    <button className="btn-text danger-text" onClick={() => setDay(cur, ids.filter((x) => x !== id))}>
                      不去了
                    </button>
                  </li>
                )
              })}
            </ul>
            <button className="btn-ghost" onClick={() => setAdding(true)}>
              + 从收藏夹加机位
            </button>
          </>
        ) : (
          <>
            <div className="section-title">选要加的待拍机位</div>
            {candidates.length === 0 && <p className="hint">收藏夹里没有别的待拍机位了。</p>}
            <ul className="spot-list">
              {candidates.map((s: Spot) => (
                <li key={s.id} onClick={() => setDay(cur, [...ids, s.id])}>
                  <Thumb photoId={s.photoIds[0]} />
                  <div className="spot-main">
                    <div className="tip-name">{s.name}</div>
                    {s.address && <div className="tip-sub">{s.address}</div>}
                  </div>
                  <span className="btn-text">加入</span>
                </li>
              ))}
            </ul>
            <button className="btn-ghost" onClick={() => setAdding(false)}>
              完成添加
            </button>
          </>
        )}

        <div className="sheet-actions">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={save} disabled={!!progress || !spots}>
            {progress ?? '保存并重新排路线'}
          </button>
        </div>
      </div>
    </div>
  )
}
