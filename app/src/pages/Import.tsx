import { useRef, useState } from 'react'
import { db, newId, type Photo, type Settings, type Spot } from '../db'
import { useAMap, type AMapNS } from '../amap'
import { makePhoto, useBlobUrl } from '../photos'
import Icon from '../components/Icon'

type Img = Pick<Photo, 'full' | 'thumb'>
type Cand = { name: string; address: string; lng: number; lat: number }
type Group = { name: string; nums: number[]; cands: Cand[]; chosen: number; searching: boolean }

// 一行一个地点：「1-3 武康大楼」「4,5 外滩」「6 安福路」；也支持「、」「~」「到」
const SPEC = /^\s*(\d+(?:\s*[-~—–到至]\s*\d+)?(?:\s*[,，、]\s*\d+(?:\s*[-~—–到至]\s*\d+)?)*)[\s:：]*(.+?)\s*$/

function parseGroups(text: string, count: number) {
  const groups: { name: string; nums: number[] }[] = []
  const bad: string[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const m = line.match(SPEC)
    if (!m) {
      bad.push(line.trim())
      continue
    }
    const nums: number[] = []
    for (const part of m[1].split(/[,，、]/)) {
      const [a, b] = part.split(/[-~—–到至]/).map((x) => parseInt(x, 10))
      for (let i = Math.min(a, b ?? a); i <= Math.max(a, b ?? a); i++) if (i >= 1 && i <= count && !nums.includes(i)) nums.push(i)
    }
    if (nums.length) groups.push({ name: m[2], nums })
    else bad.push(line.trim())
  }
  return { groups, bad }
}

function searchPlaces(AMap: AMapNS, kw: string): Promise<Cand[]> {
  return new Promise((resolve) => {
    new AMap.AutoComplete({ city: '上海' }).search(kw, (status: string, r: AMapNS) => {
      if (status !== 'complete' || !r.tips) return resolve([])
      resolve(
        r.tips
          .filter((t: AMapNS) => t.location && t.location.lng)
          .slice(0, 5)
          .map((t: AMapNS) => ({
            name: t.name,
            address: t.district + (typeof t.address === 'string' ? t.address : ''),
            lng: t.location.lng,
            lat: t.location.lat,
          })),
      )
    })
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function Import({
  settings,
  onBack,
  onPlan,
}: {
  settings: Settings
  onBack: () => void
  onPlan: (spotIds: string[]) => void
}) {
  const [AMap, error] = useAMap(settings)
  const [imgs, setImgs] = useState<Img[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sel, setSel] = useState<number[]>([])
  const [selName, setSelName] = useState('')
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [saved, setSaved] = useState<string[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { groups: parsed, bad } = parseGroups(text, imgs.length)
  const used = new Set(parsed.flatMap((g) => g.nums))
  const unused = imgs.map((_, i) => i + 1).filter((n) => !used.has(n))

  async function addFiles(files: FileList | null) {
    if (!files?.length) return
    const list = Array.from(files)
    try {
      const made: Img[] = []
      for (const [i, f] of list.entries()) {
        setLoading(`处理图片 ${i + 1}/${list.length}`)
        made.push(await makePhoto(f, ''))
      }
      setImgs((x) => [...x, ...made])
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setLoading(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // 点选几张图 + 输入地名，等于在文本里加一行
  function addSelected() {
    if (!sel.length || !selName.trim()) return
    const nums = [...sel].sort((a, b) => a - b).join(',')
    setText((t) => (t.trim() ? t.replace(/\s*$/, '\n') : '') + `${nums} ${selName.trim()}`)
    setSel([])
    setSelName('')
  }

  async function search() {
    if (!AMap) return
    if (!parsed.length) return alert('先写好哪几张是哪个地点，比如「1-3 武康大楼」')
    const gs: Group[] = parsed.map((g) => ({ ...g, cands: [], chosen: 0, searching: true }))
    setGroups(gs)
    for (let i = 0; i < gs.length; i++) {
      const cands = await searchPlaces(AMap, gs[i].name)
      setGroups((cur) => cur && cur.map((g, k) => (k === i ? { ...g, cands, searching: false } : g)))
      await sleep(300)
    }
  }

  async function research(i: number, kw: string) {
    if (!AMap || !groups) return
    setGroups(groups.map((g, k) => (k === i ? { ...g, name: kw, searching: true } : g)))
    const cands = await searchPlaces(AMap, kw)
    setGroups((cur) => cur && cur.map((g, k) => (k === i ? { ...g, cands, chosen: 0, searching: false } : g)))
  }

  async function save() {
    if (!groups) return
    const ok = groups.filter((g) => g.cands.length)
    if (ok.length < groups.length && !confirm(`有 ${groups.length - ok.length} 个地点没搜到，先跳过它们？`)) return
    const spots: Spot[] = []
    const photos: Photo[] = []
    const now = Date.now()
    ok.forEach((g, gi) => {
      const c = g.cands[g.chosen]
      const id = newId()
      const ps = g.nums.map((n) => ({ id: newId(), spotId: id, ...imgs[n - 1] }))
      photos.push(...ps)
      spots.push({
        id,
        name: g.name,
        address: c.name === g.name ? c.address : `${c.name} · ${c.address}`,
        lng: c.lng,
        lat: c.lat,
        photoIds: ps.map((p) => p.id),
        tags: [],
        status: 'todo',
        shotAt: [],
        createdAt: now + gi,
      })
    })
    await db.transaction('rw', db.spots, db.photos, async () => {
      await db.photos.bulkPut(photos)
      await db.spots.bulkPut(spots)
    })
    setSaved(spots.map((s) => s.id))
  }

  const head = (title: string, back: () => void) => (
    <header className="page-head">
      <button className="btn-text" onClick={back}>
        <Icon name="back" size={22} />
        返回
      </button>
      <h1>{title}</h1>
    </header>
  )

  if (saved)
    return (
      <div className="page">
        {head('导入完成', onBack)}
        <p className="hint">已把 {saved.length} 个机位加进收藏夹，参考图也都挂好了。</p>
        <button className="btn-primary" onClick={() => onPlan(saved)}>
          用这些机位排路线
        </button>
        <button className="btn-ghost import-gap" onClick={onBack}>
          先放着，回地图
        </button>
      </div>
    )

  if (groups)
    return (
      <div className="page">
        {head('确认地点', () => setGroups(null))}
        <p className="hint">每个地点默认用高德第一个结果。不对就点下面别的，或者改关键词重搜。</p>
        {groups.map((g, i) => (
          <section key={i} className="card import-group">
            <div className="import-thumbs">
              {g.nums.map((n) => (
                <NumThumb key={n} img={imgs[n - 1]} n={n} />
              ))}
            </div>
            <KeywordInput value={g.name} onSearch={(kw) => research(i, kw)} />
            {g.searching ? (
              <div className="tip-sub import-status">搜索中…</div>
            ) : g.cands.length === 0 ? (
              <div className="tip-sub import-status danger-text">没搜到，换个关键词试试（比如加上路名）</div>
            ) : (
              <ul className="cand-list">
                {g.cands.map((c, k) => (
                  <li
                    key={k}
                    className={g.chosen === k ? 'on' : ''}
                    onClick={() => setGroups(groups.map((x, j) => (j === i ? { ...x, chosen: k } : x)))}
                  >
                    <span className="check">{g.chosen === k ? '✓' : ''}</span>
                    <div className="spot-main">
                      <div className="tip-name">{c.name}</div>
                      <div className="tip-sub">{c.address}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
        <div className="bottom-bar">
          <button className="btn-primary" onClick={save} disabled={groups.some((g) => g.searching)}>
            加入收藏夹
          </button>
        </div>
      </div>
    )

  return (
    <div className="page">
      {head('批量导入', onBack)}
      {error && <p className="hint">{error}</p>}

      <div className="section-title">1 · 选参考图</div>
      <section className="card import-pick">
        <div className="photo-grid">
          {imgs.map((img, i) => (
            <NumThumb
              key={i}
              img={img}
              n={i + 1}
              selected={sel.includes(i + 1)}
              dim={!used.has(i + 1)}
              onClick={() => setSel(sel.includes(i + 1) ? sel.filter((x) => x !== i + 1) : [...sel, i + 1])}
            />
          ))}
          <button className="thumb thumb-add" onClick={() => fileRef.current?.click()} disabled={!!loading}>
            {loading ?? (
              <>
                <Icon name="plus" size={22} />
                <span>选图</span>
              </>
            )}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        {imgs.length > 0 && (
          <div className="tip-sub import-status">按选择的顺序编号。点图可以多选，再在下面输入地名。</div>
        )}
        {sel.length > 0 && (
          <div className="import-sel">
            <input
              className="input"
              value={selName}
              onChange={(e) => setSelName(e.target.value)}
              placeholder={`第 ${[...sel].sort((a, b) => a - b).join('、')} 张是哪里？`}
              enterKeyHint="done"
              onKeyDown={(e) => e.key === 'Enter' && addSelected()}
            />
            <button className="btn-primary" onClick={addSelected}>
              添加
            </button>
          </div>
        )}
      </section>

      <div className="section-title">2 · 哪几张是哪里（一行一个）</div>
      <section className="card">
        <textarea
          className="input import-text"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'1-3 武康大楼\n4,5 外滩\n6 安福路'}
        />
        {bad.length > 0 && <div className="tip-sub danger-text import-status">看不懂这几行：{bad.join(' / ')}</div>}
        {imgs.length > 0 && unused.length > 0 && parsed.length > 0 && (
          <div className="tip-sub import-status">第 {unused.join('、')} 张还没分配，会被跳过</div>
        )}
      </section>

      <div className="bottom-bar">
        <button className="btn-primary" onClick={search} disabled={!AMap || !imgs.length || !parsed.length}>
          去高德搜索 {parsed.length > 0 && `${parsed.length} 个地点`}
        </button>
      </div>
    </div>
  )
}

function NumThumb({
  img,
  n,
  selected,
  dim,
  onClick,
}: {
  img: Img
  n: number
  selected?: boolean
  dim?: boolean
  onClick?: () => void
}) {
  const url = useBlobUrl(img.thumb)
  return (
    <div className={`thumb num-thumb ${selected ? 'selected' : ''} ${dim ? 'dim' : ''}`} onClick={onClick}>
      {url && <img src={url} alt="" />}
      <b>{n}</b>
    </div>
  )
}

function KeywordInput({ value, onSearch }: { value: string; onSearch: (kw: string) => void }) {
  const [kw, setKw] = useState(value)
  return (
    <div className="import-sel">
      <input className="input" value={kw} onChange={(e) => setKw(e.target.value)} enterKeyHint="search" onKeyDown={(e) => e.key === 'Enter' && kw.trim() && onSearch(kw.trim())} />
      {kw.trim() !== value && (
        <button className="btn-ghost" onClick={() => onSearch(kw.trim())}>
          重搜
        </button>
      )}
    </div>
  )
}
