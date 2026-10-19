import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Settings } from '../db'
import { dayTotal, fmtDur } from '../routing'
import Icon from '../components/Icon'

export default function Trips({
  settings,
  onBack,
  onNew,
  onOpen,
}: {
  settings: Settings
  onBack: () => void
  onNew: () => void
  onOpen: (id: string) => void
}) {
  const trips = useLiveQuery(() => db.trips.orderBy('createdAt').reverse().toArray())

  return (
    <div className="page">
      <header className="page-head">
        <button className="btn-text" onClick={onBack}>
          <Icon name="back" size={22} />返回
        </button>
        <h1>行程</h1>
      </header>

      <button className="btn-primary" onClick={onNew}>
        + 新建行程
      </button>

      {trips?.length === 0 && <p className="hint">还没有行程。从收藏夹里挑几个待拍机位，排一条路线。</p>}
      <ul className="spot-list">
        {trips?.map((t) => (
          <li key={t.id} onClick={() => onOpen(t.id)}>
            <div className="spot-main">
              <div className="tip-name">{t.title}</div>
              <div className="tip-sub">
                {t.days.length > 1 && `${t.days.length} 天 · `}
                {t.days.reduce((s, d) => s + d.spotIds.length, 0)} 个机位 · 约{' '}
                {fmtDur(t.days.reduce((s, d) => s + dayTotal(d, settings.defaultStayMin), 0))}
              </div>
            </div>
            <span className="chev">›</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
