import { lazy, Suspense, useEffect, useState } from 'react'
import { useStore } from './store/store'
import { Icon } from './components/icons'
import { RewardToast } from './components/RewardToast'
import { Today } from './screens/Today'
import { Log } from './screens/Log'
import { Villain } from './screens/Villain'
import { Reckoning } from './screens/Reckoning'
import { Settings } from './screens/Settings'

// Progress pulls in Recharts; lazy-load it so the initial shell stays lean.
// The service worker precaches the chunk, so it still works fully offline.
const Progress = lazy(() =>
  import('./screens/Progress').then((m) => ({ default: m.Progress })),
)

type Tab = 'today' | 'log' | 'progress' | 'villain' | 'reckoning' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'log', label: 'Log', icon: 'log' },
  { id: 'progress', label: 'Progress', icon: 'progress' },
  { id: 'villain', label: 'Villain', icon: 'villain' },
  { id: 'reckoning', label: 'Reckon', icon: 'reckoning' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  const loaded = useStore((s) => s.loaded)
  const init = useStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (!loaded) {
    return (
      <main className="app-main">
        <div className="card" style={{ marginTop: 40, textAlign: 'center' }}>
          <div className="avatar" style={{ margin: '0 auto 12px' }}>
            D
          </div>
          <p className="muted">Loading Beat Drew…</p>
        </div>
      </main>
    )
  }

  return (
    <>
      <main className="app-main">
        {tab === 'today' && <Today goToLog={() => setTab('log')} />}
        {tab === 'log' && <Log />}
        {tab === 'progress' && (
          <Suspense fallback={<p className="muted">Loading charts…</p>}>
            <Progress />
          </Suspense>
        )}
        {tab === 'villain' && <Villain />}
        {tab === 'reckoning' && <Reckoning />}
        {tab === 'settings' && <Settings />}
      </main>

      <RewardToast />

      <nav className="nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-item${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
      </nav>
    </>
  )
}
