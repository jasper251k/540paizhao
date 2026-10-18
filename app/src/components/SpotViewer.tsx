import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Photo, type Spot } from '../db'
import { useBlobUrl } from '../photos'

// 点机位先看参考图；编辑在里面再点
export default function SpotViewer({ spot, onEdit, onClose }: { spot: Spot; onEdit: () => void; onClose: () => void }) {
  const photos = useLiveQuery(
    async () => (await db.photos.bulkGet(spot.photoIds)).filter((p): p is Photo => !!p),
    [spot.photoIds],
  )
  const [full, setFull] = useState<Blob | null>(null)

  async function toggleShot() {
    const shot = spot.status === 'todo'
    await db.spots.update(spot.id, { status: shot ? 'shot' : 'todo', shotAt: shot ? [...spot.shotAt, Date.now()] : spot.shotAt })
  }

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        {photos && photos.length > 0 ? (
          <div className="viewer-strip">
            {photos.map((p) => (
              <ViewerImg key={p.id} blob={p.full} onClick={() => setFull(p.full)} />
            ))}
          </div>
        ) : (
          <button className="viewer-empty" onClick={onEdit}>
            还没有参考图，点这里添加
          </button>
        )}
        {photos && photos.length > 1 && <div className="tip-sub viewer-count">共 {photos.length} 张，左右滑动</div>}

        <h2>
          {spot.name}
          {spot.tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </h2>
        {spot.address && <div className="tip-sub">{spot.address}</div>}
        {spot.note && <p className="viewer-note">{spot.note}</p>}

        <div className="sheet-actions">
          <button className="btn-ghost" onClick={onEdit}>
            编辑
          </button>
          <button className={spot.status === 'shot' ? 'btn-ghost shot-on' : 'btn-primary'} onClick={toggleShot}>
            {spot.status === 'shot' ? '✓ 已拍' : '拍完了'}
          </button>
        </div>
      </div>

      {full && <FullScreen blob={full} onClose={() => setFull(null)} />}
    </div>
  )
}

function ViewerImg({ blob, onClick }: { blob: Blob; onClick: () => void }) {
  const url = useBlobUrl(blob)
  return <div className="viewer-item">{url && <img src={url} alt="" onClick={onClick} />}</div>
}

function FullScreen({ blob, onClose }: { blob: Blob; onClose: () => void }) {
  const url = useBlobUrl(blob)
  return (
    <div
      className="fullscreen"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      {url && <img src={url} alt="" />}
    </div>
  )
}
