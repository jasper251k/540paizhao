import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import Settings from './pages/Settings'
import Home from './pages/Home'
import Trips from './pages/Trips'
import Planner from './pages/Planner'
import TripView from './pages/TripView'
import Import from './pages/Import'

type Screen =
  | { name: 'home' }
  | { name: 'settings' }
  | { name: 'trips' }
  | { name: 'plan'; preselect?: string[] }
  | { name: 'trip'; id: string }
  | { name: 'import' }

export default function App() {
  // undefined = 还在读库，null = 第一次打开还没设置
  const settings = useLiveQuery(async () => (await db.settings.get('app')) ?? null)
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const go = (s: Screen) => setScreen(s)

  useEffect(() => {
    navigator.storage?.persist?.()
  }, [])

  if (settings === undefined) return null
  if (!settings || screen.name === 'settings')
    return <Settings settings={settings} onClose={settings ? () => go({ name: 'home' }) : undefined} />

  switch (screen.name) {
    case 'trips':
      return (
        <Trips
          settings={settings}
          onBack={() => go({ name: 'home' })}
          onNew={() => go({ name: 'plan' })}
          onOpen={(id) => go({ name: 'trip', id })}
        />
      )
    case 'plan':
      return (
        <Planner
          settings={settings}
          preselect={screen.preselect}
          onBack={() => go({ name: 'trips' })}
          onDone={(id) => go({ name: 'trip', id })}
        />
      )
    case 'import':
      return <Import settings={settings} onBack={() => go({ name: 'home' })} onPlan={(ids) => go({ name: 'plan', preselect: ids })} />
    case 'trip':
      return <TripView settings={settings} tripId={screen.id} onBack={() => go({ name: 'trips' })} />
    default:
      return (
        <Home
          settings={settings}
          onOpenSettings={() => go({ name: 'settings' })}
          onOpenTrips={() => go({ name: 'trips' })}
          onImport={() => go({ name: 'import' })}
        />
      )
  }
}
