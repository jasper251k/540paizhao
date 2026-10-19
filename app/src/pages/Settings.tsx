import { useEffect, useState } from 'react'
import { db, type Settings as S } from '../db'
import { loadAMap, type AMapNS } from '../amap'
import PlaceSearch from '../components/PlaceSearch'
import Icon from '../components/Icon'
import { exportBackup, importBackup } from '../backup'

export default function Settings({ settings, onClose }: { settings: S | null; onClose?: () => void }) {
  const [amapKey, setKey] = useState(settings?.amapKey ?? '')
  const [code, setCode] = useState(settings?.amapSecurityCode ?? '')
  const [stay, setStay] = useState(settings?.defaultStayMin ?? 30)
  const [AMap, setAMap] = useState<AMapNS>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone

  async function doExport() {
    setBusy('正在打包…')
    try {
      await exportBackup()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function doImport(f?: File) {
    if (!f) return
    setBusy('正在导入…')
    try {
      const r = await importBackup(f)
      alert(`导入完成：${r.spots} 个机位，${r.trips} 个行程`)
    } catch (e) {
      alert('导入失败：' + (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  // Key 已保存过才加载地图，用来搜家的地址
  useEffect(() => {
    if (!settings?.amapKey) return
    loadAMap(settings.amapKey, settings.amapSecurityCode).then(setAMap, () => {})
  }, [settings?.amapKey, settings?.amapSecurityCode])

  const keyChanged = settings && (amapKey.trim() !== settings.amapKey || code.trim() !== settings.amapSecurityCode)

  async function save() {
    if (!amapKey.trim() || !code.trim()) return alert('Key 和安全密钥都要填')
    await db.settings.put({
      ...settings,
      key: 'app',
      amapKey: amapKey.trim(),
      amapSecurityCode: code.trim(),
      defaultStayMin: stay,
    })
    // 高德脚本已用旧 Key 加载，换 Key 后需要刷新页面
    if (keyChanged) return location.reload()
    onClose?.()
  }

  return (
    <div className="page">
      <header className="page-head">
        {onClose && (
          <button className="btn-text" onClick={onClose}>
            <Icon name="back" size={22} />返回
          </button>
        )}
        <h1>设置</h1>
      </header>

      {!settings && (
        <p className="hint">
          第一次使用，先填高德 Key。在 lbs.amap.com 控制台 →「应用管理 → 我的应用」里，复制你创建的「Web端(JS API)」Key 和安全密钥。只保存在这台手机里。
        </p>
      )}

      <section className="card">
        <label className="field">
          <span>高德 Key</span>
          <input className="input" value={amapKey} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        </label>
        <label className="field">
          <span>安全密钥</span>
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
        </label>
      </section>

      {settings && (
        <section className="card">
          <div className="field">
            <span>家（每天路线的终点）</span>
            {settings.home && (
              <div className="home-now">
                {settings.home.name}
              </div>
            )}
            {AMap ? (
              <PlaceSearch
                AMap={AMap}
                placeholder={settings.home ? '换一个地址…' : '搜索家附近的地铁站或小区'}
                onPick={(p) => db.settings.update('app', { home: { name: p.name, lng: p.lng, lat: p.lat } })}
              />
            ) : (
              <div className="tip-sub">地图加载中…</div>
            )}
          </div>
          <label className="field">
            <span>每个机位默认停留（分钟）</span>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              value={stay}
              onChange={(e) => setStay(Number(e.target.value) || 0)}
            />
          </label>
        </section>
      )}

      <button className="btn-primary" onClick={save}>
        保存
      </button>

      <div className="section-title">备份</div>
      <section className="card">
        <p className="hint">
          数据只存在这台手机里。
          {!standalone && '如果你刚把 540拍照 添加到主屏幕：先在这里「导出备份」，再从主屏幕图标打开、填好 Key 后「导入备份」，机位和照片就搬过去了。'}
        </p>
        <div className="backup-row">
          <button className="btn-ghost" onClick={doExport} disabled={!!busy}>
            导出备份
          </button>
          <label className={`btn-ghost ${busy || !settings ? 'disabled' : ''}`}>
            导入备份
            <input type="file" accept=".zip,application/zip" hidden disabled={!!busy || !settings} onChange={(e) => doImport(e.target.files?.[0])} />
          </label>
        </div>
        {busy && <div className="tip-sub import-status">{busy}</div>}
      </section>
    </div>
  )
}
