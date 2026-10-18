import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import Settings from './pages/Settings'
import Home from './pages/Home'

export default function App() {
  // undefined = 还在读库，null = 第一次打开还没设置
  const settings = useLiveQuery(async () => (await db.settings.get('app')) ?? null)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    navigator.storage?.persist?.()
  }, [])

  if (settings === undefined) return null
  if (!settings || showSettings)
    return <Settings settings={settings} onClose={settings ? () => setShowSettings(false) : undefined} />
  return <Home settings={settings} onOpenSettings={() => setShowSettings(true)} />
}
