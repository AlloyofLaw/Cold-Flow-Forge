import { useEffect, useState } from 'react';
import { useStore } from './store/useStore';
import { RewardToast } from './components/RewardToast';
import { Home } from './screens/Home';
import { ActiveSession } from './screens/ActiveSession';
import { History } from './screens/History';
import { PlateCalculatorScreen } from './screens/PlateCalculatorScreen';
import { Progress } from './screens/Progress';
import { SettingsScreen } from './screens/SettingsScreen';

export type ScreenName = 'home' | 'session' | 'history' | 'plates' | 'progress' | 'settings';

const NAV: { key: ScreenName; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: '🏠' },
  { key: 'session', label: 'Session', icon: '🏋️' },
  { key: 'history', label: 'History', icon: '📖' },
  { key: 'plates', label: 'Plates', icon: '🥏' },
  { key: 'progress', label: 'Progress', icon: '📈' },
  { key: 'settings', label: 'Settings', icon: '⚙️' },
];

export function App() {
  const init = useStore((s) => s.init);
  const loaded = useStore((s) => s.loaded);
  const activeSession = useStore((s) => s.activeSession);
  const [screen, setScreen] = useState<ScreenName>('home');

  useEffect(() => {
    // App init loads the DB and restores any live session. It awards NO XP —
    // opening the app is never a rewarded action.
    void init();
  }, [init]);

  if (!loaded) {
    return (
      <div className="app">
        <div className="screen center muted" style={{ paddingTop: 80 }}>
          Loading Lift Log…
        </div>
      </div>
    );
  }

  const go = (s: ScreenName) => setScreen(s);

  return (
    <div className="app">
      <RewardToast />
      <div className="screen">
        {screen === 'home' && <Home go={go} />}
        {screen === 'session' && <ActiveSession go={go} />}
        {screen === 'history' && <History />}
        {screen === 'plates' && <PlateCalculatorScreen />}
        {screen === 'progress' && <Progress />}
        {screen === 'settings' && <SettingsScreen />}
      </div>

      <nav className="nav">
        {NAV.map((n) => (
          <button
            key={n.key}
            className={screen === n.key ? 'active' : ''}
            onClick={() => go(n.key)}
          >
            <span className="ic">{n.key === 'session' && activeSession ? '⏱️' : n.icon}</span>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
