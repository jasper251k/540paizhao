import { useEffect, useRef, useState } from 'react'
import { db, newId, type Photo, type Spot } from '../db'
import { makePhoto, useBlobUrl } from '../photos'

// 新建时没有 id
export type Draft = Pick<Spot, 'name' | 'lng' | 'lat' | 'tags' | 'status'> & Partial<Spot>

const TAG_OPTIONS = ['傍晚', '清晨', '室内', '需预约']

export default function SpotEditor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [d, setD] = useState<Draft>(draft)
  const [spotId] = useState(() => draft.id ?? newId())
  const [photos, setPhotos] = useState<Photo[]>([])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const isNew = !draft.id

  useEffect(() => {
    if (!draft.photoIds?.length) return
    db.photos.bulkGet(draft.photoIds).then((ps) => setPhotos(ps.filter((p): p is Photo => !!p)))
  }, [draft.photoIds])

  async function addFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    try {
      const made: Photo[] = []
      for (const f of Array.from(files)) made.push(await makePhoto(f, spotId))
      setPhotos((ps) => [...ps, ...made])
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function toggleTag(t: string) {
    setD({ ...d, tags: d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t] })
  }

  async function save() {
    const spot: Spot = {
      id: spotId,
      name: d.name.trim() || '未命名机位',
      address: d.address,
      lng: d.lng,
      lat: d.lat,
      photoIds: photos.map((p) => p.id),
      note: d.note?.trim() || undefined,
      tags: d.tags,
      status: d.status,
      shotAt: d.shotAt ?? [],
      createdAt: d.createdAt ?? Date.now(),
    }
    const removed = (draft.photoIds ?? []).filter((id) => !spot.photoIds.includes(id))
    await db.transaction('rw', db.spots, db.photos, async () => {
      await db.photos.bulkDelete(removed)
      await db.photos.bulkPut(photos)
      await db.spots.put(spot)
    })
    onClose()
  }

  async function remove() {
    if (!d.id || !confirm(`删除「${d.name}」？`)) return
    await db.transaction('rw', db.spots, db.photos, async () => {
      await db.photos.where('spotId').equals(d.id!).delete()
      await db.spots.delete(d.id!)
    })
    onClose()
  }

  function toggleShot() {
    const shot = d.status === 'todo'
    setD({ ...d, status: shot ? 'shot' : 'todo', shotAt: shot ? [...(d.shotAt ?? []), Date.now()] : d.shotAt })
  }

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h2>{isNew ? '新机位' : '编辑机位'}</h2>
        {d.address && <div className="tip-sub">{d.address}</div>}

        <div className="field">
          <span>参考图{photos.length > 1 && '（点一张设为封面）'}</span>
          <div className="photo-grid">
            {photos.map((p, i) => (
              <EditThumb
                key={p.id}
                blob={p.thumb}
                cover={i === 0 && photos.length > 1}
                onCover={() => setPhotos([p, ...photos.filter((x) => x !== p)])}
                onRemove={() => setPhotos(photos.filter((x) => x !== p))}
              />
            ))}
            <button className="thumb thumb-add" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? '处理中…' : '+ 选图'}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        </div>

        <label className="field">
          <span>名字</span>
          <input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="比如：武康大楼对面" />
        </label>

        <label className="field">
          <span>备注</span>
          <textarea
            className="input"
            rows={2}
            value={d.note ?? ''}
            onChange={(e) => setD({ ...d, note: e.target.value })}
            placeholder="机位细节、动作、几号口出…"
          />
        </label>

        <div className="field">
          <span>标签</span>
          <div className="tags">
            {TAG_OPTIONS.map((t) => (
              <button key={t} className={`chip ${d.tags.includes(t) ? 'on' : ''}`} onClick={() => toggleTag(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {!isNew && (
          <button className={`btn-ghost ${d.status === 'shot' ? 'shot-on' : ''}`} onClick={toggleShot}>
            {d.status === 'shot' ? '✓ 已拍（点一下改回待拍）' : '标记为已拍'}
          </button>
        )}

        <div className="sheet-actions">
          {!isNew && (
            <button className="btn-danger" onClick={remove}>
              删除
            </button>
          )}
          <button className="btn-primary" onClick={save} disabled={busy}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

function EditThumb({ blob, cover, onCover, onRemove }: { blob: Blob; cover: boolean; onCover: () => void; onRemove: () => void }) {
  const url = useBlobUrl(blob)
  return (
    <div className="thumb" onClick={onCover}>
      {url && <img src={url} alt="" />}
      {cover && <span className="thumb-cover">封面</span>}
      <button
        className="thumb-x"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label="删除这张"
      >
        ×
      </button>
    </div>
  )
}
