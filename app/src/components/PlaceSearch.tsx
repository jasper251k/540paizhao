import { useEffect, useRef, useState } from 'react'
import type { AMapNS } from '../amap'

export type PickedPlace = { name: string; address: string; lng: number; lat: number }

type Tip = { id: string; name: string; district: string; address: string; location?: { lng: number; lat: number } }

export default function PlaceSearch({
  AMap,
  onPick,
  placeholder = '搜地名、地铁站、商场…',
  autoFocus,
}: {
  AMap: AMapNS
  onPick: (p: PickedPlace) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [tips, setTips] = useState<Tip[]>([])
  const acRef = useRef<AMapNS>(null)

  useEffect(() => {
    acRef.current = new AMap.AutoComplete({ city: '上海' })
  }, [AMap])

  useEffect(() => {
    const kw = q.trim()
    if (!kw) {
      setTips([])
      return
    }
    const t = setTimeout(() => {
      acRef.current?.search(kw, (status: string, result: { tips?: Tip[] }) => {
        if (status !== 'complete' || !result.tips) return setTips([])
        // 公交线路之类的提示没有坐标，过滤掉
        setTips(result.tips.filter((tip) => tip.location && tip.location.lng))
      })
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="search">
      <input
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        enterKeyHint="search"
      />
      {tips.length > 0 && (
        <ul className="search-results">
          {tips.map((tip) => (
            <li
              key={tip.id || tip.name + tip.district}
              onClick={() => {
                onPick({
                  name: tip.name,
                  address: tip.district + (typeof tip.address === 'string' ? tip.address : ''),
                  lng: tip.location!.lng,
                  lat: tip.location!.lat,
                })
                setQ('')
                setTips([])
              }}
            >
              <div className="tip-name">{tip.name}</div>
              <div className="tip-sub">
                {tip.district}
                {typeof tip.address === 'string' ? tip.address : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
